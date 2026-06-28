import type { ReactNode } from 'react';
import RouteBuilderActiveDayStop from '@/components/routeBuilder/RouteBuilderActiveDayStop';
import RouteBuilderLegActions from '@/components/routeBuilder/RouteBuilderLegActions';

export type RouteBuilderActiveDayListStop = {
  id: string;
  name: string;
  lat: number;
  lng: number;
  type: string;
  source?: string;
  day?: number;
  camp?: unknown | null;
};

type RouteBuilderActiveDayStopListProps<TStop extends RouteBuilderActiveDayListStop> = {
  stops: TStop[];
  insertAfterId: string | null;
  stopColor: (type: TStop['type']) => string;
  stopLabel: (stop: TStop) => string;
  sourceLabel: (source?: TStop['source']) => string;
  renderStopPreview: (stop: TStop) => ReactNode;
  measureLeg: (from: TStop, to: TStop) => number;
  distanceLabel: (miles: number) => string;
  durationLabel: (miles: number) => string;
  fuelLabel: (miles: number) => string;
  onSelectStop: (stop: TStop) => void;
  onOpenCampDetail: (stop: TStop) => void;
  onReplaceCamp: (stop: TStop) => void;
  onMoveStop: (id: string, direction: -1 | 1) => void;
  onRemoveStop: (id: string) => void;
  onFindFuel: (from: TStop, to: TStop) => void;
  onFindCamp: (from: TStop, to: TStop) => void;
  onFindPlaces: (from: TStop, to: TStop) => void;
  onFindTours: (from: TStop, to: TStop) => void;
};

export default function RouteBuilderActiveDayStopList<TStop extends RouteBuilderActiveDayListStop>({
  stops,
  insertAfterId,
  stopColor,
  stopLabel,
  sourceLabel,
  renderStopPreview,
  measureLeg,
  distanceLabel,
  durationLabel,
  fuelLabel,
  onSelectStop,
  onOpenCampDetail,
  onReplaceCamp,
  onMoveStop,
  onRemoveStop,
  onFindFuel,
  onFindCamp,
  onFindPlaces,
  onFindTours,
}: RouteBuilderActiveDayStopListProps<TStop>) {
  return (
    <>
      {stops.map((stop, index) => {
        const next = stops[index + 1] ?? null;
        const legMiles = next ? measureLeg(stop, next) : 0;
        return (
          <RouteBuilderActiveDayStop
            key={stop.id}
            index={index}
            name={stop.name}
            meta={`${stopLabel(stop)} · ${sourceLabel(stop.source)}${insertAfterId === stop.id ? ' · INSERT AFTER' : ''}`}
            color={stopColor(stop.type)}
            selected={insertAfterId === stop.id}
            preview={renderStopPreview(stop)}
            onSelect={() => onSelectStop(stop)}
            onOpenCampDetail={stop.camp ? () => onOpenCampDetail(stop) : undefined}
            onReplaceCamp={stop.type === 'camp' ? () => onReplaceCamp(stop) : undefined}
            onMoveUp={() => onMoveStop(stop.id, -1)}
            onMoveDown={() => onMoveStop(stop.id, 1)}
            onRemove={() => onRemoveStop(stop.id)}
            leg={next ? (
              <RouteBuilderLegActions
                distanceLabel={distanceLabel(legMiles)}
                durationLabel={durationLabel(legMiles)}
                fuelLabel={fuelLabel(legMiles)}
                nextStopName={next.name}
                onFindFuel={() => onFindFuel(stop, next)}
                onFindCamp={() => onFindCamp(stop, next)}
                onFindPlaces={() => onFindPlaces(stop, next)}
                onFindTours={() => onFindTours(stop, next)}
              />
            ) : undefined}
          />
        );
      })}
    </>
  );
}
