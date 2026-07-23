import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const mobileRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const componentRoot = join(mobileRoot, 'components', 'explore');
const files = {
  guide: join(mobileRoot, 'app', '(tabs)', 'guide.tsx'),
  detail: join(componentRoot, 'ExploreDetailSheet.tsx'),
  experiences: join(componentRoot, 'ExploreExperiencesRail.tsx'),
  placeCard: join(componentRoot, 'ExplorePlaceCard.tsx'),
  staticPreview: join(componentRoot, 'StaticMapboxPreview.tsx'),
  trailArea: join(componentRoot, 'ExploreTrailArea.tsx'),
  tripDetail: join(componentRoot, 'GuidedTripDetailModal.tsx'),
};

for (const [label, file] of Object.entries(files)) {
  const source = readFileSync(file, 'utf8');
  assert.match(
    source,
    /boundedExploreImage(?:Url|Candidates)/,
    `${label} must use the shared dimension-aware Explore image policy`,
  );
  const remoteImages = [...source.matchAll(/<Image\b[\s\S]*?\/>/g)]
    .map(match => match[0])
    .filter(tag => /source=(?:\{\{\s*uri(?:\s*:|\s*\})|\{exploreImageSource\()/.test(tag));
  assert.ok(remoteImages.length > 0, `${label} must retain its remote image surface`);
  remoteImages.forEach((tag, index) => {
    assert.match(
      tag,
      /resizeMethod=["']resize["']/,
      `${label} remote image ${index + 1} must downsample before Android decode`,
    );
  });
}

const guideSource = readFileSync(files.guide, 'utf8');
assert.match(
  guideSource,
  /function campImageUrl[\s\S]*?boundedExploreImageUrl\(mediaUrl\(direct\),\s*EXPLORE_IMAGE_BOUNDS\.card\)/,
  'Explore campground cards must request bounded card media before rendering',
);
assert.match(
  guideSource,
  /function livePlaceImageUrl[\s\S]*?boundedExploreImageUrl\(mediaUrl\(place\.photo_url\),\s*EXPLORE_IMAGE_BOUNDS\.tile\)/,
  'Explore nearby rows must request bounded tile media before rendering',
);
assert.doesNotMatch(
  guideSource,
  /<Image\b[\s\S]*?source=\{\{\s*uri\s*:\s*(?:image|mediaUrl\()/,
  'Explore guide must not bypass the shared image source policy',
);

const detailSource = readFileSync(files.detail, 'utf8');
assert.doesNotMatch(
  detailSource,
  /sizedNpsMediaUrl|\[\s*sized\s*,\s*normalized\s*\]/,
  'Explore details must not restore an original after a bounded derivative fails',
);
assert.match(
  detailSource,
  /imageUrl,[\s\S]*?place\.summary\.image_url,[\s\S]*?place\.summary\.thumbnail_url/,
  'Explore detail heroes must prefer a detail-sized derivative before the compact thumbnail fallback',
);
assert.match(
  detailSource,
  /const itemImages = mediaCandidates\(EXPLORE_IMAGE_BOUNDS\.detail, item\.image_url\);/,
  'Explore child details must derive imagery from the exact child only',
);
assert.match(
  detailSource,
  /onExhausted=\{\(\) => setFailedChildMediaKey\(childMediaKey\)\}/,
  'Explore child details must fall back to their text/map treatment when exact media fails',
);
assert.doesNotMatch(
  detailSource,
  /mediaCandidates\(EXPLORE_IMAGE_BOUNDS\.(?:tile|detail),\s*item\.image_url,\s*(?:activeModuleDef|moduleFallbackImages|imageUrl)/,
  'Explore child surfaces must not inherit module or parent-place imagery',
);
assert.doesNotMatch(
  detailSource,
  /DETAIL_STAY_FALLBACK_IMAGE|explore-hero-moraine-lake\.jpg/,
  'Explore child surfaces must not present generic destination photography as exact-place media',
);

const placeSheetSource = readFileSync(join(mobileRoot, 'components', 'PremiumPlaceSheet.tsx'), 'utf8');
assert.match(
  placeSheetSource,
  /boundedPlaceMediaUrl/,
  'Main-map place sheets must bound NPS and Wikimedia media before rendering',
);
assert.doesNotMatch(
  placeSheetSource,
  /boundedExploreImageUrl\(resolved,[\s\S]*?\)\s*\|\|\s*resolved/,
  'Main-map place sheets must fail closed instead of restoring rejected remote media',
);
assert.match(
  placeSheetSource,
  /<Image[\s\S]*?resizeMethod=["']resize["'][\s\S]*?\/>/,
  'Main-map place-sheet heroes must downsample before Android decode',
);
assert.doesNotMatch(
  placeSheetSource,
  /relatedHero|visibleRelatedHero|\.map\(item => mediaUrl\(item\.photo_url\)\)/,
  'Main-map place sheets must not substitute related-place media for the selected entity',
);
assert.match(
  placeSheetSource,
  /const hero = visiblePhotos\[0\]\?\.url \|\| '';/,
  'Main-map place-sheet heroes must fail closed when the selected entity has no verified media',
);

const gallerySource = readFileSync(join(mobileRoot, 'components', 'TrailheadPhotoGallery.tsx'), 'utf8');
assert.match(
  gallerySource,
  /boundedExploreImageUrl\(photo\.url,\s*EXPLORE_IMAGE_BOUNDS\.detail\)/,
  'Full-screen place galleries must apply the shared detail-image bound to every photo',
);
assert.match(
  gallerySource,
  /<Image[\s\S]*?resizeMethod=["']resize["'][\s\S]*?\/>/,
  'Full-screen place galleries must downsample before Android decode',
);

console.log('Explore image policy usage guards passed.');
