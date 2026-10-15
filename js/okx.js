(function (global) {
    "use strict";

    const OKX_MAGIC = "OKX1";
    const HEADER_PROBE_BYTES = 8192;
    const MAX_HEADER_BYTES = 1048576;
    const PARTIAL_STREAM_LIMIT = 1048576;

    const AUDIO_EXT = { mp3: "audio/mpeg", ogg: "audio/ogg", oga: "audio/ogg", opus: "audio/ogg", wav: "audio/wav", flac: "audio/flac", m4a: "audio/mp4", aac: "audio/aac", weba: "audio/webm" };
    const IMAGE_EXT = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif", bmp: "image/bmp", avif: "image/avif" };
    const VIDEO_EXT = { mp4: "video/mp4", webm: "video/webm", ogv: "video/ogg", m4v: "video/mp4", mov: "video/quicktime" };

    const fullBufferCache = new Map();
    const headerCache = new Map();
    const sizeCache = new Map();
    const objectUrlRegistry = new Map();

    function revoke(key) {
        const existing = objectUrlRegistry.get(key);
        if (existing) {
            try { URL.revokeObjectURL(existing); } catch (e) {}
            objectUrlRegistry.delete(key);
        }
    }

    function makeObjectUrl(key, bytes, mime) {
        revoke(key);
        const blob = new Blob([bytes], { type: mime || "application/octet-stream" });
        const url = URL.createObjectURL(blob);
        objectUrlRegistry.set(key, url);
        return url;
    }

    async function readStreamUpTo(res, limit) {
        if (!res.body || !res.body.getReader) {
            const all = await res.arrayBuffer();
            return all.slice(0, limit);
        }
        const reader = res.body.getReader();
        const chunks = [];
        let got = 0;
        while (got < limit) {
            const r = await reader.read();
            if (r.done) break;
            chunks.push(r.value);
            got += r.value.byteLength;
        }
        try { await reader.cancel(); } catch (e) {}
        const out = new Uint8Array(Math.min(got, limit));
        let pos = 0;
        for (const c of chunks) {
            const room = out.length - pos;
            if (room <= 0) break;
            out.set(c.byteLength > room ? c.subarray(0, room) : c, pos);
            pos += Math.min(c.byteLength, room);
        }
        return out.buffer;
    }

    async function fetchRange(url, start, end) {
        const res = await fetch(url, {
            cache: "no-store",
            headers: { Range: "bytes=" + start + "-" + end }
        });
        if (res.status === 206) {
            const m = /\/(\d+)\s*$/.exec(res.headers.get("Content-Range") || "");
            if (m) sizeCache.set(url, parseInt(m[1], 10));
            const buf = await res.arrayBuffer();
            return { buf, partial: true };
        }
        if (res.status === 200) {
            const len = parseInt(res.headers.get("Content-Length") || "", 10);
            if (len > 0) sizeCache.set(url, len);
            if (end + 1 <= PARTIAL_STREAM_LIMIT) {
                const head = await readStreamUpTo(res, end + 1);
                return { buf: head.slice(start), partial: false };
            }
            const buf = await res.arrayBuffer();
            sizeCache.set(url, buf.byteLength);
            fullBufferCache.set(url, Promise.resolve(buf));
            return { buf: buf.slice(start, Math.min(end + 1, buf.byteLength)), partial: false };
        }
        throw new Error("okx-http-" + res.status);
    }

    async function fetchSlice(url, start, end) {
        if (fullBufferCache.has(url)) {
            const buf = await fullBufferCache.get(url);
            return buf.slice(start, Math.min(end + 1, buf.byteLength));
        }
        const { buf } = await fetchRange(url, start, end);
        return buf;
    }

    async function fetchFull(url) {
        if (!fullBufferCache.has(url)) {
            fullBufferCache.set(url, fetch(url, { cache: "no-store" }).then(function (res) {
                if (!res.ok) throw new Error("okx-http-" + res.status);
                return res.arrayBuffer();
            }));
        }
        return fullBufferCache.get(url);
    }

    async function readHeader(url) {
        if (headerCache.has(url)) return headerCache.get(url);

        const promise = (async function () {
            const probe = await fetchSlice(url, 0, HEADER_PROBE_BYTES - 1);
            if (probe.byteLength < 8) throw new Error("okx-bad-magic");
            const magic = new TextDecoder().decode(new Uint8Array(probe, 0, 4));
            if (magic !== OKX_MAGIC) throw new Error("okx-bad-magic");
            const headerLen = new DataView(probe).getUint32(4, true);
            if (headerLen <= 0 || headerLen > MAX_HEADER_BYTES) throw new Error("okx-bad-header");
            const prefixLen = 8 + headerLen;

            let headerBytes;
            if (probe.byteLength >= prefixLen) {
                headerBytes = probe.slice(8, prefixLen);
            } else {
                headerBytes = await fetchSlice(url, 8, prefixLen - 1);
            }
            let header;
            try {
                header = JSON.parse(new TextDecoder("utf-8").decode(headerBytes));
            } catch (e) {
                throw new Error("okx-bad-header");
            }
            if (!header || typeof header !== "object" || !header.files || typeof header.files !== "object") {
                throw new Error("okx-bad-header");
            }
            Object.defineProperty(header, "__prefixLen", { value: prefixLen, enumerable: false });
            Object.defineProperty(header, "__url", { value: url, enumerable: false });
            return header;
        })();

        headerCache.set(url, promise);
        promise.catch(function () { headerCache.delete(url); });
        return promise;
    }

    function extOf(name) {
        const m = /\.([A-Za-z0-9]+)\s*$/.exec(String(name || ""));
        return m ? m[1].toLowerCase() : "";
    }

    function baseOf(name) {
        return String(name || "").replace(/\.[A-Za-z0-9]+\s*$/, "").toLowerCase();
    }

    function findEntry(header, base) {
        const files = header.files || {};
        if (files[base]) return files[base];
        const keys = Object.keys(files);
        for (let i = 0; i < keys.length; i++) {
            const e = files[keys[i]];
            if (e && baseOf(e.name) === base) return e;
        }
        return null;
    }

    function checkMedia(entry, label, table, prefix, errors) {
        const ext = extOf(entry.name);
        const mime = String(entry.mime || "").toLowerCase();
        const mimeOk = mime.indexOf(prefix + "/") === 0;
        if (!mimeOk && !table[ext]) {
            errors.push(label + ": formato no valido (" + (entry.name || entry.mime || "sin nombre") + ")");
            return null;
        }
        return mimeOk ? mime : table[ext];
    }

    function inspect(header, totalSize) {
        const errors = [];
        const out = { fondo: null, audio: null, map: null, video: null };
        const bodyStart = header.__prefixLen || 0;

        function checkRange(entry, label) {
            const off = entry.offset, len = entry.length;
            if (!Number.isInteger(off) || !Number.isInteger(len) || off < bodyStart || len <= 0) {
                errors.push(label + ": offset/length invalidos");
                return false;
            }
            if (totalSize && off + len > totalSize) {
                errors.push(label + ": el archivo esta incompleto o cortado");
                return false;
            }
            return true;
        }

        const fondo = findEntry(header, "fondo");
        if (!fondo) errors.push("falta fondo (fondo.jpg / png / webp ...)");
        else {
            const mime = checkMedia(fondo, "fondo", IMAGE_EXT, "image", errors);
            if (mime && checkRange(fondo, "fondo")) out.fondo = Object.assign({}, fondo, { mime: mime });
        }

        const audio = findEntry(header, "audio");
        if (!audio) errors.push("falta audio (audio.mp3 / ogg / wav ...)");
        else {
            const mime = checkMedia(audio, "audio", AUDIO_EXT, "audio", errors);
            if (mime && checkRange(audio, "audio")) out.audio = Object.assign({}, audio, { mime: mime });
        }

        const map = findEntry(header, "map");
        if (!map) errors.push("falta map.oks");
        else if (map.name && extOf(map.name) !== "oks") errors.push("map: debe ser .oks (" + map.name + ")");
        else if (checkRange(map, "map")) out.map = Object.assign({}, map, { mime: "application/x-oks" });

        const video = findEntry(header, "video");
        if (video) {
            const mime = checkMedia(video, "video", VIDEO_EXT, "video", []);
            if (mime && checkRange(video, "video")) out.video = Object.assign({}, video, { mime: mime });
        }

        return { ok: errors.length === 0, errors: errors, entries: out, hasVideo: !!out.video };
    }

    function resolveEntry(header, key) {
        return findEntry(header, key);
    }

    async function readEntry(url, entry) {
        return fetchSlice(url, entry.offset, entry.offset + entry.length - 1);
    }

    function parseOKS(text) {
        var s = String(text).replace(/^\uFEFF/, "");
        var i = 0, n = s.length;
        function err(m) { throw new Error("oks-parse: " + m + " @" + i); }
        function ws() {
            for (;;) {
                while (i < n && /\s/.test(s[i])) i++;
                if (s[i] === "/" && s[i + 1] === "/") { while (i < n && s[i] !== "\n") i++; continue; }
                if (s[i] === "/" && s[i + 1] === "*") { var e = s.indexOf("*/", i + 2); if (e < 0) err("comment"); i = e + 2; continue; }
                break;
            }
        }
        function str() {
            var q = s[i++], out = "";
            while (i < n && s[i] !== q) {
                var c = s[i++];
                if (c === "\\") {
                    var d = s[i++];
                    if (d === "n") out += "\n";
                    else if (d === "t") out += "\t";
                    else if (d === "r") out += "\r";
                    else if (d === "u") { out += String.fromCharCode(parseInt(s.substr(i, 4), 16)); i += 4; }
                    else out += d;
                } else out += c;
            }
            if (s[i] !== q) err("string");
            i++;
            return out;
        }
        function num() {
            var m = /^-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(s.slice(i, i + 40));
            if (!m) err("number");
            i += m[0].length;
            return parseFloat(m[0]);
        }
        function ident() {
            var m = /^[A-Za-z_$][\w$-]*/.exec(s.slice(i, i + 80));
            if (!m) err("key");
            i += m[0].length;
            return m[0];
        }
        function val(depth) {
            if (depth > 64) err("depth");
            ws();
            var c = s[i];
            if (c === "(") { i++; var v = val(depth + 1); ws(); if (s[i] === ")") i++; else err("paren"); return v; }
            if (c === "{") {
                i++; var o = {};
                for (;;) {
                    ws();
                    if (s[i] === "}") { i++; return o; }
                    var k = (s[i] === '"' || s[i] === "'") ? str() : ident();
                    ws();
                    if (s[i] !== ":") err("colon");
                    i++;
                    if (k === "__proto__" || k === "constructor" || k === "prototype") { val(depth + 1); } else o[k] = val(depth + 1);
                    ws();
                    if (s[i] === ",") i++;
                    else if (s[i] !== "}") err("object");
                }
            }
            if (c === "[") {
                i++; var a = [];
                for (;;) {
                    ws();
                    if (s[i] === "]") { i++; return a; }
                    a.push(val(depth + 1));
                    ws();
                    if (s[i] === ",") i++;
                    else if (s[i] !== "]") err("array");
                }
            }
            if (c === '"' || c === "'") return str();
            if (c === "-" || c === "." || (c >= "0" && c <= "9")) return num();
            var id = ident();
            if (id === "true") return true;
            if (id === "false") return false;
            if (id === "null") return null;
            err("token " + id);
        }
        var r = val(0);
        ws();
        if (s[i] === ";") { i++; ws(); }
        if (i < n) err("trailing");
        return r;
    }

    const OKX = {
        async header(url) {
            return readHeader(url);
        },

        async inspect(url) {
            const header = await readHeader(url);
            const report = inspect(header, sizeCache.get(url) || 0);
            report.header = header;
            return report;
        },

        async entryBytes(url, header, key) {
            const entry = resolveEntry(header, key);
            if (!entry) return null;
            return readEntry(url, entry);
        },

        async entryUrl(url, header, key, cacheKey) {
            const entry = resolveEntry(header, key);
            if (!entry) return null;
            const bytes = await readEntry(url, entry);
            const report = inspect(header, sizeCache.get(url) || 0);
            const checked = report.entries[key];
            return makeObjectUrl(cacheKey || (url + ":" + key), bytes, (checked && checked.mime) || entry.mime);
        },

        async entryText(url, header, key) {
            const entry = resolveEntry(header, key);
            if (!entry) return null;
            const bytes = await readEntry(url, entry);
            return new TextDecoder("utf-8").decode(bytes);
        },

        parseOKS: parseOKS,

        revoke: revoke,

        async preloadFull(url) {
            await fetchFull(url);
        }
    };

    global.OKX = OKX;
})(typeof window !== "undefined" ? window : this);
