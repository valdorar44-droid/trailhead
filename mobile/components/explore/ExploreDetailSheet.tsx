import React from 'react';
import { Image, Linking, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { ExplorePlaceProfile, ExploreSourcePackItem, ExploreTrailCard } from '@/lib/api';
import { TrailheadButton, TrailheadButtonDock } from '@/components/TrailheadUI';
import { mono, useTheme } from '@/lib/design';
import { ExploreTrailArea } from './ExploreTrailArea';
import {
  getExploreCategoryColor,
  getExploreDisplayCategory,
  getExploreDisplayRegion,
  getExploreDisplayTitle,
  getExploreFreshnessLabel,
  getExploreHighlightCopy,
  getExploreIcon,
  getExploreNearbyModules,
  getExplorePlanNotes,
  getExploreQuickFacts,
  getExploreSourceBadge,
  getExploreTrustBadge,
  getExploreWhyCopy,
  type ExploreNearbyModule,
  type ExploreDisplayContext,
} from './exploreDisplay';

export type ExploreDetailTab = 'summary' | 'story' | 'nearby';

type Props = {
  place: ExplorePlaceProfile;
  tab: ExploreDetailTab;
  onTabChange: (tab: ExploreDetailTab) => void;
  imageUrl: string;
  topInset: number;
  saved?: boolean;
  isPlaying?: boolean;
  context?: ExploreDisplayContext;
  storySentences: string[];
  highlightedSentence: number;
  storyScrollRef: React.RefObject<ScrollView | null>;
  campgroundsSlot?: React.ReactNode;
  relatedSlot?: React.ReactNode;
  weatherSlot?: React.ReactNode;
  trailStatusSlot?: React.ReactNode;
  onClose: () => void;
  onPlayAudio: () => void;
  onShowArea: () => void;
  onRoute: () => void;
  onToggleSave: () => void;
  onNearbyAction?: (module: ExploreNearbyModule) => void;
  onTrailMap?: (trail: ExploreTrailCard) => void;
  onTrailRoute?: (trail: ExploreTrailCard) => void;
  mediaUrl: (url?: string | null) => string;
};

export function ExploreDetailSheet({
  place,
  tab,
  onTabChange,
  imageUrl,
  topInset,
  saved,
  isPlaying,
  context,
  storySentences,
  highlightedSentence,
  storyScrollRef,
  campgroundsSlot,
  relatedSlot,
  weatherSlot,
  trailStatusSlot,
  onClose,
  onPlayAudio,
  onShowArea,
  onRoute,
  onToggleSave,
  onNearbyAction,
  onTrailMap,
  onTrailRoute,
  mediaUrl,
}: Props) {
  const C = useTheme();
  const accent = getExploreCategoryColor(place);
  const facts = getExploreQuickFacts(place, context);
  const modules = getExploreNearbyModules(place, context);
  const planNotes = getExplorePlanNotes(place);
  const sourceUrl = place.source_pack?.booking_url || place.source_pack?.official_url || place.summary.source_url;

  return (
    <View style={[styles.screen, { backgroundColor: C.bg }]}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.hero}>
          {imageUrl ? (
            <Image source={{ uri: imageUrl }} style={styles.heroImage} resizeMode="cover" />
          ) : (
            <View style={[styles.heroFallback, { backgroundColor: C.s3 }]}>
              <Ionicons name={getExploreIcon(place) as any} size={52} color="#fff" />
            </View>
          )}
          <View style={styles.heroShade} />
          <TouchableOpacity style={[styles.roundButton, styles.backButton, { top: Math.max(topInset + 10, 22) }]} onPress={onClose}>
            <Ionicons name="arrow-back" size={25} color="#fff" />
          </TouchableOpacity>
          <View style={[styles.heroRight, { top: Math.max(topInset + 10, 22) }]}>
            <TouchableOpacity style={styles.roundButton} onPress={onToggleSave}>
              <Ionicons name={saved ? 'bookmark' : 'bookmark-outline'} size={24} color="#fff" />
            </TouchableOpacity>
            {!!sourceUrl && (
              <TouchableOpacity style={styles.roundButton} onPress={() => Linking.openURL(sourceUrl)}>
                <Ionicons name="share-outline" size={23} color="#fff" />
              </TouchableOpacity>
            )}
          </View>
          <View style={styles.heroText}>
            <Text style={[styles.kicker, { color: '#fed7aa' }]} numberOfLines={1}>
              {getExploreDisplayCategory(place).toUpperCase()} · {place.summary.state || getExploreDisplayRegion(place)}
            </Text>
            <Text style={styles.title} numberOfLines={3}>{getExploreDisplayTitle(place)}</Text>
            <View style={styles.heroTrust}>
              <Ionicons name="star" size={16} color="#facc15" />
              <Text style={styles.heroTrustText} numberOfLines={1}>{getExploreTrustBadge(place)}</Text>
            </View>
          </View>
        </View>

        <TrailheadButtonDock style={styles.actions}>
          <TrailheadButton
            label={isPlaying ? 'Stop' : 'Play Audio'}
            icon={isPlaying ? 'stop' : 'play'}
            variant="primary"
            onPress={onPlayAudio}
            style={styles.primaryAction}
          />
          <TrailheadButton
            label="Show Area"
            icon="map-outline"
            onPress={onShowArea}
            style={styles.primaryAction}
          />
        </TrailheadButtonDock>

        <View style={[styles.tabs, { borderColor: C.border, backgroundColor: C.s1 }]}>
          {([
            ['summary', 'Summary'],
            ['story', 'Full Story'],
            ['nearby', 'Nearby'],
          ] as Array<[ExploreDetailTab, string]>).map(([key, label]) => {
            const active = tab === key;
            return (
              <TouchableOpacity key={key} style={styles.tab} onPress={() => onTabChange(key)}>
                <Text style={[styles.tabText, { color: active ? C.orange : C.text3 }]}>{label}</Text>
                {active && <View style={[styles.tabUnderline, { backgroundColor: C.orange }]} />}
              </TouchableOpacity>
            );
          })}
        </View>

        {tab === 'story' ? (
          <View style={[styles.panel, { borderColor: C.border, backgroundColor: C.s1 }]}>
            <ScrollView ref={storyScrollRef} style={styles.storyBox} nestedScrollEnabled showsVerticalScrollIndicator>
              {(storySentences.length ? storySentences : ['No full story is available for this Explore stop yet.']).map((sentence, idx) => (
                <Text
                  key={`${idx}-${sentence.slice(0, 24)}`}
                  style={[
                    styles.storySentence,
                    { color: C.text2 },
                    highlightedSentence === idx && { color: C.text, backgroundColor: C.orangeGlow },
                  ]}
                >
                  {sentence}{' '}
                </Text>
              ))}
            </ScrollView>
          </View>
        ) : (
          <>
            {tab === 'summary' && (
              <>
                <View style={[styles.highlight, { borderColor: C.orange + '44', backgroundColor: C.orangeGlow }]}>
                  <View style={[styles.highlightIcon, { borderColor: accent + '66' }]}>
                    <Ionicons name={getExploreIcon(place) as any} size={32} color={C.orange} />
                  </View>
                  <View style={styles.highlightBody}>
                    <Text style={[styles.highlightTitle, { color: C.orange }]}>{getExploreHighlightCopy(place)}</Text>
                  </View>
                  <View style={[styles.factGrid, { borderTopColor: C.orange + '22' }]}>
                    {facts.map(fact => (
                      <View key={`${fact.icon}-${fact.label}`} style={[styles.factCell, { borderLeftColor: C.orange + '18' }]}>
                        <Ionicons name={fact.icon as any} size={26} color={fact.tone} />
                        <View style={{ flex: 1, minWidth: 0 }}>
                          {!!fact.value && <Text style={[styles.factValue, { color: C.text }]} numberOfLines={1}>{fact.value}</Text>}
                          <Text style={[styles.factLabel, { color: C.text2 }]} numberOfLines={2}>{fact.label}</Text>
                        </View>
                      </View>
                    ))}
                  </View>
                </View>

                {trailStatusSlot}
                <ExploreTrailArea place={place} mediaUrl={mediaUrl} onTrailMap={onTrailMap} onTrailRoute={onTrailRoute} />

                {planNotes.length > 0 && (
                  <View style={[styles.planCard, { borderColor: C.border, backgroundColor: C.s1 }]}>
                    <View style={styles.planTop}>
                      <View style={[styles.planIcon, { backgroundColor: accent + '18' }]}>
                        <Ionicons name={getExploreIcon(place) as any} size={22} color={accent} />
                      </View>
                      <Text style={[styles.sectionTitle, { color: C.text, marginBottom: 0 }]}>
                        {getExploreDisplayCategory(place)} plan
                      </Text>
                    </View>
                    <View style={styles.planGrid}>
                      {planNotes.map(note => (
                        <View key={`${note.label}-${note.value}`} style={[styles.planCell, { borderColor: C.border, backgroundColor: C.s2 }]}>
                          <Ionicons name={note.icon as any} size={18} color={note.tone} />
                          <View style={{ flex: 1, minWidth: 0 }}>
                            <Text style={[styles.planLabel, { color: C.text3 }]} numberOfLines={1}>{note.label.toUpperCase()}</Text>
                            <Text style={[styles.planValue, { color: C.text }]} numberOfLines={2}>{note.value}</Text>
                          </View>
                        </View>
                      ))}
                    </View>
                  </View>
                )}

                <View style={[styles.whyCard, { borderColor: C.border, backgroundColor: C.s1 }]}>
                  <View style={[styles.whyIcon, { backgroundColor: C.orangeGlow }]}>
                    <Ionicons name="heart-outline" size={28} color={C.orange} />
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={[styles.sectionTitle, { color: C.text }]}>Why this stop matters</Text>
                    <Text style={[styles.bodyText, { color: C.text2 }]}>{getExploreWhyCopy(place)}</Text>
                  </View>
                </View>

                <Text style={[styles.blockHeading, { color: C.text }]}>Details & Updates</Text>
                <View style={styles.sourceGrid}>
                  <SourceCard
                    icon="shield-checkmark-outline"
                    title={getExploreSourceBadge(place)}
                    body={sourceBodyForPlace(place)}
                    tone="#2563eb"
                  />
                  <SourceCard
                    icon="calendar-outline"
                    title={getExploreFreshnessLabel(place)}
                    body={place.facts.last_updated ? 'Update date is included with this guide.' : 'Check current access, fees, and closures before you go.'}
                    tone="#15803d"
                  />
                </View>
                {campgroundsSlot}
              </>
            )}

            {tab === 'nearby' && (
              <>
                {campgroundsSlot}
                {relatedSlot}
              </>
            )}

            <Text style={[styles.blockHeading, { color: C.text }]}>Near this stop</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.moduleRail}>
              {modules.map(module => (
                <TouchableOpacity
                  key={module.label}
                  style={[styles.moduleCard, { borderColor: C.border, backgroundColor: C.s1 }]}
                  activeOpacity={0.86}
                  onPress={() => onNearbyAction?.(module)}
                >
                  <Ionicons name={module.icon as any} size={24} color={module.tone} />
                  <View style={styles.moduleText}>
                    <Text style={[styles.moduleTitle, { color: C.text }]} numberOfLines={1}>{module.label}</Text>
                    <Text style={[styles.moduleDetail, { color: C.text3 }]} numberOfLines={1}>{module.detail}</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={15} color={C.text3} />
                </TouchableOpacity>
              ))}
            </ScrollView>
            {weatherSlot}
          </>
        )}

        {tab === 'summary' && <SourcePack place={place} mediaUrl={mediaUrl} />}

        {!!sourceUrl && (
          <TouchableOpacity style={[styles.sourceButton, { borderColor: C.border }]} onPress={() => Linking.openURL(sourceUrl)}>
            <Ionicons name="open-outline" size={16} color={C.text2} />
            <Text style={[styles.sourceButtonText, { color: C.text3 }]} numberOfLines={2}>{place.attribution}</Text>
          </TouchableOpacity>
        )}
      </ScrollView>
    </View>
  );
}

function SourceCard({ icon, title, body, tone }: { icon: string; title: string; body: string; tone: string }) {
  const C = useTheme();
  return (
    <View style={[styles.sourceCard, { borderColor: C.border, backgroundColor: C.s1 }]}>
      <View style={[styles.sourceIcon, { backgroundColor: tone + '18' }]}>
        <Ionicons name={icon as any} size={24} color={tone} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[styles.sourceTitle, { color: C.text }]} numberOfLines={2}>{title}</Text>
        <Text style={[styles.sourceBody, { color: C.text2 }]} numberOfLines={3}>{body}</Text>
      </View>
    </View>
  );
}

function SourcePack({ place, mediaUrl }: { place: ExplorePlaceProfile; mediaUrl: (url?: string | null) => string }) {
  const C = useTheme();
  if (!place.source_pack) return null;
  const pack = place.source_pack;
  const rows: Array<[string, ExploreSourcePackItem[] | undefined]> = [
    ['Things to do', pack.things_to_do],
    ['Things to see', pack.things_to_see],
    ['Visitor centers', pack.visitor_centers],
    ['Campgrounds', pack.campgrounds],
  ];
  return (
    <View style={[styles.pack, { borderColor: C.border, backgroundColor: C.s1 }]}>
      <View style={styles.packTop}>
        <Text style={[styles.blockHeading, { color: C.text, marginBottom: 0 }]}>More Details</Text>
        {!!pack.primary && <Text style={[styles.packBadge, { color: C.text3 }]}>{sourcePublisherLabel(pack.primary)}</Text>}
      </View>
      {!!pack.operating_hours && (
        <Text style={[styles.packText, { color: C.text2 }]}>Hours: {pack.operating_hours}</Text>
      )}
      {!!pack.fees?.length && (
        <Text style={[styles.packText, { color: C.text2 }]}>Fees: {pack.fees.slice(0, 2).join(' · ')}</Text>
      )}
      {!!pack.activities?.length && (
        <View style={styles.pillRow}>
          {pack.activities.slice(0, 8).map(activity => (
            <View key={activity} style={[styles.packPill, { borderColor: C.border, backgroundColor: C.s2 }]}>
              <Text style={[styles.packPillText, { color: C.text2 }]}>{activity}</Text>
            </View>
          ))}
        </View>
      )}
      {rows.map(([label, items]) => Array.isArray(items) && items.length ? (
        <View key={label}>
          <Text style={[styles.packLabel, { color: C.text3 }]}>{label.toUpperCase()}</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.miniRail}>
            {items.slice(0, 6).map((item, idx) => (
              <TouchableOpacity
                key={`${item.title}-${idx}`}
                style={[styles.miniCard, { borderColor: C.border, backgroundColor: C.s2 }]}
                disabled={!item.url}
                onPress={() => item.url && Linking.openURL(item.url)}
              >
                {!!item.image_url && <Image source={{ uri: mediaUrl(item.image_url) }} style={styles.miniImage} resizeMode="cover" />}
                <View style={styles.miniBody}>
                  <Text style={[styles.miniTitle, { color: C.text }]} numberOfLines={2}>{item.title}</Text>
                  {!!item.description && <Text style={[styles.miniDesc, { color: C.text3 }]} numberOfLines={3}>{item.description}</Text>}
                </View>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      ) : null)}
    </View>
  );
}

function sourceBodyForPlace(place: ExplorePlaceProfile) {
  const raw = String(place.source_pack?.source_note || '').trim();
  if (/wiki|source pack/i.test(raw)) {
    return 'Curated reference details are included. Confirm current access, fees, closures, and rules before you go.';
  }
  return raw || place.attribution || 'Details available. Verify access before you go.';
}

function sourcePublisherLabel(primary: string) {
  if (/wiki/i.test(primary)) return 'CURATED';
  return primary.toUpperCase();
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  scroll: { paddingBottom: 42 },
  hero: { height: 330, backgroundColor: '#111827' },
  heroImage: { width: '100%', height: '100%' },
  heroFallback: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  heroShade: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(3,7,18,0.34)' },
  roundButton: {
    width: 54,
    height: 54,
    borderRadius: 27,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(15,23,42,0.54)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.16)',
  },
  backButton: { position: 'absolute', left: 20 },
  heroRight: { position: 'absolute', right: 20, flexDirection: 'row', gap: 10 },
  heroText: { position: 'absolute', left: 22, right: 22, bottom: 24 },
  kicker: { fontSize: 13, fontFamily: mono, fontWeight: '900', letterSpacing: 0 },
  title: { color: '#fff', fontSize: 44, lineHeight: 47, fontWeight: '900', letterSpacing: 0, marginTop: 9 },
  heroTrust: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 11 },
  heroTrustText: { color: '#fff', fontSize: 15, fontWeight: '900' },
  actions: { marginHorizontal: 20, marginTop: 10 },
  primaryAction: { flex: 1, minHeight: 56, borderRadius: 15 },
  tabs: { marginHorizontal: 20, marginTop: 14, borderWidth: 1, borderRadius: 14, flexDirection: 'row', overflow: 'hidden' },
  tab: { flex: 1, minHeight: 50, alignItems: 'center', justifyContent: 'center' },
  tabText: { fontSize: 14, fontWeight: '800' },
  tabUnderline: { position: 'absolute', left: 14, right: 14, bottom: 0, height: 2 },
  highlight: { margin: 20, borderWidth: 1, borderRadius: 18, padding: 16 },
  highlightIcon: { width: 72, height: 72, borderRadius: 36, borderWidth: 1, alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  highlightBody: { marginBottom: 14 },
  highlightTitle: { fontSize: 21, lineHeight: 29, fontWeight: '900' },
  factGrid: { borderTopWidth: 1, paddingTop: 14, flexDirection: 'row', flexWrap: 'wrap' },
  factCell: { width: '50%', minHeight: 58, flexDirection: 'row', alignItems: 'center', gap: 9, paddingRight: 8, paddingVertical: 4 },
  factValue: { fontSize: 19, lineHeight: 21, fontWeight: '900' },
  factLabel: { fontSize: 12, lineHeight: 15, fontWeight: '700' },
  whyCard: { marginHorizontal: 20, marginBottom: 14, borderWidth: 1, borderRadius: 16, padding: 14, flexDirection: 'row', gap: 12 },
  whyIcon: { width: 54, height: 54, borderRadius: 27, alignItems: 'center', justifyContent: 'center' },
  sectionTitle: { fontSize: 16, fontWeight: '900', marginBottom: 5 },
  bodyText: { fontSize: 14, lineHeight: 20, fontWeight: '600' },
  planCard: { marginHorizontal: 20, marginBottom: 14, borderWidth: 1, borderRadius: 16, padding: 14, gap: 12 },
  planTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  planIcon: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  planGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  planCell: { width: '48%', minHeight: 70, borderWidth: 1, borderRadius: 13, padding: 10, flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  planLabel: { fontSize: 9, fontFamily: mono, fontWeight: '900', marginBottom: 3 },
  planValue: { fontSize: 12, lineHeight: 16, fontWeight: '800' },
  blockHeading: { marginHorizontal: 20, marginBottom: 9, fontSize: 18, fontWeight: '900', letterSpacing: 0 },
  sourceGrid: { flexDirection: 'row', gap: 10, paddingHorizontal: 20, marginBottom: 18 },
  sourceCard: { flex: 1, minHeight: 118, borderWidth: 1, borderRadius: 15, padding: 12, flexDirection: 'row', gap: 10 },
  sourceIcon: { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center' },
  sourceTitle: { fontSize: 14, lineHeight: 18, fontWeight: '900', marginBottom: 4 },
  sourceBody: { fontSize: 12, lineHeight: 17, fontWeight: '600' },
  moduleRail: { gap: 10, paddingHorizontal: 20, paddingBottom: 18 },
  moduleCard: { minWidth: 158, minHeight: 64, borderWidth: 1, borderRadius: 14, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 9 },
  moduleText: { flex: 1, minWidth: 0 },
  moduleTitle: { fontSize: 13, fontWeight: '900' },
  moduleDetail: { fontSize: 12, fontWeight: '700', marginTop: 2 },
  panel: { margin: 20, borderWidth: 1, borderRadius: 16, padding: 12 },
  storyBox: { maxHeight: 390 },
  storySentence: { fontSize: 16, lineHeight: 25, fontWeight: '600', borderRadius: 8, paddingHorizontal: 4 },
  pack: { marginHorizontal: 20, marginTop: 2, marginBottom: 16, borderWidth: 1, borderRadius: 16, padding: 14, gap: 10 },
  packTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  packBadge: { fontSize: 10, fontFamily: mono, fontWeight: '900' },
  packText: { fontSize: 13, lineHeight: 18, fontWeight: '700' },
  pillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  packPill: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6 },
  packPillText: { fontSize: 11, fontWeight: '800' },
  packLabel: { fontSize: 10, fontFamily: mono, fontWeight: '900', marginTop: 6, marginBottom: 6 },
  miniRail: { gap: 10, paddingRight: 6 },
  miniCard: { width: 210, borderWidth: 1, borderRadius: 13, overflow: 'hidden' },
  miniImage: { width: '100%', height: 90 },
  miniBody: { padding: 10, gap: 4 },
  miniTitle: { fontSize: 13, lineHeight: 17, fontWeight: '900' },
  miniDesc: { fontSize: 11, lineHeight: 15, fontWeight: '600' },
  sourceButton: { marginHorizontal: 20, borderWidth: 1, borderRadius: 14, padding: 13, flexDirection: 'row', alignItems: 'center', gap: 8 },
  sourceButtonText: { flex: 1, fontSize: 12, lineHeight: 17, fontWeight: '700' },
});
