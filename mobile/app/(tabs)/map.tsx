import { useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, Linking, Animated } from 'react-native';
import { WebView } from 'react-native-webview';
import * as Location from 'expo-location';
import { Ionicons } from '@expo/vector-icons';
import { useStore } from '@/lib/store';
import { api, Report, Pin } from '@/lib/api';
import { C, mono } from '@/lib/design';

type WP = { lat: number; lng: number; name: string; day: number; type: string };

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

const buildMapHtml = (
  centerLat: number, centerLng: number,
  waypoints: WP[],
  campsites: { lat: number; lng: number; name: string }[],
  gasList: { lat: number; lng: number; name: string }[],
  pins: { lat: number; lng: number; name: string; type: string }[],
  userLat: number | null, userLng: number | null,
) => {
  const zoom = waypoints.length > 1 ? 7 : 10;
  return `<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0">
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<style>
  body,html{margin:0;padding:0;height:100%;background:#080c12;}
  #map{height:100vh;width:100vw;}
  .wp-marker{background:#f97316;border:2px solid #fff;border-radius:50%;
    width:30px;height:30px;display:flex;align-items:center;justify-content:center;
    color:#fff;font-weight:800;font-size:12px;font-family:monospace;
    box-shadow:0 2px 8px rgba(249,115,22,0.5);}
  .wp-marker.nav-target{background:#fff;color:#f97316;
    box-shadow:0 0 0 4px rgba(249,115,22,0.4),0 2px 8px rgba(0,0,0,0.5);
    animation:pulse 1.5s ease-in-out infinite;}
  @keyframes pulse{0%,100%{box-shadow:0 0 0 4px rgba(249,115,22,0.4);}
    50%{box-shadow:0 0 0 8px rgba(249,115,22,0.15);}}
  .camp-marker{background:rgba(34,197,94,0.15);border:1.5px solid #22c55e;
    border-radius:50%;width:28px;height:28px;display:flex;align-items:center;justify-content:center;font-size:14px;}
  .gas-marker{background:rgba(234,179,8,0.15);border:1.5px solid #eab308;
    border-radius:50%;width:28px;height:28px;display:flex;align-items:center;justify-content:center;font-size:14px;}
  .pin-marker{background:rgba(168,85,247,0.15);border:1.5px solid #a855f7;
    border-radius:50%;width:28px;height:28px;display:flex;align-items:center;justify-content:center;font-size:14px;}
  .user-dot{background:#f97316;border:3px solid #fff;border-radius:50%;
    width:16px;height:16px;box-shadow:0 0 0 4px rgba(249,115,22,0.25);}
  .leaflet-popup-content-wrapper{background:#0f1319;border:1px solid #252d3d;
    color:#f1f5f9;border-radius:10px;}
  .leaflet-popup-tip{background:#0f1319;}
  .popup-title{font-weight:700;font-size:13px;margin-bottom:3px;}
  .popup-meta{color:#4b5563;font-size:11px;font-family:monospace;}
</style>
</head>
<body>
<div id="map"></div>
<script>
  var map = L.map('map',{zoomControl:false,attributionControl:false})
    .setView([${centerLat},${centerLng}],${zoom});
  L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',{maxZoom:19}).addTo(map);

  var wps=${JSON.stringify(waypoints)};
  var camps=${JSON.stringify(campsites.slice(0,30))};
  var gas=${JSON.stringify(gasList.slice(0,20))};
  var pins=${JSON.stringify(pins.slice(0,30))};
  var userMarker=null;
  var wpMarkers=[];
  var currentNavIdx=-1;

  if(wps.length>=2){
    L.polyline(wps.map(function(w){return[w.lat,w.lng];}),
      {color:'#f97316',weight:3,dashArray:'6,4',opacity:0.85}).addTo(map);
  }

  wps.forEach(function(w,i){
    var el=document.createElement('div');
    el.className='wp-marker';
    el.textContent=w.day||i+1;
    var icon=L.divIcon({className:'',html:el.outerHTML,iconSize:[30,30],iconAnchor:[15,15]});
    var m=L.marker([w.lat,w.lng],{icon:icon}).addTo(map)
      .bindPopup('<div class="popup-title">'+w.name+'</div><div class="popup-meta">Day '+w.day+' · '+w.type+'</div>');
    wpMarkers.push({marker:m,wp:w,idx:i});
  });

  camps.forEach(function(c){
    var icon=L.divIcon({className:'',html:'<div class="camp-marker">⛺</div>',iconSize:[28,28],iconAnchor:[14,14]});
    L.marker([c.lat,c.lng],{icon:icon}).addTo(map)
      .bindPopup('<div class="popup-title">'+c.name+'</div><div class="popup-meta">Campsite</div>');
  });
  gas.forEach(function(g){
    var icon=L.divIcon({className:'',html:'<div class="gas-marker">⛽</div>',iconSize:[28,28],iconAnchor:[14,14]});
    L.marker([g.lat,g.lng],{icon:icon}).addTo(map)
      .bindPopup('<div class="popup-title">'+g.name+'</div><div class="popup-meta">Fuel</div>');
  });
  pins.forEach(function(p){
    var icon=L.divIcon({className:'',html:'<div class="pin-marker">📍</div>',iconSize:[28,28],iconAnchor:[14,14]});
    L.marker([p.lat,p.lng],{icon:icon}).addTo(map)
      .bindPopup('<div class="popup-title">'+p.name+'</div><div class="popup-meta">'+p.type+'</div>');
  });

  function setUserPos(lat,lng){
    var icon=L.divIcon({className:'',html:'<div class="user-dot"></div>',iconSize:[16,16],iconAnchor:[8,8]});
    if(userMarker){userMarker.setLatLng([lat,lng]);}
    else{userMarker=L.marker([lat,lng],{icon:icon,zIndexOffset:2000}).addTo(map);}
  }

  function setNavTarget(idx){
    wpMarkers.forEach(function(m){
      var el=document.createElement('div');
      el.className='wp-marker'+(m.idx===idx?' nav-target':'');
      el.textContent=m.wp.day||m.idx+1;
      m.marker.setIcon(L.divIcon({className:'',html:el.outerHTML,iconSize:[30,30],iconAnchor:[15,15]}));
    });
    currentNavIdx=idx;
  }

  var uLat=${userLat ?? 'null'}, uLng=${userLng ?? 'null'};
  if(uLat!==null) setUserPos(uLat,uLng);

  if(wps.length>=2){
    var grp=new L.featureGroup(wps.map(function(w){return L.marker([w.lat,w.lng]);}));
    map.fitBounds(grp.getBounds().pad(0.15));
  }

  document.addEventListener('message',function(e){
    try{
      var msg=JSON.parse(e.data);
      if(msg.type==='user_pos'&&msg.lat){setUserPos(msg.lat,msg.lng);}
      if(msg.type==='nav_center'&&msg.lat){setUserPos(msg.lat,msg.lng);map.setView([msg.lat,msg.lng],14);}
      if(msg.type==='locate'&&msg.lat){setUserPos(msg.lat,msg.lng);map.setView([msg.lat,msg.lng],13);}
      if(msg.type==='nav_target'){setNavTarget(msg.idx);}
      if(msg.type==='nav_reset'){setNavTarget(-1);}
    }catch(err){}
  });
</script>
</body>
</html>`;
};

export default function MapScreen() {
  const activeTrip = useStore(s => s.activeTrip);
  const webRef = useRef<WebView>(null);
  const [userLoc, setUserLoc] = useState<{ lat: number; lng: number } | null>(null);
  const [userSpeed, setUserSpeed] = useState<number | null>(null);
  const [navMode, setNavMode] = useState(false);
  const [navIdx, setNavIdx] = useState(0);
  const [showPanel, setShowPanel] = useState(true);
  const [routeAlerts, setRouteAlerts] = useState<Report[]>([]);
  const [showAlerts, setShowAlerts] = useState(false);
  const [communityPins, setCommunityPins] = useState<Pin[]>([]);
  const navAnim = useRef(new Animated.Value(0)).current;

  // Refs so the location watch callback can read current nav state without stale closure
  const navRef = useRef({ active: false, idx: 0, wps: [] as WP[] });
  useEffect(() => { navRef.current.active = navMode; }, [navMode]);
  useEffect(() => { navRef.current.idx = navIdx; }, [navIdx]);

  const waypoints: WP[] = (activeTrip?.plan.waypoints ?? [])
    .filter(w => w.lat && w.lng)
    .map(w => ({ lat: w.lat!, lng: w.lng!, name: w.name, day: w.day, type: w.type }));

  useEffect(() => { navRef.current.wps = waypoints; }, [activeTrip]);

  // Continuous location watch
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

          if (active && wps[idx]) {
            const dist = haversineKm(pos.lat, pos.lng, wps[idx].lat, wps[idx].lng);
            if (dist < 0.25 && idx < wps.length - 1) {
              const next = idx + 1;
              setNavIdx(next);
              navRef.current.idx = next;
              webRef.current?.postMessage(JSON.stringify({ type: 'nav_target', idx: next }));
            }
          }
        }
      ).then(s => { sub = s; });
    });
    return () => { sub?.remove(); };
  }, []);

  // Fetch route data when trip changes
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
    setNavIdx(0);
    setNavMode(false);
  }, [activeTrip]);

  // Animate nav HUD in/out
  useEffect(() => {
    Animated.spring(navAnim, {
      toValue: navMode ? 1 : 0,
      tension: 80, friction: 10, useNativeDriver: true,
    }).start();
    if (navMode) {
      setShowPanel(false);
      webRef.current?.postMessage(JSON.stringify({ type: 'nav_target', idx: navIdx }));
    } else {
      webRef.current?.postMessage(JSON.stringify({ type: 'nav_reset' }));
    }
  }, [navMode]);

  const campsites = (activeTrip?.campsites ?? []).filter(c => c.lat && c.lng).map(c => ({ lat: c.lat, lng: c.lng, name: c.name }));
  const gas = (activeTrip?.gas_stations ?? []).filter(g => g.lat && g.lng).map(g => ({ lat: g.lat, lng: g.lng, name: g.name }));
  const centerLat = userLoc?.lat ?? waypoints[0]?.lat ?? 39.5;
  const centerLng = userLoc?.lng ?? waypoints[0]?.lng ?? -111.0;

  const mapHtml = buildMapHtml(
    centerLat, centerLng, waypoints, campsites, gas,
    communityPins.map(p => ({ lat: p.lat, lng: p.lng, name: p.name, type: p.type })),
    userLoc?.lat ?? null, userLoc?.lng ?? null,
  );

  // Nav HUD computed values
  const navTarget = navMode && waypoints[navIdx] ? waypoints[navIdx] : null;
  const distKm = userLoc && navTarget ? haversineKm(userLoc.lat, userLoc.lng, navTarget.lat, navTarget.lng) : null;
  const bearing = userLoc && navTarget ? calcBearing(userLoc.lat, userLoc.lng, navTarget.lat, navTarget.lng) : null;
  const speedMph = userSpeed !== null && userSpeed > 0 ? userSpeed * 2.237 : null;
  const etaMins = distKm && userSpeed && userSpeed > 0.5
    ? Math.round(distKm / (userSpeed * 3.6) * 60) : null;

  function startNav() {
    if (!waypoints.length) return;
    setNavIdx(0);
    navRef.current.idx = 0;
    setNavMode(true);
  }

  function openInMaps() {
    if (waypoints.length < 1) return;
    const origin = `${waypoints[0].lat},${waypoints[0].lng}`;
    const dest = `${waypoints[waypoints.length - 1].lat},${waypoints[waypoints.length - 1].lng}`;
    const mids = waypoints.slice(1, -1).slice(0, 8).map(w => `${w.lat},${w.lng}`).join('|');
    const url = `https://www.google.com/maps/dir/?api=1&origin=${origin}&destination=${dest}${mids ? `&waypoints=${encodeURIComponent(mids)}` : ''}&travelmode=driving`;
    Linking.openURL(url).catch(() => {
      Linking.openURL(`maps://?saddr=${origin}&daddr=${dest}`).catch(() => {});
    });
  }

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
      />

      {/* Trip name bar */}
      <View style={s.topBar}>
        <View style={[s.topBarDot, navMode && { backgroundColor: C.green }]} />
        <Text style={s.topBarText} numberOfLines={1}>
          {navMode
            ? `NAVIGATING · STOP ${navIdx + 1} OF ${waypoints.length}`
            : activeTrip ? activeTrip.plan.trip_name.toUpperCase() : 'NO ACTIVE TRIP'
          }
        </Text>
        {routeAlerts.length > 0 && (
          <TouchableOpacity style={s.alertPill} onPress={() => setShowAlerts(v => !v)}>
            <Text style={s.alertPillText}>⚠ {routeAlerts.length}</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Map controls */}
      <View style={s.controls}>
        <TouchableOpacity style={s.ctrlBtn} onPress={() => {
          if (userLoc) webRef.current?.postMessage(JSON.stringify({ type: 'locate', lat: userLoc.lat, lng: userLoc.lng }));
        }}>
          <Ionicons name="locate" size={22} color={C.text} />
        </TouchableOpacity>
        {waypoints.length > 0 && (
          <TouchableOpacity
            style={[s.ctrlBtn, navMode && { backgroundColor: C.green + 'cc', borderColor: C.green }]}
            onPress={() => navMode ? setNavMode(false) : startNav()}
          >
            <Ionicons name="navigate" size={20} color={navMode ? '#fff' : C.text} />
          </TouchableOpacity>
        )}
        <TouchableOpacity style={s.ctrlBtn} onPress={() => setShowPanel(p => !p)}>
          <Ionicons name={showPanel ? 'chevron-down' : 'chevron-up'} size={20} color={C.text} />
        </TouchableOpacity>
      </View>

      {/* Route alerts panel */}
      {showAlerts && routeAlerts.length > 0 && (
        <View style={s.alertPanel}>
          <View style={s.alertHeader}>
            <Ionicons name="warning" size={15} color={C.red} />
            <Text style={s.alertTitle}>ROUTE ALERTS ({routeAlerts.length})</Text>
            <TouchableOpacity onPress={() => setShowAlerts(false)}>
              <Ionicons name="close" size={16} color={C.text3} />
            </TouchableOpacity>
          </View>
          <ScrollView style={s.alertScroll} showsVerticalScrollIndicator={false}>
            {routeAlerts.map(r => (
              <View key={r.id} style={[s.alertItem, r.severity === 'critical' && s.alertCritical]}>
                <View style={s.alertRow}>
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

      {/* Navigation HUD */}
      <Animated.View style={[s.navHud, {
        opacity: navAnim,
        transform: [{ translateY: navAnim.interpolate({ inputRange: [0, 1], outputRange: [120, 0] }) }],
        pointerEvents: navMode ? 'box-none' : 'none',
      }]}>
        {/* Bearing + speed strip */}
        <View style={s.navStrip}>
          {bearing !== null ? (
            <View style={s.navBearing}>
              <Animated.View style={{ transform: [{ rotate: `${bearing}deg` }] }}>
                <Ionicons name="navigate" size={20} color={C.orange} />
              </Animated.View>
              <Text style={s.navBearingText}>{compassDir(bearing ?? 0)}</Text>
            </View>
          ) : (
            <View style={s.navBearing}>
              <Ionicons name="navigate-outline" size={20} color={C.text3} />
              <Text style={s.navBearingText}>--</Text>
            </View>
          )}
          <View style={s.navDistBlock}>
            <Text style={s.navDistVal}>{distKm !== null ? formatDist(distKm) : '--'}</Text>
            {etaMins !== null && <Text style={s.navEta}>{etaMins < 60 ? `${etaMins} min` : `${Math.floor(etaMins/60)}h ${etaMins%60}m`}</Text>}
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
              <Text style={s.navTargetBadgeText}>NEXT</Text>
            </View>
            <View style={s.navTargetInfo}>
              <Text style={s.navTargetName} numberOfLines={1}>{navTarget.name}</Text>
              <Text style={s.navTargetMeta}>Day {navTarget.day} · {navTarget.type} · {navIdx + 1}/{waypoints.length}</Text>
            </View>
          </View>
        )}

        {/* Nav actions */}
        <View style={s.navActions}>
          <TouchableOpacity style={s.navEndBtn} onPress={() => setNavMode(false)}>
            <Ionicons name="close" size={15} color={C.red} />
            <Text style={s.navEndText}>END NAV</Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.navMapsBtn} onPress={openInMaps}>
            <Ionicons name="open-outline" size={15} color={C.text} />
            <Text style={s.navMapsBtnText}>OPEN IN MAPS</Text>
          </TouchableOpacity>
        </View>
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
            {[[C.orange,'⬤','Waypoint'],[C.green,'⛺','Camp'],[C.yellow,'⛽','Fuel'],['#a855f7','📍','Community']]
              .map(([color, dot, label]) => (
                <View key={label as string} style={s.legendItem}>
                  <Text style={[s.legendDot, { color: color as string }]}>{dot}</Text>
                  <Text style={s.legendText}>{label as string}</Text>
                </View>
              ))}
            <TouchableOpacity style={s.mapsBtn} onPress={openInMaps}>
              <Ionicons name="open-outline" size={11} color={C.text3} />
              <Text style={s.mapsBtnText}>MAPS</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  map: { flex: 1 },

  topBar: {
    position: 'absolute', top: 56, left: 16, right: 16,
    backgroundColor: 'rgba(8,12,18,0.9)', borderRadius: 20,
    paddingVertical: 8, paddingHorizontal: 14,
    borderWidth: 1, borderColor: C.border,
    flexDirection: 'row', alignItems: 'center', gap: 8,
  },
  topBarDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: C.orange },
  topBarText: { color: C.text, fontSize: 11, fontFamily: mono, flex: 1, letterSpacing: 0.5 },
  alertPill: {
    backgroundColor: C.red + '22', borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3,
    borderWidth: 1, borderColor: C.red,
  },
  alertPillText: { color: C.red, fontSize: 10, fontFamily: mono, fontWeight: '700' },

  controls: { position: 'absolute', top: 106, right: 16, gap: 8 },
  ctrlBtn: {
    width: 44, height: 44, borderRadius: 14,
    backgroundColor: 'rgba(8,12,18,0.9)', borderWidth: 1, borderColor: C.border,
    alignItems: 'center', justifyContent: 'center',
  },

  alertPanel: {
    position: 'absolute', top: 106, left: 16, right: 70,
    backgroundColor: 'rgba(8,12,18,0.97)', borderRadius: 14,
    borderWidth: 1, borderColor: C.red, maxHeight: 220,
  },
  alertHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 12, paddingVertical: 9,
    borderBottomWidth: 1, borderColor: C.border,
  },
  alertTitle: { color: C.red, fontSize: 11, fontFamily: mono, fontWeight: '700', flex: 1 },
  alertScroll: { maxHeight: 160 },
  alertItem: { paddingHorizontal: 12, paddingVertical: 8, borderBottomWidth: 1, borderColor: C.s2 },
  alertCritical: { borderLeftWidth: 3, borderLeftColor: C.red },
  alertRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 2 },
  alertBadge: { color: C.text, fontSize: 10, fontFamily: mono },
  alertSev: { fontSize: 9, fontFamily: mono, fontWeight: '700' },
  alertDesc: { color: C.text3, fontSize: 11 },

  // Navigation HUD
  navHud: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    backgroundColor: 'rgba(8,12,18,0.97)',
    borderTopWidth: 1, borderColor: C.orange + '40',
  },
  navStrip: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: 1, borderColor: C.border,
    gap: 12,
  },
  navBearing: { flexDirection: 'row', alignItems: 'center', gap: 6, width: 56 },
  navBearingText: { color: C.orange, fontSize: 13, fontFamily: mono, fontWeight: '700' },
  navDistBlock: { flex: 1, alignItems: 'center' },
  navDistVal: { color: C.text, fontSize: 26, fontWeight: '800', fontFamily: mono },
  navEta: { color: C.text3, fontSize: 10, fontFamily: mono, marginTop: 1 },
  navSpeedBlock: { alignItems: 'center', width: 52 },
  navSpeedVal: { color: C.text2, fontSize: 22, fontWeight: '700', fontFamily: mono },
  navSpeedUnit: { color: C.text3, fontSize: 8, fontFamily: mono, letterSpacing: 0.5 },

  navTarget: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 16, paddingVertical: 11,
    borderBottomWidth: 1, borderColor: C.border,
  },
  navTargetBadge: {
    backgroundColor: C.orangeGlow, borderRadius: 6, borderWidth: 1, borderColor: C.orange,
    paddingHorizontal: 7, paddingVertical: 3,
  },
  navTargetBadgeText: { color: C.orange, fontSize: 9, fontFamily: mono, fontWeight: '700' },
  navTargetInfo: { flex: 1 },
  navTargetName: { color: C.text, fontSize: 14, fontWeight: '700' },
  navTargetMeta: { color: C.text3, fontSize: 10, fontFamily: mono, marginTop: 2 },

  navActions: {
    flexDirection: 'row', gap: 8,
    paddingHorizontal: 16, paddingVertical: 12, paddingBottom: 28,
  },
  navEndBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 16, paddingVertical: 11,
    borderRadius: 12, borderWidth: 1, borderColor: C.red + '60',
    backgroundColor: C.red + '14',
  },
  navEndText: { color: C.red, fontSize: 11, fontFamily: mono, fontWeight: '700' },
  navMapsBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 11, borderRadius: 12,
    backgroundColor: C.orange, shadowColor: C.orange,
    shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.35, shadowRadius: 8,
  },
  navMapsBtnText: { color: '#fff', fontSize: 12, fontFamily: mono, fontWeight: '700' },

  // Bottom panel
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
  legendRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingBottom: 4 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  legendDot: { fontSize: 10 },
  legendText: { color: C.text3, fontSize: 10 },
  mapsBtn: {
    marginLeft: 'auto', flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 8, paddingVertical: 4,
    borderRadius: 8, borderWidth: 1, borderColor: C.border,
  },
  mapsBtnText: { color: C.text3, fontSize: 9, fontFamily: mono },
});
