// Read a passphrase from stdin without echoing characters.  Returns whatever
// is set in QUIRE_PASSPHRASE when present (useful for automation and CI),
// otherwise prompts interactively.
//
// The mute trick: we hand readline a Writable whose write() is suppressed
// once the prompt has been printed.  This is the standard Node pattern for
// hidden-input prompts.

import { createInterface } from 'node:readline';
import { Writable } from 'node:stream';

export async function getPassphrase(prompt) {
  if (process.env.QUIRE_PASSPHRASE !== undefined) {
    return process.env.QUIRE_PASSPHRASE;
  }
  return readSilently(prompt);
}

export function readSilently(prompt) {
  return new Promise((resolve, reject) => {
    const muted = new Writable({
      write(chunk, encoding, callback) {
        if (!this.muted) process.stdout.write(chunk, encoding);
        callback();
      }
    });
    muted.muted = false;

    const rl = createInterface({
      input: process.stdin,
      output: muted,
      terminal: true
    });

    process.stdout.write(prompt);
    muted.muted = true;

    rl.on('error', reject);
    rl.question('', (value) => {
      rl.close();
      process.stdout.write('\n');
      resolve(value);
    });
  });
}
