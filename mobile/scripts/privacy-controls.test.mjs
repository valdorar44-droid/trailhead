#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const mobileRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = path => readFileSync(join(mobileRoot, path), 'utf8');
const readRepo = path => readFileSync(join(mobileRoot, '..', path), 'utf8');

const appConfig = read('app.config.js');
const easConfig = JSON.parse(read('eas.json'));
const rootLayout = read('app/_layout.tsx');
const store = read('lib/store.ts');
const pkg = JSON.parse(read('package.json'));
const mapboxPrivacy = read('lib/privacy/mapboxTelemetry.native.ts');
const mapboxPrivacyWeb = read('lib/privacy/mapboxTelemetry.web.ts');
const referralAttribution = read('lib/referrals/referralAttribution.ts');
const profile = read('app/(tabs)/profile.tsx');
const routeBuilder = read('app/(tabs)/route-builder.tsx');
const mobileApi = read('lib/api.ts');
const server = readRepo('dashboard/server.py');
const databaseStore = readRepo('db/store.py');
const activeIngestor = readRepo('ingestors/active.py');
const fccIngestor = readRepo('ingestors/fcc.py');

assert.equal(pkg.dependencies['react-native-branch'], undefined);
assert.equal(pkg.dependencies['@config-plugins/react-native-branch'], undefined);
assert.doesNotMatch(appConfig, /react-native-branch|BRANCH_API_KEY|EXPO_PUBLIC_BRANCH_/);
assert.equal(easConfig.build.preview.env.EXPO_PUBLIC_BRANCH_ATTRIBUTION_ENABLED, undefined);
assert.equal(easConfig.build.production.env.EXPO_PUBLIC_BRANCH_ATTRIBUTION_ENABLED, undefined);
assert.doesNotMatch(referralAttribution, /react-native-branch|disableTracking|subscribe\(/);
assert.match(referralAttribution, /referralAttributionIsAvailable\(\): boolean \{\s*return false;/);
assert.match(profile, /referralAttributionIsAvailable\(\) &&/);
assert.doesNotMatch(
  `${server}\n${readRepo('config/settings.py')}\n${readRepo('.env.example')}`,
  /api2\.branch\.io|BRANCH_(?:LIVE_KEY|API_KEY|LINK_DOMAIN|REFERRAL_ALIAS_SECRET|REFERRAL_HANDOFF_ENABLED)|branch_referral_handoff/i,
);

assert.doesNotMatch(server, /@app\.post\("\/api\/viator\/(?:availability\/check|bookings\/cart\/(?:hold|book)|checkoutsessions\/\{session_token\}\/paymentaccounts)"\)/);
assert.match(server, /"payment_solution": "external_handoff"/);
assert.doesNotMatch(server, /geonames\.org\/findNearbyPlaceNameJSON/);
assert.match(activeIngestor, /CAMPGROUND_BASE = "https:\/\//);
assert.match(activeIngestor, /RESERVE_AMERICA_BASE = "https:\/\//);
assert.match(fccIngestor, /VIZMO_BASE = "https:\/\//);

const pushAudienceStart = databaseStore.indexOf('def _push_audience_where');
const pushAudienceEnd = databaseStore.indexOf('def get_push_campaign_recipients', pushAudienceStart);
assert.ok(pushAudienceStart >= 0 && pushAudienceEnd > pushAudienceStart);
const pushAudienceSource = databaseStore.slice(pushAudienceStart, pushAudienceEnd);
assert.doesNotMatch(pushAudienceSource, /analytics_events|plan_type|credits|active_recent|all_users/);
assert.match(pushAudienceSource, /u\.is_admin = 1/);
assert.match(databaseStore, /"\[redacted\]"/);

assert.doesNotMatch(routeBuilder, /trackOutdoorOfferEvent/);
assert.doesNotMatch(mobileApi, /trackOutdoorOfferEvent|OfferEventPayload|OfferEventName/);
const offerEventStart = server.indexOf('def _record_offer_event');
const offerEventEnd = server.indexOf('@app.get("/api/offers/rentals")', offerEventStart);
assert.ok(offerEventStart >= 0 && offerEventEnd > offerEventStart);
assert.doesNotMatch(server.slice(offerEventStart, offerEventEnd), /log_event\(/);

assert.match(mapboxPrivacy, /setTelemetryEnabled\(false\)/);
assert.doesNotMatch(mapboxPrivacy, /setTelemetryEnabled\(true\)/);
assert.doesNotMatch(rootLayout, /disableNonessentialMapboxTelemetry\(/);
assert.match(store, /disableNonessentialMapboxTelemetry\(token\)/);
assert.match(mapboxPrivacy, /setAccessToken\(token\)[\s\S]*setTelemetryEnabled\(false\)/);
assert.doesNotMatch(mapboxPrivacyWeb, /@rnmapbox\/maps/);

console.log('Nonessential third-party collection controls passed.');
