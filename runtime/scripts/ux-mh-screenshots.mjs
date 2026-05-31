#!/usr/bin/env node
/**
 * Screenshot capture for UX-MH-1/2/3 integration proofs (Run #19
 * Phase 9).  Loads the runtime in Chromium, mounts a
 * <chargen-dm-review> with the integrated wiring, drives the user-
 * visible click paths, and captures PNGs to /home/markus/src/ttrpg/
 * tmp/ux-mh-{N}-verified-<sha>.png.
 *
 * Usage:  node scripts/ux-mh-screenshots.mjs
 * Requires:  a vite dev server running on 5173 (npm run dev).
 */

import { chromium } from 'playwright';
import { execSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const SHA = execSync('git rev-parse --short HEAD', {
  cwd: new URL('..', import.meta.url).pathname
})
  .toString()
  .trim();
const OUT_DIR = '/home/markus/src/ttrpg/tmp';
mkdirSync(OUT_DIR, { recursive: true });

const APP_URL = process.env.QUIRE_APP_URL ?? 'http://localhost:5173';

const SETUP = `async () => {
  await import('/src/ui/regions/chargen-dm-review.ts');
  const el = document.createElement('chargen-dm-review');
  el.pcSlots = {
    1: { pcId: 'mei', controllerPeerId: 'alice', state: 'bound-active' },
    2: { pcId: 'rune', controllerPeerId: 'bob', state: 'bound-active' }
  };
  el.synthResults = new Map([
    [1, {
      ok: true,
      response: {
        name: 'Mei',
        pronouns: 'they/them',
        tags: ['nurse', 'climber'],
        stats: { STR: 0, DEX: 1, CON: 1, INT: 1, WIS: 2, CHA: 0 },
        skillMastery: []
      },
      warnings: [],
      retried: false
    }]
  ]);
  el.playerNameLookup = (pcId) =>
    pcId === 'mei' ? 'Alice' : pcId === 'rune' ? 'Bob' : null;
  el.peerIdForPcLookup = (pcId) =>
    pcId === 'mei' ? 'alice' : pcId === 'rune' ? 'bob' : null;
  el.onRenamePlayer = (peerId, name) => {
    window.__lastRename = { peerId, name };
    return true;
  };
  el.pcEditDataLookup = (pcId) => {
    if (pcId === 'mei') {
      return {
        name: 'Mei',
        pronouns: 'they/them',
        tags: ['nurse', 'climber'],
        backstory: 'Mei trained as an ICU nurse before moving to Quire.\\n\\nShe climbs to remember her old life back in the city.'
      };
    }
    if (pcId === 'rune') {
      return {
        name: 'Rune',
        pronouns: 'he/him',
        tags: ['scholar'],
        backstory: 'Rune left the libraries of the Glasstown for the Quiet.'
      };
    }
    return null;
  };
  el.onEditPcField = (pcId, field, value) => {
    window.__lastEdit = { pcId, field, value };
    return true;
  };
  el.onPcTagOp = (pcId, op) => {
    window.__lastTagOp = { pcId, op };
    return true;
  };
  el.onRefreshBackstory = async (pcId) => {
    window.__lastRefresh = { pcId };
  };
  el.style.maxWidth = '720px';
  el.style.display = 'block';
  el.style.padding = '20px';
  el.style.background = 'var(--color-bg, white)';
  document.body.innerHTML = '';
  document.body.appendChild(el);
  await new Promise((r) => requestAnimationFrame(() => r(null)));
  await new Promise((r) => requestAnimationFrame(() => r(null)));
  return true;
}`;

async function main() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: 1024, height: 1400 }
  });
  const page = await ctx.newPage();
  page.on('console', (msg) => {
    if (msg.type() === 'error') console.error('[browser-error]', msg.text());
  });
  await page.goto(APP_URL);
  await page.waitForSelector('quire-app', { timeout: 10000 });

  // --- UX-MH-1: Player-name visible + DM pencil affordance ---
  await page.evaluate(`(${SETUP})()`);
  await page.waitForSelector('.chargen-dm-review-player-name-editable');
  const out1 = join(OUT_DIR, `ux-mh-1-verified-${SHA}.png`);
  await page.screenshot({ path: out1, fullPage: true });
  console.log(`Saved ${out1}`);

  // --- UX-MH-2: Tray open with all four fields editable ---
  await page.evaluate(`(${SETUP})()`);
  // Click the Edit toggle on slot 1's tray.
  await page.evaluate(() => {
    const tray = document.querySelector(
      'chargen-edit-tray[data-slot="1"]'
    );
    tray.querySelector('.chargen-edit-tray-toggle').click();
  });
  await page.waitForSelector('chargen-edit-tray[data-slot="1"] textarea');
  const out2 = join(OUT_DIR, `ux-mh-2-verified-${SHA}.png`);
  await page.screenshot({ path: out2, fullPage: true });
  console.log(`Saved ${out2}`);

  // --- UX-MH-3: Refresh button visible inside the open tray ---
  await page.evaluate(`(${SETUP})()`);
  await page.evaluate(() => {
    const tray = document.querySelector(
      'chargen-edit-tray[data-slot="1"]'
    );
    tray.querySelector('.chargen-edit-tray-toggle').click();
  });
  await page.waitForSelector('.chargen-edit-tray-refresh');
  const out3 = join(OUT_DIR, `ux-mh-3-verified-${SHA}.png`);
  await page.screenshot({ path: out3, fullPage: true });
  console.log(`Saved ${out3}`);

  await browser.close();
  console.log('Done.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
