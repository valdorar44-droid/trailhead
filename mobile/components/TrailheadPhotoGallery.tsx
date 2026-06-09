import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Image,
  Modal,
  NativeScrollEvent,
  NativeSyntheticEvent,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { mono, useTheme, type ColorPalette } from '@/lib/design';

export type TrailheadGalleryPhoto = {
  url: string;
  credit?: string;
  source?: string;
  caption?: string;
};

type Props = {
  visible: boolean;
  photos: TrailheadGalleryPhoto[];
  initialIndex?: number;
  title?: string;
  onClose: () => void;
};

export default function TrailheadPhotoGallery({ visible, photos, initialIndex = 0, title, onClose }: Props) {
  const C = useTheme();
  const s = useMemo(() => makeStyles(C), [C]);
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const scrollRef = useRef<ScrollView | null>(null);
  const safePhotos = useMemo(() => photos.filter(photo => !!photo.url), [photos]);
  const startIndex = Math.max(0, Math.min(initialIndex, Math.max(safePhotos.length - 1, 0)));
  const [index, setIndex] = useState(startIndex);
  const active = safePhotos[index];

  useEffect(() => {
    if (!visible) return;
    setIndex(startIndex);
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ x: startIndex * width, animated: false });
    });
  }, [startIndex, visible, width]);

  const handleMomentumEnd = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const next = Math.round(event.nativeEvent.contentOffset.x / Math.max(width, 1));
    setIndex(Math.max(0, Math.min(next, safePhotos.length - 1)));
  };

  const goTo = (nextIndex: number) => {
    if (!safePhotos.length) return;
    const normalized = (nextIndex + safePhotos.length) % safePhotos.length;
    setIndex(normalized);
    scrollRef.current?.scrollTo({ x: normalized * width, animated: true });
  };

  if (!visible || !safePhotos.length) return null;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={s.wrap}>
        <View style={[s.topBar, { paddingTop: Math.max(insets.top, 12) }]}>
          <View style={s.titleBlock}>
            <Text style={s.count}>{index + 1} / {safePhotos.length}</Text>
            {!!title && <Text style={s.title} numberOfLines={1}>{title}</Text>}
          </View>
          <TouchableOpacity style={s.closeBtn} onPress={onClose} activeOpacity={0.82}>
            <Ionicons name="close" size={21} color="#fff" />
          </TouchableOpacity>
        </View>
        <ScrollView
          ref={scrollRef}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          onMomentumScrollEnd={handleMomentumEnd}
          contentOffset={{ x: startIndex * width, y: 0 }}
          style={s.scroller}
        >
          {safePhotos.map((photo, i) => (
            <View key={`${photo.url}-${i}`} style={[s.slide, { width, height }]}>
              <Image source={{ uri: photo.url }} style={s.image} resizeMode="contain" />
            </View>
          ))}
        </ScrollView>
        {safePhotos.length > 1 ? (
          <>
            <TouchableOpacity style={[s.arrowBtn, s.arrowLeft]} onPress={() => goTo(index - 1)} activeOpacity={0.82}>
              <Ionicons name="chevron-back" size={24} color="#fff" />
            </TouchableOpacity>
            <TouchableOpacity style={[s.arrowBtn, s.arrowRight]} onPress={() => goTo(index + 1)} activeOpacity={0.82}>
              <Ionicons name="chevron-forward" size={24} color="#fff" />
            </TouchableOpacity>
          </>
        ) : null}
        <View style={[s.footer, { paddingBottom: Math.max(insets.bottom + 10, 22) }]}>
          <Text style={s.caption} numberOfLines={2}>
            {[active?.caption, active?.credit ? `Photo: ${active.credit}` : '', active?.source].filter(Boolean).join(' · ')}
          </Text>
        </View>
      </View>
    </Modal>
  );
}

const makeStyles = (C: ColorPalette) => StyleSheet.create({
  wrap: { flex: 1, backgroundColor: 'rgba(0,0,0,0.96)' },
  topBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 2,
    paddingHorizontal: 14,
    paddingBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  titleBlock: { flex: 1, minWidth: 0 },
  count: { color: '#fff', fontSize: 11, fontFamily: mono, fontWeight: '900', opacity: 0.92 },
  title: { color: '#fff', fontSize: 13, fontWeight: '800', marginTop: 3 },
  closeBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.14)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
  },
  scroller: { flex: 1 },
  slide: { alignItems: 'center', justifyContent: 'center' },
  image: { width: '100%', height: '100%' },
  arrowBtn: {
    position: 'absolute',
    top: '47%',
    zIndex: 3,
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.42)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.22)',
  },
  arrowLeft: { left: 14 },
  arrowRight: { right: 14 },
  footer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 16,
    paddingTop: 12,
    backgroundColor: 'rgba(0,0,0,0.42)',
  },
  caption: { minHeight: 18, color: C.silverBright || '#d1d5db', fontSize: 11, lineHeight: 16, fontFamily: mono },
});
