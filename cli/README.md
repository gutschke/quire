# quire CLI

Node.js command-line tool for working with Quire campaign repositories.

## Status

v0.0.0. Only `quire lint` is functional. Other commands are documented stubs that exit with a clear not-yet-implemented notice.

## Install

Local development:

```
cd cli/
npm link
quire help
```

The CLI has no runtime dependencies in v0.0.0 (built-in Node modules only). Full schema validation via Ajv lands when v0.1.0 of the CLI ships.

## Commands

- **`quire lint <path>`** — Walk a campaign repo, check each known record file for `$schemaVersion` and `name`, and report warnings. Exits non-zero if any warnings are emitted. Validates:
  - `campaign.json` at the root.
  - Every `.json` file under `characters/pcs/`, `characters/npcs/`, `bestiary/`, `items/`, `spells/`.
  - Every `episodes/<slug>/episode.json`.

- **`quire encrypt-dm <path>`** — *(stub)* Will encrypt every episode's `dm/` subfolder using the campaign passphrase. See `src/commands/encrypt-dm.js` for the intended pipeline.

- **`quire decrypt-dm <path>`** — *(stub)* Counterpart to `encrypt-dm`.

- **`quire migrate <path>`** — Apply codemods to upgrade record schemas to the current major. In v0.1.0 this is a no-op because there is no prior major to migrate from.

- **`quire help`** — Show usage.

## Layout

```
cli/
├── bin/quire.js            shebang entry; delegates to src/main.js
├── src/
│   ├── main.js             dispatcher + help text
│   └── commands/
│       ├── lint.js
│       ├── encrypt-dm.js   stub
│       ├── decrypt-dm.js   stub
│       └── migrate.js
└── package.json
```

## License

MIT (see [../LICENSE](../LICENSE)).
