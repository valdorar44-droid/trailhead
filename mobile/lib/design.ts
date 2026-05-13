import { Platform } from 'react-native';
import { useStore } from './store';
import { premiumColors, premiumLightColors, spacing, radii } from './theme';

export const DARK_C = {
  bg:         premiumColors.background,
  s1:         premiumColors.surface,
  s2:         premiumColors.surfaceElevated,
  s3:         '#1B1C20',
  s4:         '#23252B',
  border:     premiumColors.border,
  border2:    premiumColors.borderStrong,
  // Orange is now reserved for active navigation, warnings, and selected actions.
  orange:     premiumColors.warningOrange,
  orange2:    '#B86138',
  orangeGlow: 'rgba(217,119,69,0.18)',
  // Premium neutral/technical accents.
  gold:       premiumColors.silver,
  sage:       premiumColors.silver,
  pine:       premiumColors.blueGlow,
  // Status colors
  green:      premiumColors.successGreen,
  green2:     '#21A974',
  yellow:     '#C8B98A',
  red:        premiumColors.danger,
  red2:       '#B93F3F',
  purple:     premiumColors.blueGlow,
  // Text
  text:       premiumColors.textPrimary,
  text2:      premiumColors.textSecondary,
  text3:      premiumColors.textMuted,
  white:      '#ffffff',
  glass:      premiumColors.surfaceGlass,
  glassStrong: premiumColors.surfaceGlassStrong,
  silver:     premiumColors.silver,
  silverBright: premiumColors.silverBright,
  blueGlow:   premiumColors.blueGlow,
};

export const LIGHT_C = {
  bg:         premiumLightColors.background,
  s1:         premiumLightColors.surface,
  s2:         premiumLightColors.surfaceElevated,
  s3:         '#E8EAEE',
  s4:         '#DADDE3',
  border:     premiumLightColors.border,
  border2:    premiumLightColors.borderStrong,
  orange:     premiumLightColors.warningOrange,
  orange2:    '#984F2F',
  orangeGlow: 'rgba(184,94,53,0.12)',
  // Secondary accents
  gold:       premiumLightColors.silver,
  sage:       premiumLightColors.silver,
  pine:       premiumLightColors.blueGlow,
  // Status colors
  green:      premiumLightColors.successGreen,
  green2:     '#087A4C',
  yellow:     '#967B35',
  red:        premiumLightColors.danger,
  red2:       '#991B1B',
  purple:     premiumLightColors.blueGlow,
  // Text
  text:       premiumLightColors.textPrimary,
  text2:      premiumLightColors.textSecondary,
  text3:      premiumLightColors.textMuted,
  white:      '#ffffff',
  glass:      premiumLightColors.surfaceGlass,
  glassStrong: premiumLightColors.surfaceGlassStrong,
  silver:     premiumLightColors.silver,
  silverBright: premiumLightColors.silverBright,
  blueGlow:   premiumLightColors.blueGlow,
};

export type ColorPalette = typeof DARK_C;

export const RADIUS = {
  xs: radii.xs,
  sm: radii.sm,
  md: radii.md,
  lg: radii.lg,
  xl: radii.xl,
};

export const SPACE = {
  xs: spacing.xs,
  sm: spacing.sm,
  md: spacing.md,
  lg: spacing.lg,
  xl: spacing.xl,
};

export const TYPE = {
  labelSpacing: 0.7,
  denseLabelSpacing: 0.4,
};

export function useTheme(): ColorPalette {
  const themeMode = useStore(s => s.themeMode);
  return themeMode === 'light' ? LIGHT_C : DARK_C;
}

// Mono font — Menlo on iOS is cleaner than Courier New
export const mono = Platform.OS === 'ios' ? 'Menlo' : 'monospace';

export const DARK_TAG = {
  '4wd':   { bg: '#3a0a0a', text: '#fca5a5', border: '#6b1d1d' },
  'dirt':  { bg: '#3a1407', text: '#fdba74', border: '#7a3508' },
  'blm':   { bg: '#1c1917', text: '#c4b9a8', border: '#3a3430' },
  'usfs':  { bg: '#0b2010', text: '#86c894', border: '#1a4a22' },
  'nps':   { bg: '#0e1e3a', text: '#93c5fd', border: '#1a3a6a' },
  'mixed': { bg: '#253026', text: '#8a9285', border: '#2a3a2b' },
  'paved': { bg: '#0b2010', text: '#86c894', border: '#1a4a22' },
};

export const LIGHT_TAG = {
  '4wd':   { bg: '#fee2e2', text: '#991b1b', border: '#fca5a5' },
  'dirt':  { bg: '#ffedd5', text: '#9a3412', border: '#fdba74' },
  'blm':   { bg: '#f5f5f4', text: '#57534e', border: '#a8a29e' },
  'usfs':  { bg: '#dcfce7', text: '#166534', border: '#86efac' },
  'nps':   { bg: '#dbeafe', text: '#1e40af', border: '#93c5fd' },
  'mixed': { bg: '#f1f5f9', text: '#475569', border: '#cbd5e1' },
  'paved': { bg: '#dcfce7', text: '#166534', border: '#86efac' },
};

export function useTag() {
  const themeMode = useStore(s => s.themeMode);
  return themeMode === 'dark' ? DARK_TAG : LIGHT_TAG;
}

// Keep legacy export for screens that import it directly
export const tag = DARK_TAG;
export const C: ColorPalette = DARK_C;
