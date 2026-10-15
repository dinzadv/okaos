let toastTimeout;

const bgMusic = new Audio(OKAOS.asset('sounds/music.ogg'));
bgMusic.loop = true;

const clickSound = new Audio(OKAOS.asset('sounds/click.mp3'));
const click2Sound = new Audio(OKAOS.asset('sounds/click2.ogg'));

function tryPlayBgMusic() {
    bgMusic.play().catch(() => {});
}

window.addEventListener('click', tryPlayBgMusic, { once: true });
window.addEventListener('keydown', tryPlayBgMusic, { once: true });

function playClick2Sound() {
    click2Sound.currentTime = 0;
    click2Sound.play().catch(() => {});
}

function fadeAllAudio(duration = 800) {
    const audioList = [bgMusic, clickSound, click2Sound];
    const steps = 20;
    const intervalTime = duration / steps;
    let currentStep = 0;

    const fadeInterval = setInterval(() => {
        currentStep++;
        const factor = Math.max(0, 1 - currentStep / steps);

        audioList.forEach(audio => {
            if (audio && !audio.paused) {
                audio.volume = factor;
            }
        });

        if (currentStep >= steps) {
            clearInterval(fadeInterval);
            audioList.forEach(audio => {
                if (audio) {
                    audio.pause();
                }
            });
        }
    }, intervalTime);
}

document.querySelectorAll('a, button, .rhombus-btn, .modal-close').forEach(element => {
    const targetUrl = element.getAttribute('href');
    if (targetUrl && targetUrl !== '#' && !targetUrl.startsWith('javascript:')) {
        element.addEventListener('click', (e) => {
            e.preventDefault();
            const isExternal = element.getAttribute('target') === '_blank';
            
            if (element.id === 'btnPlay') {
                clickSound.currentTime = 0;
                clickSound.play().catch(() => {});
            } else {
                playClick2Sound();
            }

            fadeAllAudio(1000);

            setTimeout(() => {
                if (isExternal) {
                    window.open(targetUrl, '_blank');
                } else {
                    window.location.href = targetUrl;
                }
            }, 1000);
        });
    } else {
        if (element.id !== 'btnPlay') {
            element.addEventListener('click', () => {
                playClick2Sound();
            });
        }
    }
});

window.addEventListener('keydown', (e) => {
    if (e.ctrlKey && (e.key === 's' || e.key === 'u')) {
        e.preventDefault();
    }
});

const modal = document.getElementById('controlsModal');
const openBtn = document.getElementById('controlsBtn');
const closeModal = document.getElementById('closeModal');

openBtn.addEventListener('click', () => {
    modal.classList.add('active');
});

closeModal.addEventListener('click', () => {
    modal.classList.remove('active');
});

const versionModal = document.getElementById('versionModal');
const versionBtn = document.getElementById('versionBtn');
const closeVersionBtn = document.getElementById('closeVersionBtn');

versionBtn.addEventListener('click', () => {
    versionModal.classList.add('active');
});

closeVersionBtn.addEventListener('click', () => {
    versionModal.classList.remove('active');
});

const modsBtn = document.getElementById('modsBtn');
const modsToast = document.getElementById('modsToast');

function describeMods() {
    const mods = OKAOS.mods;
    if (!mods.length) return 'No hay mods instalados';
    const names = mods.map(m => m.nombre).join(', ');
    return (mods.length === 1 ? 'Mod activo: ' : 'Mods activos: ') + names;
}

modsBtn.addEventListener('click', () => {
    modsToast.querySelector('.toast-text').textContent = describeMods();
    clearTimeout(toastTimeout);
    modsToast.classList.add('active');
    toastTimeout = setTimeout(() => {
        modsToast.classList.remove('active');
    }, 3000);
});

window.addEventListener('keydown', (e) => {
    if (modal.classList.contains('active')) {
        const keyName = e.key.toLowerCase();
        const keyBox = document.querySelector(`.key-box[data-key="${keyName}"]`);
        if (keyBox) {
            keyBox.classList.add('active-key');
        }
    }
});

window.addEventListener('keyup', (e) => {
    if (modal.classList.contains('active')) {
        const keyName = e.key.toLowerCase();
        const keyBox = document.querySelector(`.key-box[data-key="${keyName}"]`);
        if (keyBox) {
            keyBox.classList.remove('active-key');
        }
    }
});

function executeChainBounce() {
    const sequence = [
        document.getElementById('btnPlay'),
        document.getElementById('btnCanciones'),
        document.getElementById('btnPerfil'),
        document.getElementById('btnAjustes')
    ];
    
    sequence.forEach((btn, index) => {
        setTimeout(() => {
            if (btn) {
                btn.classList.add('bounce-active');
                btn.addEventListener('animationend', () => {
                    btn.classList.remove('bounce-active');
                }, { once: true });
            }
        }, index * 250);
    });
}

function executeRhombusEntrance() {
    const rhombusBtns = document.querySelectorAll('.rhombus-btn');
    rhombusBtns.forEach((btn, index) => {
        setTimeout(() => {
            btn.classList.add('entrance-active');
        }, index * 120);
    });
}

setTimeout(executeChainBounce, 300);
setTimeout(executeRhombusEntrance, 600);
setInterval(executeChainBounce, 1 * 60 * 1000);
