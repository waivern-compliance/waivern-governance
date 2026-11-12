/**
 * What leaves with an organisation, table by table.
 *
 * Every table in the database appears here exactly once: exported, with how
 * its rows are found for one organisation, or excluded, with the reason. The
 * export runs from this list and prints its exclusions into the archive's
 * manifest, so what the client is told was left out cannot disagree with what
 * was. `tests/organisation-export.test.ts` reads the live database and fails
 * when a table or column is not accounted for, so a new table cannot ship
 * without somebody deciding whether it leaves with the client.
 *
 * Names are the database's, not Drizzle's: the archive describes the data as
 * it is stored, and the completeness test reads `information_schema`.
 */

export type FileRule = {
  /** The bytea column holding the file. */
  column: string;
  /** Path of the file inside the archive, from the row's other columns. */
  path: (row: Record<string, unknown>) => string;
  /** A column holding the SHA-256 recorded at upload, to check against. */
  sha256Column?: string;
  /** Why this row's file is not included, or null to include it. */
  withholdWhen?: (row: Record<string, unknown>) => string | null;
};

type Common = {
  table: string;
  /** Columns left out of the archive, each with the reason. */
  withhold?: Record<string, string>;
  file?: FileRule;
  /**
   * Add the person's email and name from `app_user` alongside this column,
   * as `<prefix>_email` and `<prefix>_name`. Users are shared between
   * organisations, so they are never exported whole.
   */
  withUser?: { column: string; prefix: string };
};

export type ExportedTable = Common &
  (
    | {
        /** The table carries its organisation in this column. */
        scope: 'organisation';
        column: string;
      }
    | {
        /** The table belongs to its organisation through a parent row. */
        scope: 'parent';
        parent: string;
        via: string;
      }
  );

export type ExcludedTable = { table: string; excluded: string };

export type TableRule = ExportedTable | ExcludedTable;

export function isExported(rule: TableRule): rule is ExportedTable {
  return !('excluded' in rule);
}

const own = (
  table: string,
  extra: Omit<Common, 'table'> = {}
): ExportedTable => ({
  table,
  scope: 'organisation',
  column: 'organisation_id',
  ...extra
});

const child = (table: string, parent: string, via: string): ExportedTable => ({
  table,
  scope: 'parent',
  parent,
  via
});

const SECRET =
  'A credential for this deployment. Useless anywhere else and dangerous here, so it is not handed out; the connection it belongs to is exported.';
const ONE_WAY =
  'A one-way hash of a secret or address, made with a key the client does not hold. It identifies nothing outside this deployment.';

/** File names as uploaded, made safe to unpack on any system. */
export function safeFileName(name: unknown, fallback: string): string {
  const cleaned = String(name ?? '')
    .normalize('NFC')
    .replace(/[\u0000-\u001f\u007f/\\:*?"<>|]/g, '_')
    .replace(/^[.\s]+/, '')
    .trim()
    .slice(0, 150);
  return cleaned || fallback;
}

const EXTENSION: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg'
};

export const TABLES: readonly TableRule[] = [
  // The organisation and its people.
  {
    table: 'organisation',
    scope: 'organisation',
    column: 'id',
    withhold: {
      consent_analyser_token_ciphertext: SECRET,
      consent_analyser_token_iv: SECRET,
      consent_analyser_token_tag: SECRET
    }
  },
  own('entity'),
  own('membership', { withUser: { column: 'user_id', prefix: 'user' } }),
  child('role_assignment', 'membership', 'membership_id'),
  {
    table: 'organisation_request',
    scope: 'organisation',
    column: 'created_organisation_id'
  },
  own('organisation_domain', {
    withhold: {
      token:
        'The value published in DNS to prove the domain. It proves nothing once the organisation has left.'
    }
  }),
  own('retention_profile'),
  own('reference_counter'),
  own('framework_profile_item'),
  own('entity_agreement'),

  // Risk.
  own('risk'),
  child('mitigation', 'risk', 'risk_id'),
  child('risk_acceptance', 'risk', 'risk_id'),
  own('risk_appetite'),

  // Assessments and their workflow.
  own('assessment'),
  child('assessment_answer', 'assessment', 'assessment_id'),
  child('assessment_revision', 'assessment', 'assessment_id'),
  child('approval', 'assessment', 'assessment_id'),
  own('contributor_link', {
    withhold: { token_hash: ONE_WAY, last_used_ip_hash: ONE_WAY }
  }),
  own('workflow_definition'),
  child('workflow_stage', 'workflow_definition', 'workflow_definition_id'),
  own('task'),
  own('sla_policy'),
  own('schedule'),
  own('notification'),
  own('comment'),
  own('template'),
  child('template_version', 'template', 'template_id'),

  // AI governance.
  own('ai_use_case'),
  own('ai_use_case_request'),
  own('ai_change'),
  own('ai_assurance_record'),
  own('ai_incident'),
  child('ai_incident_event', 'ai_incident', 'incident_id'),
  own('atrs_record'),
  own('training_record'),
  own('ai_conversation'),
  child('ai_message', 'ai_conversation', 'conversation_id'),
  own('ai_suggestion'),

  // Breaches, requests and complaints.
  own('breach'),
  own('breach_decision'),
  own('data_subject_request'),
  own('data_subject_request_decision'),
  own('data_subject_request_scope'),
  own('dsr_intake_link'),
  own('dsr_intake_attempt', { withhold: { ip_hash: ONE_WAY } }),
  own('form_appearance'),
  own('form_appearance_logo', {
    file: {
      column: 'content',
      path: (row) =>
        `files/form_appearance_logo/${String(row.appearance_id)}/logo.${
          EXTENSION[String(row.content_type)] ?? 'bin'
        }`
    }
  }),
  own('information_request'),
  own('information_request_decision'),
  own('information_request_review'),
  own('information_request_regulator_event'),
  own('data_protection_complaint'),
  own('data_protection_complaint_event'),

  // Processing, suppliers and evidence.
  own('processing_activity'),
  own('supplier'),
  own('dpa'),
  own('evidence'),
  own('scan_finding'),
  own('record_link'),
  own('country_risk'),
  child('country_risk_review', 'country_risk', 'country_risk_id'),
  own('policy_document'),
  own('sharing_agreement'),
  own('sharing_agreement_party'),
  own('sharing_agreement_activity'),
  own('marketing_activity'),
  own('marketing_decision'),
  own('digital_property'),
  own('storage_item'),
  own('storage_decision'),
  own('storage_proposal'),
  own('consent_scan'),

  // Files, imports and reading.
  own('document', {
    file: {
      column: 'content',
      path: (row) =>
        `files/document/${String(row.id)}/${safeFileName(row.filename, 'file')}`,
      sha256Column: 'sha256',
      withholdWhen: (row) =>
        row.quarantined_at
          ? 'Quarantined: a virus scan matched this file, so it is not handed out. The record of it is exported.'
          : null
    }
  }),
  own('import_source'),
  own('import_batch', {
    file: {
      column: 'file',
      path: (row) =>
        `files/import_batch/${String(row.id)}/${safeFileName(row.filename, 'file')}`
    }
  }),
  own('import_row'),
  own('import_mapping'),
  own('import_file', {
    file: {
      column: 'content',
      path: (row) =>
        `files/import_file/${String(row.id)}/${safeFileName(row.filename, 'file')}`
    }
  }),
  own('extraction'),
  own('extraction_finding'),
  own('extraction_link'),

  // Integration.
  own('integration_connection', {
    withhold: {
      secret_ciphertext: SECRET,
      secret_iv: SECRET,
      secret_tag: SECRET
    }
  }),
  own('webhook_delivery'),

  // The record of who did what.
  own('audit_event'),
  own('entity_erasure', { withhold: { token_hash: ONE_WAY } }),
  own('audit_chain_head'),

  // Not the organisation's.
  {
    table: 'app_user',
    excluded:
      'People are shared between organisations. Each member is exported with their name and email in membership.jsonl; nothing about their other organisations or how they sign in.'
  },
  {
    table: 'legal_reference',
    excluded:
      'The shared library of statutes and guidance, the same for every organisation and public anyway.'
  },
  {
    table: 'terms_acceptance',
    excluded:
      "Waivern's own record, as provider, that people accepted its terms. A person can ask Waivern for their entries under their own data protection rights."
  },
  {
    table: 'feedback',
    excluded:
      'Product feedback sent to Waivern. A person can ask Waivern for what they sent under their own data protection rights.'
  }
];

export const RULE_BY_TABLE: ReadonlyMap<string, TableRule> = new Map(
  TABLES.map((rule) => [rule.table, rule])
);
