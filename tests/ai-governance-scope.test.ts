import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { after, describe, it } from 'node:test';
import { and, eq } from 'drizzle-orm';

import { db, sql as pg } from '@/db/client';
import {
  aiUseCases,
  auditEvents,
  countryRisk,
  entities,
  organisations,
  processingActivities,
  tasks
} from '@/db/schema';
import { AI_MAINTAIN, AI_SETUP } from '@/lib/guidance/steps';
import { navFor } from '@/lib/nav';
import type { Grant } from '@/lib/rbac';
import { gapsFor, lawsOfUseCase, listRegister } from '@/services/ai-register';
import { issueIntakeLink } from '@/services/dsr-intake';
import {
  anyEntityUnderDataProtectionLaw,
  anyEntityUnderEprivacy,
  anyEntityUnderUkLaw,
  setDataProtectionLaw,
  setOutsideDataProtectionLaw,
  setPublicAuthority
} from '@/services/entities';
import { derivedStage, guidanceFor } from '@/services/guidance';
import { programmeScope } from '@/services/programme-scope';
import { createActivity } from '@/services/ropa';
import { sweepOrganisation } from '@/services/sweep';

const SYSTEM = {
  actorKind: 'system' as const,
  actorUserId: null,
  actorLabel: 'AI governance scope test'
};

after(() => pg.end());

async function world(label: string, framework?: 'nist_ai_rmf') {
  const [org] = await db
    .insert(organisations)
    .values({
      name: `AI scope ${label}`,
      slug: `ais-${label}-${crypto.randomUUID().slice(0, 8)}`,
      ...(framework ? { aiFramework: framework } : {})
    })
    .returning();
  const [entity] = await db
    .insert(entities)
    .values({ organisationId: org.id, name: 'Acme Inc', isDefault: true })
    .returning();
  return { org, entity };
}

async function usOnly(label: string, framework?: 'nist_ai_rmf') {
  const w = await world(label, framework);
  await setOutsideDataProtectionLaw({
    organisationId: w.org.id,
    entityId: w.entity.id,
    actor: SYSTEM
  });
  return w;
}

const admin: Grant[] = [{ role: 'privacy_admin', scope: 'organisation' }];

describe('an entity under neither UK nor EU data protection law', () => {
  it('takes the privacy programme out of scope, and nothing else', async () => {
    const w = await usOnly('scope');
    assert.equal(await anyEntityUnderDataProtectionLaw(w.org.id), false);
    assert.equal(await anyEntityUnderUkLaw(w.org.id), false);
    assert.equal(await anyEntityUnderEprivacy(w.org.id), false);
    const scope = await programmeScope(w.org.id);
    assert.equal(scope.privacy, false);
    assert.equal(scope.ukLaw, false);
  });

  it('keeps the privacy programme in scope while any entity is under a law', async () => {
    const w = await usOnly('mixed');
    await db
      .insert(entities)
      .values({ organisationId: w.org.id, name: 'Acme UK Ltd' });
    assert.equal((await programmeScope(w.org.id)).privacy, true);
  });

  it('records the change in the audit trail', async () => {
    const w = await usOnly('audit');
    const events = await db
      .select()
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.organisationId, w.org.id),
          eq(auditEvents.action, 'entity.data_protection_law_changed')
        )
      );
    assert.equal(events.length, 1);
    assert.deepEqual(events[0].after, { dataProtectionLawApplies: false });
  });

  it('refuses while the entity holds a processing record', async () => {
    const w = await world('holds');
    await createActivity({
      organisationId: w.org.id,
      entityId: w.entity.id,
      name: 'Payroll',
      actor: SYSTEM
    });
    await assert.rejects(
      setOutsideDataProtectionLaw({
        organisationId: w.org.id,
        entityId: w.entity.id,
        actor: SYSTEM
      }),
      /holds records kept under data protection law/
    );
  });

  it('refuses while the entity is marked as something only the law knows', async () => {
    const w = await world('status');
    await setPublicAuthority({
      organisationId: w.org.id,
      entityId: w.entity.id,
      publicAuthority: true,
      actor: SYSTEM
    });
    await assert.rejects(
      setOutsideDataProtectionLaw({
        organisationId: w.org.id,
        entityId: w.entity.id,
        actor: SYSTEM
      }),
      /a public authority/
    );
  });

  it('refuses while a request form is still open', async () => {
    const w = await world('form');
    await issueIntakeLink({
      organisationId: w.org.id,
      entityId: w.entity.id,
      label: 'Website',
      actor: SYSTEM
    });
    await assert.rejects(
      setOutsideDataProtectionLaw({
        organisationId: w.org.id,
        entityId: w.entity.id,
        actor: SYSTEM
      }),
      /Website/
    );
  });

  it('refuses privacy records for it, in words for the person', async () => {
    const w = await usOnly('records');
    const said = /neither UK nor EU data protection law/;
    await assert.rejects(
      createActivity({
        organisationId: w.org.id,
        entityId: w.entity.id,
        name: 'Payroll',
        actor: SYSTEM
      }),
      said
    );
    await assert.rejects(
      issueIntakeLink({
        organisationId: w.org.id,
        entityId: w.entity.id,
        label: 'Website',
        actor: SYSTEM
      }),
      said
    );
  });

  it('is held by the database where a service does not check', async () => {
    const w = await usOnly('trigger');
    await assert.rejects(
      db.insert(processingActivities).values({
        organisationId: w.org.id,
        entityId: w.entity.id,
        reference: 'ROPA-2026-0001',
        name: 'Payroll'
      }),
      (e: unknown) =>
        /neither UK nor EU data protection law/.test(
          String((e as { cause?: { message?: string } }).cause?.message ?? e)
        )
    );
  });

  it('comes back under a law when one is chosen again', async () => {
    const w = await usOnly('back');
    const after = await setDataProtectionLaw({
      organisationId: w.org.id,
      entityId: w.entity.id,
      law: 'uk',
      actor: SYSTEM
    });
    assert.equal(after.dataProtectionLawApplies, true);
    assert.equal(await anyEntityUnderUkLaw(w.org.id), true);
  });
});

describe('the country library reminder', () => {
  // An organisation's own country row, due now, so the library is due for it
  // whatever state the shared rows are in.
  async function dueCountry(organisationId: string) {
    const now = new Date();
    await db.insert(countryRisk).values({
      organisationId,
      code: 'BR',
      name: 'Brazil',
      ukAdequacy: 'not_adequate',
      euAdequacy: 'not_adequate',
      reviewedAt: now,
      reviewedBy: 'test',
      nextReviewAt: now
    });
  }

  const reminders = (organisationId: string) =>
    db
      .select({ status: tasks.status })
      .from(tasks)
      .where(
        and(
          eq(tasks.organisationId, organisationId),
          eq(tasks.subjectType, 'country_risk')
        )
      );

  it('is raised where an entity is under a law', async () => {
    const w = await world('countries-under');
    await dueCountry(w.org.id);
    await sweepOrganisation(w.org.id);
    assert.deepEqual(await reminders(w.org.id), [{ status: 'open' }]);
  });

  it('is not raised where no entity is under either law', async () => {
    const w = await usOnly('countries-neither');
    await dueCountry(w.org.id);
    const result = await sweepOrganisation(w.org.id);
    assert.equal(result.countryReviewsRaised, 0);
    assert.deepEqual(await reminders(w.org.id), []);
  });

  it('is cancelled once no entity is under either law, not marked done', async () => {
    const w = await world('countries-left');
    await dueCountry(w.org.id);
    await sweepOrganisation(w.org.id);
    await setOutsideDataProtectionLaw({
      organisationId: w.org.id,
      entityId: w.entity.id,
      actor: SYSTEM
    });
    await sweepOrganisation(w.org.id);
    assert.deepEqual(await reminders(w.org.id), [{ status: 'cancelled' }]);
    const events = await db
      .select({ action: auditEvents.action })
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.organisationId, w.org.id),
          eq(auditEvents.subjectType, 'task')
        )
      );
    assert.deepEqual(events.map((e) => e.action).sort(), [
      'task.cancelled',
      'task.raised'
    ]);
  });

  it('comes back the same month once an entity is under a law again', async () => {
    const w = await world('countries-back');
    await dueCountry(w.org.id);
    await sweepOrganisation(w.org.id);
    await setOutsideDataProtectionLaw({
      organisationId: w.org.id,
      entityId: w.entity.id,
      actor: SYSTEM
    });
    await sweepOrganisation(w.org.id);
    await setDataProtectionLaw({
      organisationId: w.org.id,
      entityId: w.entity.id,
      law: 'uk',
      actor: SYSTEM
    });
    await sweepOrganisation(w.org.id);
    const statuses = (await reminders(w.org.id)).map((r) => r.status).sort();
    assert.deepEqual(statuses, ['cancelled', 'open']);
  });
});

describe('what the navigation offers an organisation doing AI governance alone', () => {
  const offered = (privacy: boolean, ukLaw = privacy) =>
    navFor(admin, { privacy, ukLaw, eprivacy: privacy }).map((i) => i.href);

  it('leaves out the privacy programme', () => {
    const hrefs = offered(false);
    for (const href of [
      '/app/ropa',
      '/app/requests',
      '/app/breaches',
      '/app/complaints',
      '/app/countries',
      '/app/authorities',
      '/app/cookies',
      '/app/marketing'
    ])
      assert.ok(!hrefs.includes(href), `${href} is offered`);
  });

  it('offers the AI governance pages', () => {
    const hrefs = offered(false);
    for (const href of [
      '/app/ai',
      '/app/ai/intake',
      '/app/ai/incidents',
      '/app/ai/profile',
      '/app/risks',
      '/app/third-parties'
    ])
      assert.ok(hrefs.includes(href), `${href} is not offered`);
  });

  it('offers complaints wherever either law applies, since EU complaints are kept there too', () => {
    assert.ok(offered(true, false).includes('/app/complaints'));
    assert.ok(!offered(false, false).includes('/app/complaints'));
  });
});

describe("an AI system's laws", () => {
  const automated = {
    id: crypto.randomUUID(),
    lifecycleStage: 'production',
    ownerId: crypto.randomUUID(),
    nextReviewAt: null,
    automatedDecisions: true,
    admSpecialCategory: null
  } as unknown as typeof aiUseCases.$inferSelect;

  it('are none where its entity is under neither law and no processing is linked', () => {
    assert.equal(lawsOfUseCase([], { law: 'uk', applies: false }), null);
  });

  it('follow linked processing even where its entity is under neither', () => {
    assert.equal(lawsOfUseCase(['eu'], { law: 'uk', applies: false }), 'eu');
  });

  it('raise no Article 22 gaps under neither law', () => {
    const gaps = gapsFor(automated, null, { laws: null });
    assert.ok(!gaps.some((g) => g.startsWith('adm_')), gaps.join(', '));
    assert.ok(
      gapsFor(automated, null, { laws: 'uk' }).some((g) => g.startsWith('adm_'))
    );
  });

  it('are read from the entity on the register', async () => {
    const w = await usOnly('register');
    await db.insert(aiUseCases).values({
      organisationId: w.org.id,
      entityId: w.entity.id,
      reference: 'AI-2026-0001',
      name: 'CV screening',
      purpose: 'Ranks applicants for interview.',
      systemType: 'predictive',
      provenance: 'third_party_api',
      lifecycleStage: 'production',
      automatedDecisions: true
    });
    const [entry] = await listRegister(w.org.id, null);
    assert.ok(!entry.gaps.some((g) => g.startsWith('adm_')));
  });
});

describe('the guide for AI governance alone', () => {
  const all = [...AI_SETUP, ...AI_MAINTAIN];

  it('gives every step a function, a reason and a screen that exists', () => {
    for (const step of all) {
      assert.ok(step.fn, `${step.id} has no NIST function`);
      assert.ok(step.why.length > 40, `${step.id} needs a reason`);
      for (const href of [step.href, step.also?.href].filter(
        (href): href is string => href !== undefined
      )) {
        const page = `src/app/app/${href.split('?')[0].replace(/^\/app\//, '')}/page.tsx`;
        assert.ok(existsSync(page), `${step.id} links to a missing ${page}`);
      }
    }
  });

  it('asks for nothing only data protection law requires', () => {
    for (const step of all) {
      const text = `${step.title} ${step.what} ${step.why} ${step.finishedWhen}`;
      assert.doesNotMatch(
        text,
        /DPIA|Article 30|processing activit|lawful basis|data subject|breach|Information Commission/i,
        `${step.id} asks for something from the privacy programme`
      );
    }
  });

  it('is what an organisation under neither law is shown', async () => {
    const w = await usOnly('guide');
    const g = await guidanceFor({ organisationId: w.org.id, chosen: null });
    assert.equal(g.programme, 'ai');
    assert.ok(g.steps.every((s) => s.id.startsWith('ai-')));
    assert.ok(!g.steps.some((s) => s.id === 'ai-profile'));
    assert.equal(g.functions, false);
  });

  it('shows the NIST functions and the profile step under the NIST AI RMF', async () => {
    const w = await usOnly('nist', 'nist_ai_rmf');
    const g = await guidanceFor({ organisationId: w.org.id, chosen: null });
    assert.equal(g.functions, true);
    assert.ok(g.steps.some((s) => s.id === 'ai-profile'));
  });

  it('keeps the privacy guide wherever an entity is under a law', async () => {
    const w = await world('privacy-guide');
    const g = await guidanceFor({ organisationId: w.org.id, chosen: null });
    assert.equal(g.programme, 'privacy');
    assert.ok(g.steps.some((s) => s.id === 'activities'));
  });

  it('does not count a retired system against assessing every one', async () => {
    const w = await usOnly('retired');
    await db.insert(aiUseCases).values({
      organisationId: w.org.id,
      entityId: w.entity.id,
      reference: 'AI-2026-0001',
      name: 'Old chatbot',
      purpose: 'Answered questions, before it was switched off.',
      systemType: 'generative',
      provenance: 'third_party_api',
      lifecycleStage: 'retired'
    });
    const g = await guidanceFor({ organisationId: w.org.id, chosen: 'setup' });
    const step = g.steps.find((s) => s.id === 'ai-assessments')!;
    assert.match(step.measure, /^0 of 0 systems in use/);
  });

  it('moves on from setting up without a processing register', () => {
    const t = { activities: 0, approved: 1, ai: 2, aiAssessed: 1 };
    assert.equal(derivedStage(t, 'ai'), 'maintain');
    assert.equal(derivedStage(t, 'privacy'), 'setup');
    assert.equal(derivedStage({ ...t, aiAssessed: 0 }, 'ai'), 'setup');
  });
});
