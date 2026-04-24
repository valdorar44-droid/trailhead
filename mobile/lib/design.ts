import { Platform } from 'react-native';
import { useStore } from './store';

export const DARK_C = {
  bg:      '#080c12',
  s1:      '#0f1319',
  s2:      '#161c27',
  s3:      '#1e2535',
  border:  '#252d3d',
  border2: '#1a2030',
  orange:  '#f97316',
  orange2: '#ea580c',
  orangeGlow: 'rgba(249,115,22,0.18)',
  green:   '#22c55e',
  green2:  '#16a34a',
  yellow:  '#eab308',
  red:     '#ef4444',
  red2:    '#b91c1c',
  purple:  '#a855f7',
  text:    '#f1f5f9',
  text2:   '#94a3b8',
  text3:   '#4b5563',
  white:   '#ffffff',
};

export const LIGHT_C = {
  bg:      '#f8fafc',
  s1:      '#f1f5f9',
  s2:      '#e8edf5',
  s3:      '#dde3ed',
  border:  '#c8d3e0',
  border2: '#b8c5d6',
  orange:  '#f97316',
  orange2: '#ea580c',
  orangeGlow: 'rgba(249,115,22,0.12)',
  green:   '#16a34a',
  green2:  '#15803d',
  yellow:  '#ca8a04',
  red:     '#dc2626',
  red2:    '#b91c1c',
  purple:  '#7c3aed',
  text:    '#0f172a',
  text2:   '#475569',
  text3:   '#94a3b8',
  white:   '#ffffff',
};

export type ColorPalette = typeof DARK_C;

// Default to LIGHT for outdoor readability — components should use useTheme()
export const C: ColorPalette = LIGHT_C;

export function useTheme(): ColorPalette {
  const themeMode = useStore(s => s.themeMode);
  return themeMode === 'dark' ? DARK_C : LIGHT_C;
}

export const mono = Platform.OS === 'ios' ? 'Courier New' : 'monospace';

export const DARK_TAG = {
  '4wd':   { bg: '#450a0a', text: '#fca5a5', border: '#7f1d1d' },
  'dirt':  { bg: '#431407', text: '#fdba74', border: '#92400e' },
  'blm':   { bg: '#1c1917', text: '#d6d3d1', border: '#44403c' },
  'usfs':  { bg: '#052e16', text: '#86efac', border: '#166534' },
  'nps':   { bg: '#172554', text: '#93c5fd', border: '#1d4ed8' },
  'mixed': { bg: '#1e2535', text: '#94a3b8', border: '#252d3d' },
  'paved': { bg: '#052e16', text: '#86efac', border: '#166534' },
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

export const tag = DARK_TAG;

export function useTag() {
  const themeMode = useStore(s => s.themeMode);
  return themeMode === 'dark' ? DARK_TAG : LIGHT_TAG;
}
