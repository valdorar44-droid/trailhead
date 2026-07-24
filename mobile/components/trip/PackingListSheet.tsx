import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { PackingList } from '@/lib/api';
import { useTheme, type ColorPalette } from '@/lib/design';
import {
  PACKING_SECTIONS,
  addPackingItem,
  packingItemKey,
  removePackingItem,
  togglePackingItem,
  type PackingSection,
} from '@/lib/tripPacking';
import { trailheadFonts } from '@/lib/typography';

const SECTION_META: Record<PackingSection, {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
}> = {
  essentials: { label: 'Essentials', icon: 'star-outline' },
  recovery_gear: { label: 'Recovery gear', icon: 'construct-outline' },
  water_food: { label: 'Water & food', icon: 'water-outline' },
  navigation: { label: 'Navigation', icon: 'map-outline' },
  shelter: { label: 'Shelter', icon: 'home-outline' },
  tools_spares: { label: 'Tools & spares', icon: 'hardware-chip-outline' },
  optional_nice_to_have: { label: 'Nice to have', icon: 'sparkles-outline' },
  leave_at_home: { label: 'Leave at home', icon: 'ban-outline' },
};

type PackingListSheetProps = {
  visible: boolean;
  list: PackingList | null;
  loading?: boolean;
  onClose: () => void;
  onRefresh: () => void;
  onChange: (next: PackingList) => void;
};

export default function PackingListSheet({
  visible,
  list,
  loading = false,
  onClose,
  onRefresh,
  onChange,
}: PackingListSheetProps) {
  const C = useTheme();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => makeStyles(C), [C]);
  const [drafts, setDrafts] = useState<Partial<Record<PackingSection, string>>>({});

  const addItem = (section: PackingSection) => {
    if (!list) return;
    const next = addPackingItem(list, section, drafts[section] ?? '');
    if (next === list) return;
    onChange(next);
    setDrafts(current => ({ ...current, [section]: '' }));
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        style={[styles.screen, { paddingTop: Math.max(insets.top, 14) }]}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.header}>
          <View style={styles.headerCopy}>
            <Text style={styles.kicker}>TRIP OVERVIEW</Text>
            <Text style={styles.title}>Packing list</Text>
            <Text style={styles.subtitle}>Mark packed items or add your own.</Text>
          </View>
          <TouchableOpacity
            testID="map.packing.refresh"
            style={styles.headerButton}
            onPress={onRefresh}
            disabled={loading}
            accessibilityRole="button"
            accessibilityLabel="Refresh packing suggestions"
          >
            {loading
              ? <ActivityIndicator size="small" color={C.orange} />
              : <Ionicons name="refresh" size={18} color={C.orange} />}
          </TouchableOpacity>
          <TouchableOpacity
            testID="map.packing.close"
            style={styles.headerButton}
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Close packing list"
          >
            <Ionicons name="close" size={21} color={C.text} />
          </TouchableOpacity>
        </View>

        <ScrollView
          testID="map.packing.scroll"
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={[styles.content, { paddingBottom: Math.max(insets.bottom + 28, 36) }]}
        >
          {list ? PACKING_SECTIONS.map(section => {
            const meta = SECTION_META[section];
            const items = list[section] ?? [];
            return (
              <View key={section} style={styles.section} testID={`map.packing.section.${section}`}>
                <View style={styles.sectionHeader}>
                  <View style={styles.sectionIcon}>
                    <Ionicons name={meta.icon} size={16} color={C.orange} />
                  </View>
                  <Text style={styles.sectionTitle}>{meta.label}</Text>
                  <Text style={styles.sectionCount}>{items.length}</Text>
                </View>

                {items.map(item => {
                  const key = packingItemKey(section, item);
                  const checked = list.checked_items?.includes(key) === true;
                  return (
                    <View key={key} style={styles.itemRow}>
                      <TouchableOpacity
                        testID={`map.packing.item.${key}`}
                        style={styles.itemToggle}
                        onPress={() => onChange(togglePackingItem(list, section, item))}
                        accessibilityRole="checkbox"
                        accessibilityState={{ checked }}
                        accessibilityLabel={`${item}, ${checked ? 'packed' : 'not packed'}`}
                      >
                        <Ionicons
                          name={checked ? 'checkmark-circle' : 'ellipse-outline'}
                          size={22}
                          color={checked ? C.orange : C.text3}
                        />
                        <Text style={[styles.itemText, checked && styles.itemTextChecked]}>{item}</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        testID={`map.packing.remove.${key}`}
                        style={styles.removeButton}
                        onPress={() => onChange(removePackingItem(list, section, item))}
                        accessibilityRole="button"
                        accessibilityLabel={`Remove ${item}`}
                      >
                        <Ionicons name="close" size={17} color={C.text3} />
                      </TouchableOpacity>
                    </View>
                  );
                })}

                <View style={styles.addRow}>
                  <TextInput
                    testID={`map.packing.add-input.${section}`}
                    value={drafts[section] ?? ''}
                    onChangeText={value => setDrafts(current => ({ ...current, [section]: value }))}
                    onSubmitEditing={() => addItem(section)}
                    placeholder={`Add to ${meta.label.toLowerCase()}`}
                    placeholderTextColor={C.text3}
                    style={styles.input}
                    returnKeyType="done"
                  />
                  <TouchableOpacity
                    testID={`map.packing.add.${section}`}
                    style={styles.addButton}
                    onPress={() => addItem(section)}
                    accessibilityRole="button"
                    accessibilityLabel={`Add item to ${meta.label}`}
                  >
                    <Ionicons name="add" size={20} color="#fff" />
                  </TouchableOpacity>
                </View>
              </View>
            );
          }) : (
            <View style={styles.empty}>
              {loading ? <ActivityIndicator size="small" color={C.orange} /> : null}
              <Text style={styles.emptyText}>{loading ? 'Preparing your packing list…' : 'Packing list unavailable'}</Text>
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function makeStyles(C: ColorPalette) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: C.bg },
    header: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 8,
      paddingHorizontal: 20,
      paddingTop: 12,
      paddingBottom: 16,
      borderBottomWidth: 1,
      borderBottomColor: C.border,
    },
    headerCopy: { flex: 1, minWidth: 0 },
    kicker: { color: C.orange, fontSize: 10, fontWeight: '800', letterSpacing: 1.2 },
    title: {
      color: C.text,
      fontFamily: trailheadFonts.displayBold,
      fontSize: 29,
      lineHeight: 32,
      fontWeight: '700',
      marginTop: 2,
    },
    subtitle: { color: C.text2, fontSize: 13, lineHeight: 18, marginTop: 4, maxWidth: 320 },
    headerButton: {
      width: 44,
      height: 44,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: C.border,
      backgroundColor: C.s1,
      alignItems: 'center',
      justifyContent: 'center',
    },
    content: { padding: 18, gap: 14 },
    section: {
      borderRadius: 16,
      borderWidth: 1,
      borderColor: C.border,
      backgroundColor: C.s1,
      padding: 14,
    },
    sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 9, marginBottom: 8 },
    sectionIcon: {
      width: 32,
      height: 32,
      borderRadius: 10,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: `${C.orange}14`,
    },
    sectionTitle: { flex: 1, color: C.text, fontSize: 15, fontWeight: '800' },
    sectionCount: { color: C.text3, fontSize: 12, fontWeight: '700' },
    itemRow: {
      minHeight: 48,
      flexDirection: 'row',
      alignItems: 'center',
      borderTopWidth: 1,
      borderTopColor: `${C.border}80`,
    },
    itemToggle: { flex: 1, minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 10 },
    itemText: { flex: 1, color: C.text, fontSize: 15, lineHeight: 20 },
    itemTextChecked: { color: C.text3, textDecorationLine: 'line-through' },
    removeButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
    addRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10 },
    input: {
      flex: 1,
      minHeight: 48,
      color: C.text,
      fontSize: 15,
      borderWidth: 1,
      borderColor: C.border,
      backgroundColor: C.bg,
      borderRadius: 12,
      paddingHorizontal: 13,
    },
    addButton: {
      width: 48,
      height: 48,
      borderRadius: 12,
      backgroundColor: C.orange,
      alignItems: 'center',
      justifyContent: 'center',
    },
    empty: { minHeight: 220, alignItems: 'center', justifyContent: 'center', gap: 10 },
    emptyText: { color: C.text2, fontSize: 14 },
  });
}
