const audioPlayer = new Audio();
const clickAudio = new Audio(OKAOS.asset('sounds/click2.ogg'));

function playClickSound() {
    clickAudio.currentTime = 0;
    clickAudio.play().catch(() => {});
}

document.addEventListener('click', playClickSound);

const bgContainer = document.getElementById('bg-container');
const gridPanel = document.getElementById('gridPanel');
const disc = document.getElementById('disc');
const phoneImg = document.getElementById('phoneImg');
const phoneTitle = document.getElementById('phoneTitle');
const phoneAuthor = document.getElementById('phoneAuthor');
const phoneDuration = document.getElementById('phoneDuration');
const phoneDiff = document.getElementById('phoneDiff');
const phonePoints = document.getElementById('phonePoints');
const addTrackBtn = document.getElementById('addTrackBtn');
const searchInput = document.getElementById('searchInput');
const homeBtn = document.getElementById('homeBtn');
const addMapBtn = document.getElementById('addMapBtn');
const mapFileInput = document.getElementById('mapFileInput');
const uploadToast = document.getElementById('uploadToast');
const diffMenuNav = document.getElementById('diffMenu');

function ensureDifficultyTabs() {
    const have = new Set(Array.from(diffMenuNav.querySelectorAll('[data-diff]')).map(b => b.getAttribute('data-diff').toLowerCase()));
    OKAOS.difficulties().forEach(name => {
        if (have.has(name.toLowerCase())) return;
        const tab = document.createElement('span');
        tab.className = 'menu-btn';
        tab.setAttribute('data-diff', name);
        tab.textContent = name;
        diffMenuNav.insertBefore(tab, addMapBtn);
        have.add(name.toLowerCase());
    });
}

ensureDifficultyTabs();

let toastTimer = null;

function showToast(message, isError) {
    uploadToast.textContent = message;
    uploadToast.classList.toggle('error', !!isError);
    uploadToast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => uploadToast.classList.remove('show'), isError ? 5000 : 3000);
}

let allSongs = [];
let currentFilter = 'All';
let selectedSong = null;

async function loadSongs() {
    const index = await SONGS.list();
    const results = await Promise.allSettled(index.map(async entry => {
        let fondo;
        try {
            fondo = await SONGS.getThumbUrl(entry.id);
        } catch (err) {
            fondo = OKAOS.asset('img/logo.jpg');
        }
        return { ...entry, fondo, portada: fondo, id: entry.id };
    }));
    allSongs = results.filter(r => r.status === 'fulfilled').map(r => r.value);
    renderSongs();
}

function updateBackground(song) {
    const oldBg = document.getElementById('bg-element');

    if (song.hasVideo) {
        if (oldBg) {
            oldBg.classList.add('fade-out');
            setTimeout(() => {
                oldBg.remove();
                createNewBgElement(song);
            }, 500);
        } else {
            createNewBgElement(song);
        }
    } else {
        if (oldBg) oldBg.remove();
        createNewBgElement(song);
    }
}

async function createNewBgElement(song) {
    let newBg;

    if (song.hasVideo) {
        const videoUrl = await SONGS.getVideoUrl(song.id);
        newBg = document.createElement('video');
        newBg.id = 'bg-element';
        newBg.autoplay = true;
        newBg.loop = true;
        newBg.muted = true;
        newBg.playsInline = true;
        newBg.classList.add('fade-out');
        newBg.src = videoUrl;

        newBg.oncanplaythrough = () => {
            newBg.classList.remove('fade-out');
        };
    } else {
        newBg = document.createElement('img');
        newBg.id = 'bg-element';
        newBg.src = song.fondo;
    }

    bgContainer.appendChild(newBg);
}

function crossfade(audioSource) {
    if (audioPlayer.paused) {
        audioPlayer.src = audioSource;
        audioPlayer.volume = 1;
        audioPlayer.play().catch(() => {});
    } else {
        let fadeOut = setInterval(() => {
            if (audioPlayer.volume > 0.1) {
                audioPlayer.volume -= 0.1;
            } else {
                audioPlayer.pause();
                audioPlayer.src = audioSource;
                audioPlayer.volume = 1;
                audioPlayer.play().catch(() => {});
                clearInterval(fadeOut);
            }
        }, 50);
    }
}

audioPlayer.addEventListener('play', () => disc.classList.add('spinning'));
audioPlayer.addEventListener('pause', () => disc.classList.remove('spinning'));
audioPlayer.addEventListener('ended', () => disc.classList.remove('spinning'));

function renderSongs() {
    gridPanel.innerHTML = '';
    const query = searchInput.value.toLowerCase();
    const filtered = allSongs.filter(s => 
        (currentFilter === 'All' || String(s.dificultad).toLowerCase() === currentFilter.toLowerCase()) &&
        ((s.nombre || '').toLowerCase().includes(query) || (s.autor || '').toLowerCase().includes(query))
    );

    if (filtered.length === 0) {
        gridPanel.innerHTML = `
            <div class="empty-state">
                <img src="../img/icons/ic9.png" alt="Sin canciones">
                <h2>No hay música</h2>
                <p>Aún no hay canciones que coincidan con tu búsqueda</p>
            </div>`;
        return;
    }

    filtered.forEach((song, idx) => {
        const card = document.createElement('div');
        card.className = 'song-card';
        card.setAttribute('data-song-id', song.id);
        card.style.animationDelay = `${idx * 0.03}s`;
        card.innerHTML = `<img src="${song.portada || song.fondo}" alt="${song.nombre}">`;
        
        card.onclick = async () => {
            document.querySelectorAll('.song-card').forEach(c => c.classList.remove('active'));
            card.classList.add('active');
            selectedSong = song;
            addTrackBtn.disabled = false;
            updateBackground(song);
            phoneImg.src = song.portada || song.fondo;
            phoneTitle.textContent = song.nombre;
            phoneAuthor.textContent = song.autor;
            phoneDuration.textContent = song.duracion;
            phoneDiff.textContent = song.dificultad;
            phonePoints.textContent = song.puntos;
            updateBtnState();
            const audioUrl = await SONGS.getAudioUrl(song.id);
            if (selectedSong === song) crossfade(audioUrl);
        };
        gridPanel.appendChild(card);
    });
}

function updateBtnState() {
    const library = JSON.parse(localStorage.getItem('mySongs') || '[]');
    if (SONGS.isCustom(selectedSong)) {
        addTrackBtn.textContent = 'Eliminar';
        addTrackBtn.className = 'phone-action-btn remove';
        return;
    }
    const isAdded = library.find(s => s.id === selectedSong.id);
    addTrackBtn.textContent = isAdded ? 'Quitar' : 'Añadir';
    addTrackBtn.className = isAdded ? 'phone-action-btn remove' : 'phone-action-btn';
}

function toLibraryRecord(song) {
    return {
        id: song.id,
        nombre: song.nombre,
        autor: song.autor,
        dificultad: song.dificultad,
        star: song.star,
        bpm: song.bpm,
        duracion: song.duracion,
        puntos: song.puntos,
        hasVideo: song.hasVideo
    };
}

function addToLibrary(song) {
    const library = JSON.parse(localStorage.getItem('mySongs') || '[]');
    if (!library.find(s => s.id === song.id)) {
        library.push(toLibraryRecord(song));
        localStorage.setItem('mySongs', JSON.stringify(library));
    }
}

function removeFromLibrary(id) {
    const library = JSON.parse(localStorage.getItem('mySongs') || '[]').filter(s => s.id !== id);
    localStorage.setItem('mySongs', JSON.stringify(library));
}

function clearSelection() {
    selectedSong = null;
    addTrackBtn.disabled = true;
    addTrackBtn.textContent = 'Añadir';
    addTrackBtn.className = 'phone-action-btn';
    audioPlayer.pause();
    phoneTitle.textContent = 'Selecciona una';
    phoneAuthor.textContent = 'canción para ver';
    phoneImg.src = OKAOS.asset('img/logo.jpg');
    phoneDuration.textContent = '--:--';
    phoneDiff.textContent = '--';
    phonePoints.textContent = '---';
}

addTrackBtn.onclick = async () => {
    if (!selectedSong) return;
    if (SONGS.isCustom(selectedSong)) {
        const id = selectedSong.id;
        await SONGS.removeCustom(id);
        removeFromLibrary(id);
        clearSelection();
        await loadSongs();
        return;
    }
    let library = JSON.parse(localStorage.getItem('mySongs') || '[]');
    const index = library.findIndex(s => s.id === selectedSong.id);
    if (index > -1) {
        library.splice(index, 1);
    } else {
        library.push(toLibraryRecord(selectedSong));
    }
    localStorage.setItem('mySongs', JSON.stringify(library));
    updateBtnState();
};

document.querySelectorAll('.menu-btn[data-diff]').forEach(btn => {
    btn.onclick = () => {
        document.querySelectorAll('.menu-btn[data-diff]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentFilter = btn.getAttribute('data-diff');
        renderSongs();
    };
});

homeBtn.onclick = (e) => {
    e.preventDefault();
    const targetUrl = homeBtn.getAttribute('href');
    
    if (!audioPlayer.paused && audioPlayer.volume > 0) {
        let fadeOutHome = setInterval(() => {
            if (audioPlayer.volume > 0.05) {
                audioPlayer.volume -= 0.05;
            } else {
                audioPlayer.pause();
                clearInterval(fadeOutHome);
                window.location.href = targetUrl;
            }
        }, 25);
    } else {
        window.location.href = targetUrl;
    }
};

addMapBtn.onclick = () => mapFileInput.click();

mapFileInput.onchange = async () => {
    const files = Array.from(mapFileInput.files || []);
    mapFileInput.value = '';
    if (!files.length) return;
    showToast('Importando mapa...', false);
    let result;
    try {
        result = await SONGS.importFiles(files);
    } catch (err) {
        showToast('No se pudo guardar el mapa en este navegador', true);
        return;
    }
    if (result.errors.length) showToast(result.errors.join(' | '), true);
    if (!result.added.length) return;
    const entries = await SONGS.list();
    result.added.forEach(id => {
        const entry = entries.find(e => e.id === id);
        if (entry) addToLibrary(entry);
    });
    await loadSongs();
    if (!result.errors.length) showToast(result.added.length === 1 ? 'Mapa añadido a tu biblioteca' : result.added.length + ' mapas añadidos a tu biblioteca', false);
    const firstCard = gridPanel.querySelector('.song-card[data-song-id="' + result.added[0] + '"]');
    if (firstCard) {
        firstCard.click();
        firstCard.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
};

searchInput.oninput = renderSongs;
loadSongs();
window.addEventListener('keydown', (e) => { if (e.ctrlKey && (e.key === 's' || e.key === 'u')) e.preventDefault(); });
