import React, { useMemo } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { mono, useTheme, type ColorPalette } from '@/lib/design';
import { MAP_MODE_PRESETS, type MapModePreset, type MapModePresetId } from '@/lib/mapLegend';

type Props = {
  activePresetId: MapModePresetId;
  onSelectPreset: (presetId: MapModePresetId) => void;
  onOpenLegend: () => void;
};

export default function MapModeGallery({ activePresetId, onSelectPreset, onOpenLegend }: Props) {
  const C = useTheme();
  const s = useMemo(() => makeStyles(C), [C]);

  return (
    <View style={s.wrap}>
      <View style={s.headerRow}>
        <View style={s.headerCopy}>
          <Text style={s.kicker}>MAP MODES</Text>
          <Text style={s.headerSub}>Pick the map for the job. You can still adjust every layer below.</Text>
        </View>
        <TouchableOpacity style={s.legendButton} activeOpacity={0.82} onPress={onOpenLegend}>
          <Ionicons name="list-outline" size={15} color={C.text2} />
          <Text style={s.legendButtonText}>Legend</Text>
        </TouchableOpacity>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.rail}>
        {MAP_MODE_PRESETS.map(preset => (
          <ModeCard
            key={preset.id}
            preset={preset}
            active={preset.id === activePresetId}
            onPress={() => onSelectPreset(preset.id)}
          />
        ))}
      </ScrollView>
    </View>
  );
}

function ModeCard({ preset, active, onPress }: { preset: MapModePreset; active: boolean; onPress: () => void }) {
  const C = useTheme();
  const s = useMemo(() => makeStyles(C), [C]);
  const [base, land, water, accent] = preset.colors;

  return (
    <TouchableOpacity
      style={[s.card, active && { borderColor: accent, backgroundColor: accent + '12' }]}
      activeOpacity={0.86}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Use ${preset.title} map mode`}
    >
      <View style={[s.preview, { backgroundColor: base }]}>
        <View style={[s.previewLand, { backgroundColor: land }]} />
        <View style={[s.previewWater, { backgroundColor: water }]} />
        <View style={[s.previewRoad, { backgroundColor: '#ffffff99' }]} />
        <View style={[s.previewRoad, s.previewRoadAlt, { backgroundColor: accent }]} />
        <View style={[s.previewPin, { left: 18, top: 17, backgroundColor: accent }]} />
        <View style={[s.previewPin, { left: 62, top: 32, backgroundColor: water }]} />
        <View style={s.previewIconStrip}>
          {preset.icons.slice(0, 3).map(icon => (
            <View key={icon} style={s.previewIconBubble}>
              <Ionicons name={icon} size={12} color="#fff" />
            </View>
          ))}
        </View>
        {active ? (
          <View style={s.activeDot}>
            <Ionicons name="checkmark" size={11} color="#020617" />
          </View>
        ) : null}
      </View>

      <View style={s.titleRow}>
        <Text style={s.cardTitle} numberOfLines={1}>{preset.title}</Text>
        <View style={[s.bestPill, { borderColor: accent + '66' }]}>
          <Text style={[s.bestText, { color: accent }]} numberOfLines={1}>{preset.bestFor}</Text>
        </View>
      </View>
      <Text style={s.cardPurpose} numberOfLines={2}>{preset.purpose}</Text>
      <View style={s.sourceRow}>
        <Ionicons name="shield-checkmark-outline" size={12} color={C.text3} />
        <Text style={s.sourceText} numberOfLines={1}>{preset.trust}</Text>
      </View>
    </TouchableOpacity>
  );
}

function makeStyles(C: ColorPalette) {
  return StyleSheet.create({
    wrap: {
      paddingTop: 12,
      paddingBottom: 8,
    },
    headerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingHorizontal: 14,
      paddingBottom: 9,
    },
    headerCopy: {
      flex: 1,
      minWidth: 0,
    },
    kicker: {
      color: C.text,
      fontSize: 11,
      fontFamily: mono,
      fontWeight: '900',
      letterSpacing: 0.8,
    },
    headerSub: {
      color: C.text3,
      fontSize: 10,
      lineHeight: 14,
      marginTop: 3,
    },
    legendButton: {
      minHeight: 34,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
      borderRadius: 8,
      paddingHorizontal: 10,
      borderWidth: 1,
      borderColor: C.border,
      backgroundColor: C.s1,
    },
    legendButtonText: {
      color: C.text2,
      fontSize: 10,
      fontFamily: mono,
      fontWeight: '900',
    },
    rail: {
      gap: 10,
      paddingHorizontal: 14,
      paddingBottom: 2,
    },
    card: {
      width: 206,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: C.border,
      backgroundColor: C.s1,
      padding: 10,
    },
    preview: {
      height: 76,
      borderRadius: 8,
      overflow: 'hidden',
      borderWidth: 1,
      borderColor: 'rgba(255,255,255,0.16)',
      marginBottom: 10,
    },
    previewLand: {
      position: 'absolute',
      left: -18,
      top: 12,
      width: 116,
      height: 58,
      borderRadius: 34,
      transform: [{ rotate: '-12deg' }],
      opacity: 0.82,
    },
    previewWater: {
      position: 'absolute',
      right: -22,
      top: 7,
      width: 92,
      height: 64,
      borderRadius: 34,
      opacity: 0.84,
    },
    previewRoad: {
      position: 'absolute',
      left: -10,
      top: 42,
      width: 170,
      height: 5,
      borderRadius: 4,
      transform: [{ rotate: '-10deg' }],
    },
    previewRoadAlt: {
      top: 24,
      left: 18,
      width: 116,
      height: 4,
      transform: [{ rotate: '19deg' }],
    },
    previewPin: {
      position: 'absolute',
      width: 14,
      height: 14,
      borderRadius: 7,
      borderWidth: 2,
      borderColor: '#fff',
    },
    previewIconStrip: {
      position: 'absolute',
      left: 8,
      bottom: 7,
      flexDirection: 'row',
      gap: 4,
    },
    previewIconBubble: {
      width: 22,
      height: 22,
      borderRadius: 8,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: 'rgba(2,6,23,0.68)',
      borderWidth: 1,
      borderColor: 'rgba(255,255,255,0.22)',
    },
    activeDot: {
      position: 'absolute',
      right: 7,
      top: 7,
      width: 20,
      height: 20,
      borderRadius: 10,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: '#fff',
    },
    titleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 7,
    },
    cardTitle: {
      flex: 1,
      minWidth: 0,
      color: C.text,
      fontSize: 14,
      lineHeight: 18,
      fontWeight: '900',
    },
    bestPill: {
      maxWidth: 82,
      borderRadius: 8,
      borderWidth: 1,
      paddingHorizontal: 6,
      paddingVertical: 3,
      backgroundColor: C.s2,
    },
    bestText: {
      fontSize: 8,
      fontFamily: mono,
      fontWeight: '900',
      textTransform: 'uppercase',
    },
    cardPurpose: {
      minHeight: 34,
      color: C.text2,
      fontSize: 11,
      lineHeight: 16,
      marginTop: 4,
    },
    sourceRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
      marginTop: 7,
    },
    sourceText: {
      flex: 1,
      minWidth: 0,
      color: C.text3,
      fontSize: 9,
      fontFamily: mono,
      fontWeight: '800',
    },
  });
}
