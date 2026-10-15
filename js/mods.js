(function (global) {
    "use strict";

    if (global.OKAOS) return;

    const BASE_FILES = ["css/index.css", "css/music.css", "css/play.css", "css/profile.css", "css/run.css", "css/settings.css", "img/assets/arrow.png", "img/assets/bom.png", "img/assets/logros/m1.jpg", "img/assets/logros/m10.jpg", "img/assets/logros/m2.jpg", "img/assets/logros/m3.jpg", "img/assets/logros/m4.jpg", "img/assets/logros/m5.jpg", "img/assets/logros/m6.jpg", "img/assets/logros/m7.jpg", "img/assets/logros/m8.jpg", "img/assets/logros/m9.jpg", "img/assets/ranks/a.png", "img/assets/ranks/b.png", "img/assets/ranks/c.png", "img/assets/ranks/d.png", "img/assets/ranks/f.png", "img/assets/ranks/s.png", "img/assets/ranks/ss.png", "img/assets/ranks/sss.png", "img/assets/star.png", "img/c/dinzadv.png", "img/c/foxy_tp.png", "img/fn/f1.jpg", "img/fn/f2.jpg", "img/fn/f3.jpg", "img/fn/f4.jpg", "img/fn/f5.jpg", "img/fn/f6.jpg", "img/fn/f7.jpg", "img/forgegames.png", "img/icons/ic1.png", "img/icons/ic10.png", "img/icons/ic11.png", "img/icons/ic2.gif", "img/icons/ic3.png", "img/icons/ic4.png", "img/icons/ic5.png", "img/icons/ic6.png", "img/icons/ic7.png", "img/icons/ic8.png", "img/icons/ic9.png", "img/logo.jpg", "img/logo.png", "js/index.js", "js/music.js", "js/okx.js", "js/play.js", "js/profile.js", "js/run.js", "js/settings.js", "js/songs.js", "sounds/click.mp3", "sounds/click2.ogg", "sounds/music.ogg"];
    const BASE_DIFFICULTIES = ["Easy", "Medium", "Hard", "Impossible"];
    const PROBE_TTL = 120000;
    const PROBE_CONCURRENCY = 8;
    const FETCH_TIMEOUT = 6000;
    const BOOT_FAILSAFE = 12000;

    const script = document.currentScript;
    const ROOT = new URL("../", new URL(script.src)).href;
    const MODS_DIR = ROOT + "mods/";
    const PAGE = script.getAttribute("data-page") || "";
    const PAGE_SCRIPTS = (script.getAttribute("data-scripts") || "").split(",").map(function (s) { return s.trim(); }).filter(Boolean);

    const listeners = {};
    const overrides = {};
    const baseSet = new Set(BASE_FILES);
    let mods = [];
    let currentMod = null;
    let resolveReady;
    const readyPromise = new Promise(function (r) { resolveReady = r; });

    document.documentElement.setAttribute("data-page", PAGE);
    const bootStyle = document.createElement("style");
    bootStyle.id = "okaos-boot";
    bootStyle.textContent = "html{visibility:hidden!important}";
    document.head.appendChild(bootStyle);
    setTimeout(function () { bootStyle.remove(); }, BOOT_FAILSAFE);

    function encodePath(path) {
        return String(path).split("/").map(encodeURIComponent).join("/");
    }

    function cleanPath(path) {
        return String(path || "").replace(/^(\.\/|\.\.\/)+/, "").replace(/^\/+/, "");
    }

    function fetchTimeout(url, opts) {
        const ctrl = new AbortController();
        const timer = setTimeout(function () { ctrl.abort(); }, FETCH_TIMEOUT);
        return fetch(url, Object.assign({ cache: "no-store", signal: ctrl.signal }, opts || {})).finally(function () { clearTimeout(timer); });
    }

    function isHtmlResponse(res) {
        return /text\/html/i.test(res.headers.get("Content-Type") || "");
    }

    async function getJSON(url) {
        try {
            const res = await fetchTimeout(url);
            if (!res.ok || isHtmlResponse(res)) return null;
            return JSON.parse(await res.text());
        } catch (e) {
            return null;
        }
    }

    async function exists(url) {
        try {
            const res = await fetchTimeout(url, { method: "HEAD" });
            return res.ok && !isHtmlResponse(res);
        } catch (e) {
            return false;
        }
    }

    async function listDir(url) {
        const out = { dirs: [], files: [] };
        try {
            const res = await fetchTimeout(url);
            if (!res.ok || !isHtmlResponse(res)) return out;
            const doc = new DOMParser().parseFromString(await res.text(), "text/html");
            const base = new URL(url);
            doc.querySelectorAll("a[href]").forEach(function (a) {
                try {
                    const u = new URL(a.getAttribute("href"), res.url || url);
                    if (u.origin !== base.origin || u.pathname.indexOf(base.pathname) !== 0) return;
                    let rest = decodeURIComponent(u.pathname.slice(base.pathname.length));
                    if (!rest || rest.charAt(0) === ".") return;
                    if (rest.endsWith("/")) {
                        rest = rest.slice(0, -1);
                        if (rest && rest.indexOf("/") === -1) out.dirs.push(rest);
                    } else if (rest.indexOf("/") === -1) {
                        out.files.push(rest);
                    }
                } catch (e) {}
            });
        } catch (e) {}
        return out;
    }

    function pathFromUrl(url) {
        try {
            const u = new URL(url, document.baseURI);
            if (u.href.indexOf(ROOT) !== 0) return null;
            return decodeURIComponent(u.href.slice(ROOT.length).split("?")[0].split("#")[0]);
        } catch (e) {
            return null;
        }
    }

    function asset(path) {
        const p = cleanPath(path);
        return overrides[p] || (ROOT + encodePath(p));
    }

    function on(ev, fn) {
        (listeners[ev] = listeners[ev] || []).push(fn);
        return function () { off(ev, fn); };
    }

    function off(ev, fn) {
        const l = listeners[ev];
        if (!l) return;
        const i = l.indexOf(fn);
        if (i > -1) l.splice(i, 1);
    }

    function emit(ev, data) {
        const l = listeners[ev];
        if (!l || !l.length) return;
        l.slice().forEach(function (fn) {
            try { fn(data); } catch (e) { console.error("[OKAOS] " + ev, e); }
        });
    }

    const mechanicsTable = {};
    const mechanics = {
        register: function (tag, def) {
            if (!tag || !def) return;
            mechanicsTable[String(tag).toLowerCase()] = def;
        },
        get: function (tag) {
            return tag ? (mechanicsTable[String(tag).toLowerCase()] || null) : null;
        }
    };

    function normalizeDifficulties(raw) {
        const out = [];
        (Array.isArray(raw) ? raw : []).forEach(function (d) {
            const name = typeof d === "string" ? d : (d && (d.nombre || d.name));
            if (name && typeof name === "string" && out.indexOf(name) === -1) out.push(name.trim());
        });
        return out;
    }

    function asList(value) {
        return Array.isArray(value) ? value : [];
    }

    function withFolder(name, folder) {
        const n = cleanPath(name);
        return n.indexOf("/") === -1 ? folder + "/" + n : n;
    }

    async function discoverModNames() {
        const names = [];
        function push(n) {
            n = String(n || "").replace(/^\/+|\/+$/g, "");
            if (n && n.indexOf("/") === -1 && n.charAt(0) !== "." && names.indexOf(n) === -1) names.push(n);
        }
        const idx = await getJSON(MODS_DIR + "index.json");
        if (idx) asList(Array.isArray(idx) ? idx : idx.mods).forEach(function (n) { push(typeof n === "string" ? n : n && n.carpeta); });
        const listing = await listDir(MODS_DIR);
        listing.dirs.forEach(push);
        return names;
    }

    async function probeOverrides(mod) {
        const key = "okaos_probe:" + mod.id + ":" + mod.version;
        try {
            const cached = JSON.parse(sessionStorage.getItem(key) || "null");
            if (cached && Date.now() - cached.t < PROBE_TTL) return cached.f;
        } catch (e) {}
        const found = [];
        let next = 0;
        async function worker() {
            while (next < BASE_FILES.length) {
                const p = BASE_FILES[next++];
                if (await exists(mod.url(p))) found.push(p);
            }
        }
        const workers = [];
        for (let i = 0; i < PROBE_CONCURRENCY; i++) workers.push(worker());
        await Promise.all(workers);
        try { sessionStorage.setItem(key, JSON.stringify({ t: Date.now(), f: found })); } catch (e) {}
        return found;
    }

    async function collectFiles(mod, declared, folders, ext, declaredFolder) {
        const out = [];
        function add(p) { if (out.indexOf(p) === -1) out.push(p); }
        declared.forEach(function (item) {
            const name = typeof item === "string" ? item : item && (item.archivo || item.mapa || item.file);
            if (name && ext.test(name)) add(withFolder(name, declaredFolder));
        });
        for (let i = 0; i < folders.length; i++) {
            const listing = await listDir(mod.url(folders[i]) + "/");
            listing.files.filter(function (f) { return ext.test(f); }).sort().forEach(function (f) { add(folders[i] + "/" + f); });
        }
        return out;
    }

    async function loadMod(name) {
        const base = MODS_DIR + encodeURIComponent(name) + "/";
        const info = await getJSON(base + "index.json");
        if (!info || typeof info !== "object" || Array.isArray(info)) return null;
        if (info.activo === false || info.enabled === false) return null;

        const mod = {
            id: name,
            base: base,
            nombre: String(info.nombre || info.name || name),
            descripcion: String(info.descripcion || info.description || ""),
            creador: String(info.creador || info.autor || info.creator || info.author || ""),
            version: String(info.version || ""),
            prioridad: typeof info.prioridad === "number" ? info.prioridad : 0,
            dificultades: normalizeDifficulties(info.dificultades || info.difficulties),
            info: info,
            files: [],
            scripts: [],
            estilos: [],
            canciones: [],
            url: function (path) { return base + encodePath(cleanPath(path)); }
        };

        const probed = Array.isArray(info.archivos) ? [] : await probeOverrides(mod);
        const declaredFiles = asList(info.archivos).map(cleanPath).filter(Boolean);
        mod.files = probed.concat(declaredFiles.filter(function (f) { return probed.indexOf(f) === -1; }));

        const scriptKey = info.scripts ? "scripts" : (info.scrips ? "scrips" : "scripts");
        mod.scripts = await collectFiles(mod, asList(info.scripts || info.scrips), ["scripts", "scrips"], /\.js$/i, scriptKey);

        const cssAll = await collectFiles(mod, asList(info.estilos || info.css), ["css"], /\.css$/i, "css");
        mod.estilos = cssAll.filter(function (p) { return !baseSet.has(p); });

        const songDecl = asList(info.canciones || info.musica);
        mod.canciones = await collectSongItems(mod, songDecl);
        return mod;
    }

    async function collectSongItems(mod, declared) {
        const items = [];
        const seen = {};
        declared.forEach(function (item) {
            const file = typeof item === "string" ? item : item && (item.mapa || item.archivo || item.file);
            if (!file || !/\.oks$/i.test(file)) return;
            const path = withFolder(file, "musica");
            if (seen[path]) return;
            seen[path] = true;
            items.push(typeof item === "object" ? Object.assign({}, item, { file: path }) : { file: path });
        });
        const listing = await listDir(mod.url("musica") + "/");
        listing.files.filter(function (f) { return /\.oks$/i.test(f); }).sort().forEach(function (f) {
            const path = "musica/" + f;
            if (!seen[path]) { seen[path] = true; items.push({ file: path }); }
        });
        return items;
    }

    function buildOverrides() {
        Object.keys(overrides).forEach(function (k) { delete overrides[k]; });
        mods.forEach(function (mod) {
            mod.files.forEach(function (p) { overrides[p] = mod.url(p); });
        });
    }

    function waitLoad(el) {
        return new Promise(function (resolve) {
            const t = setTimeout(resolve, 5000);
            el.addEventListener("load", function () { clearTimeout(t); resolve(); }, { once: true });
            el.addEventListener("error", function () { clearTimeout(t); resolve(); }, { once: true });
        });
    }

    async function patchBaseStyles() {
        const links = Array.prototype.slice.call(document.querySelectorAll('link[rel~="stylesheet"][href]'));
        for (let i = 0; i < links.length; i++) {
            const link = links[i];
            const rel = pathFromUrl(link.href);
            if (!rel) continue;
            if (overrides[rel]) {
                link.href = overrides[rel];
                await waitLoad(link);
                continue;
            }
            if (!Object.keys(overrides).length) continue;
            let text;
            try {
                const res = await fetchTimeout(link.href, { cache: "default" });
                if (!res.ok) continue;
                text = await res.text();
            } catch (e) {
                continue;
            }
            let changed = false;
            const out = text.replace(/url\(\s*(['"]?)([^)'"]+?)\1\s*\)/g, function (m, q, u) {
                if (/^(data:|https?:|\/\/|#|blob:)/i.test(u)) return m;
                const abs = new URL(u, link.href).href;
                const r = pathFromUrl(abs);
                if (r && overrides[r]) {
                    changed = true;
                    return 'url("' + overrides[r] + '")';
                }
                return 'url("' + abs + '")';
            });
            if (changed) {
                const style = document.createElement("style");
                style.textContent = out;
                link.parentNode.insertBefore(style, link.nextSibling);
                link.remove();
            }
        }
    }

    async function addModStyles() {
        for (let i = 0; i < mods.length; i++) {
            for (let j = 0; j < mods[i].estilos.length; j++) {
                const link = document.createElement("link");
                link.rel = "stylesheet";
                link.href = mods[i].url(mods[i].estilos[j]);
                link.setAttribute("data-mod", mods[i].id);
                document.head.appendChild(link);
                await waitLoad(link);
            }
        }
    }

    function currentPagePath() {
        let p = pathFromUrl(location.href);
        if (p === null) return null;
        if (p === "" || p.endsWith("/")) p += "index.html";
        return p;
    }

    async function applyPageOverride() {
        const page = currentPagePath();
        if (!page || !overrides[page]) return;
        try {
            const res = await fetchTimeout(overrides[page]);
            if (!res.ok) return;
            const doc = new DOMParser().parseFromString(await res.text(), "text/html");
            if (!doc.body) return;
            const modHeadStyles = Array.prototype.slice.call(doc.head.querySelectorAll('link[rel~="stylesheet"][href], style'));
            if (modHeadStyles.length) {
                document.head.querySelectorAll('link[rel~="stylesheet"][href]').forEach(function (l) {
                    if (pathFromUrl(l.href)) l.remove();
                });
                const pending = [];
                modHeadStyles.forEach(function (node) {
                    const clone = node.cloneNode(true);
                    if (clone.tagName === "LINK") {
                        clone.href = new URL(node.getAttribute("href"), overrides[page]).href;
                        const dup = Array.prototype.some.call(document.head.querySelectorAll('link[rel~="stylesheet"]'), function (l) { return l.href === clone.href; });
                        if (dup) return;
                        pending.push(waitLoad(clone));
                    }
                    document.head.appendChild(clone);
                });
                await Promise.all(pending);
            }
            if (doc.title) document.title = doc.title;
            Array.prototype.slice.call(doc.body.attributes).forEach(function (a) { document.body.setAttribute(a.name, a.value); });
            document.body.innerHTML = doc.body.innerHTML;
            document.body.querySelectorAll("script").forEach(function (s) { s.remove(); });
        } catch (e) {
            console.warn("[OKAOS] no se pudo aplicar la pagina del mod", e);
        }
    }

    function applyDomAssets(root) {
        const nodes = [];
        if (root.nodeType === 1) nodes.push(root);
        if (root.querySelectorAll) {
            Array.prototype.push.apply(nodes, root.querySelectorAll('img[src],source[src],audio[src],video[src],link[rel~="icon"][href]'));
        }
        nodes.forEach(function (el) {
            const tag = el.tagName;
            if (tag !== "IMG" && tag !== "SOURCE" && tag !== "AUDIO" && tag !== "VIDEO" && tag !== "LINK") return;
            const attr = tag === "LINK" ? "href" : "src";
            const v = el.getAttribute(attr);
            if (!v) return;
            const rel = pathFromUrl(v);
            if (rel && overrides[rel] && v !== overrides[rel]) el.setAttribute(attr, overrides[rel]);
        });
    }

    function watchDomAssets() {
        if (!Object.keys(overrides).length) return;
        applyDomAssets(document);
        new MutationObserver(function (records) {
            records.forEach(function (r) {
                if (r.type === "attributes") applyDomAssets(r.target);
                else r.addedNodes.forEach(function (n) { if (n.nodeType === 1) applyDomAssets(n); });
            });
        }).observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ["src", "href"] });
    }

    function loadScript(url) {
        return new Promise(function (resolve) {
            const s = document.createElement("script");
            s.src = url;
            s.async = false;
            s.onload = function () { resolve(true); };
            s.onerror = function () { console.warn("[OKAOS] no se pudo cargar " + url); resolve(false); };
            document.body.appendChild(s);
        });
    }

    function domReady() {
        if (document.readyState !== "loading") return Promise.resolve();
        return new Promise(function (r) { document.addEventListener("DOMContentLoaded", r, { once: true }); });
    }

    function difficulties() {
        const out = BASE_DIFFICULTIES.slice();
        mods.forEach(function (m) {
            m.dificultades.forEach(function (d) {
                if (!out.some(function (x) { return x.toLowerCase() === d.toLowerCase(); })) out.push(d);
            });
        });
        return out;
    }

    const OKAOS = {
        root: ROOT,
        page: PAGE,
        get mods() { return mods; },
        get currentMod() { return currentMod; },
        ready: readyPromise,
        asset: asset,
        mod: function (id) {
            return mods.filter(function (m) { return m.id === id; })[0] || null;
        },
        difficulties: difficulties,
        on: on,
        off: off,
        emit: emit,
        mechanics: mechanics,
        game: null
    };
    global.OKAOS = OKAOS;

    async function boot() {
        try {
            try {
                const names = await discoverModNames();
                const loaded = await Promise.all(names.map(loadMod));
                mods = loaded.filter(Boolean).sort(function (a, b) {
                    return (a.prioridad - b.prioridad) || a.id.toLowerCase().localeCompare(b.id.toLowerCase());
                });
            } catch (e) {
                mods = [];
            }
            buildOverrides();
            await domReady();
            await applyPageOverride();
            await patchBaseStyles();
            await addModStyles();
            watchDomAssets();

            for (let i = 0; i < PAGE_SCRIPTS.length; i++) {
                const p = "js/" + PAGE_SCRIPTS[i] + ".js";
                await loadScript(overrides[p] || (ROOT + p));
            }
            for (let i = 0; i < mods.length; i++) {
                for (let j = 0; j < mods[i].scripts.length; j++) {
                    currentMod = mods[i];
                    await loadScript(mods[i].url(mods[i].scripts[j]));
                }
            }
            currentMod = null;
        } catch (e) {
            console.error("[OKAOS] error de arranque", e);
        } finally {
            bootStyle.remove();
            resolveReady(OKAOS);
            emit("ready", OKAOS);
        }
    }

    boot();
})(window);
