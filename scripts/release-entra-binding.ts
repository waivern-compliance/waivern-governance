import { sql as pg } from '@/db/client';
import { releaseEntraBinding } from '@/services/entra-sign-in';

/**
 * Release the Microsoft account a person is bound to, so their next Microsoft
 * sign-in binds afresh. For when their account was replaced, such as after
 * leaving and rejoining an employer. Only the deployment's operator can run
 * this; see `releaseEntraBinding` for why no owner can.
 *
 *   pnpm entra:release person@example.com
 */
async function main() {
  const email = process.argv[2];
  if (!email?.includes('@')) {
    console.error('Usage: pnpm entra:release <email>');
    process.exit(1);
  }
  const released = await releaseEntraBinding(
    email,
    `operator (${process.env.USER ?? 'unknown'})`
  );
  console.log(
    released
      ? `Released ${released}. The next Microsoft sign-in at ${email} binds afresh, under the usual rules for a first sign-in.`
      : `${email} is not bound to a Microsoft account. Nothing to do.`
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => pg.end());
