import { Modal, Pressable, ScrollView, StyleSheet, Text, TouchableOpacity, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import { useTheme } from '@/lib/design';

export type TrailActionSheetItem = {
  id: string;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
};

export default function TrailActionSheet({
  visible,
  trailName,
  actions,
  onClose,
  onAction,
}: {
  visible: boolean;
  trailName: string;
  actions: TrailActionSheetItem[];
  onClose: () => void;
  onAction: (action: TrailActionSheetItem) => void;
}) {
  const C = useTheme();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} accessibilityViewIsModal>
      <View style={styles.root} testID="trail.actions.sheet">
        <Pressable
          style={styles.backdrop}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Close trail actions"
          testID="trail.actions.backdrop"
        />
        <View
          style={[
            styles.sheet,
            {
              backgroundColor: C.s1,
              borderColor: C.border2,
              maxHeight: Math.max(220, height - Math.max(insets.top, 8) - 8),
            },
          ]}
        >
          <View style={[styles.handle, { backgroundColor: C.border2 }]} />
          <ScrollView
            style={styles.scroll}
            contentContainerStyle={[styles.content, { paddingBottom: Math.max(insets.bottom, 14) }]}
            showsVerticalScrollIndicator={false}
          >
            <Text style={[styles.title, { color: C.text }]} numberOfLines={2}>{trailName}</Text>
            <View style={[styles.divider, { backgroundColor: C.border }]} />
            {actions.map(action => (
              <TouchableOpacity
                key={action.id}
                style={styles.action}
                activeOpacity={0.76}
                onPress={() => onAction(action)}
                accessibilityRole="button"
                accessibilityLabel={`${action.label} ${trailName}`}
                testID={`trail.actions.${action.id}`}
              >
                <Ionicons name={action.icon} size={20} color={C.text} />
                <Text style={[styles.actionLabel, { color: C.text }]}>{action.label}</Text>
                <Ionicons name="chevron-forward" size={16} color={C.text3} />
              </TouchableOpacity>
            ))}
            <TouchableOpacity
              style={[styles.cancel, { borderColor: C.border2 }]}
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="Cancel trail actions"
              testID="trail.actions.cancel"
            >
              <Text style={[styles.cancelLabel, { color: C.text2 }]}>Cancel</Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.42)' },
  sheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    paddingTop: 9,
    paddingHorizontal: 18,
    boxShadow: '0 -8px 30px rgba(0,0,0,0.16)',
  },
  handle: { width: 38, height: 4, borderRadius: 2, alignSelf: 'center', marginBottom: 16 },
  scroll: { flexGrow: 0 },
  content: { flexGrow: 0 },
  title: { fontSize: 20, lineHeight: 25, fontWeight: '800' },
  divider: { height: StyleSheet.hairlineWidth, marginTop: 14 },
  action: {
    minHeight: 54,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 13,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(127,127,127,0.18)',
  },
  actionLabel: { flex: 1, fontSize: 15, lineHeight: 20, fontWeight: '700' },
  cancel: {
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderRadius: 12,
    marginTop: 12,
  },
  cancelLabel: { fontSize: 14, lineHeight: 18, fontWeight: '800' },
});
