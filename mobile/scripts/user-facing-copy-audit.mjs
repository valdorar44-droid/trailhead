import { createRequire } from 'node:module';
import { dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const ts = require('typescript');

const scriptDir = dirname(fileURLToPath(import.meta.url));
const mobileRoot = resolve(scriptDir, '..');

const presets = {
  plan: ['app/(tabs)/plan.tsx'],
  explore: [
    'app/(tabs)/guide.tsx',
    'components/explore/ExploreCategoryFilterSheet.tsx',
    'components/explore/ExploreCategoryChips.tsx',
    'components/explore/ExploreDetailSheet.tsx',
    'components/explore/ExploreExperiencesRail.tsx',
    'components/explore/ExploreFilterRow.tsx',
    'components/explore/ExploreHero.tsx',
    'components/explore/ExploreHomeControls.tsx',
    'components/explore/ExploreModeTabs.tsx',
    'components/explore/ExplorePlaceCard.tsx',
    'components/explore/ExploreTrailArea.tsx',
    'components/explore/GuidedTripDetailModal.tsx',
    'components/explore/GuidedDestinationBrowser.tsx',
    'components/explore/StaticMapboxPreview.tsx',
  ],
  map: [
    'app/(tabs)/map.tsx',
    'components/map/MapFilterSheet.tsx',
    'components/map/MapLayerSheetContent.tsx',
    'components/map/MapLegendSheet.tsx',
    'components/map/RouteScoutPanel.tsx',
  ],
  profile: [
    'app/(tabs)/profile.tsx',
    'components/PaywallModal.tsx',
  ],
};

function expandTargets(args) {
  if (args.length === 0) return presets.plan;
  const out = [];
  for (let idx = 0; idx < args.length; idx += 1) {
    const arg = args[idx];
    if (arg === '--preset') {
      const name = args[idx + 1];
      idx += 1;
      if (!name || !presets[name]) {
        console.error(`Unknown copy audit preset "${name || ''}". Known presets: ${Object.keys(presets).join(', ')}`);
        process.exit(1);
      }
      out.push(...presets[name]);
      continue;
    }
    if (arg.startsWith('--preset=')) {
      const name = arg.slice('--preset='.length);
      if (!presets[name]) {
        console.error(`Unknown copy audit preset "${name}". Known presets: ${Object.keys(presets).join(', ')}`);
        process.exit(1);
      }
      out.push(...presets[name]);
      continue;
    }
    out.push(arg);
  }
  return Array.from(new Set(out));
}

const targets = expandTargets(process.argv.slice(2));

const blockedTerms = [
  { label: 'AI', pattern: /\bAI\b/ },
  { label: 'LLM', pattern: /\bLLM\b/i },
  { label: 'Prompt', pattern: /\bPrompt\b/i },
  { label: 'Provider', pattern: /\bProvider\b/i },
  { label: 'Sandbox', pattern: /\bSandbox\b/i },
  { label: 'Internal', pattern: /\bInternal\b/i },
  { label: 'Debug', pattern: /\bDebug\b/i },
  { label: 'Geocode', pattern: /\bGeocode\b/i },
  { label: 'Lat/Lng', pattern: /\bLat\/Lng\b/i },
  { label: 'Endpoint', pattern: /\bEndpoint\b/i },
  { label: 'Payload', pattern: /\bPayload\b/i },
  { label: 'Schema', pattern: /\bSchema\b/i },
  { label: 'Developer', pattern: /\bDeveloper\b/i },
  { label: 'Experimental', pattern: /\bExperimental\b/i },
  { label: 'Zero', pattern: /\bzero\b/i },
  { label: '0 results', pattern: /\b0\s+results?\b/i },
  { label: 'Rig ready', pattern: /\brig ready\b/i },
  { label: 'Offline ready', pattern: /\boffline ready\b/i },
  { label: 'Preview rebuild requirement', pattern: /\bpreview rebuild required\b/i },
];

function isCheckedTextNode(node) {
  return ts.isStringLiteral(node)
    || ts.isNoSubstitutionTemplateLiteral(node)
    || ts.isJsxText(node);
}

function readableText(node, sourceFile) {
  if (ts.isJsxText(node)) return node.getText(sourceFile).replace(/\s+/g, ' ').trim();
  return node.text;
}

const findings = [];
const missingTargets = [];

for (const target of targets) {
  const filePath = resolve(mobileRoot, target);
  if (!existsSync(filePath)) {
    missingTargets.push(target);
    continue;
  }
  const sourceText = readFileSync(filePath, 'utf8');
  const sourceFile = ts.createSourceFile(filePath, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

  function visit(node) {
    if (isCheckedTextNode(node)) {
      const text = readableText(node, sourceFile);
      if (text) {
        for (const term of blockedTerms) {
          if (term.pattern.test(text)) {
            const pos = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
            findings.push({
              file: relative(mobileRoot, filePath),
              line: pos.line + 1,
              term: term.label,
              text,
            });
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
}

if (missingTargets.length > 0) {
  console.error('User-facing copy audit target not found:');
  for (const target of missingTargets) console.error(`- ${target}`);
  process.exit(1);
}

if (findings.length > 0) {
  console.error('User-facing copy audit failed:');
  for (const finding of findings) {
    console.error(`- ${finding.file}:${finding.line} blocked term "${finding.term}" in "${finding.text}"`);
  }
  process.exit(1);
}

console.log(`User-facing copy audit passed for ${targets.length} file${targets.length === 1 ? '' : 's'}.`);
