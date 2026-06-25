import { useMemo } from 'react';
import { ActivityIndicator, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import type { FieldReportAccess, FieldReportCrowd, FieldReportSentiment } from '@/lib/api';
import { CREDIT_REWARDS } from '@/lib/credits';
import { mono, useTheme, type ColorPalette } from '@/lib/design';

type TagTone = 'default' | 'good' | 'watch';

type FieldReportComposerProps = {
  accessLabel: string;
  crowdLabel: string;
  notePlaceholder: string;
  tagOptions: string[];
  sentiment: FieldReportSentiment | null;
  access: FieldReportAccess | null;
  crowd: FieldReportCrowd | null;
  tags: string[];
  note: string;
  hasPhoto: boolean;
  submitting: boolean;
  submitLabel: string;
  onSentimentChange: (value: FieldReportSentiment) => void;
  onAccessChange: (value: FieldReportAccess) => void;
  onCrowdChange: (value: FieldReportCrowd) => void;
  onTagsChange: (updater: (previous: string[]) => string[]) => void;
  onNoteChange: (value: string) => void;
  onPickPhoto: () => void;
  onCancel: () => void;
  onSubmit: () => void;
};

const SENTIMENT_CHOICES: Array<{
  value: FieldReportSentiment;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
}> = [
  { value: 'loved_it', label: 'Loved it', icon: 'heart', color: '#22c55e' },
  { value: 'its_ok', label: "It's OK", icon: 'thumbs-up', color: '#f59e0b' },
  { value: 'would_skip', label: 'Would skip', icon: 'thumbs-down', color: '#ef4444' },
];

const ACCESS_CHOICES: Array<{ value: FieldReportAccess; label: string; tone: TagTone }> = [
  { value: 'easy', label: 'Easy', tone: 'good' },
  { value: 'rough', label: 'Rough', tone: 'watch' },
  { value: 'four_wd_required', label: '4WD Only', tone: 'watch' },
];

const CROWD_CHOICES: Array<{ value: FieldReportCrowd; label: string; tone: TagTone }> = [
  { value: 'empty', label: 'Empty', tone: 'good' },
  { value: 'few_rigs', label: 'A few rigs', tone: 'default' },
  { value: 'packed', label: 'Packed', tone: 'watch' },
];

export default function FieldReportComposer({
  accessLabel,
  crowdLabel,
  notePlaceholder,
  tagOptions,
  sentiment,
  access,
  crowd,
  tags,
  note,
  hasPhoto,
  submitting,
  submitLabel,
  onSentimentChange,
  onAccessChange,
  onCrowdChange,
  onTagsChange,
  onNoteChange,
  onPickPhoto,
  onCancel,
  onSubmit,
}: FieldReportComposerProps) {
  const C = useTheme();
  const s = useMemo(() => makeStyles(C), [C]);
  const canSubmit = Boolean(sentiment && access && crowd) && !submitting;

  function toggleTag(tag: string) {
    onTagsChange(previous => previous.includes(tag)
      ? previous.filter(item => item !== tag)
      : [...previous, tag]);
  }

  return (
    <View style={s.form}>
      <Text style={s.label}>How was it?</Text>
      <View style={s.pillRow}>
        {SENTIMENT_CHOICES.map(choice => {
          const active = sentiment === choice.value;
          return (
            <TouchableOpacity
              key={choice.value}
              style={[s.sentimentBtn, active && { borderColor: choice.color, backgroundColor: choice.color + '22' }]}
              onPress={() => onSentimentChange(choice.value)}
            >
              <Ionicons name={choice.icon} size={12} color={active ? choice.color : C.text2} />
              <Text style={[s.sentimentText, active && { color: choice.color }]}>{choice.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <Text style={s.label}>{accessLabel}</Text>
      <View style={s.pillRow}>
        {ACCESS_CHOICES.map(choice => (
          <ChoicePill
            key={choice.value}
            label={choice.label}
            active={access === choice.value}
            tone={choice.tone}
            onPress={() => onAccessChange(choice.value)}
          />
        ))}
      </View>

      <Text style={s.label}>{crowdLabel}</Text>
      <View style={s.pillRow}>
        {CROWD_CHOICES.map(choice => (
          <ChoicePill
            key={choice.value}
            label={choice.label}
            active={crowd === choice.value}
            tone={choice.tone}
            onPress={() => onCrowdChange(choice.value)}
          />
        ))}
      </View>

      <Text style={s.label}>Tags</Text>
      <View style={s.tagPicker}>
        {tagOptions.map(tag => {
          const active = tags.includes(tag);
          return (
            <TouchableOpacity
              key={tag}
              style={[s.tagPill, active && s.tagPillOn]}
              onPress={() => toggleTag(tag)}
            >
              <Text style={[s.tagText, active && s.tagTextOn]}>{tag}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <Text style={s.label}>Notes <Text style={s.optional}>(optional)</Text></Text>
      <TextInput
        style={s.noteInput}
        value={note}
        onChangeText={value => onNoteChange(value.slice(0, 280))}
        placeholder={notePlaceholder}
        placeholderTextColor={C.text3}
        multiline
        numberOfLines={3}
      />
      <Text style={s.charCount}>{note.length}/280</Text>

      <TouchableOpacity style={s.photoBtn} onPress={onPickPhoto}>
        <Ionicons name={hasPhoto ? 'checkmark-circle' : 'camera-outline'} size={16} color={hasPhoto ? '#22c55e' : C.text3} />
        <Text style={[s.photoText, hasPhoto && { color: '#22c55e' }]}>
          {hasPhoto ? `Photo added (+${CREDIT_REWARDS.fieldReportPhotoBonus} credits)` : `Add photo (+${CREDIT_REWARDS.fieldReportPhotoBonus} credits)`}
        </Text>
      </TouchableOpacity>

      <View style={s.actions}>
        <TouchableOpacity style={s.cancelBtn} onPress={onCancel}>
          <Text style={s.cancelText}>Cancel</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[s.submitBtn, !canSubmit && s.submitDisabled]}
          onPress={onSubmit}
          disabled={!canSubmit}
        >
          {submitting ? <ActivityIndicator size="small" color="#fff" /> : <Text style={s.submitText}>{submitLabel}</Text>}
        </TouchableOpacity>
      </View>
    </View>
  );
}

function ChoicePill({
  label,
  active,
  tone,
  onPress,
}: {
  label: string;
  active: boolean;
  tone: TagTone;
  onPress: () => void;
}) {
  const C = useTheme();
  const s = useMemo(() => makeStyles(C), [C]);
  const activeColor = tone === 'good' ? C.green : tone === 'watch' ? C.orange : C.orange;
  return (
    <TouchableOpacity
      style={[s.pill, active && { borderColor: activeColor, backgroundColor: activeColor + '22' }]}
      onPress={onPress}
    >
      <Text style={[s.pillText, active && { color: activeColor, fontWeight: '700' }]}>{label}</Text>
    </TouchableOpacity>
  );
}

const makeStyles = (C: ColorPalette) => StyleSheet.create({
  form: {
    backgroundColor: C.s2,
    borderRadius: 12,
    padding: 14,
    gap: 4,
  },
  label: {
    color: C.text,
    fontSize: 12,
    fontWeight: '700',
    fontFamily: mono,
    marginTop: 8,
    marginBottom: 4,
  },
  optional: {
    color: C.text3,
    fontWeight: '400',
  },
  pillRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 4,
  },
  sentimentBtn: {
    minHeight: 32,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.s1,
  },
  sentimentText: {
    color: C.text2,
    fontSize: 12,
    fontWeight: '600',
  },
  pill: {
    minHeight: 30,
    borderRadius: 16,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.s1,
  },
  pillText: {
    color: C.text2,
    fontSize: 11,
  },
  tagPicker: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 5,
    marginBottom: 4,
  },
  tagPill: {
    minHeight: 28,
    borderRadius: 14,
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.s1,
  },
  tagPillOn: {
    borderColor: C.green,
    backgroundColor: C.green + '22',
  },
  tagText: {
    color: C.text2,
    fontSize: 11,
  },
  tagTextOn: {
    color: C.green,
    fontWeight: '600',
  },
  noteInput: {
    backgroundColor: C.s1,
    borderRadius: 8,
    padding: 10,
    color: C.text,
    fontSize: 13,
    minHeight: 72,
    textAlignVertical: 'top',
    borderWidth: 1,
    borderColor: C.border,
    marginBottom: 2,
  },
  charCount: {
    color: C.text3,
    fontSize: 10,
    textAlign: 'right',
    marginBottom: 4,
  },
  photoBtn: {
    minHeight: 36,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 8,
  },
  photoText: {
    color: C.text3,
    fontSize: 12,
  },
  actions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 8,
  },
  cancelBtn: {
    flex: 1,
    paddingVertical: 11,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: C.border,
    alignItems: 'center',
  },
  cancelText: {
    color: C.text3,
    fontSize: 12,
  },
  submitBtn: {
    flex: 2,
    paddingVertical: 11,
    borderRadius: 10,
    backgroundColor: C.orange,
    alignItems: 'center',
  },
  submitDisabled: {
    opacity: 0.5,
  },
  submitText: {
    color: '#fff',
    fontSize: 11,
    fontFamily: mono,
    fontWeight: '800',
  },
});
