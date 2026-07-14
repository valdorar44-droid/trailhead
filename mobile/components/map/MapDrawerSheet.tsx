import React, { useMemo } from 'react';
import {
  BackHandler,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { useTheme, type ColorPalette } from '@/lib/design';

export type MapDrawerSheetProps = {
  visible: boolean;
  topInset: number;
  bottomInset: number;
  onClose: () => void;
  onOpenSearch: () => void;
  onFindCamps: () => void;
  onAddPin: () => void;
  onOpenWeather: () => void;
  onOpenLayers: () => void;
  onOpenFilters: () => void;
  onOpenOffline: () => void;
  onOpenTrailBuilder: () => void;
};

type DrawerAction = {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
};

export default function MapDrawerSheet({
  visible,
  topInset,
  bottomInset,
  onClose,
  onOpenSearch,
  onFindCamps,
  onAddPin,
  onOpenWeather,
  onOpenLayers,
  onOpenFilters,
  onOpenOffline,
  onOpenTrailBuilder,
}: MapDrawerSheetProps) {
  const C = useTheme();
  const s = useMemo(() => makeStyles(C), [C]);
  const { width: viewportWidth, height: viewportHeight } = useWindowDimensions();

  React.useEffect(() => {
    if (!visible) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      onClose();
      return true;
    });
    return () => subscription.remove();
  }, [onClose, visible]);

  if (!visible) return null;

  const drawerWidth = Math.min(302, Math.max(0, viewportWidth - 48));
  const availableHeight = Math.max(0, viewportHeight - topInset - bottomInset - 24);
  const drawerHeight = Math.min(488, availableHeight);
  const closeThen = (action: () => void) => () => {
    onClose();
    action();
  };

  const quickActions: DrawerAction[] = [
    { label: 'Search', icon: 'search-outline', onPress: onOpenSearch },
    { label: 'Find camps', icon: 'bonfire-outline', onPress: onFindCamps },
    { label: 'Add pin', icon: 'location-outline', onPress: onAddPin },
    { label: 'Weather', icon: 'partly-sunny-outline', onPress: onOpenWeather },
  ];
  const toolActions: DrawerAction[] = [
    { label: 'Layers', icon: 'layers-outline', onPress: onOpenLayers },
    { label: 'Filters', icon: 'options-outline', onPress: onOpenFilters },
    { label: 'Offline', icon: 'cloud-download-outline', onPress: onOpenOffline },
    { label: 'Trail builder', icon: 'git-branch-outline', onPress: onOpenTrailBuilder },
  ];

  return (
    <View style={s.overlay} pointerEvents="auto">
      <TouchableOpacity
        style={s.backdrop}
        activeOpacity={1}
        accessibilityRole="button"
        accessibilityLabel="Close map menu"
        onPress={onClose}
      />
      <View
        accessibilityViewIsModal
        style={[
          s.drawer,
          {
            width: drawerWidth,
            height: drawerHeight,
            marginTop: topInset + 12,
          },
        ]}
      >
        <View style={s.header}>
          <Text style={s.title}>Map</Text>
          <TouchableOpacity
            style={s.closeButton}
            activeOpacity={0.78}
            accessibilityRole="button"
            accessibilityLabel="Close map menu"
            hitSlop={8}
            onPress={onClose}
          >
            <Ionicons name="close" size={20} color={C.text2} />
          </TouchableOpacity>
        </View>

        <ScrollView
          style={s.scrollView}
          contentContainerStyle={s.content}
          bounces={false}
          showsVerticalScrollIndicator={false}
        >
          <View style={s.quickGrid}>
            {quickActions.map(action => (
              <TouchableOpacity
                key={action.label}
                style={s.quickAction}
                activeOpacity={0.8}
                accessibilityRole="button"
                accessibilityLabel={action.label}
                onPress={closeThen(action.onPress)}
              >
                <Ionicons name={action.icon} size={23} color={C.text} />
                <Text style={s.quickActionLabel} numberOfLines={2}>{action.label}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <View style={s.toolList}>
            {toolActions.map((action, index) => (
              <TouchableOpacity
                key={action.label}
                style={[s.toolRow, index < toolActions.length - 1 && s.toolRowDivider]}
                activeOpacity={0.72}
                accessibilityRole="button"
                accessibilityLabel={action.label}
                onPress={closeThen(action.onPress)}
              >
                <Ionicons name={action.icon} size={20} color={C.text2} />
                <Text style={s.toolLabel} numberOfLines={1}>{action.label}</Text>
                <Ionicons name="chevron-forward" size={17} color={C.text3} />
              </TouchableOpacity>
            ))}
          </View>
        </ScrollView>
      </View>
    </View>
  );
}

const makeStyles = (C: ColorPalette) => StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'flex-start',
    zIndex: 260,
    elevation: 260,
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.24)',
  },
  drawer: {
    overflow: 'hidden',
    borderTopRightRadius: 16,
    borderBottomRightRadius: 16,
    backgroundColor: C.s1,
    borderWidth: 1,
    borderLeftWidth: 0,
    borderColor: C.border,
    shadowColor: '#000',
    shadowOpacity: 0.24,
    shadowRadius: 18,
    shadowOffset: { width: 4, height: 8 },
  },
  header: {
    minHeight: 52,
    paddingLeft: 18,
    paddingRight: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: C.border,
  },
  title: {
    color: C.text,
    fontSize: 19,
    fontWeight: '800',
  },
  closeButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scrollView: {
    flex: 1,
  },
  content: {
    paddingHorizontal: 14,
    paddingTop: 14,
    paddingBottom: 16,
    gap: 14,
  },
  quickGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  quickAction: {
    minWidth: 112,
    flexBasis: '47%',
    flexGrow: 1,
    minHeight: 88,
    paddingHorizontal: 13,
    paddingVertical: 12,
    justifyContent: 'space-between',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.s2,
  },
  quickActionLabel: {
    color: C.text,
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '700',
  },
  toolList: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: C.border,
  },
  toolRow: {
    minHeight: 52,
    paddingHorizontal: 4,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  toolRowDivider: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: C.border,
  },
  toolLabel: {
    flex: 1,
    color: C.text,
    fontSize: 15,
    fontWeight: '600',
  },
});
