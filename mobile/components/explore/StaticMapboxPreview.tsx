import React, { useMemo, useState } from 'react';
import { Image, StyleSheet, Text, TouchableOpacity, View, type StyleProp, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
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
  badgeLabel?: string;
  height?: number;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
};

const MAPBOX_STATIC_STYLE = 'mapbox/outdoors-v12';

export function StaticMapboxPreview({ pins, title, subtitle, badgeLabel, height = 260, onPress, style }: Props) {
  const C = useTheme();
  const token = useStore(st => st.mapboxToken);
  const [failedUrl, setFailedUrl] = useState('');
  const [loadedUrl, setLoadedUrl] = useState('');
  const cleanPins = useMemo(
    () => dedupePreviewPins(pins).slice(0, 16),
    [pins],
  );
  const url = useMemo(
    () => buildStaticMapboxUrl(cleanPins, token, Math.max(180, Math.min(640, Math.round(height)))),
    [cleanPins, height, token],
  );
  const Wrapper: any = onPress ? TouchableOpacity : View;
  const canLoadImage = !!url && failedUrl !== url;
  const imageReady = canLoadImage && loadedUrl === url;
  return (
    <Wrapper style={[styles.wrap, { height, backgroundColor: C.s1 }, style]} activeOpacity={0.9} onPress={onPress as any}>
      {!imageReady ? (
        <View style={[StyleSheet.absoluteFillObject, styles.fallbackBase, { backgroundColor: C.s2 }]}>
          <View style={[styles.fallbackLine, styles.fallbackLineOne]} />
          <View style={[styles.fallbackLine, styles.fallbackLineTwo]} />
          <View style={[styles.fallbackLine, styles.fallbackLineThree]} />
          <View style={[styles.fallbackIcon, { borderColor: C.border, backgroundColor: C.s1 }]}>
            <Ionicons name="map-outline" size={24} color={C.text3} />
          </View>
        </View>
      ) : null}
      {canLoadImage ? (
        <Image
          source={{ uri: url }}
          style={[StyleSheet.absoluteFillObject, !imageReady && styles.pendingImage]}
          resizeMode="cover"
          onLoad={() => setLoadedUrl(url)}
          onError={() => setFailedUrl(url)}
        />
      ) : null}
      <View style={styles.shade} />
      <View style={styles.badge}>
        <Ionicons name="navigate-outline" size={15} color="#fff" />
        <Text style={styles.badgeText}>{badgeLabel || (cleanPins.length ? (cleanPins.length === 1 ? '1 area' : `${cleanPins.length} places`) : 'Area')}</Text>
      </View>
      <View style={styles.copy}>
        <Text style={styles.title} numberOfLines={2}>{title}</Text>
        {!!subtitle && <Text style={styles.subtitle} numberOfLines={1}>{subtitle}</Text>}
      </View>
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

function buildStaticMapboxUrl(pins: StaticMapboxPin[], token: string, height: number) {
  if (!token || !pins.length) return '';
  const overlay = pins
    .map(pin => `pin-s+${pinColor(pin)}(${trimCoord(pin.lng)},${trimCoord(pin.lat)})`)
    .join(',');
  const size = `600x${height}@2x`;
  const padding = pins.length > 1 ? '64,48,64,48' : '72';
  return `https://api.mapbox.com/styles/v1/${MAPBOX_STATIC_STYLE}/static/${overlay}/auto/${size}?padding=${padding}&access_token=${encodeURIComponent(token)}`;
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
});
