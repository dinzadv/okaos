const $ = id => document.getElementById(id) || document.createElement('div');

        const state = {
            isPlaying: false,
            isPaused: false,
            mode: 'normal',
            lives: 3,
            maxLives: 3,
            recoveryHealth: 50,
            score: 0,
            perfects: 0,
            commons: 0,
            okays: 0,
            misses: 0,
            maxCombo: 0,
            currentCombo: 0,
            userKeys: ['D', 'F', 'J', 'K'],
            holdingNote: [null, null, null, null]
        };

        const ENGINE = {
            ready: false,
            songData: null,
            notes: [],
            travelMs: 1200,
            baseTravelMs: 1200,
            hitWindows: { perfect: 45, comun: 90, okay: 140 },
            defaultDamage: 10,
            defaultLifePerfect: 10,
            defaultLifeComun: 5,
            defaultLifeOkay: 3,
            rafId: null,
            columnRects: [{ height: 0, receptorY: 0 }, { height: 0, receptorY: 0 }, { height: 0, receptorY: 0 }, { height: 0, receptorY: 0 }],
            clockStartPerf: 0,
            audioStarted: false,
            totalPausedMs: 0,
            pauseStartedAt: 0,
            offsetMs: 0,
            customSpeed: null,
            vibrationOn: true,
            masterVol: 0.8,
            bgmVol: 0.7,
            musicSpeed: 1.0,
            speedPoints: [{ time: 0, valor: 1 }],
            textos: [],
            frozenInput: false
        };

        const REBOUND_SECOND_DELAY = 260;
        const REBOUND_SECOND_WINDOW = 130;
        const REBOUND_ARC_PX = 120;
        const BOMB_SLOWMO_RATE = 0.2;
        const BOMB_END_DELAY_MS = 1100;

        function loadGameSettings() {
            const defaults = {
                keys: { key1: 'D', key2: 'F', key3: 'J', key4: 'K' },
                sliders: { arrowSpeed: 4.5, offset: 0, touchSize: 100, touchOpacity: 80, laneOpacity: 0, masterVol: 80, bgmVol: 70, sfxVol: 90, musicSpeed: 1.0 },
                toggles: { btnCustomSpeed: false, btnArrowPos: false, btnVibration: true, btnFX: true, btnLines: true, btnStorage: true }
            };
            try {
                const saved = localStorage.getItem('okaos_settings');
                if (!saved) return defaults;
                const parsed = JSON.parse(saved);
                return {
                    keys: Object.assign({}, defaults.keys, parsed.keys),
                    sliders: Object.assign({}, defaults.sliders, parsed.sliders),
                    toggles: Object.assign({}, defaults.toggles, parsed.toggles)
                };
            } catch (e) {
                return defaults;
            }
        }

        function updateBaseTravelMs() {
            const rawSpeed = ENGINE.customSpeed || speedAt(0);
            ENGINE.baseTravelMs = BASE_TRAVEL_MS / rawSpeed;
        }

        function speedAt(t) {
            const points = ENGINE.speedPoints;
            let valor = points[0].valor;
            for (const p of points) {
                if (p.time > t) break;
                valor = p.valor;
            }
            return valor;
        }

        function noteRawSpeed(t) {
            return ENGINE.customSpeed || speedAt(t);
        }

        function recomputeNoteBaseSpeeds() {
            ENGINE.notes.forEach(n => {
                n.baseTravelMs = BASE_TRAVEL_MS / noteRawSpeed(n.time);
            });
        }

        function applyGameSettings() {
            const gs = loadGameSettings();
            state.userKeys = [gs.keys.key1, gs.keys.key2, gs.keys.key3, gs.keys.key4];

            ENGINE.offsetMs = parseFloat(gs.sliders.offset) || 0;
            ENGINE.customSpeed = gs.toggles.btnCustomSpeed ? (parseFloat(gs.sliders.arrowSpeed) || null) : null;
            updateBaseTravelMs();
            if (ENGINE.notes.length) recomputeNoteBaseSpeeds();
            ENGINE.vibrationOn = !!gs.toggles.btnVibration;
            ENGINE.masterVol = (parseFloat(gs.sliders.masterVol) || 0) / 100;
            ENGINE.bgmVol = (parseFloat(gs.sliders.bgmVol) || 0) / 100;
            ENGINE.musicSpeed = parseFloat(gs.sliders.musicSpeed) || 1.0;

            document.body.classList.toggle('arrows-bottom', !!gs.toggles.btnArrowPos);
            document.body.classList.toggle('lines-off', !gs.toggles.btnLines);
            document.body.classList.toggle('fx-off', !gs.toggles.btnFX);

            const touchScale = (parseFloat(gs.sliders.touchSize) || 100) / 100;
            const touchOpacity = (parseFloat(gs.sliders.touchOpacity) || 80) / 100;
            document.documentElement.style.setProperty('--touch-scale', touchScale);
            document.documentElement.style.setProperty('--touch-opacity', touchOpacity);

            const laneOpacity = ((parseFloat(gs.sliders.laneOpacity) || 0) / 100) * 0.65;
            document.documentElement.style.setProperty('--lane-opacity', laneOpacity);

            bgMusic.volume = Math.max(0, Math.min(1, ENGINE.masterVol * ENGINE.bgmVol));
            bgMusic.playbackRate = ENGINE.musicSpeed;
        }

        function triggerVibration(ms) {
            if (ENGINE.vibrationOn && navigator.vibrate) navigator.vibrate(ms || 25);
        }

        window.addEventListener('storage', (e) => {
            if (e.key === 'okaos_settings') applyGameSettings();
        });

        const DIR_NOTE_CLASS = ['n-left', 'n-up', 'n-down', 'n-right'];
        const DIR_ARROW_CLASS = ['dir-left', 'dir-up', 'dir-down', 'dir-right'];
        const BASE_TRAVEL_MS = 1200;
        const MIN_TRAVEL_MS = 500;
        const MAX_TRAVEL_MS = 2600;
        const MAX_RECONNECT_ATTEMPTS = 2;
        const EXIT_FADE_MS = 260;
        const RANK_IMAGES = {
            F: '../img/assets/ranks/f.png',
            D: '../img/assets/ranks/d.png',
            C: '../img/assets/ranks/c.png',
            B: '../img/assets/ranks/b.png',
            A: '../img/assets/ranks/a.png',
            S: '../img/assets/ranks/s.png',
            SS: '../img/assets/ranks/ss.png',
            SSS: '../img/assets/ranks/sss.png'
        };

        const lobbyViewport = $('lobbyViewport');
        const gameViewport = $('gameViewport');
        const pauseViewport = $('pauseViewport');
        const endViewport = $('endViewport');
        const countdownOverlay = $('countdownOverlay');
        const countdownText = $('countdownText');
        const btnNormal = $('btnNormal');
        const btnRecovery = $('btnRecovery');
        const btnNoLives = $('btnNoLives');
        const btnExit = $('btnExit');
        const btnResume = $('btnResume');
        const btnRestart = $('btnRestart');
        const btnSettings = $('btnSettings');
        const btnPauseExit = $('btnPauseExit');
        const btnEndRetry = $('btnEndRetry');
        const btnEndSongs = $('btnEndSongs');
        const btnEndExit = $('btnEndExit');
        const pauseTrigger = $('pauseTrigger');
        const scoreEl = $('score');
        const ratingEl = $('rating');
        const songArt = $('songArt');
        const songTitle = $('songTitle');
        const bgVideo = $('bgVideo');
        const bgMusic = $('bgMusic');
        const clickSound = $('clickSound');

        function playClick() {
            try {
                clickSound.currentTime = 0;
                clickSound.play().catch(() => {});
            } catch (e) {}
        }

        const perfectCounterEl = $('perfectCounter');
        const perfectValueEl = $('perfectValue');
        const commonCounterEl = $('commonCounter');
        const commonValueEl = $('commonValue');
        const okayCounterEl = $('okayCounter');
        const okayValueEl = $('okayValue');
        const missCounterEl = $('missCounter');
        const missValueEl = $('missValue');

        const heartsContainer = $('heartsContainer');
        const barContainer = $('barContainer');
        const lyricOverlay = $('lyricOverlay');
        const barFill = $('barFill');
        const pauseScore = $('pauseScore');
        const pausePerfects = $('pausePerfects');
        const pauseCombo = $('pauseCombo');
        const endTitle = $('endTitle');
        const resultsStatus = $('resultsStatus');
        const rankImg = $('rankImg');
        const endScore = $('endScore');
        const endPerfects = $('endPerfects');
        const endCombo = $('endCombo');
        const star1 = $('star-1');
        const star2 = $('star-2');
        const star3 = $('star-3');
        const tracksContainer = $('tracksContainer');

        const receptors = [
            $('receptor-0'),
            $('receptor-1'),
            $('receptor-2'),
            $('receptor-3')
        ];

        const trackColumns = [
            $('track-0'),
            $('track-1'),
            $('track-2'),
            $('track-3')
        ];

        function resolveSongSelection() {
            const params = new URLSearchParams(window.location.search);
            const urlId = params.get('id') || params.get('song') || params.get('cancion');
            if (urlId) return urlId;
            const storedId = localStorage.getItem('selectedSongId');
            if (storedId) {
                localStorage.removeItem('selectedSongId');
                localStorage.removeItem('selectedSong');
                return storedId;
            }
            const storedSong = localStorage.getItem('selectedSong');
            if (storedSong) {
                localStorage.removeItem('selectedSong');
                localStorage.removeItem('selectedSongId');
                try {
                    const parsed = JSON.parse(storedSong);
                    if (parsed && parsed.id) return parsed.id;
                } catch (err) {}
            }
            return null;
        }

        function generateToken() {
            return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
        }

        function saveReconnect(songId, token) {
            let attempts = 0;
            try {
                const prevRaw = localStorage.getItem('okaosReconnect');
                if (prevRaw) {
                    const prev = JSON.parse(prevRaw);
                    if (prev.songId === songId) attempts = (prev.attempts || 0) + 1;
                }
            } catch (err) {}
            localStorage.setItem('okaosReconnect', JSON.stringify({ songId: songId, token: token, attempts: attempts }));
            const url = new URL(window.location.href);
            url.searchParams.set('token', token);
            history.replaceState(null, '', url.toString());
            return attempts;
        }

        function clearReconnect() {
            localStorage.removeItem('okaosReconnect');
            localStorage.removeItem('selectedSong');
            localStorage.removeItem('selectedSongId');
            const url = new URL(window.location.href);
            if (url.searchParams.has('token')) {
                url.searchParams.delete('token');
                history.replaceState(null, '', url.toString());
            }
        }

        function checkAutoReconnect() {
            const params = new URLSearchParams(window.location.search);
            const urlToken = params.get('token');
            if (!urlToken) return null;
            try {
                const prevRaw = localStorage.getItem('okaosReconnect');
                if (!prevRaw) return null;
                const prev = JSON.parse(prevRaw);
                if (prev.token === urlToken) return prev.songId;
            } catch (err) {}
            return null;
        }

        function reflectSongTitleInUrl(name) {
            if (!name) return;
            const url = new URL(window.location.href);
            url.searchParams.set('title', name);
            history.replaceState(null, '', url.toString());
        }

        function goTo(url) {
            clearReconnect();
            window.location.href = url;
        }

        async function initEngine() {
            let songId = resolveSongSelection();
            if (!songId) songId = checkAutoReconnect();
            if (!songId) {
                showNoSongState();
                return;
            }
            await loadSong(songId);
        }

        async function loadSong(rawId) {
            try {
                const data = await SONGS.getFull(rawId, { video: true });
                const notesArr = Array.isArray(data.notes) ? data.notes : null;
                if (!notesArr || notesArr.length === 0) throw new Error('sin-notas');
                applySongData(data, notesArr);
                clearReconnect();
            } catch (err) {
                const token = generateToken();
                const attempts = saveReconnect(rawId, token);
                if (attempts < MAX_RECONNECT_ATTEMPTS) {
                    setTimeout(() => window.location.reload(), 700);
                } else {
                    clearReconnect();
                    showLoadError();
                }
            }
        }

        function applySongData(data, notesArr) {
            ENGINE.songData = data;

            if (Array.isArray(data.velocidad) && data.velocidad.length) {
                const pts = data.velocidad
                    .filter(p => typeof p.time === 'number' && typeof p.valor === 'number' && p.valor > 0)
                    .sort((a, b) => a.time - b.time);
                ENGINE.speedPoints = pts.length ? pts : [{ time: 0, valor: 1 }];
                if (ENGINE.speedPoints[0].time > 0) {
                    ENGINE.speedPoints.unshift({ time: 0, valor: ENGINE.speedPoints[0].valor });
                }
            } else {
                const single = (typeof data.velocidad === 'number' && data.velocidad > 0) ? data.velocidad : 1;
                ENGINE.speedPoints = [{ time: 0, valor: single }];
            }

            ENGINE.notes = notesArr
                .filter(n => typeof n.time === 'number' && typeof n.col === 'number' && n.col >= 0 && n.col <= 3)
                .map(n => {
                    const rawTag = (typeof n.tag === 'string' ? n.tag : (typeof n.etiqueta === 'string' ? n.etiqueta : '')).trim().toLowerCase();
                    return {
                        time: n.time,
                        col: n.col,
                        spawned: false,
                        judged: false,
                        el: null,
                        arrowEl: null,
                        fadeTimeoutId: null,
                        damage: typeof n.damage === 'number' ? n.damage : ENGINE.defaultDamage,
                        lifePerfect: typeof n['life-perfect'] === 'number' ? n['life-perfect'] : ENGINE.defaultLifePerfect,
                        lifeComun: typeof n['life-comun'] === 'number' ? n['life-comun'] : ENGINE.defaultLifeComun,
                        lifeOkey: typeof n['life-okey'] === 'number' ? n['life-okey'] : ENGINE.defaultLifeOkay,
                        hold: (typeof n.hold === 'number' && n.hold > 0) ? n.hold : 0,
                        holdEl: null,
                        holding: false,
                        cambio: (n.cambio && typeof n.cambio.time === 'number' && typeof n.cambio.col === 'number' && n.cambio.col >= 0 && n.cambio.col <= 3)
                            ? { time: n.cambio.time, col: n.cambio.col, applied: false }
                            : null,
                        baseTravelMs: BASE_TRAVEL_MS,
                        travelMs: BASE_TRAVEL_MS,
                        tag: rawTag,
                        raw: n.extra || null,
                        mech: null,
                        isBomb: rawTag === 'bom' || rawTag === 'bomb' || rawTag === 'bomba',
                        isRebound: rawTag === 'rebound' || rawTag === 'rebote',
                        reboundStage: 0,
                        reboundSecondTime: 0
                    };
                })
                .sort((a, b) => a.time - b.time);

            let reboundRunStart = -1;
            for (let i = 0; i <= ENGINE.notes.length; i++) {
                const isReboundHere = i < ENGINE.notes.length && ENGINE.notes[i].isRebound;
                if (isReboundHere && reboundRunStart === -1) {
                    reboundRunStart = i;
                } else if (!isReboundHere && reboundRunStart !== -1) {
                    if (i - reboundRunStart < 2) {
                        for (let j = reboundRunStart; j < i; j++) ENGINE.notes[j].isRebound = false;
                    }
                    reboundRunStart = -1;
                }
            }

            recomputeNoteBaseSpeeds();
            updateBaseTravelMs();

            ENGINE.textos = Array.isArray(data.textos)
                ? data.textos
                    .filter(t => typeof t.time === 'number' && typeof t.texto === 'string')
                    .map(t => ({ time: t.time, texto: t.texto, duracion: (typeof t.duracion === 'number' && t.duracion > 0) ? t.duracion : 2200, shown: false }))
                    .sort((a, b) => a.time - b.time)
                : [];

            const displayName = data.nombre || 'Unknown Track';
            songTitle.textContent = displayName;
            songArt.src = data.portada || data.fondo || '../img/logo.jpg';
            reflectSongTitleInUrl(displayName);

            if (data.fondo) {
                document.body.style.background = "url('" + data.fondo + "') no-repeat center center/cover";
                lobbyViewport.style.background = "url('" + data.fondo + "') no-repeat center center/cover";
            }

            if (data.video) {
                bgVideo.src = data.video;
                bgVideo.style.display = 'block';
                bgVideo.pause();
                bgVideo.currentTime = 0;
            } else {
                bgVideo.removeAttribute('src');
                bgVideo.style.display = 'none';
            }

            if (data.audio) {
                bgMusic.src = data.audio;
            }

            ENGINE.ready = true;
            OKAOS.emit('songLoaded', data);
        }

        function callMech(note, name, a, b) {
            if (!note.mech || typeof note.mech[name] !== 'function') return undefined;
            try {
                return note.mech[name](note, a, b);
            } catch (err) {
                console.error('[OKAOS] mecanica ' + note.tag + '.' + name, err);
                return undefined;
            }
        }

        function showLoadError() {
            ENGINE.ready = false;
            songTitle.textContent = 'Error al cargar la canción';
            songArt.src = '../img/logo.jpg';
        }

        function showNoSongState() {
            ENGINE.ready = false;
            songTitle.textContent = 'Sin canción seleccionada';
            songArt.src = '../img/logo.jpg';
        }

        const REFERENCE_TRACK_HEIGHT = 780;

        function measureColumns() {
            ENGINE.columnRects = trackColumns.map((col, i) => {
                const colRect = col.getBoundingClientRect();
                const recRect = receptors[i].getBoundingClientRect();
                const receptorY = (recRect.top + recRect.height / 2) - colRect.top;
                return { height: colRect.height, receptorY: receptorY };
            });
            const h = ENGINE.columnRects[0] ? ENGINE.columnRects[0].height : 0;
            if (h > 0) {
                const scale = h / REFERENCE_TRACK_HEIGHT;
                ENGINE.travelMs = Math.min(MAX_TRAVEL_MS, Math.max(MIN_TRAVEL_MS, ENGINE.baseTravelMs * scale));
                ENGINE.notes.forEach(n => {
                    n.travelMs = Math.min(MAX_TRAVEL_MS, Math.max(MIN_TRAVEL_MS, n.baseTravelMs * scale));
                });
            }
        }

        const columnResizeObserver = new ResizeObserver(() => measureColumns());
        columnResizeObserver.observe(tracksContainer);

        const HOLD_COLORS = ['#ff2a74', '#00f2fe', '#39ff14', '#ffb800'];

        function spawnNote(note) {
            const el = document.createElement('div');
            el.className = 'note ' + DIR_NOTE_CLASS[note.col];
            if (note.isBomb) el.classList.add('is-bomb');
            if (note.isRebound) el.classList.add('is-rebound');
            if (note.tag) {
                el.classList.add('tag-' + note.tag.replace(/[^a-z0-9_-]/g, ''));
                note.mech = OKAOS.mechanics.get(note.tag);
            }
            const arrow = document.createElement('div');
            arrow.className = 'arrow-icon ' + DIR_ARROW_CLASS[note.col];
            el.appendChild(arrow);
            trackColumns[note.col].appendChild(el);
            note.el = el;
            note.arrowEl = arrow;
            note.spawned = true;

            if (note.hold > 0) {
                const holdEl = document.createElement('div');
                holdEl.className = 'hold-bar';
                holdEl.style.background = HOLD_COLORS[note.col];
                trackColumns[note.col].appendChild(holdEl);
                note.holdEl = holdEl;
            }

            positionNote(note, 0);
            callMech(note, 'spawn', el);
            OKAOS.emit('spawn', note);
        }

        function applyCambio(note) {
            const oldCol = note.col;
            const newCol = note.cambio.col;
            if (note.el) {
                note.el.classList.remove(DIR_NOTE_CLASS[oldCol]);
                note.el.classList.add(DIR_NOTE_CLASS[newCol]);
                note.el.classList.remove('note-blink');
                void note.el.offsetWidth;
                note.el.classList.add('note-blink');
                trackColumns[newCol].appendChild(note.el);
            }
            if (note.arrowEl) {
                note.arrowEl.classList.remove(DIR_ARROW_CLASS[oldCol]);
                note.arrowEl.classList.add(DIR_ARROW_CLASS[newCol]);
            }
            if (note.holdEl) {
                note.holdEl.style.background = HOLD_COLORS[newCol];
                trackColumns[newCol].appendChild(note.holdEl);
            }
            note.col = newCol;
            note.cambio.applied = true;
        }

        function showLyricText(texto, duracion) {
            const span = document.createElement('span');
            span.textContent = texto;
            lyricOverlay.innerHTML = '';
            lyricOverlay.appendChild(span);
            requestAnimationFrame(() => span.classList.add('show'));
            setTimeout(() => {
                span.classList.remove('show');
                setTimeout(() => { if (lyricOverlay.contains(span)) span.remove(); }, 320);
            }, duracion);
        }

        function positionNote(note, progress) {
            const rect = ENGINE.columnRects[note.col];
            if (!rect || !note.el) return;
            const startY = document.body.classList.contains('arrows-bottom') ? 0 : rect.height;
            const y = startY + (rect.receptorY - startY) * progress;
            note.el.style.transform = 'translate3d(-50%, ' + y + 'px, 0)';
        }

        function updateHoldBar(note, nowMs) {
            if (!note.hold || !note.holdEl) return;
            const rect = ENGINE.columnRects[note.col];
            if (!rect) return;
            const startY = document.body.classList.contains('arrows-bottom') ? 0 : rect.height;

            if (note.holding) {
                const tailProgress = (nowMs - (note.time + note.hold - note.travelMs)) / note.travelMs;
                const tailY = startY + (rect.receptorY - startY) * tailProgress;
                const topY = Math.min(rect.receptorY, tailY);
                const heightPx = Math.abs(tailY - rect.receptorY);
                note.holdEl.style.transform = 'translate3d(-50%, ' + topY + 'px, 0)';
                note.holdEl.style.height = heightPx + 'px';
            } else {
                const headProgress = (nowMs - (note.time - note.travelMs)) / note.travelMs;
                const headY = startY + (rect.receptorY - startY) * Math.min(headProgress, 1.4);
                const tailProgress = (nowMs - (note.time + note.hold - note.travelMs)) / note.travelMs;
                const tailY = startY + (rect.receptorY - startY) * Math.min(tailProgress, 1.4);
                const topY = Math.min(headY, tailY);
                const heightPx = Math.abs(tailY - headY);
                note.holdEl.style.transform = 'translate3d(-50%, ' + topY + 'px, 0)';
                note.holdEl.style.height = heightPx + 'px';
            }
        }

        function resolveNote(note, isMiss) {
            if (note.judged) return;
            note.judged = true;
            note.holding = false;
            removeReboundGhost(note);
            if (isMiss && callMech(note, 'miss') !== true) triggerMiss(note);

            if (note.holdEl) {
                const holdEl = note.holdEl;
                holdEl.style.transition = 'opacity ' + EXIT_FADE_MS + 'ms ease-out';
                holdEl.style.opacity = '0';
                setTimeout(() => {
                    holdEl.remove();
                    if (note.holdEl === holdEl) note.holdEl = null;
                }, EXIT_FADE_MS + 60);
            }

            const el = note.el;
            if (!el) return;

            const rect = ENGINE.columnRects[note.col];
            const bottomMode = document.body.classList.contains('arrows-bottom');
            const exitY = rect
                ? (bottomMode ? (rect.receptorY + rect.height * 0.35 + 90) : (rect.receptorY - rect.height * 0.35 - 90))
                : (bottomMode ? 90 : -90);
            el.style.transition = 'transform ' + EXIT_FADE_MS + 'ms ease-out, opacity ' + EXIT_FADE_MS + 'ms ease-out';
            el.style.transform = 'translate3d(-50%, ' + exitY + 'px, 0)';
            el.style.opacity = '0';

            note.fadeTimeoutId = setTimeout(() => {
                el.remove();
                if (note.el === el) note.el = null;
                note.fadeTimeoutId = null;
            }, EXIT_FADE_MS + 60);
        }

        function clearNoteImmediately(note) {
            if (note.fadeTimeoutId) {
                clearTimeout(note.fadeTimeoutId);
                note.fadeTimeoutId = null;
            }
            if (note.el) {
                note.el.remove();
                note.el = null;
            }
            if (note.holdEl) {
                note.holdEl.remove();
                note.holdEl = null;
            }
            removeReboundGhost(note);
            note.holding = false;
            note.judged = true;
        }

        function getNowMs() {
            if (ENGINE.audioStarted) {
                return bgMusic.currentTime * 1000 + ENGINE.offsetMs;
            }
            const elapsed = performance.now() - ENGINE.clockStartPerf - ENGINE.totalPausedMs;
            return elapsed - ENGINE.travelMs + ENGINE.offsetMs;
        }

        function gameLoop() {
            if (!state.isPlaying || state.isPaused) {
                ENGINE.rafId = requestAnimationFrame(gameLoop);
                return;
            }

            measureColumns();
            const nowMs = getNowMs();
            OKAOS.emit('frame', nowMs);

            if (!ENGINE.audioStarted && nowMs >= 0) {
                ENGINE.audioStarted = true;
                bgMusic.currentTime = 0;
                bgMusic.play().catch(() => {});
            }

            for (const t of ENGINE.textos) {
                if (!t.shown && nowMs >= t.time) {
                    t.shown = true;
                    showLyricText(t.texto, t.duracion);
                }
            }

            for (const note of ENGINE.notes) {
                if (note.judged && !note.el) continue;
                const spawnAt = note.time - note.travelMs;
                if (!note.spawned && nowMs >= spawnAt) {
                    spawnNote(note);
                }
                if (note.spawned && note.el && !note.judged) {
                    callMech(note, 'update', nowMs);
                    if (note.cambio && !note.cambio.applied && nowMs >= note.cambio.time && nowMs < note.time) {
                        applyCambio(note);
                    }
                    if (note.isRebound && note.reboundStage === 1) {
                        positionRebound(note, nowMs);
                        if (nowMs >= note.reboundSecondTime + REBOUND_SECOND_WINDOW) {
                            resolveNote(note, true);
                        }
                        continue;
                    }
                    if (note.holding) {
                        if (nowMs >= note.time + note.hold) {
                            completeHold(note, note.col);
                        } else {
                            updateHoldBar(note, nowMs);
                        }
                    } else {
                        const progress = (nowMs - spawnAt) / note.travelMs;
                        positionNote(note, Math.min(progress, 1.4));
                        if (note.hold > 0) updateHoldBar(note, nowMs);
                        if (!ENGINE.frozenInput && nowMs - note.time > ENGINE.hitWindows.okay) {
                            resolveNote(note, !note.isBomb);
                        }
                    }
                }
            }

            ENGINE.rafId = requestAnimationFrame(gameLoop);
        }

        bgMusic.addEventListener('ended', () => {
            if (state.isPlaying) endGame(true);
        });

        [btnNormal, btnRecovery, btnNoLives].forEach(btn => {
            btn.addEventListener('click', () => {
                if (!ENGINE.ready) return;
                playClick();
                btn.classList.add('selected-active');
                setTimeout(() => {
                    btn.classList.remove('selected-active');
                    lobbyViewport.style.display = 'none';
                    gameViewport.classList.add('active');

                    if (btn === btnNormal) {
                        state.mode = 'normal';
                        state.lives = 3;
                        state.maxLives = 3;
                        updateHeartsUI();
                        heartsContainer.style.display = 'flex';
                        barContainer.classList.remove('visible');
                    } else if (btn === btnRecovery) {
                        state.mode = 'recovery';
                        state.recoveryHealth = 50;
                        updateBarUI();
                        heartsContainer.style.display = 'none';
                        barContainer.classList.add('visible');
                    } else {
                        state.mode = 'nolives';
                        heartsContainer.style.display = 'none';
                        barContainer.classList.remove('visible');
                    }
                    startCountdown();
                }, 400);
            });
        });

        btnExit.addEventListener('click', () => {
            playClick();
            btnExit.classList.add('selected-active');
            setTimeout(() => {
                btnExit.classList.remove('selected-active');
                goTo("../");
            }, 1000);
        });

        btnSettings.addEventListener('click', () => {
            playClick();
            btnSettings.classList.add('selected-active');
            setTimeout(() => {
                btnSettings.classList.remove('selected-active');
                goTo("../sc/play.html");
            }, 1000);
        });

        btnPauseExit.addEventListener('click', () => {
            playClick();
            btnPauseExit.classList.add('selected-active');
            setTimeout(() => {
                btnPauseExit.classList.remove('selected-active');
                goTo("../");
            }, 1000);
        });

        btnEndRetry.addEventListener('click', () => {
            playClick();
            btnEndRetry.classList.add('selected-active');
            setTimeout(() => {
                btnEndRetry.classList.remove('selected-active');
                endViewport.classList.remove('active');
                startCountdown();
            }, 400);
        });

        btnEndSongs.addEventListener('click', () => {
            playClick();
            btnEndSongs.classList.add('selected-active');
            setTimeout(() => {
                btnEndSongs.classList.remove('selected-active');
                goTo("../sc/play.html");
            }, 1000);
        });

        btnEndExit.addEventListener('click', () => {
            playClick();
            btnEndExit.classList.add('selected-active');
            setTimeout(() => {
                btnEndExit.classList.remove('selected-active');
                goTo("../");
            }, 1000);
        });

        pauseTrigger.addEventListener('click', () => {
            playClick();
            togglePause();
        });

        pauseTrigger.addEventListener('touchstart', (e) => {
            e.stopPropagation();
            e.preventDefault();
            playClick();
            togglePause();
        }, { passive: false });

        window.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' || e.key === 'Esc') {
                if (gameViewport.classList.contains('active') && !endViewport.classList.contains('active') && countdownOverlay.style.display !== 'flex') {
                    togglePause();
                }
            }
        });

        btnResume.addEventListener('click', () => {
            playClick();
            btnResume.classList.add('selected-active');
            setTimeout(() => {
                btnResume.classList.remove('selected-active');
                togglePause();
            }, 400);
        });

        btnRestart.addEventListener('click', () => {
            playClick();
            btnRestart.classList.add('selected-active');
            setTimeout(() => {
                btnRestart.classList.remove('selected-active');
                pauseViewport.classList.remove('active');
                state.isPaused = false;
                startCountdown();
            }, 400);
        });

        function togglePause() {
            if (!state.isPlaying && !state.isPaused) return;
            if (!state.isPaused) {
                state.isPaused = true;
                state.isPlaying = false;
                if (ENGINE.audioStarted) {
                    bgMusic.pause();
                } else {
                    ENGINE.pauseStartedAt = performance.now();
                }
                if (bgVideo.style.display !== 'none') bgVideo.pause();
                pauseScore.textContent = String(state.score).padStart(6, '0');
                pausePerfects.textContent = `x${state.perfects}`;
                pauseCombo.textContent = state.maxCombo;
                pauseViewport.classList.add('active');
                OKAOS.emit('pause', null);
            } else {
                pauseViewport.classList.remove('active');
                state.isPaused = false;
                state.isPlaying = true;
                OKAOS.emit('resume', null);
                if (ENGINE.audioStarted) {
                    bgMusic.play().catch(() => {});
                } else {
                    ENGINE.totalPausedMs += performance.now() - ENGINE.pauseStartedAt;
                }
                if (bgVideo.style.display !== 'none' && ENGINE.audioStarted) bgVideo.play().catch(() => {});
            }
        }

        function updateHeartsUI() {
            const icons = heartsContainer.querySelectorAll('.heart-icon');
            icons.forEach((icon, i) => {
                if (i < state.lives) {
                    icon.style.opacity = '1';
                } else {
                    icon.style.opacity = '0.2';
                }
            });
        }

        function updateBarUI() {
            barFill.style.width = `${state.recoveryHealth}%`;
        }

        function startCountdown() {
            if (ENGINE.rafId) {
                cancelAnimationFrame(ENGINE.rafId);
                ENGINE.rafId = null;
            }
            bgMusic.pause();
            bgMusic.currentTime = 0;
            ENGINE.audioStarted = false;
            ENGINE.totalPausedMs = 0;
            ENGINE.pauseStartedAt = 0;

            if (bgVideo.style.display !== 'none') {
                bgVideo.pause();
                bgVideo.currentTime = 0;
            }

            ENGINE.notes.forEach(n => clearNoteImmediately(n));
            ENGINE.notes.forEach(n => {
                n.spawned = false;
                n.judged = false;
                n.holding = false;
                n.reboundStage = 0;
                n.reboundSecondTime = 0;
                n.reboundStartTime = 0;
                if (n.cambio) n.cambio.applied = false;
            });
            ENGINE.textos.forEach(t => { t.shown = false; });
            state.holdingNote = [null, null, null, null];
            ENGINE.frozenInput = false;
            document.body.classList.remove('slow-mo');

            state.isPlaying = false;
            state.isPaused = false;
            state.score = 0;
            state.perfects = 0;
            state.commons = 0;
            state.okays = 0;
            state.misses = 0;
            state.currentCombo = 0;
            state.maxCombo = 0;

            if (state.mode === 'normal') {
                state.lives = 3;
                updateHeartsUI();
            } else if (state.mode === 'recovery') {
                state.recoveryHealth = 50;
                updateBarUI();
            }

            scoreEl.textContent = '000000';
            perfectValueEl.textContent = 'x0';
            commonValueEl.textContent = 'x0';
            okayValueEl.textContent = 'x0';
            missValueEl.textContent = 'x0';
            ratingEl.className = 'rating';

            OKAOS.emit('countdown', null);
            countdownOverlay.style.display = 'flex';
            let count = 3;

            function runStep() {
                if (count > 0) {
                    countdownText.textContent = count;
                } else if (count === 0) {
                    countdownText.textContent = "¡Go!";
                } else {
                    countdownOverlay.style.display = 'none';
                    startGame();
                    return;
                }

                countdownText.classList.remove('pop');
                void countdownText.offsetWidth;
                countdownText.classList.add('pop');

                count--;
                setTimeout(runStep, 1000);
            }

            runStep();
        }

        function startGame() {
            state.isPlaying = true;
            measureColumns();
            bgMusic.pause();
            bgMusic.currentTime = 0;
            bgMusic.volume = Math.max(0, Math.min(1, ENGINE.masterVol * ENGINE.bgmVol));
            bgMusic.playbackRate = ENGINE.musicSpeed;
            ENGINE.audioStarted = false;
            ENGINE.totalPausedMs = 0;
            ENGINE.pauseStartedAt = 0;
            ENGINE.clockStartPerf = performance.now();

            if (bgVideo.style.display !== 'none') {
                bgVideo.currentTime = 0;
                bgVideo.play().catch(() => {});
            }

            setupInput();
            ENGINE.rafId = requestAnimationFrame(gameLoop);
            OKAOS.emit('start', null);
        }

        function triggerHit(col, rating, note, isHold) {
            OKAOS.emit('hit', { col: col, rating: rating, note: note, hold: !!isHold });
            receptors[col].classList.add('active');
            if (!isHold) {
                setTimeout(() => receptors[col].classList.remove('active'), 80);
            }
            triggerVibration(18);

            let points = 0;
            if (rating === 'PERFECT') {
                points = 100;
                state.perfects += 1;
                perfectValueEl.textContent = `x${state.perfects}`;
                perfectCounterEl.classList.remove('jump');
                void perfectCounterEl.offsetWidth;
                perfectCounterEl.classList.add('jump');
                if (state.mode === 'recovery') {
                    const lifeGain = note ? note.lifePerfect : ENGINE.defaultLifePerfect;
                    state.recoveryHealth = Math.min(100, state.recoveryHealth + lifeGain);
                    updateBarUI();
                }
            } else if (rating === 'COMUN') {
                points = 50;
                state.commons += 1;
                commonValueEl.textContent = `x${state.commons}`;
                commonCounterEl.classList.remove('jump');
                void commonCounterEl.offsetWidth;
                commonCounterEl.classList.add('jump');
                if (state.mode === 'recovery') {
                    const lifeGain = note ? note.lifeComun : ENGINE.defaultLifeComun;
                    state.recoveryHealth = Math.min(100, state.recoveryHealth + lifeGain);
                    updateBarUI();
                }
            } else if (rating === 'OKAY') {
                points = 20;
                state.okays += 1;
                okayValueEl.textContent = `x${state.okays}`;
                okayCounterEl.classList.remove('jump');
                void okayCounterEl.offsetWidth;
                okayCounterEl.classList.add('jump');
                if (state.mode === 'recovery') {
                    const lifeGain = note ? note.lifeOkey : ENGINE.defaultLifeOkay;
                    state.recoveryHealth = Math.min(100, state.recoveryHealth + lifeGain);
                    updateBarUI();
                }
            }

            state.score += points;
            scoreEl.textContent = String(state.score).padStart(6, '0');
            state.currentCombo += 1;
            if (state.currentCombo > state.maxCombo) {
                state.maxCombo = state.currentCombo;
            }

            ratingEl.textContent = rating;
            ratingEl.className = 'rating pop';
            if (rating === 'PERFECT') ratingEl.style.color = '#ffe600';
            else if (rating === 'COMUN') ratingEl.style.color = '#00f2fe';
            else if (rating === 'OKAY') ratingEl.style.color = '#39ff14';

            setTimeout(() => ratingEl.classList.remove('pop'), 100);
        }

        function triggerMiss(note) {
            OKAOS.emit('miss', note);
            triggerVibration(40);
            state.currentCombo = 0;
            state.misses += 1;
            missValueEl.textContent = `x${state.misses}`;
            missCounterEl.classList.remove('jump');
            void missCounterEl.offsetWidth;
            missCounterEl.classList.add('jump');

            ratingEl.textContent = 'MISS';
            ratingEl.style.color = '#ff2a74';
            ratingEl.className = 'rating pop';
            setTimeout(() => ratingEl.classList.remove('pop'), 100);

            if (state.mode === 'normal') {
                state.lives--;
                updateHeartsUI();
                if (state.lives <= 0) {
                    endGame(false);
                }
            } else if (state.mode === 'recovery') {
                let damage = note ? note.damage : ENGINE.defaultDamage;
                if (note && note.hold > 0) {
                    damage += Math.round(note.hold / 100);
                }
                state.recoveryHealth = Math.max(0, state.recoveryHealth - damage);
                updateBarUI();
                if (state.recoveryHealth <= 0) {
                    endGame(false);
                }
            }
        }

        const STATS_KEY = 'okaosStats';

        function loadAllStats() {
            try {
                return JSON.parse(localStorage.getItem(STATS_KEY) || '{}');
            } catch (err) {
                return {};
            }
        }

        function saveSongResult(result) {
            const songId = ENGINE.songData && ENGINE.songData.id;
            if (!songId) return;
            const all = loadAllStats();
            if (!all[songId]) all[songId] = { plays: 0, modes: {} };
            if (!all[songId].modes) all[songId].modes = {};
            const previous = all[songId].modes[state.mode];
            if (!previous || result.score >= previous.score) {
                all[songId].modes[state.mode] = result;
            }
            localStorage.setItem(STATS_KEY, JSON.stringify(all));
        }

        function endGame(isWin) {
            if (!state.isPlaying && !state.isPaused) return;
            state.isPlaying = false;
            state.isPaused = false;
            window.onkeydown = null;
            if (ENGINE.rafId) {
                cancelAnimationFrame(ENGINE.rafId);
                ENGINE.rafId = null;
            }
            bgMusic.pause();
            if (bgVideo.style.display !== 'none') bgVideo.pause();
            ENGINE.notes.forEach(n => clearNoteImmediately(n));

            const totalNotes = ENGINE.notes.length;
            const maxScore = totalNotes * 100;
            const accuracy = maxScore > 0 ? state.score / maxScore : 0;
            const fullPerfect = totalNotes > 0 && state.perfects === totalNotes && state.commons === 0 && state.okays === 0 && state.misses === 0;
            const noMisses = state.misses === 0;

            let stars = 0;
            if (state.mode === 'normal' || state.mode === 'recovery') {
                if (isWin) stars = 1;
                if (isWin && noMisses) stars = 2;
                if (isWin && fullPerfect) stars = 3;
            }

            let rank = 'F';
            if (isWin) {
                if (fullPerfect) rank = 'SSS';
                else if (accuracy >= 0.9 && noMisses) rank = 'SS';
                else if (accuracy >= 0.8) rank = 'S';
                else if (accuracy >= 0.65) rank = 'A';
                else if (accuracy >= 0.5) rank = 'B';
                else if (accuracy >= 0.35) rank = 'C';
                else if (accuracy >= 0.15) rank = 'D';
                else rank = 'F';
            } else {
                if (accuracy >= 0.65) rank = 'A';
                else if (accuracy >= 0.5) rank = 'B';
                else if (accuracy >= 0.35) rank = 'C';
                else if (accuracy >= 0.15) rank = 'D';
                else rank = 'F';
            }

            endTitle.textContent = isWin ? '¡Victoria!' : 'Fin de Partida';
            endTitle.className = isWin ? 'end-title win' : 'end-title lose';
            resultsStatus.textContent = isWin ? 'Completado' : 'Fallado';

            OKAOS.emit('end', { win: isWin, rank: rank, stars: stars, score: state.score, maxCombo: state.maxCombo, mode: state.mode });

            saveSongResult({
                score: state.score,
                maxCombo: state.maxCombo,
                perfects: state.perfects,
                commons: state.commons,
                okays: state.okays,
                misses: state.misses,
                rank: rank,
                completed: isWin,
                stars: state.mode === 'nolives' ? null : stars
            });

            rankImg.src = RANK_IMAGES[rank];
            rankImg.classList.remove('pop-in');
            void rankImg.offsetWidth;
            rankImg.classList.add('pop-in');

            endScore.textContent = String(state.score).padStart(6, '0');
            endPerfects.textContent = `x${state.perfects}`;
            endCombo.textContent = state.maxCombo;

            const starEls = [star1, star2, star3];
            starEls.forEach(el => {
                el.classList.remove('active', 'pop-in');
                void el.offsetWidth;
            });

            if (state.mode === 'nolives') {
                starEls.forEach(el => {
                    el.style.display = 'none';
                });
            } else {
                starEls.forEach((el, i) => {
                    el.style.display = 'block';
                    if (i < stars) el.classList.add('active');
                    setTimeout(() => {
                        el.classList.add('pop-in');
                    }, 250 + i * 180);
                });
            }

            endViewport.classList.add('active');
        }

        function spawnBombEffect(colIndex) {
            const rect = ENGINE.columnRects[colIndex];
            const y = rect ? rect.receptorY : 0;
            const blast = document.createElement('div');
            blast.className = 'bomb-blast';
            blast.style.transform = 'translate3d(-50%, ' + y + 'px, 0)';
            trackColumns[colIndex].appendChild(blast);
            setTimeout(() => blast.remove(), 500);
        }

        function triggerBombHit(colIndex, note) {
            resolveNote(note, false);
            receptors[colIndex].classList.add('active');
            setTimeout(() => receptors[colIndex].classList.remove('active'), 80);
            spawnBombEffect(colIndex);
            triggerVibration(90);
            ENGINE.frozenInput = true;
            document.body.classList.add('slow-mo');
            bgMusic.playbackRate = BOMB_SLOWMO_RATE;
            setTimeout(() => {
                if (state.mode === 'normal' || state.mode === 'recovery') {
                    endGame(false);
                } else {
                    document.body.classList.remove('slow-mo');
                    bgMusic.playbackRate = ENGINE.musicSpeed;
                    ENGINE.frozenInput = false;
                }
            }, BOMB_END_DELAY_MS);
        }

        function removeReboundGhost(note) {
            if (note.ghostEl) {
                note.ghostEl.remove();
                note.ghostEl = null;
            }
        }

        function createReboundGhost(note) {
            removeReboundGhost(note);
            const rect = ENGINE.columnRects[note.col];
            const ghost = document.createElement('div');
            ghost.className = 'note ' + DIR_NOTE_CLASS[note.col] + ' rebound-ghost';
            const arrow = document.createElement('div');
            arrow.className = 'arrow-icon ' + DIR_ARROW_CLASS[note.col];
            ghost.appendChild(arrow);
            ghost.style.transform = 'translate3d(-50%, ' + (rect ? rect.receptorY : 0) + 'px, 0)';
            trackColumns[note.col].appendChild(ghost);
            note.ghostEl = ghost;
        }

        function positionRebound(note, nowMs) {
            const rect = ENGINE.columnRects[note.col];
            if (!rect || !note.el) return;
            const bottomMode = document.body.classList.contains('arrows-bottom');
            const space = bottomMode ? rect.receptorY : rect.height - rect.receptorY;
            const arcPx = Math.max(0, Math.min(REBOUND_ARC_PX, space * 0.8));
            const p = Math.min(Math.max((nowMs - note.reboundStartTime) / REBOUND_SECOND_DELAY, 0), 1);
            const arc = 4 * p * (1 - p);
            const y = rect.receptorY + (bottomMode ? -1 : 1) * arcPx * arc;
            note.el.style.transform = 'translate3d(-50%, ' + y + 'px, 0) scale(' + (1 - 0.15 * arc) + ')';
        }

        function triggerRebound(colIndex, note, nowMs) {
            note.reboundStage = 1;
            note.reboundStartTime = nowMs;
            note.reboundSecondTime = nowMs + REBOUND_SECOND_DELAY;
            receptors[colIndex].classList.add('active');
            setTimeout(() => receptors[colIndex].classList.remove('active'), 80);
            triggerVibration(14);
            if (note.el) {
                note.el.style.transition = 'none';
                positionRebound(note, nowMs);
            }
            createReboundGhost(note);
        }

        function handleColumnHit(colIndex) {
            if (!state.isPlaying || state.isPaused || ENGINE.frozenInput) return;

            const nowMs = getNowMs();
            let target = null;
            let bestDelta = Infinity;
            let targetIsSecondStage = false;

            for (const note of ENGINE.notes) {
                if (note.judged || note.col !== colIndex || !note.spawned) continue;
                if (note.isRebound && note.reboundStage === 1) {
                    const delta = Math.abs(nowMs - note.reboundSecondTime);
                    if (delta <= REBOUND_SECOND_WINDOW && delta < bestDelta) {
                        bestDelta = delta;
                        target = note;
                        targetIsSecondStage = true;
                    }
                } else {
                    const delta = Math.abs(nowMs - note.time);
                    if (delta <= ENGINE.hitWindows.okay && delta < bestDelta) {
                        bestDelta = delta;
                        target = note;
                        targetIsSecondStage = false;
                    }
                }
            }

            if (!target) {
                receptors[colIndex].classList.add('active');
                setTimeout(() => receptors[colIndex].classList.remove('active'), 80);
                return;
            }

            if (target.mech && callMech(target, 'hit', { col: colIndex, delta: bestDelta, nowMs: nowMs }) === true) return;

            if (target.isBomb) {
                triggerBombHit(colIndex, target);
                return;
            }

            if (target.isRebound && !targetIsSecondStage) {
                triggerRebound(colIndex, target, nowMs);
                return;
            }

            let rating = 'OKAY';
            if (bestDelta <= ENGINE.hitWindows.perfect) rating = 'PERFECT';
            else if (bestDelta <= ENGINE.hitWindows.comun) rating = 'COMUN';

            if (target.hold > 0) {
                target.holding = true;
                state.holdingNote[colIndex] = target;
                if (target.el) target.el.classList.add('hidden');
                if (target.holdEl) target.holdEl.classList.add('holding');
                triggerHit(colIndex, rating, target, true);
            } else {
                triggerHit(colIndex, rating, target, false);
                resolveNote(target, false);
            }
        }

        const HOLD_RELEASE_TOLERANCE = 90;

        function completeHold(note, colIndex) {
            if (note.judged) return;
            state.holdingNote[colIndex] = null;
            receptors[colIndex].classList.remove('active');
            resolveNote(note, false);
        }

        function failHold(note, colIndex) {
            if (note.judged) return;
            state.holdingNote[colIndex] = null;
            receptors[colIndex].classList.remove('active');
            resolveNote(note, true);
        }

        function handleColumnRelease(colIndex) {
            if (!state.isPlaying || state.isPaused || ENGINE.frozenInput) return;
            const note = state.holdingNote[colIndex];
            if (!note) return;
            const nowMs = getNowMs();
            if (nowMs >= note.time + note.hold - HOLD_RELEASE_TOLERANCE) {
                completeHold(note, colIndex);
            } else {
                failHold(note, colIndex);
            }
        }

        function setupInput() {
            window.onkeydown = (e) => {
                if (!state.isPlaying || state.isPaused) {
                    if (e.key === 'Escape' || e.key === 'Esc') {
                        togglePause();
                    }
                    return;
                }

                if (e.key === 'Escape' || e.key === 'Esc') {
                    togglePause();
                    return;
                }

                let keyStr = e.key.toUpperCase();
                if (keyStr === ' ') keyStr = 'SPACE';
                if (keyStr === 'ARROWLEFT') keyStr = '←';
                if (keyStr === 'ARROWRIGHT') keyStr = '→';
                if (keyStr === 'ARROWUP') keyStr = '↑';
                if (keyStr === 'ARROWDOWN') keyStr = '↓';

                const keyIndex = state.userKeys.indexOf(keyStr);
                if (keyIndex !== -1) {
                    handleColumnHit(keyIndex);
                }
            };

            window.onkeyup = (e) => {
                if (!state.isPlaying || state.isPaused) return;
                let keyStr = e.key.toUpperCase();
                if (keyStr === ' ') keyStr = 'SPACE';
                if (keyStr === 'ARROWLEFT') keyStr = '←';
                if (keyStr === 'ARROWRIGHT') keyStr = '→';
                if (keyStr === 'ARROWUP') keyStr = '↑';
                if (keyStr === 'ARROWDOWN') keyStr = '↓';
                const keyIndex = state.userKeys.indexOf(keyStr);
                if (keyIndex !== -1) {
                    handleColumnRelease(keyIndex);
                }
            };

            const processTouchEnd = (e) => {
                if (!state.isPlaying || state.isPaused) return;
                const fullWidth = window.innerWidth;
                const colWidth = fullWidth / 4;
                for (let i = 0; i < e.changedTouches.length; i++) {
                    const touch = e.changedTouches[i];
                    if (touch.clientY < 60) continue;
                    const colIndex = Math.min(3, Math.max(0, Math.floor(touch.clientX / colWidth)));
                    handleColumnRelease(colIndex);
                }
            };

            document.body.addEventListener('touchend', processTouchEnd, { passive: true });
            document.body.addEventListener('touchcancel', processTouchEnd, { passive: true });

            const processTouch = (e) => {
                if (!state.isPlaying || state.isPaused) return;
                const fullWidth = window.innerWidth;
                const colWidth = fullWidth / 4;

                for (let i = 0; i < e.changedTouches.length; i++) {
                    const touch = e.changedTouches[i];
                    if (touch.clientY < 60) continue;
                    const touchX = touch.clientX;
                    const colIndex = Math.min(3, Math.max(0, Math.floor(touchX / colWidth)));
                    handleColumnHit(colIndex);
                }
            };

            document.body.addEventListener('touchstart', (e) => {
                if (!state.isPlaying || state.isPaused) return;
                if (e.target.closest('.top-navbar')) return;
                e.preventDefault();
                processTouch(e);
            }, { passive: false });
        }

        function pauseOnOrientationChange() {
            if (state.isPlaying && !state.isPaused) {
                togglePause();
            }
        }

        window.addEventListener('orientationchange', pauseOnOrientationChange);
        if (window.matchMedia) {
            const orientationQuery = window.matchMedia('(orientation: portrait)');
            if (orientationQuery.addEventListener) {
                orientationQuery.addEventListener('change', pauseOnOrientationChange);
            } else if (orientationQuery.addListener) {
                orientationQuery.addListener(pauseOnOrientationChange);
            }
        }

        OKAOS.game = {
            state: state,
            ENGINE: ENGINE,
            elements: {
                lobby: lobbyViewport,
                game: gameViewport,
                pause: pauseViewport,
                end: endViewport,
                tracks: trackColumns,
                receptors: receptors
            },
            getNowMs: getNowMs,
            triggerHit: triggerHit,
            triggerMiss: triggerMiss,
            resolveNote: resolveNote,
            endGame: endGame,
            togglePause: togglePause,
            applySettings: applyGameSettings
        };

        applyGameSettings();
        OKAOS.ready.then(initEngine);
