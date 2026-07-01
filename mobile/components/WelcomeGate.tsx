import { useEffect, useMemo, useState } from 'react';
import {
  ImageBackground,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { mono, useTheme } from '@/lib/design';
import type { ColorPalette } from '@/lib/design';
import type {
  WelcomeCampingStyle,
  WelcomeSetupPreferences,
  WelcomeTravelNeed,
  WelcomeTravelParty,
  WelcomeVehicleChoice,
} from '@/lib/welcomeGate';

const HERO_IMAGE = require('../assets/explore-hero-welcome-mountains.jpg');

type WelcomeGateMode = 'welcome' | 'setup';

type WelcomeGateProps = {
  visible: boolean;
  initialMode?: WelcomeGateMode;
  onCreateAccount: () => void;
  onSignIn: () => void;
  onContinue: () => void;
  onSetupComplete?: (preferences: WelcomeSetupPreferences) => void;
  onSetupSkip?: (preferences: Partial<WelcomeSetupPreferences>) => void;
};

type Feature = {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  body: string;
};

type SingleChoiceOption<T extends string> = {
  id: T;
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  body: string;
};

type NeedOption = SingleChoiceOption<WelcomeTravelNeed>;

const FEATURES: Feature[] = [
  {
    icon: 'map-outline',
    title: 'Route days',
    body: 'Shape drive time, camps, fuel, weather, and stops in one place.',
  },
  {
    icon: 'car-sport-outline',
    title: 'Vehicle fit',
    body: 'Use your own vehicle, rent when it helps, or keep it flexible.',
  },
  {
    icon: 'compass-outline',
    title: 'Nearby places',
    body: 'Compare camps, trails, places to stay, and stops around the route.',
  },
];

const VEHICLE_OPTIONS: Array<SingleChoiceOption<WelcomeVehicleChoice>> = [
  {
    id: 'own_vehicle',
    icon: 'car-sport-outline',
    title: 'My own vehicle',
    body: 'Tune routes and stops around what you already drive.',
  },
  {
    id: 'rent_sometimes',
    icon: 'calendar-outline',
    title: 'I rent sometimes',
    body: 'Show rentals only when they fit the trip.',
  },
  {
    id: 'need_rental',
    icon: 'key-outline',
    title: 'I need a rental',
    body: 'Start with campervans, RVs, or adventure vehicles near the route.',
  },
  {
    id: 'not_sure',
    icon: 'compass-outline',
    title: 'Not sure yet',
    body: 'Keep planning flexible for now.',
  },
];

const CAMPING_OPTIONS: Array<SingleChoiceOption<WelcomeCampingStyle>> = [
  {
    id: 'campgrounds',
    icon: 'trail-sign-outline',
    title: 'Campgrounds',
    body: 'Established sites, facilities, and easy arrival.',
  },
  {
    id: 'dispersed',
    icon: 'bonfire-outline',
    title: 'Dispersed sites',
    body: 'Quiet public-land spots and fewer services.',
  },
  {
    id: 'rv_parks',
    icon: 'business-outline',
    title: 'RV parks',
    body: 'Hookups, services, and longer stays.',
  },
  {
    id: 'mixed',
    icon: 'layers-outline',
    title: 'A mix',
    body: 'Keep all stay types in the plan.',
  },
];

const PARTY_OPTIONS: Array<SingleChoiceOption<WelcomeTravelParty>> = [
  {
    id: 'solo',
    icon: 'person-outline',
    title: 'Solo',
    body: 'Fast planning with fewer constraints.',
  },
  {
    id: 'two_people',
    icon: 'people-outline',
    title: 'Two people',
    body: 'Balance drive time, stays, and shared stops.',
  },
  {
    id: 'family',
    icon: 'happy-outline',
    title: 'Family',
    body: 'Prioritize room, services, and easier arrivals.',
  },
  {
    id: 'group',
    icon: 'people-circle-outline',
    title: 'Group',
    body: 'Keep plans practical for multiple vehicles or friends.',
  },
];

const NEED_OPTIONS: NeedOption[] = [
  {
    id: 'pets',
    icon: 'paw-outline',
    title: 'Pets',
    body: 'Favor places and rentals that work for animal companions.',
  },
  {
    id: 'kids',
    icon: 'happy-outline',
    title: 'Kids',
    body: 'Lean toward easier stops and practical stays.',
  },
  {
    id: 'towing',
    icon: 'swap-horizontal-outline',
    title: 'Towing',
    body: 'Keep length and access in mind.',
  },
  {
    id: 'downloads',
    icon: 'cloud-download-outline',
    title: 'Downloaded maps',
    body: 'Remember to keep important areas on this phone.',
  },
];

export default function WelcomeGate({
  visible,
  initialMode = 'welcome',
  onCreateAccount,
  onSignIn,
  onContinue,
  onSetupComplete,
  onSetupSkip,
}: WelcomeGateProps) {
  const C = useTheme();
  const s = styles(C);
  const insets = useSafeAreaInsets();
  const [mode, setMode] = useState<WelcomeGateMode>(initialMode);
  const [step, setStep] = useState(0);
  const [vehicle, setVehicle] = useState<WelcomeVehicleChoice | null>(null);
  const [camping, setCamping] = useState<WelcomeCampingStyle | null>(null);
  const [party, setParty] = useState<WelcomeTravelParty | null>(null);
  const [needs, setNeeds] = useState<WelcomeTravelNeed[]>([]);

  useEffect(() => {
    if (!visible) return;
    setMode(initialMode);
    setStep(0);
    setVehicle(null);
    setCamping(null);
    setParty(null);
    setNeeds([]);
  }, [initialMode, visible]);

  const selectedCount = [vehicle, camping, party].filter(Boolean).length + needs.length;
  const setupTitle = useMemo(() => {
    if (step === 0) return 'How are you traveling?';
    if (step === 1) return 'Where do you like to stay?';
    if (step === 2) return 'Who usually comes along?';
    return 'What should Trailhead remember?';
  }, [step]);
  const setupBody = useMemo(() => {
    if (step === 0) return 'This helps routes, rentals, and stops fit the way you actually travel.';
    if (step === 1) return 'Choose the stay style you look for most often. You can change this later.';
    if (step === 2) return 'Keep timing and stop choices practical for the people coming along.';
    return 'Pick any that matter. Leave this blank if you want to decide later.';
  }, [step]);
  const canAdvance = step === 0 ? !!vehicle : step === 1 ? !!camping : step === 2 ? !!party : true;

  function preferences(): WelcomeSetupPreferences {
    return {
      vehicle,
      camping,
      party,
      needs,
    };
  }

  function toggleNeed(id: WelcomeTravelNeed) {
    setNeeds(current => current.includes(id) ? current.filter(item => item !== id) : [...current, id]);
  }

  function nextSetupStep() {
    if (!canAdvance) return;
    if (step < 3) {
      setStep(current => current + 1);
      return;
    }
    onSetupComplete?.(preferences());
  }

  function skipSetup() {
    onSetupSkip?.(preferences());
  }

  function handleRequestClose() {
    if (mode === 'setup') {
      skipSetup();
      return;
    }
    onContinue();
  }

  function renderOption<T extends string>(
    option: SingleChoiceOption<T>,
    selected: boolean,
    onPress: () => void,
  ) {
    return (
      <TouchableOpacity
        key={option.id}
        activeOpacity={0.84}
        onPress={onPress}
        style={[s.optionRow, selected && s.optionRowSelected]}
      >
        <View style={[s.optionIcon, selected && s.optionIconSelected]}>
          <Ionicons name={option.icon} size={20} color={selected ? '#ffffff' : 'rgba(255,255,255,0.9)'} />
        </View>
        <View style={s.optionCopy}>
          <Text style={[s.optionTitle, selected && s.optionTitleSelected]}>{option.title}</Text>
          <Text style={s.optionBody}>{option.body}</Text>
        </View>
        <Ionicons
          name={selected ? 'checkmark-circle' : 'ellipse-outline'}
          size={22}
          color={selected ? C.orange : 'rgba(255,255,255,0.84)'}
        />
      </TouchableOpacity>
    );
  }

  function renderSetupOptions() {
    if (step === 0) {
      return VEHICLE_OPTIONS.map(option => renderOption(option, vehicle === option.id, () => setVehicle(option.id)));
    }
    if (step === 1) {
      return CAMPING_OPTIONS.map(option => renderOption(option, camping === option.id, () => setCamping(option.id)));
    }
    if (step === 2) {
      return PARTY_OPTIONS.map(option => renderOption(option, party === option.id, () => setParty(option.id)));
    }
    return NEED_OPTIONS.map(option => renderOption(option, needs.includes(option.id), () => toggleNeed(option.id)));
  }

  return (
    <Modal visible={visible} animationType="fade" presentationStyle="fullScreen" onRequestClose={handleRequestClose}>
      <View style={s.root}>
        <ImageBackground source={HERO_IMAGE} resizeMode="cover" style={s.heroImage}>
          <LinearGradient
            pointerEvents="none"
            colors={['rgba(3,5,4,0.58)', 'rgba(3,5,4,0.42)', 'rgba(3,5,4,0.72)']}
            locations={[0, 0.42, 1]}
            style={s.imageShade}
          />
          <View style={[s.safe, { paddingTop: Math.max(insets.top, 18), paddingBottom: Math.max(insets.bottom, 14) }]}>
            {mode === 'welcome' ? (
              <>
                <View style={s.heroTop}>
                  <View style={s.brandRow}>
                    <View style={s.brandMark}>
                      <Ionicons name="trail-sign-outline" size={22} color="#ffffff" />
                    </View>
                    <Text style={s.brand}>TRAILHEAD</Text>
                  </View>
                </View>

                <View style={s.heroCopy}>
                  <Text style={s.title}>Find the next stop.</Text>
                  <Text style={s.body}>
                    Choose your travel style once. Trailhead keeps trips practical from the first search.
                  </Text>
                </View>

                <View style={s.featureStack}>
                  {FEATURES.map(feature => (
                    <View key={feature.title} style={s.featureRow}>
                      <View style={s.featureIcon}>
                        <Ionicons name={feature.icon} size={17} color="#ffffff" />
                      </View>
                      <View style={s.featureCopy}>
                        <Text style={s.featureTitle}>{feature.title}</Text>
                        <Text style={s.featureBody}>{feature.body}</Text>
                      </View>
                    </View>
                  ))}
                </View>

                <View style={s.actionDock}>
                  <TouchableOpacity style={s.primaryButton} onPress={() => setMode('setup')} activeOpacity={0.86}>
                    <Text style={s.primaryText}>Set up trip style</Text>
                    <Ionicons name="arrow-forward" size={18} color="#ffffff" />
                  </TouchableOpacity>
                  <View style={s.accountRow}>
                    <TouchableOpacity style={s.accountButton} onPress={onCreateAccount} activeOpacity={0.84}>
                      <Ionicons name="person-add-outline" size={17} color="#ffffff" />
                      <Text style={s.accountText}>Create account</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={s.accountButton} onPress={onSignIn} activeOpacity={0.84}>
                      <Ionicons name="log-in-outline" size={17} color="#ffffff" />
                      <Text style={s.accountText}>Log in</Text>
                    </TouchableOpacity>
                  </View>
                  <TouchableOpacity style={s.linkButton} onPress={onContinue} activeOpacity={0.72}>
                    <Text style={s.linkText}>Continue for now</Text>
                  </TouchableOpacity>
                </View>
              </>
            ) : (
              <>
                <View style={s.setupHeader}>
                  <TouchableOpacity
                    style={s.iconButton}
                    onPress={() => {
                      if (step === 0 && initialMode === 'welcome') setMode('welcome');
                      else if (step === 0) skipSetup();
                      else setStep(current => current - 1);
                    }}
                    activeOpacity={0.76}
                    accessibilityLabel="Back"
                  >
                    <Ionicons name="chevron-back" size={22} color="#ffffff" />
                  </TouchableOpacity>
                  <View style={s.progressDots}>
                    {[0, 1, 2, 3].map(index => (
                      <View key={index} style={[s.progressDot, index <= step && s.progressDotActive]} />
                    ))}
                  </View>
                  <TouchableOpacity style={s.skipHeaderButton} onPress={skipSetup} activeOpacity={0.76}>
                    <Text style={s.skipHeaderText}>Later</Text>
                  </TouchableOpacity>
                </View>

                <View style={s.setupCopy}>
                  <Text style={s.setupKicker}>Trip setup</Text>
                  <Text style={s.setupTitle}>{setupTitle}</Text>
                  <Text style={s.setupBody}>{setupBody}</Text>
                </View>

                <ScrollView
                  style={s.optionScroll}
                  contentContainerStyle={s.optionContent}
                  showsVerticalScrollIndicator={false}
                >
                  {renderSetupOptions()}
                </ScrollView>

                <View style={s.setupDock}>
                  <View style={s.selectionSummary}>
                    <Ionicons name="checkmark-done-outline" size={16} color={selectedCount > 0 ? C.orange : 'rgba(255,255,255,0.5)'} />
                    <Text style={s.selectionText}>
                      {selectedCount > 0 ? `${selectedCount} preference${selectedCount === 1 ? '' : 's'} selected` : 'Pick what matters now'}
                    </Text>
                  </View>
                  <TouchableOpacity
                    style={[s.primaryButton, !canAdvance && s.primaryButtonDisabled]}
                    onPress={nextSetupStep}
                    activeOpacity={canAdvance ? 0.86 : 1}
                  >
                    <Text style={s.primaryText}>{step === 3 ? 'Done' : 'Next'}</Text>
                    <Ionicons name={step === 3 ? 'checkmark' : 'arrow-forward'} size={18} color="#ffffff" />
                  </TouchableOpacity>
                  <TouchableOpacity style={s.linkButton} onPress={skipSetup} activeOpacity={0.72}>
                    <Text style={s.linkText}>Skip for now</Text>
                  </TouchableOpacity>
                </View>
              </>
            )}
          </View>
        </ImageBackground>
      </View>
    </Modal>
  );
}

const styles = (C: ColorPalette) => StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#050705',
  },
  heroImage: {
    flex: 1,
    backgroundColor: '#050705',
  },
  imageShade: {
    ...StyleSheet.absoluteFillObject,
  },
  safe: {
    flex: 1,
    paddingHorizontal: 20,
  },
  heroTop: {
    minHeight: 62,
    justifyContent: 'center',
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  brandMark: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.34)',
    backgroundColor: 'rgba(255,255,255,0.16)',
  },
  brand: {
    color: '#ffffff',
    fontFamily: mono,
    fontSize: 16,
    fontWeight: '900',
    letterSpacing: 0,
  },
  heroCopy: {
    flex: 1,
    justifyContent: 'center',
    gap: 12,
    paddingBottom: 12,
  },
  title: {
    color: '#ffffff',
    fontSize: 36,
    lineHeight: 40,
    fontWeight: '900',
    letterSpacing: 0,
    maxWidth: 340,
    textShadowColor: 'rgba(0,0,0,0.36)',
    textShadowRadius: 14,
    textShadowOffset: { width: 0, height: 2 },
  },
  body: {
    color: 'rgba(255,255,255,0.82)',
    fontSize: 15,
    lineHeight: 22,
    letterSpacing: 0,
    maxWidth: 360,
  },
  featureStack: {
    gap: 10,
    marginBottom: 14,
  },
  featureRow: {
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.16)',
    backgroundColor: 'rgba(0,0,0,0.34)',
  },
  featureIcon: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
    backgroundColor: 'rgba(255,255,255,0.14)',
  },
  featureCopy: {
    flex: 1,
    gap: 3,
  },
  featureTitle: {
    color: '#ffffff',
    fontSize: 13.5,
    fontWeight: '800',
    letterSpacing: 0,
  },
  featureBody: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 12,
    lineHeight: 17,
    letterSpacing: 0,
  },
  actionDock: {
    gap: 10,
    paddingBottom: 4,
  },
  primaryButton: {
    minHeight: 54,
    borderRadius: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: C.orange,
    shadowColor: C.orange,
    shadowOpacity: Platform.OS === 'ios' ? 0.28 : 0,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
  },
  primaryButtonDisabled: {
    backgroundColor: 'rgba(217,119,69,0.44)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
    shadowOpacity: 0,
  },
  primaryText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '900',
    letterSpacing: 0,
  },
  accountRow: {
    flexDirection: 'row',
    gap: 10,
  },
  accountButton: {
    minHeight: 48,
    flex: 1,
    borderRadius: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
    backgroundColor: 'rgba(0,0,0,0.34)',
  },
  accountText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 0,
  },
  linkButton: {
    minHeight: 38,
    alignItems: 'center',
    justifyContent: 'center',
  },
  linkText: {
    color: 'rgba(255,255,255,0.76)',
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 0,
  },
  setupHeader: {
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  iconButton: {
    width: 42,
    height: 42,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
    backgroundColor: 'rgba(0,0,0,0.28)',
  },
  skipHeaderButton: {
    minWidth: 54,
    minHeight: 38,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  skipHeaderText: {
    color: 'rgba(255,255,255,0.94)',
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 0,
    textShadowColor: 'rgba(0,0,0,0.42)',
    textShadowRadius: 8,
    textShadowOffset: { width: 0, height: 1 },
  },
  progressDots: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  progressDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: 'rgba(255,255,255,0.28)',
  },
  progressDotActive: {
    width: 24,
    backgroundColor: C.orange,
  },
  setupCopy: {
    gap: 9,
    paddingTop: 18,
    paddingBottom: 18,
  },
  setupKicker: {
    color: 'rgba(255,255,255,0.86)',
    fontFamily: mono,
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 0,
    textTransform: 'uppercase',
    textShadowColor: 'rgba(0,0,0,0.46)',
    textShadowRadius: 8,
    textShadowOffset: { width: 0, height: 1 },
  },
  setupTitle: {
    color: '#ffffff',
    fontSize: 31,
    lineHeight: 36,
    fontWeight: '900',
    letterSpacing: 0,
    maxWidth: 360,
    textShadowColor: 'rgba(0,0,0,0.46)',
    textShadowRadius: 14,
    textShadowOffset: { width: 0, height: 2 },
  },
  setupBody: {
    color: 'rgba(255,255,255,0.9)',
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '500',
    letterSpacing: 0,
    maxWidth: 360,
    textShadowColor: 'rgba(0,0,0,0.42)',
    textShadowRadius: 10,
    textShadowOffset: { width: 0, height: 1 },
  },
  optionScroll: {
    flex: 1,
  },
  optionContent: {
    gap: 10,
    paddingBottom: 14,
  },
  optionRow: {
    minHeight: 82,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.24)',
    backgroundColor: 'rgba(0,0,0,0.56)',
  },
  optionRowSelected: {
    borderColor: 'rgba(255,255,255,0.42)',
    backgroundColor: 'rgba(217,119,69,0.38)',
  },
  optionIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.24)',
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  optionIconSelected: {
    borderColor: 'rgba(255,255,255,0.22)',
    backgroundColor: C.orange,
  },
  optionCopy: {
    flex: 1,
    gap: 4,
  },
  optionTitle: {
    color: '#ffffff',
    fontSize: 15.5,
    lineHeight: 20,
    fontWeight: '900',
    letterSpacing: 0,
    textShadowColor: 'rgba(0,0,0,0.32)',
    textShadowRadius: 6,
    textShadowOffset: { width: 0, height: 1 },
  },
  optionTitleSelected: {
    color: '#ffffff',
  },
  optionBody: {
    color: 'rgba(255,255,255,0.84)',
    fontSize: 13,
    lineHeight: 19,
    fontWeight: '500',
    letterSpacing: 0,
  },
  setupDock: {
    gap: 10,
    paddingTop: 8,
  },
  selectionSummary: {
    minHeight: 28,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  selectionText: {
    color: 'rgba(255,255,255,0.82)',
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0,
    textShadowColor: 'rgba(0,0,0,0.42)',
    textShadowRadius: 8,
    textShadowOffset: { width: 0, height: 1 },
  },
});
