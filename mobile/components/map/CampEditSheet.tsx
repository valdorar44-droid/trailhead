import React, { useMemo } from 'react';
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
import { SafeAreaView } from 'react-native-safe-area-context';

import { mono, useTheme, type ColorPalette } from '@/lib/design';

export type CampEditDraft = {
  name: string;
  description: string;
  cost: string;
  phone: string;
  url: string;
  accessNotes: string;
  bailOutNotes: string;
  stayLimit: string;
  reservationNotes: string;
  sourceConfidenceNotes: string;
  maxRigLength: string;
  siteTypes: string[];
  amenities: string[];
  activities: string[];
  note: string;
};

export type CampEditOption = {
  label: string;
  icon?: keyof typeof Ionicons.glyphMap;
};

type Props = {
  visible: boolean;
  mode: 'suggest' | 'admin';
  draft: CampEditDraft | null;
  campName?: string;
  saving?: boolean;
  canAdmin?: boolean;
  siteTypeOptions: readonly CampEditOption[];
  essentialOptions: readonly CampEditOption[];
  fireWaterOptions: readonly CampEditOption[];
  rvOptions: readonly CampEditOption[];
  serviceOptions: readonly CampEditOption[];
  activityOptions: readonly CampEditOption[];
  onClose: () => void;
  onChange: (patch: Partial<CampEditDraft>) => void;
  onToggleList: (key: 'siteTypes' | 'amenities' | 'activities', label: string) => void;
  onSubmit: () => void;
};

export default function CampEditSheet({
  visible,
  mode,
  draft,
  campName,
  saving = false,
  canAdmin = false,
  siteTypeOptions,
  essentialOptions,
  fireWaterOptions,
  rvOptions,
  serviceOptions,
  activityOptions,
  onClose,
  onChange,
  onToggleList,
  onSubmit,
}: Props) {
  const C = useTheme();
  const s = useMemo(() => makeStyles(C), [C]);
  if (!draft) return null;
  const editingDirectly = mode === 'admin' && canAdmin;
  const submitLabel = editingDirectly ? 'Save changes' : 'Save details';

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={s.modal}>
        <KeyboardAvoidingView style={s.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={s.top}>
            <TouchableOpacity style={s.iconBtn} onPress={onClose}>
              <Ionicons name="chevron-back" size={22} color={C.text} />
            </TouchableOpacity>
            <View style={s.topText}>
              <Text style={s.topTitle}>Edit camp</Text>
              <Text style={s.topSub} numberOfLines={1}>{campName || draft.name || 'Camp'}</Text>
            </View>
            <TouchableOpacity style={s.iconBtn} onPress={onClose}>
              <Ionicons name="close" size={21} color={C.text} />
            </TouchableOpacity>
          </View>

          <ScrollView style={s.scroll} contentContainerStyle={s.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            <View style={s.hero}>
              <Text style={s.heroKicker}>Camp details</Text>
              <Text style={s.heroTitle}>Update the fields you know.</Text>
              <Text style={s.heroBody}>
                Leave anything uncertain blank.
              </Text>
            </View>

            <FieldGroup title="Basics" description="Name, description, contact, and price notes." styles={s}>
              <SheetInput value={draft.name} onChangeText={name => onChange({ name })} placeholder="Camp name" styles={s} colors={C} />
              <SheetInput value={draft.description} onChangeText={description => onChange({ description })} placeholder="Description, access, restrictions, best sites" multiline styles={s} colors={C} />
              <SheetInput value={draft.url} onChangeText={url => onChange({ url })} placeholder="Website or booking link" styles={s} colors={C} autoCapitalize="none" />
              <View style={s.twoCol}>
                <SheetInput value={draft.phone} onChangeText={phone => onChange({ phone })} placeholder="Phone" styles={s} colors={C} keyboardType="phone-pad" />
                <SheetInput value={draft.cost} onChangeText={cost => onChange({ cost })} placeholder="Price notes" styles={s} colors={C} />
              </View>
            </FieldGroup>

            <OptionGroup title="Stay type" options={siteTypeOptions} values={draft.siteTypes} onToggle={label => onToggleList('siteTypes', label)} styles={s} colors={C} />
            <OptionGroup title="Essentials" options={essentialOptions} values={draft.amenities} onToggle={label => onToggleList('amenities', label)} styles={s} colors={C} />
            <OptionGroup title="Fire, water, tables" options={fireWaterOptions} values={draft.amenities} onToggle={label => onToggleList('amenities', label)} styles={s} colors={C} />
            <OptionGroup title="RV and trailer fit" options={rvOptions} values={draft.amenities} onToggle={label => onToggleList('amenities', label)} styles={s} colors={C} />
            <OptionGroup title="Services" options={serviceOptions} values={draft.amenities} onToggle={label => onToggleList('amenities', label)} styles={s} colors={C} />
            <OptionGroup title="Nearby activities" options={activityOptions} values={draft.activities} onToggle={label => onToggleList('activities', label)} styles={s} colors={C} />

            <FieldGroup title="Arrival notes" description="Access, stay limits, route fit, and confidence details." styles={s}>
              <SheetInput value={draft.maxRigLength} onChangeText={maxRigLength => onChange({ maxRigLength })} placeholder="Max vehicle or trailer length, if known" styles={s} colors={C} />
              <SheetInput value={draft.accessNotes} onChangeText={accessNotes => onChange({ accessNotes })} placeholder="Road condition, clearance, trailer turns, seasonal gates" multiline styles={s} colors={C} />
              <SheetInput value={draft.bailOutNotes} onChangeText={bailOutNotes => onChange({ bailOutNotes })} placeholder="Where to go if full, closed, muddy, or unsafe" multiline styles={s} colors={C} />
              <SheetInput value={draft.stayLimit} onChangeText={stayLimit => onChange({ stayLimit })} placeholder="Stay limit or season notes" styles={s} colors={C} />
              <SheetInput value={draft.reservationNotes} onChangeText={reservationNotes => onChange({ reservationNotes })} placeholder="Reservations, first-come, permit notes" styles={s} colors={C} />
              <SheetInput value={draft.sourceConfidenceNotes} onChangeText={sourceConfidenceNotes => onChange({ sourceConfidenceNotes })} placeholder="How do you know this is current?" multiline styles={s} colors={C} />
            </FieldGroup>

            {!editingDirectly ? (
              <FieldGroup title="Review note" description="A short note helps Trailhead verify the update." styles={s}>
                <SheetInput value={draft.note} onChangeText={note => onChange({ note })} placeholder="What changed, and how do you know?" multiline styles={s} colors={C} />
              </FieldGroup>
            ) : null}
          </ScrollView>

          <View style={s.footer}>
            <TouchableOpacity style={s.secondaryBtn} onPress={onClose} disabled={saving}>
              <Text style={s.secondaryText}>Later</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[s.submitBtn, saving && s.disabled]} onPress={onSubmit} disabled={saving}>
              {saving ? <ActivityIndicator size="small" color="#fff" /> : <Text style={s.submitText}>{submitLabel}</Text>}
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

function FieldGroup({ title, description, children, styles }: { title: string; description: string; children: React.ReactNode; styles: ReturnType<typeof makeStyles> }) {
  return (
    <View style={styles.group}>
      <Text style={styles.groupTitle}>{title}</Text>
      <Text style={styles.groupDesc}>{description}</Text>
      <View style={styles.groupBody}>{children}</View>
    </View>
  );
}

function SheetInput({
  value,
  onChangeText,
  placeholder,
  multiline,
  styles,
  colors,
  ...rest
}: {
  value: string;
  onChangeText: (value: string) => void;
  placeholder: string;
  multiline?: boolean;
  styles: ReturnType<typeof makeStyles>;
  colors: ColorPalette;
} & Omit<React.ComponentProps<typeof TextInput>, 'style' | 'value' | 'onChangeText' | 'placeholder' | 'placeholderTextColor'>) {
  return (
    <TextInput
      value={value}
      onChangeText={onChangeText}
      placeholder={placeholder}
      placeholderTextColor={colors.text3}
      multiline={multiline}
      style={[styles.input, multiline && styles.textArea]}
      {...rest}
    />
  );
}

function OptionGroup({
  title,
  options,
  values,
  onToggle,
  styles,
  colors,
}: {
  title: string;
  options: readonly CampEditOption[];
  values: string[];
  onToggle: (label: string) => void;
  styles: ReturnType<typeof makeStyles>;
  colors: ColorPalette;
}) {
  if (!options.length) return null;
  return (
    <View style={styles.group}>
      <Text style={styles.groupTitle}>{title}</Text>
      <View style={styles.optionGrid}>
        {options.map(option => {
          const active = values.includes(option.label);
          return (
            <TouchableOpacity key={option.label} style={[styles.option, active && styles.optionActive]} onPress={() => onToggle(option.label)} activeOpacity={0.82}>
              <View style={[styles.optionIcon, active && styles.optionIconActive]}>
                <Ionicons name={active ? 'checkmark' : option.icon || 'add'} size={15} color={active ? '#fff' : colors.text2} />
              </View>
              <Text style={[styles.optionText, active && styles.optionTextActive]} numberOfLines={2}>{option.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

const makeStyles = (C: ColorPalette) => StyleSheet.create({
  flex: { flex: 1 },
  modal: { flex: 1, backgroundColor: C.bg },
  top: {
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    borderBottomWidth: 1,
    borderColor: C.border,
    backgroundColor: C.s1,
  },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: C.s2,
  },
  topText: { flex: 1, minWidth: 0, alignItems: 'center' },
  topTitle: { color: C.text, fontSize: 16, fontWeight: '900' },
  topSub: { color: C.text3, fontSize: 10, fontFamily: mono, marginTop: 2 },
  scroll: { flex: 1 },
  content: { padding: 16, paddingBottom: 124, gap: 14 },
  hero: {
    borderRadius: 20,
    borderWidth: 1,
    borderColor: C.orange + '35',
    backgroundColor: C.orange + '10',
    padding: 16,
    gap: 7,
  },
  heroKicker: { color: C.orange, fontSize: 9, fontFamily: mono, fontWeight: '900', letterSpacing: 0.9, textTransform: 'uppercase' },
  heroTitle: { color: C.text, fontSize: 22, lineHeight: 27, fontWeight: '900' },
  heroBody: { color: C.text2, fontSize: 13, lineHeight: 19 },
  group: {
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.s1,
    borderRadius: 18,
    padding: 13,
    gap: 10,
  },
  groupTitle: { color: C.text, fontSize: 15, lineHeight: 19, fontWeight: '900' },
  groupDesc: { color: C.text3, fontSize: 11, lineHeight: 15 },
  groupBody: { gap: 10 },
  input: {
    minHeight: 48,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.bg,
    borderRadius: 13,
    color: C.text,
    fontSize: 14,
    paddingHorizontal: 13,
    paddingVertical: 11,
  },
  textArea: {
    minHeight: 104,
    textAlignVertical: 'top',
    lineHeight: 20,
  },
  twoCol: {
    flexDirection: 'row',
    gap: 10,
  },
  optionGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 9,
  },
  option: {
    minHeight: 48,
    flexBasis: '48%',
    flexGrow: 1,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.bg,
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingVertical: 9,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  optionActive: {
    borderColor: C.orange + '88',
    backgroundColor: C.orange + '12',
  },
  optionIcon: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: C.s2,
  },
  optionIconActive: {
    backgroundColor: C.orange,
  },
  optionText: { flex: 1, color: C.text2, fontSize: 12, lineHeight: 15, fontWeight: '800' },
  optionTextActive: { color: C.text },
  footer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: Platform.OS === 'ios' ? 28 : 18,
    borderTopWidth: 1,
    borderColor: C.border,
    backgroundColor: C.bg,
  },
  secondaryBtn: {
    minHeight: 52,
    paddingHorizontal: 16,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.s1,
  },
  secondaryText: { color: C.text2, fontSize: 13, fontWeight: '900' },
  submitBtn: {
    flex: 1,
    minHeight: 52,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: C.green,
  },
  disabled: { opacity: 0.62 },
  submitText: { color: '#fff', fontSize: 13, fontFamily: mono, fontWeight: '900' },
});
