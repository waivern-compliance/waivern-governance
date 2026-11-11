import { open } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { eq } from 'drizzle-orm';

import { db, sql as pg } from '@/db/client';
import { organisations } from '@/db/schema';
import { openOrganisationExport } from '@/services/organisation-export';

/**
 * The whole-organisation export, run by Waivern rather than by an owner.
 *
 *   pnpm export:organisation <slug> <file.zip> --operator <your email>
 *
 * For an organisation too large to download from the browser, or one whose
 * owners can no longer sign in during the export period the terms allow after
 * access ends. The same code as the Exports page, so the two archives cannot
 * differ; it is audited as the platform's act, with the operator named, and the
 * organisation's owners are notified just the same. There is no size limit and
 * no request to time out.
 */

function usage(message?: string): never {
  if (message) console.error(`\n${message}\n`);
  console.error(
    'Usage: pnpm export:organisation <slug> <file.zip> --operator <email>'
  );
  process.exit(1);
}

async function main() {
  const args = process.argv.slice(2);
  const at = args.indexOf('--operator');
  const operator = at >= 0 ? args[at + 1]?.trim() : undefined;
  const [slug, file] = args.filter(
    (_, i) => at < 0 || (i !== at && i !== at + 1)
  );
  if (!slug || !file) usage();
  if (!operator) usage('Say who is running it with --operator.');
  if (!file.endsWith('.zip')) usage('The file should end in .zip.');

  const [organisation] = await db
    .select({ id: organisations.id, name: organisations.name })
    .from(organisations)
    .where(eq(organisations.slug, slug));
  if (!organisation) usage(`No organisation with the slug "${slug}".`);

  // Before the export opens: never overwrite an earlier archive by mistake.
  const out = await open(file, 'wx', 0o600);

  const opened = await openOrganisationExport({
    organisationId: organisation.id,
    actor: {
      actorKind: 'system',
      actorUserId: null,
      actorLabel: 'export:organisation'
    },
    via: 'command line',
    maxBytes: null,
    operator
  });
  console.log(
    `Exporting ${organisation.name} (about ${Math.ceil(opened.estimatedBytes / 1024 / 1024)} MB held) to ${file}`
  );
  try {
    await pipeline(Readable.from(opened.stream()), out.createWriteStream());
  } finally {
    await opened.close();
  }
  console.log("Done. Recorded in the organisation's audit log.");
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => pg.end());
