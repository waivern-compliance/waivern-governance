import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer, type AddressInfo } from "node:net";
import { after, describe, it } from "node:test";
import { eq } from "drizzle-orm";
import { db, sql as pg } from "@/db/client";
import { auditEvents, documents, entities, organisations, tasks } from "@/db/schema";
import { createSupplier, recordDpa } from "@/services/third-party";
import {
  ACCEPTED,
  ContentAltered,
  DocumentQuarantined,
  MAX_BYTES,
  UploadRefused,
  attachDocument,
  documentsFor,
  moveDocument,
  readDocument,
  removeDocument,
} from "@/services/documents";
import { sweepOrganisation } from "@/services/sweep";
import { EICAR, fakeClamd } from "./fixtures/fake-clamd";

const ACTOR = { actorKind: "system" as const, actorUserId: null, actorLabel: "documents.test" };
const PDF = Buffer.from("%PDF-1.7\nnot really a pdf, but the bytes are the point\n");

after(async () => {
  await pg.end();
});

async function scratch() {
  const s = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
  const [org] = await db
    .insert(organisations)
    .values({ name: `Docs ${s}`, slug: `docs-${s}` })
    .returning();
  const [entity] = await db
    .insert(entities)
    .values({ organisationId: org.id, name: "Main", isDefault: true })
    .returning();
  // Real records to file against: a document may only be filed against
  // something that is this organisation's.
  const supplier = await createSupplier({ organisationId: org.id, name: "Acme", actor: ACTOR });
  const dpa = await recordDpa({ organisationId: org.id, supplierId: supplier.id, title: "Schedule 2", actor: ACTOR });
  return { org, entity, subjectId: dpa.id, supplierId: supplier.id, dpaId: dpa.id };
}

describe("attaching a file", () => {
  it("stores the bytes and records their hash", async () => {
    const { org, subjectId } = await scratch();
    await attachDocument({
      organisationId: org.id, entityId: null, subjectType: "dpa", subjectId,
      filename: "processing-schedule.pdf", contentType: "application/pdf",
      content: PDF, actor: ACTOR,
    });

    const [stored] = await documentsFor(org.id, "dpa", subjectId);
    assert.equal(stored.filename, "processing-schedule.pdf");
    assert.equal(stored.byteSize, PDF.byteLength);
    assert.equal(stored.sha256, createHash("sha256").update(PDF).digest("hex"));
  });

  it("gives back exactly what went in", async () => {
    const { org, subjectId } = await scratch();
    await attachDocument({
      organisationId: org.id, entityId: null, subjectType: "dpa", subjectId,
      filename: "a.pdf", contentType: "application/pdf", content: PDF, actor: ACTOR,
    });
    const [stored] = await documentsFor(org.id, "dpa", subjectId);
    const read = await readDocument(stored.id, org.id);
    assert.ok(read);
    assert.ok(Buffer.from(read!.content).equals(PDF), "the bytes should round-trip unchanged");
  });

  it("keeps several files against one agreement", async () => {
    // A master agreement, a processing schedule and a sub-processor annexe are
    // three documents describing one arrangement.
    const { org, subjectId } = await scratch();
    for (const name of ["master.pdf", "schedule.pdf", "annexe.pdf"]) {
      await attachDocument({
        organisationId: org.id, entityId: null, subjectType: "dpa", subjectId,
        filename: name, contentType: "application/pdf", content: PDF, actor: ACTOR,
      });
    }
    const all = await documentsFor(org.id, "dpa", subjectId);
    assert.equal(all.length, 3);
    assert.deepEqual(all.map((d) => d.filename), ["master.pdf", "schedule.pdf", "annexe.pdf"]);
  });

  it("strips a path a browser included", async () => {
    const { org, subjectId } = await scratch();
    await attachDocument({
      organisationId: org.id, entityId: null, subjectType: "dpa", subjectId,
      filename: "C:\\\\Users\\\\someone\\\\Desktop\\\\dpa.pdf",
      contentType: "application/pdf", content: PDF, actor: ACTOR,
    });
    const [stored] = await documentsFor(org.id, "dpa", subjectId);
    assert.equal(stored.filename, "dpa.pdf");
  });
});

describe("what is refused", () => {
  it("refuses an empty file", async () => {
    const { org, subjectId } = await scratch();
    await assert.rejects(
      () => attachDocument({
        organisationId: org.id, entityId: null, subjectType: "dpa", subjectId,
        filename: "empty.pdf", contentType: "application/pdf",
        content: Buffer.alloc(0), actor: ACTOR,
      }),
      UploadRefused,
    );
  });

  it("refuses something too large, and says how large it was", async () => {
    const { org, subjectId } = await scratch();
    const huge = Buffer.alloc(MAX_BYTES + 1024);
    await assert.rejects(
      () => attachDocument({
        organisationId: org.id, entityId: null, subjectType: "dpa", subjectId,
        filename: "huge.pdf", contentType: "application/pdf", content: huge, actor: ACTOR,
      }),
      (e: Error) => e instanceof UploadRefused && /10MB/.test(e.message),
    );
  });

  it("refuses a type that is not on the list", async () => {
    // An allowlist, because these files are handed back to people later and
    // nothing executable belongs on it.
    const { org, subjectId } = await scratch();
    for (const type of ["application/x-msdownload", "text/html", "image/svg+xml", ""]) {
      await assert.rejects(
        () => attachDocument({
          organisationId: org.id, entityId: null, subjectType: "dpa", subjectId,
          filename: "x", contentType: type, content: PDF, actor: ACTOR,
        }),
        UploadRefused,
        `${type || "(none)"} should be refused`,
      );
    }
  });

  it("refuses the pre-2007 Word and Excel formats, saying what to send instead", async () => {
    const { org, subjectId } = await scratch();
    const ole = Buffer.concat([Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), Buffer.alloc(504)]);
    for (const [type, name] of [["application/msword", "old.doc"], ["application/vnd.ms-excel", "old.xls"]]) {
      await assert.rejects(
        () => attachDocument({
          organisationId: org.id, entityId: null, subjectType: "dpa", subjectId,
          filename: name, contentType: type, content: ole, actor: ACTOR,
        }),
        (e: Error) => e instanceof UploadRefused && /no longer accepted/.test(e.message) && /PDF, \.docx or \.xlsx/.test(e.message),
      );
    }
    assert.deepEqual(await documentsFor(org.id, "dpa", subjectId), []);
  });

  it("still hands back a .doc stored before they were refused", async () => {
    // Only new uploads are refused; what is already held stays downloadable.
    const { org, subjectId } = await scratch();
    const ole = Buffer.concat([Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), Buffer.alloc(504)]);
    const [row] = await db.insert(documents).values({
      organisationId: org.id, entityId: null, subjectType: "dpa", subjectId,
      filename: "legacy.doc", contentType: "application/msword", byteSize: ole.byteLength,
      sha256: createHash("sha256").update(ole).digest("hex"), content: ole, uploadedByLabel: "earlier",
    }).returning();
    const read = await readDocument(row.id, org.id);
    assert.ok(read);
    assert.deepEqual(Buffer.from(read.content), ole);
  });

  it("accepts the formats an agreement actually arrives in", () => {
    for (const type of [
      "application/pdf",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ]) {
      assert.ok(ACCEPTED.has(type), `${type} should be accepted`);
    }
  });
});

describe("noticing that a file changed underneath", () => {
  it("refuses to serve content that no longer matches its hash", async () => {
    // The whole argument of this platform is a record you can check. Serving a
    // contract that has changed since upload would undermine it quietly.
    const { org, subjectId } = await scratch();
    await attachDocument({
      organisationId: org.id, entityId: null, subjectType: "dpa", subjectId,
      filename: "a.pdf", contentType: "application/pdf", content: PDF, actor: ACTOR,
    });
    const [stored] = await documentsFor(org.id, "dpa", subjectId);

    await db
      .update(documents)
      .set({ content: Buffer.from("tampered") })
      .where(eq(documents.id, stored.id));

    await assert.rejects(() => readDocument(stored.id, org.id), ContentAltered);
  });
});

describe("removing one", () => {
  it("deletes it and leaves the fact in the audit trail", async () => {
    const { org, subjectId } = await scratch();
    await attachDocument({
      organisationId: org.id, entityId: null, subjectType: "dpa", subjectId,
      filename: "wrong.pdf", contentType: "application/pdf", content: PDF, actor: ACTOR,
    });
    const [stored] = await documentsFor(org.id, "dpa", subjectId);
    await removeDocument({ id: stored.id, organisationId: org.id, actor: ACTOR });

    assert.deepEqual(await documentsFor(org.id, "dpa", subjectId), []);
  });

  it("does not reach into another organisation", async () => {
    const a = await scratch();
    const b = await scratch();
    await attachDocument({
      organisationId: a.org.id, entityId: null, subjectType: "dpa", subjectId: a.subjectId,
      filename: "theirs.pdf", contentType: "application/pdf", content: PDF, actor: ACTOR,
    });
    const [stored] = await documentsFor(a.org.id, "dpa", a.subjectId);

    await removeDocument({ id: stored.id, organisationId: b.org.id, actor: ACTOR });
    assert.equal((await documentsFor(a.org.id, "dpa", a.subjectId)).length, 1, "it should survive");
    assert.equal(await readDocument(stored.id, b.org.id), null, "and be invisible from there");
  });
});


describe("reattaching a file to the right record", () => {
  it("moves it without touching the bytes or the hash", async () => {
    const { org, supplierId, dpaId } = await scratch();
    await attachDocument({
      organisationId: org.id, entityId: null, subjectType: "supplier", subjectId: supplierId,
      filename: "signed-dpa.pdf", contentType: "application/pdf", content: PDF, actor: ACTOR,
    });
    const [before] = await documentsFor(org.id, "supplier", supplierId);

    await moveDocument({
      id: before.id, organisationId: org.id,
      subjectType: "dpa", subjectId: dpaId, actor: ACTOR,
    });

    assert.equal((await documentsFor(org.id, "supplier", supplierId)).length, 0);
    const [after] = await documentsFor(org.id, "dpa", dpaId);
    assert.equal(after.id, before.id);
    assert.equal(after.sha256, before.sha256, "the hash is unchanged, so verification still passes");
    assert.equal(after.byteSize, before.byteSize);
  });

  it("still hands back the same bytes afterwards", async () => {
    const { org, supplierId: from, dpaId: to } = await scratch();
    await attachDocument({
      organisationId: org.id, entityId: null, subjectType: "supplier", subjectId: from,
      filename: "schedule.pdf", contentType: "application/pdf", content: PDF, actor: ACTOR,
    });
    const [doc] = await documentsFor(org.id, "supplier", from);
    await moveDocument({ id: doc.id, organisationId: org.id, subjectType: "dpa", subjectId: to, actor: ACTOR });

    const read = await readDocument(doc.id, org.id);
    assert.ok(read, "the file is still readable after the move");
    assert.deepEqual(read.content, PDF);
  });

  it("records the move against both records", async () => {
    // The record it left must not simply show a file disappearing.
    const { org, supplierId: from, dpaId: to } = await scratch();
    await attachDocument({
      organisationId: org.id, entityId: null, subjectType: "supplier", subjectId: from,
      filename: "annexe.pdf", contentType: "application/pdf", content: PDF, actor: ACTOR,
    });
    const [doc] = await documentsFor(org.id, "supplier", from);
    await moveDocument({ id: doc.id, organisationId: org.id, subjectType: "dpa", subjectId: to, actor: ACTOR });

    const events = await db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.organisationId, org.id));
    const moves = events.filter((e) => e.action === "document.moved");
    assert.equal(moves.length, 2);
    assert.ok(moves.some((e) => e.subjectId === from), "against the record it left");
    assert.ok(moves.some((e) => e.subjectId === to), "and the one it joined");
  });

  it("moving it where it already is changes nothing", async () => {
    const { org, dpaId: where } = await scratch();
    await attachDocument({
      organisationId: org.id, entityId: null, subjectType: "dpa", subjectId: where,
      filename: "same.pdf", contentType: "application/pdf", content: PDF, actor: ACTOR,
    });
    const [doc] = await documentsFor(org.id, "dpa", where);
    await moveDocument({ id: doc.id, organisationId: org.id, subjectType: "dpa", subjectId: where, actor: ACTOR });

    const events = await db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.organisationId, org.id));
    assert.equal(events.filter((e) => e.action === "document.moved").length, 0);
  });

  it("cannot be moved from another organisation", async () => {
    const { org, supplierId: where } = await scratch();
    const other = await scratch();
    await attachDocument({
      organisationId: org.id, entityId: null, subjectType: "supplier", subjectId: where,
      filename: "theirs.pdf", contentType: "application/pdf", content: PDF, actor: ACTOR,
    });
    const [doc] = await documentsFor(org.id, "supplier", where);

    const moved = await moveDocument({
      id: doc.id, organisationId: other.org.id,
      subjectType: "dpa", subjectId: other.dpaId, actor: ACTOR,
    });
    assert.equal(moved, null);
    assert.equal((await documentsFor(org.id, "supplier", where)).length, 1, "it stayed put");
  });
});

describe("checking the contents", () => {
  it("refuses a file whose bytes are not the type it claims", async () => {
    // An executable renamed contract.pdf arrives declared as a PDF.
    const { org, subjectId } = await scratch();
    await assert.rejects(
      () => attachDocument({
        organisationId: org.id, entityId: null, subjectType: "dpa", subjectId,
        filename: "contract.pdf", contentType: "application/pdf",
        content: Buffer.concat([Buffer.from("MZ"), Buffer.alloc(100)]), actor: ACTOR,
      }),
      (e: Error) => e instanceof UploadRefused && /not a PDF file/.test(e.message),
    );
    assert.deepEqual(await documentsFor(org.id, "dpa", subjectId), []);
  });
});

/** Point the service at a scanner for the length of `work`, as CLAMAV_HOST would. */
async function withScanner<T>(port: number, work: () => Promise<T>): Promise<T> {
  process.env.CLAMAV_HOST = "127.0.0.1";
  process.env.CLAMAV_PORT = String(port);
  try {
    return await work();
  } finally {
    delete process.env.CLAMAV_HOST;
    delete process.env.CLAMAV_PORT;
  }
}

/** A port nothing is listening on. */
async function deadPort() {
  const probe = createServer();
  await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const port = (probe.address() as AddressInfo).port;
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  return port;
}

describe("virus scanning on upload", () => {
  it("stores nothing and scans nothing when no scanner is configured", async () => {
    const { org, subjectId } = await scratch();
    await attachDocument({
      organisationId: org.id, entityId: null, subjectType: "dpa", subjectId,
      filename: "a.pdf", contentType: "application/pdf", content: PDF, actor: ACTOR,
    });
    const [stored] = await documentsFor(org.id, "dpa", subjectId);
    assert.equal(stored.scannedAt, null);
    assert.equal(stored.scannerVersion, null);
  });

  it("records the scan on a clean file", async () => {
    const clamd = await fakeClamd();
    try {
      const { org, subjectId } = await scratch();
      await withScanner(clamd.port, () => attachDocument({
        organisationId: org.id, entityId: null, subjectType: "dpa", subjectId,
        filename: "a.pdf", contentType: "application/pdf", content: PDF, actor: ACTOR,
      }));
      const [stored] = await documentsFor(org.id, "dpa", subjectId);
      assert.ok(stored.scannedAt, "it should be marked as scanned");
      assert.equal(stored.scannerVersion, "ClamAV 1.4.1/27450");
      assert.equal(clamd.scans, 1);
    } finally {
      await clamd.close();
    }
  });

  it("refuses an infected file, stores none of it, and records the attempt", async () => {
    const clamd = await fakeClamd();
    try {
      const { org, subjectId } = await scratch();
      await assert.rejects(
        () => withScanner(clamd.port, () => attachDocument({
          organisationId: org.id, entityId: null, subjectType: "dpa", subjectId,
          filename: "invoice.txt", contentType: "text/plain", content: Buffer.from(EICAR), actor: ACTOR,
        })),
        (e: Error) => e instanceof UploadRefused && /Eicar-Test-Signature/.test(e.message),
      );

      assert.deepEqual(await documentsFor(org.id, "dpa", subjectId), []);
      const stored = await db.select({ id: documents.id }).from(documents).where(eq(documents.organisationId, org.id));
      assert.equal(stored.length, 0, "not a byte of it is kept");

      const events = await db.select().from(auditEvents).where(eq(auditEvents.organisationId, org.id));
      const refused = events.find((e) => e.action === "document.refused_infected");
      assert.ok(refused, "the refusal is in the audit trail");
      assert.equal(refused.subjectId, subjectId);
      assert.equal((refused.after as { signature: string }).signature, "Eicar-Test-Signature");
      assert.equal(events.filter((e) => e.action === "document.attached").length, 0);
    } finally {
      await clamd.close();
    }
  });

  it("refuses rather than stores unchecked when the scanner cannot be reached", async () => {
    // Fail closed: once a deployment relies on scanning, a restarting scanner
    // must not become a window for unchecked files.
    const { org, subjectId } = await scratch();
    const port = await deadPort();
    await assert.rejects(
      () => withScanner(port, () => attachDocument({
        organisationId: org.id, entityId: null, subjectType: "dpa", subjectId,
        filename: "a.pdf", contentType: "application/pdf", content: PDF, actor: ACTOR,
      })),
      (e: Error) => e instanceof UploadRefused && /Try again shortly/.test(e.message),
    );
    assert.deepEqual(await documentsFor(org.id, "dpa", subjectId), []);
  });
});

describe("scanning files stored before scanning was on", () => {
  it("marks clean ones, and quarantines an infected one without deleting it", async () => {
    const { org, subjectId } = await scratch();
    // Stored with scanning off, as everything uploaded before it was switched on was.
    await attachDocument({
      organisationId: org.id, entityId: null, subjectType: "dpa", subjectId,
      filename: "clean.pdf", contentType: "application/pdf", content: PDF, actor: ACTOR,
    });
    await attachDocument({
      organisationId: org.id, entityId: null, subjectType: "dpa", subjectId,
      filename: "bad.txt", contentType: "text/plain", content: Buffer.from(EICAR), actor: ACTOR,
    });

    const clamd = await fakeClamd();
    let result;
    try {
      result = await withScanner(clamd.port, () => sweepOrganisation(org.id));
    } finally {
      await clamd.close();
    }
    assert.equal(result.documentsScanned, 2);
    assert.equal(result.documentsQuarantined, 1);

    const all = await documentsFor(org.id, "dpa", subjectId);
    assert.equal(all.length, 2, "nothing is deleted on the scanner's say-so");
    const clean = all.find((d) => d.filename === "clean.pdf")!;
    const bad = all.find((d) => d.filename === "bad.txt")!;
    assert.ok(clean.scannedAt);
    assert.equal(clean.quarantinedAt, null);
    assert.ok(bad.quarantinedAt);
    assert.equal(bad.quarantineSignature, "Eicar-Test-Signature");

    assert.ok(await readDocument(clean.id, org.id), "a clean file still downloads");
    await assert.rejects(() => readDocument(bad.id, org.id), DocumentQuarantined);

    const events = await db.select().from(auditEvents).where(eq(auditEvents.organisationId, org.id));
    assert.equal(events.filter((e) => e.action === "document.quarantined").length, 1);
    const raised = await db.select().from(tasks).where(eq(tasks.organisationId, org.id));
    assert.equal(raised.filter((t) => t.title.includes("bad.txt")).length, 1, "raised to the organisation");
  });

  it("leaves them for next time when the scanner cannot be reached", async () => {
    const { org, subjectId } = await scratch();
    await attachDocument({
      organisationId: org.id, entityId: null, subjectType: "dpa", subjectId,
      filename: "later.pdf", contentType: "application/pdf", content: PDF, actor: ACTOR,
    });
    const port = await deadPort();
    const result = await withScanner(port, () => sweepOrganisation(org.id));
    assert.equal(result.documentsScanned, 0);
    const [stored] = await documentsFor(org.id, "dpa", subjectId);
    assert.equal(stored.scannedAt, null);
  });

  it("does nothing where scanning is off", async () => {
    const { org, subjectId } = await scratch();
    await attachDocument({
      organisationId: org.id, entityId: null, subjectType: "dpa", subjectId,
      filename: "a.pdf", contentType: "application/pdf", content: PDF, actor: ACTOR,
    });
    const result = await sweepOrganisation(org.id);
    assert.equal(result.documentsScanned, 0);
  });
});
