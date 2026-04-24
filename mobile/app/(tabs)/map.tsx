import { useEffect, useRef, useState, useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, Linking, Animated, TextInput, ActivityIndicator } from 'react-native';
import { WebView } from 'react-native-webview';
import * as Location from 'expo-location';
import * as Speech from 'expo-speech';
import { Ionicons } from '@expo/vector-icons';
import { useStore } from '@/lib/store';
import { api, Report, Pin } from '@/lib/api';
import { C, mono } from '@/lib/design';

// ─── Types ────────────────────────────────────────────────────────────────────

type WP = { lat: number; lng: number; name: string; day: number; type: string };
type MapLayer = 'satellite' | 'topo' | 'hybrid';

interface RouteStep {
  type: string;
  modifier: string;
  name: string;
  distance: number; // metres
  duration: number; // seconds
}

// ─── Geo math ─────────────────────────────────────────────────────────────────

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function calcBearing(lat1: number, lng1: number, lat2: number, lng2: number) {
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const y = Math.sin(dLng) * Math.cos(lat2 * Math.PI / 180);
  const x = Math.cos(lat1 * Math.PI / 180) * Math.sin(lat2 * Math.PI / 180) -
    Math.sin(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.cos(dLng);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

function compassDir(deg: number) {
  return ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(deg / 45) % 8];
}

function formatDist(km: number) {
  const mi = km * 0.621371;
  if (mi < 0.05) return 'ARRIVING';
  if (mi < 0.12) return `${Math.round(mi * 5280)} ft`;
  return mi >= 10 ? `${Math.round(mi)} mi` : `${mi.toFixed(1)} mi`;
}

function formatStepDist(metres: number) {
  const mi = metres * 0.000621371;
  if (mi < 0.05) return 'now';
  if (mi < 0.12) return `${Math.round(metres * 3.28084 / 100) * 100} ft`;
  return mi >= 10 ? `${Math.round(mi)} mi` : `${mi.toFixed(1)} mi`;
}

// ─── Maneuver helpers ─────────────────────────────────────────────────────────

function stepIcon(type: string, modifier: string): any {
  if (type === 'arrive') return 'flag-outline';
  if (type === 'depart') return 'navigate-outline';
  if (type === 'roundabout' || type === 'rotary') return 'refresh-outline';
  if (modifier.includes('uturn')) return 'refresh-outline';
  if (modifier.includes('sharp left') || modifier.includes('left')) return 'return-up-back-outline';
  if (modifier.includes('sharp right') || modifier.includes('right')) return 'return-up-forward-outline';
  return 'arrow-up-outline';
}

function stepLabel(type: string, modifier: string): string {
  if (type === 'arrive') return 'ARRIVE';
  if (type === 'depart') return 'START';
  if (type === 'roundabout') return 'ROUNDABOUT';
  if (modifier === 'uturn') return 'U-TURN';
  if (modifier.includes('sharp left')) return 'SHARP LEFT';
  if (modifier.includes('sharp right')) return 'SHARP RIGHT';
  if (modifier.includes('slight left')) return 'BEAR LEFT';
  if (modifier.includes('slight right')) return 'BEAR RIGHT';
  if (modifier.includes('left')) return 'TURN LEFT';
  if (modifier.includes('right')) return 'TURN RIGHT';
  return 'CONTINUE';
}

// ─── Map HTML ─────────────────────────────────────────────────────────────────

const TILE_SATELLITE = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
const TILE_TOPO      = 'https://a.tile.opentopomap.org/{z}/{x}/{y}.png';
const TILE_LABELS    = 'https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}';

const buildMapHtml = (
  centerLat: number, centerLng: number,
  waypoints: WP[],
  campsites: { lat: number; lng: number; name: string }[],
  gasList:   { lat: number; lng: number; name: string }[],
  pins:      { lat: number; lng: number; name: string; type: string }[],
) => `<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width,initial-scale=1.0,maximum-scale=1.0">
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<style>
  body,html{margin:0;padding:0;height:100%;background:#080c12;}
  #map{height:100vh;width:100vw;}
  .wp{background:#f97316;border:2.5px solid #fff;border-radius:50%;
    width:30px;height:30px;display:flex;align-items:center;justify-content:center;
    color:#fff;font-weight:800;font-size:12px;font-family:monospace;
    box-shadow:0 2px 10px rgba(249,115,22,0.55);}
  .wp.nav-target{background:#fff;color:#f97316;
    animation:pulse 1.4s ease-in-out infinite;}
  @keyframes pulse{
    0%,100%{box-shadow:0 0 0 4px rgba(249,115,22,0.45);}
    50%{box-shadow:0 0 0 10px rgba(249,115,22,0.1);}}
  .camp{background:rgba(34,197,94,0.15);border:1.5px solid #22c55e;
    border-radius:50%;width:28px;height:28px;display:flex;align-items:center;justify-content:center;font-size:14px;}
  .gas{background:rgba(234,179,8,0.15);border:1.5px solid #eab308;
    border-radius:50%;width:28px;height:28px;display:flex;align-items:center;justify-content:center;font-size:14px;}
  .pin{background:rgba(168,85,247,0.15);border:1.5px solid #a855f7;
    border-radius:50%;width:28px;height:28px;display:flex;align-items:center;justify-content:center;font-size:14px;}
  .me{background:#f97316;border:3px solid #fff;border-radius:50%;
    width:14px;height:14px;box-shadow:0 0 0 4px rgba(249,115,22,0.3);}
  .search-pin{background:rgba(59,130,246,0.15);border:1.5px solid #3b82f6;
    border-radius:50%;width:28px;height:28px;display:flex;align-items:center;justify-content:center;font-size:14px;}
  .leaflet-popup-content-wrapper{background:#0f1319;border:1px solid #252d3d;
    color:#f1f5f9;border-radius:10px;box-shadow:0 4px 20px rgba(0,0,0,0.6);}
  .leaflet-popup-tip{background:#0f1319;}
  .pt{font-weight:700;font-size:13px;margin-bottom:3px;}
  .pm{color:#4b5563;font-size:11px;font-family:monospace;}
</style>
</head>
<body><div id="map"></div>
<script>
(function(){
  var wps   = ${JSON.stringify(waypoints)};
  var camps = ${JSON.stringify(campsites.slice(0,30))};
  var gas   = ${JSON.stringify(gasList.slice(0,20))};
  var pins  = ${JSON.stringify(pins.slice(0,30))};

  var zoom  = wps.length > 1 ? 7 : 10;
  var map   = L.map('map',{zoomControl:false,attributionControl:false})
                .setView([${centerLat},${centerLng}],zoom);

  // ── IndexedDB offline tile cache ────────────────────────────────────────────
  var _idb=null;
  var _idbReady=new Promise(function(res){
    var req=indexedDB.open('trailhead-tiles',1);
    req.onupgradeneeded=function(e){e.target.result.createObjectStore('tiles',{keyPath:'k'});};
    req.onsuccess=function(e){_idb=e.target.result;res();};
    req.onerror=function(){res();};
  });
  function _getT(k){return _idbReady.then(function(){if(!_idb)return null;return new Promise(function(r){var tx=_idb.transaction('tiles','readonly');var rq=tx.objectStore('tiles').get(k);rq.onsuccess=function(){r(rq.result?rq.result.v:null);};rq.onerror=function(){r(null);};});});}
  function _setT(k,v){return _idbReady.then(function(){if(!_idb)return;try{_idb.transaction('tiles','readwrite').objectStore('tiles').put({k:k,v:v});}catch(e){}});}
  var CachedTileLayer=L.TileLayer.extend({_cp:'sat',createTile:function(coords,done){
    var tile=document.createElement('img');tile.setAttribute('role','presentation');tile.setAttribute('alt','');
    var url=this.getTileUrl(coords);var key=this._cp+'_'+coords.z+'_'+coords.x+'_'+coords.y;
    _getT(key).then(function(cached){
      if(cached){tile.src=cached;done(null,tile);}
      else{tile.onload=function(){done(null,tile);};tile.onerror=function(e){done(e,tile);};tile.src=url;}
    }).catch(function(){tile.onload=function(){done(null,tile);};tile.onerror=function(e){done(e,tile);};tile.src=url;});
    return tile;
  }});
  L.tileLayer.cached=function(url,prefix,opts){var l=new CachedTileLayer(url,opts||{maxZoom:19});l._cp=prefix||'sat';return l;};

  var currentLayerUrl='${TILE_SATELLITE}';
  var currentLayerPrefix='sat';
  var downloadActive=false;

  function _ll2t(lat,lng,z){var x=Math.floor((lng+180)/360*Math.pow(2,z));var sin=Math.sin(lat*Math.PI/180);var y=Math.floor((0.5-Math.log((1+sin)/(1-sin))/(4*Math.PI))*Math.pow(2,z));return{x:Math.max(0,x),y:Math.max(0,y)};}
  async function _fetchDU(url){var r=await fetch(url);if(!r.ok)throw new Error('x');var b=await r.blob();return new Promise(function(res,rej){var rd=new FileReader();rd.onload=function(){res(rd.result);};rd.onerror=rej;rd.readAsDataURL(b);});}
  async function _dlTiles(bounds,minZ,maxZ){
    var tiles=[],MAX=2000;
    for(var z=minZ;z<=maxZ&&tiles.length<MAX;z++){
      var nw=_ll2t(bounds.getNorth(),bounds.getWest(),z);var se=_ll2t(bounds.getSouth(),bounds.getEast(),z);
      var cap=Math.pow(2,z)-1;
      for(var x=Math.max(0,nw.x);x<=Math.min(cap,se.x)&&tiles.length<MAX;x++){
        for(var y=Math.max(0,nw.y);y<=Math.min(cap,se.y)&&tiles.length<MAX;y++){tiles.push({z:z,x:x,y:y});}
      }
    }
    var total=tiles.length,saved=0,BATCH=5;
    postRN({type:'download_progress',percent:0,saved:0,total:total});
    for(var i=0;i<tiles.length;i+=BATCH){
      if(!downloadActive)break;
      var batch=tiles.slice(i,i+BATCH);
      await Promise.allSettled(batch.map(async function(t){
        var url=currentLayerUrl.replace('{z}',t.z).replace('{x}',t.x).replace('{y}',t.y);
        var key=currentLayerPrefix+'_'+t.z+'_'+t.x+'_'+t.y;
        try{var ex=await _getT(key);if(!ex){var d=await _fetchDU(url);await _setT(key,d);}saved++;postRN({type:'download_progress',percent:Math.round(saved/total*100),saved:saved,total:total});}
        catch(e){saved++;}
      }));
    }
    postRN({type:'download_complete',saved:saved,total:total});
  }

  var baseLayer   = L.tileLayer.cached('${TILE_SATELLITE}','sat',{maxZoom:19});
  baseLayer.addTo(map);
  var labelLayer  = null;
  var fallbackLine = null;
  var routeLine    = null;
  var userMarker   = null;
  var wpMarkers    = [];
  var searchPin    = null;
  var breadcrumbPts= [];
  var breadcrumb   = null;

  // ── Markers ─────────────────────────────────────────────────────────────────

  function mkWp(w,i,isTarget){
    var el=document.createElement('div');
    el.className='wp'+(isTarget?' nav-target':'');
    el.textContent=w.day||i+1;
    return L.divIcon({className:'',html:el.outerHTML,iconSize:[30,30],iconAnchor:[15,15]});
  }

  wps.forEach(function(w,i){
    var m=L.marker([w.lat,w.lng],{icon:mkWp(w,i,false)}).addTo(map)
      .bindPopup('<div class="pt">'+w.name+'</div><div class="pm">Day '+w.day+' · '+w.type+'</div>');
    m.on('click',function(){postRN({type:'wp_tapped',idx:i,name:w.name});});
    wpMarkers.push({m:m,w:w,i:i});
  });
  camps.forEach(function(c){
    L.marker([c.lat,c.lng],{icon:L.divIcon({className:'',html:'<div class="camp">⛺</div>',iconSize:[28,28],iconAnchor:[14,14]})})
      .addTo(map).bindPopup('<div class="pt">'+c.name+'</div><div class="pm">Campsite</div>');
  });
  gas.forEach(function(g){
    L.marker([g.lat,g.lng],{icon:L.divIcon({className:'',html:'<div class="gas">⛽</div>',iconSize:[28,28],iconAnchor:[14,14]})})
      .addTo(map).bindPopup('<div class="pt">'+g.name+'</div><div class="pm">Fuel</div>');
  });
  pins.forEach(function(p){
    L.marker([p.lat,p.lng],{icon:L.divIcon({className:'',html:'<div class="pin">📍</div>',iconSize:[28,28],iconAnchor:[14,14]})})
      .addTo(map).bindPopup('<div class="pt">'+p.name+'</div><div class="pm">'+p.type+'</div>');
  });

  if(wps.length>=2){
    var grp=new L.featureGroup(wps.map(function(w){return L.marker([w.lat,w.lng]);}));
    map.fitBounds(grp.getBounds().pad(0.15));
  }

  // ── OSRM routing ────────────────────────────────────────────────────────────

  function drawFallback(){
    if(fallbackLine) return;
    fallbackLine=L.polyline(wps.map(function(w){return[w.lat,w.lng];}),
      {color:'#f97316',weight:3,dashArray:'6,4',opacity:0.8}).addTo(map);
    postRN({type:'route_ready',routed:false,steps:[]});
  }

  async function loadRoute(){
    if(wps.length<2){return;}
    var coords=wps.map(function(w){return w.lng+','+w.lat;}).join(';');
    var url='https://router.project-osrm.org/route/v1/driving/'+coords+
            '?steps=true&geometries=geojson&overview=full&annotations=false';
    try{
      var ctrl=new AbortController();
      var tid=setTimeout(function(){ctrl.abort();},9000);
      var res=await fetch(url,{signal:ctrl.signal});
      clearTimeout(tid);
      var data=await res.json();
      if(data.code!=='Ok'||!data.routes||!data.routes[0]){drawFallback();return;}
      var route=data.routes[0];
      routeLine=L.geoJSON(route.geometry,{
        style:{color:'#f97316',weight:4.5,opacity:0.92,lineCap:'round',lineJoin:'round'}
      }).addTo(map);
      // parse steps + per-leg groups
      var steps=[]; var legs=[];
      (route.legs||[]).forEach(function(leg){
        var legSteps=[];
        (leg.steps||[]).forEach(function(s){
          if(s.distance>0||s.maneuver.type==='arrive'){
            var step={type:s.maneuver.type,modifier:s.maneuver.modifier||'',
              name:s.name||'',distance:s.distance,duration:s.duration};
            steps.push(step); legSteps.push(step);
          }
        });
        legs.push(legSteps);
      });
      postRN({type:'route_ready',routed:true,steps:steps,legs:legs,
              total_distance:route.distance,total_duration:route.duration});
    }catch(e){drawFallback();}
  }

  loadRoute();

  // ── Helpers ──────────────────────────────────────────────────────────────────

  function postRN(obj){
    try{window.ReactNativeWebView.postMessage(JSON.stringify(obj));}catch(e){}
  }

  function setUserPos(lat,lng){
    var icon=L.divIcon({className:'',html:'<div class="me"></div>',iconSize:[14,14],iconAnchor:[7,7]});
    if(userMarker){userMarker.setLatLng([lat,lng]);}
    else{userMarker=L.marker([lat,lng],{icon:icon,zIndexOffset:2000}).addTo(map);}
  }

  function setNavTarget(idx){
    wpMarkers.forEach(function(m){
      m.m.setIcon(mkWp(m.w,m.i,m.i===idx));
    });
  }

  // ── Message handler ──────────────────────────────────────────────────────────

  function onMsg(e){
    try{
      var msg=JSON.parse(e.data);
      if(msg.type==='user_pos'&&msg.lat){setUserPos(msg.lat,msg.lng);}
      if(msg.type==='nav_center'&&msg.lat){setUserPos(msg.lat,msg.lng);map.setView([msg.lat,msg.lng],15);}
      if(msg.type==='locate'&&msg.lat){setUserPos(msg.lat,msg.lng);map.setView([msg.lat,msg.lng],13);}
      if(msg.type==='nav_target'){setNavTarget(msg.idx);}
      if(msg.type==='nav_reset'){setNavTarget(-1);}
      if(msg.type==='fly_to'&&msg.lat){
        map.setView([msg.lat,msg.lng],14);
        if(searchPin){map.removeLayer(searchPin);}
        searchPin=L.marker([msg.lat,msg.lng],{icon:L.divIcon({className:'',
          html:'<div class="search-pin">📍</div>',iconSize:[28,28],iconAnchor:[14,28]})})
          .addTo(map).bindPopup('<div class="pt">'+(msg.name||'Location')+'</div>');
        searchPin.openPopup();
      }
      if(msg.type==='track_point'&&msg.lat){
        breadcrumbPts.push([msg.lat,msg.lng]);
        if(breadcrumb){breadcrumb.setLatLngs(breadcrumbPts);}
        else{breadcrumb=L.polyline(breadcrumbPts,{color:'#3b82f6',weight:3,opacity:0.75,dashArray:'1,5'}).addTo(map);}
      }
      if(msg.type==='clear_track'){
        breadcrumbPts=[];if(breadcrumb){map.removeLayer(breadcrumb);breadcrumb=null;}
      }
      if(msg.type==='download_tiles'){
        if(!downloadActive){downloadActive=true;var bounds=map.getBounds();_dlTiles(bounds,msg.minZ||10,msg.maxZ||15);}
      }
      if(msg.type==='cancel_download'){downloadActive=false;}
      if(msg.type==='set_layer'){
        map.removeLayer(baseLayer);
        if(labelLayer){map.removeLayer(labelLayer);labelLayer=null;}
        currentLayerUrl=msg.url;currentLayerPrefix=msg.cachePrefix||'sat';
        baseLayer=L.tileLayer.cached(msg.url,currentLayerPrefix,{maxZoom:19,opacity:msg.opacity||1}).addTo(map);
        baseLayer.bringToBack();
        if(msg.labelsUrl){
          labelLayer=L.tileLayer(msg.labelsUrl,{maxZoom:19,opacity:0.75}).addTo(map);
          labelLayer.bringToBack();baseLayer.bringToBack();
        }
      }
    }catch(err){}
  }
  document.addEventListener('message',onMsg);
  window.addEventListener('message',onMsg);
})();
</script>
</body></html>`;

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function MapScreen() {
  const activeTrip = useStore(s => s.activeTrip);
  const webRef = useRef<WebView>(null);

  const [userLoc,   setUserLoc]   = useState<{ lat: number; lng: number } | null>(null);
  const [userSpeed, setUserSpeed] = useState<number | null>(null);
  const [navMode,   setNavMode]   = useState(false);
  const [navIdx,    setNavIdx]    = useState(0);
  const [routeSteps,  setRouteSteps]  = useState<RouteStep[]>([]);
  const [isRouted,    setIsRouted]    = useState(false);
  const [mapLayer,    setMapLayerState] = useState<MapLayer>('satellite');
  const [audioGuide,  setAudioGuide]   = useState<Record<string, string>>({});
  const [showSteps,   setShowSteps]    = useState(false);
  const [showPanel,   setShowPanel]    = useState(true);
  const [routeAlerts, setRouteAlerts]  = useState<Report[]>([]);
  const [showAlerts,  setShowAlerts]   = useState(false);
  const [communityPins, setCommunityPins] = useState<Pin[]>([]);
  const [routeLegs,    setRouteLegs]    = useState<RouteStep[][]>([]);
  const [searchQuery,  setSearchQuery]  = useState('');
  const [searchResults,setSearchResults] = useState<{ lat: number; lng: number; name: string }[]>([]);
  const [showSearch,   setShowSearch]   = useState(false);
  const [isSearching,  setIsSearching]  = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [downloadTotal, setDownloadTotal] = useState(0);
  const [offlineSaved, setOfflineSaved] = useState(false);

  const navAnim  = useRef(new Animated.Value(0)).current;
  const navRef   = useRef({ active: false, idx: 0, wps: [] as WP[] });
  const guideRef = useRef<Record<string, string>>({});
  const spokenRef = useRef(new Set<string>());

  // Keep refs in sync
  useEffect(() => { navRef.current.active = navMode; }, [navMode]);
  useEffect(() => { navRef.current.idx = navIdx; }, [navIdx]);
  useEffect(() => { guideRef.current = audioGuide; }, [audioGuide]);

  const waypoints: WP[] = useMemo(() =>
    (activeTrip?.plan.waypoints ?? [])
      .filter(w => w.lat && w.lng)
      .map(w => ({ lat: w.lat!, lng: w.lng!, name: w.name, day: w.day, type: w.type })),
    [activeTrip?.trip_id]
  );

  useEffect(() => { navRef.current.wps = waypoints; }, [waypoints]);

  // ── Location watch ──────────────────────────────────────────────────────────

  useEffect(() => {
    let sub: Location.LocationSubscription | null = null;
    Location.requestForegroundPermissionsAsync().then(({ status }) => {
      if (status !== 'granted') return;
      Location.watchPositionAsync(
        { accuracy: Location.Accuracy.BestForNavigation, timeInterval: 2000, distanceInterval: 8 },
        loc => {
          const pos = { lat: loc.coords.latitude, lng: loc.coords.longitude };
          setUserLoc(pos);
          setUserSpeed(loc.coords.speed ?? null);

          const { active, idx, wps } = navRef.current;
          webRef.current?.postMessage(JSON.stringify({
            type: active ? 'nav_center' : 'user_pos',
            lat: pos.lat, lng: pos.lng,
          }));

          if (active) {
            webRef.current?.postMessage(JSON.stringify({ type: 'track_point', lat: pos.lat, lng: pos.lng }));
          }

          if (!active || !wps[idx]) return;
          const dist = haversineKm(pos.lat, pos.lng, wps[idx].lat, wps[idx].lng);

          // Speak narration when approaching
          const narration = guideRef.current[wps[idx].name];
          if (dist < 0.5 && narration && !spokenRef.current.has(wps[idx].name)) {
            spokenRef.current.add(wps[idx].name);
            Speech.speak(narration, { rate: 0.88, language: 'en-US' });
          }

          // Auto-advance waypoint
          if (dist < 0.25 && idx < wps.length - 1) {
            const next = idx + 1;
            setNavIdx(next);
            navRef.current.idx = next;
            webRef.current?.postMessage(JSON.stringify({ type: 'nav_target', idx: next }));
          }
        }
      ).then(s => { sub = s; });
    });
    return () => { sub?.remove(); };
  }, []);

  // ── Trip data ───────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!activeTrip) return;
    const wps = activeTrip.plan.waypoints.filter(w => w.lat && w.lng);
    if (!wps.length) return;
    const center = wps[Math.floor(wps.length / 2)];
    if (center.lat && center.lng) {
      api.getNearbyPins(center.lat!, center.lng!, 3.0).then(setCommunityPins).catch(() => {});
    }
    api.getReportsAlongRoute(wps).then(alerts => {
      setRouteAlerts(alerts);
      if (alerts.some(a => a.severity === 'critical' || a.severity === 'high')) setShowAlerts(true);
    }).catch(() => {});
    // Pre-load audio guide
    if (activeTrip.audio_guide) {
      setAudioGuide(activeTrip.audio_guide);
    } else {
      api.getAudioGuide(activeTrip.trip_id).then(setAudioGuide).catch(() => {});
    }
    setNavIdx(0); setNavMode(false); setRouteSteps([]); setIsRouted(false);
    spokenRef.current.clear();
  }, [activeTrip?.trip_id]);

  // ── Nav mode animate + speak start ─────────────────────────────────────────

  useEffect(() => {
    Animated.spring(navAnim, { toValue: navMode ? 1 : 0, tension: 80, friction: 10, useNativeDriver: true }).start();
    if (navMode) {
      setShowPanel(false);
      webRef.current?.postMessage(JSON.stringify({ type: 'nav_target', idx: navIdx }));
      const first = waypoints[navIdx];
      if (first) Speech.speak(`Navigation started. Heading to ${first.name}.`, { rate: 0.9 });
    } else {
      webRef.current?.postMessage(JSON.stringify({ type: 'nav_reset' }));
      webRef.current?.postMessage(JSON.stringify({ type: 'clear_track' }));
      Speech.stop();
    }
  }, [navMode]);

  // ── Voice turn announcement on leg advance ──────────────────────────────────

  useEffect(() => {
    if (!navMode || navIdx === 0 || routeLegs.length === 0) return;
    const legSteps = routeLegs[navIdx];
    if (!legSteps) return;
    const first = legSteps.find(s => s.type !== 'depart' && s.distance > 50);
    if (!first) return;
    const road = first.name ? ` on ${first.name}` : '';
    const t = setTimeout(() => {
      Speech.speak(`In ${formatStepDist(first.distance)}, ${stepLabel(first.type, first.modifier)}${road}`, { rate: 0.9 });
    }, 1500);
    return () => clearTimeout(t);
  }, [navIdx, navMode]);

  // ── Nominatim map search ────────────────────────────────────────────────────

  async function searchMap() {
    if (!searchQuery.trim()) return;
    setIsSearching(true);
    try {
      const q = encodeURIComponent(searchQuery.trim());
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?q=${q}&format=json&limit=5`,
        { headers: { 'User-Agent': 'Trailhead/1.0' } }
      );
      const data = await res.json();
      setSearchResults(data.map((r: any) => ({
        lat: parseFloat(r.lat), lng: parseFloat(r.lon), name: r.display_name,
      })));
    } catch {}
    setIsSearching(false);
  }

  // ── Layer switch ────────────────────────────────────────────────────────────

  function switchLayer() {
    const next: MapLayer = mapLayer === 'satellite' ? 'topo' : mapLayer === 'topo' ? 'hybrid' : 'satellite';
    setMapLayerState(next);
    let msg: any = { type: 'set_layer' };
    if (next === 'satellite') {
      msg.url = TILE_SATELLITE; msg.cachePrefix = 'sat';
    } else if (next === 'topo') {
      msg.url = TILE_TOPO; msg.opacity = 0.96; msg.cachePrefix = 'topo';
    } else {
      msg.url = TILE_SATELLITE; msg.labelsUrl = TILE_LABELS; msg.cachePrefix = 'hyb';
    }
    webRef.current?.postMessage(JSON.stringify(msg));
  }

  // ── WebView message handler ──────────────────────────────────────────────────

  function onWebMessage(e: any) {
    try {
      const msg = JSON.parse(e.nativeEvent.data);
      if (msg.type === 'route_ready') {
        setIsRouted(msg.routed);
        setRouteSteps(msg.steps ?? []);
        setRouteLegs(msg.legs ?? []);
      }
      if (msg.type === 'wp_tapped') {
        setNavIdx(msg.idx);
        navRef.current.idx = msg.idx;
        if (!navRef.current.active) setNavMode(true);
      }
      if (msg.type === 'download_progress') {
        setDownloadProgress(msg.percent ?? 0);
        setDownloadTotal(msg.total ?? 0);
      }
      if (msg.type === 'download_complete') {
        setIsDownloading(false);
        setDownloadProgress(100);
        setOfflineSaved(true);
        setTimeout(() => setDownloadProgress(0), 2000);
      }
    } catch {}
  }

  // ── Stable map HTML (only rebuilds on trip/pins change) ─────────────────────

  const campsites = useMemo(() =>
    (activeTrip?.campsites ?? []).filter(c => c.lat && c.lng).map(c => ({ lat: c.lat, lng: c.lng, name: c.name })),
    [activeTrip?.trip_id]
  );
  const gas = useMemo(() =>
    (activeTrip?.gas_stations ?? []).filter(g => g.lat && g.lng).map(g => ({ lat: g.lat, lng: g.lng, name: g.name })),
    [activeTrip?.trip_id]
  );
  const pinList = useMemo(() =>
    communityPins.map(p => ({ lat: p.lat, lng: p.lng, name: p.name, type: p.type })),
    [communityPins.length]
  );

  const centerLat = waypoints[0]?.lat ?? 39.5;
  const centerLng = waypoints[0]?.lng ?? -111.0;

  const mapHtml = useMemo(() =>
    buildMapHtml(centerLat, centerLng, waypoints, campsites, gas, pinList),
    [activeTrip?.trip_id, communityPins.length]
  );

  // ── Nav HUD values ──────────────────────────────────────────────────────────

  const navTarget = navMode && waypoints[navIdx] ? waypoints[navIdx] : null;
  const distKm    = userLoc && navTarget ? haversineKm(userLoc.lat, userLoc.lng, navTarget.lat, navTarget.lng) : null;
  const bearing   = userLoc && navTarget ? calcBearing(userLoc.lat, userLoc.lng, navTarget.lat, navTarget.lng) : null;
  const speedMph  = userSpeed !== null && userSpeed > 0 ? userSpeed * 2.237 : null;
  const etaMins   = distKm && userSpeed && userSpeed > 0.5
    ? Math.round(distKm / (userSpeed * 3.6) * 60) : null;

  // Next OSRM step (rough: first non-depart step with significant distance)
  const nextStep = routeSteps.find(s => s.type !== 'depart' && s.distance > 50) ?? null;
  const isProceeding = distKm !== null && distKm > 30;

  function openInMaps() {
    if (!waypoints.length) return;
    const origin = `${waypoints[0].lat},${waypoints[0].lng}`;
    const dest   = `${waypoints[waypoints.length - 1].lat},${waypoints[waypoints.length - 1].lng}`;
    const mids   = waypoints.slice(1, -1).slice(0, 8).map(w => `${w.lat},${w.lng}`).join('|');
    const url    = `https://www.google.com/maps/dir/?api=1&origin=${origin}&destination=${dest}${mids ? `&waypoints=${encodeURIComponent(mids)}` : ''}&travelmode=driving`;
    Linking.openURL(url).catch(() =>
      Linking.openURL(`maps://?saddr=${origin}&daddr=${dest}`).catch(() => {})
    );
  }

  const layerLabel: Record<MapLayer, string> = { satellite: 'SAT', topo: 'TOPO', hybrid: 'HYB' };

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <View style={s.container}>
      <WebView
        ref={webRef}
        source={{ html: mapHtml }}
        style={s.map}
        javaScriptEnabled
        allowsInlineMediaPlayback
        scrollEnabled={false}
        onShouldStartLoadWithRequest={() => true}
        onMessage={onWebMessage}
        onLoad={() => {
          if (userLoc) webRef.current?.postMessage(JSON.stringify({ type: 'user_pos', lat: userLoc.lat, lng: userLoc.lng }));
        }}
      />

      {/* Top bar */}
      <View style={s.topBar}>
        <View style={[s.topBarDot, navMode && { backgroundColor: C.green }]} />
        <Text style={s.topBarText} numberOfLines={1}>
          {isDownloading
            ? `CACHING TILES ${downloadProgress}% · ${downloadTotal} TOTAL`
            : navMode
              ? isProceeding
                ? `PROCEED TO STOP ${navIdx + 1}/${waypoints.length}`
                : `NAVIGATING · STOP ${navIdx + 1}/${waypoints.length} · ${isRouted ? '🗺 ROUTED' : '🧭 OFF-ROAD'}`
              : activeTrip ? activeTrip.plan.trip_name.toUpperCase() : 'NO ACTIVE TRIP'}
        </Text>
        {routeAlerts.length > 0 && (
          <TouchableOpacity style={s.alertPill} onPress={() => setShowAlerts(v => !v)}>
            <Text style={s.alertPillText}>⚠ {routeAlerts.length}</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Offline download progress bar */}
      {isDownloading && (
        <View style={s.dlBar}>
          <View style={[s.dlFill, { width: `${downloadProgress}%` as any }]} />
        </View>
      )}

      {/* Controls */}
      <View style={s.controls}>
        <TouchableOpacity style={s.ctrlBtn} onPress={() => {
          if (userLoc) webRef.current?.postMessage(JSON.stringify({ type: 'locate', lat: userLoc.lat, lng: userLoc.lng }));
        }}>
          <Ionicons name="locate" size={20} color={C.text} />
        </TouchableOpacity>

        <TouchableOpacity style={s.ctrlBtn} onPress={switchLayer}>
          <Text style={s.layerText}>{layerLabel[mapLayer]}</Text>
        </TouchableOpacity>

        {waypoints.length > 0 && (
          <TouchableOpacity
            style={[s.ctrlBtn, navMode && { backgroundColor: C.green + 'dd', borderColor: C.green }]}
            onPress={() => navMode ? setNavMode(false) : (setNavIdx(0), navRef.current.idx = 0, setNavMode(true))}
          >
            <Ionicons name="navigate" size={20} color={navMode ? '#fff' : C.text} />
          </TouchableOpacity>
        )}

        <TouchableOpacity
          style={[s.ctrlBtn, showSearch && { backgroundColor: '#3b82f6dd', borderColor: '#3b82f6' }]}
          onPress={() => { setShowSearch(p => !p); setSearchResults([]); setSearchQuery(''); }}
        >
          <Ionicons name="search" size={20} color={showSearch ? '#fff' : C.text} />
        </TouchableOpacity>

        {waypoints.length > 0 && (
          <TouchableOpacity
            style={[s.ctrlBtn, isDownloading && { backgroundColor: C.orange + 'dd', borderColor: C.orange }]}
            onPress={() => {
              if (isDownloading) {
                webRef.current?.postMessage(JSON.stringify({ type: 'cancel_download' }));
                setIsDownloading(false);
              } else {
                setIsDownloading(true); setOfflineSaved(false);
                webRef.current?.postMessage(JSON.stringify({ type: 'download_tiles', minZ: 10, maxZ: 15 }));
              }
            }}
          >
            <Ionicons
              name={isDownloading ? 'close-circle-outline' : offlineSaved ? 'cloud-done-outline' : 'cloud-download-outline'}
              size={20}
              color={isDownloading ? '#fff' : offlineSaved ? C.green : C.text}
            />
          </TouchableOpacity>
        )}

        {!navMode && (
          <TouchableOpacity style={s.ctrlBtn} onPress={() => setShowPanel(p => !p)}>
            <Ionicons name={showPanel ? 'chevron-down' : 'chevron-up'} size={20} color={C.text} />
          </TouchableOpacity>
        )}
      </View>

      {/* Route alerts */}
      {showAlerts && routeAlerts.length > 0 && (
        <View style={s.alertPanel}>
          <View style={s.alertHeader}>
            <Ionicons name="warning" size={14} color={C.red} />
            <Text style={s.alertTitle}>ROUTE ALERTS ({routeAlerts.length})</Text>
            <TouchableOpacity onPress={() => setShowAlerts(false)}>
              <Ionicons name="close" size={15} color={C.text3} />
            </TouchableOpacity>
          </View>
          <ScrollView style={{ maxHeight: 160 }} showsVerticalScrollIndicator={false}>
            {routeAlerts.map(r => (
              <View key={r.id} style={[s.alertItem, r.severity === 'critical' && { borderLeftWidth: 3, borderLeftColor: C.red }]}>
                <View style={{ flexDirection: 'row', gap: 8, marginBottom: 2 }}>
                  <Text style={s.alertBadge}>{r.type.replace('_', ' ').toUpperCase()}</Text>
                  {(r.severity === 'critical' || r.severity === 'high') && (
                    <Text style={[s.alertSev, { color: r.severity === 'critical' ? C.red : C.yellow }]}>
                      {r.severity.toUpperCase()}
                    </Text>
                  )}
                </View>
                {r.description ? <Text style={s.alertDesc} numberOfLines={2}>{r.description}</Text> : null}
              </View>
            ))}
          </ScrollView>
        </View>
      )}

      {/* ── Search overlay ── */}
      {showSearch && (
        <View style={s.searchOverlay}>
          <View style={s.searchBar}>
            <Ionicons name="search" size={15} color={C.text3} />
            <TextInput
              style={s.searchInput}
              value={searchQuery}
              onChangeText={setSearchQuery}
              onSubmitEditing={searchMap}
              placeholder="Search location..."
              placeholderTextColor={C.text3}
              returnKeyType="search"
              autoFocus
            />
            {isSearching
              ? <ActivityIndicator size="small" color={C.orange} />
              : searchQuery.length > 0 && (
                <TouchableOpacity onPress={searchMap}>
                  <Text style={s.searchGo}>GO</Text>
                </TouchableOpacity>
              )
            }
          </View>
          {searchResults.length > 0 && (
            <ScrollView style={s.searchResults} keyboardShouldPersistTaps="handled">
              {searchResults.map((r, i) => (
                <TouchableOpacity key={i} style={s.searchResultItem} onPress={() => {
                  webRef.current?.postMessage(JSON.stringify({ type: 'fly_to', lat: r.lat, lng: r.lng, name: r.name }));
                  setShowSearch(false); setSearchResults([]); setSearchQuery('');
                }}>
                  <Ionicons name="location-outline" size={13} color={C.text3} />
                  <Text style={s.searchResultText} numberOfLines={2}>{r.name}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          )}
        </View>
      )}

      {/* ── Navigation HUD ── */}
      <Animated.View style={[s.navHud, {
        opacity: navAnim,
        transform: [{ translateY: navAnim.interpolate({ inputRange: [0, 1], outputRange: [160, 0] }) }],
        pointerEvents: navMode ? 'box-none' : 'none',
      }]}>

        {/* Next OSRM turn instruction */}
        {nextStep && isRouted && (
          <View style={s.turnStrip}>
            <View style={s.turnIconWrap}>
              <Ionicons name={stepIcon(nextStep.type, nextStep.modifier) as any} size={22} color="#fff" />
            </View>
            <View style={s.turnInfo}>
              <Text style={s.turnLabel}>{stepLabel(nextStep.type, nextStep.modifier)}</Text>
              {nextStep.name ? <Text style={s.turnRoad} numberOfLines={1}>{nextStep.name}</Text> : null}
            </View>
            <Text style={s.turnDist}>{formatStepDist(nextStep.distance)}</Text>
          </View>
        )}

        {/* Bearing + speed strip */}
        <View style={s.navStrip}>
          {bearing !== null ? (
            <View style={s.navBearing}>
              <Animated.View style={{ transform: [{ rotate: `${bearing}deg` }] }}>
                <Ionicons name="navigate" size={18} color={C.orange} />
              </Animated.View>
              <Text style={s.navBearingText}>{compassDir(bearing)}</Text>
            </View>
          ) : (
            <View style={s.navBearing}>
              <Ionicons name="navigate-outline" size={18} color={C.text3} />
              <Text style={s.navBearingText}>--</Text>
            </View>
          )}
          <View style={s.navDistBlock}>
            <Text style={s.navDistVal}>{distKm !== null ? formatDist(distKm) : '--'}</Text>
            {etaMins !== null && (
              <Text style={s.navEta}>
                {etaMins < 60 ? `~${etaMins} min` : `~${Math.floor(etaMins / 60)}h ${etaMins % 60}m`}
              </Text>
            )}
          </View>
          {speedMph !== null && (
            <View style={s.navSpeedBlock}>
              <Text style={s.navSpeedVal}>{Math.round(speedMph)}</Text>
              <Text style={s.navSpeedUnit}>MPH</Text>
            </View>
          )}
        </View>

        {/* Next waypoint */}
        {navTarget && (
          <View style={s.navTarget}>
            <View style={s.navTargetBadge}>
              <Text style={s.navTargetBadgeText}>{isProceeding ? 'PROCEED TO' : 'NEXT STOP'}</Text>
            </View>
            <View style={s.navTargetInfo}>
              <Text style={s.navTargetName} numberOfLines={1}>{navTarget.name}</Text>
              <Text style={s.navTargetMeta}>
                Day {navTarget.day} · {navTarget.type} · {navIdx + 1} of {waypoints.length}
              </Text>
            </View>
          </View>
        )}

        {/* Turn list toggle + actions */}
        <View style={s.navActions}>
          <TouchableOpacity style={s.navEndBtn} onPress={() => setNavMode(false)}>
            <Ionicons name="close" size={14} color={C.red} />
            <Text style={s.navEndText}>END</Text>
          </TouchableOpacity>

          {routeSteps.length > 0 && (
            <TouchableOpacity style={s.navStepsBtn} onPress={() => setShowSteps(p => !p)}>
              <Ionicons name="list-outline" size={14} color={C.text2} />
              <Text style={s.navStepsBtnText}>TURNS {showSteps ? '▲' : '▼'}</Text>
            </TouchableOpacity>
          )}

        </View>

        {/* Steps list */}
        {showSteps && routeSteps.length > 0 && (
          <ScrollView style={s.stepsList} showsVerticalScrollIndicator={false}>
            {routeSteps.filter(s => s.distance > 20).map((step, i) => (
              <View key={i} style={[s.stepRow, i === 0 && s.stepRowFirst]}>
                <Ionicons name={stepIcon(step.type, step.modifier) as any} size={16} color={C.text3} />
                <View style={s.stepInfo}>
                  <Text style={s.stepLabel}>{stepLabel(step.type, step.modifier)}</Text>
                  {step.name ? <Text style={s.stepRoad} numberOfLines={1}>{step.name}</Text> : null}
                </View>
                <Text style={s.stepDist}>{formatStepDist(step.distance)}</Text>
              </View>
            ))}
          </ScrollView>
        )}
      </Animated.View>

      {/* Bottom itinerary panel */}
      {showPanel && !navMode && activeTrip && (
        <View style={s.panel}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.dayScroll}>
            {activeTrip.plan.daily_itinerary.map(day => (
              <View key={day.day} style={s.dayCard}>
                <View style={s.dayBadge}><Text style={s.dayBadgeText}>{day.day}</Text></View>
                <Text style={s.dayTitle} numberOfLines={1}>{day.title}</Text>
                <Text style={s.dayMeta}>{day.est_miles}mi · {day.road_type}</Text>
              </View>
            ))}
          </ScrollView>
          <View style={s.legendRow}>
            {([[C.orange,'⬤','Waypoint'],[C.green,'⛺','Camp'],[C.yellow,'⛽','Fuel'],['#a855f7','📍','Community']] as const)
              .map(([color, dot, label]) => (
                <View key={label} style={s.legendItem}>
                  <Text style={[s.legendDot, { color }]}>{dot}</Text>
                  <Text style={s.legendText}>{label}</Text>
                </View>
              ))}
            <TouchableOpacity style={s.mapsBtn} onPress={openInMaps}>
              <Ionicons name="open-outline" size={11} color={C.text3} />
              <Text style={s.mapsBtnText}>EXPORT</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  map: { flex: 1 },

  topBar: {
    position: 'absolute', top: 56, left: 16, right: 16,
    backgroundColor: 'rgba(8,12,18,0.92)', borderRadius: 20,
    paddingVertical: 8, paddingHorizontal: 14,
    borderWidth: 1, borderColor: C.border,
    flexDirection: 'row', alignItems: 'center', gap: 8,
  },
  topBarDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: C.orange },
  topBarText: { color: C.text, fontSize: 10, fontFamily: mono, flex: 1, letterSpacing: 0.5 },
  alertPill: {
    backgroundColor: C.red + '22', borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3,
    borderWidth: 1, borderColor: C.red,
  },
  alertPillText: { color: C.red, fontSize: 10, fontFamily: mono, fontWeight: '700' },

  controls: { position: 'absolute', top: 106, right: 16, gap: 8 },
  ctrlBtn: {
    width: 44, height: 44, borderRadius: 14,
    backgroundColor: 'rgba(8,12,18,0.92)', borderWidth: 1, borderColor: C.border,
    alignItems: 'center', justifyContent: 'center',
  },
  layerText: { color: C.text2, fontSize: 9, fontFamily: mono, fontWeight: '800', letterSpacing: 0.5 },

  alertPanel: {
    position: 'absolute', top: 106, left: 16, right: 70,
    backgroundColor: 'rgba(8,12,18,0.97)', borderRadius: 14,
    borderWidth: 1, borderColor: C.red,
  },
  alertHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 12, paddingVertical: 9,
    borderBottomWidth: 1, borderColor: C.border,
  },
  alertTitle: { color: C.red, fontSize: 10, fontFamily: mono, fontWeight: '700', flex: 1 },
  alertItem: { paddingHorizontal: 12, paddingVertical: 8, borderBottomWidth: 1, borderColor: C.s2 },
  alertBadge: { color: C.text, fontSize: 10, fontFamily: mono },
  alertSev: { fontSize: 9, fontFamily: mono, fontWeight: '700' },
  alertDesc: { color: C.text3, fontSize: 11 },

  // ── Nav HUD
  navHud: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    backgroundColor: 'rgba(8,12,18,0.97)',
    borderTopWidth: 1, borderColor: C.border,
  },

  turnStrip: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 14, paddingVertical: 10,
    backgroundColor: C.orange,
  },
  turnIconWrap: {
    width: 36, height: 36, borderRadius: 10,
    backgroundColor: 'rgba(0,0,0,0.2)', alignItems: 'center', justifyContent: 'center',
  },
  turnInfo: { flex: 1 },
  turnLabel: { color: '#fff', fontSize: 13, fontWeight: '800', fontFamily: mono, letterSpacing: 0.5 },
  turnRoad: { color: 'rgba(255,255,255,0.8)', fontSize: 11, marginTop: 1 },
  turnDist: { color: '#fff', fontSize: 13, fontWeight: '700', fontFamily: mono },

  navStrip: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: 1, borderColor: C.border,
  },
  navBearing: { flexDirection: 'row', alignItems: 'center', gap: 5, width: 50 },
  navBearingText: { color: C.orange, fontSize: 12, fontFamily: mono, fontWeight: '700' },
  navDistBlock: { flex: 1, alignItems: 'center' },
  navDistVal: { color: C.text, fontSize: 28, fontWeight: '800', fontFamily: mono },
  navEta: { color: C.text3, fontSize: 10, fontFamily: mono, marginTop: 1 },
  navSpeedBlock: { alignItems: 'center', width: 50 },
  navSpeedVal: { color: C.text2, fontSize: 22, fontWeight: '700', fontFamily: mono },
  navSpeedUnit: { color: C.text3, fontSize: 8, fontFamily: mono, letterSpacing: 0.5 },

  navTarget: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 16, paddingVertical: 10,
    borderBottomWidth: 1, borderColor: C.border,
  },
  navTargetBadge: {
    backgroundColor: C.orangeGlow, borderRadius: 6, borderWidth: 1, borderColor: C.orange,
    paddingHorizontal: 6, paddingVertical: 3,
  },
  navTargetBadgeText: { color: C.orange, fontSize: 8, fontFamily: mono, fontWeight: '700' },
  navTargetInfo: { flex: 1 },
  navTargetName: { color: C.text, fontSize: 14, fontWeight: '700' },
  navTargetMeta: { color: C.text3, fontSize: 10, fontFamily: mono, marginTop: 2 },

  navActions: {
    flexDirection: 'row', gap: 8,
    paddingHorizontal: 14, paddingVertical: 10, paddingBottom: 26,
  },
  navEndBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 12, paddingVertical: 10, borderRadius: 11,
    borderWidth: 1, borderColor: C.red + '55', backgroundColor: C.red + '14',
  },
  navEndText: { color: C.red, fontSize: 11, fontFamily: mono, fontWeight: '700' },
  navStepsBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 12, paddingVertical: 10, borderRadius: 11,
    borderWidth: 1, borderColor: C.border, backgroundColor: C.s2,
  },
  navStepsBtnText: { color: C.text2, fontSize: 11, fontFamily: mono },
  dlBar: {
    position: 'absolute', top: 92, left: 16, right: 16,
    height: 3, borderRadius: 1.5, backgroundColor: C.border, overflow: 'hidden',
  },
  dlFill: { height: 3, backgroundColor: C.orange, borderRadius: 1.5 },

  stepsList: { maxHeight: 200, borderTopWidth: 1, borderColor: C.border },
  stepRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 9, borderBottomWidth: 1, borderColor: C.s2 },
  stepRowFirst: { backgroundColor: C.s2 },
  stepInfo: { flex: 1 },
  stepLabel: { color: C.text2, fontSize: 11, fontFamily: mono, fontWeight: '700' },
  stepRoad: { color: C.text3, fontSize: 10, marginTop: 1 },
  stepDist: { color: C.text3, fontSize: 10, fontFamily: mono },

  // ── Search overlay
  searchOverlay: {
    position: 'absolute', top: 106, left: 16, right: 70,
    backgroundColor: 'rgba(8,12,18,0.97)', borderRadius: 14,
    borderWidth: 1, borderColor: '#3b82f6',
    overflow: 'hidden',
  },
  searchBar: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 12, paddingVertical: 10,
    borderBottomWidth: 1, borderColor: C.border,
  },
  searchInput: {
    flex: 1, color: C.text, fontSize: 13, fontFamily: mono,
  },
  searchGo: { color: C.orange, fontSize: 11, fontFamily: mono, fontWeight: '700' },
  searchResults: { maxHeight: 240 },
  searchResultItem: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    paddingHorizontal: 12, paddingVertical: 10,
    borderBottomWidth: 1, borderColor: C.s2,
  },
  searchResultText: { color: C.text2, fontSize: 12, flex: 1, lineHeight: 17 },

  // ── Bottom panel
  panel: { backgroundColor: C.s1, borderTopWidth: 1, borderColor: C.border, paddingBottom: 10 },
  dayScroll: { paddingHorizontal: 14, paddingVertical: 12, gap: 10 },
  dayCard: {
    backgroundColor: C.s2, borderRadius: 12, borderWidth: 1, borderColor: C.border,
    padding: 12, width: 140,
  },
  dayBadge: {
    width: 26, height: 26, borderRadius: 13,
    backgroundColor: C.orange, alignItems: 'center', justifyContent: 'center', marginBottom: 6,
  },
  dayBadgeText: { color: '#fff', fontSize: 11, fontWeight: '700', fontFamily: mono },
  dayTitle: { color: C.text, fontSize: 12, fontWeight: '600', marginBottom: 2 },
  dayMeta: { color: C.text3, fontSize: 10, fontFamily: mono },
  legendRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingBottom: 4 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  legendDot: { fontSize: 10 },
  legendText: { color: C.text3, fontSize: 10 },
  mapsBtn: {
    marginLeft: 'auto', flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8,
    borderWidth: 1, borderColor: C.border,
  },
  mapsBtnText: { color: C.text3, fontSize: 9, fontFamily: mono },
});
