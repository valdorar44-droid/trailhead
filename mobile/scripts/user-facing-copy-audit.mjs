import { createRequire } from 'node:module';
import { dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const ts = require('typescript');

const scriptDir = dirname(fileURLToPath(import.meta.url));
const mobileRoot = resolve(scriptDir, '..');
const targets = process.argv.slice(2).length > 0
  ? process.argv.slice(2)
  : ['app/(tabs)/plan.tsx'];

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

for (const target of targets) {
  const filePath = resolve(mobileRoot, target);
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

if (findings.length > 0) {
  console.error('User-facing copy audit failed:');
  for (const finding of findings) {
    console.error(`- ${finding.file}:${finding.line} blocked term "${finding.term}" in "${finding.text}"`);
  }
  process.exit(1);
}

console.log(`User-facing copy audit passed for ${targets.length} file${targets.length === 1 ? '' : 's'}.`);
