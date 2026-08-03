export type ExplorePlaceMapReturnV1 = {
  sheetEntityId: string;
};

export type ExplorePlaceSemanticSourceV1 = {
  category?: string | null;
  kind?: string | null;
};

function cleanExplorePlaceType(value?: string | null) {
  return String(value || '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function captureExplorePlaceMapReturnV1(
  exploreId?: string | null,
): ExplorePlaceMapReturnV1 | null {
  const cleanId = String(exploreId || '').trim();
  return cleanId ? { sheetEntityId: `explore:${cleanId}` } : null;
}

export function explorePlaceMapReturnMatchesV1(
  snapshot: ExplorePlaceMapReturnV1 | null | undefined,
  selectedEntityId?: string | null,
) {
  const cleanSelectedId = String(selectedEntityId || '').trim();
  return Boolean(snapshot?.sheetEntityId && snapshot.sheetEntityId === cleanSelectedId);
}

export function explorePlaceSemanticTypeV1(
  item: ExplorePlaceSemanticSourceV1,
) {
  const semanticLabel = cleanExplorePlaceType(item.category)
    || cleanExplorePlaceType(item.kind)
    || 'place';
  const type = semanticLabel.toLowerCase();
  const displayType = semanticLabel.replace(/\b\w/g, character => character.toUpperCase());
  return { type, displayType };
}
