import { StyleProp, StyleSheet, Text, TouchableOpacity, View, ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useTheme } from '@/lib/design';

export type PlanWorkspace = 'assisted' | 'manual' | 'trips';
export type PlanWorkspaceHref = '/(tabs)/plan' | '/(tabs)/route-builder' | '/(tabs)/trips';

type PlanWorkspaceSwitcherProps = {
  active: PlanWorkspace;
  style?: StyleProp<ViewStyle>;
  onSelect?: (workspace: PlanWorkspace, href: PlanWorkspaceHref) => void;
};

const WORKSPACES: Array<{
  id: PlanWorkspace;
  label: string;
  accessibilityLabel: string;
  icon: keyof typeof Ionicons.glyphMap;
  href: PlanWorkspaceHref;
}> = [
  {
    id: 'assisted',
    label: 'Assisted',
    accessibilityLabel: 'Assisted planning workspace',
    icon: 'sparkles-outline',
    href: '/(tabs)/plan',
  },
  {
    id: 'manual',
    label: 'Manual',
    accessibilityLabel: 'Manual route builder workspace',
    icon: 'construct-outline',
    href: '/(tabs)/route-builder',
  },
  {
    id: 'trips',
    label: 'Trips',
    accessibilityLabel: 'Trips workspace',
    icon: 'map-outline',
    href: '/(tabs)/trips',
  },
];

export default function PlanWorkspaceSwitcher({ active, style, onSelect }: PlanWorkspaceSwitcherProps) {
  const C = useTheme();
  const router = useRouter();

  return (
    <View style={[styles.shell, style]}>
      <View style={[styles.track, { backgroundColor: C.s1, borderColor: C.border }]}>
        {WORKSPACES.map(workspace => {
          const selected = workspace.id === active;
          return (
            <TouchableOpacity
              key={workspace.id}
              accessibilityRole="tab"
              accessibilityLabel={workspace.accessibilityLabel}
              accessibilityState={{ selected }}
              activeOpacity={selected ? 1 : 0.72}
              onPress={() => {
                if (selected) return;
                if (onSelect) onSelect(workspace.id, workspace.href);
                else router.replace(workspace.href);
              }}
              style={[
                styles.segment,
                selected && {
                  backgroundColor: C.text,
                  shadowColor: '#000000',
                },
              ]}
            >
              <Ionicons
                name={workspace.icon}
                size={15}
                color={selected ? C.orange : C.text3}
              />
              <Text
                numberOfLines={1}
                style={[
                  styles.label,
                  { color: selected ? C.bg : C.text2 },
                ]}
              >
                {workspace.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  shell: {
    width: '100%',
    paddingHorizontal: 14,
  },
  track: {
    width: '100%',
    maxWidth: 520,
    minHeight: 44,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: 3,
    padding: 3,
    borderWidth: 1,
    borderRadius: 8,
  },
  segment: {
    flex: 1,
    minWidth: 0,
    minHeight: 36,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: 8,
    borderRadius: 5,
    shadowOpacity: 0.12,
    shadowRadius: 5,
    shadowOffset: { width: 0, height: 2 },
    elevation: 0,
  },
  label: {
    flexShrink: 1,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '800',
    letterSpacing: 0,
  },
});
