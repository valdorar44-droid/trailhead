import React, { useEffect, useMemo, useState } from 'react';
import { Modal, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { TrailheadSheet } from '@/components/TrailheadUI';
import { mono, useTheme, type ColorPalette } from '@/lib/design';
import {
  MAP_LEGEND_CATEGORIES,
  type MapLegendCategory,
  type MapLegendCategoryId,
  type MapLegendItem,
} from '@/lib/mapLegend';

type Props = {
  visible: boolean;
  focusCategory: MapLegendCategoryId;
  contextLabel?: string;
  onClose: () => void;
};

export default function MapLegendSheet({ visible, focusCategory, contextLabel, onClose }: Props) {
  const C = useTheme();
  const s = useMemo(() => makeStyles(C), [C]);
  const [activeCategory, setActiveCategory] = useState<MapLegendCategoryId>(focusCategory);

  useEffect(() => {
    if (visible) setActiveCategory(focusCategory);
  }, [focusCategory, visible]);

  const active = MAP_LEGEND_CATEGORIES.find(category => category.id === activeCategory) ?? MAP_LEGEND_CATEGORIES[0];

  return (
    <Modal visible={visible} animationType="slide" transparent statusBarTranslucent onRequestClose={onClose}>
      <View style={s.overlay}>
        <TouchableOpacity style={StyleSheet.absoluteFillObject} activeOpacity={1} onPress={onClose} />
        <TrailheadSheet
          handle={false}
          style={Platform.OS === 'android' ? [s.sheet, { maxHeight: '88%' }] : s.sheet}
          contentStyle={{ padding: 0 }}
        >
          <View style={s.header}>
            <View style={s.headerCopy}>
              <Text style={s.title}>MAP LEGEND</Text>
              <Text style={s.sub} numberOfLines={1}>{contextLabel ? `${contextLabel} mode` : 'Pins, lines, layers, and source trust'}</Text>
            </View>
            <TouchableOpacity onPress={onClose} style={s.closeBtn}>
              <Ionicons name="close" size={20} color={C.text2} />
            </TouchableOpacity>
          </View>

          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.tabRail}>
            {MAP_LEGEND_CATEGORIES.map(category => {
              const selected = category.id === activeCategory;
              return (
                <TouchableOpacity
                  key={category.id}
                  style={[s.tab, selected && { borderColor: category.color, backgroundColor: category.color + '16' }]}
                  activeOpacity={0.84}
                  onPress={() => setActiveCategory(category.id)}
                >
                  <Ionicons name={category.icon} size={15} color={selected ? category.color : C.text3} />
                  <Text style={[s.tabText, selected && { color: C.text }]} numberOfLines={1}>{category.title}</Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={s.content}>
            <CategorySection category={active} />
            <View style={s.sourceBox}>
              <View style={s.sourceIcon}>
                <Ionicons name="shield-checkmark-outline" size={16} color={active.color} />
              </View>
              <Text style={s.sourceText}>{active.source}</Text>
            </View>
            <View style={s.examples}>
              <Text style={s.exampleHead}>SOURCE LINES TO EXPECT</Text>
              <Text style={s.exampleText}>Source: NPS official alert · updated 2h ago</Text>
              <Text style={s.exampleText}>Source: Trailhead report · 3 confirmations · expires in 4h</Text>
              <Text style={s.exampleText}>Source: OSM trail geometry · difficulty inferred</Text>
              <Text style={s.exampleText}>Source: USFS MVUM · legal access map, not live gate status</Text>
            </View>
          </ScrollView>
        </TrailheadSheet>
      </View>
    </Modal>
  );
}

function CategorySection({ category }: { category: MapLegendCategory }) {
  const C = useTheme();
  const s = useMemo(() => makeStyles(C), [C]);
  return (
    <View>
      <View style={s.categoryHeader}>
        <View style={[s.categoryIcon, { borderColor: category.color + '66', backgroundColor: category.color + '16' }]}>
          <Ionicons name={category.icon} size={21} color={category.color} />
        </View>
        <View style={s.categoryCopy}>
          <Text style={s.categoryTitle}>{category.title}</Text>
          <Text style={s.categorySub}>{category.sub}</Text>
        </View>
      </View>
      <View style={s.itemList}>
        {category.items.map(item => (
          <LegendRow key={`${category.id}-${item.label}`} item={item} />
        ))}
      </View>
    </View>
  );
}

function LegendRow({ item }: { item: MapLegendItem }) {
  const C = useTheme();
  const s = useMemo(() => makeStyles(C), [C]);
  return (
    <View style={s.itemRow}>
      <View style={s.glyphWrap}>
        <LegendGlyph item={item} />
      </View>
      <View style={s.itemCopy}>
        <Text style={s.itemLabel}>{item.label}</Text>
        <Text style={s.itemDetail}>{item.detail}</Text>
      </View>
    </View>
  );
}

function LegendGlyph({ item }: { item: MapLegendItem }) {
  const C = useTheme();
  const s = useMemo(() => makeStyles(C), [C]);

  if (item.glyph === 'icon') {
    return (
      <View style={[s.iconGlyph, { backgroundColor: item.color + '22', borderColor: item.color + '66' }]}>
        <Ionicons name={(item.icon ?? 'ellipse') as any} size={17} color={item.color} />
      </View>
    );
  }
  if (item.glyph === 'dot') {
    return <View style={[s.dotGlyph, { backgroundColor: item.color }]} />;
  }
  if (item.glyph === 'dash') {
    return (
      <View style={s.lineGlyph}>
        {[0, 1, 2].map(idx => <View key={idx} style={[s.dashSegment, { backgroundColor: item.color }]} />)}
      </View>
    );
  }
  if (item.glyph === 'dotted') {
    return (
      <View style={s.lineGlyph}>
        {[0, 1, 2, 3].map(idx => <View key={idx} style={[s.dotSegment, { backgroundColor: item.color }]} />)}
      </View>
    );
  }
  return <View style={[s.solidLine, { backgroundColor: item.color }]} />;
}

function makeStyles(C: ColorPalette) {
  return StyleSheet.create({
    overlay: {
      flex: 1,
      justifyContent: 'flex-end',
      backgroundColor: 'rgba(0,0,0,0.48)',
    },
    sheet: {
      maxHeight: '86%',
      backgroundColor: C.bg,
      borderTopLeftRadius: 20,
      borderTopRightRadius: 20,
      borderTopWidth: 1,
      borderColor: C.border,
      paddingTop: 14,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
      paddingHorizontal: 16,
      paddingBottom: 12,
      borderBottomWidth: 1,
      borderColor: C.border,
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
      marginTop: 3,
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
    tabRail: {
      gap: 8,
      paddingHorizontal: 14,
      paddingVertical: 10,
      borderBottomWidth: 1,
      borderColor: C.border,
    },
    tab: {
      minHeight: 34,
      maxWidth: 144,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: C.border,
      backgroundColor: C.s1,
      paddingHorizontal: 10,
    },
    tabText: {
      color: C.text3,
      fontSize: 10,
      fontFamily: mono,
      fontWeight: '900',
    },
    content: {
      paddingHorizontal: 14,
      paddingTop: 12,
      paddingBottom: 30,
    },
    categoryHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      marginBottom: 12,
    },
    categoryIcon: {
      width: 42,
      height: 42,
      borderRadius: 8,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1,
    },
    categoryCopy: {
      flex: 1,
      minWidth: 0,
    },
    categoryTitle: {
      color: C.text,
      fontSize: 16,
      lineHeight: 20,
      fontWeight: '900',
    },
    categorySub: {
      color: C.text3,
      fontSize: 11,
      lineHeight: 16,
      marginTop: 2,
    },
    itemList: {
      borderRadius: 8,
      borderWidth: 1,
      borderColor: C.border,
      overflow: 'hidden',
      backgroundColor: C.s1,
    },
    itemRow: {
      minHeight: 62,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 11,
      paddingHorizontal: 12,
      paddingVertical: 10,
      borderBottomWidth: 1,
      borderColor: C.border,
    },
    glyphWrap: {
      width: 42,
      alignItems: 'center',
      justifyContent: 'center',
    },
    iconGlyph: {
      width: 32,
      height: 32,
      borderRadius: 8,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1,
    },
    dotGlyph: {
      width: 18,
      height: 18,
      borderRadius: 9,
      borderWidth: 2,
      borderColor: '#fff',
    },
    lineGlyph: {
      width: 36,
      height: 20,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 3,
    },
    solidLine: {
      width: 36,
      height: 5,
      borderRadius: 3,
    },
    dashSegment: {
      width: 9,
      height: 5,
      borderRadius: 3,
    },
    dotSegment: {
      width: 6,
      height: 6,
      borderRadius: 3,
    },
    itemCopy: {
      flex: 1,
      minWidth: 0,
    },
    itemLabel: {
      color: C.text,
      fontSize: 13,
      lineHeight: 17,
      fontWeight: '900',
    },
    itemDetail: {
      color: C.text3,
      fontSize: 11,
      lineHeight: 15,
      marginTop: 2,
    },
    sourceBox: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 10,
      marginTop: 12,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: C.border,
      backgroundColor: C.s2,
      padding: 12,
    },
    sourceIcon: {
      width: 28,
      height: 28,
      borderRadius: 8,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: C.s1,
      borderWidth: 1,
      borderColor: C.border,
    },
    sourceText: {
      flex: 1,
      minWidth: 0,
      color: C.text2,
      fontSize: 11,
      lineHeight: 16,
    },
    examples: {
      marginTop: 12,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: C.border,
      backgroundColor: C.s1,
      padding: 12,
      gap: 5,
    },
    exampleHead: {
      color: C.text3,
      fontSize: 9,
      fontFamily: mono,
      fontWeight: '900',
      letterSpacing: 0.7,
      marginBottom: 2,
    },
    exampleText: {
      color: C.text2,
      fontSize: 10,
      lineHeight: 15,
      fontFamily: mono,
    },
  });
}
