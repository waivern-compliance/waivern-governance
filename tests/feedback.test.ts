import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { eq } from "drizzle-orm";
import { db, sql as pg, withOrganisation } from "@/db/client";
import { feedback, organisations } from "@/db/schema";
import { FEEDBACK_MAX, FeedbackRefused, cleanFeedback, placeOf } from "@/lib/feedback";
import { deleteFeedback, feedbackInbox, markFeedbackHandled, submitFeedback } from "@/services/feedback";

after(() => pg.end());

describe("where it was given", () => {
  it("names the page and takes record ids out of the route", () => {
    assert.deepEqual(placeOf("/app/ropa/fb20ceef-8528-43bb-b508-8cf3177e634f?tab=1#x"), {
      place: "/app/ropa/[id]",
      label: "A processing record",
    });
    assert.deepEqual(placeOf("/app/ropa"), { place: "/app/ropa", label: "Processing register" });
    assert.equal(placeOf("/app/requests/DSR-2026-0003").place, "/app/requests/[id]");
    assert.equal(placeOf("/app").label, "Home");
    assert.equal(placeOf("/app/admin/organisation").label, "Organisation");
    assert.equal(placeOf("/somewhere/else").label, "Elsewhere");
  });
});

describe("what is kept", () => {
  it("keeps the email address only when the person agreed, and refuses empty or overlong feedback", () => {
    const base = { message: "  The export button is hard to find.  ", pathname: "/app/exports", email: "Person@Example.org" };
    assert.equal(cleanFeedback({ ...base, shareEmail: false }).contactEmail, null);
    const shared = cleanFeedback({ ...base, shareEmail: true });
    assert.equal(shared.contactEmail, "person@example.org");
    assert.equal(shared.message, "The export button is hard to find.");
    assert.equal(shared.placeLabel, "Exports");
    assert.throws(() => cleanFeedback({ ...base, message: " ", shareEmail: false }), FeedbackRefused);
    assert.throws(() => cleanFeedback({ ...base, message: "x".repeat(FEEDBACK_MAX + 1), shareEmail: false }), /up to/);
    assert.throws(() => cleanFeedback({ ...base, email: null, shareEmail: true }), /anonymously/);
  });

  it("stores anonymous feedback with nothing that names anyone, and lets an operator deal with or delete it", async () => {
    const marker = `Feedback test ${crypto.randomUUID()}`;
    const anonymous = await submitFeedback({ message: marker, pathname: "/app/ai/0b6c1d84-2c2e-4c64-9d8e-3c6a5f1b2a10", shareEmail: false, email: "anon@example.org" });
    const [row] = await db.select().from(feedback).where(eq(feedback.id, anonymous.id));
    assert.equal(row.contactEmail, null);
    assert.equal(row.place, "/app/ai/[id]");
    assert.ok(!JSON.stringify(row).includes("anon@example.org"));
    assert.deepEqual(Object.keys(row).sort(), ["contactEmail", "createdAt", "handledAt", "id", "message", "place", "placeLabel"]);

    const named = await submitFeedback({ message: `${marker} please call`, pathname: "/app", shareEmail: true, email: "named@example.org" });
    const inbox = await feedbackInbox();
    assert.ok(inbox.findIndex((r) => r.id === named.id) < inbox.findIndex((r) => r.id === anonymous.id), "newest first");
    assert.equal(inbox.find((r) => r.id === named.id)!.contactEmail, "named@example.org");

    await markFeedbackHandled(named.id, true);
    assert.ok((await feedbackInbox()).find((r) => r.id === named.id)!.handledAt);
    await deleteFeedback(named.id);
    await deleteFeedback(anonymous.id);
    assert.equal((await db.select().from(feedback).where(eq(feedback.id, named.id))).length, 0);
  });

  it("cannot be read from inside an organisation's work", async () => {
    const [org] = await db.insert(organisations).values({ name: "Feedback isolation", slug: `fb-${crypto.randomUUID().slice(0, 8)}` }).returning();
    const kept = await submitFeedback({ message: "Visible only to Waivern", pathname: "/app", shareEmail: false, email: null });
    const seen = await withOrganisation(org.id, () => db.select().from(feedback)).catch(() => []);
    assert.equal(seen.length, 0);
    await deleteFeedback(kept.id);
  });
});
