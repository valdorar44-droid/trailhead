import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
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
  useWindowDimensions,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/lib/design';
import { trailheadFonts } from '@/lib/typography';
import type {
  WelcomeCampType,
  WelcomeSetupPreferences,
  WelcomeSetupStep,
  WelcomeTravelNeed,
  WelcomeTravelParty,
  WelcomeVehicleChoice,
  WelcomeVisibleTravelNeed,
} from '@/lib/welcomeGate';
import {
  WELCOME_FIRST_RUN_COPY,
  WELCOME_PRIMARY_STEP_TOTAL,
  WELCOME_SETUP_OPTION_LABELS,
  WELCOME_SETUP_QUESTIONS,
  hasWelcomeRigEdits,
  loadWelcomeSetupPreferences,
  welcomeCurrentStepSelectionCount,
  welcomePrimaryStepNumber,
  welcomeSetupSteps,
} from '@/lib/welcomeGate';
import { RigProfile, useStore } from '@/lib/store';

const WELCOME_PHONE_IMAGE = require('../assets/onboarding-welcome-production-phone.jpg');
const WELCOME_TABLET_IMAGE = require('../assets/onboarding-welcome-production-tablet.jpg');
const TRAILHEAD_MARK = require('../assets/trailhead-mark.png');
type WelcomeGateMode = 'welcome' | 'setup';
type RigSectionId = 'basics' | 'capability' | 'suspension' | 'range' | 'dimensions' | 'recovery' | 'towing';

type WelcomeGateProps = {
  visible: boolean;
  initialMode?: WelcomeGateMode;
  onSignIn: () => void;
  onContinue: () => void;
  onSetupComplete?: (preferences: WelcomeSetupPreferences) => void;
  onSetupSkip?: (preferences: WelcomeSetupPreferences) => void;
};

type Choice<T extends string> = {
  id: T;
  title: string;
  icon: keyof typeof Ionicons.glyphMap;
};

const CAMP_OPTIONS: Array<Choice<WelcomeCampType>> = [
  { id: 'dispersed', title: WELCOME_SETUP_OPTION_LABELS.camp[0], icon: 'bonfire-outline' },
  { id: 'developed', title: WELCOME_SETUP_OPTION_LABELS.camp[1], icon: 'trail-sign-outline' },
  { id: 'private', title: WELCOME_SETUP_OPTION_LABELS.camp[2], icon: 'home-outline' },
  { id: 'rv_parks', title: WELCOME_SETUP_OPTION_LABELS.camp[3], icon: 'business-outline' },
  { id: 'any', title: WELCOME_SETUP_OPTION_LABELS.camp[4], icon: 'layers-outline' },
];

const PARTY_OPTIONS: Array<Choice<WelcomeTravelParty>> = [
  { id: 'solo', title: WELCOME_SETUP_OPTION_LABELS.party[0], icon: 'person-outline' },
  { id: 'two_people', title: WELCOME_SETUP_OPTION_LABELS.party[1], icon: 'people-outline' },
  { id: 'family', title: WELCOME_SETUP_OPTION_LABELS.party[2], icon: 'happy-outline' },
  { id: 'group', title: WELCOME_SETUP_OPTION_LABELS.party[3], icon: 'people-circle-outline' },
];

const VEHICLE_OPTIONS: Array<Choice<WelcomeVehicleChoice>> = [
  { id: 'own_vehicle', title: WELCOME_SETUP_OPTION_LABELS.vehicle[0], icon: 'car-sport-outline' },
  { id: 'need_rental', title: WELCOME_SETUP_OPTION_LABELS.vehicle[1], icon: 'key-outline' },
  { id: 'rent_sometimes', title: WELCOME_SETUP_OPTION_LABELS.vehicle[2], icon: 'calendar-outline' },
  { id: 'not_sure', title: WELCOME_SETUP_OPTION_LABELS.vehicle[3], icon: 'compass-outline' },
];

const NEED_OPTIONS: Array<Choice<WelcomeVisibleTravelNeed>> = [
  { id: 'pets', title: WELCOME_SETUP_OPTION_LABELS.needs[0], icon: 'paw-outline' },
  { id: 'kids', title: WELCOME_SETUP_OPTION_LABELS.needs[1], icon: 'happy-outline' },
  { id: 'towing', title: WELCOME_SETUP_OPTION_LABELS.needs[2], icon: 'swap-horizontal-outline' },
];

const VEHICLE_TYPES = ['Truck', 'Jeep', 'SUV', 'Van/Camper', 'Moto', 'Other'];
const DRIVE_TYPES = ['2WD', 'AWD', '4x4 PT', '4x4 FT'];
const DIFF_LOCK = ['None', 'Rear Locker', 'Front + Rear'];
const TIRE_TYPES = ['All-terrain', 'Mud-terrain', 'Highway', 'Winter'];
const SUSPENSION_TYPES = ['Stock', 'Leveling Kit', 'Lift Kit', 'Coilovers', 'Long Travel'];
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
  onSignIn,
  onContinue,
  onSetupComplete,
  onSetupSkip,
}: WelcomeGateProps) {
  const C = useTheme();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const isTablet = width >= 700;
  const isCompact = width <= 360 || height <= 650;
  const isNarrow = width <= 360;
  const isDark = useStore(state => state.themeMode) === 'dark';
  const welcomeImage = isTablet ? WELCOME_TABLET_IMAGE : WELCOME_PHONE_IMAGE;
  const accentText = isDark ? '#0A0C0B' : '#FFFFFF';
  const s = useMemo(() => styles({ isTablet, isCompact, isNarrow }), [isCompact, isNarrow, isTablet]);
  const setRigProfile = useStore(state => state.setRigProfile);
  const [mode, setMode] = useState<WelcomeGateMode>(initialMode);
  const [stepIndex, setStepIndex] = useState(0);
  const [vehicle, setVehicle] = useState<WelcomeVehicleChoice | null>(null);
  const [campTypes, setCampTypes] = useState<WelcomeCampType[]>([]);
  const [party, setParty] = useState<WelcomeTravelParty | null>(null);
  const [needs, setNeeds] = useState<WelcomeTravelNeed[]>([]);
  const [rigDraft, setRigDraft] = useState<RigProfile>(DEFAULT_RIG);
  const [setupCompletedAt, setSetupCompletedAt] = useState<number | undefined>();
  const [setupHydrated, setSetupHydrated] = useState(initialMode !== 'setup');
  const [expandedRigSections, setExpandedRigSections] = useState<Record<RigSectionId, boolean>>({
    basics: true,
    capability: false,
    suspension: false,
    range: false,
    dimensions: false,
    recovery: false,
    towing: false,
  });

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    setMode(initialMode);
    setStepIndex(0);
    setVehicle(null);
    setCampTypes([]);
    setParty(null);
    setNeeds([]);
    setSetupCompletedAt(undefined);
    setSetupHydrated(initialMode !== 'setup');
    const savedRig = initialMode === 'setup' ? useStore.getState().rigProfile : null;
    setRigDraft(savedRig ? { ...DEFAULT_RIG, ...savedRig } : DEFAULT_RIG);
    setExpandedRigSections({ basics: true, capability: false, suspension: false, range: false, dimensions: false, recovery: false, towing: false });

    if (initialMode === 'setup') {
      loadWelcomeSetupPreferences().then(saved => {
        if (cancelled || !saved) return;
        setVehicle(saved.vehicle);
        setCampTypes(saved.campingStyles ?? []);
        setParty(saved.party);
        setNeeds(saved.needs);
        setSetupCompletedAt(saved.completedAt);
      }).catch(() => {
        // Stored setup is optional; a failed read should still leave the form usable.
      }).finally(() => {
        if (!cancelled) setSetupHydrated(true);
      });
    }

    return () => { cancelled = true; };
  }, [initialMode, visible]);

  const steps = useMemo<WelcomeSetupStep[]>(() => welcomeSetupSteps(vehicle), [vehicle]);
  const step = steps[Math.min(stepIndex, steps.length - 1)];
  const progress = welcomePrimaryStepNumber(step);
  const canAdvance = step === 'camp' ? campTypes.length > 0 : step === 'party' ? !!party : step === 'vehicle' ? !!vehicle : true;
  const selectedCount = welcomeCurrentStepSelectionCount(step, {
    campTypes,
    party,
    vehicle,
    needs,
    rigHasData: hasRigData(rigDraft),
  });

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
      completedAt: setupCompletedAt,
    };
  }

  function hasRigData(rig: RigProfile) {
    return hasWelcomeRigEdits(
      rig as unknown as Record<string, unknown>,
      DEFAULT_RIG as unknown as Record<string, unknown>,
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
    if (step === 'rig') saveRigIfUseful();
    if (stepIndex < steps.length - 1) {
      setStepIndex(current => current + 1);
      return;
    }
    completeSetup();
  }

  function skipSetup() {
    if (!setupHydrated) return;
    saveRigIfUseful();
    onSetupSkip?.(preferences());
  }

  function skipRigDetails() {
    if (stepIndex < steps.length - 1) setStepIndex(current => current + 1);
  }

  function toggleRigSection(section: RigSectionId) {
    setExpandedRigSections(current => ({ ...current, [section]: !current[section] }));
  }

  function goBack() {
    if (!setupHydrated) return;
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
        testID={`welcome-${step}-${option.id}`}
        accessibilityRole={multi ? 'checkbox' : 'radio'}
        accessibilityLabel={option.title}
        accessibilityState={{ checked: selected }}
        activeOpacity={0.84}
        onPress={onPress}
        style={[
          s.choiceRow,
          { backgroundColor: C.s1, borderColor: C.border },
          selected && { backgroundColor: C.orange, borderColor: C.orange },
        ]}
      >
        <Ionicons accessible={false} name={option.icon} size={20} color={selected ? accentText : C.text} />
        <Text style={[s.choiceText, { color: selected ? accentText : C.text }]}>{option.title}</Text>
        <Ionicons
          accessible={false}
          name={selected ? 'checkmark-circle' : multi ? 'ellipse-outline' : 'radio-button-off-outline'}
          size={22}
          color={selected ? accentText : C.text2}
        />
      </TouchableOpacity>
    );
  }

  function renderPill(value: string, selected: boolean, onPress: () => void) {
    const slug = value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    return (
      <TouchableOpacity
        key={value}
        testID={`welcome-rig-option-${slug}`}
        accessibilityRole="radio"
        accessibilityLabel={value}
        accessibilityState={{ checked: selected }}
        style={[
          s.rigPill,
          { backgroundColor: C.s2, borderColor: C.border },
          selected && { backgroundColor: C.orange, borderColor: C.orange },
        ]}
        onPress={onPress}
        activeOpacity={0.84}
      >
        <Text style={[s.rigPillText, { color: selected ? accentText : C.text }]}>{value}</Text>
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
        <Text style={[s.inputLabel, { color: C.text2 }]}>{label}</Text>
        <TextInput
          testID={`welcome-rig-input-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`}
          accessibilityLabel={label}
          style={[s.input, { color: C.text, backgroundColor: C.s2, borderColor: C.border }]}
          value={value ?? ''}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={C.text3}
          keyboardType={keyboardType}
        />
      </View>
    );
  }

  function renderToggle(label: string, value: boolean | undefined, onPress: () => void) {
    return (
      <TouchableOpacity
        testID={`welcome-rig-toggle-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`}
        accessibilityRole="switch"
        accessibilityLabel={label}
        accessibilityState={{ checked: Boolean(value) }}
        style={s.toggleRow}
        onPress={onPress}
        activeOpacity={0.84}
      >
        <Text style={[s.toggleText, { color: C.text }]}>{label}</Text>
        <View accessible={false} style={[s.toggle, { backgroundColor: value ? C.orange : C.border2 }]}>
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

  function renderRigSection(section: RigSectionId, title: string, children: ReactNode) {
    const expanded = expandedRigSections[section];
    return (
      <View key={section} style={[s.rigSection, { backgroundColor: C.s1, borderColor: C.border }] }>
        <TouchableOpacity
          testID={`welcome-rig-section-${section}`}
          accessibilityRole="button"
          accessibilityLabel={title}
          accessibilityState={{ expanded }}
          style={s.rigSectionHeader}
          activeOpacity={0.78}
          onPress={() => toggleRigSection(section)}
        >
          <Text style={[s.rigSectionTitle, { color: C.text }]}>{title}</Text>
          <Ionicons accessible={false} name={expanded ? 'chevron-up' : 'chevron-down'} size={20} color={C.text2} />
        </TouchableOpacity>
        {expanded ? <View style={[s.rigSectionBody, { borderTopColor: C.border }]}>{children}</View> : null}
      </View>
    );
  }

  function renderRigSetup() {
    const nextTowing = !rigDraft.is_towing;
    return (
      <View style={s.rigForm}>
        {renderRigSection('basics', 'Basics', <>
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
        </>)}

        {renderRigSection('capability', 'Capability', <>
          <View style={s.pillGrid}>
            {DRIVE_TYPES.map(drive => renderPill(drive, rigDraft.drive === drive, () => setRigDraft(d => ({ ...d, drive }))))}
          </View>
          <View style={s.pillGrid}>
            {DIFF_LOCK.map(diff => renderPill(diff, rigDraft.locking_diffs === diff, () => setRigDraft(d => ({ ...d, locking_diffs: diff }))))}
          </View>
          {renderInput('Clearance in', rigDraft.ground_clearance_in, value => setRigDraft(d => ({ ...d, ground_clearance_in: value })), '9.4', 'decimal-pad')}
          <View style={s.inputRow}>
            {renderInput('Tire diameter', rigDraft.tire_diameter_in, value => setRigDraft(d => ({ ...d, tire_diameter_in: value })), '33', 'decimal-pad')}
            {renderInput('Tire size', rigDraft.tire_size, value => setRigDraft(d => ({ ...d, tire_size: value })), '285/75R17')}
          </View>
          <View style={s.pillGrid}>
            {TIRE_TYPES.map(type => renderPill(type, rigDraft.tire_type === type, () => setRigDraft(d => ({ ...d, tire_type: type }))))}
          </View>
          {renderToggle('Low range', rigDraft.has_low_range, () => setRigDraft(d => ({ ...d, has_low_range: !d.has_low_range })))}
          {renderToggle('Full-size spare', rigDraft.full_size_spare, () => setRigDraft(d => ({ ...d, full_size_spare: !d.full_size_spare })))}
          <Text style={[s.inputLabel, { color: C.text2 }]}>Comfortable trail level</Text>
          <View style={s.pillGrid}>
            {TRAIL_DIFFICULTY.map(level => renderPill(level, rigDraft.max_trail_difficulty === level, () => setRigDraft(d => ({ ...d, max_trail_difficulty: level }))))}
          </View>
        </>)}

        {renderRigSection('suspension', 'Suspension', <>
          <View style={s.pillGrid}>
            {SUSPENSION_TYPES.map(type => renderPill(type, rigDraft.suspension === type, () => setRigDraft(d => ({ ...d, suspension: type }))))}
          </View>
          {renderInput('Lift in', rigDraft.lift_in, value => setRigDraft(d => ({ ...d, lift_in: value })), '2.5', 'decimal-pad')}
        </>)}

        {renderRigSection('range', 'Range', <>
          <View style={s.inputRow}>
            {renderInput('Range miles', rigDraft.fuel_range_miles, value => setRigDraft(d => ({ ...d, fuel_range_miles: value })), '400', 'numeric')}
            {renderInput('Real MPG', rigDraft.fuel_mpg, value => setRigDraft(d => ({ ...d, fuel_mpg: value })), '14.5', 'decimal-pad')}
          </View>
          <View style={s.inputRow}>
            {renderInput('Tank gal', rigDraft.tank_capacity_gal, value => setRigDraft(d => ({ ...d, tank_capacity_gal: value })), '21', 'decimal-pad')}
            {renderInput('Water gal', rigDraft.water_capacity_gal, value => setRigDraft(d => ({ ...d, water_capacity_gal: value })), '10', 'decimal-pad')}
          </View>
        </>)}

        {renderRigSection('dimensions', 'Dimensions', <>
          <View style={s.inputRow}>
            {renderInput('Length ft', rigDraft.length_ft, value => setRigDraft(d => ({ ...d, length_ft: value })), '18.5', 'decimal-pad')}
            {renderInput('Height ft', rigDraft.height_ft, value => setRigDraft(d => ({ ...d, height_ft: value })), '6.8', 'decimal-pad')}
          </View>
          <View style={s.inputRow}>
            {renderInput('Width in', rigDraft.width_in, value => setRigDraft(d => ({ ...d, width_in: value })), '76', 'decimal-pad')}
            {renderInput('Water depth in', rigDraft.max_water_depth_in, value => setRigDraft(d => ({ ...d, max_water_depth_in: value })), '18', 'decimal-pad')}
          </View>
          {renderToggle('Roof rack', rigDraft.has_rack, () => setRigDraft(d => ({ ...d, has_rack: !d.has_rack })))}
          {renderToggle('Avoid narrow trails', rigDraft.avoid_narrow_trails, () => setRigDraft(d => ({ ...d, avoid_narrow_trails: !d.avoid_narrow_trails })))}
          {renderToggle('Avoid body damage', rigDraft.avoid_body_damage, () => setRigDraft(d => ({ ...d, avoid_body_damage: !d.avoid_body_damage })))}
        </>)}

        {renderRigSection('recovery', 'Recovery', <>
          {renderToggle('Winch', rigDraft.has_winch, () => setRigDraft(d => ({ ...d, has_winch: !d.has_winch })))}
          {rigDraft.has_winch ? renderInput('Winch lbs', rigDraft.winch_lbs, value => setRigDraft(d => ({ ...d, winch_lbs: value })), '10000', 'numeric') : null}
          {renderToggle('Recovery points', rigDraft.has_recovery_points, () => setRigDraft(d => ({ ...d, has_recovery_points: !d.has_recovery_points })))}
          {renderToggle('Traction boards', rigDraft.has_traction_boards, () => setRigDraft(d => ({ ...d, has_traction_boards: !d.has_traction_boards })))}
          {renderToggle('Air compressor', rigDraft.has_air_compressor, () => setRigDraft(d => ({ ...d, has_air_compressor: !d.has_air_compressor })))}
          {renderToggle('Skid plates', rigDraft.has_skids, () => setRigDraft(d => ({ ...d, has_skids: !d.has_skids })))}
          {renderToggle('Rock sliders', rigDraft.has_rock_sliders, () => setRigDraft(d => ({ ...d, has_rock_sliders: !d.has_rock_sliders })))}
        </>)}

        {renderRigSection('towing', 'Towing', <>
          {renderToggle('Towing', rigDraft.is_towing, () => {
            setRigDraft(d => ({ ...d, is_towing: nextTowing }));
            setNeeds(current => nextTowing
              ? (current.includes('towing') ? current : [...current, 'towing'])
              : current.filter(need => need !== 'towing'));
          })}
          {rigDraft.is_towing ? (
            <View style={s.inputRow}>
              {renderInput('Trailer ft', rigDraft.trailer_length_ft, value => setRigDraft(d => ({ ...d, trailer_length_ft: value })), '20', 'decimal-pad')}
              {renderInput('Tow cap lbs', rigDraft.tow_capacity_lbs, value => setRigDraft(d => ({ ...d, tow_capacity_lbs: value })), '7700', 'numeric')}
            </View>
          ) : null}
        </>)}
      </View>
    );
  }

  function renderWelcomeCopyAndActions() {
    return (
      <View style={s.welcomeContent}>
        <View style={s.welcomeCopy}>
          <Text style={s.welcomeKicker}>{WELCOME_FIRST_RUN_COPY.kicker}</Text>
          <Text accessibilityRole="header" style={s.welcomeTitle}>{WELCOME_FIRST_RUN_COPY.headline}</Text>
        </View>
        <View style={s.welcomeActions}>
          <TouchableOpacity
            testID="welcome-get-started"
            accessibilityRole="button"
            accessibilityLabel={WELCOME_FIRST_RUN_COPY.getStarted}
            style={s.primaryButton}
            onPress={() => setMode('setup')}
            activeOpacity={0.88}
          >
            <Text style={s.primaryText}>{WELCOME_FIRST_RUN_COPY.getStarted}</Text>
            <Ionicons accessible={false} name="arrow-forward" size={18} color="#111412" />
          </TouchableOpacity>
          <TouchableOpacity
            testID="welcome-explore-first"
            accessibilityRole="button"
            accessibilityLabel={WELCOME_FIRST_RUN_COPY.exploreFirst}
            style={s.secondaryButton}
            onPress={onContinue}
            activeOpacity={0.82}
          >
            <Text style={s.secondaryText}>{WELCOME_FIRST_RUN_COPY.exploreFirst}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            testID="welcome-sign-in"
            accessibilityRole="button"
            accessibilityLabel={WELCOME_FIRST_RUN_COPY.signIn}
            style={s.signInButton}
            onPress={onSignIn}
            activeOpacity={0.72}
          >
            <Text style={s.signInText}>{WELCOME_FIRST_RUN_COPY.signIn}</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <Modal visible={visible} animationType="fade" presentationStyle="fullScreen" onRequestClose={handleRequestClose}>
      <View
        testID="welcome-gate"
        accessibilityViewIsModal
        style={[s.root, { backgroundColor: mode === 'welcome' ? '#050706' : C.bg }]}
      >
        <StatusBar style={mode === 'welcome' || isDark ? 'light' : 'dark'} />
        {mode === 'welcome' ? (
          <ImageBackground
            testID={isTablet ? 'welcome-background-tablet' : 'welcome-background-phone'}
            accessible={false}
            source={welcomeImage}
            resizeMode="cover"
            style={s.welcomeBackground}
          >
            <ScrollView
              testID={isTablet ? 'welcome-layout-tablet' : 'welcome-layout-phone'}
              style={s.welcomeScroll}
              contentContainerStyle={[
                s.welcomeOverlayContent,
                {
                  paddingTop: Math.max(insets.top + (isTablet ? 22 : 8), isTablet ? 48 : 24),
                  paddingBottom: Math.max(insets.bottom + 12, 24),
                },
              ]}
              showsVerticalScrollIndicator={false}
              bounces={false}
            >
              <View style={s.welcomeHeader}>
                <Image accessible={false} source={TRAILHEAD_MARK} resizeMode="contain" style={s.brandMark} />
                <Text style={s.brand}>{WELCOME_FIRST_RUN_COPY.wordmark}</Text>
              </View>
              <View style={s.welcomeSpacer} />
              <View style={s.welcomeBottom}>
                {renderWelcomeCopyAndActions()}
              </View>
            </ScrollView>
          </ImageBackground>
        ) : (
          <KeyboardAvoidingView
            style={[
              s.setupSafe,
              {
                paddingTop: Math.max(insets.top, 18),
                paddingBottom: Math.max(insets.bottom, 14),
                backgroundColor: C.bg,
              },
            ]}
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          >
            <View style={s.setupHeader}>
              <TouchableOpacity
                testID="welcome-setup-back"
                style={[s.iconButton, { backgroundColor: C.s1, borderColor: C.border }]}
                onPress={goBack}
                activeOpacity={setupHydrated ? 0.76 : 1}
                disabled={!setupHydrated}
                accessibilityRole="button"
                accessibilityLabel="Back"
                accessibilityState={{ disabled: !setupHydrated }}
              >
                <Ionicons accessible={false} name="chevron-back" size={22} color={C.text} />
              </TouchableOpacity>
              <View
                accessible
                accessibilityRole="progressbar"
                accessibilityLabel={step === 'rig' ? 'Optional vehicle details' : 'Trip setup progress'}
                accessibilityValue={{ min: 1, max: WELCOME_PRIMARY_STEP_TOTAL, now: progress, text: `Step ${progress} of ${WELCOME_PRIMARY_STEP_TOTAL}` }}
                style={[s.progressTrack, { backgroundColor: C.border2 }]}
              >
                <View style={[s.progressFill, { backgroundColor: C.orange, width: `${(progress / WELCOME_PRIMARY_STEP_TOTAL) * 100}%` }]} />
              </View>
              <TouchableOpacity
                testID="welcome-setup-later"
                accessibilityRole="button"
                accessibilityLabel="Later"
                accessibilityState={{ disabled: !setupHydrated }}
                style={s.skipHeaderButton}
                onPress={skipSetup}
                activeOpacity={setupHydrated ? 0.76 : 1}
                disabled={!setupHydrated}
              >
                <Text style={[s.skipHeaderText, { color: C.text }]}>Later</Text>
              </TouchableOpacity>
            </View>

            <View style={s.setupCopy}>
              <Text style={[s.setupKicker, { color: C.orange }]}>{step === 'rig' ? 'Optional' : `Step ${progress} of ${WELCOME_PRIMARY_STEP_TOTAL}`}</Text>
              <Text accessibilityRole="header" style={[s.setupTitle, { color: C.text }]}>{WELCOME_SETUP_QUESTIONS[step]}</Text>
            </View>

            {setupHydrated ? (
              <ScrollView style={s.optionScroll} contentContainerStyle={s.optionContent} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
                {renderSetupOptions()}
              </ScrollView>
            ) : (
              <View testID="welcome-setup-loading" accessibilityRole="progressbar" accessibilityLabel="Loading trip setup" style={s.setupLoading}>
                <ActivityIndicator color={C.orange} />
                <Text style={[s.setupLoadingText, { color: C.text2 }]}>Loading setup…</Text>
              </View>
            )}

            {setupHydrated ? <View style={s.setupDock}>
              <Text style={[s.selectionText, { color: C.text2 }]}>
                {step === 'rig'
                  ? (selectedCount > 0 ? 'Details added' : 'Optional')
                  : selectedCount > 0
                    ? `${selectedCount} selected`
                    : step === 'needs'
                      ? 'Optional'
                      : 'Select one to continue'}
              </Text>
              <TouchableOpacity
                testID="welcome-setup-next"
                accessibilityRole="button"
                accessibilityLabel={stepIndex === steps.length - 1 ? 'Done' : step === 'rig' ? 'Save and continue' : 'Next'}
                accessibilityState={{ disabled: !canAdvance }}
                style={[
                  s.primaryButton,
                  {
                    backgroundColor: canAdvance ? C.orange : C.s2,
                    borderColor: canAdvance ? C.orange : C.border,
                    borderWidth: canAdvance ? 0 : 1,
                  },
                ]}
                onPress={nextSetupStep}
                disabled={!canAdvance}
                activeOpacity={canAdvance ? 0.86 : 1}
              >
                <Text style={[s.primaryText, { color: canAdvance ? accentText : C.text3 }]}>{stepIndex === steps.length - 1 ? 'Done' : step === 'rig' ? 'Save & continue' : 'Next'}</Text>
                <Ionicons accessible={false} name={stepIndex === steps.length - 1 ? 'checkmark' : 'arrow-forward'} size={18} color={canAdvance ? accentText : C.text3} />
              </TouchableOpacity>
              {step === 'rig' ? (
                <TouchableOpacity testID="welcome-rig-skip" accessibilityRole="button" accessibilityLabel="Skip for now" style={s.linkButton} onPress={skipRigDetails} activeOpacity={0.72}>
                  <Text style={[s.setupLinkText, { color: C.orange }]}>Skip for now</Text>
                </TouchableOpacity>
              ) : null}
            </View> : null}
          </KeyboardAvoidingView>
        )}
      </View>
    </Modal>
  );
}

const styles = ({
  isTablet,
  isCompact,
  isNarrow,
}: {
  isTablet: boolean;
  isCompact: boolean;
  isNarrow: boolean;
}) => StyleSheet.create({
  root: { flex: 1 },
  welcomeBackground: {
    flex: 1,
    backgroundColor: '#050706',
  },
  welcomeScroll: { flex: 1 },
  welcomeOverlayContent: {
    flexGrow: 1,
    paddingHorizontal: isTablet ? 58 : isNarrow ? 18 : 26,
  },
  welcomeHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  brandMark: {
    width: isTablet ? 72 : isCompact ? 40 : 50,
    height: isTablet ? 72 : isCompact ? 40 : 50,
    borderRadius: isTablet ? 18 : isCompact ? 11 : 13,
  },
  brand: {
    color: '#FFFFFF',
    fontFamily: trailheadFonts.displayBold,
    fontSize: isTablet ? 50 : isCompact ? 29 : 34,
    lineHeight: isTablet ? 56 : isCompact ? 32 : 38,
    letterSpacing: isTablet ? 1.4 : isCompact ? 0.9 : 1.1,
    textShadowColor: 'rgba(0,0,0,0.52)',
    textShadowRadius: 10,
    textShadowOffset: { width: 0, height: 1 },
  },
  welcomeSpacer: {
    flex: 1,
    minHeight: isTablet ? 420 : isCompact ? 116 : 210,
  },
  welcomeBottom: {
    width: '100%',
    maxWidth: isTablet ? 980 : undefined,
    alignSelf: isTablet ? 'center' : 'stretch',
  },
  welcomeContent: {
    width: '100%',
    flexDirection: isTablet ? 'row' : 'column',
    alignItems: isTablet ? 'flex-end' : 'stretch',
    gap: isTablet ? 32 : isCompact ? 12 : 16,
  },
  welcomeCopy: {
    flex: isTablet ? 1 : undefined,
    maxWidth: isTablet ? 500 : undefined,
    gap: isCompact ? 6 : 8,
  },
  welcomeKicker: {
    color: '#FFFFFF',
    fontSize: isTablet ? 20 : isCompact ? 12 : 15,
    lineHeight: isTablet ? 26 : isCompact ? 16 : 20,
    fontWeight: '700',
    letterSpacing: isCompact ? 0 : -0.1,
    textAlign: isTablet ? 'left' : 'center',
    textShadowColor: 'rgba(0,0,0,0.58)',
    textShadowRadius: 8,
    textShadowOffset: { width: 0, height: 2 },
  },
  welcomeTitle: {
    color: '#FFFFFF',
    fontFamily: trailheadFonts.displayBold,
    fontSize: isTablet ? 50 : isCompact ? 26 : 34,
    lineHeight: isTablet ? 52 : isCompact ? 27 : 36,
    letterSpacing: isTablet ? 0 : -0.2,
    textAlign: isTablet ? 'left' : 'center',
    textShadowColor: 'rgba(0,0,0,0.58)',
    textShadowRadius: 14,
    textShadowOffset: { width: 0, height: 2 },
  },
  welcomeActions: {
    width: isTablet ? 220 : undefined,
    gap: isTablet ? 12 : 8,
  },
  primaryButton: {
    minHeight: isTablet ? 60 : isCompact ? 48 : 54,
    borderRadius: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#FFFFFF',
  },
  primaryText: {
    color: '#111412',
    fontSize: isTablet ? 17 : isCompact ? 14 : 16,
    fontWeight: '600',
    letterSpacing: 0,
  },
  secondaryButton: {
    minHeight: isTablet ? 58 : isCompact ? 48 : 52,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(5,7,6,0.5)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.62)',
  },
  secondaryText: {
    color: '#FFFFFF',
    fontSize: isTablet ? 17 : isCompact ? 14 : 16,
    fontWeight: '600',
    letterSpacing: 0,
  },
  signInButton: {
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  signInText: {
    color: '#FFFFFF',
    fontSize: isTablet ? 16 : isCompact ? 13 : 15,
    lineHeight: 20,
    fontWeight: '500',
  },
  setupSafe: {
    flex: 1,
    width: '100%',
    maxWidth: isTablet ? 720 : undefined,
    alignSelf: 'center',
    paddingHorizontal: isTablet ? 32 : 20,
  },
  linkButton: {
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  setupLinkText: {
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0,
  },
  setupHeader: {
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  iconButton: {
    width: 48,
    height: 48,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  skipHeaderButton: {
    minWidth: 54,
    minHeight: 48,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  skipHeaderText: {
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0,
  },
  progressTrack: {
    flex: 1,
    height: 5,
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressFill: {
    height: 5,
    borderRadius: 3,
  },
  setupCopy: {
    gap: 7,
    paddingTop: isCompact ? 10 : 16,
    paddingBottom: isCompact ? 12 : 18,
  },
  setupKicker: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  setupTitle: {
    fontFamily: trailheadFonts.displaySemibold,
    fontSize: isCompact ? 30 : 34,
    lineHeight: isCompact ? 34 : 38,
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
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    borderRadius: 12,
    borderWidth: 1,
  },
  choiceText: {
    flex: 1,
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '600',
    letterSpacing: 0,
  },
  setupDock: {
    gap: 9,
    paddingTop: 8,
  },
  setupLoading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  setupLoadingText: {
    fontSize: 15,
    lineHeight: 21,
    fontWeight: '600',
  },
  selectionText: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0,
    textAlign: 'center',
  },
  rigForm: {
    gap: 10,
  },
  rigSection: {
    borderRadius: 20,
    borderWidth: 1,
    overflow: 'hidden',
  },
  rigSectionHeader: {
    minHeight: 56,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  rigSectionBody: {
    gap: 12,
    paddingHorizontal: 16,
    paddingBottom: 16,
    borderTopWidth: 1,
    paddingTop: 14,
  },
  rigSectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    letterSpacing: 0,
  },
  pillGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  rigPill: {
    minHeight: 48,
    borderRadius: 12,
    paddingHorizontal: 13,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  rigPillText: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0,
  },
  inputRow: {
    flexDirection: isNarrow ? 'column' : 'row',
    gap: 10,
  },
  inputGroup: {
    flex: isNarrow ? 0 : 1,
    width: isNarrow ? '100%' : undefined,
    gap: 6,
  },
  inputLabel: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  input: {
    minHeight: 48,
    borderRadius: 12,
    paddingHorizontal: 12,
    fontSize: 14,
    fontWeight: '600',
    letterSpacing: 0,
    borderWidth: 1,
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
    fontSize: 15,
    fontWeight: '600',
    letterSpacing: 0,
  },
  toggle: {
    width: 48,
    height: 28,
    borderRadius: 14,
    padding: 3,
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
