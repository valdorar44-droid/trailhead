import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const mobileRoot = join(dirname(fileURLToPath(import.meta.url)), '../..');
const sheetSource = readFileSync(
  join(mobileRoot, 'components/PremiumPlaceSheet.tsx'),
  'utf8',
);

test('generic place sheets own Android Back and preserve parent return context', () => {
  assert.match(sheetSource, /BackHandler\.addEventListener\('hardwareBackPress'/);
  assert.match(sheetSource, /if \(onBack\) \{\s+onBack\(\);\s+return true;/);
  assert.match(sheetSource, /onClose\(\);\s+return true;/);
  assert.match(sheetSource, /if \(galleryIndex !== null\)/);
  assert.match(sheetSource, /if \(showCommentForm\)/);
  assert.match(sheetSource, /if \(showEditForm\)/);
});
