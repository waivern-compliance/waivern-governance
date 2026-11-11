import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { after, describe, it } from 'node:test';
import { and, eq } from 'drizzle-orm';

import { db, sql as pg } from '@/db/client';
import {
  auditEvents,
  documents,
  entities,
  memberships,
  notifications,
  organisations,
  roleAssignments,
  users
} from '@/db/schema';
import { GENESIS_HASH } from '@/lib/audit';
import { canonicalise } from '@/lib/canonical';
import { checkExportRequest } from '@/lib/organisation-export-request';
import { mayExportOrganisation } from '@/lib/rbac';
import { zip } from '@/lib/zip';
import { recordRequest } from '@/services/data-subject-requests';
import {
  ExportRefused,
  openOrganisationExport
} from '@/services/organisation-export';
import {
  isExported,
  RULE_BY_TABLE,
  safeFileName,
  TABLES
} from '@/services/organisation-export-tables';
import { createRisk } from '@/services/risks';

import { unzip } from './fixtures/unzip';

const SYSTEM = {
  actorKind: 'system' as const,
  actorUserId: null,
  actorLabel: 'test'
};

after(async () => {
  await pg.end();
});

async function world(label: string) {
  const s = crypto.randomUUID().slice(0, 8);
  const [org] = await db
    .insert(organisations)
    .values({ name: `Export ${label}`, slug: `oexp-${label}-${s}` })
    .returning();
  const [entity] = await db
    .insert(entities)
    .values({ organisationId: org.id, name: 'Main', isDefault: true })
    .returning();
  return { org, entity, s };
}

async function owner(organisationId: string, email: string) {
  const [user] = await db
    .insert(users)
    .values({ email, name: 'An Owner' })
    .returning();
  const [membership] = await db
    .insert(memberships)
    .values({ organisationId, userId: user.id })
    .returning();
  await db.insert(roleAssignments).values({
    membershipId: membership.id,
    role: 'owner',
    scope: 'organisation'
  });
  return user;
}

async function attach(
  organisationId: string,
  filename: string,
  content: Buffer,
  extra: Partial<typeof documents.$inferInsert> = {}
) {
  const [row] = await db
    .insert(documents)
    .values({
      organisationId,
      subjectType: 'organisation',
      subjectId: organisationId,
      filename,
      contentType: 'application/pdf',
      byteSize: content.length,
      sha256: createHash('sha256').update(content).digest('hex'),
      content,
      uploadedByLabel: 'test',
      ...extra
    })
    .returning();
  return row;
}

async function collect(stream: AsyncIterable<Uint8Array>) {
  const parts: Uint8Array[] = [];
  for await (const chunk of stream) parts.push(chunk);
  return Buffer.concat(parts);
}

async function exportOf(
  organisationId: string,
  actorLabel = 'test',
  maxBytes: number | null = null
) {
  const opened = await openOrganisationExport({
    organisationId,
    actor: { ...SYSTEM, actorLabel },
    via: 'test',
    maxBytes
  });
  const files = unzip(await collect(opened.stream()));
  const manifest = JSON.parse(files.get('manifest.json')!.toString('utf8'));
  return { opened, files, manifest };
}

function lines(file: Buffer | undefined): Record<string, unknown>[] {
  if (!file) return [];
  return file
    .toString('utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}

async function databaseTables() {
  const rows = await pg<Array<{ table_name: string }>>`
    select table_name from information_schema.tables
    where table_schema = 'public' and table_type = 'BASE TABLE'`;
  return rows.map((r) => r.table_name).sort();
}

async function databaseColumns(table: string) {
  const rows = await pg<Array<{ column_name: string; data_type: string }>>`
    select column_name, data_type from information_schema.columns
    where table_schema = 'public' and table_name = ${table}`;
  return rows;
}

describe('what the export covers', () => {
  it('accounts for every table in the database, once', async () => {
    const listed = TABLES.map((r) => r.table);
    assert.equal(
      new Set(listed).size,
      listed.length,
      'a table is listed twice'
    );
    const inDatabase = await databaseTables();
    const unaccounted = inDatabase.filter((t) => !RULE_BY_TABLE.has(t));
    assert.deepEqual(
      unaccounted,
      [],
      `Decide whether these leave with an organisation, in src/services/organisation-export-tables.ts: ${unaccounted.join(', ')}`
    );
    const gone = listed.filter((t) => !inDatabase.includes(t));
    assert.deepEqual(gone, [], `Listed but not in the database: ${gone}`);
  });

  it('gives every exclusion a reason', () => {
    for (const rule of TABLES) {
      if (!isExported(rule)) assert.ok(rule.excluded.length > 20, rule.table);
    }
  });

  it('withholds only columns that exist, and turns every stored file into a file', async () => {
    for (const rule of TABLES.filter(isExported)) {
      const columns = await databaseColumns(rule.table);
      const names = columns.map((c) => c.column_name);
      for (const withheld of Object.keys(rule.withhold ?? {})) {
        assert.ok(
          names.includes(withheld),
          `${rule.table}.${withheld} is withheld but does not exist`
        );
      }
      const bytea = columns
        .filter((c) => c.data_type === 'bytea')
        .map((c) => c.column_name);
      assert.deepEqual(
        bytea,
        rule.file ? [rule.file.column] : [],
        `${rule.table}: every bytea column must be exported as a file`
      );
    }
  });

  it('finds every child through a parent that is itself exported by organisation', async () => {
    for (const rule of TABLES.filter(isExported)) {
      if (rule.scope !== 'parent') continue;
      const parent = RULE_BY_TABLE.get(rule.parent);
      assert.ok(parent && isExported(parent), rule.table);
      assert.equal(parent.scope, 'organisation', rule.table);
      const columns = await databaseColumns(rule.parent);
      assert.ok(columns.some((c) => c.column_name === 'organisation_id'));
    }
  });

  it('exports every table that carries an organisation by that organisation', async () => {
    const rows = await pg<Array<{ table_name: string }>>`
      select table_name from information_schema.columns
      where table_schema = 'public' and column_name = 'organisation_id'`;
    for (const { table_name } of rows) {
      const rule = RULE_BY_TABLE.get(table_name);
      assert.ok(rule && isExported(rule), table_name);
      assert.equal(rule.scope, 'organisation', table_name);
    }
  });
});

describe('exporting an organisation', () => {
  it('hands back every row and every file, byte for byte', async () => {
    const w = await world('full');
    const me = await owner(w.org.id, `owner-${w.s}@example.test`);
    await createRisk({
      organisationId: w.org.id,
      entityId: w.entity.id,
      title: 'Records kept too long',
      description: 'x',
      likelihood: 3,
      impact: 2,
      actor: SYSTEM
    });
    await recordRequest({
      organisationId: w.org.id,
      entityId: w.entity.id,
      rights: ['access'],
      channel: 'email',
      receivedAt: new Date(),
      description: 'Everything you hold about me, please.',
      requesterName: 'Sam Requester',
      requesterContact: 'sam@example.com',
      actor: SYSTEM
    });
    const pdf = Buffer.from('%PDF-1.4 a signed agreement');
    const doc = await attach(w.org.id, 'Signed DPA.pdf', pdf);

    const { files, manifest } = await exportOf(w.org.id, me.email);

    for (const table of manifest.tables) {
      const rule = RULE_BY_TABLE.get(table.table);
      assert.ok(rule && isExported(rule));
      const [{ count }] = await pg.unsafe<[{ count: number }]>(
        rule.scope === 'organisation'
          ? `select count(*)::int as count from "${rule.table}" where "${rule.column}" = $1`
          : `select count(*)::int as count from "${rule.table}" c join "${rule.parent}" p on p.id = c."${rule.via}" where p.organisation_id = $1`,
        [w.org.id]
      );
      // The start is recorded just after the snapshot is fixed and the
      // completion once the archive is written: the two events it cannot hold.
      const expected = table.table === 'audit_event' ? count - 2 : count;
      const file = files.get(table.path);
      assert.ok(file, table.path);
      assert.equal(lines(file).length, expected, table.table);
      assert.equal(table.rows, expected, table.table);
      assert.equal(
        createHash('sha256').update(file).digest('hex'),
        table.sha256,
        table.table
      );
    }

    const path = `files/document/${doc.id}/Signed DPA.pdf`;
    assert.deepEqual(files.get(path), pdf);
    const listed = manifest.files.find(
      (f: { path: string }) => f.path === path
    );
    assert.equal(listed.sha256, doc.sha256);
    assert.deepEqual(lines(files.get('data/document.jsonl'))[0].content, {
      file: path
    });

    // On exit the controller is owed what the day-to-day spreadsheet keeps out.
    const [request] = lines(files.get('data/data_subject_request.jsonl'));
    assert.equal(request.requester_name, 'Sam Requester');
    assert.equal(request.requester_contact, 'sam@example.com');

    const [member] = lines(files.get('data/membership.jsonl'));
    assert.equal(member.user_email, me.email);
    assert.ok(files.get('csv/risks.csv'));
    assert.ok(files.get('audit/audit-log.csv'));
    assert.ok(
      manifest.excludedTables.some(
        (t: { table: string }) => t.table === 'app_user'
      )
    );
  });

  it('carries nothing of another organisation', async () => {
    const mine = await world('mine');
    const theirs = await world('theirs');
    const risk = await createRisk({
      organisationId: theirs.org.id,
      entityId: theirs.entity.id,
      title: 'Theirs',
      description: 'x',
      likelihood: 1,
      impact: 1,
      actor: SYSTEM
    });
    const doc = await attach(theirs.org.id, 'theirs.pdf', Buffer.from('%PDF'));

    const { files } = await exportOf(mine.org.id);
    for (const [name, content] of files) {
      const text = content.toString('latin1');
      for (const id of [theirs.org.id, theirs.entity.id, risk.id, doc.id]) {
        assert.ok(!text.includes(id), `${id} appears in ${name}`);
      }
    }
  });

  it('withholds credentials, hashes and quarantined files, and says so', async () => {
    const w = await world('withheld');
    await db
      .update(organisations)
      .set({
        consentAnalyserTokenCiphertext: 'secret-ciphertext',
        consentAnalyserTokenIv: 'iv',
        consentAnalyserTokenTag: 'tag',
        consentAnalyserTokenHint: '1234'
      })
      .where(eq(organisations.id, w.org.id));
    const bad = await attach(w.org.id, 'eicar.pdf', Buffer.from('X5O!P%@AP'), {
      quarantinedAt: new Date(),
      quarantineSignature: 'Eicar-Test-Signature'
    });

    const { files, manifest } = await exportOf(w.org.id);
    const [organisation] = lines(files.get('data/organisation.jsonl'));
    assert.equal(organisation.consent_analyser_token_hint, '1234');
    assert.ok(!('consent_analyser_token_ciphertext' in organisation));
    assert.ok(
      ![...files.values()].some((f) =>
        f.toString('latin1').includes('secret-ciphertext')
      )
    );
    assert.ok(![...files.keys()].some((name) => name.includes(bad.id + '/')));
    assert.equal(manifest.filesWithheld[0].row.id, bad.id);
    const [record] = lines(files.get('data/document.jsonl'));
    assert.match(
      String((record.content as { withheld: string }).withheld),
      /Quarantined/
    );
  });

  it('records the start and the completion, and tells the other owners', async () => {
    const w = await world('audited');
    const me = await owner(w.org.id, `me-${w.s}@example.test`);
    const other = await owner(w.org.id, `other-${w.s}@example.test`);
    const { files, manifest } = await exportOf(w.org.id, me.email);

    const events = await db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.organisationId, w.org.id));
    const started = events.find(
      (e) => e.action === 'organisation.export_started'
    );
    const done = events.find((e) => e.action === 'organisation.exported');
    assert.ok(started && done);
    assert.equal(
      done.after?.manifestSha256,
      createHash('sha256').update(files.get('manifest.json')!).digest('hex')
    );
    assert.equal(
      (done.after?.rowsByTable as Record<string, number>).risk,
      manifest.tables.find((t: { table: string }) => t.table === 'risk').rows
    );
    // Both come after the snapshot; the manifest names the start instead.
    const exported = lines(files.get('data/audit_event.jsonl'));
    assert.ok(
      !exported.some((e) => String(e.action).startsWith('organisation.export'))
    );
    assert.equal(manifest.exportStartedEvent.hash, started.hash);
    assert.equal(manifest.exportStartedEvent.seq, Number(started.seq));

    const told = await db
      .select()
      .from(notifications)
      .where(
        and(
          eq(notifications.organisationId, w.org.id),
          eq(notifications.kind, 'organisation.exported')
        )
      );
    assert.deepEqual(
      told.map((n) => n.recipient),
      [other.email]
    );
  });

  it('carries an audit chain that verifies from the archive alone', async () => {
    const w = await world('chain');
    for (const title of ['One', 'Two']) {
      await createRisk({
        organisationId: w.org.id,
        entityId: w.entity.id,
        title,
        description: 'x',
        likelihood: 1,
        impact: 1,
        actor: SYSTEM
      });
    }
    const { files } = await exportOf(w.org.id);
    const events = lines(files.get('data/audit_event.jsonl')).sort(
      (a, b) => Number(a.seq) - Number(b.seq)
    );
    assert.ok(events.length >= 2);
    let previous = GENESIS_HASH;
    for (const e of events) {
      assert.equal(e.prev_hash, previous);
      const payload = canonicalise([
        e.organisation_id,
        Number(e.seq),
        e.at,
        e.actor_kind,
        e.actor_user_id ?? null,
        e.actor_label,
        e.action,
        e.subject_type,
        e.subject_id,
        e.entity_id ?? null,
        e.before ?? null,
        e.after ?? null,
        e.metadata,
        e.prev_hash
      ]);
      assert.equal(
        createHash('sha256').update(payload).digest('hex'),
        e.hash,
        `event ${e.seq}`
      );
      previous = String(e.hash);
    }
  });

  it('runs one export at a time, and records nothing for a refusal', async () => {
    const w = await world('busy');
    const first = await openOrganisationExport({
      organisationId: w.org.id,
      actor: SYSTEM,
      via: 'test',
      maxBytes: null
    });
    await assert.rejects(
      openOrganisationExport({
        organisationId: w.org.id,
        actor: SYSTEM,
        via: 'test',
        maxBytes: null
      }),
      (e: unknown) => e instanceof ExportRefused && e.reason === 'busy'
    );
    await first.close();
    const second = await openOrganisationExport({
      organisationId: w.org.id,
      actor: SYSTEM,
      via: 'test',
      maxBytes: null
    });
    await second.close();
  });

  it('refuses an organisation too large to download, before recording a start', async () => {
    const w = await world('large');
    // Compresses to almost nothing on disk, but is sent at its full length.
    await attach(w.org.id, 'big.pdf', Buffer.alloc(4096, 1));
    await assert.rejects(
      openOrganisationExport({
        organisationId: w.org.id,
        actor: SYSTEM,
        via: 'test',
        maxBytes: 1024
      }),
      (e: unknown) => e instanceof ExportRefused && e.reason === 'too_large'
    );
    const events = await db
      .select()
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.organisationId, w.org.id),
          eq(auditEvents.action, 'organisation.export_started')
        )
      );
    assert.equal(events.length, 0);
  });
});

describe('who may export everything', () => {
  it('is an owner over the whole organisation, and nobody else', () => {
    assert.equal(
      mayExportOrganisation([{ role: 'owner', scope: 'organisation' }]),
      true
    );
    assert.equal(
      mayExportOrganisation([
        { role: 'owner', scope: 'entity', entityId: crypto.randomUUID() }
      ]),
      false
    );
    assert.equal(
      mayExportOrganisation([{ role: 'privacy_admin', scope: 'organisation' }]),
      false
    );
    assert.equal(
      mayExportOrganisation([{ role: 'auditor', scope: 'organisation' }]),
      false
    );
  });
});

describe('asking for the export', () => {
  const OWNER = [{ role: 'owner' as const, scope: 'organisation' as const }];
  const request = {
    grants: OWNER,
    origin: 'https://govern.example',
    ownOrigin: 'https://govern.example',
    organisationName: 'Acme Ltd',
    typed: 'Acme Ltd'
  };

  it('goes ahead for an owner of the whole organisation who typed its name', () => {
    assert.deepEqual(checkExportRequest(request), { ok: true });
    assert.deepEqual(
      checkExportRequest({ ...request, origin: null, typed: ' Acme Ltd ' }),
      { ok: true }
    );
  });

  it('refuses anybody else, whatever they typed', () => {
    for (const grants of [
      [{ role: 'privacy_admin' as const, scope: 'organisation' as const }],
      [
        {
          role: 'owner' as const,
          scope: 'entity' as const,
          entityId: crypto.randomUUID()
        }
      ],
      []
    ]) {
      const check = checkExportRequest({ ...request, grants });
      assert.equal(check.ok, false);
      assert.equal(check.ok === false && check.status, 403);
    }
  });

  it('refuses a form posted from another site', () => {
    const check = checkExportRequest({
      ...request,
      origin: 'https://elsewhere.example'
    });
    assert.equal(check.ok === false && check.status, 403);
  });

  it('sends the owner back when the name does not match', () => {
    assert.deepEqual(checkExportRequest({ ...request, typed: 'acme ltd' }), {
      ok: false,
      status: 303,
      reason: 'confirm'
    });
  });
});

describe('the archive format', () => {
  it('names files safely whatever they were called', () => {
    assert.equal(safeFileName('../../etc/passwd', 'file'), '_.._etc_passwd');
    assert.equal(safeFileName('a:b*c?.pdf', 'file'), 'a_b_c_.pdf');
    assert.equal(safeFileName('', 'file'), 'file');
  });

  it('writes a zip that another reader can open', async () => {
    const big = Buffer.alloc(200_000, 7);
    const archive = await collect(
      zip([
        { name: 'a.txt', data: 'hello', compress: true },
        { name: 'dir/b.bin', data: big, compress: false },
        {
          name: 'c.jsonl',
          data: (async function* () {
            yield Buffer.from('{"a":1}\n');
            yield Buffer.from('{"a":2}\n');
          })(),
          compress: true
        }
      ])
    );
    const files = unzip(archive);
    assert.equal(files.get('a.txt')?.toString(), 'hello');
    assert.deepEqual(files.get('dir/b.bin'), big);
    assert.equal(files.get('c.jsonl')?.toString(), '{"a":1}\n{"a":2}\n');
  });

  it('refuses a path that would escape the folder it is unpacked into', async () => {
    await assert.rejects(
      collect(zip([{ name: '../x', data: 'x', compress: false }]))
    );
  });
});
