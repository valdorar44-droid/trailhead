import assert from 'node:assert/strict';

import { isRenderableImageUrl } from '../mediaPolicy';

assert.equal(isRenderableImageUrl('https://www.youtube.com/watch?v=r6inJPUbn48'), false);
assert.equal(isRenderableImageUrl('https://vimeo.com/123456'), false);
assert.equal(isRenderableImageUrl('https://cdn.example.com/video.mp4'), false);
assert.equal(isRenderableImageUrl('https://cdn.example.com/photo.jpg'), true);
assert.equal(isRenderableImageUrl('https://cdn.example.com/extensionless?id=42'), true);
assert.equal(isRenderableImageUrl('data:image/png;base64,AA=='), true);

console.log('mediaPolicy tests passed');
