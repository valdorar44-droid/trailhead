import React, { useMemo } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { mono, useTheme, type ColorPalette } from '@/lib/design';

export type LayerMapStyleOption = {
  id: string;
  title: string;
  sub: string;
  colors: [string, string, string];
};

export type LayerToggleItem = {
  key: string;
  label: string;
  sub: string;
  icon: keyof typeof Ionicons.glyphMap;
  val: boolean;
  color: string;
  onPress: () => void;
};

export type PremiumMapItem = {
  id: string;
  label: string;
  sub: string;
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
  active: boolean;
  onPress: () => void;
};

export type ExplorerFeatureItem = {
  key: string;
  label: string;
  sub: string;
  icon: keyof typeof Ionicons.glyphMap;
  val: boolean;
  color: string;
  enabled: boolean;
  onPress: () => void;
};

export type LegendItem = {
  color: string;
  label: string;
};

type Props = {
  mapStyleOptions: readonly LayerMapStyleOption[];
  activeMapLayer: string;
  onSelectMapLayer: (id: string) => void;
  extremeMapLayerActive: boolean;
  layerItems: readonly LayerToggleItem[];
  premiumMapVisible: boolean;
  premiumMapItems: readonly PremiumMapItem[];
  extremeFeatureItems: readonly ExplorerFeatureItem[];
  safeWaterLegendVisible: boolean;
  safeWaterLegendItems: readonly LegendItem[];
  safeWaterSummary: string;
  safeWaterStationSummary?: string | null;
  safeWaterDisclosure: string;
  conditionLegendVisible: boolean;
  conditionLegendTitle: string;
  trailLegendItems: readonly LegendItem[];
  mvumLegendItems: readonly LegendItem[];
  avalancheLegendItems: readonly LegendItem[];
  mvumNote?: string | null;
};

export default function MapLayerSheetContent({
  mapStyleOptions,
  activeMapLayer,
  onSelectMapLayer,
  extremeMapLayerActive,
  layerItems,
  premiumMapVisible,
  premiumMapItems,
  extremeFeatureItems,
  safeWaterLegendVisible,
  safeWaterLegendItems,
  safeWaterSummary,
  safeWaterStationSummary,
  safeWaterDisclosure,
  conditionLegendVisible,
  conditionLegendTitle,
  trailLegendItems,
  mvumLegendItems,
  avalancheLegendItems,
  mvumNote,
}: Props) {
  const C = useTheme();
  const s = useMemo(() => makeStyles(C), [C]);

  const renderLayerMiniPreview = (layer: { key: string; color: string; icon: keyof typeof Ionicons.glyphMap; val: boolean }) => {
    const activeDot = layer.val ? <View style={[s.layerToggleOnDot, { backgroundColor: layer.color }]} /> : null;
    const baseStyle = [s.layerTogglePreview, { borderColor: layer.color + '55', backgroundColor: layer.color + '14' }];

    if (layer.key === '3d') {
      return (
        <View style={baseStyle}>
          <View style={[s.layerPreviewHorizon, { backgroundColor: '#38bdf824' }]} />
          <View style={[s.layerPreviewPeak, { backgroundColor: '#365314' }]} />
          <View style={[s.layerPreviewPeak, s.layerPreviewPeakAlt, { backgroundColor: '#65a30d' }]} />
          <View style={[s.layerPreviewBuilding, { left: 46, height: 28 }]} />
          <View style={[s.layerPreviewBuilding, { left: 57, height: 18, opacity: 0.75 }]} />
          {activeDot}
        </View>
      );
    }
    if (layer.key === 'lands') {
      return (
        <View style={baseStyle}>
          <View style={[s.layerPreviewPatch, { left: 8, top: 10, width: 42, height: 26, backgroundColor: '#22c55e55' }]} />
          <View style={[s.layerPreviewPatch, { right: 10, bottom: 8, width: 34, height: 24, backgroundColor: '#f59e0b4c' }]} />
          <View style={[s.layerPreviewLine, { top: 39, left: -5, backgroundColor: '#ffffffa8', transform: [{ rotate: '-13deg' }] }]} />
          {activeDot}
        </View>
      );
    }
    if (layer.key === 'usgs') {
      return (
        <View style={baseStyle}>
          {[10, 22, 34, 46].map((top, idx) => (
            <View key={top} style={[s.layerPreviewContour, { top, left: idx % 2 ? 8 : -8, borderColor: '#d97706aa' }]} />
          ))}
          <View style={[s.layerPreviewLine, { top: 30, backgroundColor: '#0ea5e9aa', transform: [{ rotate: '18deg' }] }]} />
          {activeDot}
        </View>
      );
    }
    if (layer.key === 'pois') {
      return (
        <View style={baseStyle}>
          {[['#f97316', 12, 16], ['#38bdf8', 34, 10], ['#22c55e', 54, 28], ['#eab308', 24, 38]].map(([color, left, top]) => (
            <View key={`${left}-${top}`} style={[s.layerPreviewPin, { left: Number(left), top: Number(top), backgroundColor: String(color) }]} />
          ))}
          <View style={[s.layerPreviewLine, { top: 34, backgroundColor: '#ffffff66' }]} />
          {activeDot}
        </View>
      );
    }
    if (layer.key === 'trails') {
      return (
        <View style={baseStyle}>
          <View style={[s.layerPreviewTrailDash, { left: 5, top: 40, transform: [{ rotate: '-14deg' }] }]} />
          <View style={[s.layerPreviewTrailDash, { left: 26, top: 35, transform: [{ rotate: '-14deg' }] }]} />
          <View style={[s.layerPreviewTrailDash, { left: 47, top: 29, transform: [{ rotate: '-14deg' }] }]} />
          <View style={[s.layerPreviewLine, { top: 19, backgroundColor: '#ef4444aa', transform: [{ rotate: '10deg' }] }]} />
          {activeDot}
        </View>
      );
    }
    if (layer.key === 'nautical') {
      return (
        <View style={baseStyle}>
          <View style={[s.layerPreviewWaterBand, { backgroundColor: '#0891b255' }]} />
          <View style={[s.layerPreviewLine, { top: 37, backgroundColor: '#38bdf8cc', transform: [{ rotate: '-8deg' }] }]} />
          <View style={[s.layerPreviewHazard, { left: 48, top: 16 }]} />
          <View style={[s.layerPreviewBuoy, { left: 19, top: 27, backgroundColor: '#22c55e' }]} />
          {activeDot}
        </View>
      );
    }
    if (layer.key === 'fire') {
      return (
        <View style={baseStyle}>
          <View style={[s.layerPreviewPatch, { left: 15, top: 12, width: 46, height: 35, backgroundColor: '#ef444455' }]} />
          <View style={[s.layerPreviewPatch, { left: 29, top: 20, width: 26, height: 19, backgroundColor: '#f97316aa' }]} />
          <Ionicons name="flame" size={16} color="#fff" />
          {activeDot}
        </View>
      );
    }
    if (layer.key === 'ava') {
      return (
        <View style={baseStyle}>
          {['#22c55e', '#facc15', '#f97316', '#ef4444'].map((color, idx) => (
            <View key={color} style={[s.layerPreviewAvaBand, { left: idx * 19, backgroundColor: color }]} />
          ))}
          <View style={[s.layerPreviewPeak, { backgroundColor: '#ffffff55', bottom: -6 }]} />
          {activeDot}
        </View>
      );
    }
    if (layer.key === 'radar') {
      return (
        <View style={baseStyle}>
          <View style={[s.layerPreviewRainBand, { left: 8, top: 34, backgroundColor: '#22c55e88' }]} />
          <View style={[s.layerPreviewRainBand, { left: 22, top: 25, backgroundColor: '#38bdf8aa', transform: [{ rotate: '-18deg' }] }]} />
          <View style={[s.layerPreviewRainBand, { left: 42, top: 38, backgroundColor: '#facc15aa', transform: [{ rotate: '16deg' }] }]} />
          <View style={s.layerPreviewCloud}>
            <Ionicons name="rainy-outline" size={22} color="#e0f2fe" />
          </View>
          <View style={s.layerPreviewRadarSweep} />
          {activeDot}
        </View>
      );
    }
    if (layer.key === 'mvum') {
      return (
        <View style={baseStyle}>
          <View style={[s.layerPreviewLine, { top: 17, backgroundColor: '#22c55e', transform: [{ rotate: '7deg' }] }]} />
          <View style={[s.layerPreviewLine, { top: 32, backgroundColor: '#f97316', transform: [{ rotate: '-18deg' }] }]} />
          <View style={[s.layerPreviewLine, { top: 47, backgroundColor: '#ef4444', transform: [{ rotate: '16deg' }] }]} />
          {activeDot}
        </View>
      );
    }
    return (
      <View style={baseStyle}>
        <Ionicons name={layer.icon as any} size={22} color={layer.val ? '#fff' : layer.color} />
        {activeDot}
      </View>
    );
  };

  return (
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={s.sheetContent}>
      <Text style={s.sectionHead}>MAP STYLE</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.carousel}>
        {mapStyleOptions.slice(0, 1).map(option => {
          const active = option.id === activeMapLayer;
          return (
            <TouchableOpacity
              key={option.id}
              style={[s.styleCard, active && s.styleCardActive]}
              activeOpacity={0.86}
              onPress={() => onSelectMapLayer(option.id)}
            >
              <View style={[s.stylePreview, { backgroundColor: option.colors[0] }]}>
                <View style={[s.mapStylePreviewWater, { backgroundColor: option.colors[2] }]} />
                <View style={[s.mapStylePreviewLand, { backgroundColor: option.colors[1] }]} />
                <View style={s.mapStylePreviewRoad} />
                <View style={[s.mapStylePreviewRoad, s.mapStylePreviewRoadAlt]} />
              </View>
              <View style={s.styleCardText}>
                <Text style={s.styleTitle} numberOfLines={1}>{option.title}</Text>
                <Text style={s.styleSub} numberOfLines={1}>{option.sub}</Text>
              </View>
              {active ? <Ionicons name="checkmark-circle" size={17} color={C.green} /> : null}
            </TouchableOpacity>
          );
        })}
        {premiumMapVisible ? premiumMapItems.map(option => (
          <TouchableOpacity
            key={`mapbox-${option.id}`}
            style={[
              s.styleCard,
              s.mapboxStyleCard,
              extremeMapLayerActive && option.active && { borderColor: option.color + '88', backgroundColor: option.color + '16' },
            ]}
            activeOpacity={0.86}
            onPress={option.onPress}
          >
            <View style={[s.mapboxStylePreview, { borderColor: option.color + '55', backgroundColor: option.color + '14' }]}>
              <Ionicons name={option.icon} size={24} color={option.color} />
              {extremeMapLayerActive && option.active ? <View style={[s.layerToggleOnDot, { backgroundColor: option.color }]} /> : null}
            </View>
            <View style={s.styleCardText}>
              <Text style={s.styleTitle} numberOfLines={1}>{option.label}</Text>
              <Text style={s.styleSub} numberOfLines={1}>{option.sub}</Text>
            </View>
            {extremeMapLayerActive && option.active ? <Ionicons name="checkmark-circle" size={17} color={option.color} /> : null}
          </TouchableOpacity>
        )) : null}
        {mapStyleOptions.slice(1).map(option => {
          const active = option.id === activeMapLayer;
          return (
            <TouchableOpacity
              key={option.id}
              style={[s.styleCard, active && s.styleCardActive]}
              activeOpacity={0.86}
              onPress={() => onSelectMapLayer(option.id)}
            >
              <View style={[s.stylePreview, { backgroundColor: option.colors[0] }]}>
                <View style={[s.mapStylePreviewWater, { backgroundColor: option.colors[2] }]} />
                <View style={[s.mapStylePreviewLand, { backgroundColor: option.colors[1] }]} />
                <View style={s.mapStylePreviewRoad} />
                <View style={[s.mapStylePreviewRoad, s.mapStylePreviewRoadAlt]} />
              </View>
              <View style={s.styleCardText}>
                <Text style={s.styleTitle} numberOfLines={1}>{option.title}</Text>
                <Text style={s.styleSub} numberOfLines={1}>{option.sub}</Text>
              </View>
              {active ? <Ionicons name="checkmark-circle" size={17} color={C.green} /> : null}
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      <Text style={s.sectionHead}>LAYERS</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.carousel}>
        {layerItems.map(layer => (
          <TouchableOpacity
            key={layer.key}
            style={[s.toggleCard, layer.val && { borderColor: layer.color + '88', backgroundColor: layer.color + '16' }]}
            activeOpacity={0.86}
            onPress={layer.onPress}
          >
            {renderLayerMiniPreview(layer)}
            <Text style={s.styleTitle} numberOfLines={1}>{layer.label}</Text>
            <Text style={s.styleSub} numberOfLines={1}>{layer.sub}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {premiumMapVisible ? (
        <>
          <Text style={s.sectionHead}>EXPLORER TOOLS</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.carousel}>
            {extremeFeatureItems.map(layer => (
              <TouchableOpacity
                key={layer.key}
                style={[
                  s.toggleCard,
                  layer.val && { borderColor: layer.color + '88', backgroundColor: layer.color + '16' },
                  !layer.enabled && { opacity: 0.55 },
                ]}
                activeOpacity={0.86}
                onPress={layer.onPress}
              >
                <View style={[s.layerTogglePreview, { borderColor: layer.color + '55', backgroundColor: layer.color + '14' }]}>
                  <Ionicons name={layer.icon} size={22} color={layer.color} />
                  {layer.val ? <View style={[s.layerToggleOnDot, { backgroundColor: layer.color }]} /> : null}
                </View>
                <Text style={s.styleTitle} numberOfLines={1}>{layer.label}</Text>
                <Text style={s.styleSub} numberOfLines={1}>{layer.enabled ? layer.sub : 'Explorer'}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </>
      ) : null}

      {safeWaterLegendVisible ? (
        <View style={s.legendSection}>
          <Text style={s.sectionHead}>SAFE WATER LEGEND</Text>
          {safeWaterLegendItems.map(item => (
            <View key={item.label} style={s.legendRow}>
              <View style={[s.legendBar, { backgroundColor: item.color }]} />
              <Text style={s.legendText}>{item.label}</Text>
            </View>
          ))}
          <Text style={s.legendMeta}>{safeWaterSummary}</Text>
          {safeWaterStationSummary ? <Text style={s.legendMetaStrong}>{safeWaterStationSummary}</Text> : null}
          <Text style={s.legendMeta}>{safeWaterDisclosure}</Text>
        </View>
      ) : null}

      {conditionLegendVisible ? (
        <View style={s.legendSection}>
          <Text style={s.sectionHead}>{conditionLegendTitle}</Text>
          {trailLegendItems.map(item => (
            <View key={item.label} style={s.legendRow}>
              <View style={[s.legendBar, { backgroundColor: item.color }]} />
              <Text style={s.legendText}>{item.label}</Text>
            </View>
          ))}
          {trailLegendItems.length > 0 && mvumLegendItems.length > 0 ? (
            <Text style={[s.sectionHead, { paddingHorizontal: 0, marginTop: 10 }]}>MVUM LEGEND</Text>
          ) : null}
          {mvumLegendItems.map(item => (
            <View key={item.label} style={s.legendRow}>
              <View style={[s.legendBar, { backgroundColor: item.color }]} />
              <Text style={s.legendText}>{item.label}</Text>
            </View>
          ))}
          {mvumNote ? <Text style={s.legendMeta}>{mvumNote}</Text> : null}
          {avalancheLegendItems.length > 0 ? (
            <>
              {(trailLegendItems.length > 0 || mvumLegendItems.length > 0) ? (
                <Text style={[s.sectionHead, { paddingHorizontal: 0, marginTop: 10 }]}>AVALANCHE LEGEND</Text>
              ) : null}
              <View style={s.avaRow}>
                {avalancheLegendItems.map(item => (
                  <View key={item.label} style={s.avaItem}>
                    <View style={[s.avaDot, { backgroundColor: item.color }]} />
                    <Text style={s.avaText}>{item.label}</Text>
                  </View>
                ))}
              </View>
              <Text style={s.legendMeta}>Avalanche danger levels</Text>
            </>
          ) : null}
        </View>
      ) : null}

      <View style={{ height: 40 }} />
    </ScrollView>
  );
}

const makeStyles = (C: ColorPalette) => StyleSheet.create({
  sheetContent: {
    paddingBottom: 16,
  },
  sectionHead: {
    color: C.text3,
    fontSize: 10,
    fontWeight: '800',
    fontFamily: mono,
    letterSpacing: 1.5,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 7,
  },
  carousel: {
    gap: 10,
    paddingHorizontal: 16,
    paddingBottom: 10,
  },
  styleCard: {
    width: 142,
    minHeight: 128,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.s1,
    padding: 9,
    gap: 7,
  },
  styleCardActive: {
    borderColor: C.green + '88',
    backgroundColor: C.green + '12',
  },
  mapboxStyleCard: {
    borderColor: 'rgba(255,255,255,0.12)',
    backgroundColor: 'rgba(255,255,255,0.055)',
  },
  stylePreview: {
    height: 64,
    borderRadius: 11,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
  },
  styleCardText: {
    minHeight: 30,
  },
  styleTitle: {
    color: C.text,
    fontSize: 12,
    fontFamily: mono,
    fontWeight: '900',
  },
  styleSub: {
    color: C.text3,
    fontSize: 9,
    fontFamily: mono,
    marginTop: 2,
  },
  mapboxStylePreview: {
    height: 64,
    borderRadius: 11,
    overflow: 'hidden',
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  toggleCard: {
    width: 142,
    minHeight: 128,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.s1,
    padding: 9,
    gap: 7,
  },
  layerTogglePreview: {
    height: 64,
    borderRadius: 11,
    overflow: 'hidden',
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  layerToggleOnDot: {
    position: 'absolute',
    right: 8,
    top: 8,
    width: 9,
    height: 9,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: '#fff',
  },
  mapStylePreviewWater: {
    position: 'absolute',
    right: -8,
    top: -10,
    width: 34,
    height: 64,
    borderRadius: 18,
    transform: [{ rotate: '16deg' }],
  },
  mapStylePreviewLand: {
    position: 'absolute',
    left: 5,
    bottom: 5,
    width: 25,
    height: 17,
    borderRadius: 9,
    opacity: 0.82,
  },
  mapStylePreviewRoad: {
    position: 'absolute',
    left: -5,
    top: 17,
    width: 70,
    height: 3,
    borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.82)',
    transform: [{ rotate: '-17deg' }],
  },
  mapStylePreviewRoadAlt: {
    top: 28,
    height: 2,
    opacity: 0.7,
    transform: [{ rotate: '13deg' }],
  },
  layerPreviewHorizon: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    height: 30,
  },
  layerPreviewPeak: {
    position: 'absolute',
    left: 9,
    bottom: -16,
    width: 50,
    height: 50,
    borderRadius: 8,
    transform: [{ rotate: '45deg' }],
  },
  layerPreviewPeakAlt: {
    left: 34,
    bottom: -24,
    width: 58,
    height: 58,
    opacity: 0.9,
  },
  layerPreviewBuilding: {
    position: 'absolute',
    bottom: 10,
    width: 8,
    borderRadius: 2,
    backgroundColor: '#f8fafc',
  },
  layerPreviewPatch: {
    position: 'absolute',
    borderRadius: 18,
  },
  layerPreviewLine: {
    position: 'absolute',
    left: -8,
    width: 102,
    height: 4,
    borderRadius: 4,
  },
  layerPreviewContour: {
    position: 'absolute',
    width: 82,
    height: 28,
    borderRadius: 28,
    borderWidth: 1,
    opacity: 0.88,
  },
  layerPreviewPin: {
    position: 'absolute',
    width: 10,
    height: 10,
    borderRadius: 5,
    borderWidth: 2,
    borderColor: '#fff',
  },
  layerPreviewTrailDash: {
    position: 'absolute',
    width: 16,
    height: 5,
    borderRadius: 5,
    backgroundColor: '#22c55e',
  },
  layerPreviewWaterBand: {
    position: 'absolute',
    left: -16,
    right: -16,
    top: 26,
    height: 36,
    borderRadius: 26,
    transform: [{ rotate: '-8deg' }],
  },
  layerPreviewHazard: {
    position: 'absolute',
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: '#fff',
    backgroundColor: '#ef4444',
  },
  layerPreviewBuoy: {
    position: 'absolute',
    width: 10,
    height: 18,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: '#fff',
  },
  layerPreviewAvaBand: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 20,
    opacity: 0.72,
  },
  layerPreviewRainBand: {
    position: 'absolute',
    width: 28,
    height: 14,
    borderRadius: 8,
    opacity: 0.9,
  },
  layerPreviewCloud: {
    position: 'absolute',
    left: 18,
    top: 11,
    width: 38,
    height: 30,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(14,165,233,0.82)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.55)',
  },
  layerPreviewRadarSweep: {
    position: 'absolute',
    left: 34,
    top: 30,
    width: 34,
    height: 3,
    borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.75)',
    transform: [{ rotate: '-12deg' }],
  },
  legendSection: {
    paddingHorizontal: 16,
    paddingBottom: 8,
    gap: 6,
  },
  legendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  legendBar: {
    width: 22,
    height: 4,
    borderRadius: 2,
  },
  legendText: {
    color: C.text2,
    fontSize: 11,
    fontFamily: mono,
  },
  legendMeta: {
    color: C.text3,
    fontSize: 10,
    fontFamily: mono,
    lineHeight: 14,
  },
  legendMetaStrong: {
    color: C.text2,
    fontSize: 10,
    fontFamily: mono,
    lineHeight: 14,
  },
  avaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 4,
  },
  avaItem: {
    alignItems: 'center',
    gap: 2,
  },
  avaDot: {
    width: 16,
    height: 16,
    borderRadius: 8,
  },
  avaText: {
    color: C.text3,
    fontSize: 8,
    fontFamily: mono,
  },
});
