/**
 * Trailhead UI V2 foundations.
 *
 * These values mirror the `Trailhead V2` Figma variable collections. Keep
 * this module dependency-free so design-token and accessibility checks can
 * run in Node without loading React Native.
 */

export type UiV2ColorMode = 'light' | 'dark';

export interface UiV2SemanticColors {
  canvas: string;
  surface: string;
  surfaceRaised: string;
  surfaceMuted: string;
  surfacePressed: string;
  overlay: string;
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  textOnAccent: string;
  border: string;
  borderStrong: string;
  accentText: string;
  accentFill: string;
  accentSoft: string;
  focusRing: string;
  statusPositiveText: string;
  statusPositiveSurface: string;
  warningText: string;
  warningSurface: string;
  warningBorder: string;
  errorText: string;
  errorSurface: string;
  errorBorder: string;
  scrim: string;
  skeleton: string;
}

export const uiV2Primitives = Object.freeze({
  warmWhite: '#F7F8F6',
  white: '#FFFFFF',
  nearBlack: '#111412',
  darkCanvas: '#0C0E0D',
  darkSurface: '#141715',
  darkRaised: '#1B1F1C',
  neutral900: '#242925',
  neutral700: '#4F5752',
  neutral600: '#69726C',
  neutral500: '#828B86',
  neutral300: '#C8CEC9',
  neutral200: '#DEE2DF',
  neutral100: '#ECEFEC',
  orangeText: '#984F2F',
  orangeFill: '#AD5A33',
  orangeSoft: '#F5E9E2',
  orangeDarkSoft: '#382219',
  amber800: '#785400',
  amber300: '#E7BD62',
  amber100: '#FFF4D6',
  amberDark: '#2E260F',
  red800: '#A4261C',
  red300: '#E49A94',
  red100: '#FDE9E7',
  redDark: '#351816',
});

export const uiV2LightColors: Readonly<UiV2SemanticColors> = Object.freeze({
  canvas: uiV2Primitives.warmWhite,
  surface: uiV2Primitives.white,
  surfaceRaised: uiV2Primitives.white,
  surfaceMuted: '#F0F2EF',
  surfacePressed: '#E8EBE8',
  overlay: 'rgba(255,255,255,0.94)',
  textPrimary: uiV2Primitives.nearBlack,
  textSecondary: uiV2Primitives.neutral700,
  textMuted: uiV2Primitives.neutral600,
  textOnAccent: uiV2Primitives.white,
  border: uiV2Primitives.neutral200,
  borderStrong: uiV2Primitives.neutral300,
  accentText: uiV2Primitives.orangeText,
  accentFill: uiV2Primitives.orangeFill,
  accentSoft: uiV2Primitives.orangeSoft,
  focusRing: uiV2Primitives.orangeText,
  // V2 deliberately uses orange/neutral confirmation, never decorative green.
  statusPositiveText: uiV2Primitives.orangeText,
  statusPositiveSurface: uiV2Primitives.orangeSoft,
  warningText: uiV2Primitives.amber800,
  warningSurface: uiV2Primitives.amber100,
  warningBorder: '#D7A942',
  errorText: uiV2Primitives.red800,
  errorSurface: uiV2Primitives.red100,
  errorBorder: '#D97870',
  scrim: 'rgba(17,20,18,0.46)',
  skeleton: '#E5E8E5',
});

export const uiV2DarkColors: Readonly<UiV2SemanticColors> = Object.freeze({
  canvas: uiV2Primitives.darkCanvas,
  surface: uiV2Primitives.darkSurface,
  surfaceRaised: uiV2Primitives.darkRaised,
  surfaceMuted: '#202521',
  surfacePressed: '#292F2A',
  overlay: 'rgba(20,23,21,0.96)',
  textPrimary: uiV2Primitives.warmWhite,
  textSecondary: '#C4CAC5',
  textMuted: '#A4ADA6',
  textOnAccent: uiV2Primitives.white,
  border: '#343A35',
  borderStrong: '#4B534D',
  accentText: '#E4A17F',
  accentFill: uiV2Primitives.orangeFill,
  accentSoft: uiV2Primitives.orangeDarkSoft,
  focusRing: '#E4A17F',
  statusPositiveText: '#E4A17F',
  statusPositiveSurface: uiV2Primitives.orangeDarkSoft,
  warningText: uiV2Primitives.amber300,
  warningSurface: uiV2Primitives.amberDark,
  warningBorder: '#806A2B',
  errorText: uiV2Primitives.red300,
  errorSurface: uiV2Primitives.redDark,
  errorBorder: '#8E4B46',
  scrim: 'rgba(0,0,0,0.66)',
  skeleton: '#252A26',
});

export function resolveUiV2Colors(mode: UiV2ColorMode): Readonly<UiV2SemanticColors> {
  return mode === 'dark' ? uiV2DarkColors : uiV2LightColors;
}

export const uiV2Layout = Object.freeze({
  spacing: Object.freeze({
    none: 0,
    xxs: 2,
    xs: 4,
    sm: 8,
    md: 12,
    lg: 16,
    xl: 24,
    xxl: 32,
    xxxl: 48,
  }),
  radius: Object.freeze({
    xs: 6,
    sm: 10,
    md: 14,
    lg: 18,
    xl: 24,
    sheet: 28,
    pill: 999,
  }),
  control: Object.freeze({
    minimumTarget: 44,
    medium: 48,
    large: 56,
    search: 52,
  }),
  content: Object.freeze({
    screenGutter: 16,
    screenGutterWide: 24,
    cardGap: 12,
    sheetGutter: 20,
    maxReadableWidth: 680,
  }),
  borderWidth: Object.freeze({
    hairline: 1,
    focus: 2,
  }),
});

export const uiV2Typography = Object.freeze({
  display: Object.freeze({ fontSize: 36, lineHeight: 42, fontWeight: '800' as const, letterSpacing: -0.7 }),
  pageTitle: Object.freeze({ fontSize: 28, lineHeight: 34, fontWeight: '800' as const, letterSpacing: -0.35 }),
  sheetTitle: Object.freeze({ fontSize: 24, lineHeight: 30, fontWeight: '800' as const, letterSpacing: -0.2 }),
  sectionTitle: Object.freeze({ fontSize: 18, lineHeight: 24, fontWeight: '700' as const, letterSpacing: -0.1 }),
  cardTitle: Object.freeze({ fontSize: 16, lineHeight: 21, fontWeight: '700' as const, letterSpacing: 0 }),
  body: Object.freeze({ fontSize: 16, lineHeight: 24, fontWeight: '400' as const, letterSpacing: 0 }),
  bodyMedium: Object.freeze({ fontSize: 16, lineHeight: 24, fontWeight: '600' as const, letterSpacing: 0 }),
  support: Object.freeze({ fontSize: 14, lineHeight: 20, fontWeight: '400' as const, letterSpacing: 0 }),
  supportMedium: Object.freeze({ fontSize: 14, lineHeight: 20, fontWeight: '600' as const, letterSpacing: 0 }),
  label: Object.freeze({ fontSize: 13, lineHeight: 18, fontWeight: '700' as const, letterSpacing: 0.2 }),
  meta: Object.freeze({ fontSize: 12, lineHeight: 17, fontWeight: '500' as const, letterSpacing: 0.15 }),
  micro: Object.freeze({ fontSize: 11, lineHeight: 15, fontWeight: '700' as const, letterSpacing: 0.45 }),
  technical: Object.freeze({ fontSize: 12, lineHeight: 17, fontWeight: '500' as const, letterSpacing: 0 }),
});

export const uiV2Motion = Object.freeze({
  immediate: 0,
  fast: 120,
  standard: 200,
  deliberate: 280,
});
