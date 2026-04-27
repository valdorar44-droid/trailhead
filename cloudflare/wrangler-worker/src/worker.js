/**
 * Trailhead tile worker — R2 + CF edge cache via official pmtiles library.
 *
 * Flow per tile request:
 *   1. CF edge cache HIT  → return instantly (~20ms, globally)
 *   2. R2 byte-range read → pmtiles library decodes → cache at edge → return (~50ms)
 *   3. Railway fallback   → if R2 fails for any reason (~100ms)
 *
 * Fonts/glyphs are proxied from Protomaps' static assets and edge-cached for 7 days.
 * Everything else proxies straight to Railway.
 */

import { PMTiles } from "pmtiles";

// ── R2 source for the pmtiles library ────────────────────────────────────────
// The library calls getBytes() for header, root dir, leaf dirs, and tile data.
// Each is a small focused byte-range read — no full file download needed.

class R2Source {
  constructor(bucket) {
    this.bucket = bucket;
    this._key = "us.pmtiles";
  }

  getKey() {
    return this._key;
  }

  async getBytes(offset, length, _signal, etag) {
    const opts = { range: { offset, length } };
    if (etag) opts.onlyIf = { etagMatches: etag };
    const obj = await this.bucket.get(this._key, opts);
    if (!obj) return undefined;
    return {
      data: await obj.arrayBuffer(),
      etag: obj.httpEtag ? obj.httpEtag.replace(/^"|"$/g, "") : undefined,
      expires: obj.httpExpiresDate ?? undefined,
      cacheControl: obj.httpMetadata?.cacheControl ?? undefined,
      lastModified: obj.uploaded ? obj.uploaded.toUTCString() : undefined,
    };
  }
}

// Cache the PMTiles instance keyed on the R2 bucket binding reference.
// Within the same CF Workers isolate, env.TILES_BUCKET is the same object,
// so the instance (and its internal directory cache) is reused across requests
// for performance. Different isolates get fresh instances automatically.
const _pmCache = new WeakMap();
function getPMTiles(env) {
  if (!_pmCache.has(env.TILES_BUCKET)) {
    _pmCache.set(env.TILES_BUCKET, new PMTiles(new R2Source(env.TILES_BUCKET)));
  }
  return _pmCache.get(env.TILES_BUCKET);
}

// ── Worker ────────────────────────────────────────────────────────────────────
export default {
  async fetch(request, env, ctx) {
    const url    = new URL(request.url);
    const path   = url.pathname;
    const origin = env.RAILWAY_ORIGIN || "https://trailhead-production-2049.up.railway.app";

    // ── pmtiles step-by-step test ─────────────────────────────────────────────
    if (path === "/api/admin/pmtiles-test") {
      const steps = {};
      try {
        steps.r2_ping = "starting";
        const obj = await env.TILES_BUCKET.get("us.pmtiles", { range: { offset: 0, length: 7 } });
        steps.r2_ping = obj ? "ok:" + String.fromCharCode(...new Uint8Array(await obj.arrayBuffer())) : "null";

        steps.pm_init = "starting";
        const pm = getPMTiles(env);
        steps.pm_init = "ok";

        steps.header = "starting";
        const hdr = await pm.getHeader();
        steps.header = { minZoom: hdr.minZoom, maxZoom: hdr.maxZoom, tileType: hdr.tileType, internalCompression: hdr.internalCompression, tileCompression: hdr.tileCompression };

        for (const [tz,tx,ty] of [[4,3,6],[6,15,24],[8,60,97],[10,241,391],[12,964,1565],[14,3857,6263]]) {
          const t = await pm.getZxy(tz, tx, ty);
          steps[`z${tz}`] = t ? `found len=${t.data?.byteLength ?? t.data?.length}` : "null";
        }
      } catch (e) {
        steps.error = e.message + "\n" + e.stack?.slice(0, 300);
      }
      return Response.json(steps);
    }

    // ── R2 diagnostic endpoint ─────────────────────────────────────────────────
    if (path === "/api/admin/r2-ping") {
      try {
        const obj = await env.TILES_BUCKET.get("us.pmtiles", { range: { offset: 0, length: 7 } });
        if (!obj) return Response.json({ status: "R2 file not found", bucket: "trailhead-tiles", key: "us.pmtiles" });
        const bytes = new Uint8Array(await obj.arrayBuffer());
        const magic = String.fromCharCode(...bytes);
        return Response.json({ status: "ok", magic, etag: obj.httpEtag, size: obj.size });
      } catch (e) {
        return Response.json({ status: "error", message: e.message });
      }
    }

    // ── Vector tiles ──────────────────────────────────────────────────────────
    const tm = path.match(/^\/api\/tiles\/(\d+)\/(\d+)\/(\d+)\.pbf$/);
    if (tm) {
      const [z, x, y] = tm.slice(1).map(Number);

      // Stable cache key — custom domain ensures CF edge cache works on this
      const cacheKey = new Request(`https://tiles.gettrailhead.app/v3${path}`);
      const cfCache  = caches.default;

      // 1. Edge cache hit
      const cached = await cfCache.match(cacheKey);
      if (cached) return cached;

      // 2. R2 via pmtiles library
      try {
        const pm   = getPMTiles(env);
        const tile = await pm.getZxy(z, x, y);
        console.error(`getZxy(${z}/${x}/${y}): ${tile ? `FOUND len=${tile.data?.byteLength ?? tile.data?.length}` : "NOT_FOUND"}`);

        if (tile && tile.data && (tile.data.byteLength > 0 || tile.data.length > 0)) {
          const resp = new Response(tile.data, {
            headers: {
              "Content-Type":                "application/vnd.mapbox-vector-tile",
              "Cache-Control":               "public, max-age=86400, s-maxage=2592000",
              "Access-Control-Allow-Origin": "*",
              "X-Tile-Source":               "R2",
            },
          });
          ctx.waitUntil(cfCache.put(cacheKey, resp.clone()));
          return resp;
        }
      } catch (e) {
        console.error(`PMTiles R2 error z=${z}/${x}/${y}:`, e.message);
      }

      // 3. Railway fallback — no cf:{cacheEverything} to avoid CF edge caching
      //    the outer request URL (which would bypass Worker JS on future hits)
      try {
        const railResp = await fetch(`${origin}${path}`, { cf: { cacheEverything: false } });
        const resp = new Response(railResp.body, {
          status: railResp.status,
          headers: {
            "Content-Type":                railResp.headers.get("Content-Type") || "application/vnd.mapbox-vector-tile",
            "Cache-Control":               "public, max-age=86400, s-maxage=2592000",
            "Access-Control-Allow-Origin": "*",
            "X-Tile-Source":               "RAILWAY",
          },
        });
        if (railResp.ok) ctx.waitUntil(cfCache.put(cacheKey, resp.clone()));
        return resp;
      } catch (e) {
        return new Response("tile unavailable", { status: 503 });
      }
    }

    // ── Glyphs ────────────────────────────────────────────────────────────────
    if (path.startsWith("/api/fonts/")) {
      const cacheKey = new Request(`https://tiles.gettrailhead.app/v3${path}`);
      const cfCache  = caches.default;
      const cached   = await cfCache.match(cacheKey);
      if (cached) return cached;

      const glyphUrl = `https://protomaps.github.io/basemaps-assets/fonts${path.replace("/api/fonts", "")}`;
      const r = await fetch(glyphUrl);
      if (r.ok) {
        const out = new Response(r.body, {
          headers: {
            "Content-Type":                "application/x-protobuf",
            "Cache-Control":               "public, max-age=604800, s-maxage=2592000",
            "Access-Control-Allow-Origin": "*",
          },
        });
        ctx.waitUntil(cfCache.put(cacheKey, out.clone()));
        return out;
      }
    }

    // ── Everything else → Railway ─────────────────────────────────────────────
    return fetch(new Request(origin + path + url.search, {
      method:  request.method,
      headers: request.headers,
      body:    ["GET", "HEAD"].includes(request.method) ? undefined : request.body,
    }));
  },
};
