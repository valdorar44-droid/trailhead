import { Platform } from 'react-native';

export const C = {
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

export const mono = Platform.OS === 'ios' ? 'Courier New' : 'monospace';

export const tag = {
  '4wd':   { bg: '#450a0a', text: '#fca5a5', border: '#7f1d1d' },
  'dirt':  { bg: '#431407', text: '#fdba74', border: '#92400e' },
  'blm':   { bg: '#1c1917', text: '#d6d3d1', border: '#44403c' },
  'usfs':  { bg: '#052e16', text: '#86efac', border: '#166534' },
  'nps':   { bg: '#172554', text: '#93c5fd', border: '#1d4ed8' },
  'mixed': { bg: '#1e2535', text: '#94a3b8', border: '#252d3d' },
  'paved': { bg: '#052e16', text: '#86efac', border: '#166534' },
};
