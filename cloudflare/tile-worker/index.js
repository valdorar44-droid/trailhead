/**
 * Trailhead tile worker — serves vector tiles from R2 (PMTiles) with CF edge cache.
 *
 * Routes:
 *   GET /api/tiles/{z}/{x}/{y}.pbf  — vector tile decoded from us.pmtiles in R2
 *   GET /api/fonts/{stack}/{range}.pbf — glyph PBF proxied + cached
 *   All other paths                  — proxied straight to Railway origin
 *
 * Bindings required:
 *   TILES_BUCKET   — R2 bucket binding → trailhead-tiles
 *   RAILWAY_ORIGIN — env var → https://trailhead-production-2049.up.railway.app
 */

// ── Decompression ─────────────────────────────────────────────────────────────
// PMTiles directories and tiles are often gzip-compressed (compression type 2).
// CF Workers support DecompressionStream natively.

async function decompress(bytes, compression) {
  if (compression <= 1) return bytes; // 0 = unknown, 1 = none
  const fmt = compression === 2 ? "gzip" : compression === 3 ? "deflate" : null;
  if (!fmt) return bytes; // zstd (4) not supported in browser APIs — fall through
  const ds = new DecompressionStream(fmt);
  const writer = ds.writable.getWriter();
  const reader = ds.readable.getReader();
  writer.write(bytes);
  writer.close();
  const chunks = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  const out = new Uint8Array(chunks.reduce((s, c) => s + c.length, 0));
  let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.length; }
  return out;
}

// ── PMTiles v3 reader ─────────────────────────────────────────────────────────

function readUint64LE(buf, offset) {
  let lo = 0, hi = 0;
  for (let i = 0; i < 4; i++) lo |= buf[offset + i] << (i * 8);
  for (let i = 0; i < 4; i++) hi |= buf[offset + 4 + i] << (i * 8);
  return hi * 0x100000000 + (lo >>> 0);
}

function readVarint(buf, pos) {
  let result = 0, shift = 0;
  while (true) {
    const b = buf[pos++];
    result |= (b & 0x7f) << shift;
    if (!(b & 0x80)) break;
    shift += 7;
  }
  return [result >>> 0, pos];
}

function parseHeader(buf) {
  if (buf.length < 127) return null;
  if (String.fromCharCode(...buf.slice(0, 7)) !== "PMTiles") return null;
  if (buf[7] !== 3) return null;
  return {
    rootDirOffset:       readUint64LE(buf, 8),
    rootDirLength:       readUint64LE(buf, 16),
    leafDirOffset:       readUint64LE(buf, 40),
    leafDirLength:       readUint64LE(buf, 48),
    tileDataOffset:      readUint64LE(buf, 56),
    internalCompression: buf[97],  // 0/1=none, 2=gzip, 3=brotli, 4=zstd
    tileCompression:     buf[98],  // same codes
  };
}

function zxyToTileId(z, x, y) {
  if (z === 0) return 0;
  let base = 0;
  for (let i = 0; i < z; i++) base += (1 << (2 * i));
  return base + hilbert(1 << z, x, y);
}

function hilbert(n, x, y) {
  let d = 0;
  for (let s = n >> 1; s > 0; s >>= 1) {
    const rx = (x & s) > 0 ? 1 : 0;
    const ry = (y & s) > 0 ? 1 : 0;
    d += s * s * ((3 * rx) ^ ry);
    if (ry === 0) {
      if (rx === 1) { x = s - 1 - x; y = s - 1 - y; }
      [x, y] = [y, x];
    }
  }
  return d;
}

function searchDir(buf, tileId) {
  let pos = 0;
  const [numEntries, p0] = readVarint(buf, pos); pos = p0;
  const entries = [];
  let lastId = 0, lastOffset = 0;
  for (let i = 0; i < numEntries; i++) {
    const [idDelta, p1] = readVarint(buf, pos); pos = p1;
    const [runLen,  p2] = readVarint(buf, pos); pos = p2;
    const [length,  p3] = readVarint(buf, pos); pos = p3;
    const [offDelta,p4] = readVarint(buf, pos); pos = p4;
    const id  = lastId + idDelta;
    const off = offDelta === 0 ? lastOffset : lastOffset + offDelta;
    lastId = id; lastOffset = off;
    entries.push({ id, runLen, length, off });
  }
  let lo = 0, hi = entries.length - 1, found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (entries[mid].id <= tileId) { found = mid; lo = mid + 1; }
    else hi = mid - 1;
  }
  if (found < 0) return null;
  const e = entries[found];
  if (e.runLen === 0) return { leafOffset: e.off, leafLength: e.length };
  if (tileId < e.id + e.runLen)
    return { tileOffset: e.off + (tileId - e.id) * e.length, tileLength: e.length };
  return null;
}

async function r2Range(bucket, key, offset, length) {
  const obj = await bucket.get(key, { range: { offset, length } });
  if (!obj) return null;
  return new Uint8Array(await obj.arrayBuffer());
}

async function getTile(bucket, z, x, y) {
  if (z > 15) { const s = z - 15; z = 15; x >>= s; y >>= s; }

  const headerBuf = await r2Range(bucket, "us.pmtiles", 0, 127);
  if (!headerBuf) return null;
  const hdr = parseHeader(headerBuf);
  if (!hdr) return null;

  // Root directory — decompress if needed
  const rootRaw = await r2Range(bucket, "us.pmtiles", hdr.rootDirOffset, hdr.rootDirLength);
  if (!rootRaw) return null;
  const rootBuf = await decompress(rootRaw, hdr.internalCompression);

  const tileId = zxyToTileId(z, x, y);
  let result = searchDir(rootBuf, tileId);
  if (!result) return { bytes: null, compression: hdr.tileCompression };

  if (result.leafOffset !== undefined) {
    const leafRaw = await r2Range(bucket, "us.pmtiles",
      hdr.leafDirOffset + result.leafOffset, result.leafLength);
    if (!leafRaw) return null;
    const leafBuf = await decompress(leafRaw, hdr.internalCompression);
    result = searchDir(leafBuf, tileId);
    if (!result || result.leafOffset !== undefined) return null;
  }

  const bytes = await r2Range(bucket, "us.pmtiles",
    hdr.tileDataOffset + result.tileOffset, result.tileLength);
  return { bytes, compression: hdr.tileCompression };
}

// ── Cloudflare Worker ─────────────────────────────────────────────────────────

export default {
  async fetch(request, env, ctx) {
    const url  = new URL(request.url);
    const path = url.pathname;

    // ── Vector tiles ──────────────────────────────────────────────────────────
    const tm = path.match(/^\/api\/tiles\/(\d+)\/(\d+)\/(\d+)\.pbf$/);
    if (tm) {
      const [z, x, y] = tm.slice(1).map(Number);
      const cacheKey  = new Request(`https://tc/${z}/${x}/${y}`);
      const cfCache   = caches.default;

      const cached = await cfCache.match(cacheKey);
      if (cached) {
        const r = new Response(cached.body, cached);
        r.headers.set("X-Tile-Source", "CF-EDGE");
        return r;
      }

      try {
        const result = await getTile(env.TILES_BUCKET, z, x, y);
        if (result) {
          const body = result.bytes ?? new Uint8Array(0);
          const headers = {
            "Content-Type": "application/vnd.mapbox-vector-tile",
            "Cache-Control": "public, max-age=86400, s-maxage=2592000",
            "Access-Control-Allow-Origin": "*",
            "X-Tile-Source": "R2",
          };
          // If tiles are gzip-compressed, tell the browser to decompress them
          if (result.compression === 2) headers["Content-Encoding"] = "gzip";
          const resp = new Response(body, { headers });
          ctx.waitUntil(cfCache.put(cacheKey, resp.clone()));
          return resp;
        }
      } catch (err) {
        console.error("PMTiles R2 error:", err.message);
      }
      // Fall through to Railway as safety net
    }

    // ── Glyphs ────────────────────────────────────────────────────────────────
    if (path.startsWith("/api/fonts/")) {
      const cacheKey = new Request(request.url);
      const cfCache  = caches.default;
      const cached   = await cfCache.match(cacheKey);
      if (cached) return cached;
      const up = "https://protomaps.github.io/basemaps-assets/fonts"
        + path.replace("/api/fonts", "");
      const r = await fetch(up);
      if (r.ok) {
        const out = new Response(r.body, {
          headers: {
            "Content-Type": "application/x-protobuf",
            "Cache-Control": "public, max-age=604800, s-maxage=2592000",
            "Access-Control-Allow-Origin": "*",
          },
        });
        ctx.waitUntil(cfCache.put(cacheKey, out.clone()));
        return out;
      }
    }

    // ── Proxy everything else to Railway ──────────────────────────────────────
    const origin = env.RAILWAY_ORIGIN
      || "https://trailhead-production-2049.up.railway.app";
    return fetch(new Request(origin + path + url.search, {
      method:  request.method,
      headers: request.headers,
      body:    ["GET","HEAD"].includes(request.method) ? undefined : request.body,
    }));
  },
};
