import { Modal, Pressable, ScrollView, StyleSheet, Text, TouchableOpacity, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/lib/design';
import type { TripAction, TripLibraryItem } from './types';

type IconName = keyof typeof Ionicons.glyphMap;

type ActionRow = {
  id: TripAction;
  label: string;
  icon: IconName;
  destructive?: boolean;
};

function actionsForTrip(trip: TripLibraryItem): ActionRow[] {
  const statusActions: ActionRow[] = trip.status === 'archived'
    ? [{ id: 'restore', label: 'Restore to Saved', icon: 'arrow-undo-outline' }]
    : trip.status === 'draft'
      ? [
          { id: 'save', label: 'Save trip', icon: 'bookmark-outline' },
          { id: 'archive', label: 'Archive', icon: 'archive-outline' },
        ]
      : [{ id: 'archive', label: 'Archive', icon: 'archive-outline' }];
  return [
    { id: 'open', label: 'Open on map', icon: 'map-outline' },
    { id: 'offline', label: 'Offline', icon: 'cloud-download-outline' },
    { id: 'notes', label: 'Private notes', icon: 'document-text-outline' },
    { id: 'duplicate', label: 'Duplicate', icon: 'copy-outline' },
    ...statusActions,
    { id: 'export', label: 'Export GPX', icon: 'share-outline' },
    { id: 'delete', label: 'Delete', icon: 'trash-outline', destructive: true },
  ];
}

export default function TripActionSheet({
  trip,
  visible,
  busy,
  onClose,
  onAction,
}: {
  trip: TripLibraryItem | null;
  visible: boolean;
  busy?: boolean;
  onClose: () => void;
  onAction: (action: TripAction, trip: TripLibraryItem) => void;
}) {
  const C = useTheme();
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  if (!trip) return null;
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      accessibilityViewIsModal
    >
      <View style={styles.modalRoot}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close trip actions"
          onPress={onClose}
          style={styles.backdrop}
        />
        <View
          style={[
            styles.sheet,
            {
              backgroundColor: C.s1,
              borderColor: C.border2,
              maxHeight: Math.max(160, windowHeight - Math.max(insets.top, 8) - 8),
            },
          ]}
        >
          <View style={[styles.handle, { backgroundColor: C.border2 }]} />
          <ScrollView
            style={styles.scroll}
            contentContainerStyle={[styles.scrollContent, { paddingBottom: Math.max(insets.bottom, 14) }]}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            <Text style={[styles.title, { color: C.text }]} numberOfLines={2}>{trip.name}</Text>
            <Text style={[styles.subtitle, { color: C.text2 }]}>Trip actions</Text>
            <View style={[styles.divider, { backgroundColor: C.border }]} />
            {actionsForTrip(trip).map(action => {
              const color = action.destructive ? C.red : C.text;
              return (
                <TouchableOpacity
                  key={action.id}
                  accessibilityRole="button"
                  accessibilityLabel={`${action.label} ${trip.name}`}
                  activeOpacity={0.76}
                  disabled={busy}
                  onPress={() => onAction(action.id, trip)}
                  style={[styles.action, { opacity: busy ? 0.55 : 1 }]}
                >
                  <Ionicons name={action.icon} size={20} color={color} />
                  <Text style={[styles.actionLabel, { color }]}>{action.label}</Text>
                  <Ionicons name="chevron-forward" size={16} color={C.text3} />
                </TouchableOpacity>
              );
            })}
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Cancel trip actions"
              activeOpacity={0.78}
              onPress={onClose}
              style={[styles.cancel, { borderColor: C.border2 }]}
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
  modalRoot: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.42)',
  },
  sheet: {
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
    marginBottom: 16,
  },
  scroll: {
    flexGrow: 0,
  },
  scrollContent: {
    flexGrow: 0,
  },
  title: {
    fontSize: 18,
    lineHeight: 23,
    fontWeight: '800',
    letterSpacing: 0,
  },
  subtitle: {
    marginTop: 2,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '600',
    letterSpacing: 0,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    marginTop: 14,
  },
  action: {
    minHeight: 54,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 13,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(127,127,127,0.18)',
  },
  actionLabel: {
    flex: 1,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '700',
    letterSpacing: 0,
  },
  cancel: {
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderRadius: 8,
    marginTop: 12,
  },
  cancelLabel: {
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '800',
    letterSpacing: 0,
  },
});
