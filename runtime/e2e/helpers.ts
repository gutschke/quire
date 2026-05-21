/**
 * Shared helpers for the Playwright suite.  Centralizes the
 * shadow-DOM-aware selectors and the broker URL build so individual
 * specs stay short.
 */

import { type Page, type BrowserContext, expect } from '@playwright/test';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_ROOT = path.join(HERE, 'fixtures', 'campaigns');

/**
 * Register a route handler that serves a fixture campaign in response
 * to the runtime's GitHub raw-content fetches.  All fetches matching
 *
 *   https://raw.githubusercontent.com/test/<slug>/main/<rest>
 *
 * are answered from e2e/fixtures/campaigns/<slug>/<rest>.  Missing
 * files return 404 (matching the real GitHub raw behavior so the
 * loader's "file not present" path is exercised).
 */
export async function mockFixtureCampaign(
  page: Page,
  slug: string
): Promise<void> {
  const root = path.join(FIXTURE_ROOT, slug);
  if (!existsSync(root)) {
    throw new Error(`Fixture not found: ${root}`);
  }
  await page.route(
    `**/raw.githubusercontent.com/test/${slug}/main/**`,
    async (route) => {
      const url = new URL(route.request().url());
      // Path after /test/<slug>/main/
      const prefix = `/test/${slug}/main/`;
      const idx = url.pathname.indexOf(prefix);
      if (idx < 0) return route.fulfill({ status: 404 });
      const rel = url.pathname.slice(idx + prefix.length);
      const filePath = path.join(root, rel);
      if (!filePath.startsWith(root) || !existsSync(filePath)) {
        return route.fulfill({ status: 404, body: '' });
      }
      const ext = path.extname(filePath);
      const contentType =
        ext === '.json'
          ? 'application/json'
          : ext === '.md'
            ? 'text/markdown; charset=utf-8'
            : 'text/plain; charset=utf-8';
      const body = readFileSync(filePath);
      return route.fulfill({
        status: 200,
        headers: { 'content-type': contentType },
        body
      });
    }
  );
}

export function campaignUrl(
  slug: string,
  extra: Record<string, string> = {}
): string {
  return appUrl({ campaign: `test/${slug}`, ...extra });
}

export async function openCampaign(
  context: BrowserContext,
  slug: string,
  extra: Record<string, string> = {}
): Promise<Page> {
  const page = await context.newPage();
  page.on('pageerror', (err) => console.log('[browser pageerror]', err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') console.log('[browser console]', msg.text());
  });
  await mockFixtureCampaign(page, slug);
  await page.goto(campaignUrl(slug, extra));
  await page.locator('.session-bar').first().waitFor({ timeout: 15000 });
  return page;
}

export function appUrl(extraParams: Record<string, string> = {}): string {
  const port = process.env.QUIRE_PEER_PORT;
  if (!port) {
    throw new Error('QUIRE_PEER_PORT not set; global-setup failed?');
  }
  const params = new URLSearchParams({
    peerHost: '127.0.0.1',
    peerPort: port,
    peerPath: '/quire-e2e',
    peerSecure: '0',
    ...extraParams
  });
  return `/?${params.toString()}`;
}

export async function openApp(
  context: BrowserContext,
  extraParams: Record<string, string> = {}
): Promise<Page> {
  const page = await context.newPage();
  page.on('pageerror', (err) => console.log('[browser pageerror]', err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') console.log('[browser console]', msg.text());
  });
  await page.goto(appUrl(extraParams));
  await page.locator('.session-bar').first().waitFor({ timeout: 15000 });
  return page;
}

// Locator helpers — Playwright pierces open shadow roots by default,
// so the simple class selectors find elements inside Lit's shadow DOM.

export function sessionBar(page: Page) {
  return page.locator('.session-bar');
}

export function soloPanel(page: Page) {
  return page.locator('.session-bar.session-solo');
}

export function activePanel(page: Page) {
  return page.locator('.session-bar.session-active');
}

export function connectingPanel(page: Page) {
  return page.locator('.session-bar.session-connecting');
}

export function errorPanel(page: Page) {
  return page.locator('.session-bar.session-error');
}

export function chatInput(page: Page) {
  return page.locator('.chat-form input');
}

export function chatList(page: Page) {
  return page.locator('.chat-list');
}

export function rollInput(page: Page) {
  return page.locator('.roll-form input');
}

export function rollHistory(page: Page) {
  return page.locator('.roll-history');
}

export function aiPanel(page: Page) {
  return page.locator('.ai-panel');
}

export async function waitActive(page: Page, timeoutMs = 30000): Promise<void> {
  await expect(activePanel(page)).toBeVisible({ timeout: timeoutMs });
}

export async function readPairingCode(page: Page): Promise<string> {
  const codeEl = activePanel(page).locator('.session-code-display code');
  await expect(codeEl).toBeVisible({ timeout: 10000 });
  const code = (await codeEl.innerText()).trim();
  if (!code) throw new Error('pairing code element was empty');
  return code;
}

export async function hostSession(page: Page, name = 'DM'): Promise<string> {
  await soloPanel(page).locator('input.session-name').fill(name);
  await soloPanel(page)
    .getByRole('button', { name: /host session/i })
    .click();
  await waitActive(page);
  return readPairingCode(page);
}

export async function joinSession(
  page: Page,
  code: string,
  name = 'Player'
): Promise<void> {
  await soloPanel(page).locator('input.session-name').fill(name);
  await soloPanel(page).locator('input.session-code').fill(code);
  await soloPanel(page)
    .getByRole('button', { name: /^join$/i })
    .click();
  await waitActive(page);
}

export async function sendChat(page: Page, text: string): Promise<void> {
  await chatInput(page).fill(text);
  await chatInput(page).press('Enter');
}

export async function expectPeerCount(
  page: Page,
  count: number
): Promise<void> {
  // Post-F1: label is "N other players" sourced from shared.peers
  // (session membership) instead of direct WebRTC connections.
  const label = count === 0
    ? /no other players yet/i
    : count === 1
      ? /1 other player/i
      : new RegExp(`${count} other players`, 'i');
  await expect(activePanel(page).locator('.session-peers')).toContainText(
    label,
    { timeout: 30000 }
  );
}
