import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getExploreSourcePanelModel,
  getExploreSourceRows,
} from '../../components/explore/exploreDisplay';

function makePlace(overrides: Record<string, unknown> = {}) {
  return {
    id: 'destination:test',
    summary: {
      title: 'Test destination',
      category: 'parks',
      lat: 44.6,
      lng: -110.5,
    },
    profile: {
      hook: '',
      summary: '',
      story: '',
      why_it_matters: '',
      what_to_know: '',
      best_time_to_stop: '',
      access_notes: '',
      nearby_context: '',
    },
    audio_script: '',
    wiki_extract: '',
    source_pack: undefined,
    facts: {},
    attribution: '',
    ...overrides,
  } as any;
}

test('source panel omits generic access, details, website, and season filler', () => {
  const place = makePlace({
    source_pack: {
      primary: 'OpenStreetMap',
      official_url: 'https://example.test',
      source_note: 'Open image references. Check current access, fees, closures, and rules before you go.',
    },
    profile: {
      ...makePlace().profile,
      best_time_to_stop: 'Check season before you go',
    },
    attribution: 'Wikidata',
  });

  const panel = getExploreSourcePanelModel(place);
  assert.equal(panel.body, '');
  assert.deepEqual(panel.rows, []);
  assert.doesNotMatch(JSON.stringify(panel), /check current|current details|official website|check season/i);
});

test('source panel preserves concrete publisher, checked date, and explicit season', () => {
  const place = makePlace({
    source_pack: {
      primary: 'National Park Service',
      source_note: 'Road and trail notices are maintained by the park.',
    },
    best_season: 'May through October',
    facts: { last_updated: 1_725_696_000 },
  });

  const panel = getExploreSourcePanelModel(place);
  assert.equal(panel.body, 'Road and trail notices are maintained by the park.');
  assert.deepEqual(getExploreSourceRows(place).map(row => row.label), ['Source', 'Updated', 'Season']);
  assert.equal(panel.rows[0]?.value, 'National Park Service');
  assert.equal(panel.rows[2]?.value, 'May through October');
});

test('source panel is empty when no factual source information exists', () => {
  assert.deepEqual(getExploreSourcePanelModel(makePlace()), { body: '', rows: [] });
});

test('source panel does not expose Trailhead as an external publisher', () => {
  const place = makePlace({ source_pack: { primary: 'Trailhead' } });
  assert.deepEqual(getExploreSourceRows(place), []);
});
