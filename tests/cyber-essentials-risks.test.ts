import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { and, eq } from 'drizzle-orm';

import { db, sql as pg } from '@/db/client';
import {
  entities,
  mitigations,
  organisations,
  recordLinks,
  templates,
  templateVersions
} from '@/db/schema';
import {
  AI_FRAMEWORKS,
  categoryLabel,
  isKnownCategory,
  sourceOfSuggestion,
  suggestionByKey,
  treatmentsFor
} from '@/lib/ai-frameworks';
import { refileCategory } from '@/lib/ai-frameworks/crosswalk';
import { parseControlRef } from '@/lib/cyber-essentials/control-ref';
import { readinessOf, treatingNow } from '@/lib/cyber-essentials/readiness';
import { CE_THEMES } from '@/lib/cyber-essentials/requirements';
import { CE_TREATMENTS } from '@/lib/cyber-essentials/treatments';
import { appetiteGuidanceFor, scopesFor } from '@/lib/risk/appetite';
import { CYBER_ESSENTIALS_READINESS } from '@/lib/templates/library/cyber-essentials-readiness';
import { evaluate, questionsOf, type Answers } from '@/lib/templates/logic';
import { templateDefinition } from '@/lib/templates/schema';
import {
  createAssessment,
  saveAnswers,
  submitAssessment
} from '@/services/assessments';
import {
  createScope,
  raiseReadinessRisk,
  scopeReadiness,
  setCyberEssentials
} from '@/services/cyber-essentials';
import { loadRisk } from '@/services/risks';

const SYSTEM = {
  actorKind: 'system' as const,
  actorUserId: null,
  actorLabel: 'cyber essentials risks test'
};

after(() => pg.end());

describe('the cyber security risk category', () => {
  it('is known and offered whichever AI framework the organisation follows', () => {
    assert.equal(isKnownCategory('cyber_security'), true);
    assert.equal(categoryLabel('cyber_security'), 'Cyber security');
    for (const pack of Object.values(AI_FRAMEWORKS)) {
      assert.ok(scopesFor(pack).includes('cyber_security'), pack.id);
      assert.ok(
        appetiteGuidanceFor('cyber_security', pack).averse,
        'appetite guidance for every level'
      );
    }
  });

  it('stays as it is when the organisation moves to another AI framework', () => {
    for (const id of Object.keys(AI_FRAMEWORKS))
      assert.equal(
        refileCategory('cyber_security', id as keyof typeof AI_FRAMEWORKS),
        null
      );
  });

  it("is offered Cyber Essentials' treatments, one per theme, each naming a requirement of it", () => {
    const { treatments, source } = treatmentsFor(
      'cyber_security',
      AI_FRAMEWORKS.uk_dsit
    );
    assert.equal(source.name, 'Cyber Essentials');
    assert.deepEqual(
      treatments.map((t) => t.theme),
      CE_THEMES.map((t) => t.label)
    );
    for (const t of CE_TREATMENTS) {
      const ref = parseControlRef(t.controlRef);
      assert.ok(ref, `${t.key} names a requirement`);
      assert.equal(
        CE_THEMES.find((th) => th.label === t.theme)?.id,
        ref.requirement.theme,
        `${t.key} names a requirement of its own theme`
      );
      assert.equal(suggestionByKey(t.key)?.key, t.key);
      assert.equal(sourceOfSuggestion(t.key)?.name, 'Cyber Essentials');
    }
  });

  it("leaves an AI risk with its framework's treatments", () => {
    const { source } = treatmentsFor('fairness', AI_FRAMEWORKS.uk_dsit);
    assert.equal(source, AI_FRAMEWORKS.uk_dsit.treatmentSource);
  });
});

const definition = templateDefinition.parse(CYBER_ESSENTIALS_READINESS);

/** Every question asked answered yes, except multi-factor authentication for administrators. */
function mfaMissed(): Answers {
  const answers: Answers = Object.fromEntries(
    questionsOf(definition.schema).map(({ question: q }) => [
      q.key,
      q.controls
        ? q.type === 'boolean'
          ? true
          : 'yes'
        : q.type === 'boolean'
          ? false
          : 'A director'
    ])
  );
  answers.uac_mfa_cloud_admins = false;
  const asked = evaluate(definition.schema, answers).questions;
  return Object.fromEntries(
    Object.entries(answers).filter(([key]) => asked[key]?.visible)
  );
}

async function submittedScope(label: string) {
  const [org] = await db
    .insert(organisations)
    .values({
      name: `CE risks ${label}`,
      slug: `ce-risks-${label}-${crypto.randomUUID().slice(0, 8)}`
    })
    .returning();
  const [main] = await db
    .insert(entities)
    .values({ organisationId: org.id, name: 'Main Ltd', isDefault: true })
    .returning();
  await setCyberEssentials({
    organisationId: org.id,
    enabled: true,
    actor: SYSTEM
  });
  const scope = await createScope({
    organisationId: org.id,
    entityId: main.id,
    scope: {
      name: 'Head office',
      kind: 'whole_organisation',
      boundary: 'Everything',
      segregation: null,
      exclusions: null,
      entityIds: [],
      ownerId: null,
      nextReviewAt: null
    },
    writable: null,
    actor: SYSTEM
  });
  const [version] = await db
    .select({ id: templateVersions.id })
    .from(templateVersions)
    .innerJoin(templates, eq(templates.id, templateVersions.templateId))
    .where(
      and(
        eq(templates.organisationId, org.id),
        eq(templates.kind, 'cyber_essentials'),
        eq(templateVersions.status, 'published')
      )
    );
  const assessment = await createAssessment({
    organisationId: org.id,
    entityId: main.id,
    templateVersionId: version.id,
    title: 'Readiness',
    subjectType: 'cyber_scope',
    subjectId: scope.id,
    actor: SYSTEM
  });
  await saveAnswers({
    assessmentId: assessment.id,
    organisationId: org.id,
    answers: mfaMissed() as Record<string, string | boolean>,
    actor: SYSTEM
  });
  await submitAssessment({
    assessmentId: assessment.id,
    organisationId: org.id,
    actor: SYSTEM
  });
  return { org, scope, assessment };
}

const proposal = {
  title: 'Administrators can sign in to cloud services without MFA',
  description: 'A stolen password is enough to take over the tenant.',
  likelihood: 3,
  impact: 4,
  mitigation: { description: 'Turn on MFA for every administrator account' },
  actor: SYSTEM
};

describe('a risk raised from an unmet requirement', () => {
  it('is filed as cyber security, from the assessment, about the scope, with a mitigation naming the requirement', async () => {
    const { org, scope, assessment } = await submittedScope('raised');
    const risk = await raiseReadinessRisk({
      ...proposal,
      organisationId: org.id,
      scopeId: scope.id,
      code: 'UAC.MFA_CLOUD'
    });
    assert.equal(risk.category, 'cyber_security');
    assert.equal(risk.source, 'assessment');
    assert.equal(risk.assessmentId, assessment.id);
    assert.equal(risk.entityId, scope.entityId);

    const loaded = await loadRisk(risk.id, org.id);
    assert.deepEqual(
      loaded?.concerns.map((c) => c.kind),
      ['Cyber Essentials scope']
    );
    const [mitigation] = loaded!.mitigations;
    assert.equal(mitigation.controlRef, 'ce:v3.3:UAC.MFA_CLOUD');
    assert.equal(mitigation.status, 'planned');

    const read = await scopeReadiness(org.id, scope.id);
    const row = readinessOf(
      read.submitted!.edition!,
      read.outcomes,
      read.treated
    )
      .groups.flatMap((g) => g.rows)
      .find((r) => r.code === 'UAC.MFA_CLOUD')!;
    assert.equal(row.status, 'not_met');
    assert.equal(row.mitigations.length, 1);
    assert.equal(treatingNow(row.mitigations, row.code)?.riskId, risk.id);
  });

  it('is raised once while its risk is being treated', async () => {
    const { org, scope } = await submittedScope('twice');
    const input = {
      ...proposal,
      organisationId: org.id,
      scopeId: scope.id,
      code: 'UAC.MFA_CLOUD'
    };
    const first = await raiseReadinessRisk(input);
    await assert.rejects(
      raiseReadinessRisk(input),
      new RegExp(`${first.reference} is already treating this requirement`)
    );
  });

  it('is refused for a requirement the assessment found met', async () => {
    const { org, scope } = await submittedScope('met');
    await assert.rejects(
      raiseReadinessRisk({
        ...proposal,
        organisationId: org.id,
        scopeId: scope.id,
        code: 'FW.PROTECT_EVERY_DEVICE'
      }),
      /not unmet in the scope's latest submitted readiness assessment/
    );
  });

  it('shows its mitigation as evidence once verified, beside the answer it does not change', async () => {
    const { org, scope } = await submittedScope('evidence');
    const risk = await raiseReadinessRisk({
      ...proposal,
      organisationId: org.id,
      scopeId: scope.id,
      code: 'UAC.MFA_CLOUD'
    });
    await db
      .update(mitigations)
      .set({ status: 'verified', verifiedAt: new Date() })
      .where(eq(mitigations.riskId, risk.id));
    const read = await scopeReadiness(org.id, scope.id);
    const row = readinessOf(
      read.submitted!.edition!,
      read.outcomes,
      read.treated
    )
      .groups.flatMap((g) => g.rows)
      .find((r) => r.code === 'UAC.MFA_CLOUD')!;
    assert.equal(row.mitigations[0].status, 'verified');
    assert.equal(row.status, 'not_met', 'until it is assessed again');
  });

  it('reads only mitigations on risks about this scope', async () => {
    const { org, scope } = await submittedScope('other-scope');
    const risk = await raiseReadinessRisk({
      ...proposal,
      organisationId: org.id,
      scopeId: scope.id,
      code: 'UAC.MFA_CLOUD'
    });
    await db
      .update(recordLinks)
      .set({ toId: crypto.randomUUID() })
      .where(eq(recordLinks.fromId, risk.id));
    assert.deepEqual((await scopeReadiness(org.id, scope.id)).treated, []);
  });
});
