import { Platform } from 'react-native';

export const font = {
  display: Platform.OS === 'ios' ? 'System' : 'sans-serif',
  body: Platform.OS === 'ios' ? 'System' : 'sans-serif',
  mono: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
};

export const typography = {
  hero: { fontSize: 34, lineHeight: 39, fontWeight: '800' as const },
  title: { fontSize: 24, lineHeight: 30, fontWeight: '750' as const },
  section: { fontSize: 18, lineHeight: 24, fontWeight: '700' as const },
  body: { fontSize: 15, lineHeight: 22, fontWeight: '400' as const },
  meta: { fontSize: 12, lineHeight: 17, fontWeight: '400' as const },
  micro: { fontSize: 10, lineHeight: 13, fontWeight: '600' as const },
};
