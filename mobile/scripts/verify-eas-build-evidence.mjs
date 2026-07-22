#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { verifyPairedProductionBuilds } from './eas-build-evidence.mjs';

const require = createRequire(import.meta.url);
const appConfig = require('../app.config.js').expo;
const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const evidence = verifyPairedProductionBuilds({ appConfig, packageJson });
console.log(JSON.stringify({ verified: true, ...evidence }));
