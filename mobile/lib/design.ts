import { Platform } from 'react-native';
import { useStore } from './store';

export const DARK_C = {
  bg:         '#060d07',
  s1:         '#0d1a0e',
  s2:         '#152016',
  s3:         '#1c2b1d',
  s4:         '#253026',
  border:     '#2a3a2b',
  border2:    '#1a2519',
  // Primary accent — burnt rust
  orange:     '#b85c38',
  orange2:    '#9c4a28',
  orangeGlow: 'rgba(184,92,56,0.18)',
  // Secondary accents
  gold:       '#c8953a',
  sage:       '#7aaa7c',
  pine:       '#4d8c5f',
  // Status colors
  green:      '#3dbd6d',
  green2:     '#16a34a',
  yellow:     '#d4a017',
  red:        '#ef4444',
  red2:       '#b91c1c',
  purple:     '#a855f7',
  // Text
  text:       '#e4ddd2',
  text2:      '#8a9285',
  text3:      '#4a5a4c',
  white:      '#ffffff',
};

export const LIGHT_C = {
  bg:         '#f4f0eb',
  s1:         '#ede8e2',
  s2:         '#e5dfd7',
  s3:         '#dbd3c8',
  s4:         '#cfc6b8',
  border:     '#c4b9a8',
  border2:    '#b8ac9a',
  // Primary accent — burnt rust (same brand color both themes)
  orange:     '#b85c38',
  orange2:    '#9c4a28',
  orangeGlow: 'rgba(184,92,56,0.12)',
  // Secondary accents
  gold:       '#c8953a',
  sage:       '#5a8a5c',
  pine:       '#3d6e4f',
  // Status colors
  green:      '#16a34a',
  green2:     '#15803d',
  yellow:     '#b45309',
  red:        '#dc2626',
  red2:       '#b91c1c',
  purple:     '#7c3aed',
  // Text
  text:       '#1a1208',
  text2:      '#5a4e3e',
  text3:      '#8a7a68',
  white:      '#ffffff',
};

export type ColorPalette = typeof DARK_C;

export function useTheme(): ColorPalette {
  const themeMode = useStore(s => s.themeMode);
  return themeMode === 'dark' ? DARK_C : LIGHT_C;
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
