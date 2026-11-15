# Trial accounts

Somebody gives an email address, proves it is theirs, and has an organisation
of their own for `TRIAL_DAYS` (7 days, `src/lib/trial-rules.ts`): a fictional
demo company with simulated colleagues. A trial is for fictional data only,
uploads nothing of its own and reaches no real person but the one trying it.
Only a platform administrator (`PLATFORM_ADMINS`) can extend it or convert
it to a full account. Off unless `TRIAL_SIGN_UP=true`.

## Sign-up and sign-in

1. `/trial` asks for a work email (a personal one is allowed) and,
   optionally, the organisation's name. It also needs a tick accepting that
   the trial is for fictional data only, with special category data named.
   The answer is the same whatever the address, so the form cannot tell
   anybody who has an account here.
2. The address gets one email (`lib/email/trial.ts`): a link, or, for an
   address with a full account, a note to sign in as usual, or, for a trial
   whose records have gone, a note that it has ended.
3. The link is `/trial/start#<token>`: 32 random bytes, stored only as its
   SHA-256, single use, valid for 30 minutes. The token sits after `#`, so it
   never reaches a server log. Opening the page uses nothing; pressing
   Continue posts the token to a server action, so a mail scanner that
   prefetches links spends nothing.
4. Continue calls `signIn('trial', ...)`, an Auth.js Credentials provider
   (`src/auth.ts`) whose `authorize` is `redeemTrialLink`. That marks the link
   used in the same statement that checks it, then starts the trial, or finds
   the address's existing trial and signs back in to it.
5. Starting a trial is `setUpOrganisation`, which is what approving an
   organisation request does. In the same transaction it also writes the
   `trial` row, `trial.started`, `trial.fictional_data_accepted` (the time
   and the statement accepted, as the person's own act), and the simulated
   colleagues. The demo records follow, through the ordinary services.

One mailbox has one trial, ever (lower case, no `+tag`, no dots for Gmail).
A session lasts 12 hours, as any does; asking again on `/trial` signs back in.
Somebody who also belongs to a real organisation carries on there once the
trial ends; only someone with nothing else is sent to `/trial/ended`.

The limits are counted and the attempt recorded under one advisory lock, so
a burst sent at once cannot all read the same count. Anti-abuse, beyond the
limits of 3 an hour for each mailbox, 5 an hour and 20
a day for each IP address (HMAC, as the public forms keep theirs), and 100 an
hour overall:

- a hidden field, which is told it worked and does nothing;
- a signed opening time, so a form sent in under 3 seconds is refused;
- one trial per canonical mailbox;
- nothing a trial can do sends anything to anyone else, so it is worth little
  to a spammer.

## The demo company and simulated colleagues

`services/trial-demo.ts` fills the trial as Brackenfield Home Goods, a made-up
retailer:

- three processing activities;
- a breach discovered 20 hours ago, so its 72-hour clock is running;
- an AI system with two risks;
- one supplier with an unsigned, soon-to-lapse agreement and one with none;
- a subject access request and a complaint.

Every person's contact is at `example.com`.

Three simulated colleagues hold the approver, privacy analyst and AI
governance roles. They are `app_user` rows with `simulated = true`, at
`<name>.<org>@simulated.invalid`, named "(simulated)". `.invalid` is
reserved and can never receive mail. Several layers keep them unreachable:

- `sendEmail` drops any `.invalid` recipient, and member email skips them;
- sign-in refuses them;
- a check constraint makes a simulated row keep that domain, with no email
  notifications and no SSO subject.

Approvals, reviews and tasks for their roles reach them in the app only.

For the approval loop, the trial user acts as the approver. An owner may
decide every stage (`mayDecideStage`), so they can draft, submit and approve
and see the whole loop. Each decision is recorded as theirs, not as the
colleague's, so nothing is attributed to a person who does not exist. The
assessment page says so beside the stages.

## Example files instead of uploads

`lib/trial-samples.ts` holds three fictional plain-text files: a data
processing addendum with deliberate gaps, a penetration test summary and a
training record. Where an upload box would be, a trial sees one-click
buttons. The action reads only the sample's id, and `attachSampleDocument`
takes no content, so the bytes stored are ones the server already holds.
They then go through the same scan and storage as any upload.
`attachDocument` still refuses a trial, and `tests/trial-gates.test.ts`
checks from the source that the sample path takes no file or bytes.
Reading an agreement with a model needs an AI provider, which a trial
cannot configure, so extraction does not run on them in a trial.

## Enforcement

Three layers, so no single forgotten check opens anything:

- **Capabilities.** `file.upload` and `contact.outside` are new capabilities,
  held by every role that writes records (and `contact.outside` by
  contributors, who could always send a section on). `loadMemberships` marks
  every grant in an unconverted trial organisation `trial: true`, read from
  the database on every request, never from a persona. `can` withholds
  `member.manage`, `file.upload` and `contact.outside` from a trial grant.
  Each gated action asks for one of them first, through `requireCapability`
  or `refusedUnless`, which returns a refusal worded for the trial through
  `refusable()`.
- **Services.** Each service that stores a file, issues a link or form for
  somebody outside, adds a member, configures an outside connection or makes
  an outside request calls `refuseDuringTrial` first
  (`services/trial-guard.ts`). The Integration API refuses a trial
  organisation's connection when it authenticates.
- **Database.** A trial organisation can have no member but the person
  trying it and its simulated colleagues until it is converted (migration
  0115).

`tests/trial-gates.test.ts` reads the source. It fails if a service does any
of those things without the guard, or an action reads an uploaded file or
calls a guarded service without asking for a withheld capability first. Each
exemption is listed with its reason. `tests/trials.test.ts` calls every
guarded service as a trial and expects a refusal.

## The clock

`getActiveSession` sends a trial past `ends_at` to `/trial/ended` from every
page, action and download. Nothing has to run for a trial to stop. A banner
on every page counts down, repeats that the trial is for fictional data
only, and refreshes the page at the end. In the last 48 hours
(`REQUEST_WINDOW_HOURS`), and after the end, `Your trial` and `/trial/ended`
offer two things:

- a request for more time or a full account, which goes to the platform
  administrators by email and to `/platform`, where they extend it by 1 to
  30 days, convert it, or decline it with a reason, each decision audited in
  the trial's own chain;
- a link to book a guided demo or an advisory session (`TRIAL_BOOKING_URL`,
  hidden when unset), with a note that Govern is open source (AGPL-3.0) and
  can be self-hosted.

## After it ends

Records are kept for 30 days after the end, so a late conversion keeps its
work. A request made before then holds the trial back until an
administrator answers it; none can be made after. Then the hourly sweep
(`purgeEndedTrials`) does three things, re-checking under a lock on the
trial row, which requests and decisions take too, that nothing extended,
converted or asked about it since it was found due. It makes an empty
entity the default, because entity deletion never takes the last or default
one. It deletes every other entity through `eraseEntityForPlatform`: the
same transaction as an owner's deletion (PR #49), with the audit chain kept
whole and the contents of its events erased. Finally it ends the
memberships, deletes the trial's requests and sign-up rows, erases the
contents of the audit events about the trial and its requests (all but the
fictional-data acceptance, which holds only a time and a fixed statement),
clears the organisation name the person gave, and marks the trial `purged`.

What remains is the organisation row, renamed "Ended trial", its audit chain,
and the `app_user` rows of the person and the simulated colleagues. Audit
events keep the actor's email as their label, as they do for every deleted
entity.

## Conversion

Converting lifts every restriction and suspends the simulated colleagues'
memberships, each with its `membership.suspended` event: they can never sign
in or be emailed, so approvals and tasks routed to their roles in a real
organisation would wait on nobody.
