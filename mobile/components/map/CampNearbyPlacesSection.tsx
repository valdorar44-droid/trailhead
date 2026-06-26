import React, { type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import NearbyContextModule from '@/components/map/NearbyContextModule';

type CampNearbyPlacesRail = {
  title: string;
  cards: ReactNode[];
};

type Props = {
  title?: string;
  loading: boolean;
  sourceLabel?: string | null;
  emptyMessage: string;
  emptyActionLabel: string;
  rails: CampNearbyPlacesRail[];
  onRetry: () => void;
};

export default function CampNearbyPlacesSection({
  title = 'NEARBY PLACES',
  loading,
  sourceLabel,
  emptyMessage,
  emptyActionLabel,
  rails,
  onRetry,
}: Props) {
  const hasContent = rails.some(rail => rail.cards.length > 0);

  return (
    <View style={s.block}>
      <NearbyContextModule
        title={title.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, c => c.toUpperCase())}
        subtitle={sourceLabel || (hasContent ? 'Useful stops close to this place' : null)}
        loading={loading}
        sourceLabel={sourceLabel}
        emptyMessage={emptyMessage}
        emptyActionLabel={emptyActionLabel}
        onRetry={onRetry}
        groups={rails.map(rail => ({
          key: rail.title,
          title: rail.title.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, c => c.toUpperCase()),
          items: rail.cards.map((card, idx) => ({
            id: `${rail.title}-${idx}`,
            title: rail.title,
            node: card,
          })),
        }))}
      />
    </View>
  );
}

const s = StyleSheet.create({
  block: {
    gap: 8,
    marginTop: 4,
    marginBottom: 2,
  },
});
