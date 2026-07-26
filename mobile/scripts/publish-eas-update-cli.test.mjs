import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const publisher = readFileSync(new URL('./publish-eas-update.mjs', import.meta.url), 'utf8');
const updateList = publisher.match(/'update:list',[\s\S]*?'--limit',\s*'(\d+)'/);

assert.ok(updateList, 'publisher must query the isolated candidate branch');
const limit = Number(updateList[1]);
assert.ok(limit >= 1 && limit <= 50, 'EAS update:list limit must stay within the CLI-supported 1–50 range');

console.log('Production publisher CLI contract tests passed.');
