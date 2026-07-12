import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  api,
  type CommunityPublication,
  type CommunityPublicationType,
} from '@/lib/api';
import { useTheme, type ColorPalette } from '@/lib/design';
import type { TripDocumentV2, TripNoteV1 } from '@/lib/tripRepository';

const SOURCE_NOTE_RENDER_BATCH = 10;
const PLACE_RENDER_BATCH = 12;
const SUBMISSION_RENDER_BATCH = 12;

function normalizeTime(value: number) {
  const clean = Number(value);
  if (!Number.isFinite(clean) || clean <= 0) return null;
  return clean < 10_000_000_000 ? clean * 1000 : clean;
}

function formatDate(value: number) {
  const clean = normalizeTime(value);
  if (!clean) return 'Recently submitted';
  return new Date(clean).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function publicationTypeLabel(type: CommunityPublicationType) {
  if (type === 'trip_recap') return 'Trip recap';
  if (type === 'place_update') return 'Place update';
  return 'Correction';
}

function statusLabel(status: CommunityPublication['status']) {
  if (status === 'pending_review') return 'Pending review';
  if (status === 'approved') return 'Approved';
  if (status === 'rejected') return 'Not approved';
  if (status === 'retracted') return 'Retracted';
  return 'In review';
}

function statusColor(status: CommunityPublication['status'], C: ColorPalette) {
  if (status === 'approved') return C.green;
  if (status === 'rejected') return C.red;
  if (status === 'pending_review') return C.yellow;
  return C.text2;
}

export default function TripPublicationPanel({
  trip,
  initialNote,
  onBack,
  onBusyChange,
}: {
  trip: TripDocumentV2;
  initialNote: TripNoteV1 | null;
  onBack: () => void;
  onBusyChange?: (busy: boolean) => void;
}) {
  const C = useTheme();
  const requestSequence = useRef(0);
  const [sourceNoteId, setSourceNoteId] = useState<string | null>(initialNote?.id ?? null);
  const [publicationType, setPublicationType] = useState<CommunityPublicationType>('trip_recap');
  const [title, setTitle] = useState(initialNote ? trip.title : '');
  const [body, setBody] = useState(initialNote?.body ?? '');
  const [placeId, setPlaceId] = useState('');
  const [submissions, setSubmissions] = useState<CommunityPublication[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [retractingId, setRetractingId] = useState('');
  const [visibleSourceCount, setVisibleSourceCount] = useState(SOURCE_NOTE_RENDER_BATCH);
  const [visiblePlaceCount, setVisiblePlaceCount] = useState(PLACE_RENDER_BATCH);
  const [visibleSubmissionCount, setVisibleSubmissionCount] = useState(SUBMISSION_RENDER_BATCH);

  const sourceNote = trip.notes.find(note => note.id === sourceNoteId) ?? null;
  const placeItems = useMemo(() => {
    const unique = new Map<string, { id: string; title: string; kind: string }>();
    for (const item of trip.items) {
      if (!item.entityId || item.kind === 'note') continue;
      unique.set(item.entityId, { id: item.entityId, title: item.title, kind: item.kind });
    }
    return [...unique.values()];
  }, [trip.items]);
  const placeRequired = publicationType === 'place_update' || publicationType === 'correction';
  const sortedSourceNotes = useMemo(
    () => [...trip.notes].sort((left, right) => right.updatedAt - left.updatedAt),
    [trip.notes],
  );
  const visibleSourceNotes = sortedSourceNotes.slice(0, visibleSourceCount);
  const visiblePlaceItems = placeItems.slice(0, visiblePlaceCount);
  const visibleSubmissions = submissions.slice(0, visibleSubmissionCount);
  const busy = submitting || Boolean(retractingId);

  useEffect(() => {
    setVisibleSourceCount(SOURCE_NOTE_RENDER_BATCH);
    setVisiblePlaceCount(PLACE_RENDER_BATCH);
    setVisibleSubmissionCount(SUBMISSION_RENDER_BATCH);
  }, [trip.id]);

  useEffect(() => {
    onBusyChange?.(busy);
  }, [busy, onBusyChange]);

  const loadSubmissions = useCallback(async () => {
    const request = ++requestSequence.current;
    setLoading(true);
    setLoadError('');
    try {
      const collected: CommunityPublication[] = [];
      const seenCursors = new Set<string>();
      let cursor: string | undefined;
      do {
        const page = await api.listCommunityPublications({ limit: 100, cursor });
        collected.push(...(page.items ?? []));
        const next = page.next_cursor || undefined;
        if (next && seenCursors.has(next)) throw new Error('Submission history could not finish loading.');
        if (next) seenCursors.add(next);
        cursor = next;
      } while (cursor);
      if (request !== requestSequence.current) return;
      const unique = new Map<string, CommunityPublication>();
      for (const submission of collected) unique.set(submission.id, submission);
      setSubmissions([...unique.values()].sort((left, right) => right.updated_at - left.updated_at));
    } catch {
      if (request === requestSequence.current) setLoadError('Submission history could not be loaded.');
    } finally {
      if (request === requestSequence.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSubmissions();
    return () => {
      requestSequence.current += 1;
      onBusyChange?.(false);
    };
  }, [loadSubmissions, onBusyChange]);

  const beginReview = (note: TripNoteV1) => {
    setSourceNoteId(note.id);
    setPublicationType('trip_recap');
    setTitle(trip.title);
    setBody(note.body);
    setPlaceId('');
  };

  const cancelReview = () => {
    setSourceNoteId(null);
    setTitle('');
    setBody('');
    setPlaceId('');
    setPublicationType('trip_recap');
  };

  const submit = () => {
    const cleanTitle = title.trim();
    const cleanBody = body.trim();
    if (!sourceNote || !cleanTitle || !cleanBody || busy || placeRequired && !placeId) return;
    Alert.alert(
      'Submit this copy for review?',
      'Your private note stays private. Trailhead will review only the title and body shown here.',
      [
        { text: 'Keep editing', style: 'cancel' },
        {
          text: 'Submit for review',
          onPress: () => {
            setSubmitting(true);
            void api.createCommunityPublication({
              trip_id: trip.id,
              note_id: sourceNote.id,
              publication_type: publicationType,
              title: cleanTitle,
              body: cleanBody,
              place_id: placeRequired ? placeId : undefined,
            })
              .then(created => {
                setSubmissions(current => [created, ...current.filter(item => item.id !== created.id)]);
                cancelReview();
                Alert.alert('Submitted for review', 'You can follow its status here.');
              })
              .catch(() => Alert.alert('Submission not sent', 'This copy could not be submitted. Check it and try again.'))
              .finally(() => setSubmitting(false));
          },
        },
      ],
    );
  };

  const retract = (submission: CommunityPublication) => {
    if (busy) return;
    Alert.alert(
      'Retract this submission?',
      'It will be removed from review and cannot be approved.',
      [
        { text: 'Keep submission', style: 'cancel' },
        {
          text: 'Retract',
          style: 'destructive',
          onPress: () => {
            setRetractingId(submission.id);
            void api.retractCommunityPublication(submission.id)
              .then(updated => setSubmissions(current => current.map(item => item.id === updated.id ? updated : item)))
              .catch(() => Alert.alert('Submission not retracted', 'This submission could not be updated. Try again.'))
              .finally(() => setRetractingId(''));
          },
        },
      ],
    );
  };

  return (
    <View style={styles.panel}>
      <View style={[styles.reviewNotice, { borderTopColor: C.border, borderBottomColor: C.border }] }>
        <Ionicons name="shield-checkmark-outline" size={17} color={C.green} />
        <Text style={[styles.reviewNoticeText, { color: C.text2 }]}>Private notes stay private. You review a separate copy before it is sent.</Text>
      </View>

      {sourceNote ? (
        <View style={styles.editor}>
          <Text accessibilityRole="header" style={[styles.sectionTitle, { color: C.text }]}>Review submission</Text>
          <View style={[styles.typeSegment, { borderColor: C.border2 }] }>
            {([
              ['trip_recap', 'Trip recap'],
              ['place_update', 'Place update'],
              ['correction', 'Correction'],
            ] as const).map(([value, label]) => {
              const selected = publicationType === value;
              return (
                <TouchableOpacity
                  key={value}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  accessibilityLabel={`${label}${selected ? ', selected' : ''}`}
                  activeOpacity={0.76}
                  onPress={() => {
                    setPublicationType(value);
                    if (value === 'trip_recap') setPlaceId('');
                  }}
                  style={[styles.typeOption, { backgroundColor: selected ? C.orange : C.s1 }]}
                >
                  <Text style={[styles.typeOptionText, { color: selected ? '#FFFFFF' : C.text2 }]}>{label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <Text style={[styles.fieldLabel, { color: C.text2 }]}>Title</Text>
          <TextInput
            accessibilityLabel="Submission title"
            maxLength={140}
            placeholder="Title"
            placeholderTextColor={C.text3}
            selectionColor={C.orange}
            value={title}
            onChangeText={setTitle}
            style={[styles.titleInput, { color: C.text, backgroundColor: C.s2, borderColor: C.border2 }]}
          />

          <Text style={[styles.fieldLabel, { color: C.text2 }]}>Body</Text>
          <TextInput
            accessibilityLabel="Submission body"
            multiline
            maxLength={5_000}
            placeholder="Review the copy that will be submitted"
            placeholderTextColor={C.text3}
            selectionColor={C.orange}
            value={body}
            onChangeText={setBody}
            style={[styles.bodyInput, { color: C.text, backgroundColor: C.s2, borderColor: C.border2 }]}
          />

          {placeRequired ? (
            <View style={styles.placeSection}>
              <Text style={[styles.fieldLabel, { color: C.text2 }]}>Linked place</Text>
              {placeItems.length > 0 ? (
                <View style={[styles.placeList, { borderTopColor: C.border }] }>
                  {visiblePlaceItems.map(item => {
                    const selected = placeId === item.id;
                    return (
                      <TouchableOpacity
                        key={item.id}
                        accessibilityRole="radio"
                        accessibilityState={{ selected }}
                        accessibilityLabel={`${item.title}${selected ? ', selected' : ''}`}
                        activeOpacity={0.72}
                        onPress={() => setPlaceId(item.id)}
                        style={[styles.placeRow, { borderBottomColor: C.border }]}
                      >
                        <Ionicons name={selected ? 'radio-button-on' : 'radio-button-off'} size={18} color={selected ? C.orange : C.text3} />
                        <View style={styles.placeCopy}>
                          <Text style={[styles.placeTitle, { color: C.text }]} numberOfLines={1}>{item.title}</Text>
                          <Text style={[styles.placeKind, { color: C.text2 }]}>{item.kind.replace(/_/g, ' ')}</Text>
                        </View>
                      </TouchableOpacity>
                    );
                  })}
                  {visiblePlaceItems.length < placeItems.length ? (
                    <ShowMoreRow label="Show more places" onPress={() => setVisiblePlaceCount(count => count + PLACE_RENDER_BATCH)} />
                  ) : null}
                </View>
              ) : (
                <View style={[styles.missingPlaceRow, { borderTopColor: C.border, borderBottomColor: C.border }] }>
                  <Ionicons name="location-outline" size={17} color={C.text3} />
                  <Text style={[styles.missingPlaceText, { color: C.text2 }]}>Add a saved place to this trip before submitting a place update or correction.</Text>
                </View>
              )}
            </View>
          ) : null}

          <View style={styles.editorActions}>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Cancel submission review"
              activeOpacity={0.74}
              disabled={submitting}
              onPress={cancelReview}
              style={[styles.secondaryButton, { borderColor: C.border2 }]}
            >
              <Text style={[styles.secondaryButtonText, { color: C.text2 }]}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Submit copy for review"
              activeOpacity={0.8}
              disabled={submitting || !title.trim() || !body.trim() || placeRequired && !placeId}
              onPress={submit}
              style={[
                styles.primaryButton,
                { backgroundColor: C.orange, opacity: submitting || !title.trim() || !body.trim() || placeRequired && !placeId ? 0.5 : 1 },
              ]}
            >
              {submitting ? <ActivityIndicator size="small" color="#FFFFFF" /> : <Ionicons name="send-outline" size={17} color="#FFFFFF" />}
              <Text style={styles.primaryButtonText}>Submit for review</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : (
        <View style={styles.sourceSection}>
          <View style={styles.sourceHeading}>
            <Text accessibilityRole="header" style={[styles.sectionTitle, { color: C.text }]}>Choose a private note</Text>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Back to private notes"
              activeOpacity={0.72}
              onPress={onBack}
              style={styles.backAction}
            >
              <Ionicons name="arrow-back" size={16} color={C.orange} />
              <Text style={[styles.backActionText, { color: C.orange }]}>Notes</Text>
            </TouchableOpacity>
          </View>
          {trip.notes.length > 0 ? (
            <View style={[styles.sourceList, { borderTopColor: C.border }] }>
              {visibleSourceNotes.map(note => (
                <View key={note.id} style={[styles.sourceRow, { borderBottomColor: C.border }] }>
                  <View style={styles.sourceCopy}>
                    <Text style={[styles.sourceMeta, { color: C.text2 }]}>{note.day ? `Day ${note.day}` : 'Whole trip'}</Text>
                    <Text style={[styles.sourceBody, { color: C.text }]} numberOfLines={3}>{note.body}</Text>
                  </View>
                  <TouchableOpacity
                    accessibilityRole="button"
                    accessibilityLabel={`Review a copy of this ${note.day ? `day ${note.day} ` : ''}note`}
                    activeOpacity={0.74}
                    onPress={() => beginReview(note)}
                    style={[styles.reviewButton, { borderColor: C.border2 }]}
                  >
                    <Ionicons name="create-outline" size={16} color={C.orange} />
                    <Text style={[styles.reviewButtonText, { color: C.text }]}>Review</Text>
                  </TouchableOpacity>
                </View>
              ))}
              {visibleSourceNotes.length < sortedSourceNotes.length ? (
                <ShowMoreRow label="Show more notes" onPress={() => setVisibleSourceCount(count => count + SOURCE_NOTE_RENDER_BATCH)} />
              ) : null}
            </View>
          ) : (
            <View style={[styles.missingPlaceRow, { borderTopColor: C.border, borderBottomColor: C.border }] }>
              <Ionicons name="document-text-outline" size={17} color={C.text3} />
              <Text style={[styles.missingPlaceText, { color: C.text2 }]}>Add a private note before preparing a community submission.</Text>
            </View>
          )}
        </View>
      )}

      <View style={styles.submissionSection}>
        <Text accessibilityRole="header" style={[styles.sectionTitle, { color: C.text }]}>Your submissions</Text>
        {loading ? (
          <View style={styles.loadingRow}>
            <ActivityIndicator size="small" color={C.orange} />
            <Text style={[styles.loadingText, { color: C.text2 }]}>Loading submission history</Text>
          </View>
        ) : loadError ? (
          <View style={[styles.errorRow, { borderTopColor: C.border, borderBottomColor: C.border }] }>
            <Ionicons name="alert-circle-outline" size={18} color={C.yellow} />
            <Text style={[styles.errorText, { color: C.text2 }]}>{loadError}</Text>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Try loading submission history again"
              activeOpacity={0.74}
              onPress={() => void loadSubmissions()}
              style={[styles.retryButton, { borderColor: C.border2 }]}
            >
              <Text style={[styles.retryText, { color: C.orange }]}>Retry</Text>
            </TouchableOpacity>
          </View>
        ) : submissions.length > 0 ? (
          <View style={[styles.submissionList, { borderTopColor: C.border }] }>
            {visibleSubmissions.map(submission => {
              const retractable = submission.status === 'pending_review' || submission.status === 'approved';
              const retracting = retractingId === submission.id;
              return (
                <View key={submission.id} style={[styles.submissionRow, { borderBottomColor: C.border }] }>
                  <View style={styles.submissionCopy}>
                    <View style={styles.submissionTitleRow}>
                      <Text style={[styles.submissionTitle, { color: C.text }]} numberOfLines={2}>{submission.title}</Text>
                      <Text style={[styles.submissionStatus, { color: statusColor(submission.status, C) }]}>{statusLabel(submission.status)}</Text>
                    </View>
                    <Text style={[styles.submissionMeta, { color: C.text2 }]} numberOfLines={1}>
                      {publicationTypeLabel(submission.publication_type)} | {formatDate(submission.submitted_at)}
                    </Text>
                  </View>
                  {retractable ? (
                    <TouchableOpacity
                      accessibilityRole="button"
                      accessibilityLabel={`Retract ${submission.title}`}
                      activeOpacity={0.72}
                      disabled={busy}
                      onPress={() => retract(submission)}
                      style={[styles.retractButton, { borderColor: C.border2, opacity: busy && !retracting ? 0.45 : 1 }]}
                    >
                      {retracting ? <ActivityIndicator size="small" color={C.red} /> : <Ionicons name="arrow-undo-outline" size={16} color={C.red} />}
                      <Text style={[styles.retractText, { color: C.red }]}>Retract</Text>
                    </TouchableOpacity>
                  ) : null}
                </View>
              );
            })}
            {visibleSubmissions.length < submissions.length ? (
              <ShowMoreRow label="Show more submissions" onPress={() => setVisibleSubmissionCount(count => count + SUBMISSION_RENDER_BATCH)} />
            ) : null}
          </View>
        ) : null}
      </View>
    </View>
  );
}

function ShowMoreRow({ label, onPress }: { label: string; onPress: () => void }) {
  const C = useTheme();
  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityLabel={label}
      activeOpacity={0.74}
      onPress={onPress}
      style={[styles.showMoreRow, { borderBottomColor: C.border }]}
    >
      <Text style={[styles.showMoreText, { color: C.text2 }]}>{label}</Text>
      <Ionicons name="chevron-down" size={16} color={C.text2} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  panel: {
    gap: 18,
    paddingBottom: 8,
  },
  reviewNotice: {
    minHeight: 54,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    paddingVertical: 9,
  },
  reviewNoticeText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '600',
    letterSpacing: 0,
  },
  editor: {
    gap: 10,
  },
  sectionTitle: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '800',
    letterSpacing: 0,
  },
  typeSegment: {
    minHeight: 46,
    borderWidth: 1,
    borderRadius: 8,
    flexDirection: 'row',
    overflow: 'hidden',
  },
  typeOption: {
    flex: 1,
    minWidth: 0,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  typeOptionText: {
    fontSize: 10.5,
    lineHeight: 14,
    fontWeight: '800',
    letterSpacing: 0,
    textAlign: 'center',
  },
  fieldLabel: {
    marginTop: 2,
    fontSize: 10.5,
    lineHeight: 14,
    fontWeight: '700',
    letterSpacing: 0,
  },
  titleInput: {
    minHeight: 44,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    fontSize: 14,
    lineHeight: 19,
    fontWeight: '600',
    letterSpacing: 0,
  },
  bodyInput: {
    minHeight: 144,
    maxHeight: 260,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 11,
    fontSize: 13.5,
    lineHeight: 20,
    fontWeight: '500',
    letterSpacing: 0,
    textAlignVertical: 'top',
  },
  placeSection: {
    gap: 7,
  },
  placeList: {
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  placeRow: {
    minHeight: 54,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    paddingVertical: 8,
  },
  placeCopy: {
    flex: 1,
    minWidth: 0,
  },
  placeTitle: {
    fontSize: 13,
    lineHeight: 17,
    fontWeight: '700',
    letterSpacing: 0,
  },
  placeKind: {
    marginTop: 1,
    fontSize: 10.5,
    lineHeight: 14,
    fontWeight: '600',
    letterSpacing: 0,
    textTransform: 'capitalize',
  },
  missingPlaceRow: {
    minHeight: 58,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    paddingVertical: 9,
  },
  missingPlaceText: {
    flex: 1,
    fontSize: 11.5,
    lineHeight: 17,
    fontWeight: '600',
    letterSpacing: 0,
  },
  editorActions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 8,
  },
  secondaryButton: {
    minHeight: 44,
    borderWidth: 1,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
  },
  secondaryButtonText: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '800',
    letterSpacing: 0,
  },
  primaryButton: {
    minHeight: 44,
    borderRadius: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    paddingHorizontal: 14,
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '800',
    letterSpacing: 0,
  },
  sourceSection: {
    gap: 9,
  },
  sourceHeading: {
    minHeight: 34,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  backAction: {
    minHeight: 34,
    marginLeft: 'auto',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  backActionText: {
    fontSize: 11.5,
    lineHeight: 16,
    fontWeight: '800',
    letterSpacing: 0,
  },
  sourceList: {
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  sourceRow: {
    minHeight: 70,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 9,
  },
  sourceCopy: {
    flex: 1,
    minWidth: 0,
  },
  sourceMeta: {
    marginBottom: 2,
    fontSize: 10.5,
    lineHeight: 14,
    fontWeight: '700',
    letterSpacing: 0,
  },
  sourceBody: {
    fontSize: 12.5,
    lineHeight: 17,
    fontWeight: '500',
    letterSpacing: 0,
  },
  reviewButton: {
    minHeight: 40,
    borderWidth: 1,
    borderRadius: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingHorizontal: 9,
  },
  reviewButtonText: {
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '800',
    letterSpacing: 0,
  },
  submissionSection: {
    gap: 9,
  },
  loadingRow: {
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
  },
  loadingText: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '600',
    letterSpacing: 0,
  },
  errorRow: {
    minHeight: 64,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    paddingVertical: 9,
  },
  errorText: {
    flex: 1,
    fontSize: 11.5,
    lineHeight: 17,
    fontWeight: '600',
    letterSpacing: 0,
  },
  retryButton: {
    minWidth: 58,
    minHeight: 36,
    borderWidth: 1,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
  },
  retryText: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '800',
    letterSpacing: 0,
  },
  submissionList: {
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  submissionRow: {
    minHeight: 70,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    paddingVertical: 9,
  },
  submissionCopy: {
    flex: 1,
    minWidth: 0,
  },
  submissionTitleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 7,
  },
  submissionTitle: {
    flex: 1,
    minWidth: 0,
    fontSize: 12.5,
    lineHeight: 17,
    fontWeight: '700',
    letterSpacing: 0,
  },
  submissionStatus: {
    fontSize: 9.5,
    lineHeight: 13,
    fontWeight: '800',
    letterSpacing: 0,
  },
  submissionMeta: {
    marginTop: 3,
    fontSize: 10.5,
    lineHeight: 14,
    fontWeight: '600',
    letterSpacing: 0,
  },
  retractButton: {
    minHeight: 38,
    borderWidth: 1,
    borderRadius: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingHorizontal: 8,
  },
  retractText: {
    fontSize: 10.5,
    lineHeight: 14,
    fontWeight: '800',
    letterSpacing: 0,
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
