const COMMANDS = ['lint', 'encrypt-dm', 'decrypt-dm', 'migrate', 'help'];

export async function main(argv) {
  const [cmd, ...rest] = argv;

  if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') {
    printHelp();
    return;
  }

  if (!COMMANDS.includes(cmd)) {
    console.error(`Unknown command: ${cmd}\n`);
    printHelp();
    process.exit(2);
  }

  const mod = await import(`./commands/${cmd}.js`);
  await mod.run(rest);
}

function printHelp() {
  console.log(`quire — TTRPG framework CLI

Usage: quire <command> [args]

Commands:
  lint <path>           Validate a campaign repository against v0 schemas.
  encrypt-dm <path>     Encrypt every dm/ and DM-ONLY/ file with the
                        campaign passphrase.  Plaintext files are removed
                        after successful encryption.
  decrypt-dm <path>     Decrypt every .qenc file under dm/ and DM-ONLY/
                        using the passphrase.  Refuses to overwrite an
                        existing plaintext file (DM may be mid-edit).
  migrate <path>        Apply codemods to upgrade record schemas.
  help                  Show this message.

Status: lint, encrypt-dm, decrypt-dm functional.  migrate is a no-op
until v0.2 ships and the codemod registry has its first entry.

For automation: set QUIRE_PASSPHRASE in the environment to skip the
interactive passphrase prompt (encrypt-dm also skips its confirm
prompt when QUIRE_PASSPHRASE is set).`);
}
