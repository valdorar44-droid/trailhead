import { useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Platform, ScrollView, Alert } from 'react-native';
import MapView, { Marker, Polyline, Callout, PROVIDER_DEFAULT } from 'react-native-maps';
import * as Location from 'expo-location';
import { Ionicons } from '@expo/vector-icons';
import { useStore } from '@/lib/store';
import { api, Waypoint, Campsite, GasStation, Report, Pin } from '@/lib/api';

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
    // Fetch community pins near trip center
    const center = wps[Math.floor(wps.length / 2)];
    if (center.lat && center.lng) {
      api.getNearbyPins(center.lat!, center.lng!, 3.0)
        .then(pins => setCommunityPins(pins))
        .catch(() => {});
    }

    // Fetch reports along the route
    api.getReportsAlongRoute(wps).then(alerts => {
      setRouteAlerts(alerts);
      const critical = alerts.filter(a => a.severity === 'critical' || a.severity === 'high');
      if (critical.length > 0) {
        setShowAlerts(true);
      }
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
        showsCompass
      >
        {/* Route line */}
        {routeCoords.length >= 2 && (
          <Polyline coordinates={routeCoords} strokeColor="#e67e22" strokeWidth={3} lineDashPattern={[1]} />
        )}

        {/* Waypoint markers */}
        {waypoints.map((wp, i) => (
          <Marker key={`wp-${i}`} coordinate={{ latitude: wp.lat!, longitude: wp.lng! }}
            pinColor="#e67e22">
            <Callout>
              <View style={s.callout}>
                <Text style={s.calloutTitle}>{wp.name}</Text>
                <Text style={s.calloutMeta}>Day {wp.day} · {wp.type}</Text>
                {wp.description && <Text style={s.calloutDesc} numberOfLines={2}>{wp.description}</Text>}
              </View>
            </Callout>
          </Marker>
        ))}

        {/* Campsite markers */}
        {campsites.slice(0, 30).map((c, i) => (
          <Marker key={`camp-${i}`} coordinate={{ latitude: c.lat, longitude: c.lng }}
            pinColor="#27ae60">
            <Callout>
              <View style={s.callout}>
                <Text style={s.calloutTitle}>{c.name}</Text>
                <Text style={s.calloutMeta}>Federal Campsite · {c.reservable ? 'Reservable' : 'First-come'}</Text>
              </View>
            </Callout>
          </Marker>
        ))}

        {/* Community pin markers */}
        {communityPins.slice(0, 30).map((p, i) => (
          <Marker key={`pin-${i}`} coordinate={{ latitude: p.lat, longitude: p.lng }}
            pinColor="#a855f7">
            <Callout>
              <View style={s.callout}>
                <Text style={s.calloutTitle}>{p.name}</Text>
                <Text style={s.calloutMeta}>Community · {p.type} · {p.land_type}</Text>
                {p.description ? <Text style={s.calloutDesc} numberOfLines={2}>{p.description}</Text> : null}
              </View>
            </Callout>
          </Marker>
        ))}

        {/* Gas markers */}
        {gas.slice(0, 20).map((g, i) => (
          <Marker key={`gas-${i}`} coordinate={{ latitude: g.lat, longitude: g.lng }}
            pinColor="#f59e0b">
            <Callout>
              <View style={s.callout}>
                <Text style={s.calloutTitle}>{g.name}</Text>
                <Text style={s.calloutMeta}>Fuel · {g.fuel_types}</Text>
              </View>
            </Callout>
          </Marker>
        ))}
      </MapView>

      {/* Top status bar */}
      <View style={s.topBar}>
        <Text style={s.topBarText}>
          {activeTrip ? activeTrip.plan.trip_name.toUpperCase() : 'NO ACTIVE TRIP'}
        </Text>
      </View>

      {/* My location button */}
      <TouchableOpacity style={s.locBtn} onPress={() => {
        if (userLoc) mapRef.current?.animateToRegion({ latitude: userLoc.lat, longitude: userLoc.lng, latitudeDelta: 0.1, longitudeDelta: 0.1 });
      }}>
        <Ionicons name="locate" size={22} color="#e2e8f0" />
      </TouchableOpacity>

      {/* Toggle panel */}
      <TouchableOpacity style={s.panelToggle} onPress={() => setShowPanel(p => !p)}>
        <Ionicons name={showPanel ? 'chevron-down' : 'chevron-up'} size={18} color="#e2e8f0" />
      </TouchableOpacity>

      {/* Route alerts panel */}
      {showAlerts && routeAlerts.length > 0 && (
        <View style={s.alertPanel}>
          <View style={s.alertHeader}>
            <Ionicons name="warning" size={16} color="#ef4444" />
            <Text style={s.alertTitle}>ROUTE ALERTS ({routeAlerts.length})</Text>
            <TouchableOpacity onPress={() => setShowAlerts(false)}>
              <Ionicons name="close" size={16} color="#64748b" />
            </TouchableOpacity>
          </View>
          <ScrollView style={s.alertScroll} showsVerticalScrollIndicator={false}>
            {routeAlerts.map(r => (
              <View key={r.id} style={[s.alertItem, r.severity === 'critical' && s.alertCritical]}>
                <View style={s.alertItemRow}>
                  <Text style={s.alertBadge}>{r.type.toUpperCase()}</Text>
                  {r.severity === 'critical' && <Text style={s.alertSev}>CRITICAL</Text>}
                  {r.severity === 'high' && <Text style={[s.alertSev, { color: '#f59e0b' }]}>HIGH</Text>}
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
                <View style={s.dayNum}><Text style={s.dayNumText}>{day.day}</Text></View>
                <Text style={s.dayTitle} numberOfLines={1}>{day.title}</Text>
                <Text style={s.dayMeta}>{day.est_miles}mi · {day.road_type}</Text>
              </View>
            ))}
          </ScrollView>
          <View style={s.legendRow}>
            {[['#e67e22', 'Waypoint'], ['#27ae60', 'Campsite'], ['#f59e0b', 'Fuel'], ['#a855f7', 'Community']].map(([color, label]) => (
              <View key={label} style={s.legendItem}>
                <View style={[s.legendDot, { backgroundColor: color }]} />
                <Text style={s.legendText}>{label}</Text>
              </View>
            ))}
          </View>
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0c0f14' },
  map: { flex: 1 },
  topBar: {
    position: 'absolute', top: 56, left: 16, right: 16,
    backgroundColor: 'rgba(13,17,23,0.85)', borderRadius: 20,
    paddingVertical: 7, paddingHorizontal: 14,
    borderWidth: 1, borderColor: '#252b38',
  },
  topBarText: { color: '#e2e8f0', fontSize: 12, fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace', textAlign: 'center' },
  locBtn: {
    position: 'absolute', bottom: 220, right: 16,
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: 'rgba(13,17,23,0.9)', borderWidth: 1, borderColor: '#252b38',
    alignItems: 'center', justifyContent: 'center',
  },
  panelToggle: {
    position: 'absolute', bottom: 204, alignSelf: 'center',
    backgroundColor: 'rgba(13,17,23,0.9)', borderRadius: 20,
    padding: 8, borderWidth: 1, borderColor: '#252b38',
  },
  panel: { backgroundColor: '#13171f', borderTopWidth: 1, borderColor: '#252b38', paddingBottom: 16 },
  dayScroll: { paddingHorizontal: 16, paddingVertical: 12, gap: 10 },
  dayCard: { backgroundColor: '#1a1f2a', borderRadius: 10, borderWidth: 1, borderColor: '#252b38', padding: 12, width: 140 },
  dayNum: { width: 26, height: 26, borderRadius: 13, backgroundColor: '#e67e22', alignItems: 'center', justifyContent: 'center', marginBottom: 6 },
  dayNumText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  dayTitle: { color: '#e2e8f0', fontSize: 12, fontWeight: '500', marginBottom: 2 },
  dayMeta: { color: '#64748b', fontSize: 10, fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace' },
  legendRow: { flexDirection: 'row', gap: 16, paddingHorizontal: 16 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendText: { color: '#64748b', fontSize: 11 },
  alertPanel: {
    position: 'absolute', top: 110, left: 16, right: 16,
    backgroundColor: 'rgba(13,17,23,0.95)', borderRadius: 12,
    borderWidth: 1, borderColor: '#ef4444', maxHeight: 220,
  },
  alertHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 12, paddingVertical: 8,
    borderBottomWidth: 1, borderColor: '#252b38',
  },
  alertTitle: { color: '#ef4444', fontSize: 11, fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace', flex: 1 },
  alertScroll: { maxHeight: 160 },
  alertItem: { paddingHorizontal: 12, paddingVertical: 8, borderBottomWidth: 1, borderColor: '#1a1f2a' },
  alertCritical: { borderLeftWidth: 3, borderLeftColor: '#ef4444' },
  alertItemRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 2 },
  alertBadge: { color: '#e2e8f0', fontSize: 10, fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace' },
  alertSev: { color: '#ef4444', fontSize: 9, fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace' },
  alertDesc: { color: '#64748b', fontSize: 11 },
  callout: { width: 180, padding: 4 },
  calloutTitle: { fontWeight: '600', fontSize: 13, marginBottom: 2 },
  calloutMeta: { color: '#64748b', fontSize: 11, marginBottom: 4 },
  calloutDesc: { color: '#374151', fontSize: 11 },
});
