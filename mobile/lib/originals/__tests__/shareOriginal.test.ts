import assert from 'node:assert/strict';
import { originalShareContent } from '../shareOriginal';

const moab = originalShareContent({
  slug: 'moab-canyons-to-the-sky',
  title: 'Moab: Canyons to the Sky',
  summary: 'A self-guided scenic drive with stories that play along the route.',
});

assert.equal(moab.title, 'Moab: Canyons to the Sky');
assert.equal(
  moab.url,
  'https://gettrailhead.app/originals/moab-canyons-to-the-sky',
);
assert.match(moab.message, /Moab: Canyons to the Sky/);
assert.match(moab.message, /self-guided scenic drive/);
assert.match(moab.message, /https:\/\/gettrailhead\.app\/originals\/moab-canyons-to-the-sky/);
assert.doesNotMatch(moab.message, /will use the published Trailhead link/i);

const encoded = originalShareContent({
  slug: 'route/preview',
  title: 'Route preview',
});
assert.equal(
  encoded.url,
  'https://gettrailhead.app/originals/route%2Fpreview',
);
assert.equal(encoded.message, `Route preview\n\n${encoded.url}`);

console.log('Original sharing content tests passed.');
