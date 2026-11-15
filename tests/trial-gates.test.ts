/**
 * Nothing that uploads a file or reaches outside the organisation can be
 * added without a trial being refused it.
 *
 * Two layers, each checked from the source so a new path fails here until
 * somebody gates it or says why it needs no gate:
 *
 *  - services: every exported function that stores a file, makes a request
 *    outside, sends email, or brings somebody new in, calls
 *    `refuseDuringTrial` (tested against a real trial in `trials.test.ts`);
 *  - actions and routes: every one that reads an uploaded file, or calls one
 *    of those guarded services, asks first for a capability a trial is
 *    withheld, through `requireCapability` or `refusedUnless`, so a trial is
 *    refused with its reason before anything is read.
 */
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, it } from 'node:test';

import { can, type Grant } from '@/lib/rbac';
import { TRIAL_WITHHELD } from '@/lib/trial';

const ROOT = process.cwd();

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}

/**
 * Each top-level function in a file, exported or not, declared or assigned
 * to a const, with its body: up to the next top-level declaration. Private
 * helpers count, so work moved into one is still seen.
 */
function topLevelFunctions(
  source: string
): Array<{ name: string; body: string }> {
  const starts = [
    ...source.matchAll(
      /^(?:export )?(?:(?:async )?function (\w+)|const (\w+)(?::[^=]+)? = (?:async )?(?:\([^)]*\)|\w+)(?::[^=]+)? =>)/gm
    )
  ].map((m) => ({ index: m.index, name: m[1] ?? m[2] }));
  const boundaries = [
    ...source.matchAll(
      /^(?:export |async function |function |const |let |type |class |\/\*\*)/gm
    )
  ].map((m) => m.index);
  return starts.map((m) => {
    const end = boundaries.find((b) => b > m.index) ?? source.length;
    return { name: m.name, body: source.slice(m.index, end) };
  });
}

const rel = (path: string) => relative(ROOT, path);

// ---------------------------------------------------------------------------
// Services

/** What storing a file, reaching outside or bringing somebody in looks like in a service. */
const SERVICE_PRIMITIVES: Array<[string, RegExp]> = [
  ['stores a file', /\.insert\((documents|importBatches|importFiles)\)/],
  [
    'issues a link for somebody outside',
    /\.insert\((contributorLinks|dsrIntakeLinks)\)/
  ],
  ['adds a member', /\.insert\(memberships\)/],
  ['claims a domain', /\.insert\(organisationDomains\)/],
  ['configures an outside connection', /\.insert\(integrationConnections\)/],
  ['makes a request outside', /\b(fetch|fetchPage|fetchReport)\(/],
  ['sends email', /\bsendEmail\(/],
  ['asks an AI model', /\bask\(/]
];

/**
 * Service functions that do one of those and need no trial check of their
 * own, and why. Anything new must be gated or argued for here.
 */
const SERVICE_EXEMPT: Record<string, string> = {
  'organisation-requests.setUpOrganisation':
    "creates a new organisation's first owner; a trial is made through it, with that owner as its only member",
  'trial-demo.addSimulatedColleagues':
    "adds a trial's fictional colleagues, at simulated.invalid, which cannot sign in or be mailed (migration 0115 and sendEmail refuse them)",
  'domains.joinByVerifiedDomain':
    'joins an organisation that has verified a domain, which a trial cannot (claimDomain and verifyDomain refuse), and the database refuses a trial a second member (migration 0115)',
  'documents.insertDocument':
    "runs inside a guarded caller's transaction: attachDocument, an import, or the Integration API, which refuses a trial when it authenticates",
  'assistant.converse':
    "asks the organisation's own AI provider, which a trial cannot configure (saveProvider refuses), and there is no platform default",
  'extraction.persist':
    "asks the organisation's own AI provider, which a trial cannot configure (saveProvider refuses), and there is no platform default",
  'webhooks.deliverPending':
    'delivers to connections, and a trial cannot have one (createConnection refuses, authenticate refuses)',
  'agreement-notices.notifyAgreementChanges':
    "emails an organisation's own owners: in a trial, only the person trying it",
  'member-email.deliverNotifications':
    "emails an organisation's own members: in a trial, only the person trying it",
  'entity-erasure.requestEntityErasure':
    'emails the link to the person asking, at their own address',
  'entity-erasure.confirmEntityErasure':
    'emails confirmation to the person who asked, and the platform administrators',
  'trials.requestTrialLink':
    'emails the address that asked for the trial, and nobody else'
};

const SERVICES_DIR = join(ROOT, 'src/services');

function serviceFunctions() {
  return readdirSync(SERVICES_DIR)
    .filter((f) => f.endsWith('.ts'))
    .flatMap((file) =>
      topLevelFunctions(readFileSync(join(SERVICES_DIR, file), 'utf8')).map(
        (fn) => ({ ...fn, key: `${file.replace(/\.ts$/, '')}.${fn.name}` })
      )
    );
}

/** Service functions that refuse a trial themselves: what an action calling them must gate. */
function guardedServices(): Set<string> {
  return new Set(
    serviceFunctions()
      .filter((fn) => /\brefuseDuringTrial\(/.test(fn.body))
      .map((fn) => fn.name)
  );
}

describe('services a trial must not reach', () => {
  it('sees private helpers and arrow functions, not only exported declarations', () => {
    const names = topLevelFunctions(
      [
        'async function notify() {}',
        'export const send = async (to: string) => {};',
        'export async function run() {}'
      ].join('\n')
    ).map((fn) => fn.name);
    assert.deepEqual(names, ['notify', 'send', 'run']);
  });

  it('refuse a trial themselves, or say why they need not', () => {
    const missing: string[] = [];
    for (const fn of serviceFunctions()) {
      const does = SERVICE_PRIMITIVES.filter(([, re]) => re.test(fn.body));
      if (does.length === 0) continue;
      if (fn.key in SERVICE_EXEMPT) continue;
      if (/\brefuseDuringTrial\(/.test(fn.body)) continue;
      missing.push(`${fn.key} (${does.map(([what]) => what).join(', ')})`);
    }
    assert.deepEqual(missing, [], 'ungated services');
  });

  it('keeps no exemption for a function that is gone or now gated', () => {
    const all = new Map(serviceFunctions().map((fn) => [fn.key, fn.body]));
    const stale = Object.keys(SERVICE_EXEMPT).filter(
      (key) =>
        !all.has(key) ||
        !SERVICE_PRIMITIVES.some(([, re]) => re.test(all.get(key)!))
    );
    assert.deepEqual(stale, []);
  });
});

// ---------------------------------------------------------------------------
// Actions and routes

/**
 * Each action or route that uploads or reaches outside, and the capability
 * it asks for first. Listed, not only detected, so removing a gate fails
 * here as well as adding an ungated one.
 */
const GATED: Record<string, (typeof TRIAL_WITHHELD)[number]> = {
  'src/app/app/third-parties/documentActions.ts uploadDocumentsAction':
    'file.upload',
  'src/app/app/admin/imports/actions.ts uploadImportAction': 'file.upload',
  'src/app/app/admin/imports/actions.ts addImportFilesAction': 'file.upload',
  'src/app/app/admin/imports/actions.ts readImportedAgreementsAction':
    'contact.outside',
  'src/app/app/cookies/actions.ts uploadReportAction': 'file.upload',
  'src/app/app/cookies/actions.ts analyserSettingsAction': 'contact.outside',
  'src/app/app/cookies/actions.ts startScanAction': 'contact.outside',
  'src/app/app/intake-form-settings.ts setFormAppearanceFrom': 'file.upload',
  'src/app/app/assessments/[id]/actions.ts inviteAction': 'contact.outside',
  'src/app/app/requests/actions.ts issueIntakeLinkAction': 'contact.outside',
  'src/app/app/information-requests/actions.ts issueFoiFormAction':
    'contact.outside',
  'src/app/app/third-parties/extractionActions.ts followLinkAction':
    'contact.outside',
  'src/app/app/admin/actions.ts saveProviderAction': 'contact.outside',
  'src/app/app/admin/actions.ts testProviderAction': 'contact.outside',
  'src/app/app/admin/actions.ts inviteAction': 'member.manage',
  'src/app/app/admin/actions.ts revokeRoleAction': 'member.manage',
  'src/app/app/admin/actions.ts setActiveAction': 'member.manage',
  'src/app/app/admin/actions.ts setPersonaAction': 'member.manage',
  'src/app/app/admin/actions.ts handOverAction': 'member.manage',
  'src/app/app/admin/actions.ts claimDomainAction': 'member.manage',
  'src/app/app/admin/actions.ts verifyDomainAction': 'member.manage'
};

/** Actions and routes that call a guarded service without a gate of their own, and why. */
const ACTION_EXEMPT: Record<string, string> = {
  'src/app/app/cookies/actions.ts checkScanAction':
    'polls a scan somebody who may write started, for anybody who may read it; nothing can be started in a trial, and checkPropertyScan refuses a trial itself'
};

/** Reads an uploaded file, or calls a service that refuses trials. */
function sensitive(body: string, guarded: Set<string>): string[] {
  const why: string[] = [];
  if (/instanceof File\b/.test(body)) why.push('reads an uploaded file');
  for (const name of guarded)
    if (new RegExp(`\\b${name}\\(`).test(body)) why.push(`calls ${name}`);
  return why;
}

function gateIn(body: string): string[] {
  return [
    ...body.matchAll(/\b(?:requireCapability|refusedUnless)\(\s*'([a-z.]+)'/g)
  ].map((m) => m[1]);
}

/**
 * Every exported function in a TypeScript module under src/app: server
 * actions, route handlers, and the helpers they share (which need not say
 * 'use server' themselves).
 */
function appFunctions() {
  return files(join(ROOT, 'src/app'))
    .filter((f) => /\.ts$/.test(f))
    .flatMap((f) =>
      topLevelFunctions(readFileSync(f, 'utf8')).map((fn) => ({
        ...fn,
        key: `${rel(f)} ${fn.name}`
      }))
    );
}

describe('example files in place of uploads', () => {
  it('take only an id from the form, never a file or bytes', () => {
    const action = appFunctions().find(
      (fn) =>
        fn.key ===
        'src/app/app/third-parties/documentActions.ts attachSampleAction'
    );
    assert.ok(action, 'attachSampleAction exists');
    assert.doesNotMatch(
      action.body,
      /instanceof File|arrayBuffer|getAll\(|Buffer\./
    );
    assert.match(action.body, /formData\.get\('sample'\)/);
  });

  it('accept no content in the service, only which sample', () => {
    const source = readFileSync(
      join(ROOT, 'src/services/documents.ts'),
      'utf8'
    );
    const start = source.indexOf('export async function attachSampleDocument(');
    const signature = source.slice(start, source.indexOf('}) {', start));
    assert.ok(start > -1);
    assert.doesNotMatch(signature, /content|bytes|filename|contentType/);
    assert.match(signature, /sampleId: string/);
  });
});

describe('actions and routes a trial must not use', () => {
  it('ask first for a capability a trial is withheld', () => {
    const guarded = guardedServices();
    const ungated: string[] = [];
    for (const fn of appFunctions()) {
      const why = sensitive(fn.body, guarded);
      if (why.length === 0 || fn.key in ACTION_EXEMPT) continue;
      const gates = gateIn(fn.body).filter((c) =>
        (TRIAL_WITHHELD as readonly string[]).includes(c)
      );
      if (gates.length === 0) ungated.push(`${fn.key} (${why.join(', ')})`);
      else if (!(fn.key in GATED))
        ungated.push(`${fn.key} is gated but not listed in GATED`);
    }
    assert.deepEqual(ungated, [], 'ungated actions');
  });

  it('keep every gate listed', () => {
    const byKey = new Map(appFunctions().map((fn) => [fn.key, fn.body]));
    const wrong: string[] = [];
    for (const [key, capability] of Object.entries(GATED)) {
      const body = byKey.get(key);
      if (!body) wrong.push(`${key} no longer exists`);
      else if (!gateIn(body).includes(capability))
        wrong.push(`${key} no longer asks for ${capability}`);
    }
    assert.deepEqual(wrong, []);
  });

  it('are each refused to a trial, whatever its role', () => {
    const roles = [
      'owner',
      'privacy_admin',
      'privacy_analyst',
      'contributor'
    ] as const;
    for (const [key, capability] of Object.entries(GATED))
      for (const role of roles) {
        const grants: Grant[] = [{ role, scope: 'organisation', trial: true }];
        assert.equal(can(grants, capability), false, `${key} as ${role}`);
      }
  });

  it('are refused when a trial posts to them directly, not only hidden', () => {
    // The gate is the first thing each does, so it runs whatever the form
    // held: a hand-made post finds the same refusal as the hidden button.
    const byKey = new Map(appFunctions().map((fn) => [fn.key, fn.body]));
    const late: string[] = [];
    for (const [key, capability] of Object.entries(GATED)) {
      const body = byKey.get(key) ?? '';
      const gate = body.search(
        new RegExp(
          `(requireCapability|refusedUnless)\\(\\s*'${capability.replace('.', '\\.')}'`
        )
      );
      const reads = body.search(
        /\b(arrayBuffer|issueContributorLink|issueIntakeLink|attachDocument|uploadImport|addImportFiles|ingestAnalyserReport|setAnalyserSettings|startPropertyScan|followLink|saveProvider|testProvider|claimDomain|verifyDomain|inviteMember|handOver|readImportedAgreements|setFormAppearance)\(/
      );
      if (reads !== -1 && gate > reads) late.push(key);
    }
    assert.deepEqual(late, [], 'gates that come after the work');
  });
});
