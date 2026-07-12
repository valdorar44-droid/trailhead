import React from 'react';
import { Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/lib/design';
import { EXPLORE_CATEGORY_CHIPS, type ExploreCategoryKey } from './exploreDisplay';

type Props = {
  visible: boolean;
  selected: ExploreCategoryKey;
  counts: Partial<Record<ExploreCategoryKey, number>>;
  onSelect: (key: ExploreCategoryKey) => void;
  onClose: () => void;
};

export function ExploreCategoryFilterSheet({ visible, selected, counts, onSelect, onClose }: Props) {
  const C = useTheme();
  const insets = useSafeAreaInsets();
  const categories = EXPLORE_CATEGORY_CHIPS.filter(item => {
    if (item.key === 'nearby' || item.key === 'tours') return false;
    if (item.key === 'all' || item.key === selected || item.key === 'fuel' || item.key === 'resupply') return true;
    return Number(counts[item.key] ?? 0) > 0;
  });
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <TouchableOpacity style={styles.backdropPress} activeOpacity={1} onPress={onClose} accessibilityLabel="Close place filters" />
        <View style={[styles.sheet, { backgroundColor: C.bg, paddingBottom: Math.max(16, insets.bottom + 10) }]}>
          <View style={[styles.header, { borderBottomColor: C.border }]}>
            <View style={styles.headerCopy}>
              <Text style={[styles.title, { color: C.text }]}>Place filters</Text>
            </View>
            <TouchableOpacity style={[styles.close, { borderColor: C.border, backgroundColor: C.s1 }]} onPress={onClose} accessibilityLabel="Close filters">
              <Ionicons name="close" size={19} color={C.text} />
            </TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
            {categories.map(item => {
              const active = selected === item.key;
              const count = Number(counts[item.key] ?? 0);
              return (
                <TouchableOpacity
                  key={item.key}
                  style={[styles.row, { borderBottomColor: C.border }]}
                  activeOpacity={0.82}
                  onPress={() => {
                    onSelect(item.key);
                    onClose();
                  }}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                >
                  <View style={[styles.icon, { backgroundColor: item.color + '14' }]}>
                    <Ionicons name={item.icon as any} size={19} color={item.color} />
                  </View>
                  <Text style={[styles.label, { color: C.text }]}>{item.key === 'all' ? 'All places' : item.label}</Text>
                  <Text style={[styles.count, { color: C.text3 }]}>{formatCount(count)}</Text>
                  {active ? <Ionicons name="checkmark" size={19} color={C.orange} /> : <View style={styles.checkSpace} />}
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function formatCount(count: number) {
  if (!Number.isFinite(count) || count <= 0) return '';
  if (count < 1000) return String(count);
  const compact = count / 1000;
  return `${compact.toFixed(compact >= 10 ? 0 : 1)}K`;
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(3,7,18,0.46)' },
  backdropPress: { flex: 1 },
  sheet: { maxHeight: '78%', borderTopLeftRadius: 16, borderTopRightRadius: 16, overflow: 'hidden' },
  header: { minHeight: 68, borderBottomWidth: 1, paddingHorizontal: 20, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', gap: 14 },
  headerCopy: { flex: 1, minWidth: 0 },
  title: { fontSize: 21, lineHeight: 26, fontWeight: '900' },
  close: { width: 42, height: 42, borderRadius: 10, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  list: { paddingHorizontal: 20 },
  row: { minHeight: 56, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', alignItems: 'center', gap: 12 },
  icon: { width: 36, height: 36, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  label: { flex: 1, minWidth: 0, fontSize: 14, lineHeight: 19, fontWeight: '800' },
  count: { minWidth: 34, textAlign: 'right', fontSize: 12, lineHeight: 16, fontWeight: '700' },
  checkSpace: { width: 19 },
});
