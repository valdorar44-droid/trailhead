#!/usr/bin/env node
/**
 * Headed Chromium walkthrough: Route Builder → Map → Mission Briefing
 * Run: node scripts/live-walkthrough.mjs
 */
import { chromium } from 'playwright';

const BASE = 'http://localhost:8082';
const SLOW = 1200;

async function pause(page, label, ms = SLOW) {
  console.log(`\n▶ ${label}`);
  await page.waitForTimeout(ms);
}

async function main() {
  const browser = await chromium.launch({
    headless: false,
    channel: 'chrome',
    slowMo: 80,
    args: ['--start-maximized'],
  });
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await context.newPage();

  try {
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await pause(page, 'Loaded Trailhead — already signed in as Codex');

    await page.goto(`${BASE}/route-builder`, { waitUntil: 'domcontentloaded' });
    await pause(page, 'Route Builder hub — no saved routes yet');

    await page.getByText('Build New Route', { exact: true }).click();
    await pause(page, 'Started new route wizard');

    // Wizard step 0: trip name / basics — look for Next or Continue
    const nextBtn = page.getByRole('button', { name: /next|continue/i }).first();
    if (await nextBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await nextBtn.click();
      await pause(page, 'Wizard step 1');
    }

    // Search and add stops — try Moab area
    const search = page.getByPlaceholder(/search/i).first();
    if (await search.isVisible({ timeout: 5000 }).catch(() => false)) {
      await search.fill('Moab');
      await pause(page, 'Searching Moab', 2000);
      const result = page.getByText(/Moab/i).first();
      if (await result.isVisible({ timeout: 5000 }).catch(() => false)) {
        await result.click();
        await pause(page, 'Added first stop (Moab)');
      }
    }

    // Add second stop
    if (await search.isVisible({ timeout: 3000 }).catch(() => false)) {
      await search.fill('Monument Valley');
      await pause(page, 'Searching Monument Valley', 2000);
      const result2 = page.getByText(/Monument Valley/i).first();
      if (await result2.isVisible({ timeout: 5000 }).catch(() => false)) {
        await result2.click();
        await pause(page, 'Added second stop');
      }
    }

    // Save route
    const saveBtn = page.getByText(/save route|save & open map|open map/i).first();
    if (await saveBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await saveBtn.click();
      await pause(page, 'Saving route and opening map', 3000);
    } else {
      await page.goto(`${BASE}/map`);
      await pause(page, 'Navigated to Map directly', 3000);
    }

    // Open mission briefing via Co-Pilot chip or BRIEFING button
    const briefingChip = page.getByText('open mission briefing', { exact: true });
    if (await briefingChip.isVisible({ timeout: 8000 }).catch(() => false)) {
      await page.getByRole('button', { name: /co-pilot|copilot/i }).click().catch(() => {});
      await pause(page, 'Opened Co-Pilot', 1500);
      await briefingChip.click();
    } else {
      const briefingBtn = page.getByText('BRIEFING', { exact: true });
      if (await briefingBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
        await briefingBtn.click();
      } else {
        await page.goto(`${BASE}/extreme-explorer`);
      }
    }
    await pause(page, 'Mission Briefing / Extreme Explorer — cinematic should play', 8000);

    console.log('\n✓ Walkthrough complete. Browser stays open — close manually when done.');
    await page.waitForTimeout(600_000);
  } catch (err) {
    console.error('Walkthrough error:', err);
    await page.waitForTimeout(120_000);
  }
}

main();
