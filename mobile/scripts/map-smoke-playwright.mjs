#!/usr/bin/env node
/**
 * Map tab smoke test — verifies Mapbox GL / native map web renderer loads without crash markers.
 *
 * Usage:
 *   node scripts/map-smoke-playwright.mjs [--url http://127.0.0.1:8081/map]
 */
import { chromium } from 'playwright';

const BASE_URL = process.argv.includes('--url')
  ? process.argv[process.argv.indexOf('--url') + 1]
  : 'http://127.0.0.1:8081/map';

const CRASH_MARKERS = [
  'MAP ERROR',
  'removeSubscription',
  'postMessage is not a function',
  'Cannot read properties of undefined',
  'Cannot read property',
  'TypeError',
  'ReferenceError',
  'mapboxgl is not defined',
  'Failed to initialize WebGL',
];

const BLOCKED_COPY = [
  'Selected place.',
  'official sources',
  '0 results',
  'database dump',
  'endpoint',
];

async function main() {
  const browser = await chromium.launch({
    headless: true,
    channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL || 'chrome',
  });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    geolocation: { latitude: 38.5733, longitude: -109.5498 },
    permissions: ['geolocation'],
  });
  const page = await context.newPage();
  const consoleErrors = [];
  const pageErrors = [];

  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => pageErrors.push(String(err?.message || err)));

  console.log(`Loading ${BASE_URL} ...`);
  const response = await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 90000 });
  if (!response || response.status() >= 400) {
    throw new Error(`Page load failed: HTTP ${response?.status() ?? 'unknown'}`);
  }

  await page.waitForTimeout(6000);

  for (let i = 0; i < 8; i += 1) {
    const later = page.getByText(/^later$/i).first();
    if (await later.isVisible({ timeout: 750 }).catch(() => false)) {
      await later.click();
      await page.waitForTimeout(1800);
      continue;
    }
    const gate = page.getByText(/continue for now|continue/i).first();
    if (await gate.isVisible({ timeout: 750 }).catch(() => false)) {
      await gate.click();
      await page.waitForTimeout(1800);
      continue;
    }
    break;
  }

  await page.waitForTimeout(10000);

  const frameReports = [];
  for (const frame of page.frames()) {
    const text = await frame.locator('body').innerText().catch(() => '');
    const htmlText = await frame.content().catch(() => '');
    const canvasCount = await frame.locator('.mapboxgl-canvas, canvas.mapboxgl-canvas, .maplibregl-canvas, canvas').count().catch(() => 0);
    const loadingVisible = await frame.locator('text=/LOADING MAP/i').isVisible({ timeout: 250 }).catch(() => false);
    frameReports.push({
      url: frame.url(),
      text,
      html: htmlText,
      canvasCount,
      loadingVisible,
    });
  }
  const bodyText = frameReports.map((frame) => frame.text).join('\n');
  const html = frameReports.map((frame) => frame.html).join('\n');
  const hasMapCanvas = frameReports.some((frame) => frame.canvasCount > 0);
  const loadingFrames = frameReports.filter((frame) => /LOADING MAP/i.test(frame.text) || frame.loadingVisible);
  const hasLoadingOnly = loadingFrames.length > 0 && !hasMapCanvas;
  const hasStuckLoadingOverlay = loadingFrames.some((frame) => frame.loadingVisible);

  const hits = [...CRASH_MARKERS, ...BLOCKED_COPY].filter((marker) =>
    bodyText.includes(marker) || html.includes(marker) ||
    consoleErrors.some((line) => line.includes(marker)) ||
    pageErrors.some((line) => line.includes(marker)),
  );

  const screenshotPath = '/tmp/trailhead-map-smoke.png';
  await page.screenshot({ path: screenshotPath, fullPage: false });

  await browser.close();

  const report = {
    url: BASE_URL,
    httpStatus: response.status(),
    hasMapCanvas,
    hasLoadingOnly,
    hasStuckLoadingOverlay,
    frameCount: frameReports.length,
    frameCanvases: frameReports.map((frame) => ({ url: frame.url, canvasCount: frame.canvasCount, loadingVisible: frame.loadingVisible })),
    consoleErrorCount: consoleErrors.length,
    pageErrorCount: pageErrors.length,
    hits,
    screenshotPath,
  };

  console.log(JSON.stringify(report, null, 2));

  if (hasLoadingOnly) {
    console.error('FAIL: map stuck on loading screen');
    process.exit(1);
  }
  if (hasStuckLoadingOverlay) {
    console.error('FAIL: map loading overlay is still visible');
    process.exit(1);
  }
  if (!hasMapCanvas) {
    console.error('FAIL: no map canvas detected');
    process.exit(1);
  }
  if (hits.length) {
    console.error('FAIL: crash or blocked copy markers found:', hits.join(', '));
    process.exit(1);
  }
  if (pageErrors.length) {
    console.error('FAIL: page errors:', pageErrors.slice(0, 5).join(' | '));
    process.exit(1);
  }

  console.log('PASS: map smoke test');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
