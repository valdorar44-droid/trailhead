import { Ionicons } from '@expo/vector-icons';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { TrailheadSheet } from '@/components/TrailheadUI';
import { useTheme } from '@/lib/design';
import { trailheadFonts } from '@/lib/typography';

type IconName = keyof typeof Ionicons.glyphMap;

export type TrailBuilderChoice = Readonly<{
  id: string;
  label: string;
  icon?: IconName;
  disabled?: boolean;
}>;

export type TrailBuilderMetric = Readonly<{
  label: string;
  value: string;
}>;

export type TrailBuilderRouteChoice = Readonly<{
  id: string;
  title: string;
  subtitle?: string;
  selected?: boolean;
}>;

function CloseButton({ testID, onPress }: Readonly<{ testID: string; onPress: () => void }>) {
  const C = useTheme();
  return (
    <TouchableOpacity
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel="Close Trail Builder"
      activeOpacity={0.82}
      hitSlop={8}
      onPress={onPress}
      style={[styles.iconButton, { backgroundColor: C.s1, borderColor: C.border }]}
    >
      <Ionicons name="close" size={20} color={C.text2} />
    </TouchableOpacity>
  );
}

function Header({
  title,
  subtitle,
  closeTestID,
  onClose,
}: Readonly<{
  title: string;
  subtitle?: string;
  closeTestID: string;
  onClose: () => void;
}>) {
  const C = useTheme();
  return (
    <View style={styles.header}>
      <View style={styles.headerCopy}>
        <Text style={[styles.title, { color: C.text }]}>{title}</Text>
        {subtitle ? <Text style={[styles.subtitle, { color: C.text2 }]}>{subtitle}</Text> : null}
      </View>
      <CloseButton testID={closeTestID} onPress={onClose} />
    </View>
  );
}

function PrimaryButton({
  testID,
  label,
  icon,
  disabled,
  busy,
  onPress,
  style,
}: Readonly<{
  testID: string;
  label: string;
  icon?: IconName;
  disabled?: boolean;
  busy?: boolean;
  onPress: () => void;
  style?: object;
}>) {
  const C = useTheme();
  const unavailable = Boolean(disabled || busy);
  return (
    <TouchableOpacity
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: unavailable, busy: Boolean(busy) }}
      activeOpacity={0.84}
      disabled={unavailable}
      onPress={onPress}
      style={[styles.primaryButton, { backgroundColor: unavailable ? C.s3 : C.orange }, style]}
    >
      {busy ? <ActivityIndicator size="small" color={unavailable ? C.text3 : '#fff'} /> : null}
      {!busy && icon ? <Ionicons name={icon} size={17} color={unavailable ? C.text3 : '#fff'} /> : null}
      <Text style={[styles.primaryButtonText, { color: unavailable ? C.text3 : '#fff' }]}>{label}</Text>
    </TouchableOpacity>
  );
}

function SecondaryButton({
  testID,
  label,
  icon,
  disabled,
  onPress,
  tertiary,
  style,
}: Readonly<{
  testID: string;
  label: string;
  icon?: IconName;
  disabled?: boolean;
  onPress: () => void;
  tertiary?: boolean;
  style?: object;
}>) {
  const C = useTheme();
  return (
    <TouchableOpacity
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: Boolean(disabled) }}
      activeOpacity={0.82}
      disabled={disabled}
      onPress={onPress}
      style={[
        styles.secondaryButton,
        { backgroundColor: tertiary ? C.s1 : C.glass, borderColor: tertiary ? C.s1 : C.border2, opacity: disabled ? 0.5 : 1 },
        style,
      ]}
    >
      {icon ? <Ionicons name={icon} size={17} color={C.text2} /> : null}
      <Text style={[styles.secondaryButtonText, { color: C.text }]} numberOfLines={1}>{label}</Text>
    </TouchableOpacity>
  );
}

export function TrailBuilderActivityRail({
  choices,
  selectedID,
  onSelect,
  testID = 'trail.builder.activity',
}: Readonly<{
  choices: readonly TrailBuilderChoice[];
  selectedID: string;
  onSelect: (id: string) => void;
  testID?: string;
}>) {
  const C = useTheme();
  return (
    <View>
      <Text style={[styles.sectionLabel, { color: C.text2 }]}>ACTIVITY</Text>
      <ScrollView
        horizontal
        testID={testID}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.activityContent}
      >
        {choices.map(choice => {
          const selected = selectedID === choice.id;
          return (
            <TouchableOpacity
              key={choice.id}
              testID={`${testID}.${choice.id}`}
              accessibilityRole="button"
              accessibilityState={{ selected, disabled: Boolean(choice.disabled) }}
              activeOpacity={0.82}
              disabled={choice.disabled}
              onPress={() => onSelect(choice.id)}
              style={[
                styles.activityChip,
                {
                  backgroundColor: selected ? C.orangeGlow : C.glass,
                  borderColor: selected ? C.orange : C.border,
                  opacity: choice.disabled ? 0.38 : 1,
                },
              ]}
            >
              {selected ? <Ionicons name="checkmark" size={15} color={C.orange} /> : null}
              <Text style={[styles.activityText, { color: selected ? C.orange2 : C.text }]}>{choice.label}</Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
  );
}

function RoutingRow({ label, onPress }: Readonly<{ label: string; onPress: () => void }>) {
  const C = useTheme();
  return (
    <View>
      <Text style={[styles.sectionLabel, { color: C.text2 }]}>ROUTING</Text>
      <TouchableOpacity
        testID="trail.builder.routing.open"
        accessibilityRole="button"
        accessibilityLabel={`Routing: ${label}`}
        activeOpacity={0.82}
        onPress={onPress}
        style={[styles.routingRow, { backgroundColor: C.glass, borderColor: C.border }]}
      >
        <Ionicons name="git-branch-outline" size={18} color={C.orange} />
        <Text style={[styles.routingLabel, { color: C.text }]}>{label}</Text>
        <Ionicons name="chevron-forward" size={18} color={C.text3} />
      </TouchableOpacity>
    </View>
  );
}

function InlineNotice({ text }: Readonly<{ text?: string }>) {
  const C = useTheme();
  if (!text) return null;
  return (
    <View style={[styles.notice, { backgroundColor: C.orangeGlow, borderColor: `${C.orange}55` }]}>
      <Ionicons name="information-circle-outline" size={17} color={C.orange} />
      <Text style={[styles.noticeText, { color: C.text2 }]}>{text}</Text>
    </View>
  );
}

export function TrailBuilderAddPointsSheet({
  subtitle,
  activityChoices,
  activityID,
  routingLabel,
  canBuild,
  canUndo,
  canRedo,
  busy,
  notice,
  onClose,
  onSelectActivity,
  onOpenRouting,
  onUndo,
  onRedo,
  onBuild,
}: Readonly<{
  subtitle: string;
  activityChoices: readonly TrailBuilderChoice[];
  activityID: string;
  routingLabel: string;
  canBuild: boolean;
  canUndo: boolean;
  canRedo: boolean;
  busy?: boolean;
  notice?: string;
  onClose: () => void;
  onSelectActivity: (id: string) => void;
  onOpenRouting: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onBuild: () => void;
}>) {
  return (
    <TrailheadSheet style={styles.sheet} contentStyle={styles.sheetContent}>
      <Header title="Trail Builder" subtitle={subtitle} closeTestID="trail.builder.points.close" onClose={onClose} />
      <TrailBuilderActivityRail choices={activityChoices} selectedID={activityID} onSelect={onSelectActivity} />
      <RoutingRow label={routingLabel} onPress={onOpenRouting} />
      <InlineNotice text={notice} />
      <View style={styles.flexSpace} />
      {canUndo || canRedo ? (
        <View style={styles.twoButtonRow}>
          <SecondaryButton testID="trail.builder.points.undo" label="Undo" icon="arrow-undo-outline" disabled={!canUndo || busy} onPress={onUndo} style={styles.flexButton} />
          <SecondaryButton testID="trail.builder.points.redo" label="Redo" icon="arrow-redo-outline" disabled={!canRedo || busy} onPress={onRedo} style={styles.flexButton} />
        </View>
      ) : null}
      <PrimaryButton testID="trail.builder.points.build" label="Build route" busy={busy} disabled={!canBuild} onPress={onBuild} />
    </TrailheadSheet>
  );
}

export function TrailBuilderRoutingSheet({
  choices,
  selectedID,
  onSelect,
  onApply,
  onClose,
}: Readonly<{
  choices: readonly TrailBuilderChoice[];
  selectedID: string;
  onSelect: (id: string) => void;
  onApply: () => void;
  onClose: () => void;
}>) {
  const C = useTheme();
  return (
    <TrailheadSheet style={styles.sheet} contentStyle={styles.sheetContent}>
      <Header title="Routing" subtitle="Choose how points connect." closeTestID="trail.builder.routing.close" onClose={onClose} />
      <View testID="trail.builder.routing.options" style={styles.routingChoices}>
        {choices.map(choice => {
          const selected = selectedID === choice.id;
          return (
            <TouchableOpacity
              key={choice.id}
              testID={`trail.builder.routing.${choice.id}`}
              accessibilityRole="button"
              accessibilityState={{ selected, disabled: Boolean(choice.disabled) }}
              activeOpacity={0.82}
              disabled={choice.disabled}
              onPress={() => onSelect(choice.id)}
              style={[
                styles.routingChoice,
                {
                  backgroundColor: selected ? C.orangeGlow : C.glass,
                  borderColor: selected ? `${C.orange}55` : C.border,
                  opacity: choice.disabled ? 0.42 : 1,
                },
              ]}
            >
              <Ionicons name={selected ? 'checkmark' : 'ellipse-outline'} size={19} color={C.orange} />
              <Text style={[styles.routingChoiceLabel, { color: C.text }]}>{choice.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
      <View style={styles.flexSpace} />
      <PrimaryButton testID="trail.builder.routing.apply" label="Apply routing" onPress={onApply} />
    </TrailheadSheet>
  );
}

export function TrailBuilderRouteReadySheet({
  testIDPrefix = 'trail.builder.ready',
  name,
  activityLabel,
  metrics,
  note,
  canSave,
  canPreview3d,
  canStart,
  busy,
  onClose,
  onEditPoints,
  onSave,
  onPreview3d,
  onOptions,
  onStart,
}: Readonly<{
  testIDPrefix?: string;
  name: string;
  activityLabel: string;
  metrics: readonly TrailBuilderMetric[];
  note?: string;
  canSave: boolean;
  canPreview3d: boolean;
  canStart: boolean;
  busy?: boolean;
  onClose: () => void;
  onEditPoints: () => void;
  onSave: () => void;
  onPreview3d: () => void;
  onOptions: () => void;
  onStart: () => void;
}>) {
  const C = useTheme();
  return (
    <TrailheadSheet style={styles.routeReadySheet} contentStyle={styles.sheetContent}>
      <Header title="Route ready" subtitle={`${name} · ${activityLabel}`} closeTestID={`${testIDPrefix}.close`} onClose={onClose} />
      <View testID={`${testIDPrefix}.metrics`} style={styles.metrics}>
        {metrics.map(metric => (
          <View key={metric.label} style={[styles.metricTile, { backgroundColor: C.glass, borderColor: C.border }]}>
            <Text style={[styles.metricValue, { color: C.text }]} numberOfLines={2}>{metric.value}</Text>
            <Text style={[styles.metricLabel, { color: C.orange2 }]}>{metric.label}</Text>
          </View>
        ))}
      </View>
      <TouchableOpacity
        testID={`${testIDPrefix}.edit`}
        accessibilityRole="button"
        accessibilityLabel="Edit points"
        activeOpacity={0.82}
        onPress={onEditPoints}
        style={[styles.editRow, { backgroundColor: C.glass, borderColor: C.border }]}
      >
        <Ionicons name="locate-outline" size={18} color={C.orange} />
        <Text style={[styles.editRowText, { color: C.text }]}>Edit points</Text>
        <Ionicons name="chevron-forward" size={18} color={C.text3} />
      </TouchableOpacity>
      <InlineNotice text={note} />
      <View style={styles.secondaryActions}>
        <SecondaryButton testID={`${testIDPrefix}.save`} label="Save" disabled={!canSave || busy} onPress={onSave} style={styles.saveButton} />
        <SecondaryButton testID={`${testIDPrefix}.flyover`} label="3D preview" disabled={!canPreview3d || busy} onPress={onPreview3d} style={styles.previewButton} />
        <SecondaryButton testID={`${testIDPrefix}.route-options`} label="More options" icon="ellipsis-horizontal" disabled={busy} onPress={onOptions} tertiary style={styles.moreButton} />
      </View>
      <View style={styles.flexSpace} />
      <PrimaryButton testID={`${testIDPrefix}.start`} label="Start Follow" icon="navigate" busy={busy} disabled={!canStart} onPress={onStart} />
    </TrailheadSheet>
  );
}

export function TrailBuilderRouteOptionsSheet({
  routeChoices,
  onChooseRoute,
  onReverse,
  onOutAndBack,
  onCloseLoop,
  onClose,
}: Readonly<{
  routeChoices: readonly TrailBuilderRouteChoice[];
  onChooseRoute: (id: string) => void;
  onReverse: () => void;
  onOutAndBack: () => void;
  onCloseLoop: () => void;
  onClose: () => void;
}>) {
  const C = useTheme();
  const shapeActions = [
    { id: 'reverse', label: 'Reverse route', icon: 'swap-vertical-outline' as const, onPress: onReverse },
    { id: 'out-back', label: 'Make out and back', icon: 'return-down-back-outline' as const, onPress: onOutAndBack },
    { id: 'loop', label: 'Close the loop', icon: 'sync-outline' as const, onPress: onCloseLoop },
  ];
  return (
    <TrailheadSheet style={styles.sheet} contentStyle={styles.sheetContent}>
      <Header title="Route options" subtitle="Adjust the route before saving." closeTestID="trail.builder.route-options.close" onClose={onClose} />
      {routeChoices.length > 1 ? (
        <View>
          <Text style={[styles.sectionLabel, { color: C.text2 }]}>ROUTE</Text>
          <ScrollView style={styles.routeChoiceList} showsVerticalScrollIndicator={false}>
            {routeChoices.map(choice => (
              <TouchableOpacity
                key={choice.id}
                testID={`trail.builder.route-choice.${choice.id}`}
                accessibilityRole="button"
                accessibilityState={{ selected: Boolean(choice.selected) }}
                activeOpacity={0.82}
                onPress={() => onChooseRoute(choice.id)}
                style={[
                  styles.routeChoice,
                  {
                    backgroundColor: choice.selected ? C.orangeGlow : C.glass,
                    borderColor: choice.selected ? `${C.orange}66` : C.border,
                  },
                ]}
              >
                <Ionicons name={choice.selected ? 'checkmark-circle' : 'ellipse-outline'} size={19} color={choice.selected ? C.orange : C.text3} />
                <View style={styles.routeChoiceCopy}>
                  <Text style={[styles.routeChoiceTitle, { color: C.text }]}>{choice.title}</Text>
                  {choice.subtitle ? <Text style={[styles.routeChoiceSubtitle, { color: C.text3 }]} numberOfLines={2}>{choice.subtitle}</Text> : null}
                </View>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      ) : null}
      <Text style={[styles.sectionLabel, { color: C.text2 }]}>SHAPE</Text>
      <View style={styles.routingChoices}>
        {shapeActions.map(action => (
          <TouchableOpacity
            key={action.id}
            testID={`trail.builder.route-shape.${action.id}`}
            accessibilityRole="button"
            activeOpacity={0.82}
            onPress={action.onPress}
            style={[styles.routingChoice, { backgroundColor: C.glass, borderColor: C.border }]}
          >
            <Ionicons name={action.icon} size={19} color={C.orange} />
            <Text style={[styles.routingChoiceLabel, { color: C.text }]}>{action.label}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <View style={styles.flexSpace} />
    </TrailheadSheet>
  );
}

export function TrailBuilderDrawSheet({
  distanceLabel,
  pointCount,
  canReview,
  canUndo,
  busy,
  onClose,
  onUndo,
  onClear,
  onReview,
}: Readonly<{
  distanceLabel: string;
  pointCount: number;
  canReview: boolean;
  canUndo: boolean;
  busy?: boolean;
  onClose: () => void;
  onUndo: () => void;
  onClear: () => void;
  onReview: () => void;
}>) {
  const C = useTheme();
  return (
    <TrailheadSheet style={styles.drawSheet} contentStyle={styles.sheetContent}>
      <Header title="Draw a line" subtitle="Trace from start to finish." closeTestID="trail.builder.draw.close" onClose={onClose} />
      <Text testID="trail.builder.draw.summary" style={[styles.drawSummary, { color: C.orange2 }]}>
        {pointCount > 1 ? `${distanceLabel} · ${pointCount} points` : 'Draw on the map'}
      </Text>
      <View style={styles.drawActions}>
        <SecondaryButton testID="trail.builder.draw.undo" label="Undo" disabled={!canUndo || busy} onPress={onUndo} style={styles.drawSmallButton} />
        <SecondaryButton testID="trail.builder.draw.clear" label="Clear" disabled={!canUndo || busy} onPress={onClear} tertiary style={styles.drawSmallButton} />
        <PrimaryButton testID="trail.builder.draw.review" label="Review line" busy={busy} disabled={!canReview} onPress={onReview} style={styles.drawReviewButton} />
      </View>
    </TrailheadSheet>
  );
}

const styles = StyleSheet.create({
  sheet: {
    minHeight: 500,
    maxHeight: 560,
    borderRadius: 20,
  },
  routeReadySheet: {
    minHeight: 510,
    maxHeight: 590,
    borderRadius: 20,
  },
  drawSheet: {
    minHeight: 246,
    borderRadius: 20,
  },
  sheetContent: {
    flex: 1,
    gap: 12,
    padding: 16,
    paddingTop: 12,
    paddingBottom: 16,
  },
  header: {
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  headerCopy: { flex: 1, minWidth: 0 },
  title: { fontSize: 22, lineHeight: 30, fontWeight: '700', letterSpacing: -0.2 },
  subtitle: { fontSize: 15, lineHeight: 22, marginTop: 3 },
  iconButton: {
    width: 48,
    height: 48,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sectionLabel: { fontSize: 12, lineHeight: 16, fontWeight: '600', letterSpacing: 0.4, marginBottom: 8 },
  activityContent: { gap: 8, paddingRight: 16 },
  activityChip: {
    height: 48,
    minWidth: 96,
    paddingHorizontal: 14,
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  activityText: { fontSize: 14, lineHeight: 20, fontWeight: '600' },
  routingRow: {
    height: 56,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  routingLabel: { flex: 1, fontSize: 14, lineHeight: 20, fontWeight: '600' },
  routingChoices: { gap: 8 },
  routingChoice: {
    minHeight: 48,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  routingChoiceLabel: { fontSize: 14, lineHeight: 20, fontWeight: '600' },
  routeChoiceList: { maxHeight: 156 },
  routeChoice: {
    minHeight: 66,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 8,
  },
  routeChoiceCopy: { flex: 1, minWidth: 0 },
  routeChoiceTitle: { fontSize: 14, lineHeight: 20, fontWeight: '700' },
  routeChoiceSubtitle: { fontSize: 12, lineHeight: 17, marginTop: 2 },
  notice: {
    minHeight: 46,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  noticeText: { flex: 1, fontSize: 13, lineHeight: 18 },
  flexSpace: { flex: 1, minHeight: 4 },
  primaryButton: {
    minHeight: 48,
    borderRadius: 12,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  primaryButtonText: { fontSize: 16, lineHeight: 20, fontWeight: '600' },
  secondaryButton: {
    minHeight: 48,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
  },
  secondaryButtonText: { fontSize: 15, lineHeight: 20, fontWeight: '600' },
  twoButtonRow: { flexDirection: 'row', gap: 8 },
  flexButton: { flex: 1 },
  metrics: { flexDirection: 'row', gap: 12 },
  metricTile: {
    flex: 1,
    minWidth: 0,
    minHeight: 80,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  metricValue: {
    fontFamily: trailheadFonts.displayBold,
    fontSize: 26,
    lineHeight: 28,
    fontWeight: '700',
    textAlign: 'center',
  },
  metricLabel: { fontSize: 11, lineHeight: 16, fontWeight: '600', marginTop: 3, textAlign: 'center' },
  editRow: {
    minHeight: 52,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  editRowText: { flex: 1, fontSize: 14, lineHeight: 20, fontWeight: '600' },
  secondaryActions: { flexDirection: 'row', gap: 8 },
  saveButton: { width: 96 },
  previewButton: { flex: 1 },
  moreButton: { width: 56, paddingHorizontal: 0 },
  drawSummary: { fontSize: 12, lineHeight: 16, fontWeight: '700', letterSpacing: 0.2, textTransform: 'uppercase' },
  drawActions: { flexDirection: 'row', gap: 8 },
  drawSmallButton: { width: 86, paddingHorizontal: 8 },
  drawReviewButton: { flex: 1 },
});
