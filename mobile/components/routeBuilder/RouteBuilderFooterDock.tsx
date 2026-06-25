import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { mono, useTheme, type ColorPalette } from '@/lib/design';

type RouteBuilderFooterDockProps = {
  bottom: number;
  distanceLabel: string;
  summaryLabel: string;
  actionLabel: string;
  saving: boolean;
  onPressAction: () => void;
};

export default function RouteBuilderFooterDock({
  bottom,
  distanceLabel,
  summaryLabel,
  actionLabel,
  saving,
  onPressAction,
}: RouteBuilderFooterDockProps) {
  const C = useTheme();
  const s = styles(C);

  return (
    <View style={[s.dock, { bottom }]} pointerEvents="box-none">
      <View style={s.copy}>
        <Text style={s.distance} numberOfLines={1}>{distanceLabel}</Text>
        <Text style={s.summary} numberOfLines={1}>{summaryLabel}</Text>
      </View>
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
    minWidth: 134,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    backgroundColor: C.green,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
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
});
