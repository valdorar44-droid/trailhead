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
    var duration = Math.max(9000, Number(scene.durationMs) || 12000);
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
            map.easeTo({ center: [lng, lat], bearing: bearing, zoom: Math.min(cam.zoom || 12.4, 13.8), pitch: Math.max(58, Math.min(72, cam.pitch || 66)), duration: 0 });
          }
        } else if (cam.mode === 'orbit' && elapsed > 2400) {
          if (orbitBase === null) orbitBase = map.getBearing();
          var ot = Math.max(0, Math.min(1, (elapsed - 2400) / Math.max(1, duration - 2400)));
          map.setBearing(orbitBase + 85 * ot);
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
