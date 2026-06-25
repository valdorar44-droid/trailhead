import { Ionicons } from '@expo/vector-icons';
import { Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { mono, useTheme, type ColorPalette } from '@/lib/design';

type IconName = keyof typeof Ionicons.glyphMap;

type RouteBuilderCampPreviewCardProps = {
  label: string;
  name: string;
  meta: string;
  compact?: boolean;
  photoUrl?: string | null;
  placeholderIcon: IconName;
  placeholderBackground: string;
  placeholderColor: string;
  onReplace?: () => void;
  onStayNextDay?: () => void;
  onStayTwoNights?: () => void;
  onOpenDetail?: () => void;
};

type RouteBuilderFuelPreviewCardProps = {
  name: string;
  meta: string;
};

type RouteBuilderPlacePreviewCardProps = {
  label: string;
  name: string;
  description?: string;
  color: string;
  icon: IconName;
  sourceLabel: string;
  typeLabel?: string;
};

export function RouteBuilderCampPreviewCard({
  label,
  name,
  meta,
  compact = false,
  photoUrl,
  placeholderIcon,
  placeholderBackground,
  placeholderColor,
  onReplace,
  onStayNextDay,
  onStayTwoNights,
  onOpenDetail,
}: RouteBuilderCampPreviewCardProps) {
  const C = useTheme();
  const s = styles(C);

  return (
    <View style={[s.selectedCampCard, compact && s.selectedCampCardCompact]}>
      <View style={[s.selectedCampPhotoWrap, compact && s.selectedCampPhotoWrapCompact]}>
        {photoUrl ? (
          <Image source={{ uri: photoUrl }} style={[s.selectedCampPhoto, compact && s.selectedCampPhotoCompact]} resizeMode="cover" />
        ) : (
          <View style={[s.selectedCampPlaceholder, compact && s.selectedCampPhotoCompact, { backgroundColor: placeholderBackground }]}>
            <Ionicons name={placeholderIcon} size={compact ? 18 : 24} color={placeholderColor} />
          </View>
        )}
      </View>
      <View style={[s.selectedCampBody, compact && s.selectedCampBodyCompact]}>
        <Text style={s.selectedCampLabel}>{label}</Text>
        <Text style={s.selectedCampName} numberOfLines={2}>{name}</Text>
        <Text style={s.selectedCampMeta} numberOfLines={2}>{meta}</Text>
        {!compact && (onReplace || onStayNextDay || onStayTwoNights) ? (
          <View style={s.campPreviewActions}>
            {onReplace ? (
              <TouchableOpacity style={s.campPreviewBtn} onPress={onReplace}>
                <Ionicons name="swap-horizontal-outline" size={12} color={C.orange} />
                <Text style={s.campPreviewBtnText}>SWAP</Text>
              </TouchableOpacity>
            ) : null}
            {onStayNextDay ? (
              <TouchableOpacity style={s.campPreviewBtn} onPress={onStayNextDay}>
                <Ionicons name="bed-outline" size={12} color={C.green} />
                <Text style={[s.campPreviewBtnText, { color: C.green }]}>STAY NEXT DAY</Text>
              </TouchableOpacity>
            ) : null}
            {onStayTwoNights ? (
              <TouchableOpacity style={s.campPreviewBtn} onPress={onStayTwoNights}>
                <Ionicons name="calendar-outline" size={12} color={C.green} />
                <Text style={[s.campPreviewBtnText, { color: C.green }]}>BASECAMP +2</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        ) : null}
      </View>
      {onOpenDetail ? (
        <TouchableOpacity style={s.selectedCampSwap} onPress={onOpenDetail}>
          <Ionicons name="image-outline" size={14} color={C.orange} />
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

export function RouteBuilderFuelPreviewCard({
  name,
  meta,
}: RouteBuilderFuelPreviewCardProps) {
  const C = useTheme();
  const s = styles(C);

  return (
    <View style={s.routeFuelCard}>
      <View style={s.routeFuelIcon}>
        <Ionicons name="flash-outline" size={18} color="#eab308" />
      </View>
      <View style={s.routeFuelBody}>
        <Text style={s.routeStopLabel}>FUEL STOP</Text>
        <Text style={s.routeStopTitle} numberOfLines={2}>{name}</Text>
        <Text style={s.routeStopMeta} numberOfLines={2}>{meta}</Text>
      </View>
    </View>
  );
}

export function RouteBuilderPlacePreviewCard({
  label,
  name,
  description,
  color,
  icon,
  sourceLabel,
  typeLabel,
}: RouteBuilderPlacePreviewCardProps) {
  const C = useTheme();
  const s = styles(C);

  return (
    <View style={s.routePlaceCard}>
      <View style={[s.routePlacePhoto, { backgroundColor: color + '18', borderColor: color + '55' }]}>
        <Ionicons name={icon} size={24} color={color} />
      </View>
      <View style={s.routePlaceBody}>
        <Text style={[s.routeStopLabel, { color }]}>{label}</Text>
        <Text style={s.routeStopTitle} numberOfLines={2}>{name}</Text>
        <Text style={s.routeStopMeta} numberOfLines={3}>{description}</Text>
        <View style={s.routePlaceTags}>
          <View style={s.miniTag}><Text style={s.miniTagText}>{sourceLabel}</Text></View>
          {typeLabel ? <View style={s.miniTag}><Text style={s.miniTagText}>{typeLabel}</Text></View> : null}
        </View>
      </View>
    </View>
  );
}

const styles = (C: ColorPalette) => StyleSheet.create({
  selectedCampCard: {
    gap: 12,
    borderWidth: 1,
    borderColor: C.green + '55',
    borderRadius: 18,
    backgroundColor: C.green + '0f',
    padding: 12,
  },
  selectedCampCardCompact: {
    padding: 8,
    gap: 10,
    borderRadius: 14,
  },
  selectedCampPhotoWrap: {
    width: '100%',
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: C.s2,
  },
  selectedCampPhotoWrapCompact: {
    width: 108,
    borderRadius: 12,
  },
  selectedCampPhoto: {
    width: '100%',
    height: 168,
  },
  selectedCampPhotoCompact: {
    height: 96,
  },
  selectedCampPlaceholder: {
    width: '100%',
    height: 168,
    alignItems: 'center',
    justifyContent: 'center',
  },
  selectedCampBody: {
    minHeight: 118,
    justifyContent: 'center',
  },
  selectedCampBodyCompact: {
    minHeight: 96,
  },
  selectedCampLabel: {
    color: C.green,
    fontSize: 10,
    fontFamily: mono,
    fontWeight: '900',
    letterSpacing: 0.8,
  },
  selectedCampName: {
    color: C.text,
    fontSize: 24,
    fontWeight: '900',
    lineHeight: 29,
    marginTop: 5,
  },
  selectedCampMeta: {
    color: C.text3,
    fontSize: 14,
    marginTop: 7,
    lineHeight: 20,
  },
  selectedCampSwap: {
    position: 'absolute',
    right: 14,
    top: 190,
    width: 42,
    height: 42,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: C.orange + '55',
    backgroundColor: C.s1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  campPreviewActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 7,
    marginTop: 8,
  },
  campPreviewBtn: {
    minHeight: 38,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 14,
    backgroundColor: C.s1,
    paddingHorizontal: 12,
  },
  campPreviewBtnText: {
    color: C.orange,
    fontSize: 9,
    fontFamily: mono,
    fontWeight: '900',
  },
  routeFuelCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    borderColor: '#eab30855',
    borderRadius: 14,
    backgroundColor: '#eab30810',
    padding: 11,
  },
  routeFuelIcon: {
    width: 42,
    height: 42,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#eab30866',
    backgroundColor: '#eab30818',
  },
  routeFuelBody: {
    flex: 1,
    minWidth: 0,
  },
  routePlaceCard: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: 10,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 14,
    backgroundColor: C.s2,
    padding: 10,
  },
  routePlacePhoto: {
    width: 78,
    minHeight: 92,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  routePlaceBody: {
    flex: 1,
    minHeight: 92,
    justifyContent: 'center',
  },
  routeStopLabel: {
    color: C.orange,
    fontSize: 9,
    fontFamily: mono,
    fontWeight: '900',
    letterSpacing: 0.7,
  },
  routeStopTitle: {
    color: C.text,
    fontSize: 17,
    fontWeight: '900',
    lineHeight: 21,
    marginTop: 4,
  },
  routeStopMeta: {
    color: C.text3,
    fontSize: 12,
    lineHeight: 17,
    marginTop: 5,
  },
  routePlaceTags: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 5,
    marginTop: 8,
  },
  miniTag: {
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 999,
    paddingHorizontal: 6,
    paddingVertical: 3,
    backgroundColor: C.s2,
  },
  miniTagText: {
    color: C.text3,
    fontSize: 7,
    fontFamily: mono,
    fontWeight: '900',
  },
});
