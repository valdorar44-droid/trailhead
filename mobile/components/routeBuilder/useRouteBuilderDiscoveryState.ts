import { useCallback, useMemo, useState } from 'react';
import type { BookableExperience, CampsitePin, ExcursionCandidate, GasStation, OsmPoi } from '@/lib/api';

export type DiscoveryTab = 'camps' | 'gas' | 'poi' | 'excursions' | 'tours';

export type LegSearchContext = {
  from: { lat: number; lng: number; name: string };
  to: { lat: number; lng: number; name: string };
  miles: number;
  center: { lat: number; lng: number };
  targetDay?: number;
  purpose?: 'leg' | 'overnight';
  routeCoords?: [number, number][];
  routeSource?: 'saved' | 'live' | 'straight';
};

export type DiscoveryResults = {
  camps: CampsitePin[];
  gas: GasStation[];
  pois: OsmPoi[];
  excursions: ExcursionCandidate[];
  tours: BookableExperience[];
  summary: string;
};

export type InlineSearchState = {
  day: number;
  tab: DiscoveryTab;
  label: string;
} | null;

export const EMPTY_ROUTE_BUILDER_DISCOVERY_RESULTS: DiscoveryResults = {
  camps: [],
  gas: [],
  pois: [],
  excursions: [],
  tours: [],
  summary: '',
};

type DiscoveryTarget = { lat: number; lng: number };

type RouteBuilderDiscoveryKeyInput = {
  activeDay: number;
  insertTargetDay: number | null;
  tab: DiscoveryTab;
  target: DiscoveryTarget;
  leg: LegSearchContext | null;
};

export function routeBuilderDiscoveryKeyFor({
  activeDay,
  insertTargetDay,
  tab,
  target,
  leg,
}: RouteBuilderDiscoveryKeyInput) {
  if (leg) {
    return [
      `day:${leg.targetDay ?? activeDay}`,
      `tab:${tab}`,
      `from:${leg.from.lat.toFixed(4)},${leg.from.lng.toFixed(4)}`,
      `to:${leg.to.lat.toFixed(4)},${leg.to.lng.toFixed(4)}`,
      `purpose:${leg.purpose ?? 'leg'}`,
    ].join('|');
  }
  return [`day:${insertTargetDay ?? activeDay}`, `tab:${tab}`, `area:${target.lat.toFixed(4)},${target.lng.toFixed(4)}`].join('|');
}

type UseRouteBuilderDiscoveryStateArgs = {
  activeDay: number;
  insertTargetDay: number | null;
};

export default function useRouteBuilderDiscoveryState({
  activeDay,
  insertTargetDay,
}: UseRouteBuilderDiscoveryStateArgs) {
  const [discoverTab, setDiscoverTab] = useState<DiscoveryTab>('camps');
  const [discoverLoading, setDiscoverLoading] = useState(false);
  const [activeDiscoveryKey, setActiveDiscoveryKey] = useState<string | null>(null);
  const [discoveryByKey, setDiscoveryByKey] = useState<Record<string, DiscoveryResults>>({});
  const [inlineSearch, setInlineSearch] = useState<InlineSearchState>(null);

  const activeDiscovery = useMemo(
    () => activeDiscoveryKey
      ? discoveryByKey[activeDiscoveryKey] ?? EMPTY_ROUTE_BUILDER_DISCOVERY_RESULTS
      : EMPTY_ROUTE_BUILDER_DISCOVERY_RESULTS,
    [activeDiscoveryKey, discoveryByKey],
  );

  const discoveryKeyFor = useCallback(
    (tab: DiscoveryTab, target: DiscoveryTarget, leg: LegSearchContext | null) => routeBuilderDiscoveryKeyFor({
      activeDay,
      insertTargetDay,
      tab,
      target,
      leg,
    }),
    [activeDay, insertTargetDay],
  );

  const storeDiscoveryResults = useCallback((key: string, patch: Partial<DiscoveryResults>) => {
    setDiscoveryByKey(prev => ({
      ...prev,
      [key]: { ...(prev[key] ?? EMPTY_ROUTE_BUILDER_DISCOVERY_RESULTS), ...patch },
    }));
  }, []);

  const clearDiscoveryResults = useCallback(() => {
    setActiveDiscoveryKey(null);
    setInlineSearch(null);
  }, []);

  const resetDiscoveryResults = useCallback(() => {
    setActiveDiscoveryKey(null);
    setInlineSearch(null);
    setDiscoveryByKey({});
  }, []);

  return {
    discoverTab,
    setDiscoverTab,
    discoverLoading,
    setDiscoverLoading,
    activeDiscoveryKey,
    setActiveDiscoveryKey,
    activeDiscovery,
    inlineSearch,
    setInlineSearch,
    discoveryKeyFor,
    storeDiscoveryResults,
    clearDiscoveryResults,
    resetDiscoveryResults,
  };
}
