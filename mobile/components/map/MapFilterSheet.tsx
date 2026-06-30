import React from 'react';
import { Alert, Modal, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { TrailheadLoadingRow, TrailheadSheet } from '@/components/TrailheadUI';
import MapModeGallery from '@/components/map/MapModeGallery';
import { mono, useTheme, type ColorPalette } from '@/lib/design';
import { mapModePresetTitle, type MapModePresetId } from '@/lib/mapLegend';

export type MapFilterOption = {
  id: string;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  color?: string;
};

export type MapFilterToggleItem = {
  key: string;
  title: string;
  sub: string;
  enabled: boolean;
  icon: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
};

type MapFilterSheetProps = {
  visible: boolean;
  changedCount: number;
  filterSheetHeight?: number;
  filterBottomSpacer: number;
  expandedSections: string[];
  activePresetId: MapModePresetId;
  mapContentSummary: string;
  mapContentItems: readonly MapFilterToggleItem[];
  campFilterSummary: string;
  activeCampFilterCount: number;
  campOptions: readonly MapFilterOption[];
  activeCampFilters: string[];
  placeFilterSummary: string;
  essentialPlaceOptions: readonly MapFilterOption[];
  activePlaceFilters: string[];
  waterSummary: string;
  waterOptions: readonly MapFilterOption[];
  stayOptions: readonly MapFilterOption[];
  exploreOptions: readonly MapFilterOption[];
  disabledExploreIds: ReadonlySet<string>;
  exploreCategoriesUnlocked: boolean;
  categoryUnlocking: boolean;
  communityFilterSummary: string;
  pinOptions: readonly MapFilterOption[];
  activePinFilters: string[];
  weatherLayerItems: readonly MapFilterToggleItem[];
  onClose: () => void;
  onResetAll: () => void;
  onSelectPreset: (presetId: MapModePresetId) => void;
  onOpenLegend: () => void;
  onToggleSection: (section: string) => void;
  onResetCamps: () => void;
  onToggleCampFilter: (id: string) => void;
  onResetPlacesDefault: () => void;
  onToggleEssentialPlace: (id: string) => void;
  onSafeWaterPreset: () => void;
  onToggleWater: (id: string) => void;
  onEnableAllStays: () => void;
  onToggleStay: (id: string) => void;
  onUnlockExplore: () => void;
  onToggleExplore: (id: string) => void;
  onResetCommunityDefault: () => void;
  onTogglePin: (id: string) => void;
};

type SectionRowProps = {
  icon: keyof typeof Ionicons.glyphMap;
  iconColor: string;
  title: string;
  summary: string;
  expanded: boolean;
  actionLabel?: string;
  actionDisabled?: boolean;
  onPress: () => void;
  onActionPress?: () => void;
};

export default function MapFilterSheet({
  visible,
  changedCount,
  filterSheetHeight,
  filterBottomSpacer,
  expandedSections,
  activePresetId,
  mapContentSummary,
  mapContentItems,
  campFilterSummary,
  activeCampFilterCount,
  campOptions,
  activeCampFilters,
  placeFilterSummary,
  essentialPlaceOptions,
  activePlaceFilters,
  waterSummary,
  waterOptions,
  stayOptions,
  exploreOptions,
  disabledExploreIds,
  exploreCategoriesUnlocked,
  categoryUnlocking,
  communityFilterSummary,
  pinOptions,
  activePinFilters,
  weatherLayerItems,
  onClose,
  onResetAll,
  onSelectPreset,
  onOpenLegend,
  onToggleSection,
  onResetCamps,
  onToggleCampFilter,
  onResetPlacesDefault,
  onToggleEssentialPlace,
  onSafeWaterPreset,
  onToggleWater,
  onEnableAllStays,
  onToggleStay,
  onUnlockExplore,
  onToggleExplore,
  onResetCommunityDefault,
  onTogglePin,
}: MapFilterSheetProps) {
  const C = useTheme();
  const isAndroid = Platform.OS === 'android';
  const { height: viewportHeight } = useWindowDimensions();
  const styles = React.useMemo(() => makeStyles(C), [C]);
  const activeModeTitle = mapModePresetTitle(activePresetId);
  const sheetHeight = React.useMemo(() => {
    const maxSheetHeight = Math.max(360, viewportHeight - 24);
    const requestedHeight = Number(filterSheetHeight);
    const preferredHeight = Number.isFinite(requestedHeight) && requestedHeight > 320
      ? requestedHeight
      : Math.round(viewportHeight * (isAndroid ? 0.88 : 0.84));
    return Math.min(Math.max(preferredHeight, 360), maxSheetHeight);
  }, [filterSheetHeight, isAndroid, viewportHeight]);

  const renderCheckRows = (
    options: readonly MapFilterOption[],
    selected: string[],
    onToggle: (id: string) => void,
    disabledIds: ReadonlySet<string> = new Set<string>(),
  ) => (
    <View style={styles.filterOptionList}>
      {options.map(item => {
        const active = selected.includes(item.id);
        const locked = disabledIds.has(item.id);
        return (
          <TouchableOpacity
            key={item.id}
            style={[styles.filterOptionRow, locked && styles.filterOptionRowDisabled]}
            activeOpacity={0.82}
            onPress={() => {
              if (locked) {
                Alert.alert(
                  'Add services',
                  'Show food, groceries, repairs, lodging, medical stops, and connection spots.',
                  [
                    { text: 'Not now', style: 'cancel' },
                    { text: 'Show services', onPress: onUnlockExplore },
                  ],
                );
                return;
              }
              onToggle(item.id);
            }}
          >
            <View style={[styles.filterOptionCheck, active && { backgroundColor: item.color || C.orange, borderColor: item.color || C.orange }]}>
              {active ? <Ionicons name="checkmark" size={14} color="#fff" /> : null}
            </View>
            <Ionicons name={(locked ? 'lock-closed-outline' : item.icon) as any} size={18} color={locked ? C.text3 : item.color || C.text2} />
            <Text style={[styles.filterOptionText, locked && { color: C.text3 }]} numberOfLines={1}>{item.label}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );

  const renderToggleRows = (items: readonly MapFilterToggleItem[]) => (
    <View style={styles.filterToggleList}>
      {items.map(item => (
        <TouchableOpacity key={item.key} style={styles.filterToggleRow} onPress={item.onPress} activeOpacity={0.82}>
          <Ionicons name={item.icon} size={18} color={item.enabled ? C.orange : C.text3} />
          <View style={styles.filterSectionCopy}>
            <Text style={styles.filterOptionText}>{item.title}</Text>
            <Text style={styles.filterSectionRowSub} numberOfLines={1}>{item.sub}</Text>
          </View>
          <View style={[styles.filterSwitch, item.enabled && styles.filterSwitchOn]}>
            <View style={[styles.filterSwitchKnob, item.enabled && styles.filterSwitchKnobOn]} />
          </View>
        </TouchableOpacity>
      ))}
    </View>
  );

  const renderSectionRow = ({
    icon,
    iconColor,
    title,
    summary,
    expanded,
    actionLabel,
    actionDisabled,
    onPress,
    onActionPress,
  }: SectionRowProps) => (
    <TouchableOpacity style={styles.filterSectionRow} onPress={onPress} activeOpacity={0.84}>
      <View style={styles.filterSectionIcon}>
        <Ionicons name={icon} size={18} color={iconColor} />
      </View>
      <View style={styles.filterSectionCopy}>
        <Text style={styles.filterSectionRowTitle}>{title}</Text>
        <Text style={styles.filterSectionRowSub} numberOfLines={1}>{summary}</Text>
      </View>
      {actionLabel ? (
        <TouchableOpacity onPress={onActionPress} disabled={actionDisabled} hitSlop={8}>
          <Text style={[styles.filterClearText, actionDisabled && styles.filterActionDisabled]}>{actionLabel}</Text>
        </TouchableOpacity>
      ) : null}
      <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={18} color={C.text3} />
    </TouchableOpacity>
  );

  return (
      <Modal visible={visible} animationType="slide" transparent statusBarTranslucent onRequestClose={onClose}>
        <View style={[styles.overlay, isAndroid ? styles.androidOverlay : styles.iosOverlay]}>
          <TouchableOpacity style={StyleSheet.absoluteFillObject} activeOpacity={1} onPress={onClose} />
          <TrailheadSheet
            handle={false}
            style={isAndroid
              ? [styles.sheet, styles.androidSheet, { height: sheetHeight }]
              : [styles.sheet, styles.iosSheet, { height: sheetHeight }]}
            contentStyle={{ padding: 0, flex: 1 }}
          >
            <View style={styles.header}>
              <View style={styles.headerCopy}>
                <Text style={styles.title}>Map layers</Text>
                <Text style={styles.sub}>{activeModeTitle} · {changedCount > 0 ? `${changedCount} changed` : 'Default view'}</Text>
              </View>
              <View style={styles.headerActions}>
                <TouchableOpacity onPress={onOpenLegend} style={styles.resetBtn}>
                  <Text style={styles.resetText}>Legend</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={onResetAll} style={styles.resetBtn}>
                  <Text style={styles.resetText}>Reset</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
                  <Ionicons name="close" size={20} color={C.text2} />
                </TouchableOpacity>
              </View>
            </View>

            <ScrollView
              showsVerticalScrollIndicator={false}
              style={styles.scroll}
              contentContainerStyle={[styles.scrollContent, { paddingBottom: Math.max(28, filterBottomSpacer) }]}
              keyboardShouldPersistTaps="handled"
              nestedScrollEnabled={isAndroid}
              bounces={!isAndroid}
              overScrollMode={isAndroid ? 'always' : 'auto'}
            >
              <MapModeGallery
                activePresetId={activePresetId}
                onSelectPreset={onSelectPreset}
                onOpenLegend={onOpenLegend}
              />
              {categoryUnlocking ? (
                <TrailheadLoadingRow
                  label="Adding services"
                  sub="Food, repairs, lodging, and medical stops are being added."
                  icon="sparkles-outline"
                  style={styles.sheetLoadingRow}
                />
              ) : null}

            <View style={styles.group}>
              {renderSectionRow({
                icon: 'map-outline',
                iconColor: C.orange,
                title: 'Base layers',
                summary: mapContentSummary,
                expanded: expandedSections.includes('map-content'),
                onPress: () => onToggleSection('map-content'),
              })}
              {expandedSections.includes('map-content') ? renderToggleRows(mapContentItems) : null}
            </View>

            <View style={styles.group}>
              {renderSectionRow({
                icon: 'bonfire-outline',
                iconColor: '#14b8a6',
                title: 'Camps',
                summary: campFilterSummary,
                expanded: expandedSections.includes('camps'),
                actionLabel: activeCampFilterCount > 0 ? 'Reset' : undefined,
                onPress: () => onToggleSection('camps'),
                onActionPress: onResetCamps,
              })}
              {expandedSections.includes('camps') ? (
                <>
                  <Text style={styles.hintText}>Choose the stay types to show. Turn Camps off above to hide them all.</Text>
                  {renderCheckRows(campOptions, activeCampFilters, onToggleCampFilter)}
                </>
              ) : null}
            </View>

            <View style={styles.group}>
              {renderSectionRow({
                icon: 'location-outline',
                iconColor: '#0ea5e9',
                title: 'Places',
                summary: placeFilterSummary,
                expanded: expandedSections.includes('places'),
                actionLabel: 'Default',
                onPress: () => onToggleSection('places'),
                onActionPress: onResetPlacesDefault,
              })}
              {expandedSections.includes('places') ? (
                <>
                  <Text style={styles.hintText}>Default keeps camps, trails, water, fuel, dump, propane, parking, and repairs visible.</Text>
                  {renderCheckRows(essentialPlaceOptions, activePlaceFilters, onToggleEssentialPlace)}
                </>
              ) : null}
            </View>

            <View style={styles.group}>
              {renderSectionRow({
                icon: 'boat-outline',
                iconColor: '#0891b2',
                title: 'Water',
                summary: waterSummary,
                expanded: expandedSections.includes('water'),
                actionLabel: 'Safe preset',
                onPress: () => onToggleSection('water'),
                onActionPress: onSafeWaterPreset,
              })}
              {expandedSections.includes('water') ? renderCheckRows(waterOptions, activePlaceFilters, onToggleWater) : null}
            </View>

            <View style={styles.group}>
              {renderSectionRow({
                icon: 'bed-outline',
                iconColor: '#6366f1',
                title: 'Camps & Stays',
                summary: 'Private stays, glamping, lodging-style camps',
                expanded: expandedSections.includes('stays'),
                actionLabel: 'Show all',
                onPress: () => onToggleSection('stays'),
                onActionPress: onEnableAllStays,
              })}
              {expandedSections.includes('stays') ? renderCheckRows(stayOptions, activePlaceFilters, onToggleStay) : null}
            </View>

            <View style={styles.group}>
              {renderSectionRow({
                icon: 'sparkles-outline',
                iconColor: '#06b6d4',
                title: 'Services',
                summary: 'Food, groceries, lodging, repairs, medical, and connection',
                expanded: expandedSections.includes('explore-services'),
                actionLabel: exploreCategoriesUnlocked ? undefined : (categoryUnlocking ? 'Adding' : 'Show'),
                actionDisabled: categoryUnlocking,
                onPress: () => onToggleSection('explore-services'),
                onActionPress: onUnlockExplore,
              })}
              {expandedSections.includes('explore-services')
                ? renderCheckRows(exploreOptions, activePlaceFilters, onToggleExplore, disabledExploreIds)
                : null}
            </View>

            <View style={styles.group}>
              {renderSectionRow({
                icon: 'people-outline',
                iconColor: '#22c55e',
                title: 'Community notes',
                summary: communityFilterSummary,
                expanded: expandedSections.includes('community'),
                actionLabel: 'Default',
                onPress: () => onToggleSection('community'),
                onActionPress: onResetCommunityDefault,
              })}
              {expandedSections.includes('community') ? (
                <>
                  <View style={styles.pinHint}>
                    <Ionicons name="shield-checkmark-outline" size={12} color={C.text3} />
                    <Text style={styles.pinHintText}>Default shows shared notes and keeps GPX imports hidden.</Text>
                  </View>
                  {renderCheckRows(pinOptions, activePinFilters, onTogglePin)}
                </>
              ) : null}
            </View>

            <View style={styles.group}>
              {renderSectionRow({
                icon: 'partly-sunny-outline',
                iconColor: '#f59e0b',
                title: 'Weather & trails',
                summary: 'Radar, trails, public land, topo, and water safety',
                expanded: expandedSections.includes('weather-layers'),
                onPress: () => onToggleSection('weather-layers'),
              })}
              {expandedSections.includes('weather-layers') ? renderToggleRows(weatherLayerItems) : null}
            </View>

            </ScrollView>
          </TrailheadSheet>
        </View>
      </Modal>
  );
}

function makeStyles(C: ColorPalette) {
  return StyleSheet.create({
    overlay: {
      flex: 1,
      justifyContent: 'flex-end',
      backgroundColor: 'rgba(0,0,0,0.42)',
    },
    androidOverlay: {
      zIndex: 20000,
      elevation: 200,
    },
    iosOverlay: {
      paddingBottom: 0,
    },
    sheet: {
      alignSelf: 'stretch',
      backgroundColor: C.bg,
      borderTopLeftRadius: 20,
      borderTopRightRadius: 20,
      borderTopWidth: 1,
      borderColor: C.border,
      paddingTop: 14,
    },
    iosSheet: {
      maxHeight: undefined,
      paddingBottom: 0,
      borderBottomLeftRadius: 0,
      borderBottomRightRadius: 0,
    },
    androidSheet: {
      maxHeight: undefined,
      minHeight: 360,
      alignSelf: 'stretch',
      paddingBottom: 0,
      borderBottomLeftRadius: 0,
      borderBottomRightRadius: 0,
      zIndex: 20001,
      elevation: 201,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 16,
      paddingBottom: 12,
      borderBottomWidth: 1,
      borderColor: C.border,
      gap: 12,
    },
    headerCopy: {
      flex: 1,
      minWidth: 0,
    },
    title: {
      color: C.text,
      fontSize: 15,
      fontFamily: mono,
      fontWeight: '900',
      letterSpacing: 1,
    },
    sub: {
      color: C.text3,
      fontSize: 10,
      fontFamily: mono,
      marginTop: 3,
    },
    headerActions: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    closeBtn: {
      width: 34,
      height: 34,
      borderRadius: 17,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: C.s1,
      borderWidth: 1,
      borderColor: C.border,
    },
    resetBtn: {
      minHeight: 34,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: 17,
      paddingHorizontal: 10,
      backgroundColor: C.s1,
      borderWidth: 1,
      borderColor: C.border,
    },
    resetText: {
      color: '#14b8a6',
      fontSize: 9,
      fontFamily: mono,
      fontWeight: '900',
    },
    scroll: { flex: 1, minHeight: 0 },
    scrollContent: { paddingBottom: 28 },
    sheetLoadingRow: {
      marginHorizontal: 12,
      marginBottom: 10,
    },
    group: {
      marginHorizontal: 12,
      marginBottom: 10,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: C.border,
      backgroundColor: C.s1,
      overflow: 'hidden',
    },
    filterSectionRow: {
      minHeight: 58,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingHorizontal: 12,
      paddingVertical: 10,
    },
    filterSectionIcon: {
      width: 34,
      height: 34,
      borderRadius: 8,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: C.s2,
      borderWidth: 1,
      borderColor: C.border,
    },
    filterSectionCopy: {
      flex: 1,
      minWidth: 0,
    },
    filterSectionRowTitle: {
      color: C.text,
      fontSize: 14,
      lineHeight: 18,
      fontWeight: '900',
    },
    filterSectionRowSub: {
      color: C.text3,
      fontSize: 11,
      lineHeight: 15,
      marginTop: 2,
    },
    filterClearText: {
      color: '#14b8a6',
      fontSize: 9,
      fontFamily: mono,
      fontWeight: '900',
    },
    filterActionDisabled: {
      opacity: 0.52,
    },
    filterToggleList: {
      borderTopWidth: 1,
      borderColor: C.border,
      backgroundColor: C.bg,
    },
    filterToggleRow: {
      minHeight: 54,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingHorizontal: 12,
      paddingVertical: 10,
      borderBottomWidth: 1,
      borderColor: C.border,
    },
    filterSwitch: {
      width: 42,
      height: 24,
      borderRadius: 12,
      padding: 3,
      backgroundColor: C.s3,
      borderWidth: 1,
      borderColor: C.border,
    },
    filterSwitchOn: {
      backgroundColor: '#14b8a6',
      borderColor: '#14b8a6',
    },
    filterSwitchKnob: {
      width: 16,
      height: 16,
      borderRadius: 8,
      backgroundColor: C.text3,
    },
    filterSwitchKnobOn: {
      backgroundColor: '#fff',
      transform: [{ translateX: 18 }],
    },
    filterOptionList: {
      borderTopWidth: 1,
      borderColor: C.border,
      backgroundColor: C.bg,
    },
    filterOptionRow: {
      minHeight: 48,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingHorizontal: 12,
      paddingVertical: 9,
      borderBottomWidth: 1,
      borderColor: C.border,
    },
    filterOptionRowDisabled: {
      opacity: 0.62,
    },
    filterOptionCheck: {
      width: 20,
      height: 20,
      borderRadius: 6,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1,
      borderColor: C.border2,
      backgroundColor: C.s2,
    },
    filterOptionText: {
      flex: 1,
      minWidth: 0,
      color: C.text,
      fontSize: 13,
      lineHeight: 18,
      fontWeight: '800',
    },
    hintText: {
      color: C.text3,
      fontSize: 10,
      fontFamily: mono,
      lineHeight: 14,
      paddingHorizontal: 16,
      paddingTop: 6,
    },
    pinHint: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 6,
      marginHorizontal: 14,
      marginTop: 7,
      marginBottom: 2,
      paddingHorizontal: 10,
      paddingVertical: 8,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: C.border,
      backgroundColor: C.s2,
    },
    pinHintText: {
      flex: 1,
      color: C.text3,
      fontSize: 10,
      lineHeight: 14,
      fontFamily: mono,
    },
  });
}
