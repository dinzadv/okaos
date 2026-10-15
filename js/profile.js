const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

        let tempAvatarBase64 = null;
        let tempBannerBase64 = null;

        function compressImage(file, maxWidth, maxHeight, quality, callback) {
            const reader = new FileReader();
            reader.readAsDataURL(file);
            reader.onload = function(event) {
                const img = new Image();
                img.src = event.target.result;
                img.onload = function() {
                    let width = img.width;
                    let height = img.height;

                    if (width > height) {
                        if (width > maxWidth) {
                            height = Math.round((height * maxWidth) / width);
                            width = maxWidth;
                        }
                    } else {
                        if (height > maxHeight) {
                            width = Math.round((width * maxHeight) / height);
                            height = maxHeight;
                        }
                    }

                    const canvas = document.createElement('canvas');
                    canvas.width = width;
                    canvas.height = height;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0, width, height);

                    const compressedBase64 = canvas.toDataURL('image/jpeg', quality);
                    callback(compressedBase64);
                };
            };
        }

        function safeLocalStorageSet(key, value) {
            try {
                localStorage.setItem(key, value);
            } catch (e) {
                console.warn('Storage limit reached, attempting cleanup...');
                try {
                    localStorage.removeItem('okaos_banner');
                    localStorage.setItem(key, value);
                } catch (err) {
                    console.error('Failed to save to localStorage:', err);
                }
            }
        }

        const STATS_KEY = 'okaosStats';
        const MODE_LABELS = { normal: 'Normal', recovery: 'Recuperación', nolives: 'Sin Vidas' };
        const RANK_IMAGES = {
            SSS: '../img/assets/ranks/sss.png',
            SS: '../img/assets/ranks/ss.png',
            S: '../img/assets/ranks/s.png',
            A: '../img/assets/ranks/a.png',
            B: '../img/assets/ranks/b.png',
            C: '../img/assets/ranks/c.png',
            D: '../img/assets/ranks/d.png',
            F: '../img/assets/ranks/f.png'
        };
        const RANK_ORDER = ['SSS', 'SS', 'S', 'A', 'B', 'C', 'D', 'F'];
        function xpRequiredForLevel(level) {
            return Math.round(300 + (level - 1) * 120 + (level - 1) * (level - 1) * 18);
        }

        function computeLevelProgress(totalXP) {
            let level = 1;
            let remaining = totalXP;
            let req = xpRequiredForLevel(level);
            while (remaining >= req) {
                remaining -= req;
                level++;
                req = xpRequiredForLevel(level);
            }
            return { level: level, currentXP: remaining, neededXP: req };
        }

        function loadLibrary() {
            try {
                return JSON.parse(localStorage.getItem('mySongs') || '[]');
            } catch (err) {
                return [];
            }
        }

        function loadStats() {
            try {
                return JSON.parse(localStorage.getItem(STATS_KEY) || '{}');
            } catch (err) {
                return {};
            }
        }

        function computeProfileStats() {
            const library = loadLibrary();
            const stats = loadStats();
            const songMap = {};
            library.forEach(s => { songMap[s.id] = s; });

            const rankCounts = { SSS: 0, SS: 0, S: 0, A: 0, B: 0, C: 0, D: 0, F: 0 };
            let totalPlays = 0;
            let totalScore = 0;
            let maxCombo = 0;
            let totalHits = 0;
            let totalMisses = 0;
            let songsWithRecord = 0;
            let bestRankIndex = RANK_ORDER.length;
            let completedCount = 0;
            let sssCount = 0;
            const songEntries = [];

            Object.keys(stats).forEach(songId => {
                const entry = stats[songId] || {};
                totalPlays += entry.plays || 0;
                const modes = entry.modes || {};
                const modeKeys = Object.keys(modes);
                if (modeKeys.length > 0) {
                    songsWithRecord++;
                    songEntries.push({ songId: songId, song: songMap[songId], modes: modes });
                }
                modeKeys.forEach(mode => {
                    const r = modes[mode];
                    totalScore += r.score || 0;
                    if ((r.maxCombo || 0) > maxCombo) maxCombo = r.maxCombo;
                    totalHits += (r.perfects || 0) + (r.commons || 0) + (r.okays || 0);
                    totalMisses += r.misses || 0;
                    if (r.rank && rankCounts.hasOwnProperty(r.rank)) rankCounts[r.rank]++;
                    if (r.rank === 'SSS') sssCount++;
                    if (r.completed) completedCount++;
                    const idx = RANK_ORDER.indexOf(r.rank);
                    if (idx !== -1 && idx < bestRankIndex) bestRankIndex = idx;
                });
            });

            songEntries.sort((a, b) => {
                const bestA = Math.max(...Object.values(a.modes).map(m => m.score || 0));
                const bestB = Math.max(...Object.values(b.modes).map(m => m.score || 0));
                return bestB - bestA;
            });

            return {
                rankCounts: rankCounts,
                totalPlays: totalPlays,
                totalScore: totalScore,
                maxCombo: maxCombo,
                totalHits: totalHits,
                songsWithRecord: songsWithRecord,
                bestRank: bestRankIndex < RANK_ORDER.length ? RANK_ORDER[bestRankIndex] : null,
                accuracy: (totalHits + totalMisses) > 0 ? (totalHits / (totalHits + totalMisses)) * 100 : 0,
                songEntries: songEntries,
                completedCount: completedCount,
                sssCount: sssCount
            };
        }

        function buildModeMiniRowHTML(mode, result) {
            if (!result) {
                return `<div class="song-mode-row"><span class="song-mode-label">${MODE_LABELS[mode]}</span><span class="song-mode-empty">Sin registro</span></div>`;
            }
            let starsHTML = '';
            if (result.stars !== null && result.stars !== undefined) {
                starsHTML = '<div class="song-mode-stars">' + [1, 2, 3].map(i =>
                    `<img class="mini-star${i <= result.stars ? ' on' : ''}" src="../img/assets/star.png" alt="star">`
                ).join('') + '</div>';
            }
            return `
                <div class="song-mode-row">
                    <span class="song-mode-label">${MODE_LABELS[mode]}</span>
                    <img class="song-mode-rank" src="${RANK_IMAGES[result.rank] || RANK_IMAGES.F}" alt="${result.rank}">
                    <span class="song-mode-score">${String(result.score).padStart(6, '0')}</span>
                    ${starsHTML}
                </div>`;
        }

        function renderTopSongs(songEntries) {
            const list = document.getElementById('topRanksList');
            if (songEntries.length === 0) {
                list.innerHTML = '<div class="empty-state">Aún no hay partidas registradas.</div>';
                return;
            }
            list.innerHTML = songEntries.map(entry => {
                const song = entry.song || { nombre: 'Canción Desconocida' };
                const rows = ['normal', 'recovery', 'nolives'].map(mode => buildModeMiniRowHTML(mode, entry.modes[mode])).join('');
                return `
                    <div class="song-record-card">
                        <div class="song-record-header">
                            <img data-song-id="${entry.songId}" src="../img/logo.jpg" class="song-record-art" alt="">
                            <span class="song-record-name">${song.nombre}</span>
                        </div>
                        <div class="song-record-modes">${rows}</div>
                    </div>`;
            }).join('');

            hydrateThumbnails(list);
        }

        function renderMedals(d, level) {
            const medals = [
                { name: 'Primera Canción', img: '../img/assets/logros/m1.jpg', unlocked: d.totalPlays >= 1, desc: 'Juega cualquier canción por primera vez.' },
                { name: 'Primera Victoria', img: '../img/assets/logros/m2.jpg', unlocked: d.completedCount > 0, desc: 'Completa una partida en cualquier modo.' },
                { name: 'Combo x100', img: '../img/assets/logros/m3.jpg', unlocked: d.maxCombo >= 100, desc: 'Consigue un combo de 100 notas seguidas.' },
                { name: 'Rango S+', img: '../img/assets/logros/m4.jpg', unlocked: (d.rankCounts.S + d.rankCounts.SS + d.rankCounts.SSS) > 0, desc: 'Obtén un rango S, SS o SSS en cualquier canción.' },
                { name: 'Veterano', img: '../img/assets/logros/m5.jpg', unlocked: d.totalPlays >= 20, desc: 'Juega un total de 20 partidas.' },
                { name: 'Perfeccionista', img: '../img/assets/logros/m6.jpg', unlocked: d.sssCount > 0, desc: 'Consigue un rango SSS en cualquier canción.' },
                { name: 'Combo x300', img: '../img/assets/logros/m7.jpg', unlocked: d.maxCombo >= 300, desc: 'Consigue un combo de 300 notas seguidas.' },
                { name: 'Coleccionista', img: '../img/assets/logros/m8.jpg', unlocked: d.songsWithRecord >= 5, desc: 'Obtén un récord en 5 canciones diferentes.' },
                { name: 'Maestro', img: '../img/assets/logros/m9.jpg', unlocked: d.sssCount >= 10, desc: 'Consigue rango SSS en 10 canciones o modos.' },
                { name: 'Leyenda', img: '../img/assets/logros/m10.jpg', unlocked: level >= 10, desc: 'Alcanza el nivel 10 de tu perfil.' }
            ];
            currentMedalsData = medals;
            document.getElementById('medalsGrid').innerHTML = medals.map((m, i) => `
                <div class="medal-item${m.unlocked ? '' : ' locked'}" data-idx="${i}">
                    <div class="medal-hex-wrapper">
                        <svg class="medal-hex-svg" viewBox="0 0 100 100">
                            <polygon points="50,3 93,25 93,75 50,97 7,75 7,25" fill="none" stroke="#ffcc00" stroke-width="4" stroke-linejoin="round"/>
                        </svg>
                        <div class="medal-hex-clip-area">
                            <img src="${m.img}" class="medal-img-content" alt="${m.name}">
                        </div>
                    </div>
                    <span class="medal-name">${m.name}</span>
                </div>`).join('');
            document.getElementById('medalsCountText').textContent = `Medallas (${medals.filter(m => m.unlocked).length}/${medals.length})`;
        }

        function renderProfileStats() {
            const d = computeProfileStats();

            document.getElementById('rankValueBest').textContent = d.bestRank || '—';
            document.getElementById('rankValueSongs').textContent = d.songsWithRecord;

            document.getElementById('countSSS').textContent = d.rankCounts.SSS;
            document.getElementById('countSS').textContent = d.rankCounts.SS;
            document.getElementById('countS').textContent = d.rankCounts.S;
            document.getElementById('countA').textContent = d.rankCounts.A;
            document.getElementById('countB').textContent = d.rankCounts.B;

            document.getElementById('statPlays').textContent = d.totalPlays.toLocaleString('es-MX');
            document.getElementById('statTotalScore').textContent = d.totalScore.toLocaleString('es-MX');
            document.getElementById('statAccuracy').textContent = d.accuracy.toFixed(2) + '%';
            document.getElementById('statMaxCombo').textContent = d.maxCombo.toLocaleString('es-MX') + 'x';
            document.getElementById('statHits').textContent = d.totalHits.toLocaleString('es-MX');
            document.getElementById('statSongsRecord').textContent = d.songsWithRecord;

            const levelData = computeLevelProgress(d.totalScore);
            document.getElementById('levelText').textContent = levelData.level;
            document.getElementById('levelBarFill').style.width = Math.floor((levelData.currentXP / levelData.neededXP) * 100) + '%';
            document.getElementById('levelXpText').textContent = `${levelData.currentXP}/${levelData.neededXP} XP`;

            renderMedals(d, levelData.level);
            renderTopSongs(d.songEntries);
        }

        const TAGS_KEY = 'okaos_tags_visible';
        const FAV_SONGS_KEY = 'okaos_favorite_songs';
        let currentMedalsData = [];
        let openMedalIdx = null;
        let favSelectedIds = [];

        function loadTagsVisible() {
            try {
                return Object.assign({ vip: true, supporter: true, dev: true }, JSON.parse(localStorage.getItem(TAGS_KEY) || '{}'));
            } catch (err) {
                return { vip: true, supporter: true, dev: true };
            }
        }

        function renderBadges() {
            const v = loadTagsVisible();
            let html = '';
            if (v.vip) html += '<span class="badge-pill vip">VIP</span>';
            if (v.supporter) html += '<span class="badge-pill">SUPPORTER</span>';
            if (v.dev) html += '<span class="badge-pill dev">DEV</span>';
            document.getElementById('badgesGroup').innerHTML = html;
        }

        const thumbCache = new Map();

        function resolveThumb(songId) {
            if (typeof SONGS === 'undefined') return Promise.resolve(null);
            if (!thumbCache.has(songId)) {
                thumbCache.set(songId, SONGS.getThumbUrl(songId).catch(() => null));
            }
            return thumbCache.get(songId);
        }

        function hydrateThumbnails(root) {
            root.querySelectorAll('img[data-song-id]').forEach(img => {
                const songId = img.getAttribute('data-song-id');
                resolveThumb(songId).then(url => {
                    if (url) img.src = url;
                });
            });
        }

        function loadFavoriteSongIds() {
            try {
                return JSON.parse(localStorage.getItem(FAV_SONGS_KEY) || '[]');
            } catch (err) {
                return [];
            }
        }

        function renderFavoriteSongsDisplay() {
            const ids = loadFavoriteSongIds();
            const library = loadLibrary();
            const display = document.getElementById('favSongsDisplay');
            const songs = ids.map(id => library.find(s => s.id === id)).filter(Boolean);
            if (songs.length === 0) {
                display.innerHTML = '<div class="empty-state">Aún no has elegido canciones favoritas.</div>';
                return;
            }
            display.innerHTML = songs.map(s => `
                <div class="fav-display-row">
                    <img data-song-id="${s.id}" src="../img/logo.jpg" alt="">
                    <span>${s.nombre}</span>
                </div>`).join('');
            hydrateThumbnails(display);
        }

        function renderFavSelectedList() {
            const library = loadLibrary();
            const list = document.getElementById('favSelectedList');
            if (favSelectedIds.length === 0) {
                list.innerHTML = '<div class="empty-state">Ninguna seleccionada.</div>';
                return;
            }
            list.innerHTML = favSelectedIds.map(id => {
                const s = library.find(x => x.id === id) || { nombre: 'Desconocida', id: id };
                return `
                    <div class="fav-selected-row">
                        <img data-song-id="${s.id}" src="../img/logo.jpg" alt="">
                        <span>${s.nombre}</span>
                        <button type="button" class="fav-remove-btn" data-id="${id}">✕</button>
                    </div>`;
            }).join('');
            hydrateThumbnails(list);
        }

        function renderFavSearchResults(query) {
            const library = loadLibrary();
            const results = document.getElementById('favSearchResults');
            const q = query.trim().toLowerCase();
            const filtered = q ? library.filter(s => s.nombre.toLowerCase().includes(q)) : library;
            results.innerHTML = filtered.slice(0, 20).map(s => {
                const already = favSelectedIds.includes(s.id);
                const full = favSelectedIds.length >= 3 && !already;
                return `
                    <div class="fav-search-row${already || full ? ' disabled' : ''}" data-id="${s.id}">
                        <img data-song-id="${s.id}" src="../img/logo.jpg" alt="">
                        <span>${s.nombre}</span>
                    </div>`;
            }).join('');
            hydrateThumbnails(results);
        }

        document.getElementById('favSongSearch').addEventListener('input', (e) => {
            renderFavSearchResults(e.target.value);
        });

        document.getElementById('favSearchResults').addEventListener('click', (e) => {
            const row = e.target.closest('.fav-search-row');
            if (!row || row.classList.contains('disabled')) return;
            const id = row.dataset.id;
            if (favSelectedIds.length >= 3 || favSelectedIds.includes(id)) return;
            favSelectedIds.push(id);
            renderFavSelectedList();
            renderFavSearchResults(document.getElementById('favSongSearch').value);
        });

        document.getElementById('favSelectedList').addEventListener('click', (e) => {
            const btn = e.target.closest('.fav-remove-btn');
            if (!btn) return;
            favSelectedIds = favSelectedIds.filter(id => id !== btn.dataset.id);
            renderFavSelectedList();
            renderFavSearchResults(document.getElementById('favSongSearch').value);
        });

        function openMedalModal(idx) {
            const m = currentMedalsData[idx];
            if (!m) return;
            openMedalIdx = idx;
            document.getElementById('medalModalTitle').textContent = m.name;
            document.getElementById('medalModalDesc').textContent = m.desc;
            const statusEl = document.getElementById('medalModalStatus');
            statusEl.textContent = m.unlocked ? 'Desbloqueada' : 'Bloqueada';
            statusEl.className = 'medal-modal-status ' + (m.unlocked ? 'unlocked' : 'locked');
            document.getElementById('medalModalImgWrap').innerHTML = `<img src="${m.img}" class="${m.unlocked ? '' : 'locked-img'}" alt="${m.name}">`;
            document.getElementById('medalModal').classList.add('active');
        }

        function closeMedalModal() {
            openMedalIdx = null;
            document.getElementById('medalModal').classList.remove('active');
        }

        document.getElementById('medalsGrid').addEventListener('click', (e) => {
            const item = e.target.closest('.medal-item');
            if (!item) return;
            const idx = Number(item.dataset.idx);
            if (openMedalIdx === idx && document.getElementById('medalModal').classList.contains('active')) {
                closeMedalModal();
                return;
            }
            openMedalModal(idx);
        });

        document.getElementById('closeMedalModalBtn').addEventListener('click', closeMedalModal);

        function loadProfileData() {
            const savedName = localStorage.getItem('okaos_username');
            const savedCountry = localStorage.getItem('okaos_country');
            const savedFlag = localStorage.getItem('okaos_flag');
            const savedAvatar = localStorage.getItem('okaos_avatar');
            const savedBanner = localStorage.getItem('okaos_banner');

            if (savedName) {
                document.getElementById('userNameDisplay').textContent = savedName;
            } else {
                document.getElementById('userNameDisplay').textContent = `User[${Math.floor(100000 + Math.random() * 900000)}]`;
            }

            if (savedCountry) {
                document.getElementById('countryNameDisplay').textContent = savedCountry;
                const selectCountry = document.getElementById('selectCountry');
                for (let i = 0; i < selectCountry.options.length; i++) {
                    if (selectCountry.options[i].value.includes(savedCountry)) {
                        selectCountry.selectedIndex = i;
                        break;
                    }
                }
            }

            if (savedFlag) {
                document.getElementById('countryFlagImg').src = savedFlag;
            }

            if (savedAvatar) {
                document.getElementById('profileAvatar').src = savedAvatar;
            }

            if (savedBanner) {
                document.getElementById('profileBanner').style.backgroundImage = `url("${savedBanner}")`;
            }
        }

        function playClickSound() {
            if (audioCtx.state === 'suspended') {
                audioCtx.resume();
            }
            const osc = audioCtx.createOscillator();
            const gain = audioCtx.createGain();

            osc.type = 'sine';
            osc.frequency.setValueAtTime(600, audioCtx.currentTime);
            osc.frequency.exponentialRampToValueAtTime(1200, audioCtx.currentTime + 0.08);

            gain.gain.setValueAtTime(0.15, audioCtx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.08);

            osc.connect(gain);
            gain.connect(audioCtx.destination);

            osc.start();
            osc.stop(audioCtx.currentTime + 0.08);
        }

        document.getElementById('backBtn').addEventListener('click', () => {
            playClickSound();
        });

        const modal = document.getElementById('editModal');
        const settingsBtn = document.getElementById('settingsBtn');
        const closeModalBtn = document.getElementById('closeModalBtn');
        const saveProfileBtn = document.getElementById('saveProfileBtn');

        settingsBtn.addEventListener('click', () => {
            playClickSound();
            document.getElementById('inputUsername').value = document.getElementById('userNameDisplay').textContent;
            
            tempAvatarBase64 = null;
            tempBannerBase64 = null;

            document.getElementById('avatarFileName').textContent = "Seleccionar imagen...";
            document.getElementById('bannerFileName').textContent = "Seleccionar imagen...";

            document.getElementById('avatarPreviewContainer').style.display = 'none';
            document.getElementById('bannerPreviewContainer').style.display = 'none';

            const v = loadTagsVisible();
            document.getElementById('tagToggleVip').checked = v.vip;
            document.getElementById('tagToggleSupporter').checked = v.supporter;
            document.getElementById('tagToggleDev').checked = v.dev;

            favSelectedIds = loadFavoriteSongIds().slice();
            document.getElementById('favSongSearch').value = '';
            renderFavSelectedList();
            renderFavSearchResults('');

            modal.classList.add('active');
        });

        closeModalBtn.addEventListener('click', () => {
            playClickSound();
            modal.classList.remove('active');
        });

        document.getElementById('inputAvatarFile').addEventListener('change', function(e) {
            const file = e.target.files[0];
            if (file) {
                document.getElementById('avatarFileName').textContent = file.name;
                compressImage(file, 250, 250, 0.7, function(base64) {
                    tempAvatarBase64 = base64;
                    document.getElementById('avatarPreviewImg').src = tempAvatarBase64;
                    document.getElementById('avatarPreviewContainer').style.display = 'flex';
                });
            }
        });

        document.getElementById('inputBannerFile').addEventListener('change', function(e) {
            const file = e.target.files[0];
            if (file) {
                document.getElementById('bannerFileName').textContent = file.name;
                compressImage(file, 600, 300, 0.65, function(base64) {
                    tempBannerBase64 = base64;
                    document.getElementById('bannerPreviewImg').src = tempBannerBase64;
                    document.getElementById('bannerPreviewContainer').style.display = 'flex';
                });
            }
        });

        saveProfileBtn.addEventListener('click', () => {
            playClickSound();
            const newName = document.getElementById('inputUsername').value.trim();
            const countryVal = document.getElementById('selectCountry').value.split('|');
            const code = countryVal[0];
            const name = countryVal[1];

            if (newName !== '') {
                document.getElementById('userNameDisplay').textContent = newName;
                safeLocalStorageSet('okaos_username', newName);
            }

            document.getElementById('countryNameDisplay').textContent = name;
            const flagUrl = `https://flagcdn.com/w40/${code}.png`;
            document.getElementById('countryFlagImg').src = flagUrl;
            safeLocalStorageSet('okaos_country', name);
            safeLocalStorageSet('okaos_flag', flagUrl);

            if (tempAvatarBase64) {
                document.getElementById('profileAvatar').src = tempAvatarBase64;
                safeLocalStorageSet('okaos_avatar', tempAvatarBase64);
            }

            if (tempBannerBase64) {
                document.getElementById('profileBanner').style.backgroundImage = `url("${tempBannerBase64}")`;
                safeLocalStorageSet('okaos_banner', tempBannerBase64);
            }

            const tagsVisible = {
                vip: document.getElementById('tagToggleVip').checked,
                supporter: document.getElementById('tagToggleSupporter').checked,
                dev: document.getElementById('tagToggleDev').checked
            };
            safeLocalStorageSet(TAGS_KEY, JSON.stringify(tagsVisible));
            renderBadges();

            safeLocalStorageSet(FAV_SONGS_KEY, JSON.stringify(favSelectedIds));
            renderFavoriteSongsDisplay();

            modal.classList.remove('active');
        });

        window.addEventListener('keydown', (e) => {
            if (e.ctrlKey && (e.key === 's' || e.key === 'u')) {
                e.preventDefault();
            }
        });

        loadProfileData();
        renderProfileStats();
        renderBadges();
        renderFavoriteSongsDisplay();
