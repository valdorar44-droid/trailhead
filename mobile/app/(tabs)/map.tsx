import { useEffect, useRef, useState, useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, Linking, Animated, TextInput, ActivityIndicator, Modal, Image, Share } from 'react-native';
import { WebView } from 'react-native-webview';
import * as Location from 'expo-location';
import * as Speech from 'expo-speech';
import { Ionicons } from '@expo/vector-icons';
import { useStore } from '@/lib/store';
import { api, Report, Pin, CampsitePin, CampsiteDetail, OsmPoi, WikiArticle, CampsiteInsight, RouteBrief, PackingList } from '@/lib/api';
import { C, mono } from '@/lib/design';

// ─── US State bounding boxes for offline download ─────────────────────────────

const US_STATES: Record<string, { name: string; n: number; s: number; e: number; w: number; emoji: string }> = {
  // West
  AK: { name: 'Alaska',       n: 71.4, s: 54.6, e: -130.0, w: -168.0, emoji: '🐻' },
  AZ: { name: 'Arizona',      n: 37.0, s: 31.3, e: -109.0, w: -114.8, emoji: '🏜️' },
  CA: { name: 'California',   n: 42.0, s: 32.5, e: -114.1, w: -124.4, emoji: '🌴' },
  CO: { name: 'Colorado',     n: 41.0, s: 37.0, e: -102.0, w: -109.1, emoji: '🏔️' },
  HI: { name: 'Hawaii',       n: 22.2, s: 18.9, e: -154.8, w: -160.2, emoji: '🌺' },
  ID: { name: 'Idaho',        n: 49.0, s: 42.0, e: -111.0, w: -117.2, emoji: '🏔️' },
  MT: { name: 'Montana',      n: 49.0, s: 44.4, e: -104.0, w: -116.0, emoji: '🦬' },
  NM: { name: 'New Mexico',   n: 37.0, s: 31.3, e: -103.0, w: -109.1, emoji: '🌵' },
  NV: { name: 'Nevada',       n: 42.0, s: 35.0, e: -114.0, w: -120.0, emoji: '🎰' },
  OR: { name: 'Oregon',       n: 46.3, s: 41.9, e: -116.5, w: -124.6, emoji: '🌲' },
  UT: { name: 'Utah',         n: 42.0, s: 36.9, e: -109.0, w: -114.1, emoji: '🏜️' },
  WA: { name: 'Washington',   n: 49.0, s: 45.5, e: -116.9, w: -124.7, emoji: '☁️' },
  WY: { name: 'Wyoming',      n: 45.0, s: 41.0, e: -104.1, w: -111.1, emoji: '🦅' },
  // Central / South
  KS: { name: 'Kansas',       n: 40.0, s: 36.9, e: -94.6,  w: -102.1, emoji: '🌾' },
  MN: { name: 'Minnesota',    n: 49.4, s: 43.5, e: -89.5,  w: -97.2,  emoji: '🦅' },
  MO: { name: 'Missouri',     n: 40.6, s: 35.9, e: -89.1,  w: -95.8,  emoji: '🌉' },
  ND: { name: 'North Dakota', n: 49.0, s: 45.9, e: -96.6,  w: -104.1, emoji: '🌾' },
  NE: { name: 'Nebraska',     n: 43.0, s: 40.0, e: -95.3,  w: -104.1, emoji: '🌽' },
  OK: { name: 'Oklahoma',     n: 37.0, s: 33.6, e: -94.4,  w: -103.0, emoji: '🤠' },
  SD: { name: 'South Dakota', n: 45.9, s: 42.5, e: -96.4,  w: -104.1, emoji: '🦬' },
  TX: { name: 'Texas',        n: 36.5, s: 25.8, e: -93.5,  w: -106.6, emoji: '🤠' },
  // Southeast
  AL: { name: 'Alabama',      n: 35.0, s: 30.2, e: -84.9,  w: -88.5,  emoji: '🌿' },
  AR: { name: 'Arkansas',     n: 36.5, s: 33.0, e: -89.6,  w: -94.6,  emoji: '🏞️' },
  FL: { name: 'Florida',      n: 31.0, s: 24.5, e: -80.0,  w: -87.6,  emoji: '🌊' },
  GA: { name: 'Georgia',      n: 35.0, s: 30.4, e: -80.8,  w: -85.6,  emoji: '🍑' },
  KY: { name: 'Kentucky',     n: 39.1, s: 36.5, e: -81.9,  w: -89.6,  emoji: '🐎' },
  LA: { name: 'Louisiana',    n: 33.0, s: 28.9, e: -88.8,  w: -94.0,  emoji: '🎷' },
  MS: { name: 'Mississippi',  n: 35.0, s: 30.2, e: -88.1,  w: -91.7,  emoji: '🌊' },
  NC: { name: 'North Carolina',n:36.6, s: 33.8, e: -75.5,  w: -84.3,  emoji: '🏔️' },
  SC: { name: 'South Carolina',n:35.2, s: 32.0, e: -78.5,  w: -83.4,  emoji: '🌴' },
  TN: { name: 'Tennessee',    n: 36.7, s: 35.0, e: -81.6,  w: -90.3,  emoji: '🎵' },
  VA: { name: 'Virginia',     n: 39.5, s: 36.5, e: -75.2,  w: -83.7,  emoji: '🏛️' },
  WV: { name: 'West Virginia',n: 40.6, s: 37.2, e: -77.7,  w: -82.6,  emoji: '⛏️' },
  // Northeast
  CT: { name: 'Connecticut',  n: 42.1, s: 41.0, e: -71.8,  w: -73.7,  emoji: '🍂' },
  DE: { name: 'Delaware',     n: 39.8, s: 38.4, e: -75.0,  w: -75.8,  emoji: '🏖️' },
  MA: { name: 'Massachusetts',n: 42.9, s: 41.2, e: -69.9,  w: -73.5,  emoji: '🦞' },
  MD: { name: 'Maryland',     n: 39.7, s: 37.9, e: -75.0,  w: -79.5,  emoji: '🦀' },
  ME: { name: 'Maine',        n: 47.5, s: 43.1, e: -66.9,  w: -71.1,  emoji: '🦌' },
  NH: { name: 'New Hampshire',n: 45.3, s: 42.7, e: -70.6,  w: -72.6,  emoji: '🍁' },
  NJ: { name: 'New Jersey',   n: 41.4, s: 38.9, e: -73.9,  w: -75.6,  emoji: '🏙️' },
  NY: { name: 'New York',     n: 45.0, s: 40.5, e: -71.8,  w: -79.8,  emoji: '🗽' },
  PA: { name: 'Pennsylvania', n: 42.3, s: 39.7, e: -74.7,  w: -80.5,  emoji: '🔔' },
  RI: { name: 'Rhode Island', n: 42.0, s: 41.1, e: -71.1,  w: -71.9,  emoji: '⚓' },
  VT: { name: 'Vermont',      n: 45.0, s: 42.7, e: -71.5,  w: -73.4,  emoji: '🍁' },
  // Midwest
  IA: { name: 'Iowa',         n: 43.5, s: 40.4, e: -90.1,  w: -96.6,  emoji: '🌽' },
  IL: { name: 'Illinois',     n: 42.5, s: 36.9, e: -87.0,  w: -91.5,  emoji: '🏙️' },
  IN: { name: 'Indiana',      n: 41.8, s: 37.8, e: -84.8,  w: -88.1,  emoji: '🏎️' },
  MI: { name: 'Michigan',     n: 48.3, s: 41.7, e: -82.4,  w: -90.4,  emoji: '🚗' },
  OH: { name: 'Ohio',         n: 42.0, s: 38.4, e: -80.5,  w: -84.8,  emoji: '🌻' },
  WI: { name: 'Wisconsin',    n: 47.1, s: 42.5, e: -86.2,  w: -92.9,  emoji: '🧀' },
};

type RouteOpts = { avoidTolls: boolean; avoidHighways: boolean; backRoads: boolean; noFerries: boolean };

interface SearchPlace { lat: number; lng: number; name: string; dist?: number | null; };

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

function nearestWpIdx(loc: { lat: number; lng: number }, wps: WP[]): number {
  let minD = Infinity, nearest = 0;
  wps.forEach((wp, i) => {
    const d = haversineKm(loc.lat, loc.lng, wp.lat, wp.lng);
    if (d < minD) { minD = d; nearest = i; }
  });
  return nearest;
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

const MAPBOX_STYLES: Record<string, string> = {
  satellite: 'mapbox://styles/mapbox/satellite-streets-v12',
  topo:      'mapbox://styles/mapbox/outdoors-v12',
  hybrid:    'mapbox://styles/mapbox/satellite-streets-v12',
};

const buildMapHtml = (
  centerLat: number, centerLng: number,
  waypoints: WP[],
  campsites: { lat: number; lng: number; name: string }[],
  gasList:   { lat: number; lng: number; name: string }[],
  pins:      { lat: number; lng: number; name: string; type: string }[],
) => /* html */`<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width,initial-scale=1.0,maximum-scale=1.0,user-scalable=no">
<script src='https://api.mapbox.com/mapbox-gl-js/v3.3.0/mapbox-gl.js'></script>
<link href='https://api.mapbox.com/mapbox-gl-js/v3.3.0/mapbox-gl.css' rel='stylesheet'/>
<style>
  body,html{margin:0;padding:0;height:100%;background:#080c12;overflow:hidden;}
  #map{height:100vh;width:100vw;}
  .mapboxgl-popup-content{background:#0f1319!important;border:1px solid #252d3d!important;color:#f1f5f9!important;border-radius:10px!important;padding:12px 14px!important;box-shadow:0 4px 20px rgba(0,0,0,0.7)!important;min-width:160px;}
  .mapboxgl-popup-tip{border-top-color:#252d3d!important;border-bottom-color:#252d3d!important;}
  .mapboxgl-popup-close-button{color:#6b7280!important;font-size:16px!important;right:4px!important;top:2px!important;}
  .mapboxgl-ctrl-logo,.mapboxgl-ctrl-attrib{display:none!important;}
  .mk-wp{background:#f97316;border:2.5px solid #fff;border-radius:50%;width:30px;height:30px;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:800;font-size:12px;font-family:monospace;box-shadow:0 2px 10px rgba(249,115,22,0.6);cursor:pointer;user-select:none;}
  .mk-wp.nav-target{background:#fff;color:#f97316;animation:pulse 1.4s ease-in-out infinite;}
  @keyframes pulse{0%,100%{box-shadow:0 0 0 4px rgba(249,115,22,0.45);}50%{box-shadow:0 0 0 12px rgba(249,115,22,0.1);}}
  .mk-me{background:#f97316;border:3px solid #fff;border-radius:50%;width:16px;height:16px;box-shadow:0 0 0 4px rgba(249,115,22,0.3);}
  .mk-search{background:rgba(59,130,246,0.2);border:2.5px solid #3b82f6;border-radius:50%;width:32px;height:32px;display:flex;align-items:center;justify-content:center;font-size:17px;}
  #search-area-btn{position:fixed;bottom:118px;left:50%;transform:translateX(-50%);background:#0f1319;border:1.5px solid #f97316;color:#f97316;font-family:monospace;font-size:11px;font-weight:700;letter-spacing:0.08em;padding:10px 22px;border-radius:20px;cursor:pointer;box-shadow:0 4px 24px rgba(0,0,0,0.65);white-space:nowrap;z-index:100;display:none;}
  #search-area-btn.show{display:block;}
  #loading{position:fixed;top:0;left:0;right:0;bottom:0;background:#080c12;display:flex;align-items:center;justify-content:center;z-index:200;flex-direction:column;gap:12px;}
  #loading.hidden{display:none;}
  .ld{width:8px;height:8px;background:#f97316;border-radius:50%;animation:ld 1.2s infinite;}
  .ld:nth-child(2){animation-delay:.2s}.ld:nth-child(3){animation-delay:.4s}
  @keyframes ld{0%,80%,100%{transform:scale(.3);opacity:.3}40%{transform:scale(1);opacity:1}}
  .pt{font-weight:700;font-size:13px;margin-bottom:4px;}
  .pm{color:#6b7280;font-size:11px;font-family:monospace;}
</style>
</head>
<body>
<div id="map"></div>
<div id="loading"><div style="display:flex;gap:6px"><div class="ld"></div><div class="ld"></div><div class="ld"></div></div><div style="color:#4b5563;font-family:monospace;font-size:10px;letter-spacing:.1em;margin-top:4px">LOADING MAP</div></div>
<button id="search-area-btn" onclick="searchThisArea()">⛺ SEARCH THIS AREA</button>
<script>
(function(){
  var wps=${JSON.stringify(waypoints)};
  var initGas=${JSON.stringify(gasList.slice(0,20))};
  var initPins=${JSON.stringify(pins.slice(0,30))};

  var map,mapboxToken='',currentStyle='mapbox://styles/mapbox/satellite-streets-v12';
  var userMarker=null,wpMarkers=[],searchMarker=null;
  var allCamps=[],allGas=[],allPois=[];
  var routeOpts={avoidTolls:false,avoidHighways:false,backRoads:false,noFerries:false};
  var _routeCoords=[],routePts=[],breadcrumbPts=[];
  var lastOffCheck=0,downloadActive=false,mapReady=false,pendingMsgs=[];
  var searchAreaBtn=document.getElementById('search-area-btn');

  function postRN(o){try{window.ReactNativeWebView.postMessage(JSON.stringify(o));}catch(e){}}

  // ── IndexedDB offline tile cache ──────────────────────────────────────────────
  var _idb=null;
  var _idbR=new Promise(function(res){var req=indexedDB.open('trailhead-tiles',1);req.onupgradeneeded=function(e){e.target.result.createObjectStore('tiles',{keyPath:'k'});};req.onsuccess=function(e){_idb=e.target.result;res();};req.onerror=function(){res();};});
  function _gT(k){return _idbR.then(function(){if(!_idb)return null;return new Promise(function(r){var tx=_idb.transaction('tiles','readonly');var rq=tx.objectStore('tiles').get(k);rq.onsuccess=function(){r(rq.result?rq.result.v:null);};rq.onerror=function(){r(null);};});});}
  function _sT(k,v){return _idbR.then(function(){if(!_idb)return;try{_idb.transaction('tiles','readwrite').objectStore('tiles').put({k:k,v:v});}catch(e){}});}
  function _ll2t(lat,lng,z){var x=Math.floor((lng+180)/360*Math.pow(2,z));var s=Math.sin(lat*Math.PI/180);var y=Math.floor((0.5-Math.log((1+s)/(1-s))/(4*Math.PI))*Math.pow(2,z));return{x:Math.max(0,x),y:Math.max(0,y)};}
  async function _fetchDU(url){var r=await fetch(url);if(!r.ok)throw new Error('x');var b=await r.blob();return new Promise(function(res,rej){var rd=new FileReader();rd.onload=function(){res(rd.result);};rd.onerror=rej;rd.readAsDataURL(b);});}
  async function _dlTiles(n,s,e,w,minZ,maxZ){
    var tiles=[],MAX=2000;
    var tileUrl='https://api.mapbox.com/styles/v1/mapbox/satellite-streets-v12/tiles/256/{z}/{x}/{y}?access_token='+mapboxToken;
    for(var z=minZ;z<=maxZ&&tiles.length<MAX;z++){var nw=_ll2t(n,w,z);var se=_ll2t(s,e,z);var cap=Math.pow(2,z)-1;for(var x=Math.max(0,nw.x);x<=Math.min(cap,se.x)&&tiles.length<MAX;x++){for(var y=Math.max(0,nw.y);y<=Math.min(cap,se.y)&&tiles.length<MAX;y++){tiles.push({z:z,x:x,y:y});}}}
    var total=tiles.length,saved=0,BATCH=5;
    postRN({type:'download_progress',percent:0,saved:0,total:total});
    for(var i=0;i<tiles.length;i+=BATCH){
      if(!downloadActive)break;
      var batch=tiles.slice(i,i+BATCH);
      await Promise.allSettled(batch.map(async function(t){
        var url=tileUrl.replace('{z}',t.z).replace('{x}',t.x).replace('{y}',t.y);
        var key='sat_'+t.z+'_'+t.x+'_'+t.y;
        try{var ex=await _gT(key);if(!ex){var d=await _fetchDU(url);await _sT(key,d);}saved++;postRN({type:'download_progress',percent:Math.round(saved/total*100),saved:saved,total:total});}catch(e){saved++;}
      }));
    }
    postRN({type:'download_complete',saved:saved,total:total});
  }

  // ── Map init ──────────────────────────────────────────────────────────────────
  function initMap(token,style){
    mapboxToken=token;mapboxgl.accessToken=token;
    currentStyle=style||'mapbox://styles/mapbox/satellite-streets-v12';
    map=new mapboxgl.Map({container:'map',style:currentStyle,
      center:[${centerLng},${centerLat}],zoom:${waypoints.length > 1 ? 7 : 10},
      attributionControl:false,pitchWithRotate:false});
    map.on('load',function(){
      setupSources();setupLayers();renderWaypoints();loadInitialData();
      if(wps.length>=2)loadRoute();
      document.getElementById('loading').classList.add('hidden');
      mapReady=true;postRN({type:'map_ready'});
      pendingMsgs.forEach(handleMsgData);pendingMsgs=[];
    });
    map.on('style.load',function(){
      setupSources();setupLayers();renderWaypoints();
      updateCampSrc();updateGasSrc();updatePoiSrc();updateRoute();updateBreadcrumb();
    });
    var boundsTimer;
    map.on('moveend',function(){
      searchAreaBtn.classList.add('show');
      clearTimeout(boundsTimer);
      boundsTimer=setTimeout(function(){var b=map.getBounds();postRN({type:'map_bounds',n:b.getNorth(),s:b.getSouth(),e:b.getEast(),w:b.getWest(),zoom:map.getZoom()});},400);
    });
    map.on('click',function(e){if(!e.defaultPrevented)postRN({type:'map_tapped'});});
  }

  function searchThisArea(){
    searchAreaBtn.classList.remove('show');
    var b=map.getBounds();
    postRN({type:'search_area',n:b.getNorth(),s:b.getSouth(),e:b.getEast(),w:b.getWest(),zoom:map.getZoom()});
  }

  // ── GeoJSON helpers ───────────────────────────────────────────────────────────
  function campFeat(c){return{type:'Feature',geometry:{type:'Point',coordinates:[c.lng,c.lat]},properties:{id:c.id||'',name:c.name||'',land_type:c.land_type||'Campground',cost:c.cost||'',ada:c.ada?1:0,reservable:c.reservable?1:0,raw:JSON.stringify(c)}};}

  function setupSources(){
    if(!map.getSource('camps'))map.addSource('camps',{type:'geojson',data:{type:'FeatureCollection',features:[]},cluster:true,clusterMaxZoom:11,clusterRadius:45});
    if(!map.getSource('gas'))map.addSource('gas',{type:'geojson',data:{type:'FeatureCollection',features:[]}});
    if(!map.getSource('pois'))map.addSource('pois',{type:'geojson',data:{type:'FeatureCollection',features:[]}});
    if(!map.getSource('route'))map.addSource('route',{type:'geojson',data:{type:'Feature',geometry:{type:'LineString',coordinates:[]}}});
    if(!map.getSource('breadcrumb'))map.addSource('breadcrumb',{type:'geojson',data:{type:'Feature',geometry:{type:'LineString',coordinates:[]}}});
  }

  function setupLayers(){
    var _a=function(id,def){if(!map.getLayer(id))map.addLayer(def);};
    _a('breadcrumb',{id:'breadcrumb',type:'line',source:'breadcrumb',paint:{'line-color':'#3b82f6','line-width':2.5,'line-opacity':0.8,'line-dasharray':[2,4]}});
    _a('route-shadow',{id:'route-shadow',type:'line',source:'route',layout:{'line-cap':'round','line-join':'round'},paint:{'line-color':'rgba(0,0,0,0.35)','line-width':9,'line-blur':5,'line-translate':[0,2]}});
    _a('route-line',{id:'route-line',type:'line',source:'route',layout:{'line-cap':'round','line-join':'round'},paint:{'line-color':'#f97316','line-width':5,'line-opacity':0.94}});
    _a('gas-circle',{id:'gas-circle',type:'circle',source:'gas',paint:{'circle-radius':9,'circle-color':'#eab308','circle-opacity':0.92,'circle-stroke-width':2,'circle-stroke-color':'#fff'}});
    _a('gas-label',{id:'gas-label',type:'symbol',source:'gas',filter:['>=',['zoom'],13],layout:{'text-field':['get','name'],'text-size':9,'text-offset':[0,1.5],'text-anchor':'top'},paint:{'text-color':'#f1f5f9','text-halo-color':'rgba(0,0,0,0.85)','text-halo-width':1.5}});
    _a('poi-circle',{id:'poi-circle',type:'circle',source:'pois',paint:{'circle-radius':8,'circle-color':['match',['get','type'],'water','#3b82f6','trailhead','#22c55e','viewpoint','#a855f7','peak','#8b5cf6','#6b7280'],'circle-opacity':0.9,'circle-stroke-width':1.5,'circle-stroke-color':'#fff'}});
    _a('poi-label',{id:'poi-label',type:'symbol',source:'pois',filter:['>=',['zoom'],13],layout:{'text-field':['get','name'],'text-size':9,'text-offset':[0,1.3],'text-anchor':'top'},paint:{'text-color':'#f1f5f9','text-halo-color':'rgba(0,0,0,0.85)','text-halo-width':1.5}});
    _a('camp-cluster',{id:'camp-cluster',type:'circle',source:'camps',filter:['has','point_count'],paint:{'circle-color':['step',['get','point_count'],'#14b8a6',10,'#f97316',50,'#ef4444'],'circle-radius':['step',['get','point_count'],18,10,25,50,32],'circle-opacity':0.88,'circle-stroke-width':2,'circle-stroke-color':'#fff'}});
    _a('camp-count',{id:'camp-count',type:'symbol',source:'camps',filter:['has','point_count'],layout:{'text-field':'{point_count_abbreviated}','text-size':12,'text-font':['DIN Offc Pro Medium','Arial Unicode MS Bold']},paint:{'text-color':'#fff'}});
    _a('camp-circle',{id:'camp-circle',type:'circle',source:'camps',filter:['!',['has','point_count']],paint:{'circle-radius':['interpolate',['linear'],['zoom'],9,7,13,11],'circle-color':['match',['get','land_type'],'BLM Land','#f97316','National Forest','#22c55e','National Park','#3b82f6','State Park','#8b5cf6','Campground','#14b8a6','#14b8a6'],'circle-opacity':0.88,'circle-stroke-width':2,'circle-stroke-color':'rgba(255,255,255,0.9)'}});
    _a('camp-label',{id:'camp-label',type:'symbol',source:'camps',filter:['all',['!',['has','point_count']],['>=',['zoom'],12]],layout:{'text-field':['get','name'],'text-size':10,'text-offset':[0,1.3],'text-anchor':'top','text-max-width':10},paint:{'text-color':'#f1f5f9','text-halo-color':'rgba(0,0,0,0.85)','text-halo-width':1.5}});
    // clicks
    map.on('click','camp-cluster',function(e){var f=map.queryRenderedFeatures(e.point,{layers:['camp-cluster']});if(!f.length)return;map.getSource('camps').getClusterExpansionZoom(f[0].properties.cluster_id,function(err,zoom){if(err)return;map.easeTo({center:f[0].geometry.coordinates,zoom:zoom+0.5});});e.preventDefault();});
    map.on('click','camp-circle',function(e){if(!e.features||!e.features[0])return;var p=e.features[0].properties;var raw;try{raw=JSON.parse(p.raw||'{}');}catch(x){raw=p;}postRN({type:'campsite_tapped',id:raw.id||p.id,name:raw.name||p.name,camp:raw});e.preventDefault();});
    map.on('click','gas-circle',function(e){if(!e.features||!e.features[0])return;var p=e.features[0].properties;new mapboxgl.Popup({closeButton:false,offset:12}).setLngLat(e.lngLat).setHTML('<div class="pt">⛽ '+p.name+'</div><div class="pm">Fuel Station</div>').addTo(map);e.preventDefault();});
    map.on('click','poi-circle',function(e){if(!e.features||!e.features[0])return;var p=e.features[0].properties;var ic=p.type==='water'?'💧':p.type==='trailhead'?'🥾':'👁️';new mapboxgl.Popup({closeButton:false,offset:12}).setLngLat(e.lngLat).setHTML('<div class="pt">'+ic+' '+p.name+'</div><div class="pm">'+p.type+'</div>').addTo(map);e.preventDefault();});
    ['camp-cluster','camp-circle','gas-circle','poi-circle'].forEach(function(l){map.on('mouseenter',l,function(){map.getCanvas().style.cursor='pointer';});map.on('mouseleave',l,function(){map.getCanvas().style.cursor='';});});
  }

  function renderWaypoints(){
    wpMarkers.forEach(function(m){m.remove();});wpMarkers=[];
    wps.forEach(function(w,i){
      var el=document.createElement('div');el.className='mk-wp';el.textContent=w.day||i+1;
      var popup=new mapboxgl.Popup({offset:18,closeButton:false}).setHTML('<div class="pt">'+w.name+'</div><div class="pm">Day '+w.day+' · '+w.type+'</div>');
      var m=new mapboxgl.Marker({element:el}).setLngLat([w.lng,w.lat]).setPopup(popup).addTo(map);
      el.addEventListener('click',function(ev){ev.stopPropagation();postRN({type:'wp_tapped',idx:i,name:w.name});});
      wpMarkers.push(m);
    });
    if(wps.length>=2){var bounds=new mapboxgl.LngLatBounds();wps.forEach(function(w){bounds.extend([w.lng,w.lat]);});map.fitBounds(bounds,{padding:60,maxZoom:12,duration:800});}
  }

  function loadInitialData(){
    if(initGas.length){allGas=initGas;updateGasSrc();}
    if(initPins.length){allPois=initPins.map(function(p){return{name:p.name,lat:p.lat,lng:p.lng,type:p.type||'pin'};});updatePoiSrc();}
  }

  function updateCampSrc(){if(!map||!map.getSource('camps'))return;map.getSource('camps').setData({type:'FeatureCollection',features:allCamps.map(campFeat)});}
  function updateGasSrc(){if(!map||!map.getSource('gas'))return;map.getSource('gas').setData({type:'FeatureCollection',features:allGas.map(function(g){return{type:'Feature',geometry:{type:'Point',coordinates:[g.lng,g.lat]},properties:{name:g.name}};})});}
  function updatePoiSrc(){if(!map||!map.getSource('pois'))return;map.getSource('pois').setData({type:'FeatureCollection',features:allPois.map(function(p){return{type:'Feature',geometry:{type:'Point',coordinates:[p.lng,p.lat]},properties:{name:p.name,type:p.type||'pin'}};})});}
  function updateRoute(){if(!map||!map.getSource('route'))return;map.getSource('route').setData({type:'Feature',geometry:{type:'LineString',coordinates:_routeCoords}});}
  function updateBreadcrumb(){if(!map||!map.getSource('breadcrumb'))return;map.getSource('breadcrumb').setData({type:'Feature',geometry:{type:'LineString',coordinates:breadcrumbPts}});}

  // ── User position ──────────────────────────────────────────────────────────────
  function setUserPos(lat,lng,recenter,zoom){
    if(!userMarker){var el=document.createElement('div');el.className='mk-me';userMarker=new mapboxgl.Marker({element:el}).setLngLat([lng,lat]).addTo(map);}
    else{userMarker.setLngLat([lng,lat]);}
    if(recenter)map.easeTo({center:[lng,lat],zoom:zoom||15,duration:400});
    var now=Date.now();
    if(routePts.length>0&&now-lastOffCheck>6000){
      lastOffCheck=now;var minD=Infinity;
      for(var i=0;i<routePts.length;i++){var dlat=(routePts[i][1]-lat)*111000;var dlng=(routePts[i][0]-lng)*111000*Math.cos(lat*Math.PI/180);var d=Math.sqrt(dlat*dlat+dlng*dlng);if(d<minD)minD=d;if(minD<80)break;}
      if(minD>380)postRN({type:'off_route',lat:lat,lng:lng,dist:Math.round(minD)});
    }
  }

  function setNavTarget(idx){wpMarkers.forEach(function(m,i){m.getElement().classList.toggle('nav-target',i===idx);});}

  // ── Routing ───────────────────────────────────────────────────────────────────
  function decodeP6(enc){var coords=[],i=0,lat=0,lng=0;while(i<enc.length){var b,shift=0,res=0;do{b=enc.charCodeAt(i++)-63;res|=(b&0x1f)<<shift;shift+=5;}while(b>=0x20);lat+=res&1?~(res>>1):(res>>1);shift=0;res=0;do{b=enc.charCodeAt(i++)-63;res|=(b&0x1f)<<shift;shift+=5;}while(b>=0x20);lng+=res&1?~(res>>1):(res>>1);coords.push([lng/1e6,lat/1e6]);}return coords;}

  function _fallback(pairs,fromIdx){var coords=pairs.map(function(p){var s=p.split(',');return[parseFloat(s[0]),parseFloat(s[1])];});_routeCoords=coords;routePts=coords;updateRoute();postRN({type:'route_ready',routed:false,steps:[],legs:[],fromIdx:fromIdx||0});}

  async function _fetchRoute(pairs,fromIdx){
    if(routeOpts.backRoads)return _fetchValhalla(pairs,fromIdx);
    var excl=[];if(routeOpts.avoidTolls)excl.push('toll');if(routeOpts.avoidHighways)excl.push('motorway');if(routeOpts.noFerries)excl.push('ferry');
    var profile=(routeOpts.avoidHighways)?'driving':'driving-traffic';
    var url='https://api.mapbox.com/directions/v5/mapbox/'+profile+'/'+pairs.join(';')+'?access_token='+mapboxToken+'&steps=true&geometries=geojson&overview=full'+(excl.length?'&exclude='+excl.join(','):'');
    try{
      var ctrl=new AbortController();var tid=setTimeout(function(){ctrl.abort();},10000);
      var data=await(await fetch(url,{signal:ctrl.signal})).json();clearTimeout(tid);
      if(!data.routes||!data.routes[0])return _fetchValhalla(pairs,fromIdx);
      var route=data.routes[0];
      _routeCoords=route.geometry.coordinates;routePts=_routeCoords.filter(function(_,i){return i%4===0;});updateRoute();
      var steps=[],legs=[];
      (route.legs||[]).forEach(function(leg){var ls=[];(leg.steps||[]).forEach(function(s){if(s.distance>0||s.maneuver.type==='arrive'){var st={type:s.maneuver.type,modifier:s.maneuver.modifier||'',name:s.name||'',distance:s.distance,duration:s.duration};steps.push(st);ls.push(st);}});legs.push(ls);});
      postRN({type:'route_ready',routed:true,steps:steps,legs:legs,total_distance:route.distance,total_duration:route.duration,fromIdx:fromIdx||0});
    }catch(e){_fallback(pairs,fromIdx);}
  }

  async function _fetchValhalla(pairs,fromIdx){
    var locs=pairs.map(function(p){var s=p.split(',');return{lon:parseFloat(s[0]),lat:parseFloat(s[1])};});
    var body={locations:locs,costing:'auto',costing_options:{auto:{use_tracks:0.9,use_highways:0.0,use_tolls:routeOpts.avoidTolls?0.0:0.5}},units:'miles'};
    try{
      var ctrl=new AbortController();var tid=setTimeout(function(){ctrl.abort();},12000);
      var data=await(await fetch('https://valhalla1.openstreetmap.de/route',{method:'POST',signal:ctrl.signal,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})).json();clearTimeout(tid);
      if(!data.trip||data.trip.status!==0)return _fallback(pairs,fromIdx);
      var all=[],steps=[],legs=[];
      (data.trip.legs||[]).forEach(function(leg){var c=decodeP6(leg.shape||'');all=all.concat(c);var ls=[];(leg.maneuvers||[]).forEach(function(m){var dist=Math.round((m.length||0)*1609.34);var st={type:m.type===4?'arrive':m.type===1?'depart':'turn',modifier:{0:'',1:'',2:'left',3:'right',4:'arrive',5:'sharp left',6:'sharp right',7:'left',8:'right',9:'uturn',10:'slight left',11:'slight right'}[m.type]||'',name:m.street_names&&m.street_names[0]||'',distance:dist,duration:m.time||0};steps.push(st);ls.push(st);});legs.push(ls);});
      _routeCoords=all;routePts=all.filter(function(_,i){return i%4===0;});updateRoute();
      postRN({type:'route_ready',routed:true,steps:steps,legs:legs,total_distance:Math.round((data.trip.summary.length||0)*1609.34),total_duration:data.trip.summary.time||0,fromIdx:fromIdx||0});
    }catch(e){_fallback(pairs,fromIdx);}
  }

  async function loadRoute(){if(wps.length<2)return;await _fetchRoute(wps.map(function(w){return w.lng+','+w.lat;}),0);}
  async function loadRouteFrom(lat,lng,fromIdx){var rem=wps.slice(fromIdx);if(!rem.length){_fallback([],fromIdx);return;}await _fetchRoute([lng+','+lat].concat(rem.map(function(w){return w.lng+','+w.lat;})),fromIdx);}

  // ── Message handler ───────────────────────────────────────────────────────────
  function handleMsgData(msg){
    if(msg.type==='set_token'){initMap(msg.token,msg.style);return;}
    if(!mapReady){pendingMsgs.push(msg);return;}
    if(msg.type==='user_pos'&&msg.lat)setUserPos(msg.lat,msg.lng,false);
    if(msg.type==='nav_center'&&msg.lat)setUserPos(msg.lat,msg.lng,true,15);
    if(msg.type==='locate'&&msg.lat)setUserPos(msg.lat,msg.lng,true,13);
    if(msg.type==='nav_target')setNavTarget(msg.idx);
    if(msg.type==='nav_reset'){setNavTarget(-1);_routeCoords=[];routePts=[];updateRoute();}
    if(msg.type==='fly_to'&&msg.lat){
      map.flyTo({center:[msg.lng,msg.lat],zoom:14,duration:600});
      if(searchMarker){searchMarker.remove();searchMarker=null;}
      var el=document.createElement('div');el.className='mk-search';el.textContent='📍';
      searchMarker=new mapboxgl.Marker({element:el}).setLngLat([msg.lng,msg.lat]).setPopup(new mapboxgl.Popup({offset:18,closeButton:false}).setHTML('<div class="pt">'+(msg.name||'Location')+'</div>')).addTo(map);
      searchMarker.togglePopup();
    }
    if(msg.type==='track_point'&&msg.lat){breadcrumbPts.push([msg.lng,msg.lat]);updateBreadcrumb();}
    if(msg.type==='clear_track'){breadcrumbPts=[];updateBreadcrumb();}
    if(msg.type==='set_camps'){allCamps=msg.pins||[];updateCampSrc();searchAreaBtn.classList.remove('show');}
    if(msg.type==='set_discover_pins'){allCamps=msg.pins||[];updateCampSrc();}
    if(msg.type==='clear_discover_pins'){allCamps=[];updateCampSrc();}
    if(msg.type==='set_nearby_camps'){allCamps=msg.pins||[];updateCampSrc();}
    if(msg.type==='clear_nearby_camps'){allCamps=[];updateCampSrc();}
    if(msg.type==='set_gas'){allGas=msg.gas||[];updateGasSrc();}
    if(msg.type==='set_pois'){allPois=msg.pois||[];updatePoiSrc();}
    if(msg.type==='clear_pois'){allPois=[];updatePoiSrc();}
    if(msg.type==='set_route_opts')Object.assign(routeOpts,msg.opts||{});
    if(msg.type==='start_route_from'&&msg.lat)loadRouteFrom(msg.lat,msg.lng,msg.fromIdx||0);
    if(msg.type==='reroute_from'&&msg.lat){_routeCoords=[];routePts=[];loadRouteFrom(msg.lat,msg.lng,msg.fromIdx||0);}
    if(msg.type==='route_to_search'&&msg.lat){
      if(searchMarker){searchMarker.remove();searchMarker=null;}
      var el2=document.createElement('div');el2.className='mk-search';el2.textContent='📍';
      searchMarker=new mapboxgl.Marker({element:el2}).setLngLat([msg.lng,msg.lat]).setPopup(new mapboxgl.Popup({offset:18,closeButton:false}).setHTML('<div class="pt">'+(msg.name||'Destination')+'</div>')).addTo(map);
      searchMarker.togglePopup();
      _fetchRoute([msg.userLng+','+msg.userLat,msg.lng+','+msg.lat],0);
    }
    if(msg.type==='set_style'&&msg.style){currentStyle=msg.style;map.setStyle(msg.style);}
    if(msg.type==='download_tiles_bbox'){if(!downloadActive){downloadActive=true;_dlTiles(msg.n,msg.s,msg.e,msg.w,msg.minZ||10,msg.maxZ||12);}}
    if(msg.type==='download_tiles'){if(!downloadActive){downloadActive=true;var b=map.getBounds();_dlTiles(b.getNorth(),b.getSouth(),b.getEast(),b.getWest(),msg.minZ||10,msg.maxZ||15);}}
    if(msg.type==='cancel_download')downloadActive=false;
  }

  function onMsg(e){try{handleMsgData(JSON.parse(e.data||'{}'));}catch(err){}}
  document.addEventListener('message',onMsg);
  window.addEventListener('message',onMsg);
})();
</script>
</body></html>`;

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function MapScreen() {
  const activeTrip = useStore(s => s.activeTrip);
  const user = useStore(s => s.user);
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
  const [routeLegOffset, setRouteLegOffset] = useState(0);
  const [isApproaching,  setIsApproaching]  = useState(false);
  const [isRerouting,    setIsRerouting]    = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [downloadTotal, setDownloadTotal] = useState(0);
  const [offlineSaved, setOfflineSaved] = useState(false);
  const [mapboxToken,   setMapboxToken]   = useState('');
  const [showFilters,   setShowFilters]   = useState(false);
  const [activeFilters, setActiveFilters] = useState<string[]>([]);
  const [discoverPins,  setDiscoverPins]  = useState<CampsitePin[]>([]);
  const [selectedCamp,  setSelectedCamp]  = useState<CampsitePin | null>(null);
  const [campDetail,    setCampDetail]    = useState<CampsiteDetail | null>(null);
  const [showCampDetail,setShowCampDetail] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [isSearchingCamps, setIsSearchingCamps] = useState(false);

  // Nearby mode (Dyrt-style)
  const [nearbyMode,    setNearbyMode]    = useState(false);
  const [nearbyPins,    setNearbyPins]    = useState<CampsitePin[]>([]);
  const [loadingNearby, setLoadingNearby] = useState(false);
  const nearbyRef = useRef<CampsitePin[]>([]);

  // POI layer
  const [showPois, setShowPois] = useState(false);
  const [pois,     setPois]     = useState<OsmPoi[]>([]);

  // Route options
  const [routeOpts,      setRouteOpts]      = useState<RouteOpts>({ avoidTolls: false, avoidHighways: false, backRoads: false, noFerries: false });
  const [showRouteOpts,  setShowRouteOpts]  = useState(false);
  const [searchRouteCard,setSearchRouteCard]= useState<SearchPlace | null>(null);

  // Offline state modal
  const [showOfflineModal,  setShowOfflineModal]  = useState(false);
  const [offlineWarning,    setOfflineWarning]    = useState(false);

  // AI & Wikipedia in campsite detail
  const [campInsight,    setCampInsight]    = useState<CampsiteInsight | null>(null);
  const [loadingInsight, setLoadingInsight] = useState(false);
  const [wikiArticles,   setWikiArticles]   = useState<WikiArticle[]>([]);
  const [loadingWiki,    setLoadingWiki]    = useState(false);

  // Route brief
  const [routeBrief,    setRouteBrief]    = useState<RouteBrief | null>(null);
  const [showRouteBrief,setShowRouteBrief]= useState(false);
  const [loadingBrief,  setLoadingBrief]  = useState(false);

  // Packing list
  const [packingList,   setPackingList]   = useState<PackingList | null>(null);
  const [showPacking,   setShowPacking]   = useState(false);
  const [loadingPacking,setLoadingPacking]= useState(false);

  const [navDest, setNavDest] = useState<WP | null>(null);

  const navAnim      = useRef(new Animated.Value(0)).current;
  const navRef       = useRef({ active: false, idx: 0, wps: [] as WP[] });
  const navDestRef   = useRef<WP | null>(null);
  const guideRef     = useRef<Record<string, string>>({});
  const spokenRef    = useRef(new Set<string>());
  const discoverRef  = useRef<CampsitePin[]>([]);

  const webLoadedRef = useRef(false);
  const viewportRef  = useRef<{ n: number; s: number; e: number; w: number; zoom: number } | null>(null);
  const [isLoadingAreaCamps, setIsLoadingAreaCamps] = useState(false);

  // Fetch Mapbox token once on mount; send set_token to WebView when both are ready
  useEffect(() => {
    api.getConfig().then(c => {
      const token = c.mapbox_token || '';
      setMapboxToken(token);
      if (token && webLoadedRef.current) {
        webRef.current?.postMessage(JSON.stringify({
          type: 'set_token', token,
          style: MAPBOX_STYLES[mapLayer] ?? MAPBOX_STYLES.satellite,
        }));
      }
    }).catch(() => {});
  }, []);

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

          if (!active) return;

          // Single-destination nav (from search) — no trip waypoints
          const singleDest = navDestRef.current;
          if (!wps[idx] && singleDest) {
            const dist = haversineKm(pos.lat, pos.lng, singleDest.lat, singleDest.lng);
            setIsApproaching(dist < 0.8);
            if (dist < 0.25) {
              Speech.speak(`You have arrived at ${singleDest.name}.`, { rate: 0.9 });
              setTimeout(() => setNavMode(false), 3000);
            }
            return;
          }
          if (!wps[idx]) return;

          const dist = haversineKm(pos.lat, pos.lng, wps[idx].lat, wps[idx].lng);

          // Approaching indicator (within 800m)
          setIsApproaching(dist < 0.8);

          // Speak audio guide narration when close
          const narration = guideRef.current[wps[idx].name];
          if (dist < 0.5 && narration && !spokenRef.current.has(wps[idx].name)) {
            spokenRef.current.add(wps[idx].name);
            Speech.speak(narration, { rate: 0.88, language: 'en-US' });
          }

          // Arrival at final destination
          if (dist < 0.25 && idx === wps.length - 1) {
            Speech.speak(`You have arrived at ${wps[idx].name}. Journey complete.`, { rate: 0.9 });
            setTimeout(() => setNavMode(false), 3000);
            return;
          }

          // Auto-advance to next waypoint + reroute from current position
          if (dist < 0.25 && idx < wps.length - 1) {
            const next = idx + 1;
            setNavIdx(next);
            navRef.current.idx = next;
            setIsApproaching(false);
            webRef.current?.postMessage(JSON.stringify({ type: 'nav_target', idx: next }));
            webRef.current?.postMessage(JSON.stringify({
              type: 'start_route_from',
              lat: pos.lat, lng: pos.lng, fromIdx: next,
            }));
            setRouteLegOffset(next);
            Speech.speak(`Arrived at ${wps[idx].name}. Now heading to ${wps[next].name}.`, { rate: 0.9 });
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

  // ── Reload camps in current viewport whenever filters change ──────────────
  useEffect(() => {
    if (!viewportRef.current) return;
    loadCampsInArea(viewportRef.current, activeFilters);
  }, [activeFilters]);

  // Auto-load camps when userLoc first becomes available + map is ready
  const autoLoadedRef = useRef(false);
  useEffect(() => {
    if (!userLoc || autoLoadedRef.current) return;
    autoLoadedRef.current = true;
    const deg = 0.5;
    const bounds = { n: userLoc.lat + deg, s: userLoc.lat - deg, e: userLoc.lng + deg, w: userLoc.lng - deg, zoom: 10 };
    viewportRef.current = bounds;
    loadCampsInArea(bounds, activeFilters);
  }, [userLoc]);

  // POI layer
  useEffect(() => {
    if (!showPois) {
      webRef.current?.postMessage(JSON.stringify({ type: 'clear_pois' }));
      return;
    }
    const center = userLoc ?? (waypoints[0] ? { lat: waypoints[0].lat, lng: waypoints[0].lng } : null);
    if (!center) return;
    api.getOsmPois(center.lat, center.lng, 25)
      .then(p => {
        setPois(p);
        webRef.current?.postMessage(JSON.stringify({ type: 'set_pois', pois: p }));
      })
      .catch(() => {});
  }, [showPois]);

  // Sync route options to WebView
  useEffect(() => {
    webRef.current?.postMessage(JSON.stringify({ type: 'set_route_opts', opts: {
      avoidTolls: routeOpts.avoidTolls,
      avoidHighways: routeOpts.avoidHighways,
      backRoads: routeOpts.backRoads,
      preferDirt: routeOpts.backRoads,
      noFerries: routeOpts.noFerries,
    }}));
  }, [routeOpts]);

  // Offline warning during nav if area hasn't been cached
  useEffect(() => {
    if (!navMode) { setOfflineWarning(false); return; }
    const timer = setTimeout(() => setOfflineWarning(!offlineSaved), 4000);
    return () => clearTimeout(timer);
  }, [navMode, offlineSaved]);

  // ── Nav mode animate + speak start ─────────────────────────────────────────

  useEffect(() => {
    Animated.spring(navAnim, { toValue: navMode ? 1 : 0, tension: 80, friction: 10, useNativeDriver: true }).start();
    if (navMode) {
      setShowPanel(false);
      setIsApproaching(false);
      setIsRerouting(false);
      const dest = navDestRef.current;
      if (dest && waypoints.length === 0) {
        // Single-destination nav (from search) — route already drawn by route_to_search
        const dist = userLoc ? haversineKm(userLoc.lat, userLoc.lng, dest.lat, dest.lng) : null;
        const distStr = dist && dist > 0.5 ? `, ${formatDist(dist)} away` : '';
        Speech.speak(`Navigation started. Heading to ${dest.name}${distStr}.`, { rate: 0.9 });
      } else {
        // Trip navigation
        const loc = navRef.current.active ? null : userLoc;
        let startIdx = navIdx;
        if (loc && waypoints.length > 0) {
          startIdx = nearestWpIdx(loc, waypoints);
          setNavIdx(startIdx);
          navRef.current.idx = startIdx;
          setRouteLegOffset(startIdx);
        }
        webRef.current?.postMessage(JSON.stringify({ type: 'nav_target', idx: startIdx }));
        if (userLoc) {
          webRef.current?.postMessage(JSON.stringify({
            type: 'start_route_from',
            lat: userLoc.lat, lng: userLoc.lng, fromIdx: startIdx,
          }));
        }
        const target = waypoints[startIdx];
        if (target) {
          const dist = userLoc ? haversineKm(userLoc.lat, userLoc.lng, target.lat, target.lng) : null;
          const distStr = dist && dist > 0.5 ? `, ${formatDist(dist)} away` : '';
          Speech.speak(`Navigation started. Heading to ${target.name}${distStr}.`, { rate: 0.9 });
        }
      }
    } else {
      setIsApproaching(false);
      setIsRerouting(false);
      setRouteLegOffset(0);
      navDestRef.current = null;
      setNavDest(null);
      webRef.current?.postMessage(JSON.stringify({ type: 'nav_reset' }));
      webRef.current?.postMessage(JSON.stringify({ type: 'clear_track' }));
      Speech.stop();
    }
  }, [navMode]);

  // ── Voice turn announcement on leg advance ──────────────────────────────────

  useEffect(() => {
    if (!navMode || routeLegs.length === 0) return;
    const legIdx = navIdx - routeLegOffset;
    if (legIdx < 0 || legIdx >= routeLegs.length) return;
    const legSteps = routeLegs[legIdx];
    if (!legSteps) return;
    const first = legSteps.find(s => s.type !== 'depart' && s.distance > 50);
    if (!first) return;
    const road = first.name ? ` on ${first.name}` : '';
    const t = setTimeout(() => {
      Speech.speak(`In ${formatStepDist(first.distance)}, ${stepLabel(first.type, first.modifier)}${road}`, { rate: 0.9 });
    }, 1500);
    return () => clearTimeout(t);
  }, [navIdx, navMode, routeLegOffset]);

  // ── Nominatim map search ────────────────────────────────────────────────────

  async function searchMap() {
    if (!searchQuery.trim()) return;
    setIsSearching(true);
    setSearchRouteCard(null);
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

  function selectSearchResult(place: { lat: number; lng: number; name: string }) {
    const dist = userLoc ? haversineKm(userLoc.lat, userLoc.lng, place.lat, place.lng) : null;
    setSearchRouteCard({ ...place, dist });
    setSearchResults([]);
    webRef.current?.postMessage(JSON.stringify({ type: 'fly_to', lat: place.lat, lng: place.lng, name: place.name }));
  }

  function navigateToSearch() {
    if (!searchRouteCard || !userLoc) return;
    const dest: WP = { lat: searchRouteCard.lat, lng: searchRouteCard.lng, name: searchRouteCard.name, day: 0, type: 'waypoint' };
    navDestRef.current = dest;
    setNavDest(dest);
    setShowSearch(false);
    setSearchRouteCard(null);
    webRef.current?.postMessage(JSON.stringify({
      type: 'route_to_search',
      lat: dest.lat, lng: dest.lng,
      name: dest.name,
      userLat: userLoc.lat, userLng: userLoc.lng,
    }));
    setNavMode(true);
  }

  async function openCampInsight() {
    if (!selectedCamp) return;
    setLoadingInsight(true);
    setLoadingWiki(true);
    try {
      const [insight, wiki] = await Promise.all([
        api.getCampsiteInsight({ name: selectedCamp.name, lat: selectedCamp.lat, lng: selectedCamp.lng,
          description: selectedCamp.description, land_type: selectedCamp.land_type,
          amenities: campDetail?.amenities ?? [] }),
        api.getWikipediaNearby(selectedCamp.lat, selectedCamp.lng, 15000),
      ]);
      setCampInsight(insight);
      setWikiArticles(wiki);
    } catch {}
    setLoadingInsight(false);
    setLoadingWiki(false);
  }

  async function fetchRouteBrief() {
    if (!activeTrip) return;
    setLoadingBrief(true);
    try {
      const brief = await api.getRouteBrief({
        trip_name: activeTrip.plan.trip_name,
        waypoints: activeTrip.plan.waypoints,
        reports: routeAlerts,
      });
      setRouteBrief(brief);
      setShowRouteBrief(true);
    } catch {}
    setLoadingBrief(false);
  }

  async function fetchPackingList() {
    if (!activeTrip) return;
    setLoadingPacking(true);
    try {
      const list = await api.getPackingList({
        trip_name: activeTrip.plan.trip_name,
        duration_days: activeTrip.plan.duration_days,
        road_types: [...new Set(activeTrip.plan.daily_itinerary.map(d => d.road_type))],
        land_types: [...new Set(activeTrip.plan.waypoints.map(w => w.land_type))],
        states: activeTrip.plan.states,
      });
      setPackingList(list);
      setShowPacking(true);
    } catch {}
    setLoadingPacking(false);
  }

  function copyCoordinates(lat: number, lng: number) {
    Share.share({ message: `${lat.toFixed(6)}, ${lng.toFixed(6)}` });
  }

  // ── Layer switch ────────────────────────────────────────────────────────────

  function switchLayer() {
    const next: MapLayer = mapLayer === 'satellite' ? 'topo' : mapLayer === 'topo' ? 'hybrid' : 'satellite';
    setMapLayerState(next);
    webRef.current?.postMessage(JSON.stringify({
      type: 'set_style',
      style: MAPBOX_STYLES[next] ?? MAPBOX_STYLES.satellite,
    }));
  }

  async function loadCampsInArea(bounds: { n: number; s: number; e: number; w: number; zoom: number }, types: string[]) {
    if (bounds.zoom < 6) return;
    setIsLoadingAreaCamps(true);
    try {
      const camps = await api.getCampsBbox(bounds.n, bounds.s, bounds.e, bounds.w, types);
      webRef.current?.postMessage(JSON.stringify({ type: 'set_camps', pins: camps }));
    } catch {}
    setIsLoadingAreaCamps(false);
  }

  // ── WebView message handler ──────────────────────────────────────────────────

  function onWebMessage(e: any) {
    try {
      const msg = JSON.parse(e.nativeEvent.data);
      if (msg.type === 'map_ready') {
        if (viewportRef.current) loadCampsInArea(viewportRef.current, activeFilters);
      }
      if (msg.type === 'map_bounds') {
        viewportRef.current = { n: msg.n, s: msg.s, e: msg.e, w: msg.w, zoom: msg.zoom };
      }
      if (msg.type === 'search_area') {
        const bounds = { n: msg.n, s: msg.s, e: msg.e, w: msg.w, zoom: msg.zoom };
        viewportRef.current = bounds;
        // User explicitly tapped "Search This Area"
        loadCampsInArea(bounds, activeFilters);
      }
      if (msg.type === 'map_tapped') {
        setSelectedCamp(null);
      }
      if (msg.type === 'route_ready') {
        setIsRouted(msg.routed);
        setRouteSteps(msg.steps ?? []);
        setRouteLegs(msg.legs ?? []);
        if (msg.fromIdx !== undefined) setRouteLegOffset(msg.fromIdx);
        setIsRerouting(false);
      }
      if (msg.type === 'off_route' && navRef.current.active) {
        setIsRerouting(true);
        webRef.current?.postMessage(JSON.stringify({
          type: 'reroute_from',
          lat: msg.lat, lng: msg.lng,
          fromIdx: navRef.current.idx,
        }));
        setRouteLegOffset(navRef.current.idx);
        Speech.speak('Recalculating.', { rate: 0.95 });
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
      if (msg.type === 'campsite_tapped') {
        const camp = (msg.camp as CampsitePin) || null;
        setSelectedCamp(camp);
        setCampDetail(null);
        setCampInsight(null);
        setWikiArticles([]);
      }
    } catch {}
  }

  async function openCampDetail() {
    if (!selectedCamp) return;
    setLoadingDetail(true);
    setCampInsight(null);
    setWikiArticles([]);
    try {
      const d = await api.getCampsiteDetail(selectedCamp.id);
      setCampDetail(d);
      setShowCampDetail(true);
      // Load AI insight + Wikipedia in background after modal opens
      openCampInsight();
    } catch {
      // OSM pins don't have RIDB detail — show quick card data as detail
      setCampDetail(selectedCamp as any);
      setShowCampDetail(true);
      openCampInsight();
    }
    setLoadingDetail(false);
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

  const navTarget = navMode ? (waypoints[navIdx] ?? navDest ?? null) : null;
  const distKm    = userLoc && navTarget ? haversineKm(userLoc.lat, userLoc.lng, navTarget.lat, navTarget.lng) : null;
  const bearing   = userLoc && navTarget ? calcBearing(userLoc.lat, userLoc.lng, navTarget.lat, navTarget.lng) : null;
  const speedMph  = userSpeed !== null && userSpeed > 0 ? userSpeed * 2.237 : null;
  const etaMins   = distKm && userSpeed && userSpeed > 0.5
    ? Math.round(distKm / (userSpeed * 3.6) * 60) : null;

  // Next OSRM step (rough: first non-depart step with significant distance)
  const nextStep = routeSteps.find(s => s.type !== 'depart' && s.distance > 50) ?? null;
  const isProceeding = distKm !== null && distKm > 30;

  // Total remaining trip distance (current → navIdx → ... → last waypoint)
  const remainingKm = useMemo(() => {
    if (!navMode || !userLoc || !waypoints.length) return null;
    let total = distKm ?? 0;
    for (let i = navIdx; i < waypoints.length - 1; i++) {
      total += haversineKm(waypoints[i].lat, waypoints[i].lng, waypoints[i + 1].lat, waypoints[i + 1].lng);
    }
    return total;
  }, [navMode, navIdx, distKm, userLoc]);

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
          webLoadedRef.current = true;
          if (mapboxToken) {
            webRef.current?.postMessage(JSON.stringify({
              type: 'set_token', token: mapboxToken,
              style: MAPBOX_STYLES[mapLayer] ?? MAPBOX_STYLES.satellite,
            }));
          }
          if (userLoc) webRef.current?.postMessage(JSON.stringify({ type: 'user_pos', lat: userLoc.lat, lng: userLoc.lng }));
        }}
      />

      {/* Top bar */}
      <View style={s.topBar}>
        <View style={[s.topBarDot, navMode && { backgroundColor: C.green }]} />
        <Text style={s.topBarText} numberOfLines={1}>
          {isDownloading
            ? `CACHING TILES ${downloadProgress}% · ${downloadTotal} TOTAL`
            : offlineWarning && navMode
              ? '⚠ NO OFFLINE MAPS — TAP MAP BUTTON TO DOWNLOAD'
              : isRerouting
              ? 'RECALCULATING ROUTE...'
              : navMode
                ? navDest && waypoints.length === 0
                  ? isApproaching ? `ARRIVING · ${navDest.name}` : `NAVIGATING TO ${navDest.name.split(',')[0].toUpperCase()}`
                  : isApproaching
                    ? `ARRIVING · ${waypoints[navIdx]?.name ?? ''}`
                    : isProceeding
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

        <TouchableOpacity
          style={[s.ctrlBtn, showFilters && { backgroundColor: '#14b8a6dd', borderColor: '#14b8a6' }]}
          onPress={() => { setShowFilters(p => !p); if (showFilters) { setActiveFilters([]); setSelectedCamp(null); } }}
        >
          <Ionicons name="filter" size={20} color={showFilters ? '#fff' : C.text} />
        </TouchableOpacity>

        <TouchableOpacity
          style={[s.ctrlBtn, isLoadingAreaCamps && { borderColor: '#14b8a6' }]}
          onPress={() => {
            const center = userLoc ?? (waypoints[0] ? { lat: waypoints[0].lat, lng: waypoints[0].lng } : null);
            if (!center) return;
            const deg = 0.4;
            const bounds = { n: center.lat + deg, s: center.lat - deg, e: center.lng + deg, w: center.lng - deg, zoom: 10 };
            viewportRef.current = bounds;
            loadCampsInArea(bounds, activeFilters);
          }}
        >
          {isLoadingAreaCamps
            ? <ActivityIndicator size="small" color="#14b8a6" />
            : <Text style={{ fontSize: 16 }}>⛺</Text>
          }
        </TouchableOpacity>

        <TouchableOpacity
          style={[s.ctrlBtn, showPois && { backgroundColor: '#3b82f6dd', borderColor: '#3b82f6' }]}
          onPress={() => setShowPois(p => !p)}
        >
          <Text style={{ fontSize: 15 }}>💧</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[s.ctrlBtn, { borderColor: C.border }]}
          onPress={() => setShowOfflineModal(true)}
        >
          <Ionicons name="map-outline" size={18} color={C.text2} />
        </TouchableOpacity>

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
                <TouchableOpacity key={i} style={s.searchResultItem} onPress={() => selectSearchResult(r)}>
                  <Ionicons name="location-outline" size={13} color={C.text3} />
                  <Text style={s.searchResultText} numberOfLines={2}>{r.name}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          )}
          {searchRouteCard && (
            <View style={s.routeCard}>
              <Text style={s.routeCardName} numberOfLines={2}>{searchRouteCard.name}</Text>
              {searchRouteCard.dist !== null && (
                <Text style={s.routeCardDist}>
                  {formatDist(searchRouteCard.dist!)} from you
                  {routeOpts.backRoads ? ' · BACK ROADS' : routeOpts.avoidHighways ? ' · NO HWY' : ''}
                  {routeOpts.avoidTolls ? ' · NO TOLL' : ''}
                </Text>
              )}
              <View style={s.routeCardActions}>
                <TouchableOpacity style={s.routeCardNav} onPress={navigateToSearch} disabled={!userLoc}>
                  <Ionicons name="navigate" size={14} color="#fff" />
                  <Text style={s.routeCardNavText}>NAVIGATE HERE</Text>
                </TouchableOpacity>
                <TouchableOpacity style={s.routeCardOpts} onPress={() => setShowRouteOpts(true)}>
                  <Ionicons name="options-outline" size={14} color={C.text2} />
                  <Text style={s.routeCardOptsText}>OPTIONS</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => setSearchRouteCard(null)}>
                  <Ionicons name="close" size={18} color={C.text3} />
                </TouchableOpacity>
              </View>
            </View>
          )}
        </View>
      )}

      {/* ── Campsite filter bar ── */}
      {showFilters && !navMode && (
        <View style={s.filterBar}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.filterScroll}>
            {([
              { id: 'blm',       label: 'BLM',              emoji: '🏕️' },
              { id: 'nfs',       label: 'Nat. Forest',      emoji: '🌿' },
              { id: 'nps',       label: 'Nat. Park',        emoji: '⛰️' },
              { id: 'state',     label: 'State Park',       emoji: '🏞️' },
              { id: 'dispersed', label: 'Dispersed',        emoji: '🌲' },
              { id: 'rv',        label: 'RV / Hookups',     emoji: '🚐' },
              { id: 'koa',       label: 'KOA',              emoji: '🏡' },
              { id: 'tent',      label: 'Tent Only',        emoji: '⛺' },
              { id: 'free',      label: 'Free',             emoji: '💚' },
              { id: 'water',     label: 'Water',            emoji: '💧' },
              { id: 'showers',   label: 'Showers',          emoji: '🚿' },
              { id: 'dog',       label: 'Dog Friendly',     emoji: '🐕' },
              { id: 'ada',       label: 'ADA',              emoji: '♿' },
              { id: 'parking',   label: 'Overnight Prkg',   emoji: '🅿️' },
            ]).map(f => {
              const active = activeFilters.includes(f.id);
              return (
                <TouchableOpacity
                  key={f.id}
                  style={[s.filterChip, active && s.filterChipActive]}
                  onPress={() => setActiveFilters(prev =>
                    prev.includes(f.id) ? prev.filter(x => x !== f.id) : [...prev, f.id]
                  )}
                >
                  <Text style={s.filterChipEmoji}>{f.emoji}</Text>
                  <Text style={[s.filterChipText, active && { color: '#fff' }]}>{f.label}</Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
          {isLoadingAreaCamps && (
            <View style={s.filterLoading}>
              <ActivityIndicator size="small" color="#14b8a6" />
            </View>
          )}
        </View>
      )}

      {/* ── Campsite quick card ── */}
      {selectedCamp && !navMode && (
        <View style={s.quickCard}>
          <View style={s.quickCardImg}>
            {selectedCamp.photo_url
              ? <Image source={{ uri: selectedCamp.photo_url }} style={s.quickCardPhoto} resizeMode="cover" />
              : <View style={[s.quickCardPhotoPlaceholder, { backgroundColor: '#14b8a633' }]}>
                  <Text style={{ fontSize: 32 }}>
                    {selectedCamp.tags.includes('rv') ? '🚐' : selectedCamp.tags.includes('dispersed') ? '🌲' : '🏕️'}
                  </Text>
                </View>
            }
          </View>
          <View style={s.quickCardBody}>
            <View style={s.quickCardHeader}>
              <Text style={s.quickCardName} numberOfLines={2}>{selectedCamp.name}</Text>
              <TouchableOpacity onPress={() => setSelectedCamp(null)}>
                <Ionicons name="close" size={18} color={C.text3} />
              </TouchableOpacity>
            </View>
            <View style={s.quickCardTags}>
              {selectedCamp.tags.slice(0, 4).map(t => (
                <View key={t} style={s.qTag}><Text style={s.qTagText}>{t.toUpperCase()}</Text></View>
              ))}
            </View>
            <Text style={s.quickCardLand}>{selectedCamp.land_type}</Text>
            {selectedCamp.cost ? <Text style={s.quickCardCost}>{selectedCamp.cost}</Text> : null}
            <View style={s.quickCardActions}>
              <TouchableOpacity style={s.quickCardBook} onPress={() => Linking.openURL(selectedCamp.url)}>
                <Ionicons name="calendar-outline" size={13} color={C.orange} />
                <Text style={s.quickCardBookText}>BOOK</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.quickCardFull} onPress={openCampDetail} disabled={loadingDetail}>
                {loadingDetail
                  ? <ActivityIndicator size="small" color="#fff" />
                  : <Text style={s.quickCardFullText}>FULL PROFILE →</Text>
                }
              </TouchableOpacity>
            </View>
          </View>
        </View>
      )}

      {/* ── Campsite full profile modal ── */}
      <Modal visible={showCampDetail} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowCampDetail(false)}>
        <View style={s.detailModal}>
          {campDetail && (
            <ScrollView showsVerticalScrollIndicator={false}>
              {/* Photos */}
              {campDetail.photos.length > 0 ? (
                <ScrollView horizontal pagingEnabled showsHorizontalScrollIndicator={false} style={s.photoGallery}>
                  {campDetail.photos.map((uri, i) => (
                    <Image key={i} source={{ uri }} style={s.galleryPhoto} resizeMode="cover" />
                  ))}
                </ScrollView>
              ) : (
                <View style={s.galleryPlaceholder}>
                  <Text style={{ fontSize: 48 }}>🏕️</Text>
                </View>
              )}

              <View style={s.detailContent}>
                {/* Header */}
                <View style={s.detailHeader}>
                  <Text style={s.detailName}>{campDetail.name}</Text>
                  <TouchableOpacity style={s.detailClose} onPress={() => setShowCampDetail(false)}>
                    <Ionicons name="close" size={22} color={C.text} />
                  </TouchableOpacity>
                </View>

                {/* Tags */}
                <View style={s.detailTags}>
                  <View style={s.detailLandBadge}>
                    <Text style={s.detailLandText}>{campDetail.land_type.toUpperCase()}</Text>
                  </View>
                  {campDetail.tags.map(t => (
                    <View key={t} style={s.qTag}><Text style={s.qTagText}>{t.toUpperCase()}</Text></View>
                  ))}
                  {campDetail.ada && <View style={[s.qTag, { borderColor: '#3b82f6' }]}><Text style={[s.qTagText, { color: '#3b82f6' }]}>♿ ADA</Text></View>}
                </View>

                {/* Cost + sites count */}
                <View style={s.detailMeta}>
                  <Text style={s.detailCost}>{campDetail.cost}</Text>
                  {campDetail.campsites_count > 0 && (
                    <Text style={s.detailSiteCount}>{campDetail.campsites_count} sites</Text>
                  )}
                </View>

                {/* Description */}
                {campDetail.description ? (
                  <View style={s.detailSection}>
                    <Text style={s.detailSectionTitle}>About</Text>
                    <Text style={s.detailDesc}>{campDetail.description.replace(/<[^>]+>/g, '')}</Text>
                  </View>
                ) : null}

                {/* Amenities */}
                {campDetail.amenities.length > 0 && (
                  <View style={s.detailSection}>
                    <Text style={s.detailSectionTitle}>Amenities</Text>
                    <View style={s.amenityGrid}>
                      {campDetail.amenities.map(a => (
                        <View key={a} style={s.amenityItem}>
                          <Text style={s.amenityText}>{a}</Text>
                        </View>
                      ))}
                    </View>
                  </View>
                )}

                {/* Site types */}
                {campDetail.site_types.length > 0 && (
                  <View style={s.detailSection}>
                    <Text style={s.detailSectionTitle}>Site Types</Text>
                    {campDetail.site_types.map(st => (
                      <View key={st} style={s.siteTypeRow}>
                        <Ionicons name="checkmark-circle-outline" size={14} color={C.green} />
                        <Text style={s.siteTypeText}>{st}</Text>
                      </View>
                    ))}
                  </View>
                )}

                {/* Activities */}
                {campDetail.activities.length > 0 && (
                  <View style={s.detailSection}>
                    <Text style={s.detailSectionTitle}>Activities</Text>
                    <Text style={s.detailActivities}>{campDetail.activities.join(' · ')}</Text>
                  </View>
                )}

                {/* Coordinates */}
                <View style={s.detailSection}>
                  <Text style={s.detailSectionTitle}>Coordinates</Text>
                  <View style={s.coordRow}>
                    <Text style={s.coordText}>
                      {campDetail.lat.toFixed(6)}, {campDetail.lng.toFixed(6)}
                    </Text>
                    <TouchableOpacity style={s.coordCopy} onPress={() => copyCoordinates(campDetail.lat, campDetail.lng)}>
                      <Ionicons name="copy-outline" size={14} color={C.orange} />
                      <Text style={s.coordCopyText}>COPY</Text>
                    </TouchableOpacity>
                  </View>
                  {campInsight?.coordinates_dms ? (
                    <Text style={s.coordDms}>{campInsight.coordinates_dms}</Text>
                  ) : null}
                </View>

                {/* AI Insight */}
                {(campInsight || loadingInsight) && (
                  <View style={s.detailSection}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10 }}>
                      <Text style={s.detailSectionTitle}>AI Insight</Text>
                      {campInsight?.star_rating && (
                        <Text style={s.aiStars}>{'★'.repeat(campInsight.star_rating)}{'☆'.repeat(5 - campInsight.star_rating)}</Text>
                      )}
                    </View>
                    {loadingInsight && !campInsight && <ActivityIndicator size="small" color={C.orange} />}
                    {campInsight?.insider_tip ? (
                      <View style={s.insiderTip}>
                        <Text style={s.insiderLabel}>💡 INSIDER TIP</Text>
                        <Text style={s.insiderText}>{campInsight.insider_tip}</Text>
                      </View>
                    ) : null}
                    {campInsight?.best_for ? <Text style={s.aiMeta}>Best for: {campInsight.best_for}</Text> : null}
                    {campInsight?.best_season ? <Text style={s.aiMeta}>Best season: {campInsight.best_season}</Text> : null}
                    {campInsight?.hazards ? (
                      <View style={s.hazardRow}>
                        <Ionicons name="warning-outline" size={13} color={C.yellow} />
                        <Text style={s.hazardText}>{campInsight.hazards}</Text>
                      </View>
                    ) : null}
                    {campInsight?.nearby_highlights?.length ? (
                      <View style={{ marginTop: 8 }}>
                        <Text style={[s.detailSectionTitle, { borderBottomWidth: 0, paddingBottom: 0, marginBottom: 6 }]}>Nearby</Text>
                        {campInsight.nearby_highlights.map((h, i) => (
                          <Text key={i} style={s.nearbyItem}>• {h}</Text>
                        ))}
                      </View>
                    ) : null}
                  </View>
                )}

                {/* Wikipedia nearby */}
                {(wikiArticles.length > 0 || loadingWiki) && (
                  <View style={s.detailSection}>
                    <Text style={s.detailSectionTitle}>Wikipedia Nearby</Text>
                    {loadingWiki && !wikiArticles.length && <ActivityIndicator size="small" color={C.orange} />}
                    {wikiArticles.map((w, i) => (
                      <TouchableOpacity key={i} style={s.wikiItem} onPress={() => Linking.openURL(w.url)}>
                        <View style={s.wikiItemHeader}>
                          <Text style={s.wikiTitle} numberOfLines={1}>{w.title}</Text>
                          <Text style={s.wikiDist}>{(w.dist_m / 1609).toFixed(1)} mi</Text>
                        </View>
                        {w.extract ? <Text style={s.wikiExtract} numberOfLines={2}>{w.extract}</Text> : null}
                      </TouchableOpacity>
                    ))}
                  </View>
                )}

                {/* Actions */}
                <View style={s.detailActions}>
                  {campDetail.url && !campDetail.url.includes('openstreetmap.org/node') && (
                    <TouchableOpacity style={s.detailBookBtn} onPress={() => Linking.openURL(campDetail.url)}>
                      <Ionicons name="calendar" size={16} color="#fff" />
                      <Text style={s.detailBookText}>BOOK ON RECREATION.GOV</Text>
                    </TouchableOpacity>
                  )}
                  <TouchableOpacity style={s.detailDirBtn} onPress={() => Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${campDetail.lat},${campDetail.lng}`)}>
                    <Ionicons name="navigate-outline" size={16} color={C.orange} />
                    <Text style={s.detailDirText}>GET DIRECTIONS</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[s.detailDirBtn, { borderColor: '#3b82f6' }]}
                    onPress={() => copyCoordinates(campDetail.lat, campDetail.lng)}>
                    <Ionicons name="copy-outline" size={16} color="#3b82f6" />
                    <Text style={[s.detailDirText, { color: '#3b82f6' }]}>COPY GPS COORDS</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </ScrollView>
          )}
        </View>
      </Modal>

      {/* ── Route Options Sheet ── */}
      <Modal visible={showRouteOpts} animationType="slide" transparent onRequestClose={() => setShowRouteOpts(false)}>
        <TouchableOpacity style={s.modalBackdrop} activeOpacity={1} onPress={() => setShowRouteOpts(false)}>
          <View style={s.routeOptsSheet}>
            <Text style={s.routeOptsTitle}>ROUTE OPTIONS</Text>
            {([
              { key: 'avoidTolls',   label: 'Avoid Tolls',          sub: 'Stay off toll roads' },
              { key: 'avoidHighways',label: 'Avoid Highways',        sub: 'No interstates/motorways' },
              { key: 'backRoads',    label: 'Prefer Back Roads',     sub: 'Scenic, slower — via Valhalla' },
              { key: 'noFerries',    label: 'No Ferries',            sub: 'Avoid water crossings' },
            ] as const).map(opt => (
              <TouchableOpacity key={opt.key} style={s.routeOptRow}
                onPress={() => setRouteOpts(p => ({ ...p, [opt.key]: !p[opt.key] }))}>
                <View style={s.routeOptCheck}>
                  {routeOpts[opt.key] && <Ionicons name="checkmark" size={14} color={C.orange} />}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={s.routeOptLabel}>{opt.label}</Text>
                  <Text style={s.routeOptSub}>{opt.sub}</Text>
                </View>
              </TouchableOpacity>
            ))}
            <TouchableOpacity style={s.routeOptsApply} onPress={() => {
              setShowRouteOpts(false);
              if (searchRouteCard && userLoc) navigateToSearch();
            }}>
              <Text style={s.routeOptsApplyText}>APPLY & ROUTE</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* ── Offline Map Download Modal ── */}
      <Modal visible={showOfflineModal} animationType="slide" transparent onRequestClose={() => setShowOfflineModal(false)}>
        <TouchableOpacity style={s.modalBackdrop} activeOpacity={1} onPress={() => setShowOfflineModal(false)}>
          <View style={s.offlineSheet}>
            <Text style={s.offlineTitle}>OFFLINE MAPS</Text>
            {!user ? (
              <View style={{ alignItems: 'center', paddingVertical: 24 }}>
                <Text style={[s.offlineSub, { textAlign: 'center', marginBottom: 4 }]}>Sign in to download offline maps.</Text>
                <TouchableOpacity onPress={() => setShowOfflineModal(false)} style={s.offlineRouteBtn}>
                  <Text style={s.offlineRouteBtnText}>GO TO PROFILE TO SIGN IN</Text>
                </TouchableOpacity>
              </View>
            ) : (<>
            <Text style={s.offlineSub}>Download tiles for use without signal. z10–z12 overview, z10–z14 for current area.</Text>
            <Text style={s.offlineSectionLabel}>ALL US STATES (z10–z12)</Text>
            <ScrollView style={{ maxHeight: 260 }} showsVerticalScrollIndicator={false}>
              <View style={s.stateGrid}>
                {Object.entries(US_STATES).map(([code, st]) => (
                  <TouchableOpacity key={code} style={s.stateBtn}
                    onPress={() => {
                      setShowOfflineModal(false);
                      setIsDownloading(true);
                      setOfflineSaved(false);
                      webRef.current?.postMessage(JSON.stringify({
                        type: 'download_tiles_bbox',
                        n: st.n, s: st.s, e: st.e, w: st.w,
                        minZ: 10, maxZ: 12,
                      }));
                    }}>
                    <Text style={s.stateEmoji}>{st.emoji}</Text>
                    <Text style={s.stateName}>{st.name}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </ScrollView>
            <Text style={s.offlineSectionLabel}>CURRENT TRIP AREA (z10–z14)</Text>
            {waypoints.length > 0 ? (
              <TouchableOpacity style={s.offlineRouteBtn}
                onPress={() => {
                  setShowOfflineModal(false);
                  setIsDownloading(true);
                  setOfflineSaved(false);
                  webRef.current?.postMessage(JSON.stringify({ type: 'download_tiles', minZ: 10, maxZ: 14 }));
                }}>
                <Ionicons name="cloud-download-outline" size={16} color="#fff" />
                <Text style={s.offlineRouteBtnText}>DOWNLOAD {activeTrip?.plan.trip_name.toUpperCase() ?? 'TRIP'} AREA</Text>
              </TouchableOpacity>
            ) : (
              <Text style={s.offlineNoTrip}>Plan a trip first to download its corridor</Text>
            )}
            {isDownloading && (
              <View style={{ marginTop: 12 }}>
                <View style={s.dlBar}>
                  <View style={[s.dlFill, { width: `${downloadProgress}%` as any }]} />
                </View>
                <Text style={s.offlineProgress}>{downloadProgress}% · {downloadTotal} tiles</Text>
              </View>
            )}
            </>)}
          </View>
        </TouchableOpacity>
      </Modal>

      {/* ── Route Brief Modal ── */}
      <Modal visible={showRouteBrief} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowRouteBrief(false)}>
        <View style={s.detailModal}>
          {routeBrief && (
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: 20 }}>
              <View style={s.detailHeader}>
                <Text style={s.detailName}>Route Briefing</Text>
                <TouchableOpacity style={s.detailClose} onPress={() => setShowRouteBrief(false)}>
                  <Ionicons name="close" size={22} color={C.text} />
                </TouchableOpacity>
              </View>
              <View style={[s.readinessRow, { borderColor: routeBrief.readiness_score >= 7 ? C.green : routeBrief.readiness_score >= 4 ? C.yellow : C.red }]}>
                <Text style={s.readinessScore}>{routeBrief.readiness_score}/10</Text>
                <Text style={s.readinessLabel}>READINESS</Text>
              </View>
              <Text style={s.briefSummary}>{routeBrief.briefing_summary}</Text>
              {routeBrief.top_concerns.length > 0 && (
                <View style={s.detailSection}>
                  <Text style={s.detailSectionTitle}>Key Concerns</Text>
                  {routeBrief.top_concerns.map((c, i) => (
                    <View key={i} style={s.briefItem}>
                      <Ionicons name="warning-outline" size={14} color={C.yellow} />
                      <Text style={s.briefItemText}>{c}</Text>
                    </View>
                  ))}
                </View>
              )}
              {routeBrief.must_do_before_leaving.length > 0 && (
                <View style={s.detailSection}>
                  <Text style={s.detailSectionTitle}>Before You Leave</Text>
                  {routeBrief.must_do_before_leaving.map((t, i) => (
                    <View key={i} style={s.briefItem}>
                      <Ionicons name="checkmark-circle-outline" size={14} color={C.green} />
                      <Text style={s.briefItemText}>{t}</Text>
                    </View>
                  ))}
                </View>
              )}
              <View style={s.briefStats}>
                <View style={s.briefStat}><Text style={s.briefStatVal}>{routeBrief.estimated_fuel_stops}</Text><Text style={s.briefStatLabel}>Fuel Stops</Text></View>
                <View style={s.briefStat}><Text style={s.briefStatVal}>{routeBrief.water_carry_gallons}</Text><Text style={s.briefStatLabel}>Gallons Water</Text></View>
              </View>
            </ScrollView>
          )}
        </View>
      </Modal>

      {/* ── Packing List Modal ── */}
      <Modal visible={showPacking} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowPacking(false)}>
        <View style={s.detailModal}>
          {packingList && (
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: 20 }}>
              <View style={s.detailHeader}>
                <Text style={s.detailName}>Packing List</Text>
                <TouchableOpacity style={s.detailClose} onPress={() => setShowPacking(false)}>
                  <Ionicons name="close" size={22} color={C.text} />
                </TouchableOpacity>
              </View>
              {([
                { key: 'essentials',          label: 'Essentials',       icon: '⭐' },
                { key: 'recovery_gear',       label: 'Recovery Gear',    icon: '🔧' },
                { key: 'water_food',          label: 'Water & Food',     icon: '💧' },
                { key: 'navigation',          label: 'Navigation',       icon: '🗺️' },
                { key: 'shelter',             label: 'Shelter',          icon: '⛺' },
                { key: 'tools_spares',        label: 'Tools & Spares',   icon: '🔩' },
                { key: 'optional_nice_to_have',label:'Nice to Have',     icon: '✨' },
                { key: 'leave_at_home',       label: 'Leave at Home',    icon: '🚫' },
              ] as const).map(section => {
                const items = (packingList as any)[section.key] as string[];
                if (!items?.length) return null;
                return (
                  <View key={section.key} style={s.detailSection}>
                    <Text style={s.detailSectionTitle}>{section.icon} {section.label}</Text>
                    {items.map((item, i) => (
                      <View key={i} style={s.briefItem}>
                        <View style={s.packDot} />
                        <Text style={s.briefItemText}>{item}</Text>
                      </View>
                    ))}
                  </View>
                );
              })}
            </ScrollView>
          )}
        </View>
      </Modal>

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
            <Text style={[s.navDistVal, isApproaching && { color: C.green }]}>
              {distKm !== null ? formatDist(distKm) : '--'}
            </Text>
            {etaMins !== null && (
              <Text style={s.navEta}>
                {etaMins < 60 ? `~${etaMins} min` : `~${Math.floor(etaMins / 60)}h ${etaMins % 60}m`}
              </Text>
            )}
            {remainingKm !== null && waypoints.length > navIdx + 1 && (
              <Text style={s.navRemaining}>{formatDist(remainingKm)} trip total</Text>
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
            <View style={[s.navTargetBadge, isApproaching && { backgroundColor: C.green + '22', borderColor: C.green }]}>
              <Text style={[s.navTargetBadgeText, isApproaching && { color: C.green }]}>
                {isApproaching ? '⬤ ARRIVING' : isProceeding ? 'PROCEED TO' : 'NEXT STOP'}
              </Text>
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
          <View style={s.aiActionsRow}>
            <TouchableOpacity style={s.aiActionBtn} onPress={fetchRouteBrief} disabled={loadingBrief}>
              {loadingBrief
                ? <ActivityIndicator size="small" color={C.orange} />
                : <><Ionicons name="shield-checkmark-outline" size={13} color={C.orange} /><Text style={s.aiActionText}>ROUTE BRIEF</Text></>
              }
            </TouchableOpacity>
            <TouchableOpacity style={s.aiActionBtn} onPress={fetchPackingList} disabled={loadingPacking}>
              {loadingPacking
                ? <ActivityIndicator size="small" color={C.orange} />
                : <><Ionicons name="bag-outline" size={13} color={C.orange} /><Text style={s.aiActionText}>PACKING LIST</Text></>
              }
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
  navRemaining: { color: C.text3, fontSize: 9, fontFamily: mono, marginTop: 2, opacity: 0.7 },
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

  // ── Filter bar
  filterBar: {
    position: 'absolute', top: 92, left: 0, right: 0,
    backgroundColor: 'rgba(8,12,18,0.96)', borderBottomWidth: 1, borderColor: C.border,
  },
  filterScroll: { paddingHorizontal: 14, paddingVertical: 10, gap: 8 },
  filterChip: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20,
    backgroundColor: C.s2, borderWidth: 1, borderColor: C.border,
  },
  filterChipActive: { backgroundColor: '#14b8a6', borderColor: '#14b8a6' },
  filterChipEmoji: { fontSize: 14 },
  filterChipText: { color: C.text2, fontSize: 11, fontFamily: mono, fontWeight: '600' },
  filterLoading: { alignItems: 'center', paddingBottom: 8 },

  // ── Campsite quick card
  quickCard: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    backgroundColor: 'rgba(8,12,18,0.98)',
    borderTopWidth: 1, borderColor: '#14b8a6',
    flexDirection: 'row', gap: 0,
  },
  quickCardImg: { width: 110, height: 140 },
  quickCardPhoto: { width: 110, height: 140 },
  quickCardPhotoPlaceholder: {
    width: 110, height: 140, alignItems: 'center', justifyContent: 'center',
  },
  quickCardBody: { flex: 1, padding: 14, paddingBottom: 28 },
  quickCardHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: 6 },
  quickCardName: { color: C.text, fontSize: 13, fontWeight: '700', flex: 1, lineHeight: 18 },
  quickCardTags: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginBottom: 4 },
  quickCardLand: { color: '#14b8a6', fontSize: 10, fontFamily: mono, marginBottom: 3 },
  quickCardCost: { color: C.text3, fontSize: 10, fontFamily: mono, marginBottom: 8 },
  quickCardActions: { flexDirection: 'row', gap: 8 },
  quickCardBook: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 10, paddingVertical: 7, borderRadius: 8,
    borderWidth: 1, borderColor: C.orange,
  },
  quickCardBookText: { color: C.orange, fontSize: 10, fontFamily: mono, fontWeight: '700' },
  quickCardFull: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    paddingVertical: 7, borderRadius: 8, backgroundColor: '#14b8a6',
  },
  quickCardFullText: { color: '#fff', fontSize: 10, fontFamily: mono, fontWeight: '700' },
  qTag: {
    paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4,
    borderWidth: 1, borderColor: '#14b8a6',
  },
  qTagText: { color: '#14b8a6', fontSize: 8, fontFamily: mono, fontWeight: '700' },

  // ── Campsite detail modal
  detailModal: { flex: 1, backgroundColor: C.bg },
  photoGallery: { height: 240 },
  galleryPhoto: { width: 400, height: 240 },
  galleryPlaceholder: {
    height: 200, backgroundColor: '#14b8a611',
    alignItems: 'center', justifyContent: 'center',
  },
  detailContent: { padding: 20 },
  detailHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginBottom: 12 },
  detailName: { color: C.text, fontSize: 20, fontWeight: '800', flex: 1, lineHeight: 26 },
  detailClose: {
    width: 36, height: 36, borderRadius: 18, backgroundColor: C.s2,
    alignItems: 'center', justifyContent: 'center',
  },
  detailTags: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 10 },
  detailLandBadge: {
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6,
    backgroundColor: '#14b8a622', borderWidth: 1, borderColor: '#14b8a6',
  },
  detailLandText: { color: '#14b8a6', fontSize: 9, fontFamily: mono, fontWeight: '700' },
  detailMeta: { flexDirection: 'row', gap: 16, marginBottom: 16 },
  detailCost: { color: C.green, fontSize: 13, fontFamily: mono, fontWeight: '700' },
  detailSiteCount: { color: C.text3, fontSize: 13, fontFamily: mono },
  detailSection: { marginBottom: 20 },
  detailSectionTitle: {
    color: C.text2, fontSize: 11, fontFamily: mono, fontWeight: '700',
    letterSpacing: 1, marginBottom: 10,
    borderBottomWidth: 1, borderColor: C.border, paddingBottom: 6,
  },
  detailDesc: { color: C.text2, fontSize: 13, lineHeight: 20 },
  amenityGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  amenityItem: {
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8,
    backgroundColor: C.s2, borderWidth: 1, borderColor: C.border,
  },
  amenityText: { color: C.text2, fontSize: 12 },
  siteTypeRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  siteTypeText: { color: C.text2, fontSize: 13 },
  detailActivities: { color: C.text3, fontSize: 12, lineHeight: 20 },
  detailActions: { gap: 10, marginTop: 8 },
  detailBookBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    paddingVertical: 14, borderRadius: 14, backgroundColor: C.green,
  },
  detailBookText: { color: '#fff', fontSize: 13, fontFamily: mono, fontWeight: '700' },
  detailDirBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    paddingVertical: 14, borderRadius: 14,
    borderWidth: 1, borderColor: C.orange,
  },
  detailDirText: { color: C.orange, fontSize: 13, fontFamily: mono, fontWeight: '700' },

  // ── Coordinates
  coordRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  coordText: { color: C.text2, fontSize: 13, fontFamily: mono, flex: 1 },
  coordDms: { color: C.text3, fontSize: 11, fontFamily: mono, marginTop: 4 },
  coordCopy: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, borderWidth: 1, borderColor: C.orange },
  coordCopyText: { color: C.orange, fontSize: 9, fontFamily: mono, fontWeight: '700' },

  // ── AI insight
  aiStars: { color: C.yellow, fontSize: 14 },
  insiderTip: { backgroundColor: C.orange + '14', borderRadius: 10, borderWidth: 1, borderColor: C.orange + '44', padding: 12, marginBottom: 8 },
  insiderLabel: { color: C.orange, fontSize: 9, fontFamily: mono, fontWeight: '800', marginBottom: 4 },
  insiderText: { color: C.text, fontSize: 13, lineHeight: 19 },
  aiMeta: { color: C.text3, fontSize: 12, marginBottom: 3 },
  hazardRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, marginTop: 6, backgroundColor: C.yellow + '14', borderRadius: 8, padding: 8 },
  hazardText: { color: C.yellow, fontSize: 12, flex: 1, lineHeight: 17 },
  nearbyItem: { color: C.text3, fontSize: 12, marginBottom: 3 },

  // ── Wikipedia
  wikiItem: { paddingVertical: 10, borderBottomWidth: 1, borderColor: C.s2 },
  wikiItemHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 3 },
  wikiTitle: { color: '#3b82f6', fontSize: 13, fontWeight: '600', flex: 1 },
  wikiDist: { color: C.text3, fontSize: 10, fontFamily: mono },
  wikiExtract: { color: C.text3, fontSize: 11, lineHeight: 16 },

  // ── AI action buttons in panel
  aiActionsRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 14, paddingBottom: 8 },
  aiActionBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    flex: 1, paddingVertical: 8, borderRadius: 10,
    borderWidth: 1, borderColor: C.orange + '55',
    backgroundColor: C.orange + '0f', justifyContent: 'center',
  },
  aiActionText: { color: C.orange, fontSize: 10, fontFamily: mono, fontWeight: '700' },

  // ── Route card (search result card)
  routeCard: {
    padding: 12, borderTopWidth: 1, borderColor: '#3b82f6',
    backgroundColor: 'rgba(8,12,18,0.98)',
  },
  routeCardName: { color: C.text, fontSize: 12, fontWeight: '600', marginBottom: 4, lineHeight: 17 },
  routeCardDist: { color: C.text3, fontSize: 10, fontFamily: mono, marginBottom: 8 },
  routeCardActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  routeCardNav: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5,
    paddingVertical: 9, borderRadius: 10, backgroundColor: '#3b82f6',
  },
  routeCardNavText: { color: '#fff', fontSize: 11, fontFamily: mono, fontWeight: '700' },
  routeCardOpts: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 10, paddingVertical: 9, borderRadius: 10,
    borderWidth: 1, borderColor: C.border,
  },
  routeCardOptsText: { color: C.text2, fontSize: 10, fontFamily: mono },

  // ── Route options sheet
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  routeOptsSheet: {
    backgroundColor: C.s1, borderTopLeftRadius: 20, borderTopRightRadius: 20,
    padding: 20, paddingBottom: 40, borderTopWidth: 1, borderColor: C.border,
  },
  routeOptsTitle: { color: C.text, fontSize: 12, fontFamily: mono, fontWeight: '800', letterSpacing: 1, marginBottom: 16, textAlign: 'center' },
  routeOptRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 13, borderBottomWidth: 1, borderColor: C.border },
  routeOptCheck: { width: 22, height: 22, borderRadius: 6, borderWidth: 1.5, borderColor: C.orange, alignItems: 'center', justifyContent: 'center' },
  routeOptLabel: { color: C.text, fontSize: 14, fontWeight: '600' },
  routeOptSub: { color: C.text3, fontSize: 11, marginTop: 1 },
  routeOptsApply: { marginTop: 16, paddingVertical: 14, borderRadius: 14, backgroundColor: '#3b82f6', alignItems: 'center' },
  routeOptsApplyText: { color: '#fff', fontSize: 13, fontFamily: mono, fontWeight: '800' },

  // ── Offline modal
  offlineSheet: {
    backgroundColor: C.s1, borderTopLeftRadius: 20, borderTopRightRadius: 20,
    padding: 20, paddingBottom: 40, borderTopWidth: 1, borderColor: C.border, maxHeight: '80%',
  },
  offlineTitle: { color: C.text, fontSize: 12, fontFamily: mono, fontWeight: '800', letterSpacing: 1, marginBottom: 6, textAlign: 'center' },
  offlineSub: { color: C.text3, fontSize: 11, textAlign: 'center', marginBottom: 16, lineHeight: 16 },
  offlineSectionLabel: { color: C.text3, fontSize: 9, fontFamily: mono, fontWeight: '700', letterSpacing: 1, marginBottom: 10 },
  stateGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  stateBtn: {
    width: '30%', paddingVertical: 10, borderRadius: 12,
    backgroundColor: C.s2, borderWidth: 1, borderColor: C.border,
    alignItems: 'center',
  },
  stateEmoji: { fontSize: 22, marginBottom: 3 },
  stateName: { color: C.text2, fontSize: 10, fontFamily: mono, textAlign: 'center' },
  offlineRouteBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    paddingVertical: 13, borderRadius: 14, backgroundColor: C.orange,
  },
  offlineRouteBtnText: { color: '#fff', fontSize: 12, fontFamily: mono, fontWeight: '700' },
  offlineNoTrip: { color: C.text3, fontSize: 11, textAlign: 'center', marginTop: 6 },
  offlineProgress: { color: C.text3, fontSize: 10, fontFamily: mono, textAlign: 'center', marginTop: 4 },

  // ── Route brief
  readinessRow: {
    alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderRadius: 60,
    width: 100, height: 100, alignSelf: 'center', marginBottom: 16,
  },
  readinessScore: { color: C.text, fontSize: 32, fontWeight: '800', fontFamily: mono },
  readinessLabel: { color: C.text3, fontSize: 9, fontFamily: mono },
  briefSummary: { color: C.text2, fontSize: 14, lineHeight: 21, marginBottom: 20 },
  briefItem: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: 8 },
  briefItemText: { color: C.text2, fontSize: 13, flex: 1, lineHeight: 18 },
  briefStats: { flexDirection: 'row', gap: 16, justifyContent: 'center', marginTop: 8 },
  briefStat: { alignItems: 'center', paddingHorizontal: 20, paddingVertical: 14, backgroundColor: C.s2, borderRadius: 14, flex: 1 },
  briefStatVal: { color: C.text, fontSize: 28, fontWeight: '800', fontFamily: mono },
  briefStatLabel: { color: C.text3, fontSize: 10, fontFamily: mono },
  packDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: C.orange, marginTop: 6 },
});
