# quire CLI

Node.js command-line tool for working with Quire campaign repositories.

## Status

v0.1.0. `quire lint`, `quire encrypt-dm`, and `quire decrypt-dm` are functional. `quire migrate` is a no-op until v0.2 of the schemas ships.

## Install

Local development:

```
cd cli/
npm install
npm link
quire help
```

Requires Node 18 or newer.

## Commands

### `quire lint <path>`

Walks a campaign repo, validates every recognized record against the v0.1 JSON Schemas with Ajv, and reports warnings. Exits non-zero if any warnings are emitted. Validates:

- `campaign.json` at the root.
- Every `.json` file under `characters/pcs/`, `characters/npcs/`, `bestiary/`, `items/`, `spells/`.
- Every `episodes/<slug>/episode.json`.

### `quire encrypt-dm <path>`

Encrypts every plaintext file under any `dm/` or `DM-ONLY/` folder using a campaign passphrase.

- Prompts interactively for the passphrase and a confirmation; set `QUIRE_PASSPHRASE` in the environment to skip both prompts (useful for CI / automation).
- For each file: writes `<name>.qenc` next to the plaintext, then removes the plaintext on successful write.
- Pre-existing `<name>.qenc` files are overwritten; the plaintext is treated as the source of truth.

File format:

```
0x01                  1-byte format version
salt                  16 random bytes
nonce                 24 random bytes
ciphertext            crypto_secretbox_easy output (XSalsa20-Poly1305)
```

Key derivation is Argon2id (`crypto_pwhash`, INTERACTIVE limits) of passphrase + salt.

### `quire decrypt-dm <path>`

Counterpart to `encrypt-dm`. Walks the campaign for `.qenc` files under `dm/` / `DM-ONLY/`, decrypts, and writes the plaintext next to the encrypted file. Removes the `.qenc` after a successful write.

**Refuses to overwrite an existing plaintext file.** If both `<name>` and `<name>.qenc` exist, the DM may be mid-edit; the tool reports the conflict and exits non-zero. Resolve manually before re-running.

Wrong passphrase produces an authentication failure (libsodium's MAC check) rather than silent garbage output.

### `quire migrate <path>`

Applies codemods to upgrade record schemas to the current major. In v0.1.0 this is a no-op because there is no prior major to migrate from. Wires up when v0.2 ships and `quire/schema/codemods/` has its first entry.

### `quire help`

Show usage.

## Layout

```
cli/
├── bin/quire.js            shebang entry; delegates to src/main.js
├── src/
│   ├── main.js             dispatcher + help text
│   ├── passphrase.js       hidden-input stdin reader + env-var fallback
│   ├── sodium.js           libsodium-wrappers-sumo loader (via createRequire)
│   ├── dm-walk.js          shared walk over dm/ and DM-ONLY/ trees
│   └── commands/
│       ├── lint.js
│       ├── encrypt-dm.js
│       ├── decrypt-dm.js
│       └── migrate.js
└── package.json
```

## Dependencies

- `ajv` and `ajv-formats` for schema validation.
- `libsodium-wrappers-sumo` for Argon2id + XSalsa20-Poly1305. Loaded via `createRequire` because the package's published ESM entry currently references a missing sibling file; the CJS entry works fine.

## License

MIT (see [../LICENSE](../LICENSE)).
