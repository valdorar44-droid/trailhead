import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Clipboard,
  Modal,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { TrailheadButton, TrailheadCard, TrailheadSheet } from '@/components/TrailheadUI';
import PrivateTrailRouteMap from '@/components/trails/PrivateTrailRouteMap';
import { accountInventoryScope } from '@/lib/accountInventoryScope';
import { api, ApiError } from '@/lib/api';
import { useTheme, type ColorPalette } from '@/lib/design';
import type { OfflineTrail } from '@/lib/offlineTrails';
import { accountStorage, storage } from '@/lib/storage';
import { useStore } from '@/lib/store';
import {
  normalizeTrailRouteCrop,
  prepareOfflineTrailForSharing,
  type TrailRouteCropV1,
} from '@/lib/trailRouteSharing';
import {
  StaleTrailRouteSharingRequestError,
  TrailRouteSharingRepositoryV1,
  type TrailRouteLinkResultV1,
} from '@/lib/trailRouteSharingRepository';
import { trailheadFonts } from '@/lib/typography';

type FlowStage = 'privacy' | 'ready' | 'active' | 'confirm_update' | 'confirm_revoke';

type TrailRouteSharingFlowProps = Readonly<{
  visible: boolean;
  trail: OfflineTrail | null;
  ownerScope: string;
  onClose: () => void;
  onTrailUpdated: (trail: OfflineTrail) => Promise<void> | void;
}>;

function friendlySharingError(error: unknown): string {
  if (error instanceof StaleTrailRouteSharingRequestError) return '';
  if (error instanceof ApiError) {
    if (error.status === 401) return 'Sign in again to share this route.';
    if (error.status === 404) return 'Route sharing is unavailable for this account.';
    if (error.status === 409) return 'This route changed. Close this screen and open it again.';
    if (error.status === 429) return 'Too many route changes. Try again later.';
    return 'Trailhead could not update this link. Try again.';
  }
  const message = error instanceof Error ? error.message : '';
  if (
    message.startsWith('This saved route')
    || message.startsWith('This route needs')
    || message.startsWith('Open this route')
    || message.startsWith('Name this route')
  ) return message;
  return 'Trailhead could not update this link. Try again.';
}

function formatDistance(metres: number): string {
  if (!Number.isFinite(metres) || metres <= 0) return '';
  const miles = metres / 1609.344;
  return miles >= 10 ? `${miles.toFixed(0)} mi` : `${miles.toFixed(1)} mi`;
}

export default function TrailRouteSharingFlow({
  visible,
  trail,
  ownerScope,
  onClose,
  onTrailUpdated,
}: TrailRouteSharingFlowProps) {
  const C = useTheme();
  const s = styles(C);
  const repositoryRef = useRef(new TrailRouteSharingRepositoryV1(
    api,
    scope => !accountStorage.isCleaning()
      && scope === accountInventoryScope(accountStorage.epoch(), useStore.getState().user?.id).key,
    () => storage.get('trailhead_token'),
  ));
  const [localTrail, setLocalTrail] = useState<OfflineTrail | null>(trail);
  const [stage, setStage] = useState<FlowStage>('privacy');
  const [crop, setCrop] = useState<TrailRouteCropV1>({ start: 0, finish: 1 });
  const [cropTarget, setCropTarget] = useState<'start' | 'finish'>('start');
  const [linkResult, setLinkResult] = useState<TrailRouteLinkResultV1 | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [mapContextReady, setMapContextReady] = useState(false);

  useEffect(() => {
    if (!visible) return;
    repositoryRef.current.cancel();
    setLocalTrail(trail);
    setCrop({ start: 0, finish: 1 });
    setCropTarget('start');
    setLinkResult(null);
    setStage(trail?.sharing?.shareEnabled ? 'active' : 'privacy');
    setBusy(false);
    setError('');
    setCopied(false);
    setMapContextReady(false);
  }, [ownerScope, trail?.id, visible]);

  useEffect(() => () => repositoryRef.current.cancel(), []);

  const prepared = useMemo(() => {
    if (!localTrail) return { value: null, error: '' };
    try {
      return { value: prepareOfflineTrailForSharing(localTrail, crop), error: '' };
    } catch (cause) {
      return { value: null, error: friendlySharingError(cause) };
    }
  }, [crop.finish, crop.start, localTrail]);
  const previewCoordinates = prepared.value?.payload.geometry.coordinates ?? [];

  const persistTrail = async (updated: OfflineTrail) => {
    setLocalTrail(updated);
    await onTrailUpdated(updated);
  };

  const close = () => {
    repositoryRef.current.cancel();
    setLinkResult(null);
    setError('');
    onClose();
  };

  const goBack = () => {
    if (stage === 'confirm_update' || stage === 'confirm_revoke') {
      setStage(linkResult?.status === 'ready' ? 'ready' : 'active');
      return;
    }
    close();
  };

  const adjustCrop = (direction: -1 | 1) => {
    setCrop(current => {
      const step = 0.05 * direction;
      if (cropTarget === 'start') {
        return normalizeTrailRouteCrop({ start: current.start + step, finish: current.finish });
      }
      return normalizeTrailRouteCrop({ start: current.start, finish: current.finish + step });
    });
    setError('');
  };

  const createLink = async (replace: boolean) => {
    if (!localTrail || !prepared.value || busy) return;
    setBusy(true);
    setError('');
    try {
      const result = replace
        ? await repositoryRef.current.updateLink(ownerScope, localTrail, crop, persistTrail, true)
        : await repositoryRef.current.createLink(ownerScope, localTrail, crop, persistTrail, true);
      setLinkResult(result);
      setStage(result.status === 'ready' ? 'ready' : 'active');
    } catch (cause) {
      const message = friendlySharingError(cause);
      if (message) setError(message);
    } finally {
      setBusy(false);
    }
  };

  const revokeLink = async () => {
    if (!localTrail || busy) return;
    setBusy(true);
    setError('');
    try {
      const updated = await repositoryRef.current.revokeLink(ownerScope, localTrail, persistTrail);
      setLocalTrail(updated);
      setLinkResult(null);
      setStage('privacy');
    } catch (cause) {
      const message = friendlySharingError(cause);
      if (message) setError(message);
    } finally {
      setBusy(false);
    }
  };

  const copyLink = () => {
    if (linkResult?.status !== 'ready') return;
    Clipboard.setString(linkResult.shareUrl);
    setCopied(true);
  };

  const shareLink = async () => {
    if (linkResult?.status !== 'ready' || !localTrail) return;
    await Share.share({
      title: localTrail.trail.name,
      message: `${localTrail.trail.name}\n${linkResult.shareUrl}`,
      url: linkResult.shareUrl,
    }).catch(() => {});
  };

  const renderTop = (title: string, eyebrow: string) => (
    <View style={s.topRow}>
      <TouchableOpacity testID="trail-share.back" style={s.iconButton} onPress={goBack} accessibilityRole="button" accessibilityLabel="Back">
        <Ionicons name="chevron-back" size={22} color={C.text} />
      </TouchableOpacity>
      <View style={s.topCopy}>
        <Text style={s.eyebrow}>{eyebrow}</Text>
        <Text style={s.title}>{title}</Text>
      </View>
      <TouchableOpacity testID="trail-share.close" style={s.iconButton} onPress={close} accessibilityRole="button" accessibilityLabel="Close">
        <Ionicons name="close" size={22} color={C.text} />
      </TouchableOpacity>
    </View>
  );

  const renderRoutePreview = () => (
    <TrailheadCard style={s.previewCard}>
      <PrivateTrailRouteMap
        coordinates={previewCoordinates}
        onReadyChange={setMapContextReady}
      />
      <View style={s.markerLegend}>
        <View style={s.legendItem}><View style={s.legendStart} /><Text style={s.legendText}>Start</Text></View>
        <View style={s.legendItem}><View style={s.legendFinish} /><Text style={s.legendText}>Finish</Text></View>
      </View>
      <View style={s.previewMeta}>
        <Text style={s.previewName} numberOfLines={2}>{localTrail?.trail.name}</Text>
        {prepared.value?.retainedDistanceM ? (
          <Text style={s.previewDistance}>{formatDistance(prepared.value.retainedDistanceM)}</Text>
        ) : null}
      </View>
    </TrailheadCard>
  );

  const renderPrivacy = () => (
    <>
      {renderTop('Review privacy', 'Unlisted route')}
      <Text style={s.lead}>Remove a private start or finish before creating the link.</Text>
      {renderRoutePreview()}
      <View style={s.cropTabs}>
        {(['start', 'finish'] as const).map(target => (
          <TouchableOpacity
            key={target}
            testID={`trail-share.crop.${target}`}
            style={[s.cropTab, cropTarget === target && s.cropTabActive]}
            onPress={() => setCropTarget(target)}
            accessibilityRole="tab"
            accessibilityState={{ selected: cropTarget === target }}
          >
            <Text style={[s.cropTabText, cropTarget === target && s.cropTabTextActive]}>{target === 'start' ? 'Start' : 'Finish'}</Text>
          </TouchableOpacity>
        ))}
        <TouchableOpacity testID="trail-share.crop.reset" style={s.resetButton} onPress={() => setCrop({ start: 0, finish: 1 })} accessibilityRole="button">
          <Text style={s.resetText}>Reset</Text>
        </TouchableOpacity>
      </View>
      <TrailheadCard style={s.cropCard}>
        <View style={s.cropCopy}>
          <Text style={s.sectionTitle}>{cropTarget === 'start' ? 'Private start' : 'Private finish'}</Text>
          {(cropTarget === 'start' ? crop.start : 1 - crop.finish) > 0 ? (
            <Text style={s.sectionMeta}>{Math.round((cropTarget === 'start' ? crop.start : 1 - crop.finish) * 100)}% removed</Text>
          ) : null}
        </View>
        <View style={s.stepControls}>
          <TouchableOpacity testID="trail-share.crop.less" style={s.stepButton} onPress={() => adjustCrop(cropTarget === 'start' ? -1 : 1)} accessibilityLabel="Remove less">
            <Ionicons name="remove" size={19} color={C.text} />
          </TouchableOpacity>
          <TouchableOpacity testID="trail-share.crop.more" style={s.stepButton} onPress={() => adjustCrop(cropTarget === 'start' ? 1 : -1)} accessibilityLabel="Remove more">
            <Ionicons name="add" size={19} color={C.text} />
          </TouchableOpacity>
        </View>
      </TrailheadCard>
      <View style={s.factRows}>
        <View style={s.factRow}>
          <Ionicons name="cut-outline" size={18} color={C.orange} />
          <View style={s.flex}>
            <Text style={s.factTitle}>Remove private sections</Text>
            <Text style={s.factText}>Trim either end before sharing.</Text>
          </View>
        </View>
        <View style={s.factRow}>
          <Ionicons name="shield-checkmark-outline" size={18} color={C.orange} />
          <Text style={[s.factText, s.flex]}>Timestamps and device details are removed.</Text>
        </View>
      </View>
      {prepared.error || error ? <Text style={s.errorText}>{prepared.error || error}</Text> : null}
      {!prepared.error && !mapContextReady ? <Text style={s.mapStatus}>A map preview is required before sharing. Check your connection if it does not load.</Text> : null}
      <TrailheadButton
        testID="trail-share.create"
        label="Create unlisted link"
        icon="link-outline"
        variant="primary"
        onPress={() => void createLink(false)}
        loading={busy}
        disabled={busy || !prepared.value || !mapContextReady}
        style={s.fullButton}
      />
      <TrailheadButton testID="trail-share.keep-private" label="Keep private" variant="ghost" onPress={close} disabled={busy} style={s.fullButton} />
    </>
  );

  const renderLinkReady = () => {
    const route = linkResult?.route ?? null;
    const hasToken = linkResult?.status === 'ready';
    return (
      <>
        {renderTop('Share route', 'Unlisted link')}
        <TrailheadCard style={s.linkCard}>
          <View style={s.linkStatusRow}>
            <Ionicons name="link-outline" size={20} color={C.orange} />
            <View style={s.flex}>
              <Text style={s.linkTitle}>{localTrail?.trail.name}</Text>
              {route?.share_revision ? <Text style={s.sectionMeta}>Shared revision {route.share_revision}</Text> : null}
            </View>
          </View>
          {hasToken ? (
            <View style={s.linkActions}>
              <TrailheadButton testID="trail-share.copy" label={copied ? 'Copied' : 'Copy link'} icon="copy-outline" onPress={copyLink} style={s.actionButton} />
              <TrailheadButton testID="trail-share.share" label="Share" icon="share-outline" onPress={() => void shareLink()} style={s.actionButton} />
            </View>
          ) : (
            <Text style={s.recoveryText}>Trailhead can't show the old link again. Rotate it to create a new one.</Text>
          )}
        </TrailheadCard>
        <View style={s.factRows}>
          <View style={s.factRow}><Ionicons name="people-outline" size={18} color={C.orange} /><Text style={[s.factText, s.flex]}>Only people with this link can open it.</Text></View>
          <View style={s.factRow}><Ionicons name="eye-off-outline" size={18} color={C.orange} /><Text style={[s.factText, s.flex]}>Not listed in Community routes.</Text></View>
          <View style={s.factRow}><Ionicons name="git-branch-outline" size={18} color={C.orange} /><Text style={[s.factText, s.flex]}>Future edits stay private until you update the link.</Text></View>
        </View>
        {error ? <Text style={s.errorText}>{error}</Text> : null}
        <TrailheadButton
          testID="trail-share.update"
          label={hasToken ? 'Update link' : 'Rotate link'}
          icon="refresh-outline"
          onPress={() => setStage('confirm_update')}
          disabled={busy}
          style={s.fullButton}
        />
        <TrailheadButton testID="trail-share.stop" label="Stop sharing" icon="unlink-outline" variant="danger" onPress={() => setStage('confirm_revoke')} disabled={busy} style={s.fullButton} />
      </>
    );
  };

  const renderConfirmation = (kind: 'update' | 'revoke') => {
    const update = kind === 'update';
    const previousRevision = linkResult?.route.share_route_revision ?? localTrail?.sharing?.shareRouteRevision;
    return (
      <View style={s.confirmWrap}>
        <TrailheadSheet handle={false} style={s.confirmSheet} contentStyle={s.confirmContent}>
          <View style={s.confirmIcon}><Ionicons name={update ? 'refresh-outline' : 'unlink-outline'} size={24} color={update ? C.orange : C.red} /></View>
          <Text style={s.confirmTitle}>{update ? 'Update shared revision?' : 'Stop sharing?'}</Text>
          <Text style={s.confirmText}>
            {update
              ? previousRevision
                ? `The current link opens revision ${previousRevision}. People keep seeing it until you update the link.`
                : 'People keep seeing the current route until you update the link.'
              : 'The current link will stop working. Existing saved copies will not change.'}
          </Text>
          {error ? <Text style={s.errorText}>{error}</Text> : null}
          <TrailheadButton
            testID={update ? 'trail-share.confirm-update' : 'trail-share.confirm-revoke'}
            label={update ? 'Update link' : 'Stop sharing'}
            variant={update ? 'primary' : 'danger'}
            onPress={() => update ? void createLink(true) : void revokeLink()}
            loading={busy}
            disabled={busy}
            style={s.fullButton}
          />
          <TrailheadButton label={update ? 'Keep revision' : 'Keep link'} variant="ghost" onPress={() => setStage(linkResult?.status === 'ready' ? 'ready' : 'active')} disabled={busy} style={s.fullButton} />
        </TrailheadSheet>
      </View>
    );
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="fullScreen" onRequestClose={goBack}>
      <SafeAreaView style={s.screen}>
        {stage === 'confirm_update' || stage === 'confirm_revoke' ? (
          renderConfirmation(stage === 'confirm_update' ? 'update' : 'revoke')
        ) : (
          <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
            {stage === 'privacy' ? renderPrivacy() : renderLinkReady()}
          </ScrollView>
        )}
      </SafeAreaView>
    </Modal>
  );
}

const styles = (C: ColorPalette) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.bg },
  content: { paddingHorizontal: 18, paddingTop: 10, paddingBottom: 40, gap: 16 },
  flex: { flex: 1 },
  topRow: { minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: 12 },
  topCopy: { flex: 1, alignItems: 'center' },
  iconButton: { width: 48, height: 48, borderRadius: 12, borderWidth: 1, borderColor: C.border, backgroundColor: C.s1, alignItems: 'center', justifyContent: 'center' },
  eyebrow: { color: C.orange, fontSize: 11, fontWeight: '800', letterSpacing: 1.1 },
  title: { color: C.text, fontFamily: trailheadFonts.displayBold, fontSize: 28, lineHeight: 31, marginTop: 2 },
  lead: { color: C.text2, fontSize: 15, lineHeight: 22, textAlign: 'center', paddingHorizontal: 20 },
  previewCard: { padding: 0, overflow: 'hidden', alignItems: 'center' },
  markerLegend: { alignSelf: 'stretch', minHeight: 42, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 20, borderTopWidth: 1, borderTopColor: C.border },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  legendStart: { width: 10, height: 10, borderRadius: 5, borderWidth: 2, borderColor: C.text, backgroundColor: C.s1 },
  legendFinish: { width: 10, height: 10, backgroundColor: C.orange, transform: [{ rotate: '45deg' }] },
  legendText: { color: C.text2, fontSize: 12, fontWeight: '700' },
  previewMeta: { alignSelf: 'stretch', padding: 15, flexDirection: 'row', alignItems: 'center', gap: 12, borderTopWidth: 1, borderTopColor: C.border },
  previewName: { flex: 1, color: C.text, fontSize: 16, lineHeight: 21, fontWeight: '800' },
  previewDistance: { color: C.text2, fontSize: 13, fontWeight: '700' },
  cropTabs: { minHeight: 48, flexDirection: 'row', alignItems: 'stretch', borderBottomWidth: 1, borderBottomColor: C.border },
  cropTab: { minWidth: 86, justifyContent: 'center', alignItems: 'center', borderBottomWidth: 2, borderBottomColor: 'transparent' },
  cropTabActive: { borderBottomColor: C.orange },
  cropTabText: { color: C.text3, fontSize: 14, fontWeight: '700' },
  cropTabTextActive: { color: C.text },
  resetButton: { marginLeft: 'auto', minWidth: 64, alignItems: 'center', justifyContent: 'center' },
  resetText: { color: C.orange, fontSize: 13, fontWeight: '800' },
  cropCard: { minHeight: 74, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 14 },
  cropCopy: { flex: 1 },
  sectionTitle: { color: C.text, fontSize: 16, fontWeight: '800' },
  sectionMeta: { color: C.text3, fontSize: 12, lineHeight: 17, marginTop: 3 },
  stepControls: { flexDirection: 'row', gap: 8 },
  stepButton: { width: 48, height: 48, borderRadius: 12, borderWidth: 1, borderColor: C.border, backgroundColor: C.s2, alignItems: 'center', justifyContent: 'center' },
  factRows: { gap: 10 },
  factRow: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 4 },
  factTitle: { color: C.text, fontSize: 14, fontWeight: '800' },
  factText: { color: C.text2, fontSize: 14, lineHeight: 20 },
  errorText: { color: C.red, fontSize: 13, lineHeight: 19, textAlign: 'center' },
  mapStatus: { color: C.text3, fontSize: 13, lineHeight: 18, textAlign: 'center' },
  fullButton: { alignSelf: 'stretch', minHeight: 52 },
  linkCard: { padding: 16, gap: 14 },
  linkStatusRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  linkTitle: { color: C.text, fontSize: 17, lineHeight: 22, fontWeight: '800' },
  linkActions: { flexDirection: 'row', gap: 10 },
  actionButton: { flex: 1, minHeight: 48 },
  recoveryText: { color: C.text2, fontSize: 14, lineHeight: 20 },
  confirmWrap: { flex: 1, justifyContent: 'flex-end', backgroundColor: C.bg },
  confirmSheet: { borderBottomLeftRadius: 0, borderBottomRightRadius: 0 },
  confirmContent: { padding: 22, gap: 14 },
  confirmIcon: { width: 48, height: 48, borderRadius: 12, borderWidth: 1, borderColor: C.border, backgroundColor: C.s2, alignItems: 'center', justifyContent: 'center' },
  confirmTitle: { color: C.text, fontFamily: trailheadFonts.displayBold, fontSize: 28, lineHeight: 31 },
  confirmText: { color: C.text2, fontSize: 15, lineHeight: 22 },
});
