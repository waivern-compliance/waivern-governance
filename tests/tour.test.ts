import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import { and, eq } from 'drizzle-orm';

import { db, sql as pg } from '@/db/client';
import { auditEvents, memberships, organisations, users } from '@/db/schema';
import {
  offerTour,
  TOUR_BUDGET_SECONDS,
  TOUR_TARGETS,
  tourRequested,
  tourSteps
} from '@/lib/tour/steps';
import { recordTourOutcome, tourStateFor } from '@/services/tour';

after(() => pg.end());

const PRIVACY = { privacy: true };
const AI_ONLY = { privacy: false };

describe('the guided tour', () => {
  it('fits inside two minutes, whichever programme it is for', () => {
    for (const scope of [PRIVACY, AI_ONLY]) {
      const total = tourSteps(scope).reduce((n, s) => n + s.seconds, 0);
      assert.ok(total <= TOUR_BUDGET_SECONDS, `${total}s`);
    }
  });

  it('covers setting up, assessing and what comes round, in that order', () => {
    const stages = tourSteps(PRIVACY)
      .map((s) => s.stage)
      .filter((s) => s !== undefined);
    assert.deepEqual(
      [...new Set(stages)],
      ['Set up', 'Assess', 'Keep it current']
    );
  });

  it('does not talk about data protection law to an AI-only organisation as if it applied', () => {
    const entities = tourSteps(AI_ONLY).find((s) => s.id === 'entities');
    assert.match(entities?.body ?? '', /AI governance programme alone/);
    assert.doesNotMatch(entities?.body ?? '', /deadlines and citations/);
    const privacy = tourSteps(PRIVACY).find((s) => s.id === 'entities');
    assert.match(privacy?.body ?? '', /UK, EU, both or neither/);
  });

  it('uses plain hyphens, never em dashes', () => {
    for (const step of [...tourSteps(PRIVACY), ...tourSteps(AI_ONLY)]) {
      assert.doesNotMatch(step.title + step.body, /—/, step.id);
    }
  });

  it('points only at things the home page marks for it', () => {
    // A step whose target was renamed away would silently lose its highlight.
    const source = filesUnder('src')
      .filter((f) => f.endsWith('.tsx'))
      .map((f) => readFileSync(f, 'utf8'))
      .join('\n');
    for (const target of TOUR_TARGETS) {
      // As an attribute, or as the value a component hands to one.
      const marked =
        source.includes(`data-tour="${target}"`) ||
        source.includes(`tour="${target}"`) ||
        new RegExp(`[:?] '${target}'`).test(source);
      assert.ok(marked, target);
    }
    for (const step of tourSteps(PRIVACY)) {
      if (step.target) assert.ok(TOUR_TARGETS.includes(step.target));
    }
  });
});

describe('offering the tour', () => {
  it('offers it to somebody who has never answered', () => {
    assert.equal(offerTour({ outcome: null, simulated: false }), true);
  });

  it('does not offer it again once taken or turned down', () => {
    assert.equal(offerTour({ outcome: 'finished', simulated: false }), false);
    assert.equal(offerTour({ outcome: 'dismissed', simulated: false }), false);
  });

  it('never offers it to a simulated trial colleague', () => {
    assert.equal(offerTour({ outcome: null, simulated: true }), false);
  });

  it('starts it only when the address asks for it', () => {
    assert.equal(tourRequested('start'), true);
    assert.equal(tourRequested(['start']), true);
    assert.equal(tourRequested(undefined), false);
    assert.equal(tourRequested('yes'), false);
  });
});

describe('remembering the answer', () => {
  async function world() {
    const tag = crypto.randomUUID().slice(0, 8);
    const [org] = await db
      .insert(organisations)
      .values({ name: `Tour ${tag}`, slug: `tour-${tag}` })
      .returning();
    const [user] = await db
      .insert(users)
      .values({ email: `newcomer-${tag}@example.org` })
      .returning();
    await db
      .insert(memberships)
      .values({ organisationId: org.id, userId: user.id });
    return { org, user };
  }

  async function events(organisationId: string, userId: string) {
    return db
      .select()
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.organisationId, organisationId),
          eq(auditEvents.subjectId, userId)
        )
      );
  }

  it('starts with no answer', async () => {
    const { user } = await world();
    assert.deepEqual(await tourStateFor(user.id), {
      outcome: null,
      simulated: false
    });
  });

  it('keeps a turned-down offer against the person, with its audit event', async () => {
    const { org, user } = await world();
    await recordTourOutcome({
      organisationId: org.id,
      userId: user.id,
      actorLabel: user.email,
      outcome: 'dismissed'
    });
    const state = await tourStateFor(user.id);
    assert.equal(state.outcome, 'dismissed');
    assert.equal(offerTour(state), false);

    const [event] = await events(org.id, user.id);
    assert.equal(event.action, 'tour.dismissed');
    assert.equal(event.subjectType, 'user');
    assert.equal(event.actorUserId, user.id);
  });

  it('records a replay that is finished over the earlier answer', async () => {
    const { org, user } = await world();
    for (const outcome of ['dismissed', 'finished'] as const) {
      await recordTourOutcome({
        organisationId: org.id,
        userId: user.id,
        actorLabel: user.email,
        outcome
      });
    }
    assert.equal((await tourStateFor(user.id)).outcome, 'finished');
    const actions = (await events(org.id, user.id)).map((e) => e.action);
    assert.deepEqual(actions.sort(), ['tour.dismissed', 'tour.finished']);
  });

  it('refuses an outcome that is not one', async () => {
    const { org, user } = await world();
    await assert.rejects(
      recordTourOutcome({
        organisationId: org.id,
        userId: user.id,
        actorLabel: user.email,
        // @ts-expect-error: what a forged form could send
        outcome: 'seen'
      }),
      /No such tour outcome/
    );
    assert.equal((await tourStateFor(user.id)).outcome, null);
  });
});

function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? filesUnder(path) : [path];
  });
}
