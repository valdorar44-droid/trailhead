/** Map WebView cinematic player — ported from extreme-explorer storyboard logic. */
export function getMissionBriefMapPlayerScript(mapTopPadding = 180, mapBottomPadding = 300): string {
  return `
  // ---- Mission brief cinematic player (same lifecycle as Explorer) ----
  window.__missionBriefData = window.__missionBriefData || { scenes: [], route: [], checkpoints: [] };
  var cine = {
    scenes: [],
    index: -1,
    playing: false,
    paused: false,
    failed: false,
    raf: null,
    sceneStart: 0,
    pausedAt: 0,
    pausedTotal: 0,
    speed: 1,
    freeCamera: false,
    markers: []
  };
  function cinePost(type, extra) {
    var msg = extra || {};
    msg.type = type;
    postRN(msg);
  }
  function cineStopAnim() {
    if (cine.raf) { cancelAnimationFrame(cine.raf); cine.raf = null; }
    try { map.stop(); } catch (err) {}
  }
  function cineClearMarkers() {
    cine.markers.forEach(function(marker) { marker.remove(); });
    cine.markers = [];
  }
  function cineFail(err) {
    if (cine.failed) return;
    cine.failed = true;
    cine.playing = false;
    cineStopAnim();
    cineClearMarkers();
    cinePost('cinematic_error', { message: String((err && err.message) || err || 'cinematic playback failed') });
  }
  function cineRoute() {
    var data = window.__missionBriefData || {};
    if (data.route && data.route.length > 1) return data.route;
    return _routeCoords || [];
  }
  function sliceCoords(slice) {
    var coords = cineRoute();
    if (coords.length < 2) return coords;
    var s = Math.max(0, Math.min(1, (slice && slice[0]) || 0));
    var rawEnd = slice && slice[1] != null ? slice[1] : 1;
    var e = Math.max(s, Math.min(1, rawEnd));
    var si = Math.floor(s * (coords.length - 1));
    var ei = Math.max(si + 1, Math.ceil(e * (coords.length - 1)));
    return coords.slice(si, ei + 1);
  }
  function ensureCineRouteLayers() {
    var coords = cineRoute();
    if (coords.length < 2) return;
    if (!map.getSource('route-full')) {
      map.addSource('route-full', { type: 'geojson', data: { type: 'Feature', geometry: { type: 'LineString', coordinates: coords } } });
      map.addLayer({ id: 'route-casing', type: 'line', source: 'route-full', paint: { 'line-color': '#0f172a', 'line-width': 9, 'line-opacity': .72 } });
    } else {
      map.getSource('route-full').setData({ type: 'Feature', geometry: { type: 'LineString', coordinates: coords } });
    }
    if (!map.getSource('route-anim')) {
      map.addSource('route-anim', { type: 'geojson', data: { type: 'Feature', geometry: { type: 'LineString', coordinates: [] } } });
      map.addLayer({ id: 'route-anim-line', type: 'line', source: 'route-anim', paint: { 'line-color': '#00a7ff', 'line-width': 5, 'line-opacity': .96 } });
    }
  }
  function setProgressLine(ratio) {
    var coords = cineRoute();
    if (coords.length < 2) return;
    var clamped = Math.max(0, Math.min(1, ratio));
    var count = Math.max(2, Math.ceil(clamped * coords.length));
    map.getSource('route-anim')?.setData({ type: 'Feature', geometry: { type: 'LineString', coordinates: coords.slice(0, count) } });
    cinePost('cinematic_progress', { ratio: clamped });
  }
  function pointAtRatio(ratio) {
    var coords = cineRoute();
    if (!coords.length) return null;
    if (coords.length === 1) return coords[0];
    var clamped = Math.max(0, Math.min(1, Number(ratio) || 0));
    var pos = clamped * (coords.length - 1);
    var i = Math.floor(pos);
    var frac = pos - i;
    var c0 = coords[Math.min(i, coords.length - 1)];
    var c1 = coords[Math.min(i + 1, coords.length - 1)];
    return [c0[0] + (c1[0] - c0[0]) * frac, c0[1] + (c1[1] - c0[1]) * frac];
  }
  function sceneForRatio(ratio) {
    var clamped = Math.max(0, Math.min(1, Number(ratio) || 0));
    var fallback = 0;
    for (var i = 0; i < cine.scenes.length; i++) {
      var s = cine.scenes[i];
      if (s.type === 'whole_route') fallback = i;
      if (!s.routeSlice || s.routeSlice.length < 2) continue;
      var a = Math.min(s.routeSlice[0], s.routeSlice[1]);
      var b = Math.max(s.routeSlice[0], s.routeSlice[1]);
      if (clamped >= a - 0.001 && clamped <= b + 0.001) {
        if ((s.camera && s.camera.mode === 'follow') || String(s.type || '').indexOf('day') >= 0 || String(s.type || '').indexOf('drive') >= 0) return i;
        fallback = i;
      }
    }
    if (clamped >= 0.97) return Math.max(0, cine.scenes.length - 1);
    return fallback;
  }
  function ensureCineTerrain(scene) {
    if (!(scene.layers && scene.layers.terrain)) return;
    setTerrainLayer(true);
  }
  function cineMarkerStyle(kind) {
    var colors = { checkpoint: '#f97316', fuel: '#eab308', camp: '#22c55e', trail: '#38bdf8', monument: '#a78bfa', weather_risk: '#ef4444', place: '#94a3b8' };
    return colors[kind] || colors.place;
  }
  function cineLabel(kind, idx) {
    var k = String(kind || '');
    if (k === 'checkpoint') return String(idx + 1);
    if (k === 'fuel') return 'F';
    if (k === 'camp') return 'S';
    if (k === 'trail') return 'T';
    if (k === 'monument') return 'M';
    if (k === 'risk') return '!';
    return '•';
  }
  function showCineCallouts(scene) {
    cineClearMarkers();
    (scene.callouts || []).forEach(function(callout, i) {
      if (!isFinite(callout.lat) || !isFinite(callout.lng)) return;
      var el = document.createElement('div');
      el.style.cssText = 'width:28px;height:28px;border-radius:50%;border:2px solid #fff;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:800;font-size:11px;font-family:monospace;box-shadow:0 2px 10px rgba(0,0,0,.45);background:' + cineMarkerStyle(callout.kind);
      if (scene.layers && scene.layers.warning) el.style.boxShadow = '0 0 0 2px rgba(245,158,11,.8)';
      el.textContent = cineLabel(callout.kind, i);
      var popup = new GL.Popup({ offset: 18, closeButton: false })
        .setHTML('<div class="pt"><b>' + String(callout.title || 'Stop').replace(/[<>&]/g, '') + '</b></div><div class="pm">' + String(callout.note || '').replace(/[<>&]/g, '') + '</div>');
      var marker = new GL.Marker({ element: el, anchor: 'center' })
        .setLngLat([callout.lng, callout.lat])
        .setPopup(popup)
        .addTo(map);
      cine.markers.push(marker);
    });
  }
  function cineElapsed(now) {
    return now - cine.sceneStart - cine.pausedTotal;
  }
  function cineApplyCamera(scene) {
    if (cine.freeCamera) return;
    var cam = scene.camera || { mode: 'fit' };
    var pitch = Math.max(48, Math.min(72, cam.pitch != null ? cam.pitch : 58));
    if (cam.mode === 'fit' || (!scene.focus && !(scene.routeSlice && scene.routeSlice.length))) {
      var coords = sliceCoords(scene.routeSlice || [0, 1]);
      if (coords.length > 1) {
        var b = new mapboxgl.LngLatBounds();
        coords.forEach(function(c) { b.extend(c); });
        var cps = (window.__missionBriefData && window.__missionBriefData.checkpoints) || [];
        if (scene.type === 'intro' || scene.type === 'whole_route' || scene.type === 'mission_recap') {
          cps.forEach(function(p) { if (isFinite(p.lng) && isFinite(p.lat)) b.extend([p.lng, p.lat]); });
        }
        if (!b.isEmpty()) {
          map.fitBounds(b, { padding: { top: ${mapTopPadding}, bottom: ${mapBottomPadding}, left: 56, right: 56 }, duration: 2200, pitch: pitch, maxZoom: scene.type === 'whole_route' ? 11.2 : 12.4 });
        }
      } else if (scene.focus) {
        map.flyTo({ center: [scene.focus.lng, scene.focus.lat], zoom: Math.min(cam.zoom || 12.5, 14), pitch: pitch, duration: 2400, essential: true });
      }
      return;
    }
    if (cam.mode === 'follow') {
      var fcoords = sliceCoords(scene.routeSlice || [0, 1]);
      var start = fcoords[0] || (scene.focus ? [scene.focus.lng, scene.focus.lat] : map.getCenter().toArray());
      map.easeTo({ center: start, zoom: Math.min(cam.zoom || 12.2, 13.8), pitch: pitch, duration: 1800, essential: true });
      return;
    }
    if (scene.focus) {
      map.flyTo({
        center: [scene.focus.lng, scene.focus.lat],
        zoom: Math.min(cam.zoom || 13.2, 14.5),
        pitch: pitch,
        bearing: cam.bearing != null ? cam.bearing : map.getBearing(),
        duration: 2800,
        essential: true
      });
    }
  }
  function cineRunLoop(scene) {
    var duration = Math.max(1500, Math.max(9000, Number(scene.durationMs) || 12000) / Math.max(.25, Number(cine.speed) || 1));
    var cam = scene.camera || {};
    var slice = scene.routeSlice;
    var coords = slice ? sliceCoords(slice) : null;
    var orbitBase = null;
    function frame(now) {
      if (cine.failed || cine.paused) { cine.raf = null; return; }
      var elapsed = cineElapsed(now);
      var t = Math.max(0, Math.min(1, elapsed / duration));
      try {
        if (scene.type === 'whole_route') {
          setProgressLine(t);
        } else if (scene.type === 'mission_recap') {
          setProgressLine(1);
        } else if (cam.mode === 'follow' && coords && coords.length > 1 && slice) {
          setProgressLine(slice[0] + (slice[1] - slice[0]) * t);
          if (elapsed > 700) {
            var fpos = t * (coords.length - 1);
            var fi = Math.floor(fpos);
            var frac = fpos - fi;
            var c0 = coords[Math.min(fi, coords.length - 1)];
            var c1 = coords[Math.min(fi + 1, coords.length - 1)];
            var lng = c0[0] + (c1[0] - c0[0]) * frac;
            var lat = c0[1] + (c1[1] - c0[1]) * frac;
            var bearing = 0;
            if (fi + 1 < coords.length) {
              var dx = c1[0] - c0[0], dy = c1[1] - c0[1];
              bearing = (Math.atan2(dx, dy) * 180 / Math.PI + 360) % 360;
            }
            if (!cine.freeCamera) {
              map.easeTo({ center: [lng, lat], bearing: bearing, zoom: Math.min(cam.zoom || 12.4, 13.8), pitch: Math.max(58, Math.min(72, cam.pitch || 66)), duration: 0 });
            }
          }
        } else if (cam.mode === 'orbit' && elapsed > 2400) {
          if (orbitBase === null) orbitBase = map.getBearing();
          var ot = Math.max(0, Math.min(1, (elapsed - 2400) / Math.max(1, duration - 2400)));
          if (!cine.freeCamera) map.setBearing(orbitBase + 85 * ot);
        }
      } catch (err) { cineFail(err); return; }
      if (t >= 1) { cineFinishScene(); return; }
      cine.raf = requestAnimationFrame(frame);
    }
    cine.raf = requestAnimationFrame(frame);
  }
  function cineStartScene(i) {
    if (cine.failed) return;
    if (i >= cine.scenes.length) { cineComplete(); return; }
    var scene = cine.scenes[i];
    cine.index = i;
    cine.sceneStart = performance.now();
    cine.pausedTotal = 0;
    cine.paused = false;
    cinePost('cinematic_scene_started', { sceneId: scene.id, sceneType: scene.type, index: i });
    try {
      ensureCineRouteLayers();
      ensureCineTerrain(scene);
      showCineCallouts(scene);
      cineApplyCamera(scene);
    } catch (err) { cineFail(err); return; }
    cineRunLoop(scene);
  }
  function cineFinishScene() {
    cineStopAnim();
    var scene = cine.scenes[cine.index];
    cinePost('cinematic_scene_finished', { sceneId: scene && scene.id, index: cine.index });
    cineStartScene(cine.index + 1);
  }
  function cineComplete() {
    cine.playing = false;
    cine.paused = false;
    cineStopAnim();
    cineClearMarkers();
    setProgressLine(1);
    cinePost('cinematic_complete', { scenes: cine.scenes.length });
  }
  window.__cinematic = {
    replay: function() {
      if (!cine.scenes.length) return;
      cine.failed = false;
      cine.playing = true;
      cine.paused = false;
      cineStopAnim();
      cineClearMarkers();
      setProgressLine(0.001);
      cinePost('cinematic_started', {});
      cineStartScene(0);
    },
    pause: function() {
      if (!cine.playing || cine.paused) return;
      cine.paused = true;
      cine.pausedAt = performance.now();
      cineStopAnim();
      cinePost('cinematic_paused', { index: cine.index });
    },
    resume: function() {
      if (!cine.playing || !cine.paused) return;
      cine.pausedTotal += performance.now() - cine.pausedAt;
      cine.paused = false;
      cinePost('cinematic_resumed', { index: cine.index });
      var scene = cine.scenes[cine.index];
      if (scene) cineRunLoop(scene);
    },
    skip: function() {
      if (!cine.playing || cine.failed) return;
      if (cine.paused) {
        cine.pausedTotal += performance.now() - cine.pausedAt;
        cine.paused = false;
      }
      cineFinishScene();
    },
    setSpeed: function(msg) {
      var next = Number(msg && msg.speed);
      if (isFinite(next) && next > 0) cine.speed = next;
    },
    setFreeCamera: function(msg) {
      cine.freeCamera = !!(msg && msg.enabled);
    },
    seekTo: function(msg) {
      if (!cine.scenes.length) return;
      var ratio = Math.max(0, Math.min(1, Number(msg && msg.ratio) || 0));
      cineStopAnim();
      cine.playing = true;
      cine.paused = true;
      cine.pausedAt = performance.now();
      cine.pausedTotal = 0;
      var sceneIndex = sceneForRatio(ratio);
      var scene = cine.scenes[sceneIndex] || cine.scenes[0];
      cine.index = Math.max(0, sceneIndex);
      cine.sceneStart = performance.now();
      setProgressLine(ratio);
      showCineCallouts(scene);
      if (!cine.freeCamera) {
        var point = pointAtRatio(ratio);
        var ahead = pointAtRatio(Math.min(1, ratio + 0.01));
        if (point) {
          var bearing = map.getBearing();
          if (ahead) {
            var dx = ahead[0] - point[0], dy = ahead[1] - point[1];
            bearing = (Math.atan2(dx, dy) * 180 / Math.PI + 360) % 360;
          }
          var cam = scene.camera || {};
          map.easeTo({
            center: point,
            bearing: bearing,
            zoom: Math.min(cam.zoom || 13.2, 14.2),
            pitch: Math.max(54, Math.min(68, cam.pitch || 62)),
            duration: 350,
            essential: true
          });
        }
      }
      cinePost('cinematic_seek', { ratio: ratio, sceneId: scene && scene.id, sceneType: scene && scene.type, index: cine.index });
      cinePost('cinematic_paused', { index: cine.index });
    },
    stop: function() {
      cine.playing = false;
      cine.paused = false;
      cine.failed = false;
      cineStopAnim();
      cineClearMarkers();
      cine.scenes = [];
      cine.index = -1;
    }
  };
  function startMissionBriefFromMsg(msg) {
    window.__missionBriefData = {
      scenes: msg.scenes || [],
      route: msg.route || cineRoute(),
      checkpoints: msg.checkpoints || []
    };
    cine.scenes = window.__missionBriefData.scenes;
    cine.speed = Number(msg.speed) > 0 ? Number(msg.speed) : cine.speed;
    if (msg.route && msg.route.length > 1) {
      _routeCoords = msg.route;
      rebuildRouteCum();
      updateRoute();
    }
    setTerrainLayer(true);
    cinePost('cinematic_ready', { scenes: cine.scenes.length });
    if (cine.scenes.length > 1 && cineRoute().length > 1) {
      window.__cinematic.replay();
    } else {
      cinePost('cinematic_error', { message: 'Route too short for mission briefing.' });
    }
  }
`;
}
