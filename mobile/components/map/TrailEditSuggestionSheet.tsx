import React, { useEffect, useMemo, useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';

import { useTheme, type ColorPalette } from '@/lib/design';
import { trailheadFonts } from '@/lib/typography';

const TRAIL_EDIT_FIELDS = [
  { id: 'description', label: 'Details' },
  { id: 'difficulty', label: 'Difficulty' },
  { id: 'access', label: 'Access' },
  { id: 'name', label: 'Name' },
  { id: 'official_url', label: 'Official link' },
] as const;

export default function TrailEditSuggestionSheet({
  visible,
  trailName,
  submitting,
  onClose,
  onSubmit,
}: {
  visible: boolean;
  trailName: string;
  submitting: boolean;
  onClose: () => void;
  onSubmit: (field: string, value: string) => void;
}) {
  const C = useTheme();
  const s = useMemo(() => makeStyles(C), [C]);
  const [field, setField] = useState<(typeof TRAIL_EDIT_FIELDS)[number]['id']>('description');
  const [value, setValue] = useState('');

  useEffect(() => {
    if (!visible) return;
    setField('description');
    setValue('');
  }, [trailName, visible]);

  const cleanValue = value.trim();
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <KeyboardAvoidingView style={s.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={s.header}>
          <TouchableOpacity accessibilityRole="button" style={s.headerButton} onPress={onClose} disabled={submitting}>
            <Text style={s.headerButtonText}>Cancel</Text>
          </TouchableOpacity>
          <Text style={s.headerTitle}>Suggest edit</Text>
          <View style={s.headerButton} />
        </View>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={s.content}>
          <Text style={s.trailName}>{trailName}</Text>
          <Text style={s.label}>WHAT NEEDS CHANGING?</Text>
          <View style={s.fields}>
            {TRAIL_EDIT_FIELDS.map(option => {
              const selected = option.id === field;
              return (
                <TouchableOpacity
                  key={option.id}
                  testID={`map.trail.edit.field.${option.id}`}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  style={[s.fieldButton, selected && s.fieldButtonSelected]}
                  onPress={() => setField(option.id)}
                >
                  <Text style={[s.fieldText, selected && s.fieldTextSelected]}>{option.label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
          <Text style={s.label}>CORRECT INFORMATION</Text>
          <TextInput
            testID="map.trail.edit.value"
            style={s.input}
            value={value}
            onChangeText={setValue}
            placeholder="Enter the corrected information"
            placeholderTextColor={C.text3}
            multiline
            maxLength={2000}
            textAlignVertical="top"
          />
          <TouchableOpacity
            testID="map.trail.edit.submit"
            accessibilityRole="button"
            accessibilityState={{ disabled: submitting || cleanValue.length < 2 }}
            style={[s.submit, (submitting || cleanValue.length < 2) && s.submitDisabled]}
            disabled={submitting || cleanValue.length < 2}
            onPress={() => onSubmit(field, cleanValue)}
          >
            <Text style={s.submitText}>{submitting ? 'Sending…' : 'Send suggestion'}</Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function makeStyles(C: ColorPalette) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: C.bg },
    header: { minHeight: 58, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.border },
    headerButton: { width: 76, minHeight: 48, alignItems: 'flex-start', justifyContent: 'center' },
    headerButtonText: { color: C.orange, fontSize: 16, fontWeight: '700' },
    headerTitle: { flex: 1, textAlign: 'center', color: C.text, fontSize: 18, fontFamily: trailheadFonts.displaySemibold },
    content: { padding: 20, paddingBottom: 40, gap: 14 },
    trailName: { color: C.text, fontSize: 24, lineHeight: 30, fontFamily: trailheadFonts.displaySemibold },
    label: { color: C.text3, fontSize: 11, lineHeight: 15, fontWeight: '700', letterSpacing: 0.5, marginTop: 4 },
    fields: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    fieldButton: { minHeight: 44, paddingHorizontal: 14, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: C.s2, borderWidth: 1, borderColor: C.border },
    fieldButtonSelected: { borderColor: C.orange, backgroundColor: C.orangeGlow },
    fieldText: { color: C.text2, fontSize: 14, fontWeight: '700' },
    fieldTextSelected: { color: C.orange },
    input: { minHeight: 150, borderRadius: 12, borderWidth: 1, borderColor: C.border, backgroundColor: C.s1, color: C.text, fontSize: 16, lineHeight: 23, padding: 14 },
    submit: { minHeight: 50, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: C.orange, marginTop: 2 },
    submitDisabled: { opacity: 0.45 },
    submitText: { color: '#fff', fontSize: 16, fontWeight: '800' },
  });
}
