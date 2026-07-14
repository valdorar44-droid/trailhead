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
  'Route Builder and Trips keep Plan selected in bottom navigation');
assert(layout.includes('name="report"') && layout.includes("title: 'Reports'"),
  'Reports remains a visible first-class tab');
assert(layout.includes('name="route-builder"') && layout.includes('name="trips"') && layout.match(/href: null/g)?.length >= 3,
  'Route Builder and Trips remain hidden child routes rather than duplicate bottom tabs');

for (const label of ['Trip Planner', 'Route Builder', 'Trips']) {
  assert(switcher.includes(`label: '${label}'`), `Plan workspace includes ${label}`);
}
assert(switcher.includes('onSelect?:') && switcher.includes('if (onSelect) onSelect('),
  'Route Builder can guard workspace changes before navigation');
assert(switcher.includes('styles.activeIndicator') && switcher.includes('borderBottomWidth: 1'),
  'Plan navigation uses flat underlined tabs');
assert(!switcher.includes("from '@expo/vector-icons'"),
  'Plan navigation does not use decorative workspace icons');
assert(plan.includes('<PlanWorkspaceSwitcher active="assisted"'),
  'Trip Planner exposes the Plan navigation');
assert(
  routeBuilder.includes("setPendingRouteExit({ kind: 'workspace', href })")
    && routeBuilder.includes('savePendingRouteChanges')
    && routeBuilder.includes('Discard changes'),
  'Route Builder protects unfinished routes when switching Plan destinations',
);
assert(routeBuilder.includes("useState<RouteTabMode>('wizard')"),
  'Route Builder opens on the approved five-step setup');
assert(routeBuilder.includes("if (routeBuilderIntent !== 'edit-active'")
    && routeBuilder.includes('importedTripId === activeTrip.trip_id'),
  'Route Builder imports the active trip only for an explicit edit request');
assert(!routeBuilder.includes("setRouteTabMode('hub')") && !routeBuilder.includes("if (routeTabMode === 'hub')"),
  'Route Builder never returns to the retired hub');
assert(
  routeBuilder.includes('setTabBarHidden(buildingFramework || stops.length >= 2 || keyboardVisible)')
    && routeBuilder.includes('const dockMarginBottom = keyboardVisible ? 10 + bottomInset : 94 + bottomInset'),
  'Route Builder keeps setup controls clear of global tabs and hides them during the full-screen route scan',
);
assert(!routeBuilder.includes('opacity: wizardFade') && !routeBuilder.includes('translateY: wizardSlide'),
  'Route Builder setup cannot remain dimmed by an interrupted entrance animation');
assert(
  routeBuilder.includes('const routeSetupIsPristine = !hasBaseRoute')
    && routeBuilder.match(/if \(routeSetupIsPristine\)/g)?.length >= 2,
  'Route Builder bypasses leave confirmation for untouched setup',
);

for (const copy of ['Where are you headed?', 'City, park, or trailhead', 'Saved places', 'Recent']) {
  assert(plan.includes(copy), `Trip Planner includes ${copy}`);
}
for (const removedCopy of ['Assisted planning', 'Tell Trailhead', 'WORKING ON IT', '>PLANNER<']) {
  assert(!plan.includes(removedCopy), `Trip Planner removes ${removedCopy}`);
}
assert(plan.includes('{messages.length > 0 && ('),
  'Trip Planner keeps the conversation composer off the destination-first welcome view');

assert(profile.includes("intent: 'new'"),
  'Profile new-route actions explicitly open a fresh Route Builder flow');
assert(guide.includes("intent: 'edit-active'"),
  'seeded Explore trips explicitly open the active trip in Route Builder');
assert(routeBuilder.includes("routeBuilderIntent === 'edit-active'") && routeBuilder.includes("routeBuilderIntent !== 'new'"),
  'Route Builder consumes edit-active and new navigation intents');
const cleanNewRoute = routeBuilder.match(/function beginCleanNewRoute\(\) \{([\s\S]*?)\n  \}/)?.[1] ?? '';
const startNewRoute = routeBuilder.match(/function startNewRoute\(\) \{([\s\S]*?)\n  \}/)?.[1] ?? '';
assert(
  cleanNewRoute.includes('resetRouteDraft()')
    && !cleanNewRoute.includes('setActiveTrip(null)')
    && startNewRoute.includes('beginCleanNewRoute()')
    && !startNewRoute.includes('setShowNewRouteConfirm'),
  'New-route intent opens a clean setup without clearing the current active trip',
);
assert(!trips.includes('tripsEnabled'),
  'Trips local workspace is not hidden behind the former bottom-tab flag');
assert(trips.includes('<PlanWorkspaceSwitcher active="trips"'),
  'Trips includes the shared Plan navigation');

if (failures.length) {
  console.error('Plan workspace regression audit failed:');
  failures.forEach(failure => console.error(`- ${failure}`));
  process.exit(1);
}

console.log('Plan workspace regression audit passed.');
