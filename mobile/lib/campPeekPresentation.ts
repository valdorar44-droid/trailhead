export type CampPeekPresentationV1 = {
  entityId: string;
  testID: string;
  title: string;
  meta: string;
  siteType: string;
  inventory: string;
  fee: string;
  saved: boolean;
};

type CampPeekPresentationInputV1 = {
  entityId?: unknown;
  testID?: unknown;
  title?: unknown;
  meta?: unknown;
  siteType?: unknown;
  inventory?: unknown;
  fee?: unknown;
  saved?: unknown;
};

function primitiveText(value: unknown, fallback: string): string {
  if (typeof value === 'string') {
    const text = value.replace(/\s+/g, ' ').trim();
    return text || fallback;
  }
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return fallback;
}

function safeTestID(value: unknown): string {
  return primitiveText(value, 'place-sheet-camp-campground')
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120) || 'place-sheet-camp-campground';
}

/**
 * Primitive-only boundary for the immediate campground Peek. Provider and
 * canonical result objects are normalized before they enter the render tree.
 */
export function campPeekPresentationV1(
  input: CampPeekPresentationInputV1,
): CampPeekPresentationV1 {
  return {
    entityId: primitiveText(input.entityId, 'camp:campground'),
    testID: safeTestID(input.testID),
    title: primitiveText(input.title, 'Campground'),
    meta: primitiveText(input.meta, 'Campground'),
    siteType: primitiveText(input.siteType, 'Campground'),
    inventory: primitiveText(input.inventory, 'Not listed'),
    fee: primitiveText(input.fee, 'Not listed'),
    saved: input.saved === true,
  };
}
