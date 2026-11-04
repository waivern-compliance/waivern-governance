/**
 * What Waivern does as the operator of its hosted service, as opposed to what
 * the code does wherever it runs.
 *
 * The code is open source, so anybody may run it. The security page describes
 * the code's own protections to everyone, but the hosting, the backups and the
 * offer of a dedicated instance are Waivern's promises, true only where Waivern
 * runs it. A copy on someone else's servers that told its users Waivern backs
 * them up every day would be telling them something false, so those sections
 * appear only when `WAIVERN_HOSTED` is "true".
 */

export function waivernHosted(
  env: Record<string, string | undefined> = process.env
): boolean {
  return env.WAIVERN_HOSTED === 'true';
}

/** Where the hosted service runs. Change this with the deployment, not after it. */
export const HOSTED = {
  provider: 'Railway',
  region: 'EU West (Amsterdam)',
  backups: 'daily',
  /** Who to write to about security, a dedicated instance, or anything else. */
  contact: 'info@waivern.com'
} as const;
