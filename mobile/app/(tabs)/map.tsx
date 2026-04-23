import { useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from 'react-native';
import MapView, { Marker, Polyline, Callout, PROVIDER_DEFAULT } from 'react-native-maps';
import * as Location from 'expo-location';
import { Ionicons } from '@expo/vector-icons';
import { useStore } from '@/lib/store';
import { api, Report, Pin } from '@/lib/api';
import { C, mono } from '@/lib/design';

export default function MapScreen() {
  const activeTrip = useStore(s => s.activeTrip);
  const mapRef = useRef<MapView>(null);
  const [userLoc, setUserLoc] = useState<{ lat: number; lng: number } | null>(null);
  const [showPanel, setShowPanel] = useState(true);
  const [routeAlerts, setRouteAlerts] = useState<Report[]>([]);
  const [showAlerts, setShowAlerts] = useState(false);
  const [communityPins, setCommunityPins] = useState<Pin[]>([]);

  useEffect(() => {
    Location.requestForegroundPermissionsAsync().then(({ status }) => {
      if (status !== 'granted') return;
      Location.getCurrentPositionAsync({}).then(loc => {
        setUserLoc({ lat: loc.coords.latitude, lng: loc.coords.longitude });
      });
    });
  }, []);

  useEffect(() => {
    if (!activeTrip || !mapRef.current) return;
    const wps = activeTrip.plan.waypoints.filter(w => w.lat && w.lng);
    if (!wps.length) return;
    mapRef.current.fitToCoordinates(
      wps.map(w => ({ latitude: w.lat!, longitude: w.lng! })),
      { edgePadding: { top: 60, right: 40, bottom: 200, left: 40 }, animated: true }
    );
    const center = wps[Math.floor(wps.length / 2)];
    if (center.lat && center.lng) {
      api.getNearbyPins(center.lat!, center.lng!, 3.0).then(setCommunityPins).catch(() => {});
    }
    api.getReportsAlongRoute(wps).then(alerts => {
      setRouteAlerts(alerts);
      if (alerts.some(a => a.severity === 'critical' || a.severity === 'high')) setShowAlerts(true);
    }).catch(() => {});
  }, [activeTrip]);

  const defaultRegion = {
    latitude: userLoc?.lat ?? 39.5,
    longitude: userLoc?.lng ?? -111.0,
    latitudeDelta: 8, longitudeDelta: 8,
  };

  const waypoints = (activeTrip?.plan.waypoints ?? []).filter(w => w.lat && w.lng);
  const campsites = (activeTrip?.campsites ?? []).filter(c => c.lat && c.lng);
  const gas = (activeTrip?.gas_stations ?? []).filter(g => g.lat && g.lng);
  const routeCoords = waypoints.map(w => ({ latitude: w.lat!, longitude: w.lng! }));

  return (
    <View style={s.container}>
      <MapView
        ref={mapRef}
        style={s.map}
        provider={PROVIDER_DEFAULT}
        mapType="satellite"
        initialRegion={defaultRegion}
        showsUserLocation
        showsMyLocationButton={false}
        showsCompass={false}
      >
        {routeCoords.length >= 2 && (
          <Polyline coordinates={routeCoords} strokeColor={C.orange} strokeWidth={3} lineDashPattern={[1]} />
        )}

        {waypoints.map((wp, i) => (
          <Marker key={`wp-${i}`} coordinate={{ latitude: wp.lat!, longitude: wp.lng! }}>
            <View style={m.wpMarker}>
              <Text style={m.wpMarkerText}>{wp.day}</Text>
            </View>
            <Callout>
              <View style={s.callout}>
                <Text style={s.calloutTitle}>{wp.name}</Text>
                <Text style={s.calloutMeta}>Day {wp.day} · {wp.type}</Text>
                {wp.description && <Text style={s.calloutDesc} numberOfLines={2}>{wp.description}</Text>}
              </View>
            </Callout>
          </Marker>
        ))}

        {campsites.slice(0, 30).map((c, i) => (
          <Marker key={`camp-${i}`} coordinate={{ latitude: c.lat, longitude: c.lng }}>
            <View style={m.campMarker}><Text style={m.markerEmoji}>⛺</Text></View>
            <Callout>
              <View style={s.callout}>
                <Text style={s.calloutTitle}>{c.name}</Text>
                <Text style={s.calloutMeta}>{c.reservable ? 'Reservable' : 'First-come'}</Text>
              </View>
            </Callout>
          </Marker>
        ))}

        {communityPins.slice(0, 30).map((p, i) => (
          <Marker key={`pin-${i}`} coordinate={{ latitude: p.lat, longitude: p.lng }}>
            <View style={m.pinMarker}><Text style={m.markerEmoji}>📍</Text></View>
            <Callout>
              <View style={s.callout}>
                <Text style={s.calloutTitle}>{p.name}</Text>
                <Text style={s.calloutMeta}>{p.type} · {p.land_type}</Text>
                {p.description ? <Text style={s.calloutDesc} numberOfLines={2}>{p.description}</Text> : null}
              </View>
            </Callout>
          </Marker>
        ))}

        {gas.slice(0, 20).map((g, i) => (
          <Marker key={`gas-${i}`} coordinate={{ latitude: g.lat, longitude: g.lng }}>
            <View style={m.gasMarker}><Text style={m.markerEmoji}>⛽</Text></View>
            <Callout>
              <View style={s.callout}>
                <Text style={s.calloutTitle}>{g.name}</Text>
                <Text style={s.calloutMeta}>Fuel · {g.fuel_types}</Text>
              </View>
            </Callout>
          </Marker>
        ))}
      </MapView>

      {/* Trip name bar */}
      <View style={s.topBar}>
        <View style={s.topBarDot} />
        <Text style={s.topBarText} numberOfLines={1}>
          {activeTrip ? activeTrip.plan.trip_name.toUpperCase() : 'NO ACTIVE TRIP'}
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
          if (userLoc) mapRef.current?.animateToRegion({
            latitude: userLoc.lat, longitude: userLoc.lng,
            latitudeDelta: 0.1, longitudeDelta: 0.1,
          });
        }}>
          <Ionicons name="locate" size={22} color={C.text} />
        </TouchableOpacity>
        <TouchableOpacity style={s.ctrlBtn} onPress={() => setShowPanel(p => !p)}>
          <Ionicons name={showPanel ? 'chevron-down' : 'chevron-up'} size={20} color={C.text} />
        </TouchableOpacity>
      </View>

      {/* Route alerts */}
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
                  <Text style={s.alertBadge}>{r.type.replace('_',' ').toUpperCase()}</Text>
                  {(r.severity === 'critical' || r.severity === 'high') && (
                    <Text style={[s.alertSev, r.severity === 'critical' ? { color: C.red } : { color: C.yellow }]}>
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

      {/* Bottom itinerary panel */}
      {showPanel && activeTrip && (
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
          <View style={s.legend}>
            {[
              [C.orange,  '⬤', 'Waypoint'],
              [C.green,   '⛺', 'Campsite'],
              [C.yellow,  '⛽', 'Fuel'],
              [C.purple,  '📍', 'Community'],
            ].map(([color, dot, label]) => (
              <View key={label as string} style={s.legendItem}>
                <Text style={[s.legendDot, { color: color as string }]}>{dot}</Text>
                <Text style={s.legendText}>{label as string}</Text>
              </View>
            ))}
          </View>
        </View>
      )}
    </View>
  );
}

const m = StyleSheet.create({
  wpMarker: {
    width: 30, height: 30, borderRadius: 15,
    backgroundColor: C.orange, alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: '#fff',
  },
  wpMarkerText: { color: '#fff', fontSize: 12, fontWeight: '800', fontFamily: mono },
  campMarker: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: C.green + '33', alignItems: 'center', justifyContent: 'center',
    borderWidth: 1.5, borderColor: C.green,
  },
  gasMarker: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: C.yellow + '33', alignItems: 'center', justifyContent: 'center',
    borderWidth: 1.5, borderColor: C.yellow,
  },
  pinMarker: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: C.purple + '33', alignItems: 'center', justifyContent: 'center',
    borderWidth: 1.5, borderColor: C.purple,
  },
  markerEmoji: { fontSize: 16 },
});

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  map: { flex: 1 },
  topBar: {
    position: 'absolute', top: 56, left: 16, right: 16,
    backgroundColor: 'rgba(8,12,18,0.88)', borderRadius: 20,
    paddingVertical: 7, paddingHorizontal: 14,
    borderWidth: 1, borderColor: C.border,
    flexDirection: 'row', alignItems: 'center', gap: 8,
  },
  topBarDot: {
    width: 6, height: 6, borderRadius: 3, backgroundColor: C.orange,
  },
  topBarText: { color: C.text, fontSize: 11, fontFamily: mono, flex: 1, letterSpacing: 0.5 },
  alertPill: {
    backgroundColor: C.red + '22', borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3,
    borderWidth: 1, borderColor: C.red,
  },
  alertPillText: { color: C.red, fontSize: 10, fontFamily: mono, fontWeight: '700' },
  controls: {
    position: 'absolute', top: 106, right: 16, gap: 8,
  },
  ctrlBtn: {
    width: 44, height: 44, borderRadius: 14,
    backgroundColor: 'rgba(8,12,18,0.9)', borderWidth: 1, borderColor: C.border,
    alignItems: 'center', justifyContent: 'center',
  },
  alertPanel: {
    position: 'absolute', top: 106, left: 16, right: 70,
    backgroundColor: 'rgba(8,12,18,0.96)', borderRadius: 14,
    borderWidth: 1, borderColor: C.red, maxHeight: 220,
  },
  alertHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 12, paddingVertical: 9,
    borderBottomWidth: 1, borderColor: C.border,
  },
  alertTitle: { color: C.red, fontSize: 11, fontFamily: mono, fontWeight: '700', flex: 1 },
  alertScroll: { maxHeight: 160 },
  alertItem: {
    paddingHorizontal: 12, paddingVertical: 8,
    borderBottomWidth: 1, borderColor: C.s2,
  },
  alertCritical: { borderLeftWidth: 3, borderLeftColor: C.red },
  alertRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 2 },
  alertBadge: { color: C.text, fontSize: 10, fontFamily: mono },
  alertSev: { fontSize: 9, fontFamily: mono, fontWeight: '700' },
  alertDesc: { color: C.text3, fontSize: 11 },
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
  legend: { flexDirection: 'row', gap: 14, paddingHorizontal: 14, paddingBottom: 4 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  legendDot: { fontSize: 10 },
  legendText: { color: C.text3, fontSize: 10 },
  callout: { width: 180, padding: 4 },
  calloutTitle: { fontWeight: '600', fontSize: 13, marginBottom: 2 },
  calloutMeta: { color: '#64748b', fontSize: 11, marginBottom: 4 },
  calloutDesc: { color: '#374151', fontSize: 11 },
});
