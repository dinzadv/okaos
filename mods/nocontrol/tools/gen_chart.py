#!/usr/bin/env python3
"""
OKAOS chart generator  -  NO CONTROL (Teto x Miku)
Analiza audio.mp3 (onsets por bandas, pitch dominante, secciones) y escribe musica/no_control.oks
Uso:  python3 gen_chart.py audio.mp3 musica/no_control.oks
"""
import sys, json, subprocess, tempfile, os, random
import numpy as np, scipy.io.wavfile as wav, scipy.signal as ss

AUDIO = sys.argv[1] if len(sys.argv) > 1 else "assets/audio.mp3"
OUT   = sys.argv[2] if len(sys.argv) > 2 else "musica/no_control.oks"
BPM   = 160.0
BEAT  = 60.0 / BPM
S16   = BEAT / 4
random.seed(160)

# ---------- 1) decodificar ----------
tmp = tempfile.mktemp(suffix=".wav")
subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", AUDIO, "-ac", "1", "-ar", "22050", tmp], check=True)
sr, x = wav.read(tmp); os.remove(tmp)
x = x.astype(np.float32) / 32768
DUR = len(x) / sr

# ---------- 2) onsets por banda ----------
N, H = 2048, 256
f, t, S = ss.stft(x, sr, nperseg=N, noverlap=N - H, window="hann")
M = np.abs(S); FPS = sr / H
L = np.log1p(40 * M)
D = np.maximum(np.diff(L, axis=1, prepend=L[:, :1]), 0)
def band(a, b): return (f >= a) & (f < b)
env = {k: D[band(*v)].sum(0) for k, v in
       {"bass": (35, 160), "lowmid": (160, 700), "mid": (700, 3500), "high": (3500, 10000)}.items()}
for k in env: env[k] = env[k] / np.percentile(env[k], 99.5)
tot = sum(env.values())

# fase del beat (16avos)
best = None
for off in np.arange(0, BEAT, 0.002):
    pts = np.arange(off, DUR, S16)
    idx = np.clip(np.round(pts * FPS).astype(int), 0, len(tot) - 1)
    w = np.array([1.0 if k % 4 == 0 else 0.8 if k % 2 == 0 else 0.6 for k in range(len(pts))])
    sc = (np.maximum.reduce([tot[np.clip(idx + d, 0, len(tot) - 1)] for d in (-1, 0, 1)]) * w).sum()
    if best is None or sc > best[0]: best = (sc, off)
OFF = best[1]
BAR = BEAT * 4

# ---------- 3) pitch dominante (HPS) para melodia + sostenidos ----------
N2, H2 = 4096, 512
f2, t2, S2 = ss.stft(x, sr, nperseg=N2, noverlap=N2 - H2, window="hann")
M2 = np.abs(S2); FPS2 = sr / H2
df = f2[1]
lo, hi = int(180 / df), int(1100 / df)
hps = M2[lo:hi] * M2[2 * lo:2 * hi:2][:hi - lo] * M2[3 * lo:3 * hi:3][:hi - lo] if 3 * hi <= M2.shape[0] else M2[lo:hi]
pk = hps.argmax(0) + lo
sal = hps.max(0) / (hps.mean(0) + 1e-12)
midi = 69 + 12 * np.log2(np.maximum(pk * df, 1) / 440.0)
midi = ss.medfilt(midi, 5)
salthr = np.percentile(sal, 35)

def midi_at(sec):
    i = int(np.clip(sec * FPS2, 0, len(midi) - 1)); return float(midi[i])

# segmentos sostenidos: pitch estable + saliencia alta + sin nuevo ataque fuerte
atk = (env["mid"] + env["lowmid"])
def atk_at(sec, r=0.03):
    a = int(max(0, (sec - r) * FPS)); b = int(min(len(atk) - 1, (sec + r) * FPS)) + 1
    return float(atk[a:b].max())
sustains = []
i = 0; n2 = len(midi)
while i < n2:
    if sal[i] >= salthr:
        j = i; ref = midi[i]
        while j + 1 < n2 and sal[j + 1] >= salthr * 0.8 and abs(midi[j + 1] - ref) <= 1.3:
            j += 1
            if j - i > 3: ref = float(np.median(midi[i:j + 1]))
        d = (j - i + 1) / FPS2
        if d >= S16 * 3:
            sustains.append((i / FPS2, (j + 1) / FPS2, float(np.median(midi[i:j + 1]))))
        i = j + 1
    else:
        i += 1

# ---------- 4) secciones (por analisis de energia/novedad) ----------
# (bar_inicio, bar_fin, nombre, intensidad 1-4)  -> derivado de novedad espectral + caidas de rms por compas
SECTIONS = [
    (1, 9,   "Intro",        1),
    (9, 17,  "Verse 1",      2),
    (17, 25, "Pre-Chorus",   3),
    (25, 40, "Chorus 1",     3),
    (40, 41, "Break",        0),
    (41, 57, "Drop",         4),
    (57, 58, "Break",        0),
    (58, 66, "Verse 2",      2),
    (66, 81, "Build",        3),
    (81, 82, "Break",        0),
    (82, 97, "Chorus 2",     4),
    (97, 99, "Break",        0),
    (99, 115, "Final Chorus", 4),
    (115, 118, "Outro",      1),
]
def sec_of_bar(b):
    for s in SECTIONS:
        if s[0] <= b < s[1]: return s
    return None

# ---------- 5) grid de slots ----------
slots = []
k = 0
while OFF + k * S16 < DUR - 3.0:
    sec = OFF + k * S16
    bar = int(sec // BAR) if False else int((sec - OFF) // BAR)
    s = sec_of_bar(bar)
    ia = int(max(0, sec * FPS - 2)); ib = int(min(len(tot) - 1, sec * FPS + 2)) + 1
    sc = {b: float(env[b][ia:ib].max()) for b in env}
    score = 0.9 * sc["bass"] + 0.7 * sc["lowmid"] + 0.9 * sc["mid"] + 0.5 * sc["high"]
    pos = k % 16
    score += 0.18 if pos % 4 == 0 else 0.08 if pos % 2 == 0 else 0.0
    slots.append(dict(k=k, sec=sec, ms=int(round(sec * 1000)), bar=bar, pos=pos, score=score, sc=sc, section=s))
    k += 1

TARGET = {1: 1.0, 2: 1.5, 3: 1.95, 4: 2.45}   # notas por beat
RUNMAX = {1: 1, 2: 2, 3: 2, 4: 3}            # 16avos consecutivos
picked = {}
carry = 0.0
for b0 in range(0, len(slots), 4):
    grp = slots[b0:b0 + 4]
    s = grp[0]["section"]
    if not s or s[3] == 0: continue
    lvl = s[3]
    carry += TARGET[lvl]
    m = int(carry); carry -= m
    m = min(m, 4)
    cand = sorted(grp, key=lambda z: -z["score"])
    for c in cand[:m]:
        if c["score"] >= 0.14: picked[c["k"]] = c
# limitar rachas de 16avos
ks = sorted(picked)
run = 1
for a, b in zip(ks, ks[1:]):
    if b == a + 1:
        run += 1
        lvl = picked[b]["section"][3]
        if run > RUNMAX[lvl]:
            del picked[b]; run = 1
    else:
        run = 1

# ---------- 6) carriles ----------
allm = np.array([midi_at(z["sec"]) for z in slots])
q = np.percentile(allm, [25, 50, 75])
def lane_from_pitch(m):
    return 0 if m < q[0] else 1 if m < q[1] else 2 if m < q[2] else 3

notes = []   # dict(ms, col, hold, tag, cambio)
kicks = 0
last_col = -1; last_ms = -9999; same = 0
for kk in sorted(picked):
    z = picked[kk]
    kick = z["sc"]["bass"] > max(z["sc"]["mid"], z["sc"]["high"]) * 1.15
    if kick:
        col = 0 if kicks % 2 == 0 else 3; kicks += 1
    else:
        col = lane_from_pitch(midi_at(z["sec"]))
    gap = z["ms"] - last_ms
    if col == last_col and gap < 150:
        cands = [c for c in range(4) if c != last_col]
        col = min(cands, key=lambda c: (abs(c - col), random.random()))
        same = 0
    elif col == last_col and gap < 260:
        same += 1
        if same >= 2:
            col = max(0, min(3, col + random.choice([-1, 1])))
            if col == last_col: col = (col + 2) % 4
            same = 0
    else:
        same = 0
    notes.append(dict(ms=z["ms"], col=col, hold=0, tag="", cambio=None, k=kk, z=z))
    last_col, last_ms = col, z["ms"]

# ---------- 7) holds desde sostenidos ----------
holds = []
for (a, b, m) in sustains:
    ka = int(round((a - OFF) / S16)); kb = int(round((b - OFF) / S16))
    if kb - ka < 3 or ka < 0 or ka >= len(slots): continue
    s = slots[ka]["section"]
    if not s or s[3] == 0: continue
    if kb - ka > 16: kb = ka + 16
    # solo si hay ataque cerca del inicio y coincide con una nota del mapa o es seccion de baja densidad
    if s[3] >= 3 and (ka not in picked) and random.random() < 0.35: continue
    start_ms = slots[ka]["ms"]
    end_ms = int(round((OFF + (kb - 1) * S16) * 1000))
    hold_ms = end_ms - start_ms
    if hold_ms < 250: continue
    holds.append(dict(ka=ka, kb=kb, start=start_ms, hold=hold_ms, col=lane_from_pitch(m), sec=s))
# holds "de frase": la nota se mantiene hasta justo antes del siguiente ataque (huecos largos en la melodia)
HP = {1: 0.55, 2: 0.55, 3: 0.45, 4: 0.32}
pk_sorted = sorted(picked)
tap_col = {n["k"]: n["col"] for n in notes}
for a, b in zip(pk_sorted, pk_sorted[1:]):
    if b - a < 4 or b - a > 16: continue
    sec_ = slots[a]["section"]
    if not sec_ or sec_[3] == 0 or a not in tap_col: continue
    if random.random() > HP[sec_[3]]: continue
    if any(abs(h["ka"] - a) <= 1 for h in holds): continue
    holds.append(dict(ka=a, kb=b, start=slots[a]["ms"], hold=int(round((b - 1 - a) * S16 * 1000)),
                      col=tap_col[a], sec=sec_))
# holds de acento: en secciones intensas, el golpe de tiempo 1 de compases pares se sostiene 1.5 beats
for kk in sorted(picked):
    z = picked[kk]; s_ = z["section"]
    if s_[3] == 4 and z["pos"] == 0 and z["bar"] % 2 == 0 and kk in tap_col and random.random() < 0.55:
        if any(abs(h["ka"] - kk) <= 1 for h in holds): continue
        holds.append(dict(ka=kk, kb=kk + 7, start=slots[kk]["ms"], hold=int(round(6 * S16 * 1000)),
                          col=tap_col[kk], sec=s_))
holds.sort(key=lambda h: h["start"])
# filtrar: no superponer demasiado (max 2 simultaneos) y separar inicios
final_holds = []
for h in holds:
    active = [g for g in final_holds if g["start"] + g["hold"] > h["start"] - 80]
    if len(active) >= 1 and h["sec"][3] < 4: continue
    if len(active) >= 2: continue
    if any(g["col"] == h["col"] for g in active):
        free = [c for c in range(4) if all(g["col"] != c for g in active)]
        h["col"] = min(free, key=lambda c: abs(c - h["col"]))
    final_holds.append(h)

# integrar: quitar taps en el mismo carril durante el hold; en otros carriles exigir gap >= 2 slots
tap = [n for n in notes]
def in_hold(n, h): return h["start"] - 60 <= n["ms"] <= h["start"] + h["hold"] + 90
out = []
for n in tap:
    drop = False
    for h in final_holds:
        if in_hold(n, h):
            if n["ms"] >= h["start"] - 60 and n["ms"] <= h["start"] + 60:
                drop = True       # reemplazada por la cabeza del hold
            elif n["col"] == h["col"]:
                alt = [c for c in range(4) if all(not (in_hold(n, g) and g["col"] == c) for g in final_holds)]
                n["col"] = min(alt, key=lambda c: abs(c - n["col"]))
    if not drop: out.append(n)
# thin out: durante un hold, evitar rachas de 16avos
thin = []
lastms = -9999
for n in sorted(out, key=lambda n: n["ms"]):
    busy = any(h["start"] < n["ms"] < h["start"] + h["hold"] for h in final_holds)
    if busy and n["ms"] - lastms < S16 * 1000 * 2 - 5: continue
    thin.append(n); lastms = n["ms"]
for h in final_holds:
    thin.append(dict(ms=h["start"], col=h["col"], hold=h["hold"], tag="", cambio=None))
notes = sorted(thin, key=lambda n: (n["ms"], n["col"]))

# acordes: acentos fuertes en tiempo 1 de compas (solo intensidad 3-4, sin holds activos)
chords = 0
for n in list(notes):
    z = n.get("z")
    if not z or n["hold"]: continue
    s = z["section"]
    if s[3] >= 3 and z["pos"] == 0 and z["bar"] % 2 == 0 and z["sc"]["bass"] > 0.55 and z["sc"]["mid"] > 0.35:
        busy = any(h["start"] - 80 < n["ms"] < h["start"] + h["hold"] + 80 for h in final_holds)
        if busy: continue
        other = 3 - n["col"] if n["col"] in (0, 3) else (n["col"] + 2) % 4 if n["col"] in (1, 2) and False else 3 - n["col"]
        if other == n["col"]: other = (n["col"] + 1) % 4
        if not any(m["ms"] == n["ms"] and m["col"] == other for m in notes):
            notes.append(dict(ms=n["ms"], col=other, hold=0, tag="", cambio=None)); chords += 1
notes.sort(key=lambda n: (n["ms"], n["col"]))

# cambios de carril ("NO CONTROL"): notas que saltan de carril antes del golpe en Final Chorus
cam = 0
for n in notes:
    z = n.get("z")
    if not z or n["hold"] or n["tag"]: continue
    s = z["section"]
    if s[2] == "Final Chorus" and z["pos"] == 8 and z["bar"] % 4 == 1:
        newc = (n["col"] + 2) % 4
        if not any(m["ms"] == n["ms"] and m["col"] == newc for m in notes):
            n["cambio"] = (n["ms"] - 520, newc); n["tag"] = "glitch"; cam += 1

# bombas (no tocar) en Final Chorus: se colocan en el hueco mas libre del compas
bombs = 0
for bar in (101, 104, 107, 110, 113):
    bestb = None
    for pos in range(16):
        ms = int(round((OFF + (bar * 4 + pos / 4.0) * BEAT) * 1000))
        if any(h["start"] - 200 < ms < h["start"] + h["hold"] + 200 for h in final_holds): continue
        d = min(abs(m["ms"] - ms) for m in notes)
        if bestb is None or d > bestb[0]: bestb = (d, ms)
    if bestb and bestb[0] >= 90:
        near = {m["col"] for m in notes if abs(m["ms"] - bestb[1]) < 260}
        near |= {h["col"] for h in final_holds if h["start"] - 260 < bestb[1] < h["start"] + h["hold"] + 260}
        free = [c for c in range(4) if c not in near]
        if free:
            notes.append(dict(ms=bestb[1], col=random.choice(free), hold=0, tag="bom", cambio=None)); bombs += 1
notes.sort(key=lambda n: (n["ms"], n["col"]))

# ---------- 8) textos (secciones) y velocidad ----------
textos = []
for s in SECTIONS:
    if s[3] == 0: continue
    ms = int(round((OFF + s[0] * BAR) * 1000))
    textos.append((max(ms - 300, 0), s[2].upper(), 2400))
SPEED = [(0, 1.5)]
for (a, b, name, lvl) in SECTIONS:
    if lvl == 0: continue
    v = {1: 1.5, 2: 1.6, 3: 1.7, 4: 1.85}[lvl]
    if SPEED[-1][1] != v:
        SPEED.append((int(round((OFF + a * BAR) * 1000)) - 700, v))

# ---------- 9) escribir .oks ----------
def fmt_note(n):
    ex = []
    if n["hold"]: ex.append("hold:%d" % n["hold"])
    if n["tag"]: ex.append('tag:"%s"' % n["tag"])
    if n["cambio"]: ex.append("cambio:[%d,%d]" % n["cambio"])
    return "[%d,%d%s]" % (n["ms"], n["col"], ("," + "{" + ",".join(ex) + "}") if ex else "")
last_ms = max(n["ms"] + n["hold"] for n in notes)
dur_s = int(round(DUR))
header = f'''({{
  id: "nocontrol",
  nombre: "NO CONTROL",
  autor: "Kasane Teto & Hatsune Miku",
  creador: "OKAOS Mod Studio",
  dificultad: "Chaos",
  star: "4.5",
  bpm: 160,
  offset: {int(round(OFF*1000))},
  velocidad: [{",".join('{time:%d,valor:%.2f}' % p for p in SPEED)}],
  duracion: "{dur_s//60:02d}:{dur_s%60:02d}",
  puntos: {len(notes)*100},
  textos: [{",".join('{time:%d,texto:"%s",duracion:%d}' % t for t in textos)}],
  notas: [{",".join(fmt_note(n) for n in notes)}]
}})
'''
os.makedirs(os.path.dirname(OUT) or ".", exist_ok=True)
open(OUT, "w", encoding="utf-8").write(header)

# ---------- reporte ----------
print(f"BPM {BPM}  offset {OFF*1000:.0f}ms  dur {DUR:.1f}s  slots {len(slots)}")
print(f"notas totales {len(notes)} (holds {sum(1 for n in notes if n['hold'])}, acordes {chords}, cambios {cam}, bombas {bombs})")
print(f"sostenidos detectados {len(sustains)} -> holds usados {len(final_holds)}")
for s in SECTIONS:
    a = (OFF + s[0] * BAR) * 1000; b = (OFF + s[1] * BAR) * 1000
    c = sum(1 for n in notes if a <= n["ms"] < b)
    print(f"  {s[2]:13s} {a/1000:6.1f}-{b/1000:6.1f}s  notas {c:4d}  ({c/((b-a)/1000):.1f}/s)")
for s_ in SECTIONS:
    a = (OFF + s_[0] * BAR) * 1000; b = (OFF + s_[1] * BAR) * 1000
    hh = [n["hold"] for n in notes if n["hold"] and a <= n["ms"] < b]
    if hh: print(f"    holds {s_[2]:13s}: {len(hh)}  avg {sum(hh)/len(hh):.0f}ms  max {max(hh)}ms")
print("lane dist:", [sum(1 for n in notes if n['col'] == c) for c in range(4)])
