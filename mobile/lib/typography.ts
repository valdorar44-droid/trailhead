import { useFonts } from 'expo-font';

export const trailheadFonts = {
  displaySemibold: 'BarlowCondensed_600SemiBold',
  displayBold: 'BarlowCondensed_700Bold',
} as const;

export function useTrailheadFonts() {
  return useFonts({
    [trailheadFonts.displaySemibold]: require('../assets/fonts/BarlowCondensed-SemiBold.ttf'),
    [trailheadFonts.displayBold]: require('../assets/fonts/BarlowCondensed-Bold.ttf'),
  });
}
