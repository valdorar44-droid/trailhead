export type NpsHubNodeInput = {
  id: string;
  label: string;
  kind: 'group' | 'place';
  children?: NpsHubNodeInput[];
  lat?: number | null;
  lng?: number | null;
};

export type NpsHubModuleInput = {
  key: string;
  label: string;
  parkSpecific?: boolean;
  items: NpsHubNodeInput[];
};

export type NpsHubInput = {
  parkId: string;
  parkTitle: string;
  modules: NpsHubModuleInput[];
};

export type NpsHubNode = NpsHubNodeInput & {
  children?: NpsHubNode[];
};

export type NpsHubModule = Omit<NpsHubModuleInput, 'items'> & {
  items: NpsHubNode[];
};

export type NpsHubModelV1 = {
  schemaVersion: 1;
  parkId: string;
  parkTitle: string;
  modules: NpsHubModule[];
};

export type NpsHubPathSegmentV1 = {
  groupId: string;
  label: string;
};

export type NpsHubReturnContextV1 = {
  schemaVersion: 1;
  surface: 'explore_nps_hub';
  parkId: string;
  parkTitle: string;
  moduleKey: string;
  moduleLabel: string;
  path: NpsHubPathSegmentV1[];
  listKey: string;
  listTitle: string;
  selectedIndex: number;
  listCount: number;
  canonicalChildId: string;
};

export type NpsHubMainMapHandoffV1 = {
  schemaVersion: 1;
  kind: 'place';
  place: {
    id: string;
    name: string;
    lat: number;
    lng: number;
  };
  returnContext: NpsHubReturnContextV1;
};

export type NpsHubLevelV1 = {
  module: NpsHubModule;
  path: NpsHubPathSegmentV1[];
  items: NpsHubNode[];
  listKey: string;
  listTitle: string;
};

export type NpsHubSelectionV1 = {
  moduleKey: string;
  path: string[];
  canonicalChildId: string;
  listIndex: number;
};

/**
 * Test-only preservation contract. It normalizes only verified fixture depth.
 * Empty modules and empty group branches are omitted, never fabricated.
 */
export function buildNpsHubModel(input: NpsHubInput): NpsHubModelV1 {
  const parkId = requiredText(input.parkId, 'park ID');
  const parkTitle = requiredText(input.parkTitle, 'park title');
  const seenIds = new Set<string>();
  const modules: NpsHubModule[] = [];
  for (const sourceModule of input.modules) {
    const key = requiredText(sourceModule.key, 'module key');
    const label = requiredText(sourceModule.label, `module ${key} label`);
    const items = sourceModule.items
      .map(node => normalizeNode(node, seenIds))
      .filter((node): node is NpsHubNode => Boolean(node));
    if (!items.length) continue;
    modules.push({
      key,
      label,
      parkSpecific: Boolean(sourceModule.parkSpecific),
      items,
    });
  }
  return { schemaVersion: 1, parkId, parkTitle, modules };
}

export function npsHubGroupingDepth(module: NpsHubModule): number {
  return module.items.reduce((depth, node) => Math.max(depth, nodeGroupingDepth(node)), 0);
}

export function resolveNpsHubLevel(
  model: NpsHubModelV1,
  moduleKey: string,
  groupPath: string[],
): NpsHubLevelV1 {
  const module = model.modules.find(candidate => candidate.key === moduleKey);
  if (!module) throw new Error(`Unknown NPS hub module: ${moduleKey}`);
  let items = module.items;
  const path: NpsHubPathSegmentV1[] = [];
  for (const groupId of groupPath) {
    const group = items.find(candidate => candidate.id === groupId);
    if (!group || group.kind !== 'group' || !group.children?.length) {
      throw new Error(`Unknown NPS hub group path: ${[...path.map(item => item.groupId), groupId].join('/')}`);
    }
    path.push({ groupId: group.id, label: group.label });
    items = group.children;
  }
  const listKey = [model.parkId, module.key, ...path.map(item => item.groupId)].join(':');
  return {
    module,
    path,
    items,
    listKey,
    listTitle: path[path.length - 1]?.label || module.label,
  };
}

export function createNpsHubMainMapHandoff(
  model: NpsHubModelV1,
  selection: NpsHubSelectionV1,
): NpsHubMainMapHandoffV1 {
  const level = resolveNpsHubLevel(model, selection.moduleKey, selection.path);
  const child = level.items[selection.listIndex];
  if (!child || child.kind !== 'place' || child.id !== selection.canonicalChildId) {
    throw new Error('NPS hub list selection is stale or does not identify a canonical place');
  }
  const lat = Number(child.lat);
  const lng = Number(child.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    throw new Error(`NPS hub child ${child.id} cannot open on the main map without coordinates`);
  }
  return {
    schemaVersion: 1,
    kind: 'place',
    place: {
      id: child.id,
      name: child.label,
      lat,
      lng,
    },
    returnContext: {
      schemaVersion: 1,
      surface: 'explore_nps_hub',
      parkId: model.parkId,
      parkTitle: model.parkTitle,
      moduleKey: level.module.key,
      moduleLabel: level.module.label,
      path: level.path,
      listKey: level.listKey,
      listTitle: level.listTitle,
      selectedIndex: selection.listIndex,
      listCount: level.items.length,
      canonicalChildId: child.id,
    },
  };
}

export function restoreNpsHubListFromMap(
  model: NpsHubModelV1,
  context: NpsHubReturnContextV1,
): NpsHubLevelV1 & { selectedIndex: number; selected: NpsHubNode } {
  if (context.schemaVersion !== 1 || context.surface !== 'explore_nps_hub' || context.parkId !== model.parkId) {
    throw new Error('NPS hub return context does not belong to this park');
  }
  const level = resolveNpsHubLevel(model, context.moduleKey, context.path.map(item => item.groupId));
  const selected = level.items[context.selectedIndex];
  if (
    level.listKey !== context.listKey
    || level.items.length !== context.listCount
    || !selected
    || selected.kind !== 'place'
    || selected.id !== context.canonicalChildId
  ) {
    throw new Error('NPS hub return context is stale');
  }
  return { ...level, selectedIndex: context.selectedIndex, selected };
}

function normalizeNode(node: NpsHubNodeInput, seenIds: Set<string>): NpsHubNode | null {
  const id = requiredText(node.id, 'canonical child/group ID');
  const label = requiredText(node.label, `NPS hub node ${id} label`);
  if (seenIds.has(id)) throw new Error(`Duplicate NPS hub canonical ID: ${id}`);
  seenIds.add(id);
  if (node.kind === 'group') {
    const children = (node.children ?? [])
      .map(child => normalizeNode(child, seenIds))
      .filter((child): child is NpsHubNode => Boolean(child));
    if (!children.length) return null;
    return { id, label, kind: 'group', children };
  }
  if (node.children?.length) throw new Error(`NPS hub place ${id} cannot contain child groups`);
  return {
    id,
    label,
    kind: 'place',
    lat: node.lat,
    lng: node.lng,
  };
}

function nodeGroupingDepth(node: NpsHubNode): number {
  if (node.kind === 'place') return 0;
  return 1 + (node.children ?? []).reduce((depth, child) => Math.max(depth, nodeGroupingDepth(child)), 0);
}

function requiredText(value: unknown, label: string) {
  const text = String(value || '').trim();
  if (!text) throw new Error(`NPS hub ${label} is required`);
  return text;
}
