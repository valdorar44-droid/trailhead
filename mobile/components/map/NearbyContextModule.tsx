import React, { useMemo, useState, type ReactNode } from 'react';
import { ActivityIndicator, Image, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { mono, useTheme, type ColorPalette } from '@/lib/design';

export type NearbyContextItem = {
  id?: string | number;
  title: string;
  subtitle?: string;
  meta?: string;
  imageUrl?: string | null;
  icon?: keyof typeof Ionicons.glyphMap;
  onPress?: () => void;
  action?: ReactNode;
  node?: ReactNode;
};

export type NearbyContextGroup = {
  key: string;
  title: string;
  countLabel?: string;
  items: NearbyContextItem[];
};

type Props = {
  title?: string;
  subtitle?: string | null;
  loading?: boolean;
  sourceLabel?: string | null;
  groups: NearbyContextGroup[];
  emptyMessage: string;
  emptyActionLabel: string;
  onRetry: () => void;
};

export default function NearbyContextModule({
  title = 'Nearby',
  subtitle,
  loading = false,
  sourceLabel,
  groups,
  emptyMessage,
  emptyActionLabel,
  onRetry,
}: Props) {
  const C = useTheme();
  const s = useMemo(() => makeStyles(C), [C]);
  const filledGroups = groups.filter(group => group.items.length > 0);
  const [activeKey, setActiveKey] = useState(filledGroups[0]?.key ?? groups[0]?.key ?? '');
  const activeGroup = filledGroups.find(group => group.key === activeKey) ?? filledGroups[0];

  return (
    <View style={s.block}>
      <View style={s.header}>
        <View style={s.headerText}>
          <Text style={s.eyebrow}>{title}</Text>
          <Text style={s.title}>{subtitle || sourceLabel || 'Places around this stop'}</Text>
        </View>
        {loading ? <ActivityIndicator size="small" color={C.orange} /> : null}
      </View>

      {filledGroups.length > 1 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.tabs}>
          {filledGroups.map(group => {
            const active = group.key === activeGroup?.key;
            return (
              <TouchableOpacity key={group.key} style={[s.tab, active && s.tabActive]} onPress={() => setActiveKey(group.key)} activeOpacity={0.82}>
                <Text style={[s.tabText, active && s.tabTextActive]}>{group.title}</Text>
                <Text style={[s.tabCount, active && s.tabTextActive]}>{group.countLabel || String(group.items.length)}</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      ) : null}

      {!loading && !filledGroups.length ? (
        <View style={s.emptyCard}>
          <View style={s.emptyIcon}>
            <Ionicons name="scan-outline" size={18} color={C.text2} />
          </View>
          <View style={s.emptyCopy}>
            <Text style={s.emptyTitle}>Nothing close enough yet</Text>
            <Text style={s.emptyText}>{emptyMessage}</Text>
          </View>
          <TouchableOpacity style={s.retryBtn} onPress={onRetry} activeOpacity={0.82}>
            <Text style={s.retryText}>{emptyActionLabel}</Text>
          </TouchableOpacity>
        </View>
      ) : activeGroup ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.rail}>
          {activeGroup.items.map((item, idx) => (
            item.node ? (
              <View key={String(item.id ?? `${activeGroup.key}-${idx}`)}>{item.node}</View>
            ) : (
              <TouchableOpacity
                key={String(item.id ?? `${activeGroup.key}-${idx}`)}
                style={s.card}
                onPress={item.onPress}
                activeOpacity={item.onPress ? 0.86 : 1}
              >
                {item.imageUrl ? (
                  <Image source={{ uri: item.imageUrl }} style={s.image} resizeMode="cover" />
                ) : (
                  <View style={s.iconBlock}>
                    <Ionicons name={item.icon || 'location-outline'} size={24} color={C.orange} />
                  </View>
                )}
                <View style={s.cardBody}>
                  <Text style={s.cardTitle} numberOfLines={2}>{item.title}</Text>
                  {!!item.subtitle && <Text style={s.cardSub} numberOfLines={1}>{item.subtitle}</Text>}
                  {!!item.meta && <Text style={s.cardMeta} numberOfLines={2}>{item.meta}</Text>}
                </View>
                {item.action ? <View style={s.cardAction}>{item.action}</View> : null}
              </TouchableOpacity>
            )
          ))}
        </ScrollView>
      ) : null}
    </View>
  );
}

const makeStyles = (C: ColorPalette) => StyleSheet.create({
  block: {
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.s1,
    borderRadius: 18,
    padding: 12,
    gap: 12,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  headerText: { flex: 1, minWidth: 0 },
  eyebrow: {
    color: C.orange,
    fontSize: 9,
    fontFamily: mono,
    fontWeight: '900',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  title: {
    color: C.text,
    fontSize: 16,
    lineHeight: 20,
    fontWeight: '900',
    marginTop: 3,
  },
  tabs: {
    gap: 8,
    paddingRight: 4,
  },
  tab: {
    minWidth: 78,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.s2,
    borderRadius: 999,
    paddingHorizontal: 11,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  tabActive: {
    borderColor: C.orange + '88',
    backgroundColor: C.orange + '14',
  },
  tabText: {
    color: C.text2,
    fontSize: 11,
    fontWeight: '800',
  },
  tabCount: {
    color: C.text3,
    fontSize: 10,
    fontFamily: mono,
    fontWeight: '900',
  },
  tabTextActive: {
    color: C.orange,
  },
  rail: {
    gap: 10,
    paddingRight: 6,
  },
  card: {
    width: 178,
    minHeight: 184,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.bg,
    borderRadius: 16,
    overflow: 'hidden',
  },
  image: {
    width: '100%',
    height: 92,
    backgroundColor: C.s3,
  },
  iconBlock: {
    width: '100%',
    height: 92,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: C.orange + '10',
    borderBottomWidth: 1,
    borderColor: C.border,
  },
  cardBody: {
    padding: 10,
    gap: 4,
    minHeight: 84,
  },
  cardTitle: {
    color: C.text,
    fontSize: 13,
    lineHeight: 17,
    fontWeight: '900',
  },
  cardSub: {
    color: C.text2,
    fontSize: 10,
    lineHeight: 13,
    fontWeight: '700',
  },
  cardMeta: {
    color: C.text3,
    fontSize: 9.5,
    lineHeight: 13,
    fontFamily: mono,
  },
  cardAction: {
    position: 'absolute',
    top: 8,
    right: 8,
  },
  emptyCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.bg,
    borderRadius: 14,
    padding: 11,
  },
  emptyIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: C.s2,
  },
  emptyCopy: { flex: 1, minWidth: 0 },
  emptyTitle: { color: C.text, fontSize: 12, fontWeight: '900' },
  emptyText: { color: C.text3, fontSize: 10.5, lineHeight: 14, marginTop: 2 },
  retryBtn: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: C.orange + '55',
    backgroundColor: C.orange + '10',
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  retryText: {
    color: C.orange,
    fontSize: 9,
    fontFamily: mono,
    fontWeight: '900',
  },
});
