export type ValhallaManeuverPresentation = {
  type: string;
  modifier: string;
};

// Valhalla TripDirections Maneuver::Type values. Keep these numeric keys aligned
// with the provider enum because instructions alone are not reliably localized.
export const VALHALLA_MANEUVER_PRESENTATIONS: Record<number, ValhallaManeuverPresentation> = {
  0: { type: 'turn', modifier: '' },
  1: { type: 'depart', modifier: '' },
  2: { type: 'depart', modifier: 'right' },
  3: { type: 'depart', modifier: 'left' },
  4: { type: 'arrive', modifier: '' },
  5: { type: 'arrive', modifier: 'right' },
  6: { type: 'arrive', modifier: 'left' },
  7: { type: 'continue', modifier: 'straight' },
  8: { type: 'continue', modifier: 'straight' },
  9: { type: 'turn', modifier: 'slight right' },
  10: { type: 'turn', modifier: 'right' },
  11: { type: 'turn', modifier: 'sharp right' },
  12: { type: 'turn', modifier: 'uturn' },
  13: { type: 'turn', modifier: 'uturn' },
  14: { type: 'turn', modifier: 'sharp left' },
  15: { type: 'turn', modifier: 'left' },
  16: { type: 'turn', modifier: 'slight left' },
  17: { type: 'on ramp', modifier: 'straight' },
  18: { type: 'on ramp', modifier: 'right' },
  19: { type: 'on ramp', modifier: 'left' },
  20: { type: 'off ramp', modifier: 'right' },
  21: { type: 'off ramp', modifier: 'left' },
  22: { type: 'continue', modifier: 'straight' },
  23: { type: 'fork', modifier: 'right' },
  24: { type: 'fork', modifier: 'left' },
  25: { type: 'merge', modifier: 'straight' },
  26: { type: 'roundabout', modifier: '' },
  27: { type: 'exit roundabout', modifier: '' },
  28: { type: 'ferry', modifier: '' },
  29: { type: 'exit ferry', modifier: '' },
  30: { type: 'transit', modifier: '' },
  31: { type: 'transit transfer', modifier: '' },
  32: { type: 'transit remain on', modifier: '' },
  33: { type: 'transit connection', modifier: '' },
  34: { type: 'transit connection transfer', modifier: '' },
  35: { type: 'transit connection destination', modifier: '' },
  36: { type: 'post-transit connection destination', modifier: '' },
  37: { type: 'merge', modifier: 'right' },
  38: { type: 'merge', modifier: 'left' },
  39: { type: 'elevator', modifier: '' },
  40: { type: 'steps', modifier: '' },
  41: { type: 'escalator', modifier: '' },
  42: { type: 'enter building', modifier: '' },
  43: { type: 'exit building', modifier: '' },
};

export function valhallaManeuverPresentation(maneuverType: unknown): ValhallaManeuverPresentation {
  const numericType = Number(maneuverType);
  return Number.isFinite(numericType)
    ? VALHALLA_MANEUVER_PRESENTATIONS[numericType] ?? VALHALLA_MANEUVER_PRESENTATIONS[0]
    : VALHALLA_MANEUVER_PRESENTATIONS[0];
}
