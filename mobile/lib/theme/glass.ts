import { premiumColors } from './colors';
import { radii } from './radii';
import { shadows } from './shadows';

export const glass = {
  panel: {
    borderRadius: radii.xl,
    borderWidth: 1,
    borderColor: premiumColors.border,
    backgroundColor: premiumColors.surfaceGlass,
    ...shadows.glass,
  },
  control: {
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: premiumColors.border,
    backgroundColor: 'rgba(5,5,5,0.42)',
    ...shadows.glow,
  },
};
