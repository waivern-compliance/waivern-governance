import { eq } from 'drizzle-orm';

import { db, withOrganisation } from '@/db/client';
import { trials } from '@/db/schema';
import { TRIAL_REFUSAL, type TRIAL_WITHHELD } from '@/lib/trial';

/**
 * The services' own check that an organisation is not a trial, beneath the
 * capability an action asks for: nothing that uploads, or reaches somebody
 * outside, can be done for a trial by a path that forgot to ask. Its own
 * module so the services it guards need nothing else of trials.
 */

/** A refusal because the organisation is a trial: worded for the person trying it. */
export class TrialRestricted extends Error {}

/** Whether an organisation is a trial that has not been converted. */
export async function isTrial(organisationId: string): Promise<boolean> {
  const [trial] = await withOrganisation(organisationId, () =>
    db
      .select({ status: trials.status })
      .from(trials)
      .where(eq(trials.organisationId, organisationId))
  );
  return Boolean(trial && trial.status !== 'converted');
}

/** Refuse, whoever is asking, if the organisation is a trial. */
export async function refuseDuringTrial(
  organisationId: string,
  withheld: (typeof TRIAL_WITHHELD)[number]
): Promise<void> {
  if (await isTrial(organisationId))
    throw new TrialRestricted(TRIAL_REFUSAL[withheld]);
}
