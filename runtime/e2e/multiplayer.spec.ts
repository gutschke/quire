/**
 * End-to-end multiplayer test: two real browsers (Chromium contexts)
 * talking through real WebRTC via an in-process peerjs-server broker.
 *
 * This validates the layer that unit tests can't exercise — the actual
 * peerjs client, the actual WebRTC stack, the actual broker handshake.
 * Unit tests use a structural mock for peerjs.Peer (see
 * src/core/transports/peerjs.test.ts) because peerjs's webrtc-adapter
 * can't load under Node.
 *
 * Requires QUIRE_PEER_PORT in the environment (set by global-setup.ts).
 */

import { test, expect, type Page, type BrowserContext } from '@playwright/test';

function appUrl(): string {
  const port = process.env.QUIRE_PEER_PORT;
  if (!port) throw new Error('QUIRE_PEER_PORT not set; global-setup failed?');
  const params = new URLSearchParams({
    peerHost: '127.0.0.1',
    peerPort: port,
    peerPath: '/quire-e2e',
    peerSecure: '0'
  });
  return `/?${params.toString()}`;
}

async function openApp(context: BrowserContext): Promise<Page> {
  const page = await context.newPage();
  page.on('pageerror', (err) => console.log('[browser error]', err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') console.log('[browser console]', msg.text());
  });
  await page.goto(appUrl());
  // Lit renders into a shadow root; Playwright's default CSS engine
  // pierces open shadow roots, so `.session-bar` finds the inner
  // element directly.
  await page.locator('.session-bar').first().waitFor({ timeout: 15000 });
  return page;
}

function startSessionPanel(page: Page) {
  return page.locator('.session-bar.session-solo');
}

function activeSessionPanel(page: Page) {
  return page.locator('.session-bar.session-active');
}

async function waitForActive(page: Page, timeoutMs = 30000): Promise<void> {
  await expect(activeSessionPanel(page)).toBeVisible({ timeout: timeoutMs });
}

async function readPairingCode(page: Page): Promise<string> {
  const codeEl = activeSessionPanel(page).locator('.session-code-display code');
  await expect(codeEl).toBeVisible({ timeout: 10000 });
  const code = (await codeEl.innerText()).trim();
  if (!code) throw new Error('pairing code element was empty');
  return code;
}

test.describe('Quire multiplayer e2e', () => {
  test('host + guest connect through the real broker and exchange chat', async ({
    browser
  }) => {
    const hostContext = await browser.newContext();
    const guestContext = await browser.newContext();

    try {
      const hostPage = await openApp(hostContext);
      const guestPage = await openApp(guestContext);

      // Host starts a session.
      await startSessionPanel(hostPage)
        .locator('input.session-name')
        .fill('DM');
      await startSessionPanel(hostPage)
        .getByRole('button', { name: /host session/i })
        .click();
      await waitForActive(hostPage);

      const code = await readPairingCode(hostPage);
      expect(code).toMatch(/^[A-Z2-9]+$/);

      // Guest joins using the pairing code.
      await startSessionPanel(guestPage)
        .locator('input.session-name')
        .fill('Player');
      await startSessionPanel(guestPage).locator('input.session-code').fill(code);
      await startSessionPanel(guestPage)
        .getByRole('button', { name: /^join$/i })
        .click();
      await waitForActive(guestPage);

      // Both sides should show 1 peer (the other one).
      await expect(
        activeSessionPanel(hostPage).locator('.session-peers')
      ).toContainText(/1 peer/i, { timeout: 30000 });
      await expect(
        activeSessionPanel(guestPage).locator('.session-peers')
      ).toContainText(/1 peer/i, { timeout: 30000 });

      // Host sends a chat message.
      const chatInput = (page: Page) =>
        page.locator('quire-app').locator('.chat-form input');
      const chatList = (page: Page) =>
        page.locator('quire-app').locator('.chat-list');

      await chatInput(hostPage).fill('hello from the DM');
      await chatInput(hostPage).press('Enter');

      // Both sides see it.
      await expect(chatList(hostPage)).toContainText('hello from the DM', {
        timeout: 10000
      });
      await expect(chatList(guestPage)).toContainText('hello from the DM', {
        timeout: 10000
      });

      // Guest replies.
      await chatInput(guestPage).fill('hello back from the player');
      await chatInput(guestPage).press('Enter');
      await expect(chatList(hostPage)).toContainText(
        'hello back from the player',
        { timeout: 10000 }
      );
      await expect(chatList(guestPage)).toContainText(
        'hello back from the player',
        { timeout: 10000 }
      );
    } finally {
      await hostContext.close();
      await guestContext.close();
    }
  });
});
