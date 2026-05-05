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

// PMTiles instance cache — WeakMap keyed on the R2 bucket binding so the
// library's internal header + directory cache survives across requests within
// the same CF Workers isolate (isolates are reused for ~30s of idle time).
// The PMTiles library caches the parsed root + leaf directories internally,
// so warm requests skip all but the final tile-data read from R2.
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
        if (!railResp.ok) {
          // Tile not in our dataset — return 204 No Content (empty tile).
          // NEVER return 404 here: MLN offlineManager.createPack() aborts the
          // entire pack on any 404, even for legitimately-absent tiles.
          return new Response(null, {
            status: 204,
            headers: { "Access-Control-Allow-Origin": "*" },
          });
        }
        const resp = new Response(railResp.body, {
          status: 200,
          headers: {
            "Content-Type":                railResp.headers.get("Content-Type") || "application/vnd.mapbox-vector-tile",
            "Cache-Control":               "public, max-age=86400, s-maxage=2592000",
            "Access-Control-Allow-Origin": "*",
            "X-Tile-Source":               "RAILWAY",
          },
        });
        ctx.waitUntil(cfCache.put(cacheKey, resp.clone()));
        return resp;
      } catch (e) {
        return new Response(null, { status: 204, headers: { "Access-Control-Allow-Origin": "*" } });
      }
    }

    // ── Static assets (MapLibre GL JS + CSS) — cached at edge for 7 days ────
    if (path.startsWith("/assets/")) {
      const cacheKey = new Request(`https://tiles.gettrailhead.app${path}`);
      const cfCache  = caches.default;
      const cached   = await cfCache.match(cacheKey);
      if (cached) return cached;
      // Proxy from the canonical CDN, cache aggressively at our edge so the
      // WebView never cold-fetches unpkg on launch
      const unpkgPath = path.replace("/assets/maplibre-gl", "/maplibre-gl@4.7.1/dist/maplibre-gl");
      const upstream = `https://unpkg.com${unpkgPath}`;
      const r = await fetch(upstream);
      if (!r.ok) return r;
      const contentType = r.headers.get("Content-Type") || "application/javascript";
      const out = new Response(r.body, {
        headers: {
          "Content-Type":                contentType,
          "Cache-Control":               "public, max-age=604800, s-maxage=604800",
          "Access-Control-Allow-Origin": "*",
        },
      });
      ctx.waitUntil(cfCache.put(cacheKey, out.clone()));
      return out;
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
      // Font not found at protomaps — return 204 so MLN offline pack doesn't abort.
      // Do NOT fall through to Railway, which also 404s on font paths.
      return new Response(null, { status: 204, headers: { "Access-Control-Allow-Origin": "*" } });
    }

    // ── Direct PMTiles file download (single-stream, resumable) ──────────────
    // Streams the full .pmtiles file from R2 with Range support so
    // expo-file-system createDownloadResumable can pause/resume a 1GB download.
    // 100x faster than MLN's per-tile offline pack approach.
    if (path === '/api/download/manifest.json') {
      // Serve the pre-built manifest.json from R2 (written by Railway after each state extraction).
      // Falls back to a dynamic stub if it doesn't exist yet.
      const manifestObj = await env.TILES_BUCKET.get('manifest.json').catch(() => null);
      if (manifestObj) {
        return new Response(manifestObj.body, {
          headers: {
            'Content-Type':                'application/json',
            'Access-Control-Allow-Origin': '*',
            'Cache-Control':               'public, max-age=300',
          },
        });
      }
      // Fallback: dynamic manifest with just CONUS
      const meta = await env.TILES_BUCKET.head('us.pmtiles').catch(() => null);
      const manifest = meta ? { 'us.pmtiles': { size: meta.size } } : {};
      return Response.json(manifest, {
        headers: { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'public, max-age=60' },
      });
    }

    const dlMatch = path.match(/^\/api\/download\/([a-z_]+\.pmtiles)$/);
    if (dlMatch) {
      const fileName = dlMatch[1]; // e.g. 'us.pmtiles'

      // HEAD first — need total size for Content-Length + Content-Range
      const meta = await env.TILES_BUCKET.head(fileName).catch(() => null);
      if (!meta) return new Response('Not found', { status: 404, headers: { 'Access-Control-Allow-Origin': '*' } });

      const totalSize = meta.size;
      const rangeHeader = request.headers.get('Range');

      let r2opts = {};
      let status = 200;
      let contentRange = null;
      let contentLength = totalSize;

      if (rangeHeader) {
        const m = rangeHeader.match(/bytes=(\d+)-(\d*)/);
        if (m) {
          const offset = parseInt(m[1]);
          // If end byte is omitted, download to end of file
          const endByte = m[2] ? parseInt(m[2]) : totalSize - 1;
          const length  = endByte - offset + 1;
          r2opts       = { range: { offset, length } };
          contentRange = `bytes ${offset}-${endByte}/${totalSize}`;
          contentLength = length;
          status = 206;
        }
      }

      const obj = await env.TILES_BUCKET.get(fileName, r2opts).catch(() => null);
      if (!obj) return new Response('Not found', { status: 404, headers: { 'Access-Control-Allow-Origin': '*' } });

      const headers = {
        'Content-Type':                'application/octet-stream',
        'Accept-Ranges':               'bytes',
        'Content-Length':              String(contentLength),
        'Access-Control-Allow-Origin': '*',
        'Cache-Control':               'no-cache',
      };
      if (contentRange) headers['Content-Range'] = contentRange;

      return new Response(obj.body, { status, headers });
    }

    // ── Topographic contour PMTiles downloads ───────────────────────────────
    // Contours are optional overlays, separate from the main map PMTiles so
    // users can download/remove topo detail without touching the base map.
    if (path === '/api/contours/manifest.json') {
      const manifestObj = await env.TILES_BUCKET.get('contours/manifest.json').catch(() => null);
      if (manifestObj) {
        return new Response(manifestObj.body, {
          headers: {
            'Content-Type':                'application/json',
            'Access-Control-Allow-Origin': '*',
            'Cache-Control':               'public, max-age=300',
          },
        });
      }

      return Response.json({}, {
        headers: { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'public, max-age=60' },
      });
    }

    const contourMatch = path.match(/^\/api\/contours\/([a-z]{2,6}\.pmtiles)$/);
    if (contourMatch) {
      const fileName = contourMatch[1];
      const key = `contours/${fileName}`;
      const meta = await env.TILES_BUCKET.head(key).catch(() => null);
      if (!meta) return new Response('Contour pack not found', { status: 404, headers: { 'Access-Control-Allow-Origin': '*' } });

      const totalSize = meta.size;
      const rangeHeader = request.headers.get('Range');

      let r2opts = {};
      let status = 200;
      let contentRange = null;
      let contentLength = totalSize;

      if (rangeHeader) {
        const m = rangeHeader.match(/bytes=(\d+)-(\d*)/);
        if (m) {
          const offset = parseInt(m[1]);
          const endByte = m[2] ? parseInt(m[2]) : totalSize - 1;
          const length = endByte - offset + 1;
          r2opts = { range: { offset, length } };
          contentRange = `bytes ${offset}-${endByte}/${totalSize}`;
          contentLength = length;
          status = 206;
        }
      }

      const obj = await env.TILES_BUCKET.get(key, r2opts).catch(() => null);
      if (!obj) return new Response('Contour pack not found', { status: 404, headers: { 'Access-Control-Allow-Origin': '*' } });

      const headers = {
        'Content-Type':                'application/octet-stream',
        'Accept-Ranges':               'bytes',
        'Content-Length':              String(contentLength),
        'Access-Control-Allow-Origin': '*',
        'Cache-Control':               'no-cache',
      };
      if (contentRange) headers['Content-Range'] = contentRange;

      return new Response(obj.body, { status, headers });
    }

    // ── Valhalla routing pack downloads ─────────────────────────────────────
    // Routing packs are separate from PMTiles because they are graph data, not
    // render tiles. Expected R2 keys:
    //   routing/manifest.json
    //   routing/ks.tar or routing/ks.tar.gz
    if (path === '/api/routing/manifest.json') {
      const manifestObj = await env.TILES_BUCKET.get('routing/manifest.json').catch(() => null);
      if (manifestObj) {
        return new Response(manifestObj.body, {
          headers: {
            'Content-Type':                'application/json',
            'Access-Control-Allow-Origin': '*',
            'Cache-Control':               'public, max-age=300',
          },
        });
      }

      return Response.json({}, {
        headers: { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'public, max-age=60' },
      });
    }

    const routingMatch = path.match(/^\/api\/routing\/([a-z]{2}\.tar(?:\.gz)?)$/);
    if (routingMatch) {
      const fileName = routingMatch[1];
      const key = `routing/${fileName}`;
      const meta = await env.TILES_BUCKET.head(key).catch(() => null);
      if (!meta) return new Response('Routing pack not found', { status: 404, headers: { 'Access-Control-Allow-Origin': '*' } });

      const totalSize = meta.size;
      const rangeHeader = request.headers.get('Range');

      let r2opts = {};
      let status = 200;
      let contentRange = null;
      let contentLength = totalSize;

      if (rangeHeader) {
        const m = rangeHeader.match(/bytes=(\d+)-(\d*)/);
        if (m) {
          const offset = parseInt(m[1]);
          const endByte = m[2] ? parseInt(m[2]) : totalSize - 1;
          const length = endByte - offset + 1;
          r2opts = { range: { offset, length } };
          contentRange = `bytes ${offset}-${endByte}/${totalSize}`;
          contentLength = length;
          status = 206;
        }
      }

      const obj = await env.TILES_BUCKET.get(key, r2opts).catch(() => null);
      if (!obj) return new Response('Routing pack not found', { status: 404, headers: { 'Access-Control-Allow-Origin': '*' } });

      const headers = {
        'Content-Type':                fileName.endsWith('.gz') ? 'application/gzip' : 'application/x-tar',
        'Accept-Ranges':               'bytes',
        'Content-Length':              String(contentLength),
        'Access-Control-Allow-Origin': '*',
        'Cache-Control':               'no-cache',
      };
      if (contentRange) headers['Content-Range'] = contentRange;

      return new Response(obj.body, { status, headers });
    }

    // ── Map style for offline packs ───────────────────────────────────────────
    // MLN offlineManager.createPack() requires a real https:// styleURL —
    // data: URIs are rejected on iOS (MLNErrorDomain Code=-1).
    if (path === "/api/style.json") {
      const TILE_BASE = "https://tiles.gettrailhead.app";
      const GLYPH_URL = `${TILE_BASE}/api/fonts/{fontstack}/{range}.pbf`;
      const lwHalo = "#13161c";
      const style = {
        version: 8,
        glyphs: GLYPH_URL,
        sources: {
          pm: {
            type: "vector",
            tiles: [`${TILE_BASE}/api/tiles/{z}/{x}/{y}.pbf`],
            minzoom: 0,
            maxzoom: 15,
            bounds: [-125.0, 24.5, -66.5, 49.5],
            attribution: "© OpenStreetMap",
          },
        },
        layers: [
          { id: "bg", type: "background", paint: { "background-color": "#0e1118" } },
          { id: "earth", type: "fill", source: "pm", "source-layer": "earth",
            filter: ["==", ["get", "kind"], "earth"],
            paint: { "fill-color": "#1e2330", "fill-opacity": 1 } },
          { id: "lu-park", type: "fill", source: "pm", "source-layer": "landuse",
            filter: ["in", ["get", "kind"], ["literal", ["national_park", "park", "nature_reserve", "protected_area"]]],
            paint: { "fill-color": "#1a3322", "fill-opacity": 0.9 } },
          { id: "lu-forest", type: "fill", source: "pm", "source-layer": "landuse",
            filter: ["in", ["get", "kind"], ["literal", ["forest", "wood"]]],
            paint: { "fill-color": "#162818", "fill-opacity": 0.85 } },
          { id: "lu-grass", type: "fill", source: "pm", "source-layer": "landuse",
            filter: ["in", ["get", "kind"], ["literal", ["grassland", "meadow"]]],
            paint: { "fill-color": "#1e2818", "fill-opacity": 0.6 } },
          { id: "lu-residential", type: "fill", source: "pm", "source-layer": "landuse",
            filter: ["in", ["get", "kind"], ["literal", ["residential", "urban_area"]]],
            minzoom: 9,
            paint: { "fill-color": "#252830", "fill-opacity": 0.5 } },
          { id: "water-poly", type: "fill", source: "pm", "source-layer": "water",
            paint: { "fill-color": "#0a1a2e", "fill-opacity": 1 } },
          { id: "water-river", type: "line", source: "pm", "source-layer": "water",
            filter: ["in", ["get", "kind"], ["literal", ["river", "stream", "canal"]]],
            layout: { "line-cap": "round", "line-join": "round" },
            paint: { "line-color": "#0a1a2e", "line-width": ["interpolate", ["linear"], ["zoom"], 5, 0.5, 10, 1.5, 15, 3], "line-opacity": 1 } },
          { id: "lu-park-line", type: "line", source: "pm", "source-layer": "landuse",
            filter: ["in", ["get", "kind"], ["literal", ["national_park", "nature_reserve", "protected_area"]]],
            minzoom: 6,
            paint: { "line-color": "#3a6040", "line-width": 1, "line-opacity": 0.8 } },
          { id: "road-other", type: "line", source: "pm", "source-layer": "roads",
            filter: ["==", ["get", "kind"], "other"], minzoom: 12,
            layout: { "line-cap": "round", "line-join": "round" },
            paint: { "line-color": "#5a4a2c", "line-width": ["interpolate", ["linear"], ["zoom"], 12, 0.5, 16, 2], "line-dasharray": [2, 2], "line-opacity": 1 } },
          { id: "road-path", type: "line", source: "pm", "source-layer": "roads",
            filter: ["==", ["get", "kind"], "path"], minzoom: 11,
            layout: { "line-cap": "round", "line-join": "round" },
            paint: { "line-color": "#9a7840", "line-width": ["interpolate", ["linear"], ["zoom"], 11, 0.8, 16, 2.5], "line-dasharray": [3, 2], "line-opacity": 1 } },
          { id: "road-minor-case", type: "line", source: "pm", "source-layer": "roads",
            filter: ["==", ["get", "kind"], "minor_road"], minzoom: 9,
            layout: { "line-cap": "round", "line-join": "round" },
            paint: { "line-color": "#0e1118", "line-width": ["interpolate", ["linear"], ["zoom"], 9, 1, 14, 4, 17, 11], "line-opacity": 1 } },
          { id: "road-minor", type: "line", source: "pm", "source-layer": "roads",
            filter: ["==", ["get", "kind"], "minor_road"], minzoom: 9,
            layout: { "line-cap": "round", "line-join": "round" },
            paint: { "line-color": "#7a7d88", "line-width": ["interpolate", ["linear"], ["zoom"], 9, 0.7, 14, 2.8, 17, 8], "line-opacity": 1 } },
          { id: "road-major-case", type: "line", source: "pm", "source-layer": "roads",
            filter: ["in", ["get", "kind"], ["literal", ["major_road", "medium_road"]]],
            layout: { "line-cap": "round", "line-join": "round" },
            paint: { "line-color": "#0e1118", "line-width": ["interpolate", ["linear"], ["zoom"], 4, 1.5, 8, 4, 12, 7, 16, 14], "line-opacity": 1 } },
          { id: "road-major", type: "line", source: "pm", "source-layer": "roads",
            filter: ["in", ["get", "kind"], ["literal", ["major_road", "medium_road"]]],
            layout: { "line-cap": "round", "line-join": "round" },
            paint: { "line-color": "#b88838", "line-width": ["interpolate", ["linear"], ["zoom"], 4, 1, 8, 3, 12, 5.5, 16, 11], "line-opacity": 1 } },
          { id: "road-trunk-case", type: "line", source: "pm", "source-layer": "roads",
            filter: ["==", ["get", "kind"], "highway"],
            layout: { "line-cap": "round", "line-join": "round" },
            paint: { "line-color": "#0e1118", "line-width": ["interpolate", ["linear"], ["zoom"], 3, 3, 6, 5, 10, 8, 15, 16], "line-opacity": 1 } },
          { id: "road-trunk", type: "line", source: "pm", "source-layer": "roads",
            filter: ["==", ["get", "kind"], "highway"],
            layout: { "line-cap": "round", "line-join": "round" },
            paint: { "line-color": "#e89428", "line-width": ["interpolate", ["linear"], ["zoom"], 3, 2, 6, 3.5, 10, 6, 15, 12], "line-opacity": 1 } },
          { id: "boundary-region", type: "line", source: "pm", "source-layer": "boundaries",
            filter: ["==", ["get", "kind"], "region"],
            paint: { "line-color": "#6a7a96", "line-width": ["interpolate", ["linear"], ["zoom"], 3, 0.8, 8, 1.5], "line-dasharray": [4, 3], "line-opacity": 0.85 } },
          { id: "boundary-country", type: "line", source: "pm", "source-layer": "boundaries",
            filter: ["==", ["get", "kind"], "country"],
            paint: { "line-color": "#8c9ab3", "line-width": ["interpolate", ["linear"], ["zoom"], 3, 1, 8, 2.5], "line-opacity": 1 } },
          { id: "pm-pois-camp", type: "circle", source: "pm", "source-layer": "pois",
            filter: ["in", ["get", "kind"], ["literal", ["camp_site", "camp_pitch", "picnic_site", "shelter"]]],
            paint: { "circle-radius": 5, "circle-color": "#14b8a6", "circle-stroke-width": 1.5, "circle-stroke-color": "#fff", "circle-opacity": 1 } },
          { id: "pm-pois-trailhead", type: "circle", source: "pm", "source-layer": "pois",
            filter: ["==", ["get", "kind"], "trailhead"],
            paint: { "circle-radius": 5, "circle-color": "#22c55e", "circle-stroke-width": 1.5, "circle-stroke-color": "#fff", "circle-opacity": 1 } },
          { id: "water-name", type: "symbol", source: "pm", "source-layer": "water",
            filter: ["has", "name"], minzoom: 7,
            layout: { "text-field": ["get", "name"], "text-size": 11, "text-font": ["Noto Sans Italic"], "text-max-width": 8 },
            paint: { "text-color": "#4a9ece", "text-halo-color": lwHalo, "text-halo-width": 1.5, "text-opacity": 1 } },
          { id: "peak-name", type: "symbol", source: "pm", "source-layer": "pois",
            filter: ["==", ["get", "kind"], "peak"], minzoom: 10,
            layout: { "text-field": ["get", "name"], "text-size": 10, "text-font": ["Noto Sans Regular"], "text-offset": [0, 0.7], "text-anchor": "top" },
            paint: { "text-color": "#f59e0b", "text-halo-color": lwHalo, "text-halo-width": 1.5, "text-opacity": 1 } },
          { id: "road-name-hwy", type: "symbol", source: "pm", "source-layer": "roads",
            minzoom: 8,
            filter: ["all", ["has", "name"], ["==", ["get", "kind"], "highway"]],
            layout: { "text-field": ["get", "name"], "text-size": 9, "text-font": ["Noto Sans Medium"], "symbol-placement": "line", "text-max-width": 10, "text-repeat": 400 },
            paint: { "text-color": "#c4a050", "text-halo-color": lwHalo, "text-halo-width": 1.8, "text-opacity": 1 } },
          { id: "road-name", type: "symbol", source: "pm", "source-layer": "roads",
            minzoom: 12,
            filter: ["all", ["has", "name"], ["in", ["get", "kind"], ["literal", ["major_road", "medium_road", "minor_road"]]]],
            layout: { "text-field": ["get", "name"], "text-size": 10, "text-font": ["Noto Sans Medium"], "symbol-placement": "line", "text-max-width": 10 },
            paint: { "text-color": "#b9bcc4", "text-halo-color": lwHalo, "text-halo-width": 1.8, "text-opacity": 1 } },
          { id: "park-name", type: "symbol", source: "pm", "source-layer": "pois",
            filter: ["in", ["get", "kind"], ["literal", ["park", "national_park", "nature_reserve"]]],
            minzoom: 7,
            layout: { "text-field": ["get", "name"], "text-size": 10, "text-font": ["Noto Sans Italic"], "text-max-width": 9 },
            paint: { "text-color": "#5faa6a", "text-halo-color": lwHalo, "text-halo-width": 1.6, "text-opacity": 1 } },
          { id: "place-country", type: "symbol", source: "pm", "source-layer": "places",
            minzoom: 2, maxzoom: 5,
            filter: ["==", ["get", "kind"], "country"],
            layout: { "text-field": ["get", "name"], "text-size": ["interpolate", ["linear"], ["zoom"], 2, 9, 5, 13], "text-font": ["Noto Sans Medium"], "text-transform": "uppercase" },
            paint: { "text-color": "#9aa5b8", "text-halo-color": lwHalo, "text-halo-width": 1.5, "text-opacity": 1 } },
          { id: "place-region", type: "symbol", source: "pm", "source-layer": "places",
            minzoom: 4, maxzoom: 8,
            filter: ["==", ["get", "kind"], "region"],
            layout: { "text-field": ["get", "name"], "text-size": ["interpolate", ["linear"], ["zoom"], 4, 8, 7, 12], "text-font": ["Noto Sans Regular"], "text-transform": "uppercase", "text-letter-spacing": 0.08 },
            paint: { "text-color": "#4a5a70", "text-halo-color": lwHalo, "text-halo-width": 1.2, "text-opacity": 1 } },
          { id: "place-large", type: "symbol", source: "pm", "source-layer": "places",
            minzoom: 3,
            filter: ["all", ["==", ["get", "kind"], "locality"], ["<=", ["coalesce", ["get", "rank"], 99], 4]],
            layout: { "text-field": ["get", "name"], "text-size": ["interpolate", ["linear"], ["zoom"], 3, 11, 8, 18, 12, 22], "text-font": ["Noto Sans Medium"] },
            paint: { "text-color": "#e6e9f1", "text-halo-color": lwHalo, "text-halo-width": 2.5, "text-opacity": 1 } },
          { id: "place-medium", type: "symbol", source: "pm", "source-layer": "places",
            minzoom: 5,
            filter: ["all", ["==", ["get", "kind"], "locality"], [">", ["coalesce", ["get", "rank"], 99], 4], ["<=", ["coalesce", ["get", "rank"], 99], 7]],
            layout: { "text-field": ["get", "name"], "text-size": ["interpolate", ["linear"], ["zoom"], 5, 10, 10, 15, 14, 18], "text-font": ["Noto Sans Medium"] },
            paint: { "text-color": "#cdd2dd", "text-halo-color": lwHalo, "text-halo-width": 2, "text-opacity": 1 } },
          { id: "place-small", type: "symbol", source: "pm", "source-layer": "places",
            minzoom: 8,
            filter: ["all", ["==", ["get", "kind"], "locality"], [">", ["coalesce", ["get", "rank"], 99], 7]],
            layout: { "text-field": ["get", "name"], "text-size": 11, "text-font": ["Noto Sans Regular"] },
            paint: { "text-color": "#a3aab9", "text-halo-color": lwHalo, "text-halo-width": 1.8, "text-opacity": 1 } },
        ],
      };
      return Response.json(style, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Cache-Control": "public, max-age=3600, s-maxage=86400",
        },
      });
    }

    // ── Everything else → Railway ─────────────────────────────────────────────
    return fetch(new Request(origin + path + url.search, {
      method:  request.method,
      headers: request.headers,
      body:    ["GET", "HEAD"].includes(request.method) ? undefined : request.body,
    }));
  },
};
