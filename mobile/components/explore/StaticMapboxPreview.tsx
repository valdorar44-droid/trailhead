import React, { useEffect, useMemo, useState } from 'react';
import { AppState, Image, Platform, StyleSheet, Text, TouchableOpacity, View, type StyleProp, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { api } from '@/lib/api';
import { storage } from '@/lib/storage';
import { useStore } from '@/lib/store';
import { useTheme } from '@/lib/design';

export type StaticMapboxPin = {
  id: string;
  title: string;
  lat: number;
  lng: number;
  kind?: string;
  active?: boolean;
};

type Props = {
  pins: StaticMapboxPin[];
  title: string;
  subtitle?: string;
  imageUrl?: string;
  imageAlt?: string;
  mapboxStyle?: string;
  badgeLabel?: string;
  showBadge?: boolean;
  showCopy?: boolean;
  showFallbackIcon?: boolean;
  fallbackVariant?: 'default' | 'route';
  height?: number;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
};

const MAPBOX_STATIC_STYLE = 'mapbox/outdoors-v12';
let previewMapboxTokenRequest: Promise<string> | null = null;

function loadPreviewMapboxToken() {
  if (previewMapboxTokenRequest) return previewMapboxTokenRequest;
  previewMapboxTokenRequest = storage.get('trailhead_mapbox_token')
    .catch(() => null)
    .then(cached => {
      if (cached) return cached;
      return api.getConfig().then(config => {
        const token = String(config.mapbox_token || '').trim();
        if (token) storage.set('trailhead_mapbox_token', token).catch(() => {});
        return token;
      });
    })
    .catch(() => {
      previewMapboxTokenRequest = null;
      return '';
    });
  return previewMapboxTokenRequest;
}

export function StaticMapboxPreview({
  pins,
  title,
  subtitle,
  imageUrl,
  imageAlt,
  mapboxStyle = MAPBOX_STATIC_STYLE,
  badgeLabel,
  showBadge = true,
  showCopy = true,
  showFallbackIcon = true,
  fallbackVariant = 'default',
  height = 260,
  onPress,
  style,
}: Props) {
  const C = useTheme();
  const token = useStore(st => st.mapboxToken);
  const setMapboxToken = useStore(st => st.setMapboxToken);
  const [failedUrls, setFailedUrls] = useState<string[]>([]);
  const [loadedUrl, setLoadedUrl] = useState('');
  const cleanPins = useMemo(
    () => dedupePreviewPins(pins).slice(0, 16),
    [pins],
  );
  const mapUrl = useMemo(
    () => buildStaticMapboxUrl(cleanPins, token, Math.max(180, Math.min(640, Math.round(height))), mapboxStyle),
    [cleanPins, height, mapboxStyle, token],
  );
  const url = useMemo(
    () => [imageUrl, mapUrl]
      .map(candidate => String(candidate || '').trim())
      .find(candidate => candidate && !failedUrls.includes(candidate)) || '',
    [failedUrls, imageUrl, mapUrl],
  );
  useEffect(() => {
    if (token) return;
    let cancelled = false;
    loadPreviewMapboxToken().then(nextToken => {
      if (!cancelled && nextToken) setMapboxToken(nextToken);
    });
    return () => { cancelled = true; };
  }, [setMapboxToken, token]);
  useEffect(() => {
    setFailedUrls([]);
  }, [imageUrl, mapUrl]);
  useEffect(() => {
    const retryMedia = () => setFailedUrls([]);
    const appState = AppState.addEventListener('change', state => {
      if (state === 'active') retryMedia();
    });
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      window.addEventListener('online', retryMedia);
    }
    return () => {
      appState.remove();
      if (Platform.OS === 'web' && typeof window !== 'undefined') {
        window.removeEventListener('online', retryMedia);
      }
    };
  }, []);
  const Wrapper: any = onPress ? TouchableOpacity : View;
  const canLoadImage = !!url;
  const imageReady = canLoadImage && loadedUrl === url;
  const routeFallback = fallbackVariant === 'route';
  const dark = C.bg === '#050505';
  return (
    <Wrapper style={[styles.wrap, { height, backgroundColor: C.s1 }, style]} activeOpacity={0.9} onPress={onPress as any}>
      {!imageReady ? (
        <View
          style={[
            StyleSheet.absoluteFillObject,
            styles.fallbackBase,
            { backgroundColor: routeFallback ? (dark ? '#141916' : '#e8ede6') : C.s2 },
          ]}
        >
          {routeFallback ? (
            <>
              <View style={[styles.fallbackLand, styles.fallbackLandOne, { backgroundColor: dark ? '#1d2720' : '#d8e4d4' }]} />
              <View style={[styles.fallbackLand, styles.fallbackLandTwo, { backgroundColor: dark ? '#18231f' : '#dce8dc' }]} />
              <View style={[styles.fallbackContour, styles.fallbackContourOne, { borderColor: dark ? 'rgba(159,174,163,0.16)' : 'rgba(90,109,96,0.18)' }]} />
              <View style={[styles.fallbackContour, styles.fallbackContourTwo, { borderColor: dark ? 'rgba(159,174,163,0.14)' : 'rgba(90,109,96,0.15)' }]} />
              <View style={[styles.fallbackRoad, styles.fallbackRoadOne, { backgroundColor: dark ? '#53615a' : '#aab5ad' }]} />
              <View style={[styles.fallbackRoad, styles.fallbackRoadTwo, { backgroundColor: dark ? '#46534d' : '#b7c0ba' }]} />
              <View style={[styles.fallbackRoad, styles.fallbackRoadThree, { backgroundColor: dark ? '#46534d' : '#b7c0ba' }]} />
              <View style={[styles.fallbackRoute, styles.fallbackRouteOne, { backgroundColor: C.orange }]} />
              <View style={[styles.fallbackRoute, styles.fallbackRouteTwo, { backgroundColor: C.orange }]} />
              {cleanPins.length > 0 ? (
                <View style={[styles.fallbackRoutePoint, styles.fallbackRouteStart, { backgroundColor: C.s1, borderColor: C.orange }]} />
              ) : null}
              {cleanPins.length > 1 ? (
                <View style={[styles.fallbackRoutePoint, styles.fallbackRouteEnd, { backgroundColor: C.orange, borderColor: C.s1 }]} />
              ) : null}
            </>
          ) : (
            <>
              <View style={[styles.fallbackLine, styles.fallbackLineOne]} />
              <View style={[styles.fallbackLine, styles.fallbackLineTwo]} />
              <View style={[styles.fallbackLine, styles.fallbackLineThree]} />
            </>
          )}
          {showFallbackIcon ? (
            <View style={[styles.fallbackIcon, { borderColor: C.border, backgroundColor: C.s1 }]}>
              <Ionicons name="map-outline" size={24} color={C.text3} />
            </View>
          ) : null}
        </View>
      ) : null}
      {canLoadImage ? (
        <Image
          source={{ uri: url }}
          style={[StyleSheet.absoluteFillObject, !imageReady && styles.pendingImage]}
          resizeMode="cover"
          resizeMethod="resize"
          accessible={!!imageAlt}
          accessibilityLabel={imageAlt}
          onLoad={() => setLoadedUrl(url)}
          onError={() => setFailedUrls(current => current.includes(url) ? current : [...current, url])}
        />
      ) : null}
      <View
        style={[
          styles.shade,
          routeFallback && !imageReady && {
            backgroundColor: dark ? 'rgba(3,7,6,0.16)' : 'rgba(3,7,6,0.04)',
          },
        ]}
      />
      {showBadge ? (
        <View style={styles.badge}>
          <Ionicons name="navigate-outline" size={15} color="#fff" />
          <Text style={styles.badgeText}>{badgeLabel || (cleanPins.length ? (cleanPins.length === 1 ? '1 area' : `${cleanPins.length} places`) : 'Area')}</Text>
        </View>
      ) : null}
      {showCopy ? (
        <View style={styles.copy}>
          <Text style={styles.title} numberOfLines={2}>{title}</Text>
          {!!subtitle && <Text style={styles.subtitle} numberOfLines={1}>{subtitle}</Text>}
        </View>
      ) : null}
    </Wrapper>
  );
}

function dedupePreviewPins(pins: StaticMapboxPin[]) {
  const out: StaticMapboxPin[] = [];
  const seen = new Map<string, number>();
  for (const pin of pins) {
    if (!Number.isFinite(pin.lat) || !Number.isFinite(pin.lng)) continue;
    const key = `${pin.lat.toFixed(4)},${pin.lng.toFixed(4)}:${String(pin.kind || '').toLowerCase()}`;
    const existingIndex = seen.get(key);
    if (existingIndex == null) {
      seen.set(key, out.length);
      out.push(pin);
      continue;
    }
    if (pin.active && !out[existingIndex].active) {
      out[existingIndex] = pin;
    }
  }
  return out.sort((a, b) => Number(Boolean(b.active)) - Number(Boolean(a.active)));
}

function buildStaticMapboxUrl(pins: StaticMapboxPin[], token: string, height: number, mapboxStyle: string) {
  if (!token || !pins.length) return '';
  const overlay = pins
    .map(pin => `pin-s+${pinColor(pin)}(${trimCoord(pin.lng)},${trimCoord(pin.lat)})`)
    .join(',');
  const size = `600x${height}@2x`;
  const padding = pins.length > 1 ? '64,48,64,48' : '72';
  return `https://api.mapbox.com/styles/v1/${mapboxStyle}/static/${overlay}/auto/${size}?padding=${padding}&access_token=${encodeURIComponent(token)}`;
}

function trimCoord(value: number) {
  return Number(value).toFixed(5).replace(/\.?0+$/, '');
}

function pinColor(pin: StaticMapboxPin) {
  if (pin.active) return '166534';
  const kind = String(pin.kind || '').toLowerCase();
  if (/camp|stay|lodging|hut/.test(kind)) return '7c4a2a';
  if (/visitor|info/.test(kind)) return '2563eb';
  if (/trail|route/.test(kind)) return '0891b2';
  return 'd97706';
}

const styles = StyleSheet.create({
  wrap: { width: '100%', borderRadius: 0, overflow: 'hidden' },
  pendingImage: { opacity: 0 },
  shade: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(3,7,18,0.22)' },
  badge: {
    position: 'absolute',
    right: 14,
    top: 14,
    minHeight: 32,
    borderRadius: 16,
    paddingHorizontal: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(3,7,18,0.58)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.16)',
  },
  badgeText: { color: '#fff', fontSize: 11, fontWeight: '900' },
  copy: { position: 'absolute', left: 18, right: 92, bottom: 18 },
  title: { color: '#fff', fontSize: 31, lineHeight: 34, fontWeight: '900' },
  subtitle: { color: 'rgba(255,255,255,0.8)', fontSize: 13, lineHeight: 17, fontWeight: '800', marginTop: 5 },
  fallbackBase: { overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  fallbackLine: { position: 'absolute', height: 2, borderRadius: 2, backgroundColor: 'rgba(148,163,184,0.24)' },
  fallbackLineOne: { width: '88%', left: '-10%', top: '58%', transform: [{ rotate: '-15deg' }] },
  fallbackLineTwo: { width: '70%', right: '-10%', top: '36%', transform: [{ rotate: '24deg' }] },
  fallbackLineThree: { width: '74%', left: '12%', top: '76%', transform: [{ rotate: '8deg' }] },
  fallbackIcon: { width: 52, height: 52, borderRadius: 26, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  fallbackLand: { position: 'absolute', borderRadius: 40, opacity: 0.86 },
  fallbackLandOne: { width: '48%', height: '28%', left: '-8%', top: '8%', transform: [{ rotate: '-12deg' }] },
  fallbackLandTwo: { width: '54%', height: '34%', right: '-12%', bottom: '13%', transform: [{ rotate: '16deg' }] },
  fallbackContour: { position: 'absolute', borderWidth: 1, borderRadius: 160 },
  fallbackContourOne: { width: 280, height: 124, left: -68, top: '22%', transform: [{ rotate: '17deg' }] },
  fallbackContourTwo: { width: 310, height: 136, right: -104, bottom: '22%', transform: [{ rotate: '-21deg' }] },
  fallbackRoad: { position: 'absolute', height: 2, borderRadius: 1, opacity: 0.72 },
  fallbackRoadOne: { width: '112%', left: '-12%', top: '32%', transform: [{ rotate: '14deg' }] },
  fallbackRoadTwo: { width: '92%', right: '-18%', top: '62%', transform: [{ rotate: '-24deg' }] },
  fallbackRoadThree: { width: '84%', left: '-16%', bottom: '18%', transform: [{ rotate: '7deg' }] },
  fallbackRoute: { position: 'absolute', height: 3, borderRadius: 2, opacity: 0.9 },
  fallbackRouteOne: { width: '43%', left: '15%', top: '54%', transform: [{ rotate: '-28deg' }] },
  fallbackRouteTwo: { width: '36%', right: '14%', top: '46%', transform: [{ rotate: '-34deg' }] },
  fallbackRoutePoint: { position: 'absolute', width: 13, height: 13, borderRadius: 7, borderWidth: 3 },
  fallbackRouteStart: { left: '14%', top: '61%' },
  fallbackRouteEnd: { right: '13%', top: '40.5%' },
});
