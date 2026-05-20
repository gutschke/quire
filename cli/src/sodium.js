// libsodium-wrappers-sumo 0.7.16/0.8.4 ships a broken ESM entry (its .mjs
// references a sibling .mjs file that the package's files: glob does not
// include).  The CJS entry works fine, so we load it via createRequire from
// our ESM modules.
//
// Both encrypt-dm and decrypt-dm import `loadSodium` from this file and await
// the ready promise before touching any crypto.

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

let cached = null;

export async function loadSodium() {
  if (cached) return cached;
  const sodium = require('libsodium-wrappers-sumo');
  await sodium.ready;
  cached = sodium;
  return sodium;
}
