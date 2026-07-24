import { StyleProp, StyleSheet, Text, TouchableOpacity, View, ViewStyle } from 'react-native';
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
  href: PlanWorkspaceHref;
}> = [
  {
    id: 'assisted',
    label: 'Trip Planner',
    accessibilityLabel: 'Trip Planner',
    href: '/(tabs)/plan',
  },
  {
    id: 'manual',
    label: 'Route Builder',
    accessibilityLabel: 'Route Builder',
    href: '/(tabs)/route-builder',
  },
  {
    id: 'trips',
    label: 'Trips',
    accessibilityLabel: 'Trips',
    href: '/(tabs)/trips',
  },
];

export default function PlanWorkspaceSwitcher({ active, style, onSelect }: PlanWorkspaceSwitcherProps) {
  const C = useTheme();
  const router = useRouter();

  return (
    <View style={[styles.shell, style]}>
      <View
        accessibilityRole="tablist"
        style={[styles.track, { borderBottomColor: C.border }]}
      >
        {WORKSPACES.map(workspace => {
          const selected = workspace.id === active;
          return (
            <TouchableOpacity
              key={workspace.id}
              testID={`plan.workspace.${workspace.id}`}
              accessibilityRole="tab"
              accessibilityLabel={workspace.accessibilityLabel}
              accessibilityState={{ selected }}
              activeOpacity={selected ? 1 : 0.72}
              onPress={() => {
                if (selected) return;
                if (onSelect) onSelect(workspace.id, workspace.href);
                else router.replace(workspace.href);
              }}
              style={styles.segment}
            >
              <Text
                numberOfLines={1}
                style={[
                  styles.label,
                  { color: selected ? C.text : C.text2 },
                  selected && styles.labelSelected,
                ]}
              >
                {workspace.label}
              </Text>
              {selected && <View style={[styles.activeIndicator, { backgroundColor: C.orange }]} />}
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
    paddingHorizontal: 20,
  },
  track: {
    width: '100%',
    maxWidth: 520,
    minHeight: 46,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'stretch',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
  },
  segment: {
    minHeight: 46,
    minWidth: 44,
    alignItems: 'flex-start',
    justifyContent: 'flex-end',
    paddingBottom: 12,
    position: 'relative',
  },
  label: {
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '400',
    letterSpacing: 0,
  },
  labelSelected: {
    fontWeight: '700',
  },
  activeIndicator: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: -1,
    height: 3,
    borderRadius: 2,
  },
});
