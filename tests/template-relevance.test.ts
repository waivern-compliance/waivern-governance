import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { and, eq } from 'drizzle-orm';

import { db, sql as pg } from '@/db/client';
import {
  entities,
  organisations,
  templates,
  templateVersions
} from '@/db/schema';
import {
  hiddenBecause,
  offeredTo,
  SYSTEM_TEMPLATES,
  TEMPLATE_PROGRAMMES,
  type TemplateRelevance
} from '@/lib/templates/library';
import { createAssessment } from '@/services/assessments';
import { setCyberEssentials } from '@/services/cyber-essentials';
import {
  setDataProtectionLaw,
  setOutsideDataProtectionLaw
} from '@/services/entities';
import { hiddenTemplates } from '@/services/template-relevance';
import {
  createDraftFrom,
  createTemplate,
  installShippedTemplates,
  publishVersion,
  shippedTemplatesMissing,
  templateLibrary
} from '@/services/templates';

const SYSTEM = {
  actorKind: 'system' as const,
  actorUserId: null,
  actorLabel: 'Template relevance test'
};

after(() => pg.end());

const UK_ONLY: TemplateRelevance = {
  aiFramework: 'uk_dsit',
  competentAuthority: false,
  irishProvider: false,
  cyberEssentials: false,
  privacy: true,
  ukLaw: true,
  euLaw: false
};

function shownTo(o: TemplateRelevance) {
  return SYSTEM_TEMPLATES.filter((t) => !hiddenBecause(t, o)).map(
    (t) => t.name
  );
}

describe('which shipped templates an organisation is shown', () => {
  it('files every shipped template under a programme', () => {
    for (const t of SYSTEM_TEMPLATES) {
      assert.ok(TEMPLATE_PROGRAMMES.includes(t.programme), t.name);
      // A template installed only under UK law is written for UK law.
      if (t.ukLaw) assert.equal(t.law, 'uk', t.name);
    }
  });

  it('never shows a template the organisation would not be offered', () => {
    const audiences: TemplateRelevance[] = [
      UK_ONLY,
      { ...UK_ONLY, ukLaw: false, euLaw: true, irishProvider: true },
      { ...UK_ONLY, competentAuthority: true, cyberEssentials: true },
      { ...UK_ONLY, aiFramework: 'nist_ai_rmf', privacy: false, ukLaw: false }
    ];
    for (const o of audiences)
      for (const t of SYSTEM_TEMPLATES)
        if (!hiddenBecause(t, o)) assert.ok(offeredTo(t, o), t.name);
  });

  it('says why a template is hidden', () => {
    const eu = SYSTEM_TEMPLATES.find(
      (t) => t.name === 'Transfer impact assessment (EU)'
    )!;
    const nist = SYSTEM_TEMPLATES.find(
      (t) => t.name === 'AI risk identification (NIST AI RMF)'
    )!;
    assert.equal(hiddenBecause(eu, UK_ONLY), 'eu');
    assert.equal(hiddenBecause(eu, { ...UK_ONLY, privacy: false }), 'privacy');
    assert.equal(hiddenBecause(nist, UK_ONLY), 'framework');
  });

  it('shows UK templates and not EU ones where every entity is under UK law', () => {
    const shown = shownTo(UK_ONLY);
    assert.ok(shown.includes('Data protection impact assessment'));
    assert.ok(shown.includes('Transfer risk assessment (UK)'));
    assert.ok(shown.includes('DPIA screening questionnaire'));
    assert.ok(
      !shown.includes('Data protection impact assessment (CNIL method)')
    );
    assert.ok(!shown.includes('Transfer impact assessment (EU)'));
  });

  it('shows EU templates and not UK ones where every entity is under EU law', () => {
    const shown = shownTo({ ...UK_ONLY, ukLaw: false, euLaw: true });
    assert.ok(
      shown.includes('Data protection impact assessment (CNIL method)')
    );
    assert.ok(shown.includes('Transfer impact assessment (EU)'));
    assert.ok(shown.includes('Breach severity assessment'));
    assert.ok(!shown.includes('Data protection impact assessment'));
    assert.ok(!shown.includes('Legitimate interests assessment'));
  });

  it('shows no data protection template where no entity is under UK or EU law', () => {
    const shown = SYSTEM_TEMPLATES.filter(
      (t) =>
        !hiddenBecause(t, {
          ...UK_ONLY,
          aiFramework: 'nist_ai_rmf',
          privacy: false,
          ukLaw: false
        })
    );
    assert.ok(shown.every((t) => t.programme !== 'privacy'));
    assert.deepEqual(
      shown.map((t) => t.name),
      [
        'AI risk assessment',
        'AI risk identification (NIST AI RMF)',
        'AI supplier assessment',
        'Supplier due diligence (light)',
        'Supplier due diligence (full)'
      ]
    );
  });

  it('shows Cyber Essentials readiness only once Cyber Essentials is on', () => {
    const name = 'Cyber Essentials readiness (v3.3, Danzell)';
    assert.ok(!shownTo(UK_ONLY).includes(name));
    assert.ok(shownTo({ ...UK_ONLY, cyberEssentials: true }).includes(name));
  });

  it('shows the AI risk identification for the framework followed', () => {
    const shown = shownTo(UK_ONLY);
    assert.ok(shown.includes('AI risk identification (DSIT toolkit)'));
    assert.ok(!shown.includes('AI risk identification (NIST AI RMF)'));
  });
});

async function world(label: string) {
  const [org] = await db
    .insert(organisations)
    .values({
      name: `Relevance ${label}`,
      slug: `rel-${label}-${crypto.randomUUID().slice(0, 8)}`
    })
    .returning();
  const [entity] = await db
    .insert(entities)
    .values({ organisationId: org.id, name: 'Acme Ltd', isDefault: true })
    .returning();
  await installShippedTemplates({ organisationId: org.id, actor: SYSTEM });
  return { org, entity };
}

async function shownIn(organisationId: string) {
  const library = await templateLibrary(organisationId);
  const { hidden } = await hiddenTemplates(organisationId, library);
  return library
    .filter(({ template }) => !hidden.has(template.id))
    .map(({ template }) => template.name);
}

async function publishedVersion(organisationId: string, name: string) {
  const [row] = await db
    .select({ id: templateVersions.id })
    .from(templateVersions)
    .innerJoin(templates, eq(templates.id, templateVersions.templateId))
    .where(
      and(
        eq(templates.organisationId, organisationId),
        eq(templates.name, name),
        eq(templateVersions.status, 'published')
      )
    );
  return row.id;
}

describe("an organisation's library", () => {
  it('follows the law its entities are under', async () => {
    const w = await world('law');
    let shown = await shownIn(w.org.id);
    assert.ok(shown.includes('Data protection impact assessment'));
    assert.ok(!shown.includes('Transfer impact assessment (EU)'));

    await setDataProtectionLaw({
      organisationId: w.org.id,
      entityId: w.entity.id,
      law: 'eu',
      actor: SYSTEM
    });
    shown = await shownIn(w.org.id);
    assert.ok(shown.includes('Transfer impact assessment (EU)'));
    assert.ok(!shown.includes('Data protection impact assessment'));
  });

  it('keeps what the organisation has used or made, outside its programmes', async () => {
    const w = await world('own');
    await createAssessment({
      organisationId: w.org.id,
      entityId: w.entity.id,
      templateVersionId: await publishedVersion(
        w.org.id,
        'Legitimate interests assessment'
      ),
      title: 'Marketing to existing customers',
      actor: SYSTEM
    });
    const dpia = SYSTEM_TEMPLATES.find(
      (t) => t.name === 'Data protection impact assessment'
    )!;
    await createTemplate({
      organisationId: w.org.id,
      kind: 'dpia',
      name: 'Our own DPIA',
      definition: dpia.definition,
      actor: SYSTEM
    });
    await setOutsideDataProtectionLaw({
      organisationId: w.org.id,
      entityId: w.entity.id,
      actor: SYSTEM
    });

    const shown = await shownIn(w.org.id);
    assert.ok(shown.includes('Legitimate interests assessment'));
    assert.ok(shown.includes('Our own DPIA'));
    assert.ok(shown.includes('AI risk assessment'));
    assert.ok(!shown.includes('Data protection impact assessment'));
    assert.ok(!shown.includes('Breach severity assessment'));
  });

  it('keeps a template somebody is editing', async () => {
    const w = await world('draft');
    const [tra] = await db
      .select({ id: templates.id })
      .from(templates)
      .where(
        and(
          eq(templates.organisationId, w.org.id),
          eq(templates.name, 'Transfer impact assessment (EU)')
        )
      );
    assert.ok(
      !(await shownIn(w.org.id)).includes('Transfer impact assessment (EU)')
    );
    await createDraftFrom({
      organisationId: w.org.id,
      templateId: tra.id,
      actor: SYSTEM
    });
    assert.ok(
      (await shownIn(w.org.id)).includes('Transfer impact assessment (EU)')
    );
  });

  it('judges a system template no longer shipped by its kind', async () => {
    const w = await world('renamed');
    const readiness = SYSTEM_TEMPLATES.find(
      (t) => t.kind === 'cyber_essentials'
    )!;
    const ai = SYSTEM_TEMPLATES.find((t) => t.name === 'AI risk assessment')!;
    for (const [t, name] of [
      [readiness, 'Cyber Essentials readiness (an earlier edition)'],
      [ai, 'AI risk assessment (retired)']
    ] as const) {
      // Published, as an installed template is: a draft would be kept as
      // somebody's work in progress.
      const { version } = await createTemplate({
        organisationId: w.org.id,
        kind: t.kind,
        name,
        isSystem: true,
        definition: t.definition,
        actor: SYSTEM
      });
      await publishVersion({
        organisationId: w.org.id,
        versionId: version.id,
        actor: SYSTEM
      });
    }
    const shown = await shownIn(w.org.id);
    assert.ok(
      !shown.includes('Cyber Essentials readiness (an earlier edition)')
    );
    assert.ok(shown.includes('AI risk assessment (retired)'));
  });

  it('shows Cyber Essentials readiness once it is turned on', async () => {
    const w = await world('ce');
    await setCyberEssentials({
      organisationId: w.org.id,
      enabled: true,
      actor: SYSTEM
    });
    assert.ok(
      (await shownIn(w.org.id)).includes(
        'Cyber Essentials readiness (v3.3, Danzell)'
      )
    );
  });

  it('offers no UK template where every entity is under neither law', async () => {
    const [org] = await db
      .insert(organisations)
      .values({
        name: 'Relevance neither',
        slug: `rel-neither-${crypto.randomUUID().slice(0, 8)}`
      })
      .returning();
    const [entity] = await db
      .insert(entities)
      .values({ organisationId: org.id, name: 'Acme Inc', isDefault: true })
      .returning();
    await setOutsideDataProtectionLaw({
      organisationId: org.id,
      entityId: entity.id,
      actor: SYSTEM
    });
    const missing = (await shippedTemplatesMissing(org.id)).map((t) => t.name);
    assert.ok(!missing.includes('Data protection impact assessment'));
    assert.ok(missing.includes('AI risk assessment'));
  });
});
