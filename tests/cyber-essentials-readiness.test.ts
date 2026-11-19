import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { and, eq } from 'drizzle-orm';

import { db, sql as pg } from '@/db/client';
import {
  entities,
  organisations,
  templates,
  templateVersions,
  workflowDefinitions
} from '@/db/schema';
import { requirementsOf, scopeRulesOf } from '@/lib/cyber-essentials/editions';
import { readinessOf } from '@/lib/cyber-essentials/readiness';
import {
  CYBER_ESSENTIALS_READINESS_NAME,
  LEGAL_REFERENCES,
  SYSTEM_TEMPLATES
} from '@/lib/templates/library';
import { CYBER_ESSENTIALS_READINESS } from '@/lib/templates/library/cyber-essentials-readiness';
import { evaluate, questionsOf, type Answers } from '@/lib/templates/logic';
import { requirementOutcomes } from '@/lib/templates/requirements';
import {
  templateDefinition,
  type TemplateDefinition
} from '@/lib/templates/schema';
import { score } from '@/lib/templates/scoring';
import { validateTemplate } from '@/lib/templates/validate';
import {
  createAssessment,
  saveAnswers,
  submitAssessment
} from '@/services/assessments';
import {
  createScope,
  scopeReadiness,
  setCyberEssentials
} from '@/services/cyber-essentials';
import { shippedTemplatesMissing } from '@/services/templates';

const SYSTEM = {
  actorKind: 'system' as const,
  actorUserId: null,
  actorLabel: 'cyber essentials readiness test'
};

after(() => pg.end());

const definition = templateDefinition.parse(CYBER_ESSENTIALS_READINESS);
const questions = questionsOf(definition.schema).map((q) => q.question);

/** Every question answered as meeting what it tests, and every gateway answered no. */
function allMet(): Answers {
  const answers: Answers = Object.fromEntries(
    questions.map((q) => [
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
  // Only what is being asked: the gateways answered no hide their branches.
  const asked = evaluate(definition.schema, answers).questions;
  return Object.fromEntries(
    Object.entries(answers).filter(([key]) => asked[key]?.visible)
  );
}

function outcome(answers: Answers) {
  const evaluation = evaluate(definition.schema, answers);
  return score(definition.scoring, definition.schema, answers, evaluation);
}

describe('the Cyber Essentials readiness template', () => {
  it('passes the checks every template must pass to be published', () => {
    assert.deepEqual(validateTemplate(definition), []);
  });

  it('tests only requirements and scope rules of its edition, and every one of them it can', () => {
    const known = new Set(
      [...requirementsOf('v3.3'), ...scopeRulesOf('v3.3')].map((r) => r.code)
    );
    const tested = new Set(questions.flatMap((q) => q.controls ?? []));
    for (const code of tested) assert.ok(known.has(code), code);
    for (const r of requirementsOf('v3.3'))
      assert.ok(tested.has(r.code), `no question tests ${r.code}`);
  });

  it('cites only references the shared library holds', () => {
    const library = new Set(LEGAL_REFERENCES.map((r) => r.code));
    for (const q of questions)
      for (const ref of q.legalRefs) assert.ok(library.has(ref), ref);
  });

  it('marks the 14-day patching and cloud MFA questions as automatic fails, and nothing else', () => {
    const autoFail = questions
      .filter((q) => q.autoFail)
      .flatMap((q) => q.controls);
    assert.deepEqual([...new Set(autoFail)].sort(), [
      'SUM.CRITICAL_14_DAYS',
      'UAC.MFA_CLOUD'
    ]);
  });

  it('is offered only to an organisation that has taken up Cyber Essentials', () => {
    const t = SYSTEM_TEMPLATES.find(
      (s) => s.name === CYBER_ESSENTIALS_READINESS_NAME
    );
    assert.ok(t);
    assert.equal(t.cyberEssentials, true);
  });
});

describe('scoring by requirements', () => {
  it('is ready when every requirement asked is met', () => {
    const r = outcome(allMet());
    assert.ok(r.scored);
    assert.equal(r.score, 0);
    assert.equal(r.band.label, 'Ready to apply');
  });

  it('counts each unmet requirement once, however many questions miss it', () => {
    const r = outcome({
      ...allMet(),
      sc_autorun: false,
      uac_unique: false,
      fw_inbound_approved: 'no'
    });
    assert.ok(r.scored);
    assert.equal(r.score, 3);
    assert.equal(r.band.tier, 'medium');
    assert.deepEqual(r.components.map((c) => c.value).sort(), [
      'FW.INBOUND_RULES_APPROVED',
      'SC.AUTORUN',
      'UAC.UNIQUE_CREDENTIALS'
    ]);
  });

  it('makes an automatic fail the outcome, however few others are missed', () => {
    const r = outcome({ ...allMet(), sum_apps_14_days: false });
    assert.ok(r.scored);
    assert.equal(r.score, 1);
    assert.equal(r.band.label, 'Not ready: an automatic fail');
    assert.equal(r.band.tier, 'critical');
  });

  it('gives no outcome while a question it asks is unanswered', () => {
    const answers = allMet();
    delete answers.uac_mfa;
    assert.deepEqual(outcome(answers), { scored: false, reason: 'incomplete' });
  });

  it('leaves a requirement whose question is not being asked not applicable, not unmet', () => {
    const answers = { ...allMet(), fw_admin_protected: false };
    const r = outcome(answers);
    assert.ok(r.scored);
    assert.equal(r.score, 0, 'nobody said the interface is on the internet');
    const status = requirementOutcomes(
      definition.schema,
      answers,
      evaluate(definition.schema, answers)
    ).find((o) => o.code === 'FW.ADMIN_INTERFACE');
    assert.equal(status?.status, 'not_applicable');
  });

  it('counts a not-applicable answer as neither met nor unmet', () => {
    const answers = { ...allMet(), mp_allow_listing: 'not_applicable' };
    const readiness = readinessOf(
      'v3.3',
      requirementOutcomes(
        definition.schema,
        answers,
        evaluate(definition.schema, answers)
      )
    );
    const row = readiness.groups
      .flatMap((g) => g.rows)
      .find((r) => r.code === 'MP.ALLOW_LISTING');
    assert.equal(row?.status, 'not_applicable');
    assert.equal(readiness.counts.not_met, 0);
  });
});

describe('templates that test requirements', () => {
  const base = (
    q: Record<string, unknown>,
    scoring: TemplateDefinition['scoring'] = { method: 'none' }
  ) =>
    templateDefinition.parse({
      schema: {
        sections: [{ key: 's', title: 'S', questions: [{ label: 'Q', ...q }] }]
      },
      scoring
    });
  const problems = (d: TemplateDefinition) =>
    validateTemplate(d).map((p) => p.message);

  it('refuses a free-text question that says it tests requirements', () => {
    assert.ok(
      problems(base({ key: 'q', type: 'short_text', controls: ['X.Y'] })).some(
        (m) => /yes or no, or a single choice/.test(m)
      )
    );
  });

  it('refuses a choice whose options do not all say whether they meet them', () => {
    const d = base({
      key: 'q',
      type: 'single_select',
      controls: ['X.Y'],
      options: [
        { value: 'a', label: 'A', meets: 'met' },
        { value: 'b', label: 'B' }
      ]
    });
    assert.ok(problems(d).some((m) => /Every option says/.test(m)));
  });

  it('refuses an automatic fail with nothing to test', () => {
    assert.ok(
      problems(base({ key: 'q', type: 'boolean', autoFail: true })).some((m) =>
        /automatic fail needs/.test(m)
      )
    );
  });

  it('refuses scoring by requirements when no question tests any', () => {
    const band = { min: 0, max: 9, label: 'B', tier: 'low' as const };
    const d = base(
      { key: 'q', type: 'boolean' },
      { method: 'requirements', bands: [band], autoFailBand: band }
    );
    assert.ok(
      problems(d).some((m) => /needs questions that test them/.test(m))
    );
  });
});

async function world(label: string) {
  const [org] = await db
    .insert(organisations)
    .values({
      name: `CE readiness ${label}`,
      slug: `ce-ready-${label}-${crypto.randomUUID().slice(0, 8)}`
    })
    .returning();
  const [main] = await db
    .insert(entities)
    .values({ organisationId: org.id, name: 'Main Ltd', isDefault: true })
    .returning();
  return { org, main };
}

const installed = async (organisationId: string) => ({
  templates: (
    await db
      .select({ name: templates.name })
      .from(templates)
      .where(
        and(
          eq(templates.organisationId, organisationId),
          eq(templates.kind, 'cyber_essentials')
        )
      )
  ).length,
  workflows: (
    await db
      .select({ id: workflowDefinitions.id })
      .from(workflowDefinitions)
      .where(
        and(
          eq(workflowDefinitions.organisationId, organisationId),
          eq(workflowDefinitions.templateKind, 'cyber_essentials')
        )
      )
  ).length
});

describe('taking up Cyber Essentials', () => {
  it('installs the readiness template and its sign-off once, and offers it only then', async () => {
    const { org } = await world('install');
    const offered = async () =>
      (await shippedTemplatesMissing(org.id)).some(
        (t) => t.name === CYBER_ESSENTIALS_READINESS_NAME
      );
    assert.equal(await offered(), false);
    assert.deepEqual(await installed(org.id), { templates: 0, workflows: 0 });

    for (const enabled of [true, false, true])
      await setCyberEssentials({
        organisationId: org.id,
        enabled,
        actor: SYSTEM
      });
    assert.deepEqual(await installed(org.id), { templates: 1, workflows: 1 });
    assert.equal(await offered(), false, 'held, so not offered again');
  });
});

describe("a scope's readiness", () => {
  async function readyScope(label: string) {
    const { org, main } = await world(label);
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
    return { org, main, scope, versionId: version.id };
  }

  it('is started only from the scope it is about', async () => {
    const { org, main, versionId } = await readyScope('unbound');
    await assert.rejects(
      createAssessment({
        organisationId: org.id,
        entityId: main.id,
        templateVersionId: versionId,
        title: 'Readiness',
        actor: SYSTEM
      }),
      /started from the record it is about/
    );
  });

  it('reads the status per requirement from the answers as submitted', async () => {
    const { org, main, scope, versionId } = await readyScope('status');
    assert.deepEqual(await scopeReadiness(org.id, scope.id), {
      submitted: null,
      outcomes: [],
      open: null
    });

    const assessment = await createAssessment({
      organisationId: org.id,
      entityId: main.id,
      templateVersionId: versionId,
      title: 'Readiness',
      subjectType: 'cyber_scope',
      subjectId: scope.id,
      actor: SYSTEM
    });
    assert.match(assessment.reference, /^CER-/);
    const answers = {
      ...(allMet() as Record<string, string | boolean>),
      uac_mfa_cloud_admins: false
    };
    await saveAnswers({
      assessmentId: assessment.id,
      organisationId: org.id,
      answers,
      actor: SYSTEM
    });
    assert.equal(
      (await scopeReadiness(org.id, scope.id)).open?.id,
      assessment.id,
      'being answered, nothing submitted yet'
    );

    await submitAssessment({
      assessmentId: assessment.id,
      organisationId: org.id,
      actor: SYSTEM
    });
    const read = await scopeReadiness(org.id, scope.id);
    assert.equal(read.open, null);
    assert.equal(read.submitted?.id, assessment.id);
    assert.equal(read.submitted?.scoreBand, 'Not ready: an automatic fail');

    const readiness = readinessOf(scope.edition, read.outcomes);
    assert.equal(readiness.autoFailed, true);
    const mfa = readiness.groups
      .flatMap((g) => g.rows)
      .find((r) => r.code === 'UAC.MFA_CLOUD');
    assert.equal(mfa?.status, 'not_met');
    assert.equal(mfa?.questions.length, 2);
    assert.equal(readiness.counts.not_met, 1);
  });
});
