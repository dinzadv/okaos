/* =====================================================================
   NO CONTROL  -  script del mod
   API usada (ver js/mods.js):
     OKAOS.on(evento, fn)          eventos: songLoaded, start, spawn, frame, hit, miss, pause, resume, end
     OKAOS.mechanics.register(tag, {spawn, update, hit, miss})
     OKAOS.currentMod               (solo disponible mientras se ejecuta este script)
   ===================================================================== */
(function () {
    "use strict";
    if (!window.OKAOS) return;

    const MOD_ID = "nocontrol";
    const root = document.documentElement;
    const HOLD_GRADIENTS = [
        "linear-gradient(90deg,#ff3b6b,#ff9db5,#ff3b6b)",
        "linear-gradient(90deg,#00e5d4,#a8fff7,#00e5d4)",
        "linear-gradient(90deg,#b48cff,#e0d0ff,#b48cff)",
        "linear-gradient(90deg,#ffd23f,#fff0a8,#ffd23f)"
    ];

    let active = false;     // true solo cuando se juega una cancion de ESTE mod
    let beatMs = 375;       // 160 BPM
    let offsetMs = 102;     // fase del primer beat (se lee del .oks: offset)
    let lastPulse = -1;
    let missTimer = 0, perfectTimer = 0;

    /* ---------- mecanica propia: tag "glitch" ---------- */
    OKAOS.mechanics.register("glitch", {
        spawn: function (note, el) { el.classList.add("nc-glitch"); },
        update: function (note, nowMs) {
            if (!note.el) return;
            // la nota "tiembla" mas fuerte justo antes de saltar de carril
            const left = note.cambio && !note.cambio.applied ? (note.cambio.time - nowMs) : 9999;
            const amp = left < 400 ? 5 : 2;
            const j = ((Math.floor(nowMs / 55) % 3) - 1) * amp;
            note.el.style.setProperty("--nc-jit", j + "px");
        }
    });

    /* ---------- cancion cargada ---------- */
    OKAOS.on("songLoaded", function (data) {
        active = !!data && (data.mod === MOD_ID || /(^|-)nocontrol(-|$)/.test(String(data.id || "")));
        root.classList.toggle("nc-active", active);
        if (!active) return;

        const meta = data.meta || {};
        const bpm = Number(meta.bpm || data.bpm || 160);
        beatMs = 60000 / bpm;
        offsetMs = Number(meta.offset);
        if (!isFinite(offsetMs)) offsetMs = 0;

        // si falta assets/video.mp4 el elemento de video se oculta y se ve fondo.jpg
        const v = document.getElementById("bgVideo");
        if (v && !v.__ncBound) {
            v.__ncBound = true;
            v.addEventListener("error", function () { v.style.display = "none"; });
        }
    });

    /* ---------- pulso por beat (160 BPM) ---------- */
    OKAOS.on("frame", function (nowMs) {
        if (!active) return;
        const t = nowMs - offsetMs;
        const phase = (((t % beatMs) + beatMs) % beatMs) / beatMs;
        let pulse = Math.pow(Math.max(0, 1 - phase * 2.6), 2);
        const beatIdx = Math.floor(t / beatMs);
        if (((beatIdx % 4) + 4) % 4 === 0) pulse = Math.min(1, pulse * 1.25);   // tiempo 1 del compas, mas fuerte
        const q = Math.round(pulse * 40) / 40;
        if (q !== lastPulse) { lastPulse = q; root.style.setProperty("--nc-beat", q.toFixed(3)); }
    });

    /* ---------- holds con degradado propio por carril ---------- */
    OKAOS.on("spawn", function (note) {
        if (!active || !note || !note.holdEl) return;
        note.holdEl.style.background = HOLD_GRADIENTS[note.col] || HOLD_GRADIENTS[0];
    });

    /* ---------- feedback ---------- */
    OKAOS.on("hit", function (e) {
        if (!active || !e) return;
        if (e.rating === "PERFECT") {
            root.classList.add("nc-perfect");
            clearTimeout(perfectTimer);
            perfectTimer = setTimeout(function () { root.classList.remove("nc-perfect"); }, 110);
        }
    });
    OKAOS.on("miss", function () {
        if (!active) return;
        root.classList.add("nc-miss");
        clearTimeout(missTimer);
        missTimer = setTimeout(function () { root.classList.remove("nc-miss"); }, 230);
    });

    /* ---------- limpieza al terminar / salir ---------- */
    OKAOS.on("end", function () {
        root.classList.remove("nc-perfect", "nc-miss");
        root.style.setProperty("--nc-beat", "0");
    });
})();
