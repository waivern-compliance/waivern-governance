import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { eq, sql } from 'drizzle-orm';

import { db, sql as pg } from '@/db/client';
import { auditChainHeads, auditEvents, organisations } from '@/db/schema';
import {
  appendAuditEvent,
  audit,
  CONTENTS_ERASED,
  eraseAuditContents,
  GENESIS_HASH,
  SCHEME_CHANGED,
  verifyAuditChain
} from '@/lib/audit';
import { canonicalise, sha256Hex } from '@/lib/canonical';

/** Each run works in its own organisation so tests never see each other's chain. */
async function freshOrg(label: string) {
  const slug = `test-${label}-${crypto.randomUUID().slice(0, 8)}`;
  const [org] = await db
    .insert(organisations)
    .values({ name: `Test ${label}`, slug })
    .returning();
  return org;
}

/**
 * Drizzle wraps a driver error in a "Failed query" error and hangs the real one
 * off `cause`, so an assertion against the top-level message would pass even
 * when the database refused for an entirely different reason.
 */
function messageChain(err: unknown): string {
  const parts: string[] = [];
  let current: unknown = err;
  while (current instanceof Error) {
    parts.push(current.message);
    current = current.cause;
  }
  return parts.join(' | ');
}

function event(organisationId: string, action: string) {
  return {
    organisationId,
    actorKind: 'system' as const,
    actorLabel: 'test',
    action,
    subjectType: 'organisation' as const,
    subjectId: organisationId
  };
}

after(async () => {
  await pg.end();
});

describe('canonical serialisation', () => {
  it('is stable across key insertion order', () => {
    assert.equal(
      canonicalise({ b: 1, a: { d: 4, c: 3 } }),
      canonicalise({ a: { c: 3, d: 4 }, b: 1 })
    );
  });

  it('distinguishes an absent key from a null one', () => {
    assert.notEqual(canonicalise({ a: 1 }), canonicalise({ a: 1, b: null }));
  });

  it('drops undefined rather than emitting it', () => {
    assert.equal(canonicalise({ a: 1, b: undefined }), canonicalise({ a: 1 }));
  });

  it('preserves array order, which carries meaning', () => {
    assert.notEqual(canonicalise([1, 2]), canonicalise([2, 1]));
  });
});

describe('audit chain', () => {
  it('verifies a chain it wrote itself', async () => {
    const org = await freshOrg('verify');
    for (let i = 0; i < 5; i++) await audit(event(org.id, `test.step_${i}`));

    const result = await verifyAuditChain(org.id);
    assert.equal(result.ok, true);
    assert.equal(result.ok && result.events, 5);
  });

  it('numbers events from 1 with no gaps', async () => {
    const org = await freshOrg('seq');
    for (let i = 0; i < 4; i++) await audit(event(org.id, 'test.step'));

    const rows = await db
      .select({ seq: auditEvents.seq })
      .from(auditEvents)
      .where(eq(auditEvents.organisationId, org.id))
      .orderBy(auditEvents.seq);

    assert.deepEqual(
      rows.map((r) => r.seq),
      [1, 2, 3, 4]
    );
  });

  it('serialises concurrent appends instead of forking the chain', async () => {
    const org = await freshOrg('concurrent');
    // Twenty writers racing for the same chain head. Without the row lock in
    // appendAuditEvent these would read the same predecessor and produce
    // duplicate sequence numbers or a forked prev_hash.
    await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        audit(event(org.id, `test.race_${i}`))
      )
    );

    const result = await verifyAuditChain(org.id);
    assert.equal(result.ok, true, `chain broke: ${JSON.stringify(result)}`);
    assert.equal(result.ok && result.events, 20);
  });

  it('writes the audit event in the same transaction as the change', async () => {
    const org = await freshOrg('atomic');

    await assert.rejects(
      db.transaction(async (tx) => {
        await appendAuditEvent(tx, event(org.id, 'test.doomed'));
        throw new Error('business rule failed after the audit write');
      })
    );

    const rows = await db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.organisationId, org.id));
    assert.equal(
      rows.length,
      0,
      'a rolled-back change must leave no audit trace'
    );
  });
});

describe('append-only enforcement', () => {
  it('refuses an UPDATE at the database', async () => {
    const org = await freshOrg('no-update');
    await audit(event(org.id, 'test.written'));

    await assert.rejects(
      db.execute(
        sql`update audit_event set action = 'tampered' where organisation_id = ${org.id}`
      ),
      (err) => /audit_event is append-only: UPDATE/.test(messageChain(err))
    );
  });

  it('refuses a DELETE at the database', async () => {
    const org = await freshOrg('no-delete');
    await audit(event(org.id, 'test.written'));

    await assert.rejects(
      db.execute(
        sql`delete from audit_event where organisation_id = ${org.id}`
      ),
      (err) => /audit_event is append-only: DELETE/.test(messageChain(err))
    );
  });

  it('detects tampering that bypasses the trigger', async () => {
    const org = await freshOrg('tamper');
    for (let i = 0; i < 3; i++) await audit(event(org.id, `test.step_${i}`));

    // Simulate an attacker with enough privilege to disable the trigger — the
    // case the hash chain exists for. The write succeeds; the chain still tells.
    await db.execute(
      sql`alter table audit_event disable trigger audit_event_no_update`
    );
    try {
      await db.execute(
        sql`update audit_event set action = 'quietly.changed'
            where organisation_id = ${org.id} and seq = 2`
      );
    } finally {
      await db.execute(
        sql`alter table audit_event enable trigger audit_event_no_update`
      );
    }

    const result = await verifyAuditChain(org.id);
    assert.equal(result.ok, false);
    assert.equal(result.ok === false && result.reason, 'hash_mismatch');
    assert.equal(result.ok === false && result.failedAtSeq, 2);
  });
});

/** An event with something in it to erase. */
function withContents(organisationId: string, n: number) {
  return {
    ...event(organisationId, `test.contents_${n}`),
    before: { name: `Jane Example ${n}` },
    after: { name: `Jane Other ${n}` },
    metadata: { note: `about Jane ${n}` }
  };
}

/** Change a row as an attacker with the trigger switched off would. */
async function bypass(work: () => Promise<unknown>) {
  await db.execute(
    sql`alter table audit_event disable trigger audit_event_no_update`
  );
  try {
    await work();
  } finally {
    await db.execute(
      sql`alter table audit_event enable trigger audit_event_no_update`
    );
  }
}

/** A chain written before digests: scheme 1 hashes over the contents. */
async function legacyChain(organisationId: string, n: number) {
  let prev = GENESIS_HASH;
  for (let seq = 1; seq <= n; seq++) {
    const at = new Date(Date.now() - (n - seq) * 1000);
    const before = { name: `Old Jane ${seq}` };
    const hash = await sha256Hex(
      canonicalise([
        organisationId,
        seq,
        at.toISOString(),
        'system',
        null,
        'legacy',
        'test.old',
        'organisation',
        organisationId,
        null,
        before,
        null,
        {},
        prev
      ])
    );
    await db.insert(auditEvents).values({
      organisationId,
      seq,
      at,
      actorKind: 'system',
      actorLabel: 'legacy',
      action: 'test.old',
      subjectType: 'organisation',
      subjectId: organisationId,
      before,
      metadata: {},
      prevHash: prev,
      hash,
      scheme: 1
    });
    prev = hash;
  }
  await db
    .insert(auditChainHeads)
    .values({ organisationId, seq: n, headHash: prev, scheme: 1 });
  return prev;
}

async function eventsOf(organisationId: string) {
  return db
    .select()
    .from(auditEvents)
    .where(eq(auditEvents.organisationId, organisationId))
    .orderBy(auditEvents.seq);
}

async function erase(organisationId: string, seqs: number[]) {
  const rows = await eventsOf(organisationId);
  return db.transaction((tx) =>
    eraseAuditContents(tx, {
      organisationId,
      eventIds: rows.filter((r) => seqs.includes(r.seq)).map((r) => r.id),
      reason: 'test',
      actor: { actorKind: 'system', actorLabel: 'test' },
      subject: { subjectType: 'organisation', subjectId: organisationId }
    })
  );
}

describe('content digests', () => {
  it('hashes new events over a digest of their contents', async () => {
    const org = await freshOrg('digest');
    for (let i = 0; i < 3; i++) await audit(withContents(org.id, i));
    const rows = await eventsOf(org.id);
    assert.ok(rows.every((r) => r.scheme === 2 && r.contentDigest));
    const check = await verifyAuditChain(org.id);
    assert.deepEqual(check, {
      ok: true,
      events: 3,
      headHash: rows[2].hash,
      erased: 0
    });
  });

  it('detects changed contents', async () => {
    const org = await freshOrg('contents');
    for (let i = 0; i < 3; i++) await audit(withContents(org.id, i));
    await bypass(() =>
      db.execute(sql`update audit_event set before = '{"name":"Someone else"}'
        where organisation_id = ${org.id} and seq = 2`)
    );
    const result = await verifyAuditChain(org.id);
    assert.equal(result.ok === false && result.reason, 'digest_mismatch');
    assert.equal(result.ok === false && result.failedAtSeq, 2);
  });

  it('detects a changed digest, alone or with the contents to match', async () => {
    const org = await freshOrg('digest-tamper');
    for (let i = 0; i < 3; i++) await audit(withContents(org.id, i));
    await bypass(() =>
      db.execute(sql`update audit_event set content_digest = ${'f'.repeat(64)}
        where organisation_id = ${org.id} and seq = 2`)
    );
    let result = await verifyAuditChain(org.id);
    assert.equal(result.ok === false && result.reason, 'digest_mismatch');

    const forged = { name: 'Forged' };
    const digest = await sha256Hex(canonicalise([forged, null, {}]));
    await bypass(() =>
      db.execute(sql`update audit_event
        set before = ${JSON.stringify(forged)}::jsonb, after = null,
            metadata = '{}'::jsonb, content_digest = ${digest}
        where organisation_id = ${org.id} and seq = 2`)
    );
    result = await verifyAuditChain(org.id);
    assert.equal(result.ok === false && result.reason, 'hash_mismatch');
    assert.equal(result.ok === false && result.failedAtSeq, 2);
  });
});

describe('erasing contents', () => {
  it('clears the contents, keeps the digest, and still verifies', async () => {
    const org = await freshOrg('erase');
    for (let i = 0; i < 4; i++) await audit(withContents(org.id, i));
    const before = await eventsOf(org.id);
    const done = await erase(org.id, [2, 3]);
    assert.equal(done.erased, 2);

    const rows = await eventsOf(org.id);
    for (const seq of [2, 3]) {
      const row = rows.find((r) => r.seq === seq)!;
      const was = before.find((r) => r.seq === seq)!;
      assert.equal(row.before, null);
      assert.equal(row.after, null);
      assert.deepEqual(row.metadata, {});
      assert.equal(row.contentDigest, was.contentDigest);
      assert.equal(row.hash, was.hash);
      assert.equal(row.erasedBy, done.eventId);
    }
    const record = rows.find((r) => r.id === done.eventId)!;
    assert.equal(record.action, CONTENTS_ERASED);
    assert.deepEqual(record.metadata, {
      reason: 'test',
      count: 2,
      seqs: [2, 3]
    });
    assert.ok(!JSON.stringify(rows).includes('Jane Example 2'));

    const check = await verifyAuditChain(org.id);
    assert.equal(check.ok, true);
    assert.equal(check.ok && check.erased, 2);
  });

  it('is refused by the database unless a declared erasure names the event', async () => {
    const org = await freshOrg('erase-refused');
    await audit(withContents(org.id, 1));
    await assert.rejects(
      db.execute(sql`update audit_event
        set before = null, after = null, metadata = '{}'::jsonb,
            erased_at = now(), erased_by = id
        where organisation_id = ${org.id} and seq = 1`),
      (err) => /audit_event is append-only: UPDATE/.test(messageChain(err))
    );
  });

  it('catches an erasure nobody declared', async () => {
    const org = await freshOrg('erase-undeclared');
    for (let i = 0; i < 2; i++) await audit(withContents(org.id, i));
    await bypass(() =>
      db.execute(sql`update audit_event
        set before = null, after = null, metadata = '{}'::jsonb, erased_at = now()
        where organisation_id = ${org.id} and seq = 1`)
    );
    const result = await verifyAuditChain(org.id);
    assert.equal(result.ok === false && result.reason, 'undeclared_erasure');
  });

  it("never reaches another organisation's events", async () => {
    const mine = await freshOrg('erase-mine');
    const theirs = await freshOrg('erase-theirs');
    await audit(withContents(mine.id, 1));
    for (let i = 0; i < 2; i++) await audit(withContents(theirs.id, i));
    const before = await eventsOf(theirs.id);
    const done = await db.transaction((tx) =>
      eraseAuditContents(tx, {
        organisationId: mine.id,
        eventIds: before.map((r) => r.id),
        reason: 'test',
        actor: { actorKind: 'system', actorLabel: 'test' },
        subject: { subjectType: 'organisation', subjectId: mine.id }
      })
    );
    assert.equal(done.erased, 0);
    assert.deepEqual(await eventsOf(theirs.id), before);
    assert.equal((await verifyAuditChain(theirs.id)).ok, true);
  });
});

describe('a chain begun before digests', () => {
  it('verifies the old way until its next event', async () => {
    const org = await freshOrg('legacy');
    await legacyChain(org.id, 3);
    const check = await verifyAuditChain(org.id);
    assert.equal(check.ok, true);
    assert.equal(check.ok && check.events, 3);
  });

  it('moves to digests on its next event, rewriting no hash', async () => {
    const org = await freshOrg('legacy-move');
    const oldHead = await legacyChain(org.id, 3);
    const before = await eventsOf(org.id);
    await audit(withContents(org.id, 9));

    const rows = await eventsOf(org.id);
    assert.equal(rows.length, 5);
    for (const was of before) {
      const now = rows.find((r) => r.id === was.id)!;
      assert.equal(now.hash, was.hash, 'an old hash was rewritten');
      assert.equal(now.scheme, 1);
      assert.ok(now.contentDigest);
    }
    const change = rows[3];
    assert.equal(change.action, SCHEME_CHANGED);
    assert.equal(change.prevHash, oldHead);
    assert.equal(change.scheme, 2);
    assert.equal(
      (change.metadata as { oldHeadHash: string }).oldHeadHash,
      oldHead
    );
    assert.equal(
      (change.metadata as { convertedEvents: number }).convertedEvents,
      3
    );
    assert.equal(rows[4].scheme, 2);
    assert.equal((await verifyAuditChain(org.id)).ok, true);
  });

  it('still verifies once an old event is erased, and catches it altered afterwards', async () => {
    const org = await freshOrg('legacy-erase');
    await legacyChain(org.id, 3);
    await audit(withContents(org.id, 9));
    await erase(org.id, [2]);
    const check = await verifyAuditChain(org.id);
    assert.equal(check.ok, true);
    assert.equal(check.ok && check.erased, 1);

    await bypass(() =>
      db.execute(sql`update audit_event set action = 'quietly.changed'
        where organisation_id = ${org.id} and seq = 2`)
    );
    const result = await verifyAuditChain(org.id);
    assert.equal(result.ok, false);
    assert.equal(result.ok === false && result.reason, 'scheme_mismatch');
  });

  it('catches an old event changed before the move', async () => {
    const org = await freshOrg('legacy-tamper');
    await legacyChain(org.id, 3);
    await bypass(() =>
      db.execute(sql`update audit_event set before = '{"name":"Other"}'
        where organisation_id = ${org.id} and seq = 1`)
    );
    const result = await verifyAuditChain(org.id);
    assert.equal(result.ok === false && result.reason, 'hash_mismatch');
    assert.equal(result.ok === false && result.failedAtSeq, 1);
  });
});
