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
  encrypt-dm <path>     Encrypt every episode's dm/ subfolder.        (stub)
  decrypt-dm <path>     Decrypt previously-encrypted dm/ content.      (stub)
  migrate <path>        Apply codemods to upgrade record schemas.
  help                  Show this message.

Status: v0.0.0 — only \`lint\` is implemented.  \`encrypt-dm\` and
\`decrypt-dm\` are stubs that print a not-yet-implemented notice.
\`migrate\` is a no-op until v0.2 ships and the codemod registry has
its first entry.

Run \`quire <command> --help\` for command-specific help (where
available).`);
}
