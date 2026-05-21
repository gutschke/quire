/**
 * Shared helpers for the Playwright suite.  Centralizes the
 * shadow-DOM-aware selectors and the broker URL build so individual
 * specs stay short.
 */

import { type Page, type BrowserContext, expect } from '@playwright/test';

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
  const label = count === 0
    ? /no peers yet/i
    : count === 1
      ? /1 peer/i
      : new RegExp(`${count} peers`, 'i');
  await expect(activePanel(page).locator('.session-peers')).toContainText(
    label,
    { timeout: 30000 }
  );
}
