import type { ReactNode } from 'react';
import { Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { TrailheadCardSkeleton } from '@/components/TrailheadUI';
import { mono, useTheme, type ColorPalette } from '@/lib/design';

type RouteBuilderInlineResultsProps = {
  title: string;
  subtitle: string;
  loading: boolean;
  children: ReactNode;
  onClose: () => void;
};

type RouteBuilderInlineCampCardProps = {
  title: string;
  meta: string;
  photoUrl?: string | null;
  fallbackColor: string;
  fallbackBackgroundColor: string;
  actionLabel: string;
  onPress: () => void;
  onPressAction: () => void;
};

type RouteBuilderInlineResultRowProps = {
  icon: keyof typeof Ionicons.glyphMap;
  iconColor: string;
  iconBackgroundColor: string;
  iconBorderColor: string;
  title: string;
  meta: string;
  metaLines?: number;
  trailingLabel?: string;
  trailingColor?: string;
  onPress: () => void;
};

export default function RouteBuilderInlineResults({
  title,
  subtitle,
  loading,
  children,
  onClose,
}: RouteBuilderInlineResultsProps) {
  const C = useTheme();
  const s = styles(C);

  return (
    <View style={s.results}>
      <View style={s.top}>
        <View style={s.heading}>
          <Text style={s.title}>{title}</Text>
          <Text style={s.subtitle}>{subtitle}</Text>
        </View>
        <TouchableOpacity style={s.close} onPress={onClose} activeOpacity={0.82}>
          <Ionicons name="close" size={13} color={C.text3} />
        </TouchableOpacity>
      </View>
      {loading ? (
        <View style={s.loading}>
          <TrailheadCardSkeleton media lines={3} style={s.loadingCard} />
          <TrailheadCardSkeleton lines={2} style={s.loadingCard} />
        </View>
      ) : (
        children
      )}
    </View>
  );
}

export function RouteBuilderInlineCampCard({
  title,
  meta,
  photoUrl,
  fallbackColor,
  fallbackBackgroundColor,
  actionLabel,
  onPress,
  onPressAction,
}: RouteBuilderInlineCampCardProps) {
  const C = useTheme();
  const s = styles(C);

  return (
    <TouchableOpacity style={s.campCard} onPress={onPress} activeOpacity={0.86}>
      <View style={s.campPhotoWrap}>
        {photoUrl ? (
          <Image source={{ uri: photoUrl }} style={s.campPhoto} resizeMode="cover" />
        ) : (
          <View style={[s.campPlaceholder, { backgroundColor: fallbackBackgroundColor }]}>
            <Ionicons name="bonfire-outline" size={19} color={fallbackColor} />
          </View>
        )}
      </View>
      <View style={s.campBody}>
        <Text style={s.name} numberOfLines={2}>{title}</Text>
        <Text style={s.meta} numberOfLines={2}>{meta}</Text>
      </View>
      <TouchableOpacity style={s.useButton} onPress={onPressAction} activeOpacity={0.82}>
        <Text style={s.useButtonText}>{actionLabel}</Text>
      </TouchableOpacity>
    </TouchableOpacity>
  );
}

export function RouteBuilderInlineResultRow({
  icon,
  iconColor,
  iconBackgroundColor,
  iconBorderColor,
  title,
  meta,
  metaLines = 1,
  trailingLabel,
  trailingColor,
  onPress,
}: RouteBuilderInlineResultRowProps) {
  const C = useTheme();
  const s = styles(C);
  const tagColor = trailingColor ?? C.text3;

  return (
    <TouchableOpacity style={s.row} onPress={onPress} activeOpacity={0.86}>
      <View style={[s.icon, { borderColor: iconBorderColor, backgroundColor: iconBackgroundColor }]}>
        <Ionicons name={icon} size={16} color={iconColor} />
      </View>
      <View style={s.rowBody}>
        <Text style={s.name} numberOfLines={1}>{title}</Text>
        <Text style={s.meta} numberOfLines={metaLines}>{meta}</Text>
      </View>
      {trailingLabel ? (
        <View style={[s.tag, { borderColor: tagColor + '66' }]}>
          <Text style={[s.tagText, { color: tagColor }]}>{trailingLabel}</Text>
        </View>
      ) : null}
    </TouchableOpacity>
  );
}

const styles = (C: ColorPalette) => StyleSheet.create({
  results: {
    borderWidth: 1,
    borderColor: C.orange + '44',
    borderRadius: 12,
    backgroundColor: C.bg,
    padding: 9,
    gap: 8,
  },
  top: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  heading: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    color: C.text,
    fontSize: 12,
    fontWeight: '900',
  },
  subtitle: {
    color: C.text3,
    fontSize: 10,
    fontFamily: mono,
    marginTop: 2,
  },
  close: {
    width: 28,
    height: 28,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: C.s2,
    borderWidth: 1,
    borderColor: C.border,
  },
  loading: {
    gap: 8,
    paddingVertical: 4,
  },
  loadingCard: {
    borderRadius: 11,
    padding: 9,
    backgroundColor: C.s1,
  },
  campCard: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: 8,
    padding: 8,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.s1,
  },
  campPhotoWrap: {
    width: 64,
    borderRadius: 9,
    overflow: 'hidden',
    backgroundColor: C.s2,
  },
  campPhoto: {
    width: '100%',
    height: 74,
  },
  campPlaceholder: {
    width: '100%',
    height: 74,
    alignItems: 'center',
    justifyContent: 'center',
  },
  campBody: {
    flex: 1,
    minHeight: 74,
    justifyContent: 'center',
    minWidth: 0,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    padding: 9,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 11,
    backgroundColor: C.s1,
  },
  icon: {
    width: 34,
    height: 34,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowBody: {
    flex: 1,
    minWidth: 0,
  },
  name: {
    color: C.text,
    fontSize: 13,
    fontWeight: '800',
  },
  meta: {
    color: C.text3,
    fontSize: 10,
    marginTop: 2,
  },
  tag: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 6,
    paddingVertical: 3,
    backgroundColor: C.s2,
  },
  tagText: {
    fontSize: 7,
    fontFamily: mono,
    fontWeight: '900',
  },
  useButton: {
    borderWidth: 1,
    borderColor: C.green + '66',
    backgroundColor: C.green + '14',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    alignSelf: 'center',
  },
  useButtonText: {
    color: C.green,
    fontSize: 9,
    fontFamily: mono,
    fontWeight: '900',
  },
});
