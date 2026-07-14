import { useEffect, useMemo, useState } from 'react';
import {
  Image,
  ImageBackground,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { mono } from '@/lib/design';
import type {
  WelcomeCampType,
  WelcomeSetupPreferences,
  WelcomeTravelNeed,
  WelcomeTravelParty,
  WelcomeVehicleChoice,
} from '@/lib/welcomeGate';
import { RigProfile, useStore } from '@/lib/store';

const HERO_IMAGE = require('../assets/onboarding-hero-overland.png');
const TRAILHEAD_MARK = require('../assets/trailhead-mark.png');
const SETUP_BLUE = '#1f6f9f';

type WelcomeGateMode = 'welcome' | 'setup';
type SetupStep = 'camp' | 'party' | 'vehicle' | 'rig' | 'needs';

type WelcomeGateProps = {
  visible: boolean;
  initialMode?: WelcomeGateMode;
  onCreateAccount: () => void;
  onSignIn: () => void;
  onContinue: () => void;
  onSetupComplete?: (preferences: WelcomeSetupPreferences) => void;
  onSetupSkip?: (preferences: Partial<WelcomeSetupPreferences>) => void;
};

type Choice<T extends string> = {
  id: T;
  title: string;
  icon: keyof typeof Ionicons.glyphMap;
};

const CAMP_OPTIONS: Array<Choice<WelcomeCampType>> = [
  { id: 'dispersed', title: 'Dispersed', icon: 'bonfire-outline' },
  { id: 'developed', title: 'Developed', icon: 'trail-sign-outline' },
  { id: 'private', title: 'Private', icon: 'home-outline' },
  { id: 'rv_parks', title: 'RV parks', icon: 'business-outline' },
  { id: 'any', title: 'Any', icon: 'layers-outline' },
];

const PARTY_OPTIONS: Array<Choice<WelcomeTravelParty>> = [
  { id: 'solo', title: 'Solo', icon: 'person-outline' },
  { id: 'two_people', title: 'Couple', icon: 'people-outline' },
  { id: 'family', title: 'Family', icon: 'happy-outline' },
  { id: 'group', title: 'Group', icon: 'people-circle-outline' },
];

const VEHICLE_OPTIONS: Array<Choice<WelcomeVehicleChoice>> = [
  { id: 'own_vehicle', title: 'I own', icon: 'car-sport-outline' },
  { id: 'need_rental', title: 'I rent', icon: 'key-outline' },
  { id: 'rent_sometimes', title: 'Sometimes rent', icon: 'calendar-outline' },
  { id: 'not_sure', title: 'Not sure', icon: 'compass-outline' },
];

const NEED_OPTIONS: Array<Choice<WelcomeTravelNeed>> = [
  { id: 'pets', title: 'Pets', icon: 'paw-outline' },
  { id: 'kids', title: 'Kids', icon: 'happy-outline' },
  { id: 'towing', title: 'Towing', icon: 'swap-horizontal-outline' },
  { id: 'downloads', title: 'Offline', icon: 'cloud-download-outline' },
];

const VEHICLE_TYPES = ['Truck', 'Jeep', 'SUV', 'Van/Camper', 'Moto', 'Other'];
const DRIVE_TYPES = ['2WD', 'AWD', '4x4 PT', '4x4 FT'];
const DIFF_LOCK = ['None', 'Rear Locker', 'Front + Rear'];
const TIRE_TYPES = ['All-terrain', 'Mud-terrain', 'Highway', 'Winter'];
const TRAIL_DIFFICULTY = ['Easy', 'Moderate', 'Hard', 'Extreme'];

const DEFAULT_RIG: RigProfile = {
  nickname: '',
  vehicle_type: '',
  year: '',
  make: '',
  model: '',
  trim: '',
  drive: '4x4 PT',
  has_low_range: false,
  lift_in: '',
  suspension: 'Stock',
  tire_size: '',
  tire_diameter_in: '',
  tire_type: '',
  full_size_spare: false,
  spare_count: '',
  ground_clearance_in: '',
  length_ft: '',
  width_in: '',
  height_ft: '',
  wheelbase_in: '',
  approach_angle_deg: '',
  departure_angle_deg: '',
  breakover_angle_deg: '',
  fuel_range_miles: '',
  fuel_mpg: '',
  tank_capacity_gal: '',
  water_capacity_gal: '',
  payload_lbs: '',
  has_winch: false,
  winch_lbs: '',
  locking_diffs: 'None',
  has_skids: false,
  has_rack: false,
  has_recovery_points: false,
  has_traction_boards: false,
  has_air_compressor: false,
  has_rock_sliders: false,
  max_trail_difficulty: '',
  max_water_depth_in: '',
  avoid_narrow_trails: false,
  avoid_body_damage: false,
  is_towing: false,
  trailer_length_ft: '',
  tow_capacity_lbs: '',
};

export default function WelcomeGate({
  visible,
  initialMode = 'welcome',
  onContinue,
  onSetupComplete,
  onSetupSkip,
}: WelcomeGateProps) {
  const s = styles();
  const insets = useSafeAreaInsets();
  const setRigProfile = useStore(state => state.setRigProfile);
  const [mode, setMode] = useState<WelcomeGateMode>(initialMode);
  const [stepIndex, setStepIndex] = useState(0);
  const [vehicle, setVehicle] = useState<WelcomeVehicleChoice | null>(null);
  const [campTypes, setCampTypes] = useState<WelcomeCampType[]>([]);
  const [party, setParty] = useState<WelcomeTravelParty | null>(null);
  const [needs, setNeeds] = useState<WelcomeTravelNeed[]>([]);
  const [rigDraft, setRigDraft] = useState<RigProfile>(DEFAULT_RIG);

  useEffect(() => {
    if (!visible) return;
    setMode(initialMode);
    setStepIndex(0);
    setVehicle(null);
    setCampTypes([]);
    setParty(null);
    setNeeds([]);
    setRigDraft(DEFAULT_RIG);
  }, [initialMode, visible]);

  const steps = useMemo<SetupStep[]>(() => {
    if (vehicle === 'own_vehicle') return ['camp', 'party', 'vehicle', 'rig', 'needs'];
    return ['camp', 'party', 'vehicle', 'needs'];
  }, [vehicle]);
  const step = steps[Math.min(stepIndex, steps.length - 1)];
  const progress = Math.min(stepIndex + 1, steps.length);
  const canAdvance = step === 'camp' ? campTypes.length > 0 : step === 'party' ? !!party : step === 'vehicle' ? !!vehicle : true;
  const selectedCount = campTypes.length + [vehicle, party].filter(Boolean).length + needs.length + (hasRigData(rigDraft) ? 1 : 0);

  function legacyCamping(): WelcomeSetupPreferences['camping'] {
    if (campTypes.includes('any')) return 'mixed';
    if (campTypes.includes('rv_parks')) return 'rv_parks';
    if (campTypes.includes('developed')) return 'campgrounds';
    if (campTypes.includes('dispersed')) return 'dispersed';
    return null;
  }

  function preferences(): WelcomeSetupPreferences {
    return {
      vehicle,
      camping: legacyCamping(),
      campingStyles: campTypes,
      party,
      needs,
    };
  }

  function hasRigData(rig: RigProfile) {
    return Boolean(
      rig.vehicle_type ||
      rig.make ||
      rig.model ||
      rig.ground_clearance_in ||
      rig.tire_size ||
      rig.tire_diameter_in ||
      rig.fuel_range_miles ||
      rig.length_ft ||
      rig.has_winch ||
      rig.has_skids ||
      rig.is_towing,
    );
  }

  function saveRigIfUseful() {
    if (vehicle !== 'own_vehicle' || !hasRigData(rigDraft)) return;
    setRigProfile({ ...DEFAULT_RIG, ...rigDraft });
  }

  function toggleCamp(id: WelcomeCampType) {
    setCampTypes(current => {
      if (id === 'any') return current.includes('any') ? [] : ['any'];
      const withoutAny = current.filter(item => item !== 'any');
      return withoutAny.includes(id) ? withoutAny.filter(item => item !== id) : [...withoutAny, id];
    });
  }

  function toggleNeed(id: WelcomeTravelNeed) {
    setNeeds(current => current.includes(id) ? current.filter(item => item !== id) : [...current, id]);
  }

  function completeSetup() {
    saveRigIfUseful();
    onSetupComplete?.(preferences());
  }

  function nextSetupStep() {
    if (!canAdvance) return;
    if (stepIndex < steps.length - 1) {
      setStepIndex(current => current + 1);
      return;
    }
    completeSetup();
  }

  function skipSetup() {
    saveRigIfUseful();
    onSetupSkip?.(preferences());
  }

  function goBack() {
    if (stepIndex === 0 && initialMode === 'welcome') setMode('welcome');
    else if (stepIndex === 0) skipSetup();
    else setStepIndex(current => current - 1);
  }

  function handleRequestClose() {
    if (mode === 'setup') {
      skipSetup();
      return;
    }
    onContinue();
  }

  function renderChoice<T extends string>(option: Choice<T>, selected: boolean, onPress: () => void, multi = false) {
    return (
      <TouchableOpacity
        key={option.id}
        activeOpacity={0.84}
        onPress={onPress}
        style={[s.choiceRow, selected && s.choiceRowSelected]}
      >
        <Ionicons name={option.icon} size={20} color={selected ? '#ffffff' : '#3b332a'} />
        <Text style={[s.choiceText, selected && s.choiceTextSelected]}>{option.title}</Text>
        <Ionicons
          name={selected ? 'checkmark-circle' : multi ? 'ellipse-outline' : 'radio-button-off-outline'}
          size={22}
          color={selected ? '#ffffff' : '#a99a89'}
        />
      </TouchableOpacity>
    );
  }

  function renderPill(value: string, selected: boolean, onPress: () => void) {
    return (
      <TouchableOpacity key={value} style={[s.rigPill, selected && s.rigPillSelected]} onPress={onPress} activeOpacity={0.84}>
        <Text style={[s.rigPillText, selected && s.rigPillTextSelected]}>{value}</Text>
      </TouchableOpacity>
    );
  }

  function renderInput(
    label: string,
    value: string | undefined,
    onChangeText: (value: string) => void,
    placeholder: string,
    keyboardType: 'default' | 'numeric' | 'decimal-pad' = 'default',
  ) {
    return (
      <View style={s.inputGroup}>
        <Text style={s.inputLabel}>{label}</Text>
        <TextInput
          style={s.input}
          value={value ?? ''}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor="#a99a89"
          keyboardType={keyboardType}
        />
      </View>
    );
  }

  function renderToggle(label: string, value: boolean | undefined, onPress: () => void) {
    return (
      <TouchableOpacity style={s.toggleRow} onPress={onPress} activeOpacity={0.84}>
        <Text style={s.toggleText}>{label}</Text>
        <View style={[s.toggle, value && s.toggleOn]}>
          <View style={[s.toggleThumb, value && s.toggleThumbOn]} />
        </View>
      </TouchableOpacity>
    );
  }

  function renderSetupOptions() {
    if (step === 'camp') {
      return CAMP_OPTIONS.map(option => renderChoice(option, campTypes.includes(option.id), () => toggleCamp(option.id), true));
    }
    if (step === 'party') {
      return PARTY_OPTIONS.map(option => renderChoice(option, party === option.id, () => setParty(option.id)));
    }
    if (step === 'vehicle') {
      return VEHICLE_OPTIONS.map(option => renderChoice(option, vehicle === option.id, () => setVehicle(option.id)));
    }
    if (step === 'needs') {
      return NEED_OPTIONS.map(option => renderChoice(option, needs.includes(option.id), () => toggleNeed(option.id), true));
    }
    return renderRigSetup();
  }

  function renderRigSetup() {
    return (
      <View style={s.rigForm}>
        <View style={s.rigSection}>
          <Text style={s.rigSectionTitle}>Basics</Text>
          <View style={s.pillGrid}>
            {VEHICLE_TYPES.map(type => renderPill(type, rigDraft.vehicle_type === type, () => setRigDraft(d => ({ ...d, vehicle_type: type }))))}
          </View>
          {renderInput('Rig name', rigDraft.nickname, value => setRigDraft(d => ({ ...d, nickname: value })), 'Weekend rig')}
          <View style={s.inputRow}>
            {renderInput('Make', rigDraft.make, value => setRigDraft(d => ({ ...d, make: value })), 'Toyota')}
            {renderInput('Model', rigDraft.model, value => setRigDraft(d => ({ ...d, model: value })), 'Tacoma')}
          </View>
          <View style={s.inputRow}>
            {renderInput('Year', rigDraft.year, value => setRigDraft(d => ({ ...d, year: value })), '2022', 'numeric')}
            {renderInput('Trim', rigDraft.trim, value => setRigDraft(d => ({ ...d, trim: value })), 'TRD Off-Road')}
          </View>
        </View>

        <View style={s.rigSection}>
          <Text style={s.rigSectionTitle}>Capability</Text>
          <View style={s.pillGrid}>
            {DRIVE_TYPES.map(drive => renderPill(drive, rigDraft.drive === drive, () => setRigDraft(d => ({ ...d, drive }))))}
          </View>
          <View style={s.pillGrid}>
            {DIFF_LOCK.map(diff => renderPill(diff, rigDraft.locking_diffs === diff, () => setRigDraft(d => ({ ...d, locking_diffs: diff }))))}
          </View>
          <View style={s.inputRow}>
            {renderInput('Clearance in', rigDraft.ground_clearance_in, value => setRigDraft(d => ({ ...d, ground_clearance_in: value })), '9.4', 'decimal-pad')}
            {renderInput('Lift in', rigDraft.lift_in, value => setRigDraft(d => ({ ...d, lift_in: value })), '2.5', 'decimal-pad')}
          </View>
          <View style={s.inputRow}>
            {renderInput('Tire diameter', rigDraft.tire_diameter_in, value => setRigDraft(d => ({ ...d, tire_diameter_in: value })), '33', 'decimal-pad')}
            {renderInput('Tire size', rigDraft.tire_size, value => setRigDraft(d => ({ ...d, tire_size: value })), '285/75R17')}
          </View>
          <View style={s.pillGrid}>
            {TIRE_TYPES.map(type => renderPill(type, rigDraft.tire_type === type, () => setRigDraft(d => ({ ...d, tire_type: type }))))}
          </View>
          {renderToggle('Low range', rigDraft.has_low_range, () => setRigDraft(d => ({ ...d, has_low_range: !d.has_low_range })))}
          {renderToggle('Full-size spare', rigDraft.full_size_spare, () => setRigDraft(d => ({ ...d, full_size_spare: !d.full_size_spare })))}
        </View>

        <View style={s.rigSection}>
          <Text style={s.rigSectionTitle}>Range and fit</Text>
          <View style={s.inputRow}>
            {renderInput('Range miles', rigDraft.fuel_range_miles, value => setRigDraft(d => ({ ...d, fuel_range_miles: value })), '400', 'numeric')}
            {renderInput('Real MPG', rigDraft.fuel_mpg, value => setRigDraft(d => ({ ...d, fuel_mpg: value })), '14.5', 'decimal-pad')}
          </View>
          <View style={s.inputRow}>
            {renderInput('Tank gal', rigDraft.tank_capacity_gal, value => setRigDraft(d => ({ ...d, tank_capacity_gal: value })), '21', 'decimal-pad')}
            {renderInput('Water gal', rigDraft.water_capacity_gal, value => setRigDraft(d => ({ ...d, water_capacity_gal: value })), '10', 'decimal-pad')}
          </View>
          <View style={s.inputRow}>
            {renderInput('Length ft', rigDraft.length_ft, value => setRigDraft(d => ({ ...d, length_ft: value })), '18.5', 'decimal-pad')}
            {renderInput('Height ft', rigDraft.height_ft, value => setRigDraft(d => ({ ...d, height_ft: value })), '6.8', 'decimal-pad')}
          </View>
          <View style={s.inputRow}>
            {renderInput('Width in', rigDraft.width_in, value => setRigDraft(d => ({ ...d, width_in: value })), '76', 'decimal-pad')}
            {renderInput('Water depth in', rigDraft.max_water_depth_in, value => setRigDraft(d => ({ ...d, max_water_depth_in: value })), '18', 'decimal-pad')}
          </View>
          <Text style={s.inputLabel}>Comfortable trail level</Text>
          <View style={s.pillGrid}>
            {TRAIL_DIFFICULTY.map(level => renderPill(level, rigDraft.max_trail_difficulty === level, () => setRigDraft(d => ({ ...d, max_trail_difficulty: level }))))}
          </View>
        </View>

        <View style={s.rigSection}>
          <Text style={s.rigSectionTitle}>Recovery</Text>
          {renderToggle('Winch', rigDraft.has_winch, () => setRigDraft(d => ({ ...d, has_winch: !d.has_winch })))}
          {rigDraft.has_winch ? renderInput('Winch lbs', rigDraft.winch_lbs, value => setRigDraft(d => ({ ...d, winch_lbs: value })), '10000', 'numeric') : null}
          {renderToggle('Recovery points', rigDraft.has_recovery_points, () => setRigDraft(d => ({ ...d, has_recovery_points: !d.has_recovery_points })))}
          {renderToggle('Traction boards', rigDraft.has_traction_boards, () => setRigDraft(d => ({ ...d, has_traction_boards: !d.has_traction_boards })))}
          {renderToggle('Air compressor', rigDraft.has_air_compressor, () => setRigDraft(d => ({ ...d, has_air_compressor: !d.has_air_compressor })))}
          {renderToggle('Skid plates', rigDraft.has_skids, () => setRigDraft(d => ({ ...d, has_skids: !d.has_skids })))}
          {renderToggle('Rock sliders', rigDraft.has_rock_sliders, () => setRigDraft(d => ({ ...d, has_rock_sliders: !d.has_rock_sliders })))}
        </View>

        <View style={s.rigSection}>
          <Text style={s.rigSectionTitle}>Camp load</Text>
          {renderToggle('Roof rack', rigDraft.has_rack, () => setRigDraft(d => ({ ...d, has_rack: !d.has_rack })))}
          {renderToggle('Avoid narrow trails', rigDraft.avoid_narrow_trails, () => setRigDraft(d => ({ ...d, avoid_narrow_trails: !d.avoid_narrow_trails })))}
          {renderToggle('Avoid body damage', rigDraft.avoid_body_damage, () => setRigDraft(d => ({ ...d, avoid_body_damage: !d.avoid_body_damage })))}
          {renderToggle('Towing', rigDraft.is_towing, () => {
            setRigDraft(d => ({ ...d, is_towing: !d.is_towing }));
            setNeeds(current => current.includes('towing') ? current : [...current, 'towing']);
          })}
          {rigDraft.is_towing ? (
            <View style={s.inputRow}>
              {renderInput('Trailer ft', rigDraft.trailer_length_ft, value => setRigDraft(d => ({ ...d, trailer_length_ft: value })), '20', 'decimal-pad')}
              {renderInput('Tow cap lbs', rigDraft.tow_capacity_lbs, value => setRigDraft(d => ({ ...d, tow_capacity_lbs: value })), '7700', 'numeric')}
            </View>
          ) : null}
        </View>
      </View>
    );
  }

  return (
    <Modal visible={visible} animationType="fade" presentationStyle="fullScreen" onRequestClose={handleRequestClose}>
      <View style={s.root}>
        <ImageBackground source={HERO_IMAGE} resizeMode="cover" style={s.heroImage}>
          <LinearGradient
            pointerEvents="none"
            colors={['rgba(8,31,52,0.16)', 'rgba(8,31,52,0.08)', 'rgba(5,18,30,0.78)']}
            locations={[0, 0.48, 1]}
            style={s.imageShade}
          />
          {mode === 'setup' ? <View pointerEvents="none" style={s.setupLightBackdrop} /> : null}
          <KeyboardAvoidingView
            style={[s.safe, { paddingTop: Math.max(insets.top, 18), paddingBottom: Math.max(insets.bottom, 14) }]}
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          >
            {mode === 'welcome' ? (
              <>
                <View style={s.heroTop}>
                  <Image source={TRAILHEAD_MARK} style={s.brandImage} resizeMode="contain" />
                  <Text style={s.brand}>TRAILHEAD</Text>
                </View>

                <View style={s.heroSpacer} />

                <View style={s.heroBottom}>
                  <LinearGradient
                    pointerEvents="none"
                    colors={['rgba(5,18,30,0)', 'rgba(5,18,30,0.56)', 'rgba(5,18,30,0.82)']}
                    locations={[0, 0.42, 1]}
                    style={s.heroBottomShade}
                  />
                  <Text style={s.heroMini}>Plan routes. Find camps. Explore farther.</Text>
                  <Text style={s.title}>Create unforgettable overlanding trips with maps, camps, and routes in one place</Text>
                  <TouchableOpacity style={s.primaryButton} onPress={() => setMode('setup')} activeOpacity={0.88}>
                    <Text style={s.primaryText}>Continue</Text>
                    <Ionicons name="arrow-forward" size={18} color="#101511" />
                  </TouchableOpacity>
                </View>
              </>
            ) : (
              <>
                <View style={s.setupHeader}>
                  <TouchableOpacity style={s.iconButton} onPress={goBack} activeOpacity={0.76} accessibilityLabel="Back">
                    <Ionicons name="chevron-back" size={22} color="#2a241d" />
                  </TouchableOpacity>
                  <View style={s.progressTrack}>
                    <View style={[s.progressFill, { width: `${(progress / steps.length) * 100}%` }]} />
                  </View>
                  <TouchableOpacity style={s.skipHeaderButton} onPress={skipSetup} activeOpacity={0.76}>
                    <Text style={s.skipHeaderText}>Later</Text>
                  </TouchableOpacity>
                </View>

                <View style={s.setupCopy}>
                  <Text style={s.setupKicker}>Trip setup</Text>
                  <Text style={s.setupTitle}>
                    {step === 'camp' ? 'Preferred camp types' : step === 'party' ? 'Travel party' : step === 'vehicle' ? 'Vehicle' : step === 'rig' ? 'Your rig' : 'Extras'}
                  </Text>
                </View>

                <ScrollView style={s.optionScroll} contentContainerStyle={s.optionContent} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
                  {renderSetupOptions()}
                </ScrollView>

                <View style={s.setupDock}>
                  <Text style={s.selectionText}>
                    {selectedCount > 0 ? `${selectedCount} selected` : step === 'rig' ? 'Add what you know' : 'Pick one to continue'}
                  </Text>
                  <TouchableOpacity
                    style={[s.primaryButton, s.setupPrimaryButton, !canAdvance && s.primaryButtonDisabled]}
                    onPress={nextSetupStep}
                    activeOpacity={canAdvance ? 0.86 : 1}
                  >
                    <Text style={[s.primaryText, s.setupPrimaryText]}>{stepIndex === steps.length - 1 ? 'Done' : step === 'rig' ? 'Save rig' : 'Next'}</Text>
                    <Ionicons name={stepIndex === steps.length - 1 ? 'checkmark' : 'arrow-forward'} size={18} color="#ffffff" />
                  </TouchableOpacity>
                  {step === 'rig' ? (
                    <TouchableOpacity style={s.linkButton} onPress={nextSetupStep} activeOpacity={0.72}>
                      <Text style={s.setupLinkText}>Skip rig details</Text>
                    </TouchableOpacity>
                  ) : null}
                </View>
              </>
            )}
          </KeyboardAvoidingView>
        </ImageBackground>
      </View>
    </Modal>
  );
}

const styles = () => StyleSheet.create({
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
  setupLightBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#f6f1e8',
  },
  safe: {
    flex: 1,
    paddingHorizontal: 20,
  },
  heroTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    alignSelf: 'center',
    paddingTop: 12,
  },
  brandImage: {
    width: 48,
    height: 48,
    borderRadius: 13,
  },
  brand: {
    color: '#ffffff',
    fontFamily: mono,
    fontSize: 29,
    lineHeight: 34,
    fontWeight: '900',
    letterSpacing: 0,
    textShadowColor: 'rgba(0,0,0,0.6)',
    textShadowRadius: 10,
    textShadowOffset: { width: 0, height: 1 },
  },
  heroSpacer: {
    flex: 1,
  },
  heroMini: {
    color: 'rgba(255,255,255,0.96)',
    fontSize: 14,
    lineHeight: 19,
    fontWeight: '800',
    letterSpacing: 0,
    textAlign: 'center',
    textShadowColor: 'rgba(0,0,0,0.56)',
    textShadowRadius: 10,
  },
  heroBottom: {
    position: 'relative',
    gap: 14,
    marginHorizontal: -20,
    paddingHorizontal: 20,
    paddingTop: 24,
    paddingBottom: 30,
    borderTopLeftRadius: 42,
    borderTopRightRadius: 42,
    overflow: 'hidden',
  },
  heroBottomShade: {
    ...StyleSheet.absoluteFillObject,
  },
  title: {
    color: '#ffffff',
    fontSize: 23,
    lineHeight: 29,
    fontWeight: '800',
    letterSpacing: 0,
    textAlign: 'center',
    textShadowColor: 'rgba(0,0,0,0.58)',
    textShadowRadius: 16,
  },
  primaryButton: {
    minHeight: 56,
    borderRadius: 28,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#ffffff',
    shadowColor: '#000',
    shadowOpacity: Platform.OS === 'ios' ? 0.2 : 0,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
  },
  primaryButtonDisabled: {
    backgroundColor: '#d7c8b7',
    shadowOpacity: 0,
  },
  setupPrimaryButton: {
    backgroundColor: SETUP_BLUE,
    shadowColor: SETUP_BLUE,
    shadowOpacity: Platform.OS === 'ios' ? 0.18 : 0,
  },
  setupPrimaryText: {
    color: '#ffffff',
  },
  primaryText: {
    color: '#101511',
    fontSize: 15,
    fontWeight: '900',
    letterSpacing: 0,
  },
  linkButton: {
    minHeight: 34,
    alignItems: 'center',
    justifyContent: 'center',
  },
  setupLinkText: {
    color: SETUP_BLUE,
    fontSize: 13,
    fontWeight: '900',
    letterSpacing: 0,
  },
  setupHeader: {
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  iconButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#eadfce',
  },
  skipHeaderButton: {
    minWidth: 54,
    minHeight: 38,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  skipHeaderText: {
    color: '#3b332a',
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 0,
  },
  progressTrack: {
    flex: 1,
    height: 5,
    borderRadius: 3,
    overflow: 'hidden',
    backgroundColor: '#e5d8c6',
  },
  progressFill: {
    height: 5,
    borderRadius: 3,
    backgroundColor: SETUP_BLUE,
  },
  setupCopy: {
    gap: 7,
    paddingTop: 16,
    paddingBottom: 18,
  },
  setupKicker: {
    color: '#8b7966',
    fontFamily: mono,
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 0,
    textTransform: 'uppercase',
  },
  setupTitle: {
    color: '#241f19',
    fontSize: 33,
    lineHeight: 38,
    fontWeight: '900',
    letterSpacing: 0,
  },
  optionScroll: {
    flex: 1,
  },
  optionContent: {
    gap: 10,
    paddingBottom: 14,
  },
  choiceRow: {
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    borderRadius: 28,
    borderWidth: 1,
    borderColor: '#e4d7c5',
    backgroundColor: '#fffaf2',
  },
  choiceRowSelected: {
    borderColor: SETUP_BLUE,
    backgroundColor: SETUP_BLUE,
  },
  choiceText: {
    flex: 1,
    color: '#2a241d',
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '900',
    letterSpacing: 0,
  },
  choiceTextSelected: {
    color: '#ffffff',
  },
  setupDock: {
    gap: 9,
    paddingTop: 8,
  },
  selectionText: {
    color: '#766754',
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0,
    textAlign: 'center',
  },
  rigForm: {
    gap: 18,
  },
  rigSection: {
    gap: 10,
  },
  rigSectionTitle: {
    color: '#241f19',
    fontSize: 18,
    fontWeight: '900',
    letterSpacing: 0,
  },
  pillGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  rigPill: {
    minHeight: 38,
    borderRadius: 19,
    paddingHorizontal: 13,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#e2d5c4',
    backgroundColor: '#fffaf2',
  },
  rigPillSelected: {
    borderColor: SETUP_BLUE,
    backgroundColor: SETUP_BLUE,
  },
  rigPillText: {
    color: '#2a241d',
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 0,
  },
  rigPillTextSelected: {
    color: '#ffffff',
  },
  inputRow: {
    flexDirection: 'row',
    gap: 10,
  },
  inputGroup: {
    flex: 1,
    gap: 6,
  },
  inputLabel: {
    color: '#8b7966',
    fontFamily: mono,
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 0,
    textTransform: 'uppercase',
  },
  input: {
    minHeight: 46,
    borderRadius: 12,
    paddingHorizontal: 12,
    color: '#241f19',
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 0,
    borderWidth: 1,
    borderColor: '#e2d5c4',
    backgroundColor: '#fffaf2',
  },
  toggleRow: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  toggleText: {
    flex: 1,
    color: '#2a241d',
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: 0,
  },
  toggle: {
    width: 48,
    height: 28,
    borderRadius: 14,
    padding: 3,
    backgroundColor: '#dfd2c1',
  },
  toggleOn: {
    backgroundColor: SETUP_BLUE,
  },
  toggleThumb: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#ffffff',
  },
  toggleThumbOn: {
    transform: [{ translateX: 20 }],
  },
});
