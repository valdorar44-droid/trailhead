import React, { useMemo } from 'react';
import { ActivityIndicator, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import type { CampComment } from '@/lib/api';
import { mono, useTheme, type ColorPalette } from '@/lib/design';

type Props = {
  comments: CampComment[];
  limit: number;
  showForm: boolean;
  commentText: string;
  commentSubmitting: boolean;
  canComment: boolean;
  onOpenForm: () => void;
  onCancelForm: () => void;
  onChangeCommentText: (value: string) => void;
  onSubmitComment: () => void;
};

export default function CampCommentsSection({
  comments,
  limit,
  showForm,
  commentText,
  commentSubmitting,
  canComment,
  onOpenForm,
  onCancelForm,
  onChangeCommentText,
  onSubmitComment,
}: Props) {
  const C = useTheme();
  const s = useMemo(() => makeStyles(C), [C]);
  const trimmedLength = commentText.trim().length;

  return (
    <View style={s.section}>
      <View style={s.header}>
        <Text style={s.sectionTitle}>COMMENTS & QUESTIONS</Text>
        {comments.length > 0 ? (
          <Text style={s.count}>
            {comments.length} {comments.length === 1 ? 'comment' : 'comments'}
          </Text>
        ) : null}
      </View>

      {comments.slice(0, limit).map(comment => (
        <View key={comment.id} style={s.commentCard}>
          <View style={s.commentTop}>
            <Text style={s.commentAuthor} numberOfLines={1}>{comment.username}</Text>
            <Text style={s.commentDate}>{new Date(comment.created_at * 1000).toLocaleDateString()}</Text>
          </View>
          <Text style={s.commentBody}>{comment.body}</Text>
        </View>
      ))}

      {!comments.length && !showForm ? (
        <Text style={s.emptyText}>Ask a question or leave a recent note.</Text>
      ) : null}

      {showForm ? (
        <View style={s.form}>
          <Text style={s.formLabel}>Comment</Text>
          <TextInput
            style={s.noteInput}
            value={commentText}
            onChangeText={value => onChangeCommentText(value.slice(0, 800))}
            placeholder="Ask a question, share a recent condition, or add a useful note..."
            placeholderTextColor={C.text3}
            multiline
            numberOfLines={4}
          />
          <Text style={s.charCount}>{commentText.length}/800</Text>
          <View style={s.formActions}>
            <TouchableOpacity style={s.cancelBtn} onPress={onCancelForm}>
              <Text style={s.cancelText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[s.submitBtn, (trimmedLength < 2 || commentSubmitting) && { opacity: 0.5 }]}
              onPress={onSubmitComment}
              disabled={trimmedLength < 2 || commentSubmitting}
            >
              {commentSubmitting ? <ActivityIndicator size="small" color="#fff" /> : <Text style={s.submitText}>POST COMMENT</Text>}
            </TouchableOpacity>
          </View>
        </View>
      ) : canComment ? (
        <TouchableOpacity style={s.addBtn} onPress={onOpenForm}>
          <Ionicons name="chatbubble-ellipses-outline" size={15} color={C.orange} />
          <Text style={s.addBtnText}>ADD COMMENT</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

const makeStyles = (C: ColorPalette) => StyleSheet.create({
  section: {
    paddingTop: 22,
    marginTop: 18,
    borderTopWidth: 1,
    borderColor: C.border,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  sectionTitle: {
    color: C.text2,
    fontSize: 10,
    fontFamily: mono,
    fontWeight: '800',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
  },
  count: {
    color: C.text3,
    fontSize: 11,
    fontFamily: mono,
  },
  commentCard: {
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.s1,
    borderRadius: 12,
    padding: 12,
    gap: 7,
    marginBottom: 8,
  },
  commentTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  commentAuthor: {
    flex: 1,
    color: C.text,
    fontSize: 12,
    fontWeight: '800',
  },
  commentDate: {
    color: C.text3,
    fontSize: 10,
    fontFamily: mono,
  },
  commentBody: {
    color: C.text2,
    fontSize: 13,
    lineHeight: 19,
  },
  emptyText: {
    color: C.text3,
    fontSize: 12,
    fontStyle: 'italic',
    marginBottom: 10,
  },
  form: {
    backgroundColor: C.s2,
    borderRadius: 12,
    padding: 14,
    gap: 4,
  },
  formLabel: {
    color: C.text,
    fontSize: 12,
    fontWeight: '700',
    fontFamily: mono,
    marginTop: 8,
    marginBottom: 4,
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
  formActions: {
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
  submitText: {
    color: '#fff',
    fontSize: 11,
    fontFamily: mono,
    fontWeight: '800',
  },
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 10,
  },
  addBtnText: {
    color: C.orange,
    fontSize: 12,
    fontFamily: mono,
    fontWeight: '700',
  },
});
