import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { mono, useTheme, type ColorPalette } from '@/lib/design';

type RouteBuilderFooterDockProps = {
  bottom: number;
  distanceLabel: string;
  summaryLabel: string;
  actionLabel: string;
  secondaryActionLabel?: string;
  secondaryActionIcon?: keyof typeof Ionicons.glyphMap;
  saving: boolean;
  onPressAction: () => void;
  onPressSecondaryAction?: () => void;
};

export default function RouteBuilderFooterDock({
  bottom,
  distanceLabel,
  summaryLabel,
  actionLabel,
  secondaryActionLabel,
  secondaryActionIcon = 'play-outline',
  saving,
  onPressAction,
  onPressSecondaryAction,
}: RouteBuilderFooterDockProps) {
  const C = useTheme();
  const s = styles(C);

  return (
    <View style={[s.dock, { bottom }]} pointerEvents="box-none">
      <View style={s.copy}>
        <Text style={s.distance} numberOfLines={1}>{distanceLabel}</Text>
        <Text style={s.summary} numberOfLines={1}>{summaryLabel}</Text>
      </View>
      <View style={s.actionGroup}>
        {secondaryActionLabel && onPressSecondaryAction ? (
          <TouchableOpacity
            style={[s.secondaryAction, saving && s.actionDisabled]}
            onPress={onPressSecondaryAction}
            disabled={saving}
            activeOpacity={0.84}
          >
            <Ionicons name={secondaryActionIcon} size={15} color={C.orange} />
            <Text style={s.secondaryActionText}>{secondaryActionLabel}</Text>
          </TouchableOpacity>
        ) : null}
        <TouchableOpacity
          style={[s.action, saving && s.actionDisabled]}
          onPress={onPressAction}
          disabled={saving}
          activeOpacity={0.84}
        >
          <Ionicons name="map-outline" size={16} color="#fff" />
          <Text style={s.actionText}>{actionLabel}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = (C: ColorPalette) => StyleSheet.create({
  dock: {
    position: 'absolute',
    left: 14,
    right: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    padding: 14,
    borderRadius: 20,
    backgroundColor: C.glassStrong,
    borderWidth: 1,
    borderColor: C.border,
    shadowColor: '#000',
    shadowOpacity: 0.36,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 12 },
  },
  copy: {
    flex: 1,
    minWidth: 0,
  },
  distance: {
    color: C.text,
    fontSize: 18,
    fontFamily: mono,
    fontWeight: '900',
  },
  summary: {
    color: C.text3,
    fontSize: 10,
    fontFamily: mono,
    marginTop: 2,
  },
  action: {
    minHeight: 44,
    minWidth: 92,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    backgroundColor: C.green,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  actionGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  secondaryAction: {
    minHeight: 44,
    minWidth: 92,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: C.orange + '66',
    backgroundColor: C.orange + '12',
  },
  actionDisabled: {
    opacity: 0.65,
  },
  actionText: {
    color: '#fff',
    fontSize: 11,
    fontFamily: mono,
    fontWeight: '900',
  },
  secondaryActionText: {
    color: C.orange,
    fontSize: 11,
    fontFamily: mono,
    fontWeight: '900',
  },
});
