#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const failures = [];

function source(path) {
  return readFileSync(join(root, path), 'utf8');
}

function assert(condition, message) {
  if (!condition) failures.push(message);
}

const layout = source('app/(tabs)/_layout.tsx');
const tabBar = source('components/trips/TripsTabBar.tsx');
const switcher = source('components/plan/PlanWorkspaceSwitcher.tsx');
const plan = source('app/(tabs)/plan.tsx');
const routeBuilder = source('app/(tabs)/route-builder.tsx');
const trips = source('app/(tabs)/trips.tsx');
const guide = source('app/(tabs)/guide.tsx');
const profile = source('app/(tabs)/profile.tsx');

assert(
  tabBar.includes("const VISIBLE_ROUTE_NAMES = ['guide', 'plan', 'map', 'report', 'profile'] as const"),
  'bottom navigation keeps Explore, Plan, Map, Reports, and Profile in order',
);
assert(tabBar.includes("const PLAN_CHILD_ROUTES = new Set(['route-builder', 'trips'])"),
  'Manual and Trips keep Plan selected in bottom navigation');
assert(layout.includes('name="report"') && layout.includes("title: 'Reports'"),
  'Reports remains a visible first-class tab');
assert(layout.includes('name="route-builder"') && layout.includes('name="trips"') && layout.match(/href: null/g)?.length >= 3,
  'Manual and Trips remain hidden child routes rather than duplicate bottom tabs');

for (const label of ['Assisted', 'Manual', 'Trips']) {
  assert(switcher.includes(`label: '${label}'`), `Plan workspace includes ${label}`);
}
assert(switcher.includes('onSelect?:') && switcher.includes('if (onSelect) onSelect('),
  'Manual can guard workspace changes before navigation');
assert(plan.includes('<PlanWorkspaceSwitcher active="assisted"'),
  'Assisted planning exposes the workspace switcher');
assert(routeBuilder.includes('Save & switch') && routeBuilder.includes('Discard & switch'),
  'Manual protects unfinished routes when switching workspaces');

assert(trips.includes("intent: 'new'") && profile.includes("intent: 'new'"),
  'new-route actions explicitly open a fresh Manual builder flow');
assert(guide.includes("intent: 'edit-active'"),
  'seeded Explore trips explicitly open the active trip in Manual');
assert(routeBuilder.includes("routeBuilderIntent === 'edit-active'") && routeBuilder.includes("routeBuilderIntent !== 'new'"),
  'Route Builder consumes edit-active and new navigation intents');
assert(!trips.includes('tripsEnabled'),
  'Trips local workspace is not hidden behind the former bottom-tab flag');
assert(trips.indexOf('<PlanWorkspaceSwitcher active="trips"') < trips.indexOf('<ScrollView'),
  'Trips keeps the workspace switcher visible above scrolling content');

if (failures.length) {
  console.error('Plan workspace regression audit failed:');
  failures.forEach(failure => console.error(`- ${failure}`));
  process.exit(1);
}

console.log('Plan workspace regression audit passed.');
