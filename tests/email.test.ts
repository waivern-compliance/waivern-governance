import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { describeTestOutcome, feedbackEmail, organisationRequestEmail, testEmail } from "@/lib/email/platform-alerts";
import { emailConfig, missingEmailSettings, sendEmail, type EmailConfig } from "@/lib/email/resend";

const config: EmailConfig = { apiKey: "re_test", from: "govern@waivern.example" };
const email = { to: ["Ops@Waivern.example", "ops@waivern.example", " second@waivern.example "], subject: "S", text: "T", tag: "t" };

/** A stand-in for fetch that records the request and answers as Resend would. */
function resend(status: number, body: unknown) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fake = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  }) as unknown as typeof fetch;
  return { fake, calls };
}

describe("when email is sent at all", () => {
  it("only on Waivern's hosted service, with a token and a sender", () => {
    const hosted = { WAIVERN_HOSTED: "true", RESEND_API_KEY: "re_x", EMAIL_FROM: "a@b.example" };
    assert.deepEqual(emailConfig(hosted), { apiKey: "re_x", from: "a@b.example" });
    assert.equal(emailConfig({ ...hosted, WAIVERN_HOSTED: undefined }), null);
    assert.equal(emailConfig({ ...hosted, RESEND_API_KEY: " " }), null);
    assert.equal(emailConfig({ ...hosted, EMAIL_FROM: undefined }), null);
  });

  it("does nothing, quietly, when not configured or nobody is to be told", async () => {
    const { fake, calls } = resend(200, { id: "m" });
    assert.deepEqual(await sendEmail(email, { config: null, fetch: fake }), { sent: false, reason: "not_configured" });
    assert.deepEqual(await sendEmail({ ...email, to: [" "] }, { config, fetch: fake }), { sent: false, reason: "no_recipients" });
    assert.equal(calls.length, 0);
  });
});

describe("sending through Resend", () => {
  it("posts one message to each address once, with the API key", async () => {
    const { fake, calls } = resend(200, { id: "abc" });
    assert.deepEqual(await sendEmail(email, { config, fetch: fake }), { sent: true, messageId: "abc" });
    assert.equal(calls[0].url, "https://api.resend.com/emails");
    assert.equal((calls[0].init.headers as Record<string, string>).Authorization, "Bearer re_test");
    const body = JSON.parse(String(calls[0].init.body));
    assert.deepEqual(body.to, ["ops@waivern.example", "second@waivern.example"]);
    assert.equal(body.from, "govern@waivern.example");
    assert.equal(body.text, "T");
    assert.deepEqual(body.tags, [{ name: "kind", value: "t" }]);
  });

  it("reports a refusal or an outage instead of throwing", async () => {
    const refused = resend(422, { statusCode: 422, name: "validation_error", message: "Invalid from" });
    assert.deepEqual(await sendEmail(email, { config, fetch: refused.fake }), { sent: false, reason: "resend_validation_error" });
    const down = (async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    assert.deepEqual(await sendEmail(email, { config, fetch: down }), { sent: false, reason: "unreachable" });
  });
});

describe("what the platform administrators are told", () => {
  it("a new organisation request, with a link to decide it", () => {
    const m = organisationRequestEmail(
      { organisationName: "Acme", entityName: "Acme Ltd", requestedByEmail: "dpo@acme.example", note: "Two sites" },
      "https://govern.example",
    );
    assert.equal(m.subject, "New organisation request: Acme");
    assert.match(m.text, /dpo@acme\.example has asked/);
    assert.match(m.text, /First legal entity: Acme Ltd/);
    assert.match(m.text, /Two sites/);
    assert.match(m.text, /https:\/\/govern\.example\/platform\n/);
  });

  it("feedback, naming the sender only when they agreed", () => {
    const anonymous = feedbackEmail({ message: "Hard to find", placeLabel: "Exports", contactEmail: null }, "https://g.example");
    assert.equal(anonymous.subject, "Feedback about Exports");
    assert.match(anonymous.text, /anonymously/);
    assert.ok(!anonymous.text.includes("@"));
    assert.match(anonymous.text, /https:\/\/g\.example\/platform\/feedback/);
    const named = feedbackEmail({ message: "Hard to find", placeLabel: "Exports", contactEmail: "p@x.example" }, "https://g.example");
    assert.match(named.text, /p@x\.example sent feedback/);
  });
});

describe("the test email", () => {
  it("names which settings are missing, never their values", () => {
    assert.deepEqual(missingEmailSettings({}), ["WAIVERN_HOSTED", "RESEND_API_KEY", "EMAIL_FROM"]);
    assert.deepEqual(missingEmailSettings({ WAIVERN_HOSTED: "true", RESEND_API_KEY: "re_secret" }), ["EMAIL_FROM"]);
    assert.deepEqual(missingEmailSettings({ WAIVERN_HOSTED: "true", RESEND_API_KEY: "re_secret", EMAIL_FROM: "a@b.example" }), []);
  });

  it("says who asked for it and that nothing needs doing", () => {
    const m = testEmail("ops@waivern.example", "https://g.example");
    assert.equal(m.subject, "Test email");
    assert.equal(m.tag, "test");
    assert.match(m.text, /ops@waivern\.example sent this/);
  });

  it("explains each outcome in words an operator can act on", () => {
    assert.deepEqual(describeTestOutcome({ sent: true, messageId: "id1" }, 2), {
      ok: true,
      message: "Sent to 2 platform administrators. Resend's message id is id1.",
    });
    const missing = describeTestOutcome({ sent: false, reason: "not_configured" }, 1, ["RESEND_API_KEY"]);
    assert.equal(missing.ok, false);
    assert.match(missing.message, /Missing: RESEND_API_KEY\./);
    assert.ok(!missing.message.includes("re_"));
    assert.match(describeTestOutcome({ sent: false, reason: "resend_validation_error" }, 1).message, /verified in Resend/);
    assert.match(describeTestOutcome({ sent: false, reason: "resend_invalid_api_key" }, 1).message, /Check RESEND_API_KEY/);
    assert.match(describeTestOutcome({ sent: false, reason: "unreachable" }, 1).message, /could not be reached/);
    assert.match(describeTestOutcome({ sent: false, reason: "no_recipients" }, 0).message, /PLATFORM_ADMINS names nobody/);
  });
});
