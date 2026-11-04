import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { eq } from 'drizzle-orm';

import { db, sql as pg } from '@/db/client';
import {
  entities,
  memberships,
  notifications,
  organisations,
  roleAssignments,
  tasks,
  users
} from '@/db/schema';
import {
  memberEmail,
  memberEmailConfig,
  memberEmailState
} from '@/lib/email/member';
import type { EmailConfig } from '@/lib/email/resend';
import {
  deliverNotifications,
  emailNotificationsFor,
  setEmailNotifications
} from '@/services/member-email';

after(() => pg.end());

const config: EmailConfig = { apiKey: 're_test', from: 'govern@example.org' };
const HOUR = 3600_000;

/** A stand-in for Resend that records every email it is asked to send. */
function resend(ok = true) {
  const sent: Array<{ to: string[]; subject: string; text: string }> = [];
  const fake = (async (_url: string, init: RequestInit) => {
    if (!ok) throw new TypeError('fetch failed');
    sent.push(JSON.parse(String(init.body)));
    return new Response(JSON.stringify({ id: `m${sent.length}` }), {
      status: 200
    });
  }) as unknown as typeof fetch;
  return { fake, sent };
}

async function world() {
  const tag = crypto.randomUUID().slice(0, 8);
  const [org] = await db
    .insert(organisations)
    .values({ name: `Mail ${tag}`, slug: `mail-${tag}` })
    .returning();
  const [entity] = await db
    .insert(entities)
    .values({ organisationId: org.id, name: 'Main', isDefault: true })
    .returning();
  async function person(
    name: string,
    opts: {
      optedIn: boolean;
      role?: 'privacy_admin' | 'approver';
      active?: boolean;
    }
  ) {
    const [user] = await db
      .insert(users)
      .values({
        email: `${name}-${tag}@example.org`,
        emailNotifications: opts.optedIn
      })
      .returning();
    const [m] = await db
      .insert(memberships)
      .values({
        organisationId: org.id,
        userId: user.id,
        isActive: opts.active ?? true
      })
      .returning();
    if (opts.role)
      await db
        .insert(roleAssignments)
        .values({ membershipId: m.id, role: opts.role, scope: 'organisation' });
    return user;
  }
  const [task] = await db
    .insert(tasks)
    .values({
      organisationId: org.id,
      entityId: entity.id,
      type: 'approve_stage',
      title: 'DPO review: DPIA-2026-0007 Personalisation',
      description: 'Special category data about named people',
      subjectType: 'assessment',
      subjectId: crypto.randomUUID(),
      assigneeRole: 'privacy_admin',
      dueAt: new Date('2026-11-09T00:00:00Z')
    })
    .returning();
  async function notice(
    values: Partial<typeof notifications.$inferInsert> & {
      recipient: string;
      kind: string;
    }
  ) {
    const [n] = await db
      .insert(notifications)
      .values({
        organisationId: org.id,
        subject: 'S',
        body: 'B',
        idempotencyKey: crypto.randomUUID(),
        ...values
      })
      .returning();
    return n;
  }
  const read = async (id: string) =>
    (await db.select().from(notifications).where(eq(notifications.id, id)))[0];
  return { org, entity, task, person, notice, read };
}

describe('whether member email can be sent at all', () => {
  const sending = { RESEND_API_KEY: 're_x', EMAIL_FROM: 'a@b.example' };
  it('needs the switch, a key and a sender, and is never sent on the shared hosted service', () => {
    assert.equal(
      memberEmailState({ ...sending, NOTIFICATION_EMAILS: 'true' }),
      'on'
    );
    assert.deepEqual(
      memberEmailConfig({ ...sending, NOTIFICATION_EMAILS: 'true' }),
      { apiKey: 're_x', from: 'a@b.example' }
    );
    assert.equal(memberEmailState(sending), 'off');
    assert.equal(
      memberEmailState({ NOTIFICATION_EMAILS: 'true' }),
      'not_configured'
    );
    assert.equal(
      memberEmailState({
        ...sending,
        NOTIFICATION_EMAILS: 'true',
        WAIVERN_HOSTED: 'true'
      }),
      'hosted'
    );
    assert.equal(
      memberEmailConfig({
        ...sending,
        NOTIFICATION_EMAILS: 'true',
        WAIVERN_HOSTED: 'true'
      }),
      null
    );
  });
});

describe('what the email says', () => {
  it('names the work and links to it, and says how to stop', () => {
    const m = memberEmail(
      {
        kind: 'task.raised',
        subject: 'ignored',
        organisationName: 'Acme',
        task: {
          title: 'DPO review: DPIA-2026-0007',
          dueAt: new Date('2026-11-09T00:00:00Z')
        },
        path: '/app/assessments/abc'
      },
      'https://govern.example'
    );
    assert.equal(m.subject, 'New task: DPO review: DPIA-2026-0007');
    assert.match(
      m.text,
      /new work for you in Acme: DPO review: DPIA-2026-0007\. It is due 2026-11-09\./
    );
    assert.match(
      m.text,
      /Open it: https:\/\/govern\.example\/app\/assessments\/abc/
    );
    assert.match(
      m.text,
      /turn them off on your profile: https:\/\/govern\.example\/app\/profile/
    );
    assert.equal(m.tag, 'task-raised');
  });
});

describe('delivering recorded notifications', () => {
  it('does nothing at all where member email is not on', async () => {
    const w = await world();
    await w.person('ann', { optedIn: true, role: 'privacy_admin' });
    const n = await w.notice({
      recipient: 'privacy_admin',
      kind: 'task.raised',
      taskId: w.task.id
    });
    const { fake, sent } = resend();
    assert.deepEqual(
      await deliverNotifications(w.org.id, { config: null, fetch: fake }),
      { emailed: 0, dealtWith: 0, failed: 0 }
    );
    assert.equal(sent.length, 0);
    assert.equal((await w.read(n.id)).sentAt, null);
  });

  it("emails only the people who asked for it, one email each, without the record's contents", async () => {
    const w = await world();
    const ann = await w.person('ann', { optedIn: true, role: 'privacy_admin' });
    const bea = await w.person('bea', { optedIn: true, role: 'privacy_admin' });
    await w.person('cal', { optedIn: false, role: 'privacy_admin' });
    await w.person('dan', {
      optedIn: true,
      role: 'privacy_admin',
      active: false
    });
    const n = await w.notice({
      recipient: 'privacy_admin',
      kind: 'task.raised',
      taskId: w.task.id
    });

    const { fake, sent } = resend();
    const result = await deliverNotifications(w.org.id, {
      config,
      fetch: fake
    });
    assert.equal(result.emailed, 2);
    assert.deepEqual(
      sent.map((e) => e.to).sort(),
      [[ann.email], [bea.email]].sort()
    );
    assert.ok(
      sent.every((e) => !e.text.includes('Special category')),
      'the description is never emailed'
    );
    assert.ok(
      sent.every((e) => e.text.includes(`/app/assessments/${w.task.subjectId}`))
    );
    const row = await w.read(n.id);
    assert.ok(row.sentAt);
    assert.equal(row.outcome, 'emailed 2');

    // Dealt with once: a second sweep sends nothing more.
    const again = resend();
    assert.equal(
      (await deliverNotifications(w.org.id, { config, fetch: again.fake }))
        .emailed,
      0
    );
    assert.equal(again.sent.length, 0);
  });

  it('records why nobody was emailed', async () => {
    const w = await world();
    const cal = await w.person('cal', { optedIn: false });
    const notOptedIn = await w.notice({
      recipient: cal.email,
      kind: 'mention'
    });
    const nobody = await w.notice({
      recipient: 'unassigned',
      kind: 'task.raised'
    });
    const outsider = await w.notice({
      recipient: 'contributor@elsewhere.example',
      kind: 'task.raised'
    });
    const otherKind = await w.notice({
      recipient: cal.id,
      kind: 'something.else'
    });
    const stale = await w.notice({
      recipient: cal.id,
      kind: 'mention',
      createdAt: new Date(Date.now() - 72 * HOUR)
    });

    const { fake, sent } = resend();
    await deliverNotifications(w.org.id, { config, fetch: fake });
    assert.equal(sent.length, 0);
    assert.equal(
      (await w.read(notOptedIn.id)).outcome,
      'not emailed: nobody asked for email'
    );
    assert.equal(
      (await w.read(nobody.id)).outcome,
      'not emailed: nobody to send to'
    );
    assert.equal(
      (await w.read(outsider.id)).outcome,
      'not emailed: nobody to send to'
    );
    assert.equal(
      (await w.read(otherKind.id)).outcome,
      'not emailed: not an alert kind'
    );
    assert.equal(
      (await w.read(stale.id)).outcome,
      'not emailed: older than 48 hours'
    );
  });

  it('links a mention to the record it was made on, and tries again when the mail service is down', async () => {
    const w = await world();
    const ann = await w.person('ann', { optedIn: true });
    const n = await w.notice({
      recipient: ann.email,
      kind: 'mention',
      subject: 'Bea mentioned you on ROPA-2026-0002',
      body: 'The words of the comment\n\n/app/ropa/xyz'
    });

    const down = resend(false);
    assert.equal(
      (await deliverNotifications(w.org.id, { config, fetch: down.fake }))
        .failed,
      1
    );
    assert.equal((await w.read(n.id)).sentAt, null, 'left to be tried again');

    const up = resend();
    await deliverNotifications(w.org.id, { config, fetch: up.fake });
    assert.equal(up.sent.length, 1);
    assert.match(up.sent[0].text, /Open it: .*\/app\/ropa\/xyz/);
    assert.ok(
      !up.sent[0].text.includes('The words of the comment'),
      'the comment itself is not emailed'
    );
  });
});

describe("a person's own choice", () => {
  it('starts off, and is theirs to change', async () => {
    const [user] = await db
      .insert(users)
      .values({ email: `choice-${crypto.randomUUID()}@example.org` })
      .returning();
    assert.equal((await emailNotificationsFor(user.id)).on, false);
    await setEmailNotifications(user.id, true);
    const on = await emailNotificationsFor(user.id);
    assert.equal(on.on, true);
    assert.ok(on.changedAt);
    await setEmailNotifications(user.id, false);
    assert.equal((await emailNotificationsFor(user.id)).on, false);
  });
});
