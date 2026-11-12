# Deleting a legal entity

An owner, or one of the deployment's operators, can delete one legal entity and
every record held for it, for good. It is the other half of leaving: the
whole-organisation export (`docs/data-export-plan.md`) takes everything out,
and this takes an entity's records away.

## The flow

1. **Who can ask.** `mayDeleteEntity` (`lib/rbac.ts`): an owner whose grant
   reaches the entity (organisation-wide, or that entity alone), through the
   `entity.delete` capability, or a platform administrator (`PLATFORM_ADMINS`)
   acting through a membership of the organisation. No other role holds it.
2. **Before asking.** The page (`/app/admin/organisation/delete-entity`) says
   at the top that the deletion is irrevocable and should only be done with the
   full understanding and agreement of the firm's stakeholders and
   decision-makers. It then offers the export: the whole-organisation archive
   for an organisation-wide owner, the register exports for anyone else.
3. **The request.** The person picks the entity and ticks that they
   understand and that it has been agreed. Govern records an `entity_erasure`
   row and emails a single-use link, valid for 30 minutes, to the requester's
   address of record, read from `app_user`. Nothing in the form says where it
   goes. Asking again replaces the earlier link once the new one is sent; if
   it cannot be sent, the earlier link still works. Requests for one entity
   take turns on its row, so only one link is ever live. The token sits after
   `#` in the link, which browsers never send to a server, so it stays out of
   request logs; the page hands it to a server action in a POST body.
4. **The confirmation.** The link opens a page that deletes nothing by being
   opened. The person must be signed in as the requester, in that organisation,
   and still allowed to delete the entity (checked again). They type exactly
   `delete everything`. The deletion then runs at once.
5. **Afterwards.** The requester is emailed written confirmation (DPA clause
   5(h)). Every other organisation-wide owner is notified. The platform
   operators are emailed the organisation and entity ids, so the deletion can
   be repeated after a whole-service restore. The page lists deleted entities,
   with who deleted them, when, and how many records went.

The irrevocable warning and the agree-first sentence appear on the button, in
the email and on the confirmation page. They are the same text, from
`lib/email/entity-erasure.ts`.

## One transaction

`eraseEntity` runs in one transaction for the organisation, under its
row-level security. It does these steps in order:

1. Lock the request and the entity row.
2. Check the blockers again.
3. Mark the request `erasing`, and name it in the transaction-local setting
   `govern.entity_erasure`.
4. Read every row that will go.
5. Delete it all.
6. Erase the contents of the audit events about them (`eraseAuditContents`).
7. Delete the entity.
8. Mark the request `completed`.
9. Append one audit event, `entity.deleted`.

Either all of this happens or none of it does.

Several tables refuse `DELETE` by trigger because they record decisions or
history. Migration 0112 lets each of those guards through for one case only:

- the transaction names a request in `govern.entity_erasure`;
- that request is `erasing`, which a committed row never is;
- the row belongs to the entity that request names.

Outside a deletion every guard refuses exactly as before. The tests check
this.

What goes:

- Every table with an `entity_id`, in `ERASED_BY_ENTITY`. A test checks this
  list against the database, so a table added later cannot be missed.
- Rows with no entity of their own that hang off those records by subject:
  comments, documents, extractions and assistant conversations.
- AI suggestions and record links about the deleted records.
- Children that go by cascade.
- Queued notices and webhook deliveries that name any of those records.

## Decisions

These are defaults, chosen and listed for the user to confirm.

1. **Audit chain: settled by the user as option 3**, built in its own PR,
   "feat: hash audit events over a digest of their contents", which merges
   first. Each audit event's hash covers a digest of its contents, so the
   deletion erases the contents (`before`, `after`, `metadata`) of every event
   about the entity or its records through `eraseAuditContents` and keeps the
   rows and digests. Who did what, when and to which record stays; so does the
   entity's id, which the hash covers, so the foreign key from `audit_event`
   to `entity` is dropped (migration 0113). The erasure is itself an
   `audit.contents_erased` event, and `entity.deleted` records the deletion,
   naming the person who did it and giving counts. The chain still verifies
   end to end, and every erased event is reported as erased, not tampered.
2. **Records with their own retention duties are flagged, not decided.** The
   page, the confirmation page and help name, as examples:
   - the breach register (Art 33(5)) and the PECR regulation 5A inventory;
   - records of processing activities (Art 30) and DPIAs;
   - data subject requests, complaints and FOI requests;
   - risk acceptances, AI assurance records and published ATRS records.

   They tell the person to check with their DPO or adviser and to export
   first. Nothing is held back.

3. **Files** live in Postgres (`bytea`), not object storage, so they go with
   their rows in the same transaction.
4. **Backups.** The page, both emails and help say that copies stay in backups
   for up to 27 days (terms 7.3) and that backups are never restored for one
   organisation. The operator email lets a deletion be repeated after a restore.
5. **Integration API.** Keys and connections belong to the organisation and are
   kept. A connection whose default entity was the deleted one is switched
   off, and its default cleared, rather than quietly sending records to
   another entity. Pending webhook deliveries that name deleted records are
   removed. A later push naming the entity is refused, as for any unknown
   entity.
6. **Last entity, and the default.** Govern refuses to delete:
   - the organisation's only entity, because closing a whole organisation is
     Waivern's to do (terms 11.2);
   - the default entity, until another is made the default.

   It also refuses when records in another entity depend on this entity's AI
   systems, or cite its records in a way the database would delete with them:
   scan findings on its evidence, extraction findings from its documents, and
   sharing agreements naming its processing activities. Those belong to the
   other entity, so they are moved or removed there first.

7. **Running jobs.** The deletion locks the entity row. Anything writing to it,
   such as an import commit or an extraction saving its results, waits, then
   fails on its foreign key once the entity has gone, so nothing is
   half-written. Imports uploaded or previewed for the entity are deleted with
   it.
8. **What is kept:**
   - the organisation's suppliers, templates, workflows and people;
   - the `entity_agreement` acceptance, which is Waivern's own record (terms
     6.3), with `entity_id` cleared and the entity's name and reference kept;
   - the `entity_erasure` row.

   People whose only access was to the deleted entity keep their membership,
   with no roles left.
