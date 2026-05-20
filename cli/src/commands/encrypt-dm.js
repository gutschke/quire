// quire encrypt-dm: encrypt every episode's dm/ subfolder with the campaign
// passphrase using age-style sealed boxes (libsodium).
//
// Phase 0 stub — the encryption pipeline arrives in phase 1 alongside the
// browser-side decrypt path.  Until then this command exits with a clear
// not-yet-implemented notice rather than pretending to do something.
//
// Intended invocation:
//   quire encrypt-dm <campaign-root>
//
// Intended behaviour:
//   - Prompt for the campaign passphrase (or read from QUIRE_PASSPHRASE).
//   - Derive an encryption key via Argon2id.
//   - Walk episodes/*/dm/ recursively; encrypt each .json or .md file in
//     place to <name>.json.age / <name>.md.age and remove the cleartext.
//   - Refuse to run if the passphrase is empty or matches a known weak list.
//   - Refuse to run if any non-dm/ file contains the <untrusted_content>
//     sentinel literal — that's a load-time invariant that would otherwise
//     be silently embedded into encrypted content.

export async function run(args) {
  console.error('quire encrypt-dm: not yet implemented (phase 0 stub).');
  console.error('Encryption tooling lands in phase 1.  See src/commands/encrypt-dm.js');
  console.error('for the intended behaviour.');
  process.exit(64);
}
