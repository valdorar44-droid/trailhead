import type { TripReadinessTask } from './model';

const OVERLAND_PLANNING_SPEED_MPH = 42;
const DEFAULT_VISIBLE_ROUTE_FIT_CARDS = 5;

export type RouteFitCard = TripReadinessTask;

export type BuildRouteFitCardsInput = {
  readinessTasks: TripReadinessTask[];
  stopCount: number;
  fuelStopCount: number;
  totalMiles: number;
  days: number[];
  restDays: number[];
  maxDriveHoursByDay: Record<number, number | undefined>;
  defaultDriveLimitHours: number;
  fuelRangeMi?: number | null;
  fuelSummaryText: string;
  offlineReady: boolean;
  offlineMessage: string;
  limit?: number;
};

export function buildRouteFitCards({
  readinessTasks,
  stopCount,
  fuelStopCount,
  totalMiles,
  days,
  restDays,
  maxDriveHoursByDay,
  defaultDriveLimitHours,
  fuelRangeMi,
  fuelSummaryText,
  offlineReady,
  offlineMessage,
  limit = DEFAULT_VISIBLE_ROUTE_FIT_CARDS,
}: BuildRouteFitCardsInput): RouteFitCard[] {
  const cards: RouteFitCard[] = [...readinessTasks];

  if (stopCount < 2) {
    cards.push({
      level: 'warn',
      label: 'Need route',
      text: 'Add a start and at least one destination.',
    });
  }

  if (!hasRouteFitLabel(cards, 'Fuel') && fuelStopCount > 0) {
    cards.push({
      level: 'ok',
      label: 'Fuel',
      text: `${fuelStopCount} fuel stop${fuelStopCount === 1 ? '' : 's'} added.`,
    });
  } else if (!hasRouteFitLabel(cards, 'Fuel') && totalMiles > 0) {
    cards.push({
      level: fuelRangeMi && totalMiles > fuelRangeMi * 0.7 ? 'warn' : 'ok',
      label: 'Fuel',
      text: fuelSummaryText,
    });
  }

  const driveCapacityMiles = days
    .filter(day => !restDays.includes(day))
    .reduce((sum, day) => sum + ((maxDriveHoursByDay[day] ?? defaultDriveLimitHours) * OVERLAND_PLANNING_SPEED_MPH), 0);

  if (totalMiles > driveCapacityMiles && stopCount > 1) {
    cards.push({
      level: 'warn',
      label: 'Schedule',
      text: `This route needs more than the selected ${days.length} day${days.length === 1 ? '' : 's'} at the current daily max.`,
    });
  }

  cards.push({
    level: offlineReady ? 'ok' : 'warn',
    label: 'Offline',
    text: offlineMessage,
  });

  return cards.slice(0, limit);
}

function hasRouteFitLabel(cards: RouteFitCard[], label: string) {
  return cards.some(card => card.label === label);
}
