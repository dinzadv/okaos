(function (global) {
    "use strict";

    function resolveRoot() {
        const cs = document.currentScript;
        if (cs && cs.src) {
            const jsDirUrl = new URL("./", cs.src);
            return new URL("../", jsDirUrl).toString();
        }
        if (global.OKAOS && global.OKAOS.root) return global.OKAOS.root;
        return "../";
    }

    const ROOT = (global.OKAOS && global.OKAOS.root) || resolveRoot();
    const MAPAS_DIR = ROOT + "mapas/";
    const INDEX_URL = MAPAS_DIR + "index.oks";
    const SCAN_CONCURRENCY = 6;
    const DB_NAME = "okaos-custom";
    const DB_STORE = "songs";
    const AUDIO_EXT = { mp3: 1, ogg: 1, oga: 1, opus: 1, wav: 1, flac: 1, m4a: 1, aac: 1, weba: 1 };
    const IMAGE_EXT = { jpg: 1, jpeg: 1, png: 1, webp: 1, gif: 1, bmp: 1, avif: 1 };
    const VIDEO_EXT = { mp4: 1, webm: 1, ogv: 1, m4v: 1, mov: 1 };
    const PROBE_TTL = 120000;

    let indexPromise = null;
    let indexById = null;
    const rejected = [];
    const customUrls = {};

    function hashName(str) {
        let h = 2166136261;
        for (let i = 0; i < str.length; i++) {
            h ^= str.charCodeAt(i);
            h = Math.imul(h, 16777619);
        }
        return (h >>> 0) % 900000000 + 100000;
    }

    function numOf(id) {
        const m = String(id).match(/\d+/);
        return m ? parseInt(m[0], 10) : Infinity;
    }

    function slug(str) {
        return String(str).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "x";
    }

    function extOf(name) {
        const m = /\.([A-Za-z0-9]+)\s*$/.exec(String(name || ""));
        return m ? m[1].toLowerCase() : "";
    }

    function baseOf(name) {
        return String(name || "").replace(/^.*[\\/]/, "").replace(/\.[A-Za-z0-9]+\s*$/, "");
    }

    function fmtDuration(ms) {
        const total = Math.max(0, Math.round(ms / 1000));
        const m = Math.floor(total / 60);
        const s = total % 60;
        return String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0");
    }

    function logoUrl() {
        return global.OKAOS ? global.OKAOS.asset("img/logo.jpg") : ROOT + "img/logo.jpg";
    }

    function activeMods() {
        return (global.OKAOS && global.OKAOS.mods) || [];
    }

    async function listFromDirectory() {
        const names = [];
        try {
            const res = await fetch(MAPAS_DIR, { cache: "no-store" });
            if (!res.ok) return names;
            const html = await res.text();
            const doc = new DOMParser().parseFromString(html, "text/html");
            const base = new URL(MAPAS_DIR);
            doc.querySelectorAll("a[href]").forEach(function (a) {
                try {
                    const u = new URL(a.getAttribute("href"), res.url || MAPAS_DIR);
                    if (u.origin !== base.origin || u.pathname.indexOf(base.pathname) !== 0) return;
                    const rest = decodeURIComponent(u.pathname.slice(base.pathname.length));
                    if (!rest || rest.indexOf("/") !== -1) return;
                    if (/\.okx$/i.test(rest)) names.push(rest);
                } catch (e) {}
            });
        } catch (e) {}
        return names;
    }

    async function listFromIndexFile() {
        try {
            const res = await fetch(INDEX_URL, { cache: "no-store" });
            if (!res.ok) return [];
            const list = OKX.parseOKS(await res.text());
            return (Array.isArray(list) ? list : [])
                .map(function (e) { return e && e.file; })
                .filter(function (f) { return typeof f === "string" && /\.okx$/i.test(f); });
        } catch (e) {
            return [];
        }
    }

    function urlForFile(file) {
        return MAPAS_DIR + encodeURIComponent(file);
    }

    function okxUrlFor(entry) {
        if (entry.source === "custom") return customUrl(entry.id, "okx");
        return urlForFile(entry.file);
    }

    function entryFromHeader(h, file, report) {
        return {
            id: h.id,
            file: file,
            source: "base",
            nombre: h.nombre || file.replace(/\.okx$/i, ""),
            autor: h.autor || "",
            creador: h.creador || "",
            dificultad: h.dificultad || "Medium",
            star: h.star != null ? String(h.star) : "0",
            bpm: h.bpm || 0,
            duracion: h.duracion || "00:00",
            puntos: h.puntos || 0,
            hasVideo: report.hasVideo
        };
    }

    async function scanFile(file) {
        const url = urlForFile(file);
        try {
            const report = await OKX.inspect(url);
            if (!report.ok) {
                rejected.push({ file: file, errors: report.errors });
                console.warn("[OKX] '" + file + "' ignorado:", report.errors.join(" | "));
                return null;
            }
            return entryFromHeader(report.header, file, report);
        } catch (err) {
            const reason = err && err.message === "okx-bad-magic" ? "no es un OKX1 valido" : (err && err.message) || "error";
            rejected.push({ file: file, errors: [reason] });
            console.warn("[OKX] '" + file + "' ignorado:", reason);
            return null;
        }
    }

    async function scanAll(files) {
        const results = new Array(files.length);
        let next = 0;
        async function worker() {
            while (next < files.length) {
                const i = next++;
                results[i] = await scanFile(files[i]);
            }
        }
        const workers = [];
        for (let i = 0; i < Math.min(SCAN_CONCURRENCY, files.length); i++) workers.push(worker());
        await Promise.all(workers);
        return results.filter(Boolean);
    }

    function assignIds(entries) {
        const used = new Set();
        entries.sort(function (a, b) { return a.file.localeCompare(b.file); });
        entries.forEach(function (e) {
            let id = /^m\d+$/.test(String(e.id)) ? String(e.id) : null;
            if (!id || used.has(id)) {
                let n = hashName(e.file);
                id = "m" + n;
                while (used.has(id)) id = "m" + (++n);
            }
            e.id = id;
            used.add(id);
        });
        entries.sort(function (a, b) {
            return (numOf(a.id) - numOf(b.id)) || a.nombre.localeCompare(b.nombre);
        });
        return entries;
    }

    function metaFromMap(map, fallbackName) {
        const notas = Array.isArray(map.notas) ? map.notas : [];
        let last = 0;
        notas.forEach(function (n) {
            const end = (n[0] || 0) + ((n[2] && n[2].hold) || 0);
            if (end > last) last = end;
        });
        return {
            nombre: map.nombre || fallbackName,
            autor: map.autor || "",
            creador: map.creador || "",
            dificultad: map.dificultad || "Medium",
            star: map.star != null ? String(map.star) : "0",
            bpm: map.bpm || 0,
            duracion: map.duracion || fmtDuration(last + 2000),
            puntos: map.puntos || notas.length * 100
        };
    }

    function probeCacheGet(key) {
        try {
            const c = JSON.parse(sessionStorage.getItem(key) || "null");
            if (c && Date.now() - c.t < PROBE_TTL) return c.v;
        } catch (e) {}
        return undefined;
    }

    function probeCacheSet(key, value) {
        try { sessionStorage.setItem(key, JSON.stringify({ t: Date.now(), v: value })); } catch (e) {}
    }

    async function headOk(url) {
        try {
            const res = await fetch(url, { method: "HEAD", cache: "no-store" });
            return res.ok && !/text\/html/i.test(res.headers.get("Content-Type") || "");
        } catch (e) {
            return false;
        }
    }

    function modAssetUrl(mod, name) {
        if (/^(https?:|blob:|data:)/i.test(name)) return name;
        return /\//.test(name) ? mod.url(name) : mod.url("assets/" + name);
    }

    async function probeModAsset(mod, base, table) {
        const key = "okaos_asset:" + mod.id + ":" + base + ":" + Object.keys(table)[0];
        const cached = probeCacheGet(key);
        if (cached !== undefined) return cached;
        const exts = Object.keys(table);
        let found = null;
        for (let i = 0; i < exts.length && !found; i++) {
            const name = base + "." + exts[i];
            if (await headOk(mod.url("assets/" + name))) found = name;
        }
        probeCacheSet(key, found);
        return found;
    }

    async function resolveModAsset(mod, explicit, base, table) {
        if (explicit) return modAssetUrl(mod, explicit);
        const name = await probeModAsset(mod, base, table);
        return name ? mod.url("assets/" + name) : null;
    }

    async function scanModSong(mod, item) {
        const label = mod.id + "/" + item.file;
        try {
            const res = await fetch(mod.url(item.file), { cache: "no-store" });
            if (!res.ok) throw new Error("http-" + res.status);
            const map = OKX.parseOKS(await res.text());
            if (!map || !Array.isArray(map.notas) || !map.notas.length) throw new Error("sin notas");
            const base = baseOf(item.file);
            const audioUrl = await resolveModAsset(mod, item.audio || map.audio, base, AUDIO_EXT);
            if (!audioUrl) throw new Error("falta audio en assets/");
            const fondoUrl = await resolveModAsset(mod, item.fondo || map.fondo, base, IMAGE_EXT);
            const videoUrl = await resolveModAsset(mod, item.video || map.video, base, VIDEO_EXT);
            const meta = metaFromMap(map, base);
            return Object.assign({
                id: "mod-" + slug(mod.id) + "-" + slug(base),
                source: "mod",
                mod: mod.id,
                oksUrl: mod.url(item.file),
                audioUrl: audioUrl,
                fondoUrl: fondoUrl,
                videoUrl: videoUrl,
                hasVideo: !!videoUrl
            }, meta);
        } catch (err) {
            const reason = (err && err.message) || "error";
            rejected.push({ file: label, errors: [reason] });
            console.warn("[OKAOS] cancion de mod '" + label + "' ignorada:", reason);
            return null;
        }
    }

    async function scanModSongs() {
        const out = [];
        const used = new Set();
        const mods = activeMods();
        for (let i = 0; i < mods.length; i++) {
            const found = await Promise.all(mods[i].canciones.map(function (item) { return scanModSong(mods[i], item); }));
            found.filter(Boolean).forEach(function (e) {
                let id = e.id;
                let n = 2;
                while (used.has(id)) id = e.id + "-" + (n++);
                e.id = id;
                used.add(id);
                out.push(e);
            });
        }
        return out;
    }

    function openDb() {
        return new Promise(function (resolve, reject) {
            if (!global.indexedDB) { reject(new Error("idb-no-disponible")); return; }
            const req = indexedDB.open(DB_NAME, 1);
            req.onupgradeneeded = function () {
                if (!req.result.objectStoreNames.contains(DB_STORE)) req.result.createObjectStore(DB_STORE, { keyPath: "id" });
            };
            req.onsuccess = function () { resolve(req.result); };
            req.onerror = function () { reject(req.error || new Error("idb-error")); };
        });
    }

    async function dbRun(mode, fn) {
        const db = await openDb();
        return new Promise(function (resolve, reject) {
            const tx = db.transaction(DB_STORE, mode);
            const store = tx.objectStore(DB_STORE);
            const req = fn(store);
            tx.oncomplete = function () { db.close(); resolve(req ? req.result : undefined); };
            tx.onerror = function () { db.close(); reject(tx.error || new Error("idb-error")); };
            tx.onabort = function () { db.close(); reject(tx.error || new Error("idb-abort")); };
        });
    }

    async function dbAll() {
        try {
            return (await dbRun("readonly", function (s) { return s.getAll(); })) || [];
        } catch (e) {
            return [];
        }
    }

    function dbPut(rec) {
        return dbRun("readwrite", function (s) { return s.put(rec); });
    }

    function dbDelete(id) {
        return dbRun("readwrite", function (s) { return s.delete(id); });
    }

    function customUrl(id, key) {
        const slot = customUrls[id] || (customUrls[id] = {});
        return slot[key] || null;
    }

    function prepareCustom(rec) {
        const slot = customUrls[rec.id] || (customUrls[rec.id] = {});
        if (rec.kind === "okx") {
            if (!slot.okx) slot.okx = URL.createObjectURL(rec.blob);
        } else {
            if (!slot.audio && rec.audio) slot.audio = URL.createObjectURL(rec.audio);
            if (!slot.fondo && rec.fondo) slot.fondo = URL.createObjectURL(rec.fondo);
            if (!slot.video && rec.video) slot.video = URL.createObjectURL(rec.video);
        }
    }

    function dropCustomUrls(id) {
        const slot = customUrls[id];
        if (!slot) return;
        Object.keys(slot).forEach(function (k) {
            try { URL.revokeObjectURL(slot[k]); } catch (e) {}
        });
        delete customUrls[id];
    }

    function entryFromCustom(rec) {
        return Object.assign({
            id: rec.id,
            source: "custom",
            kind: rec.kind,
            oksText: rec.oks || null,
            added: rec.added || 0,
            hasVideo: !!rec.hasVideo
        }, rec.meta);
    }

    async function loadCustomSongs() {
        const recs = (await dbAll()).sort(function (a, b) { return (a.added || 0) - (b.added || 0); });
        recs.forEach(prepareCustom);
        return recs.map(entryFromCustom);
    }

    async function loadIndex() {
        if (indexPromise) return indexPromise;
        indexPromise = (async function () {
            const found = await Promise.all([listFromDirectory(), listFromIndexFile()]);
            const seen = new Set();
            const files = [];
            found[0].concat(found[1]).forEach(function (f) {
                const k = f.toLowerCase();
                if (!seen.has(k)) { seen.add(k); files.push(f); }
            });
            const baseEntries = assignIds(await scanAll(files));
            const results = await Promise.all([scanModSongs(), loadCustomSongs()]);
            const entries = baseEntries.concat(results[0], results[1]);
            indexById = {};
            entries.forEach(function (entry) {
                indexById[entry.id] = entry;
                if (entry.source === "base") {
                    const numMatch = String(entry.id).match(/\d+/);
                    if (numMatch && !indexById[numMatch[0]]) indexById[numMatch[0]] = entry;
                }
            });
            return entries;
        })();
        indexPromise.catch(function () { indexPromise = null; });
        return indexPromise;
    }

    function buildNotes(mapData) {
        return mapData.notas.map(function (n) {
            const extra = n[2] || {};
            return {
                time: n[0],
                col: n[1],
                damage: extra.damage,
                "life-perfect": extra.lp,
                "life-comun": extra.lc,
                "life-okey": extra.lo,
                hold: extra.hold,
                tag: extra.tag,
                cambio: extra.cambio ? { time: extra.cambio[0], col: extra.cambio[1] } : null,
                extra: extra
            };
        });
    }

    function finishSong(entry, mapText, fondoUrl, audioUrl, videoUrl) {
        const mapData = OKX.parseOKS(mapText);
        if (!mapData || !Array.isArray(mapData.notas)) throw new Error("map-invalid");
        const portada = fondoUrl || logoUrl();
        return {
            id: entry.id,
            nombre: mapData.nombre || entry.nombre,
            autor: mapData.autor || entry.autor,
            creador: mapData.creador || entry.creador,
            dificultad: mapData.dificultad || entry.dificultad,
            star: mapData.star != null ? mapData.star : entry.star,
            bpm: mapData.bpm || entry.bpm,
            velocidad: mapData.velocidad,
            duracion: mapData.duracion || entry.duracion,
            puntos: mapData.puntos || entry.puntos,
            textos: mapData.textos || [],
            notes: buildNotes(mapData),
            meta: mapData,
            source: entry.source,
            mod: entry.mod || null,
            fondo: fondoUrl,
            portada: portada,
            audio: audioUrl,
            video: videoUrl
        };
    }

    function isOkxEntry(entry) {
        return entry.source === "base" || (entry.source === "custom" && entry.kind === "okx");
    }

    function normalizeId(rawId) {
        if (rawId == null) return null;
        return String(rawId);
    }

    async function inspectOkxBlob(blob) {
        const url = URL.createObjectURL(blob);
        try {
            const report = await OKX.inspect(url);
            return { url: url, report: report };
        } catch (err) {
            URL.revokeObjectURL(url);
            throw err;
        }
    }

    function pickMedia(media, explicitName, base, table) {
        const candidates = media.filter(function (f) { return table[extOf(f.name)]; });
        if (explicitName) {
            const hit = candidates.filter(function (f) { return f.name.toLowerCase() === String(explicitName).toLowerCase(); })[0];
            if (hit) return hit;
        }
        const same = candidates.filter(function (f) { return baseOf(f.name).toLowerCase() === base.toLowerCase(); })[0];
        if (same) return same;
        return candidates.length === 1 ? candidates[0] : null;
    }

    async function importOkx(file) {
        const inspected = await inspectOkxBlob(file);
        const report = inspected.report;
        if (!report.ok) {
            URL.revokeObjectURL(inspected.url);
            throw new Error(file.name + ": " + report.errors.join(", "));
        }
        const h = report.header;
        const id = "u-" + hashName(file.name + ":" + file.size);
        dropCustomUrls(id);
        const rec = {
            id: id,
            kind: "okx",
            blob: file,
            added: Date.now(),
            hasVideo: report.hasVideo,
            meta: {
                nombre: h.nombre || baseOf(file.name),
                autor: h.autor || "",
                creador: h.creador || "",
                dificultad: h.dificultad || "Medium",
                star: h.star != null ? String(h.star) : "0",
                bpm: h.bpm || 0,
                duracion: h.duracion || "00:00",
                puntos: h.puntos || 0
            }
        };
        URL.revokeObjectURL(inspected.url);
        await dbPut(rec);
        return id;
    }

    async function importOks(file, media) {
        const text = await file.text();
        let map;
        try {
            map = OKX.parseOKS(text);
        } catch (e) {
            throw new Error(file.name + ": mapa .oks invalido");
        }
        if (!map || !Array.isArray(map.notas) || !map.notas.length) throw new Error(file.name + ": el mapa no tiene notas");
        const base = baseOf(file.name);
        const audio = pickMedia(media, map.audio, base, AUDIO_EXT);
        if (!audio) throw new Error(file.name + ": falta el audio");
        const fondo = pickMedia(media, map.fondo, base, IMAGE_EXT);
        const video = pickMedia(media, map.video, base, VIDEO_EXT);
        const id = "u-" + hashName(file.name + ":" + file.size);
        dropCustomUrls(id);
        const rec = {
            id: id,
            kind: "oks",
            oks: text,
            audio: audio,
            fondo: fondo,
            video: video,
            added: Date.now(),
            hasVideo: !!video,
            meta: metaFromMap(map, base)
        };
        await dbPut(rec);
        return id;
    }

    const SONGS = {
        root: ROOT,

        async list() {
            return loadIndex();
        },

        async reload() {
            indexPromise = null;
            indexById = null;
            rejected.length = 0;
            return loadIndex();
        },

        async rejected() {
            await loadIndex();
            return rejected.slice();
        },

        async entryFor(rawId) {
            await loadIndex();
            const id = normalizeId(rawId);
            if (id == null) return null;
            return indexById[id] || indexById["m" + id] || null;
        },

        isCustom(entry) {
            return !!entry && entry.source === "custom";
        },

        async importFiles(fileList) {
            const files = Array.prototype.slice.call(fileList || []);
            const okx = files.filter(function (f) { return extOf(f.name) === "okx"; });
            const oks = files.filter(function (f) { return extOf(f.name) === "oks"; });
            const media = files.filter(function (f) {
                const e = extOf(f.name);
                return AUDIO_EXT[e] || IMAGE_EXT[e] || VIDEO_EXT[e];
            });
            const added = [];
            const errors = [];
            if (!okx.length && !oks.length) {
                errors.push("Selecciona un archivo .okx o un mapa .oks con su audio");
                return { added: added, errors: errors };
            }
            for (let i = 0; i < okx.length; i++) {
                try { added.push(await importOkx(okx[i])); } catch (e) { errors.push((e && e.message) || "No se pudo importar " + okx[i].name); }
            }
            for (let i = 0; i < oks.length; i++) {
                try { added.push(await importOks(oks[i], media)); } catch (e) { errors.push((e && e.message) || "No se pudo importar " + oks[i].name); }
            }
            if (added.length) await SONGS.reload();
            return { added: added, errors: errors };
        },

        async removeCustom(rawId) {
            const entry = await SONGS.entryFor(rawId);
            if (!entry || entry.source !== "custom") return false;
            await dbDelete(entry.id);
            dropCustomUrls(entry.id);
            await SONGS.reload();
            return true;
        },

        async getThumbUrl(rawId) {
            const entry = await SONGS.entryFor(rawId);
            if (!entry) return null;
            if (entry.source === "mod") return entry.fondoUrl || logoUrl();
            if (entry.source === "custom" && entry.kind === "oks") return customUrl(entry.id, "fondo") || logoUrl();
            const url = okxUrlFor(entry);
            const header = await OKX.header(url);
            return OKX.entryUrl(url, header, "fondo", url + ":fondo:" + entry.id);
        },

        async getLight(rawId) {
            const entry = await SONGS.entryFor(rawId);
            if (!entry) return null;
            const fondoUrl = await SONGS.getThumbUrl(entry.id);
            return {
                id: entry.id,
                nombre: entry.nombre,
                autor: entry.autor,
                dificultad: entry.dificultad,
                star: entry.star,
                bpm: entry.bpm,
                duracion: entry.duracion,
                puntos: entry.puntos,
                hasVideo: entry.hasVideo,
                fondo: fondoUrl,
                portada: fondoUrl
            };
        },

        async getAudioUrl(rawId) {
            const entry = await SONGS.entryFor(rawId);
            if (!entry) return null;
            if (entry.source === "mod") return entry.audioUrl;
            if (entry.source === "custom" && entry.kind === "oks") return customUrl(entry.id, "audio");
            const url = okxUrlFor(entry);
            const header = await OKX.header(url);
            return OKX.entryUrl(url, header, "audio", url + ":audio:" + entry.id);
        },

        async getVideoUrl(rawId) {
            const entry = await SONGS.entryFor(rawId);
            if (!entry || !entry.hasVideo) return null;
            if (entry.source === "mod") return entry.videoUrl;
            if (entry.source === "custom" && entry.kind === "oks") return customUrl(entry.id, "video");
            const url = okxUrlFor(entry);
            const header = await OKX.header(url);
            return OKX.entryUrl(url, header, "video", url + ":video:" + entry.id);
        },

        async getFull(rawId, opts) {
            opts = opts || {};
            const entry = await SONGS.entryFor(rawId);
            if (!entry) throw new Error("song-not-found");

            if (isOkxEntry(entry)) {
                const url = okxUrlFor(entry);
                const header = await OKX.header(url);
                const fondoUrlPromise = OKX.entryUrl(url, header, "fondo", url + ":fondo:" + entry.id);
                const audioUrlPromise = OKX.entryUrl(url, header, "audio", url + ":audio:" + entry.id);
                const videoUrlPromise = (opts.video !== false && entry.hasVideo)
                    ? OKX.entryUrl(url, header, "video", url + ":video:" + entry.id)
                    : Promise.resolve(null);
                const mapTextPromise = OKX.entryText(url, header, "map");
                const parts = await Promise.all([fondoUrlPromise, audioUrlPromise, videoUrlPromise, mapTextPromise]);
                return finishSong(entry, parts[3], parts[0], parts[1], parts[2]);
            }

            if (entry.source === "mod") {
                const res = await fetch(entry.oksUrl, { cache: "no-store" });
                if (!res.ok) throw new Error("map-http-" + res.status);
                return finishSong(entry, await res.text(), entry.fondoUrl, entry.audioUrl, opts.video !== false ? entry.videoUrl : null);
            }

            return finishSong(
                entry,
                entry.oksText,
                customUrl(entry.id, "fondo"),
                customUrl(entry.id, "audio"),
                opts.video !== false ? customUrl(entry.id, "video") : null
            );
        }
    };

    global.SONGS = SONGS;
})(typeof window !== "undefined" ? window : this);
