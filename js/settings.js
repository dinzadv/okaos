const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        
        function playSelectSound() {
            if (audioCtx.state === 'suspended') {
                audioCtx.resume();
            }
            const sfxVol = document.getElementById('sfxVol') ? (document.getElementById('sfxVol').value / 100) : 0.9;
            const masterVol = document.getElementById('masterVol') ? (document.getElementById('masterVol').value / 100) : 0.8;
            const finalVol = 0.15 * sfxVol * masterVol;
            if (finalVol <= 0) return;

            const osc = audioCtx.createOscillator();
            const gain = audioCtx.createGain();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(600, audioCtx.currentTime);
            osc.frequency.exponentialRampToValueAtTime(1200, audioCtx.currentTime + 0.08);
            gain.gain.setValueAtTime(finalVol, audioCtx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.08);
            osc.connect(gain);
            gain.connect(audioCtx.destination);
            osc.start();
            osc.stop(audioCtx.currentTime + 0.08);
        }

        function triggerVibration() {
            const vibEnabled = document.getElementById('btnVibration').classList.contains('on');
            if (vibEnabled && navigator.vibrate) {
                navigator.vibrate(30);
            }
        }

        const menuOptions = document.querySelectorAll('.menu-option');
        const panels = document.querySelectorAll('.panel-section');

        menuOptions.forEach(opt => {
            opt.addEventListener('click', () => {
                playSelectSound();
                triggerVibration();

                menuOptions.forEach(o => o.classList.remove('active'));
                panels.forEach(p => p.classList.remove('active'));

                opt.classList.add('active');
                const target = opt.getAttribute('data-target');
                const activePanel = document.getElementById(target);
                activePanel.classList.add('active');
                
                const rows = activePanel.querySelectorAll('.p5-row');
                rows.forEach((row, index) => {
                    row.style.animation = 'none';
                    row.offsetHeight;
                    row.style.animation = `p5Entrance 0.3s cubic-bezier(0.25, 1, 0.5, 1) ${index * 0.04}s forwards`;
                });
            });
        });

        function updateSliderValues() {
            document.getElementById('valArrowSpeed').textContent = parseFloat(document.getElementById('arrowSpeed').value).toFixed(1) + 'x';
            document.getElementById('valOffset').textContent = document.getElementById('offset').value + 'ms';
            document.getElementById('valTouchSize').textContent = document.getElementById('touchSize').value + '%';
            document.getElementById('valTouchOpacity').textContent = document.getElementById('touchOpacity').value + '%';
            document.getElementById('valLaneOpacity').textContent = document.getElementById('laneOpacity').value + '%';
            document.getElementById('valMasterVol').textContent = document.getElementById('masterVol').value + '%';
            document.getElementById('valBgmVol').textContent = document.getElementById('bgmVol').value + '%';
            document.getElementById('valSfxVol').textContent = document.getElementById('sfxVol').value + '%';
            document.getElementById('valMusicSpeed').textContent = parseFloat(document.getElementById('musicSpeed').value).toFixed(2) + 'x';
        }

        function updateCustomSpeedState() {
            const btnCustomSpeed = document.getElementById('btnCustomSpeed');
            const isCustom = btnCustomSpeed.classList.contains('on');
            const rowGlobalSpeed = document.getElementById('rowGlobalSpeed');
            const arrowSpeedInput = document.getElementById('arrowSpeed');

            if (isCustom) {
                btnCustomSpeed.textContent = "On";
                rowGlobalSpeed.classList.remove('disabled-row');
                arrowSpeedInput.disabled = false;
            } else {
                btnCustomSpeed.textContent = "Off";
                rowGlobalSpeed.classList.add('disabled-row');
                arrowSpeedInput.disabled = true;
            }
        }

        function updateHorizontalText() {
            const btnHorizontal = document.getElementById('btnHorizontal');
            const isHorizontal = btnHorizontal.classList.contains('on');
            btnHorizontal.textContent = isHorizontal ? "Horizontal" : "Vertical";
            document.body.classList.toggle('horizontal-mode', isHorizontal);
        }

        function updateArrowPosText() {
            const btnArrowPos = document.getElementById('btnArrowPos');
            if (btnArrowPos.classList.contains('on')) {
                btnArrowPos.textContent = "Abajo";
            } else {
                btnArrowPos.textContent = "Arriba";
            }
        }

        function saveSettings() {
            const storageActive = document.getElementById('btnStorage').classList.contains('on');
            if (!storageActive) {
                localStorage.removeItem('okaos_settings');
                return;
            }

            const currentSettings = {
                keys: {
                    key1: document.getElementById('key1').textContent,
                    key2: document.getElementById('key2').textContent,
                    key3: document.getElementById('key3').textContent,
                    key4: document.getElementById('key4').textContent,
                },
                sliders: {
                    arrowSpeed: document.getElementById('arrowSpeed').value,
                    offset: document.getElementById('offset').value,
                    touchSize: document.getElementById('touchSize').value,
                    touchOpacity: document.getElementById('touchOpacity').value,
                    laneOpacity: document.getElementById('laneOpacity').value,
                    masterVol: document.getElementById('masterVol').value,
                    bgmVol: document.getElementById('bgmVol').value,
                    sfxVol: document.getElementById('sfxVol').value,
                    musicSpeed: document.getElementById('musicSpeed').value,
                },
                toggles: {
                    btnCustomSpeed: document.getElementById('btnCustomSpeed').classList.contains('on'),
                    btnArrowPos: document.getElementById('btnArrowPos').classList.contains('on'),
                    btnHorizontal: document.getElementById('btnHorizontal').classList.contains('on'),
                    btnVibration: document.getElementById('btnVibration').classList.contains('on'),
                    btnFX: document.getElementById('btnFX').classList.contains('on'),
                    btnLines: document.getElementById('btnLines').classList.contains('on'),
                    btnStorage: document.getElementById('btnStorage').classList.contains('on'),
                }
            };

            localStorage.setItem('okaos_settings', JSON.stringify(currentSettings));
        }

        function loadSettings() {
            const saved = localStorage.getItem('okaos_settings');
            if (!saved) {
                updateCustomSpeedState();
                updateArrowPosText();
                updateHorizontalText();
                updateSliderValues();
                return;
            }

            try {
                const config = JSON.parse(saved);

                if (config.keys) {
                    for (let id in config.keys) {
                        const el = document.getElementById(id);
                        if (el) el.textContent = config.keys[id];
                    }
                }

                if (config.sliders) {
                    for (let id in config.sliders) {
                        const el = document.getElementById(id);
                        if (el) el.value = config.sliders[id];
                    }
                }

                if (config.toggles) {
                    for (let id in config.toggles) {
                        const btn = document.getElementById(id);
                        if (btn) {
                            if (config.toggles[id]) {
                                btn.classList.add('on');
                            } else {
                                btn.classList.remove('on');
                            }
                        }
                    }
                }
            } catch (e) {
                console.error(e);
            }

            updateCustomSpeedState();
            updateArrowPosText();
            updateHorizontalText();
            updateSliderValues();
        }

        document.getElementById('btnHorizontal').addEventListener('click', function() {
            playSelectSound();
            triggerVibration();
            this.classList.toggle('on');
            updateHorizontalText();
            saveSettings();
        });

        document.getElementById('btnCustomSpeed').addEventListener('click', function() {
            playSelectSound();
            triggerVibration();
            this.classList.toggle('on');
            updateCustomSpeedState();
            saveSettings();
        });

        document.getElementById('btnArrowPos').addEventListener('click', function() {
            playSelectSound();
            triggerVibration();
            this.classList.toggle('on');
            updateArrowPosText();
            saveSettings();
        });

        const genericToggles = ['btnVibration', 'btnFX', 'btnLines', 'btnStorage'];
        genericToggles.forEach(id => {
            const btn = document.getElementById(id);
            if (btn) {
                btn.addEventListener('click', () => {
                    playSelectSound();
                    triggerVibration();
                    if (btn.classList.contains('on')) {
                        btn.classList.remove('on');
                        btn.textContent = "Inactivo";
                    } else {
                        btn.classList.add('on');
                        btn.textContent = "Activo";
                    }
                    saveSettings();
                });
            }
        });

        document.querySelectorAll('.range-slider').forEach(slider => {
            slider.addEventListener('input', () => {
                updateSliderValues();
            });
            slider.addEventListener('change', () => {
                saveSettings();
            });
            slider.addEventListener('touchstart', () => {
                playSelectSound();
            }, { passive: true });
            slider.addEventListener('mousedown', () => {
                playSelectSound();
            });
        });

        let currentWaitingBox = null;
        const keyBoxes = document.querySelectorAll('.key-box');

        keyBoxes.forEach(box => {
            box.addEventListener('click', (e) => {
                e.stopPropagation();
                playSelectSound();
                triggerVibration();
                if (currentWaitingBox) {
                    currentWaitingBox.classList.remove('waiting');
                }
                currentWaitingBox = box;
                box.classList.add('waiting');
            });
        });

        window.addEventListener('keydown', (e) => {
            if (currentWaitingBox) {
                e.preventDefault();
                let keyStr = e.key.toUpperCase();
                if (keyStr === ' ') keyStr = 'SPACE';
                if (keyStr === 'ARROWLEFT') keyStr = '←';
                if (keyStr === 'ARROWRIGHT') keyStr = '→';
                if (keyStr === 'ARROWUP') keyStr = '↑';
                if (keyStr === 'ARROWDOWN') keyStr = '↓';
                
                if (keyStr.length <= 5 || ['SPACE'].includes(keyStr)) {
                    currentWaitingBox.querySelector('.key-value').textContent = keyStr;
                    currentWaitingBox.classList.remove('waiting');
                    currentWaitingBox = null;
                    playSelectSound();
                    saveSettings();
                }
            } else if (e.ctrlKey && (e.key === 's' || e.key === 'u')) {
                e.preventDefault();
            }
        });

        document.getElementById('btnClearAll').addEventListener('click', () => {
            playSelectSound();
            triggerVibration();
            localStorage.removeItem('okaos_settings');
            location.reload();
        });

        if (document.readyState === 'loading') {
            window.addEventListener('DOMContentLoaded', loadSettings);
        } else {
            loadSettings();
        }
