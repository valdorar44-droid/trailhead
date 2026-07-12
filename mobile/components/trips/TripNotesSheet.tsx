import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/lib/design';
import type { TripDocumentV2, TripNoteInput, TripNoteV1 } from '@/lib/tripRepository';
import TripPublicationPanel from './TripPublicationPanel';

const NOTE_RENDER_BATCH = 12;

function formatNoteDate(value: number) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Recently updated';
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export default function TripNotesSheet({
  trip,
  visible,
  publicationEnabled = false,
  onClose,
  onSave,
  onDelete,
}: {
  trip: TripDocumentV2 | null;
  visible: boolean;
  publicationEnabled?: boolean;
  onClose: () => void;
  onSave: (input: TripNoteInput) => Promise<void>;
  onDelete: (note: TripNoteV1) => Promise<void>;
}) {
  const C = useTheme();
  const insets = useSafeAreaInsets();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [body, setBody] = useState('');
  const [day, setDay] = useState<number | undefined>();
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState<'notes' | 'publication'>('notes');
  const [publicationNote, setPublicationNote] = useState<TripNoteV1 | null>(null);
  const [publicationBusy, setPublicationBusy] = useState(false);
  const [visibleNoteCount, setVisibleNoteCount] = useState(NOTE_RENDER_BATCH);

  const notes = useMemo(
    () => [...(trip?.notes ?? [])].sort((left, right) => right.updatedAt - left.updatedAt),
    [trip?.notes],
  );
  const visibleNotes = useMemo(
    () => notes.slice(0, visibleNoteCount),
    [notes, visibleNoteCount],
  );
  const days = useMemo(() => {
    const values = new Set<number>();
    for (const tripDay of trip?.days ?? []) if (tripDay.day > 0) values.add(Math.round(tripDay.day));
    for (const item of trip?.items ?? []) if (item.day > 0) values.add(Math.round(item.day));
    return [...values].sort((left, right) => left - right);
  }, [trip?.days, trip?.items]);

  const beginCreate = () => {
    setEditingId('new');
    setBody('');
    setDay(undefined);
  };

  useEffect(() => {
    if (!visible || !trip) return;
    setBusy(false);
    setPublicationBusy(false);
    setView('notes');
    setPublicationNote(null);
    setVisibleNoteCount(NOTE_RENDER_BATCH);
    if (trip.notes.length === 0) beginCreate();
    else {
      setEditingId(null);
      setBody('');
      setDay(undefined);
    }
  }, [trip?.id, visible]);

  const beginEdit = (note: TripNoteV1) => {
    setEditingId(note.id);
    setBody(note.body);
    setDay(note.day);
  };

  const beginPublication = (note: TripNoteV1 | null) => {
    cancelEdit();
    setPublicationNote(note);
    setView('publication');
  };

  const cancelEdit = () => {
    setEditingId(null);
    setBody('');
    setDay(undefined);
  };

  const submit = async () => {
    const clean = body.trim();
    if (!clean || busy) return;
    setBusy(true);
    try {
      await onSave({
        id: editingId && editingId !== 'new' ? editingId : undefined,
        body: clean,
        day,
      });
      cancelEdit();
    } catch (error: any) {
      Alert.alert('Note not saved', error?.message || 'This note could not be saved. Try again.');
    } finally {
      setBusy(false);
    }
  };

  const confirmDelete = (note: TripNoteV1) => {
    Alert.alert(
      'Delete note?',
      'This private note will be removed from the trip.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            setBusy(true);
            void onDelete(note)
              .then(() => {
                if (notes.length === 1) beginCreate();
              })
              .catch((error: any) => {
                Alert.alert('Note not deleted', error?.message || 'This note could not be deleted. Try again.');
              })
              .finally(() => setBusy(false));
          },
        },
      ],
    );
  };

  if (!trip) return null;
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={() => !busy && !publicationBusy && onClose()}
      accessibilityViewIsModal
    >
      <KeyboardAvoidingView
        style={styles.modalRoot}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={view === 'publication' ? 'Close community review' : 'Close private notes'}
          disabled={busy || publicationBusy}
          onPress={onClose}
          style={styles.backdrop}
        />
        <View
          style={[
            styles.sheet,
            {
              backgroundColor: C.s1,
              borderColor: C.border2,
              paddingBottom: Math.max(insets.bottom, 14),
            },
          ]}
        >
          <View style={[styles.handle, { backgroundColor: C.border2 }]} />
          <View style={styles.header}>
            <View style={styles.headerCopy}>
              <Text accessibilityRole="header" style={[styles.title, { color: C.text }]} numberOfLines={1}>
                {view === 'publication' ? 'Community review' : 'Private notes'}
              </Text>
              <Text style={[styles.tripName, { color: C.text2 }]} numberOfLines={1}>{trip.title}</Text>
            </View>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel={view === 'publication' ? 'Close community review' : 'Close private notes'}
              activeOpacity={0.72}
              disabled={busy || publicationBusy}
              onPress={onClose}
              style={[styles.iconButton, { borderColor: C.border }]}
            >
              <Ionicons name="close" size={20} color={C.text2} />
            </TouchableOpacity>
          </View>

          <View style={[styles.privateLine, { borderTopColor: C.border, borderBottomColor: C.border }] }>
            <Ionicons name={view === 'publication' ? 'shield-checkmark-outline' : 'lock-closed-outline'} size={16} color={C.text3} />
            <Text style={[styles.privateText, { color: C.text2 }]}>
              {view === 'publication' ? 'Prepare and track reviewed submissions.' : 'Only you can see trip notes.'}
            </Text>
            {view === 'publication' ? (
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel="Back to private notes"
                activeOpacity={0.72}
                disabled={publicationBusy}
                onPress={() => {
                  setView('notes');
                  setPublicationNote(null);
                }}
                style={[styles.addButton, { borderColor: C.border2 }]}
              >
                <Ionicons name="arrow-back" size={16} color={C.orange} />
                <Text style={[styles.addLabel, { color: C.text }]}>Notes</Text>
              </TouchableOpacity>
            ) : !editingId ? (
              <View style={styles.headerActions}>
                {publicationEnabled ? (
                  <TouchableOpacity
                    accessibilityRole="button"
                    accessibilityLabel="Open community review submissions"
                    activeOpacity={0.72}
                    onPress={() => beginPublication(null)}
                    style={[styles.addButton, { borderColor: C.border2 }]}
                  >
                    <Ionicons name="shield-checkmark-outline" size={16} color={C.orange} />
                    <Text style={[styles.addLabel, { color: C.text }]}>Review</Text>
                  </TouchableOpacity>
                ) : null}
                <TouchableOpacity
                  accessibilityRole="button"
                  accessibilityLabel="Add a private note"
                  activeOpacity={0.72}
                  onPress={beginCreate}
                  style={[styles.addButton, { borderColor: C.border2 }]}
                >
                  <Ionicons name="add" size={16} color={C.orange} />
                  <Text style={[styles.addLabel, { color: C.text }]}>Add</Text>
                </TouchableOpacity>
              </View>
            ) : null}
          </View>

          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.content}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            {view === 'publication' ? (
              <TripPublicationPanel
                trip={trip}
                initialNote={publicationNote}
                onBack={() => {
                  setView('notes');
                  setPublicationNote(null);
                }}
                onBusyChange={setPublicationBusy}
              />
            ) : editingId ? (
              <View style={styles.editor}>
                <TextInput
                  accessibilityLabel="Private trip note"
                  autoFocus
                  multiline
                  maxLength={10_000}
                  placeholder="Write a private note"
                  placeholderTextColor={C.text3}
                  selectionColor={C.orange}
                  value={body}
                  onChangeText={setBody}
                  style={[
                    styles.input,
                    {
                      color: C.text,
                      backgroundColor: C.s2,
                      borderColor: C.border2,
                    },
                  ]}
                />
                <Text style={[styles.dayLabel, { color: C.text2 }]}>Associate with</Text>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={[styles.daySegments, { borderColor: C.border2 }]}
                >
                  <DayOption label="Whole trip" selected={day == null} onPress={() => setDay(undefined)} />
                  {days.map(value => (
                    <DayOption key={value} label={`Day ${value}`} selected={day === value} onPress={() => setDay(value)} />
                  ))}
                </ScrollView>
                <View style={styles.editorActions}>
                  <TouchableOpacity
                    accessibilityRole="button"
                    accessibilityLabel="Cancel note editing"
                    activeOpacity={0.74}
                    disabled={busy}
                    onPress={cancelEdit}
                    style={[styles.cancelButton, { borderColor: C.border2 }]}
                  >
                    <Text style={[styles.cancelLabel, { color: C.text2 }]}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    accessibilityRole="button"
                    accessibilityLabel="Save private note"
                    activeOpacity={0.8}
                    disabled={busy || !body.trim()}
                    onPress={() => void submit()}
                    style={[
                      styles.saveButton,
                      { backgroundColor: C.orange, opacity: busy || !body.trim() ? 0.5 : 1 },
                    ]}
                  >
                    {busy ? <ActivityIndicator size="small" color="#FFFFFF" /> : <Ionicons name="checkmark" size={17} color="#FFFFFF" />}
                    <Text style={styles.saveLabel}>Save note</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ) : null}

            {view === 'notes' && notes.length > 0 ? (
              <View style={[styles.noteList, { borderTopColor: C.border }] }>
                {visibleNotes.map(note => (
                  <View key={note.id} style={[styles.noteRow, { borderBottomColor: C.border }] }>
                    <View style={styles.noteCopy}>
                      <Text style={[styles.noteMeta, { color: C.text2 }]}>
                        {note.day ? `Day ${note.day} | ` : ''}{formatNoteDate(note.updatedAt)}
                      </Text>
                      <Text style={[styles.noteBody, { color: C.text }]} numberOfLines={6}>{note.body}</Text>
                    </View>
                    {publicationEnabled ? (
                      <TouchableOpacity
                        accessibilityRole="button"
                        accessibilityLabel={`Review a community copy of this ${note.day ? `day ${note.day} ` : ''}note`}
                        activeOpacity={0.72}
                        disabled={busy || Boolean(editingId)}
                        onPress={() => beginPublication(note)}
                        style={[styles.noteAction, { opacity: busy || editingId ? 0.4 : 1 }]}
                      >
                        <Ionicons name="shield-checkmark-outline" size={18} color={C.orange} />
                      </TouchableOpacity>
                    ) : null}
                    <TouchableOpacity
                      accessibilityRole="button"
                      accessibilityLabel={`Edit note${note.day ? ` for day ${note.day}` : ''}`}
                      activeOpacity={0.72}
                      disabled={busy || Boolean(editingId)}
                      onPress={() => beginEdit(note)}
                      style={[styles.noteAction, { opacity: busy || editingId ? 0.4 : 1 }]}
                    >
                      <Ionicons name="pencil-outline" size={18} color={C.text2} />
                    </TouchableOpacity>
                    <TouchableOpacity
                      accessibilityRole="button"
                      accessibilityLabel={`Delete note${note.day ? ` for day ${note.day}` : ''}`}
                      activeOpacity={0.72}
                      disabled={busy || Boolean(editingId)}
                      onPress={() => confirmDelete(note)}
                      style={[styles.noteAction, { opacity: busy || editingId ? 0.4 : 1 }]}
                    >
                      <Ionicons name="trash-outline" size={18} color={C.red} />
                    </TouchableOpacity>
                  </View>
                ))}
                {visibleNotes.length < notes.length ? (
                  <TouchableOpacity
                    accessibilityRole="button"
                    accessibilityLabel="Show more private notes"
                    activeOpacity={0.74}
                    onPress={() => setVisibleNoteCount(count => count + NOTE_RENDER_BATCH)}
                    style={[styles.showMoreRow, { borderBottomColor: C.border }]}
                  >
                    <Text style={[styles.showMoreText, { color: C.text2 }]}>Show more notes</Text>
                    <Ionicons name="chevron-down" size={16} color={C.text2} />
                  </TouchableOpacity>
                ) : null}
              </View>
            ) : null}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function DayOption({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  const C = useTheme();
  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={`${label}${selected ? ', selected' : ''}`}
      activeOpacity={0.75}
      onPress={onPress}
      style={[styles.dayOption, { backgroundColor: selected ? C.orange : C.s1 }]}
    >
      <Text style={[styles.dayOptionText, { color: selected ? '#FFFFFF' : C.text2 }]}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  modalRoot: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.42)',
  },
  sheet: {
    maxHeight: '90%',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    paddingTop: 9,
    paddingHorizontal: 18,
    boxShadow: '0 -8px 30px rgba(0,0,0,0.16)',
  },
  handle: {
    width: 38,
    height: 4,
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 12,
  },
  header: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  headerCopy: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    fontSize: 19,
    lineHeight: 24,
    fontWeight: '800',
    letterSpacing: 0,
  },
  tripName: {
    marginTop: 1,
    fontSize: 11.5,
    lineHeight: 16,
    fontWeight: '600',
    letterSpacing: 0,
  },
  iconButton: {
    width: 40,
    height: 40,
    borderWidth: 1,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  privateLine: {
    minHeight: 50,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  privateText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '600',
    letterSpacing: 0,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  addButton: {
    minHeight: 36,
    borderWidth: 1,
    borderRadius: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingHorizontal: 10,
  },
  addLabel: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '800',
    letterSpacing: 0,
  },
  scroll: {
    flexGrow: 0,
  },
  content: {
    paddingBottom: 8,
  },
  editor: {
    paddingVertical: 14,
    gap: 10,
  },
  input: {
    minHeight: 118,
    maxHeight: 220,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 11,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '500',
    letterSpacing: 0,
    textAlignVertical: 'top',
  },
  dayLabel: {
    fontSize: 10.5,
    lineHeight: 14,
    fontWeight: '700',
    letterSpacing: 0,
  },
  daySegments: {
    minHeight: 38,
    borderWidth: 1,
    borderRadius: 8,
    overflow: 'hidden',
  },
  dayOption: {
    minHeight: 36,
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  dayOptionText: {
    fontSize: 11.5,
    lineHeight: 16,
    fontWeight: '700',
    letterSpacing: 0,
  },
  editorActions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 8,
  },
  cancelButton: {
    minHeight: 42,
    borderWidth: 1,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 15,
  },
  cancelLabel: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '800',
    letterSpacing: 0,
  },
  saveButton: {
    minHeight: 42,
    borderRadius: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    paddingHorizontal: 15,
  },
  saveLabel: {
    color: '#FFFFFF',
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '800',
    letterSpacing: 0,
  },
  noteList: {
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  noteRow: {
    minHeight: 74,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 4,
    paddingVertical: 11,
  },
  noteCopy: {
    flex: 1,
    minWidth: 0,
  },
  noteMeta: {
    marginBottom: 3,
    fontSize: 10.5,
    lineHeight: 14,
    fontWeight: '700',
    letterSpacing: 0,
  },
  noteBody: {
    fontSize: 13.5,
    lineHeight: 19,
    fontWeight: '500',
    letterSpacing: 0,
  },
  noteAction: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  showMoreRow: {
    minHeight: 44,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
  },
  showMoreText: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '800',
    letterSpacing: 0,
  },
});
