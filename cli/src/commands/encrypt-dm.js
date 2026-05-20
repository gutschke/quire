// quire encrypt-dm: encrypt every file under any dm/ or DM-ONLY/ folder in a
// campaign using the campaign passphrase.
//
// Format (on disk, per file):
//   0x01                  1-byte format version
//   salt                  16 bytes
//   nonce                 24 bytes
//   ciphertext            crypto_secretbox_easy output (auth tag + cipher)
//
// Crypto:
//   key  = Argon2id (sodium.crypto_pwhash, INTERACTIVE limits) of passphrase + salt
//   cipher = XSalsa20-Poly1305 (sodium.crypto_secretbox_easy) with random nonce
//
// Behaviour:
//   - Prompts for the passphrase, asks for confirmation (unless
//     QUIRE_PASSPHRASE env var is set).
//   - Walks the campaign root; for each plaintext file under dm/ or DM-ONLY/,
//     writes <name>.qenc next to it and removes the plaintext.
//   - Existing <name>.qenc files are overwritten; the plaintext is treated as
//     the source of truth.

import { readFile, writeFile, unlink } from 'node:fs/promises';
import { getPassphrase, readSilently } from '../passphrase.js';
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
  if (!process.env.QUIRE_PASSPHRASE) {
    const confirm = await readSilently('Confirm:    ');
    if (passphrase !== confirm) {
      console.error('Passphrases do not match.');
      process.exit(1);
    }
  }
  if (!passphrase) {
    console.error('Empty passphrase.');
    process.exit(1);
  }

  const files = await walkDmFiles(root);
  if (files.length === 0) {
    console.log('No DM-only plaintext files found.');
    return;
  }

  for (const file of files) {
    const plaintext = await readFile(file);
    const salt = sodium.randombytes_buf(SALT_LEN);
    const key = sodium.crypto_pwhash(
      KEY_LEN, passphrase, salt,
      sodium.crypto_pwhash_OPSLIMIT_INTERACTIVE,
      sodium.crypto_pwhash_MEMLIMIT_INTERACTIVE,
      sodium.crypto_pwhash_ALG_ARGON2ID13
    );
    const nonce = sodium.randombytes_buf(NONCE_LEN);
    const ciphertext = sodium.crypto_secretbox_easy(plaintext, nonce, key);

    const blob = Buffer.concat([
      Buffer.from([VERSION]),
      Buffer.from(salt),
      Buffer.from(nonce),
      Buffer.from(ciphertext)
    ]);

    await writeFile(`${file}.qenc`, blob);
    await unlink(file);
    console.log(`encrypted: ${file}`);
  }

  console.log(`\nEncrypted ${files.length} file(s).`);
}
