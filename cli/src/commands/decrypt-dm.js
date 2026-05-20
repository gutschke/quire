// quire decrypt-dm: decrypt every .qenc file under dm/ or DM-ONLY/ folders
// using the campaign passphrase.  Counterpart to encrypt-dm.
//
// Refuses to overwrite an existing plaintext file (the DM may be mid-edit).
// Re-encrypt with `quire encrypt-dm` to dispose of the unencrypted copy.

import { readFile, writeFile, unlink, access } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { getPassphrase } from '../passphrase.js';
import { walkDmFiles } from '../dm-walk.js';
import { loadSodium } from '../sodium.js';

const VERSION = 0x01;
const SALT_LEN = 16;
const NONCE_LEN = 24;
const KEY_LEN = 32;

export async function run(args) {
  const root = args[0] || '.';
  const sodium = await loadSodium();

  const passphrase = await getPassphrase('Passphrase: ');
  if (!passphrase) {
    console.error('Empty passphrase.');
    process.exit(1);
  }

  const files = await walkDmFiles(root, { includeQenc: true });
  if (files.length === 0) {
    console.log('No encrypted DM-only files found.');
    return;
  }

  let failed = 0;
  for (const file of files) {
    const blob = await readFile(file);
    if (blob.length < 1 + SALT_LEN + NONCE_LEN + 16) {
      console.error(`${file}: file too short to be a valid .qenc`);
      failed++;
      continue;
    }
    if (blob[0] !== VERSION) {
      console.error(`${file}: unknown format version 0x${blob[0].toString(16)}`);
      failed++;
      continue;
    }
    const salt = blob.subarray(1, 1 + SALT_LEN);
    const nonce = blob.subarray(1 + SALT_LEN, 1 + SALT_LEN + NONCE_LEN);
    const ciphertext = blob.subarray(1 + SALT_LEN + NONCE_LEN);

    const key = sodium.crypto_pwhash(
      KEY_LEN, passphrase, salt,
      sodium.crypto_pwhash_OPSLIMIT_INTERACTIVE,
      sodium.crypto_pwhash_MEMLIMIT_INTERACTIVE,
      sodium.crypto_pwhash_ALG_ARGON2ID13
    );

    let plaintext;
    try {
      plaintext = sodium.crypto_secretbox_open_easy(ciphertext, nonce, key);
    } catch (e) {
      console.error(`${file}: decryption failed (wrong passphrase or corrupted)`);
      failed++;
      continue;
    }

    const outputPath = file.slice(0, -'.qenc'.length);

    // Refuse to clobber existing plaintext — the DM may be mid-edit.
    try {
      await access(outputPath, fsConstants.F_OK);
      console.error(`${outputPath}: plaintext already exists; refusing to overwrite.`);
      console.error(`  Resolve manually, then re-run \`quire decrypt-dm\`.`);
      failed++;
      continue;
    } catch (e) {
      if (e.code !== 'ENOENT') {
        console.error(`${outputPath}: ${e.message}`);
        failed++;
        continue;
      }
    }

    await writeFile(outputPath, Buffer.from(plaintext));
    await unlink(file);
    console.log(`decrypted: ${outputPath}`);
  }

  if (failed > 0) {
    console.error(`\n${failed} file(s) failed.`);
    process.exit(1);
  }
  console.log(`\nDecrypted ${files.length} file(s).`);
}
