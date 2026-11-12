import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { and, eq } from 'drizzle-orm';

import { db, sql as pg } from '@/db/client';
import { entities, organisations, tasks } from '@/db/schema';
import {
  irishBasesFor,
  irishMarketingGapsOf,
  type IrishMarketingGapInput
} from '@/lib/ie-eprivacy/marketing';
import { setDataProtectionLaw, setIeEprivacy } from '@/services/entities';
import {
  activitiesDueNddScreening,
  activitiesDueTpsScreening,
  createMarketingActivity,
  loadMarketingActivity,
  MarketingRefused,
  recordMarketingDecision,
  recordNddScreening,
  updateMarketingActivity
} from '@/services/marketing';
import { sweepOrganisation } from '@/services/sweep';

const SYSTEM = {
  actorKind: 'system' as const,
  actorUserId: null,
  actorLabel: 'Irish marketing test'
};

after(() => pg.end());

async function world(label: string) {
  const [org] = await db
    .insert(organisations)
    .values({
      name: `IE marketing ${label}`,
      slug: `iem-${label}-${crypto.randomUUID().slice(0, 8)}`
    })
    .returning();
  const [entity] = await db
    .insert(entities)
    .values({ organisationId: org.id, name: 'Shop Ltd', isDefault: true })
    .returning();
  await setDataProtectionLaw({
    organisationId: org.id,
    entityId: entity.id,
    law: 'uk_eu',
    actor: SYSTEM
  });
  await setIeEprivacy({
    organisationId: org.id,
    entityId: entity.id,
    applies: true,
    actor: SYSTEM
  });
  return { org, entity };
}

const activity = (
  w: Awaited<ReturnType<typeof world>>,
  channel: 'email' | 'sms' | 'live_call' | 'automated_call',
  scope: 'uk' | 'ie' | 'uk_ie',
  recipients: 'individuals' | 'businesses' = 'individuals'
) =>
  createMarketingActivity({
    organisationId: w.org.id,
    entityId: w.entity.id,
    name: `${channel} ${scope}`,
    channel,
    recipients,
    eprivacyScope: scope,
    actor: SYSTEM
  });

const decide = (
  w: Awaited<ReturnType<typeof world>>,
  activityId: string,
  basis: Parameters<typeof recordMarketingDecision>[0]['basis'],
  law: 'uk' | 'ie',
  conditions: string[] = []
) =>
  recordMarketingDecision({
    activityId,
    organisationId: w.org.id,
    basis,
    conditions,
    rationale: 'Because.',
    law,
    actor: SYSTEM
  });

describe('the Irish marketing rules, on their own', () => {
  it('offers the bases regulation 13 has, by channel and recipient', () => {
    assert.deepEqual(irishBasesFor('email', 'individuals'), [
      'consent',
      'soft_opt_in',
      'business_address',
      'none'
    ]);
    assert.deepEqual(irishBasesFor('email', 'businesses'), [
      'consent',
      'soft_opt_in',
      'not_objected',
      'none'
    ]);
    assert.deepEqual(irishBasesFor('live_call', 'individuals'), [
      'consent',
      'ndd_screened',
      'none'
    ]);
    assert.deepEqual(irishBasesFor('automated_call', 'businesses'), [
      'consent',
      'not_objected',
      'none'
    ]);
  });

  const base: IrishMarketingGapInput['activity'] = {
    channel: 'email',
    recipients: 'individuals',
    status: 'active',
    callNumbers: null,
    nddScreenedAt: null,
    inServiceTexts: null
  };
  const kinds = (input: IrishMarketingGapInput) =>
    irishMarketingGapsOf(input).map((g) => g.kind);

  it('makes an unrecorded consent a serious gap, and asks the twelve-month rule', () => {
    const gaps = irishMarketingGapsOf({
      activity: base,
      decision: {
        basis: 'consent',
        conditions: {
          consent_specific: true,
          consent_withdrawable: true,
          contact_identified: true
        }
      }
    });
    assert.deepEqual(
      gaps.map((g) => g.kind),
      ['consent_unrecorded']
    );
    assert.match(gaps[0].text, /13\(14\)/);
    const soft = irishMarketingGapsOf({
      activity: base,
      decision: {
        basis: 'soft_opt_in',
        conditions: {
          obtained_in_sale: true,
          similar_products: true,
          refusal_at_collection: true,
          refusal_every_message: true,
          contact_identified: true
        }
      }
    });
    assert.equal(soft.length, 1);
    assert.match(soft[0].text, /twelve months of the sale/);
  });

  it('wants consent for mobiles and service texts, and screening for landlines', () => {
    const call = { ...base, channel: 'live_call' as const };
    assert.deepEqual(kinds({ activity: call, decision: null }), [
      'call_numbers_unknown',
      'no_basis'
    ]);
    const screened = {
      basis: 'ndd_screened' as const,
      conditions: { no_prior_objection: true, contact_identified: true }
    };
    assert.deepEqual(
      kinds({
        activity: { ...call, callNumbers: 'both' },
        decision: screened
      }),
      ['mobile_needs_consent', 'ndd_never']
    );
    const longAgo = new Date(Date.now() - 40 * 86_400_000);
    assert.deepEqual(
      kinds({
        activity: { ...call, callNumbers: 'landline', nddScreenedAt: longAgo },
        decision: screened
      }),
      ['ndd_stale']
    );
    assert.deepEqual(
      kinds({
        activity: { ...base, channel: 'sms', inServiceTexts: true },
        decision: {
          basis: 'soft_opt_in',
          conditions: {
            obtained_in_sale: true,
            similar_products: true,
            refusal_at_collection: true,
            refusal_every_message: true,
            within_12_months: true,
            contact_identified: true
          }
        }
      }),
      ['service_texts']
    );
  });
});

describe('the Irish rules on the marketing register', () => {
  it('records a basis per law, and refuses one Irish law does not have', async () => {
    const w = await world('both');
    const email = await activity(w, 'email', 'uk_ie');
    await assert.rejects(
      decide(w, email.id, 'charity_soft_opt_in', 'ie'),
      /no charity soft opt-in/
    );
    await decide(w, email.id, 'charity_soft_opt_in', 'uk');
    await decide(w, email.id, 'soft_opt_in', 'ie');
    const loaded = (await loadMarketingActivity(email.id, w.org.id))!;
    assert.equal(loaded.decision?.basis, 'charity_soft_opt_in');
    assert.equal(loaded.irishDecision?.basis, 'soft_opt_in');
    const lawGaps = loaded.gaps.filter(
      (g) => !/ROPA/.test(g) && !/objection/.test(g)
    );
    assert.ok(lawGaps.every((g) => /^(PECR|Irish Regulations): /.test(g)));
  });

  it('refuses a law the activity does not answer to', async () => {
    const w = await world('uk-only');
    const email = await activity(w, 'email', 'uk');
    await assert.rejects(
      decide(w, email.id, 'consent', 'ie'),
      /not recorded as under the Irish Regulations/
    );
    const calls = await activity(w, 'live_call', 'uk');
    await assert.rejects(
      recordNddScreening({
        activityId: calls.id,
        organisationId: w.org.id,
        screenedAt: new Date(),
        actor: SYSTEM
      }),
      /National Directory Database does not apply/
    );
    await assert.rejects(
      updateMarketingActivity({
        activityId: email.id,
        organisationId: w.org.id,
        changes: { callNumbers: 'satellite' as never },
        actor: SYSTEM
      }),
      MarketingRefused
    );
  });

  it('reminds about National Directory Database screening, and closes the reminder', async () => {
    const w = await world('ndd');
    const calls = await activity(w, 'live_call', 'ie');
    await decide(w, calls.id, 'ndd_screened', 'ie', ['no_prior_objection']);
    assert.deepEqual(
      (await activitiesDueNddScreening(w.org.id)).map((r) => r.activity.id),
      [calls.id]
    );
    assert.equal((await sweepOrganisation(w.org.id)).nddScreeningsRaised, 1);
    await recordNddScreening({
      activityId: calls.id,
      organisationId: w.org.id,
      screenedAt: new Date(),
      actor: SYSTEM
    });
    assert.deepEqual(await activitiesDueNddScreening(w.org.id), []);
    const [task] = await db
      .select()
      .from(tasks)
      .where(
        and(
          eq(tasks.subjectId, calls.id),
          eq(tasks.type, 'marketing_ndd_screening')
        )
      );
    assert.equal(task.status, 'done');
  });

  it('screens against the TPS on the PECR basis alone', async () => {
    const w = await world('tps');
    const calls = await activity(w, 'live_call', 'uk_ie');
    await decide(w, calls.id, 'consent', 'uk');
    await decide(w, calls.id, 'ndd_screened', 'ie');
    assert.deepEqual(await activitiesDueTpsScreening(w.org.id), []);
    await decide(w, calls.id, 'screened_calls', 'uk');
    assert.deepEqual(
      (await activitiesDueTpsScreening(w.org.id)).map((r) => r.activity.id),
      [calls.id]
    );
  });
});
