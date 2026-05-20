// quire migrate: walk a campaign repo and apply codemods to upgrade every
// record's $schemaVersion to the current major.
//
// In v0.1.0 the current major IS the only major — there is no prior version
// to migrate from, so this command is a no-op that reports as much.
//
// When v0.2 ships with a breaking change, codemods land under
// quire/schema/codemods/0.1-to-0.2/, the registry is wired in here, and this
// command starts applying them.

export async function run(args) {
  console.log('No migrations available: v0.1.0 is the current major and no');
  console.log('prior version exists to migrate from.  Codemods land in');
  console.log('quire/schema/codemods/ when v0.2 ships.');
}
