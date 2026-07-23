import assert from 'node:assert/strict';

import {
  boundedExploreImageCandidates,
  boundedExploreImageUrl,
  EXPLORE_IMAGE_BOUNDS,
  exploreImageSource,
  isRenderableImageUrl,
} from '../mediaPolicy';

assert.equal(isRenderableImageUrl('https://www.youtube.com/watch?v=r6inJPUbn48'), false);
assert.equal(isRenderableImageUrl('https://vimeo.com/123456'), false);
assert.equal(isRenderableImageUrl('https://cdn.example.com/video.mp4'), false);
assert.equal(isRenderableImageUrl('https://cdn.example.com/photo.jpg'), true);
assert.equal(isRenderableImageUrl('https://cdn.example.com/extensionless?id=42'), true);
assert.equal(isRenderableImageUrl('data:image/png;base64,AA=='), true);

const npsOriginal = 'https://www.nps.gov/common/uploads/structured_data/example.jpg';
const npsCard = new URL(boundedExploreImageUrl(npsOriginal, EXPLORE_IMAGE_BOUNDS.card));
assert.equal(npsCard.searchParams.get('maxWidth'), '960');
assert.equal(npsCard.searchParams.get('maxHeight'), '768');
assert.equal(npsCard.searchParams.get('quality'), '78');
assert.equal(npsCard.searchParams.get('format'), 'webp');

const backendNpsThumbnail = 'https://www.nps.gov/common/uploads/structured_data/example.jpg?maxWidth=640&maxHeight=640&quality=78&format=webp';
const preservedNpsThumbnail = new URL(boundedExploreImageUrl(backendNpsThumbnail, EXPLORE_IMAGE_BOUNDS.detail));
assert.equal(preservedNpsThumbnail.searchParams.get('maxWidth'), '640');
assert.equal(preservedNpsThumbnail.searchParams.get('maxHeight'), '640');

const oversizedNps = new URL(boundedExploreImageUrl(
  'https://www.nps.gov/common/uploads/structured_data/example.jpg?maxwidth=1400&maxheight=1200',
  EXPLORE_IMAGE_BOUNDS.rail,
));
assert.equal(oversizedNps.searchParams.get('maxWidth'), '720');
assert.equal(oversizedNps.searchParams.get('maxHeight'), '720');
assert.equal(oversizedNps.searchParams.get('maxwidth'), null);

assert.equal(
  boundedExploreImageUrl(
    'https://upload.wikimedia.org/wikipedia/commons/a/aa/Example_image.jpg',
    EXPLORE_IMAGE_BOUNDS.tile,
  ),
  'https://upload.wikimedia.org/wikipedia/commons/thumb/a/aa/Example_image.jpg/500px-Example_image.jpg',
);
assert.equal(
  boundedExploreImageUrl(
    'https://upload.wikimedia.org/wikipedia/commons/thumb/a/aa/Example_image.jpg/1280px-Example_image.jpg',
    EXPLORE_IMAGE_BOUNDS.tile,
  ),
  'https://upload.wikimedia.org/wikipedia/commons/thumb/a/aa/Example_image.jpg/500px-Example_image.jpg',
);
assert.equal(
  boundedExploreImageUrl(
    'https://commons.wikimedia.org/wiki/Special:Redirect/file/Example_image.jpg?width=500&height=500',
    EXPLORE_IMAGE_BOUNDS.detail,
  ),
  '',
);
assert.equal(
  boundedExploreImageUrl(
    'https://commons.wikimedia.org/wiki/Special:FilePath/Example_image.jpg',
    EXPLORE_IMAGE_BOUNDS.tile,
  ),
  '',
);
assert.equal(
  boundedExploreImageUrl('file:///data/user/0/com.trailhead.app/files/offline/thumb.webp', EXPLORE_IMAGE_BOUNDS.tile),
  'file:///data/user/0/com.trailhead.app/files/offline/thumb.webp',
);
assert.equal(
  boundedExploreImageUrl('content://com.trailhead.app.offline/thumb/42', EXPLORE_IMAGE_BOUNDS.tile),
  'content://com.trailhead.app.offline/thumb/42',
);

const viatorDerivative = 'https://media-cdn.tripadvisor.com/media/attractions-splice-spp-720x480/12/85/7c/25.jpg';
assert.equal(boundedExploreImageUrl(viatorDerivative, EXPLORE_IMAGE_BOUNDS.card), viatorDerivative);
assert.equal(
  boundedExploreImageUrl('https://cdn.example.com/photo.jpg?w=640&h=480', EXPLORE_IMAGE_BOUNDS.rail),
  'https://cdn.example.com/photo.jpg?w=640&h=480',
);
assert.equal(
  boundedExploreImageUrl('https://cdn.example.com/photo.jpg?w=2400&h=1600', EXPLORE_IMAGE_BOUNDS.card),
  'https://cdn.example.com/photo.jpg?w=2400&h=1600',
);
assert.equal(
  boundedExploreImageUrl('https://cdn.example.com/full-resolution.jpg', EXPLORE_IMAGE_BOUNDS.card),
  'https://cdn.example.com/full-resolution.jpg',
);
assert.equal(boundedExploreImageUrl('data:image/png;base64,AA==', EXPLORE_IMAGE_BOUNDS.card), '');
assert.deepEqual(
  exploreImageSource('https://upload.wikimedia.org/wikipedia/commons/thumb/a/aa/Example.jpg/500px-Example.jpg'),
  {
    uri: 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/aa/Example.jpg/500px-Example.jpg',
    headers: { 'User-Agent': 'Trailhead-Mobile/1.0 (+https://gettrailhead.app/support)' },
  },
);
assert.deepEqual(exploreImageSource(npsOriginal), { uri: npsOriginal });

assert.deepEqual(
  boundedExploreImageCandidates(
    [npsOriginal, npsOriginal, 'https://cdn.example.com/full-resolution.jpg'],
    EXPLORE_IMAGE_BOUNDS.tile,
  ),
  [
    boundedExploreImageUrl(npsOriginal, EXPLORE_IMAGE_BOUNDS.tile),
    'https://cdn.example.com/full-resolution.jpg',
  ],
);

console.log('mediaPolicy tests passed');
