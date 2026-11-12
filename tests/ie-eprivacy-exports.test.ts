import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';

import { db, sql as pg } from '@/db/client';
import { entities, organisations } from '@/db/schema';
import { SYSTEM_TEMPLATES } from '@/lib/templates/library';
import { templateDefinition } from '@/lib/templates/schema';
import { issueIntakeLink, openIntakeLink } from '@/services/dsr-intake';
import {
  EntityRefused,
  setDataProtectionLaw,
  setIeCommsProvider,
  setIeEprivacy
} from '@/services/entities';
import { CONTEXT_VERSION, governanceContext } from '@/services/export';
import { shippedTemplatesMissing } from '@/services/templates';

const SYSTEM = {
  actorKind: 'system' as const,
  actorUserId: null,
  actorLabel: 'Irish ePrivacy exports test'
};

const CHECKLIST = 'Electronic communications provider duties (Ireland)';

after(() => pg.end());

async function world(label: string, irish: boolean) {
  const [org] = await db
    .insert(organisations)
    .values({
      name: `IE exports ${label}`,
      slug: `iex-${label}-${crypto.randomUUID().slice(0, 8)}`
    })
    .returning();
  const [entity] = await db
    .insert(entities)
    .values({ organisationId: org.id, name: 'Telco Ltd', isDefault: true })
    .returning();
  if (irish) {
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
  }
  return { org, entity };
}

describe('what other people see', () => {
  it("exports each entity's Irish answer and ePrivacy laws", async () => {
    const w = await world('context', true);
    const context = await governanceContext({ organisationId: w.org.id });
    assert.equal(context.contextVersion, CONTEXT_VERSION);
    assert.equal(CONTEXT_VERSION, '1.4');
    const [entity] = context.entities;
    assert.equal(entity.ieEprivacy, true);
    assert.equal(entity.eprivacyLaws, 'uk_ie');

    const uk = await world('context-uk', false);
    const [ukEntity] = (await governanceContext({ organisationId: uk.org.id }))
      .entities;
    assert.equal(ukEntity.eprivacyLaws, 'uk');
  });

  it('names the Data Protection Commission on the public form only under the Irish Regulations', async () => {
    const irish = await world('form', true);
    const link = await issueIntakeLink({
      organisationId: irish.org.id,
      entityId: irish.entity.id,
      label: 'Privacy notice',
      actor: SYSTEM
    });
    assert.equal((await openIntakeLink(link.slug))!.irishEprivacy, true);

    const uk = await world('form-uk', false);
    const ukLink = await issueIntakeLink({
      organisationId: uk.org.id,
      entityId: uk.entity.id,
      label: 'Privacy notice',
      actor: SYSTEM
    });
    assert.equal((await openIntakeLink(ukLink.slug))!.irishEprivacy, false);
  });
});

describe('providers in Ireland', () => {
  it('is refused without the Irish Regulations, and holds them on while set', async () => {
    const uk = await world('provider-uk', false);
    await assert.rejects(
      setIeCommsProvider({
        organisationId: uk.org.id,
        entityId: uk.entity.id,
        provider: true,
        actor: SYSTEM
      }),
      EntityRefused
    );
    const w = await world('provider', true);
    const marked = await setIeCommsProvider({
      organisationId: w.org.id,
      entityId: w.entity.id,
      provider: true,
      actor: SYSTEM
    });
    assert.equal(marked.ieCommsProvider, true);
    await assert.rejects(
      setIeEprivacy({
        organisationId: w.org.id,
        entityId: w.entity.id,
        applies: false,
        actor: SYSTEM
      }),
      /provider of electronic communications services in Ireland/
    );
  });

  it('offers the duties checklist only to a provider in Ireland', async () => {
    const shipped = SYSTEM_TEMPLATES.find((t) => t.name === CHECKLIST)!;
    assert.ok(templateDefinition.safeParse(shipped.definition).success);

    const w = await world('checklist', true);
    const names = async () =>
      (await shippedTemplatesMissing(w.org.id)).map((t) => t.name);
    assert.ok(!(await names()).includes(CHECKLIST));
    await setIeCommsProvider({
      organisationId: w.org.id,
      entityId: w.entity.id,
      provider: true,
      actor: SYSTEM
    });
    assert.ok((await names()).includes(CHECKLIST));
  });
});
