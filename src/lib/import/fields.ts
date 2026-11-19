import { COMPLAINT_SUBJECTS } from '@/lib/complaints/statutory';
import {
  aiUseCaseIn,
  assessmentIn,
  breachIn,
  complaintIn,
  dataSubjectRequestIn,
  dpaIn,
  evidenceIn,
  informationAssetIn,
  informationRequestIn,
  mitigationIn,
  policyDocumentIn,
  policyIn,
  processingActivityIn,
  riskIn,
  vendorIn
} from '@/lib/integration/contracts';

import type { ImportMapping, ImportRecord } from './types';

/**
 * The fields each kind of record can be read into, and how one row becomes a
 * record. Pure, so the preview and the import run the same code, and the
 * checks are the Integration API's own (`lib/integration/contracts.ts`).
 */

export type RecordType =
  | 'supplier'
  | 'processing_activity'
  | 'dpa'
  | 'evidence'
  | 'ai_use_case'
  | 'information_asset'
  | 'risk'
  | 'mitigation'
  | 'policy_document'
  | 'policy'
  | 'assessment'
  | 'data_subject_request'
  | 'breach'
  | 'data_protection_complaint'
  | 'information_request';

/** Kinds of record that belong to a legal entity, which the upload names. */
export const ENTITY_SCOPED: ReadonlySet<RecordType> = new Set([
  'processing_activity',
  'evidence',
  'ai_use_case',
  'information_asset',
  'risk',
  'mitigation',
  'assessment',
  'data_subject_request',
  'breach',
  'data_protection_complaint',
  'information_request'
]);

/** Kinds of record whose rows can name a file added to the import. */
export const CARRIES_FILES: ReadonlySet<RecordType> = new Set([
  'dpa',
  'evidence',
  'policy_document',
  'policy',
  'assessment',
  'data_subject_request',
  'breach',
  'data_protection_complaint',
  'information_request'
]);

/** Kinds of record with a statutory clock, imported with their history. */
export const CASE_HISTORY: ReadonlySet<RecordType> = new Set([
  'data_subject_request',
  'breach',
  'data_protection_complaint',
  'information_request'
]);

type FieldKind =
  | 'text'
  | 'list'
  | 'date'
  | 'role'
  | 'transfers'
  | 'choice'
  | 'yesno'
  | 'number'
  /** A rating on the source's own scale, read onto this organisation's when matched. */
  | 'rating'
  | 'file';

/** A value a choice field accepts, and the words that mean it. */
type Choice = { value: string; label: string; words: string[] };

export type FieldDef = {
  key: string;
  label: string;
  kind: FieldKind;
  required?: boolean;
  hint?: string;
  /** A choice that may be made once for every row instead of from a column. */
  everyRow?: boolean;
  /** Header names that usually mean this field, to match a column at first. */
  aliases: string[];
  /** For a choice: the values it accepts. */
  choices?: Choice[];
};

const choice = (value: string, label: string, ...words: string[]): Choice => ({
  value,
  label,
  words
});

const FILE: FieldDef = {
  key: 'file',
  label: 'File',
  kind: 'file',
  hint: 'The name of a file added to this import, such as "acme-dpa.pdf". Add the files on this page.',
  aliases: ['file', 'filename', 'file name', 'attachment', 'document']
};

const ID: FieldDef = {
  key: 'externalRef',
  label: 'Its ID in the other platform',
  kind: 'text',
  hint: 'What makes importing the same file again update rather than duplicate. Without one, the name is used.',
  aliases: ['id', 'external id', 'record id', 'reference', 'ref', 'uuid']
};

export const FIELDS: Record<RecordType, FieldDef[]> = {
  processing_activity: [
    ID,
    {
      key: 'name',
      label: 'Name',
      kind: 'text',
      required: true,
      aliases: [
        'name',
        'activity',
        'processing activity',
        'activity name',
        'title'
      ]
    },
    {
      key: 'description',
      label: 'Description',
      kind: 'text',
      aliases: ['description', 'details', 'summary']
    },
    {
      key: 'purposes',
      label: 'Purposes',
      kind: 'list',
      aliases: ['purpose', 'purposes', 'purpose of processing']
    },
    {
      key: 'lawfulBasis',
      label: 'Lawful basis',
      kind: 'text',
      hint: 'Read into the Article 6 bases where it names them plainly; kept as written either way.',
      aliases: ['lawful basis', 'legal basis', 'lawful bases', 'legal bases']
    },
    {
      key: 'dataCategories',
      label: 'Categories of personal data',
      kind: 'list',
      aliases: [
        'data categories',
        'data elements',
        'personal data',
        'categories of data',
        'data types'
      ]
    },
    {
      key: 'subjectCategories',
      label: 'Categories of data subjects',
      kind: 'list',
      aliases: [
        'data subjects',
        'subject categories',
        'data subject types',
        'categories of data subjects'
      ]
    },
    {
      key: 'recipients',
      label: 'Recipients',
      kind: 'list',
      aliases: ['recipients', 'recipient', 'shared with', 'third parties']
    },
    {
      key: 'systems',
      label: 'Systems',
      kind: 'list',
      aliases: ['systems', 'assets', 'applications', 'system']
    },
    {
      key: 'transfers',
      label: 'International transfers',
      kind: 'transfers',
      hint: 'One per country, such as "United States (SCCs)".',
      aliases: [
        'transfers',
        'international transfers',
        'countries',
        'transfer countries'
      ]
    },
    {
      key: 'retention',
      label: 'Retention',
      kind: 'text',
      aliases: ['retention', 'retention period', 'how long']
    },
    {
      key: 'securityMeasures',
      label: 'Security measures',
      kind: 'text',
      aliases: [
        'security measures',
        'security',
        'technical and organisational measures',
        'toms'
      ]
    },
    {
      key: 'controllerRole',
      label: 'Our role',
      kind: 'role',
      hint: 'Controller, processor or joint controller.',
      aliases: [
        'role',
        'our role',
        'controller role',
        'controller or processor'
      ]
    },
    {
      key: 'controllerName',
      label: 'Controller',
      kind: 'text',
      aliases: ['controller', 'controller name']
    },
    {
      key: 'reviewDueAt',
      label: 'Review due',
      kind: 'date',
      aliases: ['review date', 'next review', 'review due']
    }
  ],
  supplier: [
    ID,
    {
      key: 'name',
      label: 'Name',
      kind: 'text',
      required: true,
      aliases: [
        'name',
        'vendor',
        'vendor name',
        'supplier',
        'supplier name',
        'company'
      ]
    },
    {
      key: 'description',
      label: 'Description',
      kind: 'text',
      aliases: ['description', 'service', 'services', 'what they do']
    },
    {
      key: 'categories',
      label: 'Categories',
      kind: 'list',
      aliases: [
        'category',
        'categories',
        'type',
        'vendor type',
        'service category'
      ]
    }
  ],
  dpa: [
    ID,
    {
      key: 'supplier',
      label: 'Supplier',
      kind: 'text',
      required: true,
      hint: 'Matched by name to a supplier already recorded. Import the supplier list first.',
      aliases: [
        'supplier',
        'vendor',
        'processor',
        'vendor name',
        'supplier name'
      ]
    },
    {
      key: 'title',
      label: 'Title',
      kind: 'text',
      required: true,
      aliases: ['title', 'name', 'agreement', 'agreement name', 'contract']
    },
    {
      key: 'documentRef',
      label: 'Its reference',
      kind: 'text',
      aliases: ['contract reference', 'contract number', 'agreement reference']
    },
    {
      key: 'signedAt',
      label: 'Signed',
      kind: 'date',
      aliases: ['signed', 'signed date', 'date signed', 'effective date']
    },
    {
      key: 'expiresAt',
      label: 'Expires',
      kind: 'date',
      aliases: ['expires', 'expiry', 'expiry date', 'end date', 'renewal date']
    },
    {
      key: 'transferMechanism',
      label: 'Transfer mechanism',
      kind: 'text',
      aliases: ['transfer mechanism', 'transfer safeguard', 'safeguard']
    },
    {
      key: 'subProcessors',
      label: 'Sub-processors',
      kind: 'list',
      aliases: ['sub processors', 'subprocessors', 'sub-processors']
    },
    FILE
  ],
  evidence: [
    ID,
    {
      key: 'title',
      label: 'Title',
      kind: 'text',
      required: true,
      aliases: ['title', 'name', 'evidence', 'evidence name', 'document name']
    },
    {
      key: 'kind',
      label: 'Kind',
      kind: 'choice',
      hint: 'A document, scan, attestation or link. Left empty, a row with a file is a document and one with only a link is a link.',
      aliases: ['kind', 'type', 'evidence type'],
      choices: [
        choice('document', 'Document', 'file', 'policy', 'report'),
        choice('scan', 'Scan', 'scan result', 'test'),
        choice('attestation', 'Attestation', 'attested', 'declaration'),
        choice('link', 'Link', 'url', 'web link')
      ]
    },
    {
      key: 'description',
      label: 'Description',
      kind: 'text',
      aliases: ['description', 'details', 'notes']
    },
    {
      key: 'uri',
      label: 'Link',
      kind: 'text',
      aliases: ['link', 'url', 'uri', 'location']
    },
    {
      key: 'collectedAt',
      label: 'Collected',
      kind: 'date',
      aliases: [
        'collected',
        'date',
        'collected at',
        'evidence date',
        'uploaded'
      ]
    },
    {
      key: 'attachTo',
      label: 'Supports',
      kind: 'text',
      hint: 'The reference of a record here it supports, such as ROPA-2026-0004 or DPIA-2026-0001.',
      aliases: ['supports', 'attach to', 'related record', 'record']
    },
    FILE
  ],
  ai_use_case: [
    ID,
    {
      key: 'name',
      label: 'Name',
      kind: 'text',
      required: true,
      aliases: ['name', 'system', 'ai system', 'use case', 'title']
    },
    {
      key: 'purpose',
      label: 'Purpose',
      kind: 'text',
      required: true,
      aliases: ['purpose', 'use', 'what it is for', 'business purpose']
    },
    {
      key: 'description',
      label: 'Description',
      kind: 'text',
      aliases: ['description', 'details', 'summary']
    },
    {
      key: 'systemType',
      label: 'Type of system',
      kind: 'choice',
      required: true,
      aliases: ['type', 'system type', 'ai type', 'category'],
      choices: [
        choice(
          'predictive',
          'Predictive',
          'classification',
          'machine learning',
          'ml',
          'scoring'
        ),
        choice('generative', 'Generative', 'genai', 'gen ai', 'llm', 'chatbot'),
        choice('agentic', 'Agentic', 'agent', 'ai agent'),
        choice('hybrid', 'Hybrid', 'mixed')
      ]
    },
    {
      key: 'provenance',
      label: 'Where it comes from',
      kind: 'choice',
      required: true,
      aliases: ['provenance', 'source', 'built or bought', 'origin'],
      choices: [
        choice(
          'built_in_house',
          'Built in house',
          'in house',
          'internal',
          'built',
          'built internally'
        ),
        choice('fine_tuned', 'Fine-tuned', 'fine tuned', 'customised model'),
        choice(
          'third_party_api',
          'Third-party API',
          'third party api',
          'api',
          'external api'
        ),
        choice(
          'embedded_vendor',
          'Inside a product we bought',
          'embedded',
          'vendor',
          'third party product',
          'bought'
        )
      ]
    },
    {
      key: 'lifecycleStage',
      label: 'Stage',
      kind: 'choice',
      hint: 'Used when the system is first recorded; a re-import never moves it.',
      aliases: ['stage', 'status', 'lifecycle', 'lifecycle stage'],
      choices: [
        choice('proposed', 'Proposed', 'idea', 'planned', 'requested'),
        choice('development', 'Development', 'in development', 'building'),
        choice('pilot', 'Pilot', 'trial', 'testing', 'poc', 'proof of concept'),
        choice(
          'production',
          'Production',
          'live',
          'in use',
          'deployed',
          'active'
        ),
        choice('retiring', 'Retiring', 'being retired', 'sunsetting'),
        choice('retired', 'Retired', 'decommissioned', 'inactive')
      ]
    },
    {
      key: 'deploymentPattern',
      label: 'How it is deployed',
      kind: 'choice',
      aliases: ['deployment', 'deployment pattern', 'hosting'],
      choices: [
        choice(
          'public_web_app',
          'Public web app',
          'web app',
          'saas',
          'chat service'
        ),
        choice('embedded', 'Embedded in other software'),
        choice('public_api', 'Public API', 'api'),
        choice(
          'privately_hosted',
          'Privately hosted',
          'self hosted',
          'private cloud',
          'on premises'
        ),
        choice('local', 'Local device', 'on device', 'desktop'),
        choice('trained_here', 'Trained here', 'trained in house')
      ]
    },
    {
      key: 'supplierName',
      label: 'Supplier',
      kind: 'text',
      hint: 'Linked to the supplier of that name where one is recorded.',
      aliases: ['supplier', 'vendor', 'provider']
    },
    {
      key: 'modelName',
      label: 'Model',
      kind: 'text',
      aliases: ['model', 'model name', 'foundation model']
    },
    {
      key: 'deployedIn',
      label: 'Deployed in',
      kind: 'list',
      aliases: ['deployed in', 'systems', 'used in', 'applications']
    },
    {
      key: 'processesPersonalData',
      label: 'Processes personal data',
      kind: 'yesno',
      aliases: [
        'personal data',
        'processes personal data',
        'uses personal data'
      ]
    },
    {
      key: 'dataCategories',
      label: 'Categories of personal data',
      kind: 'list',
      aliases: ['data categories', 'categories of data', 'data types']
    }
  ],
  information_asset: [
    ID,
    {
      key: 'name',
      label: 'Name',
      kind: 'text',
      required: true,
      aliases: ['name', 'asset', 'asset name', 'system', 'system name']
    },
    {
      key: 'assetType',
      label: 'Type',
      kind: 'text',
      required: true,
      hint: "One of this organisation's asset types, by name: Application, Database, Domain name, or one of its own.",
      aliases: ['type', 'asset type', 'category', 'kind']
    },
    {
      key: 'description',
      label: 'Description',
      kind: 'text',
      aliases: ['description', 'details', 'notes']
    },
    {
      key: 'owner',
      label: 'Owner',
      kind: 'text',
      hint: 'Their email address. Someone who is not a member here is kept with the asset, and the asset shows no owner.',
      aliases: [
        'owner',
        'asset owner',
        'owner email',
        'information asset owner'
      ]
    },
    {
      key: 'hosting',
      label: 'Hosting',
      kind: 'choice',
      aliases: ['hosting', 'hosting model', 'deployment'],
      choices: [
        choice(
          'on_premises',
          'On premises',
          'on prem',
          'on-prem',
          'onsite',
          'in house'
        ),
        choice('saas', 'SaaS', 'software as a service', 'vendor hosted'),
        choice('cloud', 'Cloud', 'iaas', 'paas', 'public cloud'),
        choice('hybrid', 'Hybrid', 'mixed')
      ]
    },
    {
      key: 'hostedBy',
      label: 'Hosted by',
      kind: 'text',
      aliases: ['hosted by', 'host', 'provider', 'hosting provider', 'location']
    },
    {
      key: 'region',
      label: 'Region',
      kind: 'text',
      aliases: ['region', 'data centre region', 'data center region']
    },
    {
      key: 'countries',
      label: 'Countries held in',
      kind: 'list',
      aliases: ['countries', 'country', 'storage countries', 'data location']
    },
    {
      key: 'classification',
      label: 'Classification',
      kind: 'text',
      hint: "A level of this organisation's classification scheme, by name.",
      aliases: ['classification', 'data classification', 'sensitivity']
    },
    {
      key: 'retention',
      label: 'Retention',
      kind: 'text',
      aliases: ['retention', 'retention period']
    },
    {
      key: 'nextReviewAt',
      label: 'Next review',
      kind: 'date',
      aliases: ['next review', 'review date', 'review due']
    },
    {
      key: 'expiresAt',
      label: 'Expires or renews',
      kind: 'date',
      hint: 'Kept only for a type that expires, such as a domain name or a licence.',
      aliases: ['expires', 'expiry', 'expiry date', 'renewal date', 'renews']
    },
    {
      key: 'noticeDays',
      label: 'Notice (days)',
      kind: 'number',
      aliases: ['notice', 'notice days', 'notice period']
    },
    {
      key: 'autoRenews',
      label: 'Renews automatically',
      kind: 'yesno',
      aliases: ['auto renews', 'auto renew', 'automatic renewal']
    },
    {
      key: 'quantity',
      label: 'How many',
      kind: 'number',
      hint: 'For a device, server or network device recorded as a group of alike ones.',
      aliases: ['quantity', 'count', 'number of devices', 'how many']
    },
    {
      key: 'ownership',
      label: 'Owned by',
      kind: 'choice',
      hint: 'For a device or network device.',
      aliases: ['ownership', 'owned by', 'device ownership'],
      choices: [
        choice(
          'organisation',
          'The organisation',
          'corporate',
          'company',
          'company owned',
          'organisation owned'
        ),
        choice(
          'byod',
          'Its user',
          'bring your own device',
          'personal',
          'user owned'
        ),
        choice(
          'third_party',
          'A third party',
          'supplier',
          'contractor',
          'customer',
          'msp'
        )
      ]
    },
    {
      key: 'userRole',
      label: 'Used by',
      kind: 'choice',
      hint: 'For a device.',
      aliases: ['used by', 'user role', 'user type', 'users'],
      choices: [
        choice('staff', 'Staff', 'employees', 'employee'),
        choice('volunteer', 'Volunteers', 'volunteer'),
        choice('trustee', 'Trustees', 'trustee'),
        choice(
          'research_assistant',
          'Research assistants',
          'research assistant'
        ),
        choice('student', 'Students', 'student'),
        choice('contractor', 'Contractors', 'contractor')
      ]
    },
    {
      key: 'operatingSystem',
      label: 'Operating system or firmware',
      kind: 'text',
      hint: 'For a device, server or network device, with its version.',
      aliases: ['operating system', 'os', 'firmware', 'os version']
    },
    {
      key: 'supportedUntil',
      label: 'Supported until',
      kind: 'date',
      hint: 'When its vendor stops issuing security updates. For a device, server, network device or software licence.',
      aliases: [
        'supported until',
        'end of support',
        'end of life',
        'eol',
        'support end date'
      ]
    },
    {
      key: 'cloudModel',
      label: 'Cloud service model',
      kind: 'choice',
      hint: 'For a system, database, file share or server run on a cloud provider.',
      aliases: ['cloud model', 'cloud service model', 'service model'],
      choices: [
        choice('iaas', 'IaaS', 'infrastructure as a service'),
        choice('paas', 'PaaS', 'platform as a service'),
        choice('saas', 'SaaS', 'software as a service')
      ]
    },
    {
      key: 'activities',
      label: 'Processing activities',
      kind: 'list',
      hint: 'By reference (ROPA-2026-0004), their identifier in the platform, or name. Each must already be recorded in this entity.',
      aliases: ['processing activities', 'activities', 'ropa', 'processes']
    },
    {
      key: 'suppliers',
      label: 'Suppliers',
      kind: 'list',
      hint: 'By name. Each must already be recorded.',
      aliases: ['suppliers', 'vendors', 'third parties']
    }
  ],
  risk: [
    ID,
    {
      key: 'title',
      label: 'Title',
      kind: 'text',
      required: true,
      aliases: ['title', 'risk', 'risk name', 'name', 'risk title']
    },
    {
      key: 'description',
      label: 'Description',
      kind: 'text',
      required: true,
      aliases: ['description', 'risk description', 'details']
    },
    {
      key: 'category',
      label: 'Category',
      kind: 'text',
      hint: 'Kept as written, or filed under the matching AI risk category.',
      aliases: ['category', 'risk category', 'type']
    },
    {
      key: 'owner',
      label: 'Owner',
      kind: 'text',
      hint: 'Their email address. Someone who is not a member here is kept with the risk, and the risk shows no owner.',
      aliases: ['owner', 'risk owner', 'owner email']
    },
    {
      key: 'inherentLikelihood',
      label: 'Likelihood (inherent)',
      kind: 'rating',
      required: true,
      hint: "A number or a word on the source's scale. After the first preview, say what each value is on this organisation's scale.",
      aliases: ['likelihood', 'inherent likelihood', 'probability']
    },
    {
      key: 'inherentImpact',
      label: 'Impact (inherent)',
      kind: 'rating',
      required: true,
      hint: 'May be the same column as likelihood, where the source gives one rating.',
      aliases: ['impact', 'inherent impact', 'severity', 'consequence']
    },
    {
      key: 'residualLikelihood',
      label: 'Likelihood (residual)',
      kind: 'rating',
      aliases: ['residual likelihood']
    },
    {
      key: 'residualImpact',
      label: 'Impact (residual)',
      kind: 'rating',
      aliases: ['residual impact', 'residual severity']
    },
    {
      key: 'status',
      label: 'Status',
      kind: 'choice',
      hint: 'A risk accepted in the source comes in waiting to be accepted here; the acceptance is kept as its history.',
      aliases: ['status', 'state', 'risk status'],
      choices: [
        choice('identified', 'Identified', 'open', 'new', 'draft', 'raised'),
        choice(
          'treating',
          'Being treated',
          'treating',
          'in progress',
          'mitigating',
          'in treatment'
        ),
        choice('mitigated', 'Mitigated', 'reduced', 'treated', 'controlled'),
        choice('accepted', 'Accepted', 'tolerated', 'risk accepted'),
        choice('closed', 'Closed', 'resolved', 'retired', 'archived')
      ]
    },
    {
      key: 'openedAt',
      label: 'Raised on',
      kind: 'date',
      aliases: [
        'created',
        'created on',
        'date raised',
        'identified on',
        'opened'
      ]
    },
    {
      key: 'closedAt',
      label: 'Closed on',
      kind: 'date',
      aliases: ['closed', 'closed on', 'date closed', 'resolved on']
    },
    {
      key: 'nextReviewAt',
      label: 'Next review',
      kind: 'date',
      aliases: ['next review', 'review date', 'review due']
    },
    {
      key: 'acceptedBy',
      label: 'Accepted by',
      kind: 'text',
      aliases: ['accepted by', 'risk accepted by', 'approver']
    },
    {
      key: 'acceptedAt',
      label: 'Accepted on',
      kind: 'date',
      aliases: ['accepted on', 'acceptance date', 'date accepted']
    },
    {
      key: 'acceptanceExpiresAt',
      label: 'Acceptance expires',
      kind: 'date',
      aliases: ['acceptance expiry', 'acceptance expires', 'accepted until']
    },
    {
      key: 'acceptanceRationale',
      label: 'Why it was accepted',
      kind: 'text',
      aliases: ['acceptance rationale', 'acceptance reason', 'justification']
    },
    {
      key: 'activities',
      label: 'Processing activities',
      kind: 'list',
      hint: 'By reference, ID in the platform, or name, in this entity.',
      aliases: ['processing activities', 'activities', 'ropa', 'processes']
    },
    {
      key: 'suppliers',
      label: 'Suppliers',
      kind: 'list',
      hint: 'By name.',
      aliases: ['suppliers', 'vendors', 'third parties']
    },
    {
      key: 'aiSystems',
      label: 'AI systems',
      kind: 'list',
      hint: 'By ID in the platform or name, in this entity.',
      aliases: ['ai systems', 'ai system', 'ai use cases', 'models']
    },
    {
      key: 'assets',
      label: 'Information assets',
      kind: 'list',
      hint: 'By reference, ID in the platform, or name, in this entity.',
      aliases: ['assets', 'information assets', 'systems', 'asset']
    },
    {
      key: 'assessment',
      label: 'Assessment',
      kind: 'text',
      hint: 'The assessment it came out of, by its ID in the platform. Linked once that assessment is imported, before or after.',
      aliases: [
        'assessment',
        'assessment id',
        'source assessment',
        'raised from',
        'dpia'
      ]
    }
  ],
  mitigation: [
    ID,
    {
      key: 'risk',
      label: 'Risk',
      kind: 'text',
      required: true,
      hint: "The risk's ID in the platform, as imported, or its reference here. It must already be recorded in this entity.",
      aliases: ['risk', 'risk id', 'risk ref', 'risk reference', 'parent risk']
    },
    {
      key: 'description',
      label: 'Description',
      kind: 'text',
      required: true,
      aliases: [
        'description',
        'mitigation',
        'action',
        'control description',
        'title'
      ]
    },
    {
      key: 'controlRef',
      label: 'Control reference',
      kind: 'text',
      aliases: ['control', 'control ref', 'control reference', 'control id']
    },
    {
      key: 'treatmentType',
      label: 'Treatment',
      kind: 'choice',
      hint: 'Accept is kept with the mitigation, which comes in with no treatment: accepting a risk is a decision taken on the risk itself here.',
      aliases: [
        'treatment',
        'treatment type',
        'treatment option',
        'response',
        'strategy'
      ],
      choices: [
        choice('avoidance', 'Avoid', 'avoid', 'terminate', 'eliminate'),
        choice(
          'limitation',
          'Limit',
          'limit',
          'reduce',
          'mitigate',
          'treat',
          'control'
        ),
        choice('transference', 'Transfer', 'transfer', 'share', 'insure'),
        choice('acceptance', 'Accept', 'accept', 'tolerate', 'retain')
      ]
    },
    {
      key: 'owner',
      label: 'Owner',
      kind: 'text',
      hint: 'Their email address. Someone who is not a member here is kept with the mitigation, and it shows no owner.',
      aliases: ['owner', 'action owner', 'owner email', 'assignee']
    },
    {
      key: 'dueAt',
      label: 'Due on',
      kind: 'date',
      aliases: ['due', 'due date', 'due on', 'target date', 'deadline']
    },
    {
      key: 'status',
      label: 'Status',
      kind: 'choice',
      hint: 'One verified in the source comes in implemented, waiting for somebody here to verify it; the verification is kept as its history.',
      aliases: ['status', 'state', 'progress'],
      choices: [
        choice('planned', 'Planned', 'not started', 'open', 'new', 'to do'),
        choice('in_progress', 'In progress', 'started', 'ongoing', 'doing'),
        choice('implemented', 'Implemented', 'done', 'complete', 'completed'),
        choice('verified', 'Verified', 'tested', 'effective', 'validated'),
        choice('abandoned', 'Abandoned', 'cancelled', 'canceled', 'dropped')
      ]
    },
    {
      key: 'implementedAt',
      label: 'Implemented on',
      kind: 'date',
      aliases: [
        'implemented',
        'implemented on',
        'completed on',
        'date completed'
      ]
    },
    {
      key: 'verifiedBy',
      label: 'Verified by',
      kind: 'text',
      aliases: ['verified by', 'tested by', 'validated by']
    },
    {
      key: 'verifiedAt',
      label: 'Verified on',
      kind: 'date',
      aliases: ['verified on', 'verified', 'date verified', 'tested on']
    },
    {
      key: 'evidenceRef',
      label: 'Evidence reference',
      kind: 'text',
      aliases: ['evidence', 'evidence ref', 'evidence reference']
    }
  ],
  policy_document: [
    ID,
    {
      key: 'title',
      label: 'Title',
      kind: 'text',
      required: true,
      aliases: ['title', 'name', 'policy', 'document', 'policy name']
    },
    {
      key: 'version',
      label: 'Version',
      kind: 'text',
      aliases: ['version', 'version number', 'revision']
    },
    {
      key: 'entity',
      label: 'Legal entity',
      kind: 'text',
      hint: 'By name. Empty: it is for every entity in the organisation.',
      aliases: ['entity', 'legal entity', 'company', 'controller']
    },
    {
      key: 'owner',
      label: 'Owner',
      kind: 'text',
      hint: 'Their email address. Someone who is not a member here is kept with it, and it shows no owner.',
      aliases: ['owner', 'policy owner', 'owner email', 'author']
    },
    {
      key: 'conditions',
      label: 'Conditions',
      kind: 'list',
      hint: 'The Schedule 1 conditions or Part 3 grounds it covers, as "para 18", "Sch 8 para 4", "Part 3 consent", or by name. Separate several with ";".',
      aliases: [
        'conditions',
        'schedule 1 conditions',
        'conditions covered',
        'condition',
        'covers'
      ]
    },
    {
      key: 'lastReviewedAt',
      label: 'Last reviewed',
      kind: 'date',
      aliases: ['last reviewed', 'reviewed on', 'review date', 'last review']
    },
    {
      key: 'withdrawnAt',
      label: 'Withdrawn on',
      kind: 'date',
      aliases: ['withdrawn', 'withdrawn on', 'retired on', 'archived on']
    },
    FILE
  ],
  policy: [
    ID,
    {
      key: 'title',
      label: 'Title',
      kind: 'text',
      required: true,
      aliases: ['title', 'name', 'policy', 'policy name', 'policy title']
    },
    {
      key: 'summary',
      label: 'Summary',
      kind: 'text',
      aliases: ['summary', 'description', 'purpose', 'scope']
    },
    {
      key: 'entity',
      label: 'Legal entity',
      kind: 'text',
      hint: 'By name. Empty: it is for every entity in the organisation.',
      aliases: ['entity', 'legal entity', 'company', 'controller']
    },
    {
      key: 'owner',
      label: 'Owner',
      kind: 'text',
      hint: 'Their email address. Someone who is not a member here is kept with it, and it shows no owner.',
      aliases: ['owner', 'policy owner', 'owner email', 'author']
    },
    {
      key: 'status',
      label: 'Status',
      kind: 'choice',
      hint: 'One in force in the source is in force here, with no version approved here yet; its approval there is kept as its history.',
      aliases: ['status', 'state', 'policy status'],
      choices: [
        choice(
          'draft',
          'Draft',
          'in draft',
          'drafting',
          'in review',
          'proposed'
        ),
        choice(
          'in_force',
          'In force',
          'active',
          'approved',
          'published',
          'live',
          'current',
          'effective'
        ),
        choice(
          'withdrawn',
          'Withdrawn',
          'retired',
          'archived',
          'superseded',
          'inactive'
        )
      ]
    },
    {
      key: 'version',
      label: 'Version',
      kind: 'text',
      aliases: ['version', 'version number', 'revision']
    },
    {
      key: 'approvedBy',
      label: 'Approved by',
      kind: 'text',
      aliases: ['approved by', 'approver', 'signed off by']
    },
    {
      key: 'approvedAt',
      label: 'Approved on',
      kind: 'date',
      aliases: ['approved on', 'approval date', 'date approved', 'approved']
    },
    {
      key: 'approvalReference',
      label: 'Where it was approved',
      kind: 'text',
      aliases: ['approval reference', 'approved at', 'committee', 'minute']
    },
    {
      key: 'reviewIntervalMonths',
      label: 'Review every (months)',
      kind: 'number',
      aliases: [
        'review interval',
        'review frequency',
        'review cycle',
        'review every'
      ]
    },
    {
      key: 'lastReviewedAt',
      label: 'Last reviewed',
      kind: 'date',
      aliases: ['last reviewed', 'reviewed on', 'last review']
    },
    {
      key: 'nextReviewAt',
      label: 'Next review',
      kind: 'date',
      aliases: ['next review', 'review due', 'next review date', 'review date']
    },
    {
      key: 'withdrawnAt',
      label: 'Withdrawn on',
      kind: 'date',
      aliases: ['withdrawn', 'withdrawn on', 'retired on', 'archived on']
    },
    {
      key: 'withdrawnReason',
      label: 'Why it was withdrawn',
      kind: 'text',
      aliases: ['withdrawal reason', 'why withdrawn', 'reason withdrawn']
    },
    {
      key: 'activities',
      label: 'Processing activities',
      kind: 'list',
      hint: "By reference, ID in the platform, or name, in the policy's entity.",
      aliases: ['processing activities', 'activities', 'ropa', 'processes']
    },
    {
      key: 'aiSystems',
      label: 'AI systems',
      kind: 'list',
      hint: "By ID in the platform or name, in the policy's entity.",
      aliases: ['ai systems', 'ai system', 'ai use cases', 'models']
    },
    FILE
  ],
  assessment: [
    ID,
    {
      key: 'title',
      label: 'Title',
      kind: 'text',
      required: true,
      aliases: ['title', 'name', 'assessment', 'assessment name']
    },
    {
      key: 'kind',
      label: 'Kind',
      kind: 'choice',
      required: true,
      hint: 'From a column that says it, such as "Template", or the same for every row where the file holds one kind.',
      everyRow: true,
      aliases: ['kind', 'type', 'assessment type', 'template'],
      choices: [
        choice(
          'dpia',
          'DPIA',
          'data protection impact assessment',
          'pia',
          'privacy impact assessment'
        ),
        choice(
          'lia',
          'LIA',
          'legitimate interests assessment',
          'legitimate interest assessment'
        ),
        choice('tia', 'TIA', 'transfer impact assessment'),
        choice('tra', 'TRA', 'transfer risk assessment'),
        choice(
          'ai_risk',
          'AI risk assessment',
          'ai assessment',
          'ai impact assessment',
          'aia'
        ),
        choice(
          'screening',
          'Screening',
          'pre-screening',
          'threshold assessment',
          'dpia screening'
        ),
        choice('eia', 'EIA', 'equality impact assessment'),
        choice('custom', 'Other', 'custom', 'general', 'vendor assessment')
      ]
    },
    {
      key: 'outcome',
      label: 'Outcome',
      kind: 'choice',
      required: true,
      hint: 'One not finished there comes in withdrawn, as history: start a new one here.',
      aliases: ['status', 'outcome', 'result', 'state', 'stage'],
      choices: [
        choice(
          'approved',
          'Approved',
          'complete',
          'completed',
          'closed',
          'signed off',
          'accepted'
        ),
        choice('rejected', 'Rejected', 'declined', 'not approved'),
        choice('superseded', 'Superseded', 'replaced', 'archived'),
        choice('withdrawn', 'Withdrawn', 'cancelled', 'canceled', 'abandoned'),
        choice(
          'unfinished',
          'Unfinished',
          'draft',
          'in progress',
          'under review',
          'in review',
          'open',
          'not started',
          'pending'
        )
      ]
    },
    {
      key: 'activity',
      label: 'Processing activity',
      kind: 'text',
      hint: 'What it assessed, by reference, ID in the platform, or name. Name one of activity, supplier or AI system.',
      aliases: ['processing activity', 'activity', 'ropa', 'process']
    },
    {
      key: 'supplier',
      label: 'Supplier',
      kind: 'text',
      hint: 'By name.',
      aliases: ['supplier', 'vendor', 'third party']
    },
    {
      key: 'aiSystem',
      label: 'AI system',
      kind: 'text',
      hint: 'By ID in the platform or name.',
      aliases: ['ai system', 'ai use case', 'model', 'system']
    },
    {
      key: 'owner',
      label: 'Owner',
      kind: 'text',
      hint: 'Their email address. Someone who is not a member here is kept with it, and it shows no owner.',
      aliases: ['owner', 'assessor', 'owner email', 'respondent', 'author']
    },
    {
      key: 'submittedAt',
      label: 'Submitted on',
      kind: 'date',
      aliases: ['submitted', 'submitted on', 'date submitted']
    },
    {
      key: 'completedAt',
      label: 'Decided on',
      kind: 'date',
      aliases: [
        'completed',
        'completed on',
        'decided on',
        'approved on',
        'date completed',
        'closed on'
      ]
    },
    {
      key: 'approvedBy',
      label: 'Decided by',
      kind: 'text',
      aliases: [
        'approved by',
        'approver',
        'decided by',
        'reviewer',
        'signed off by'
      ]
    },
    {
      key: 'reviewDueAt',
      label: 'Review due',
      kind: 'date',
      aliases: ['review due', 'next review', 'review date', 'reassess by']
    },
    FILE
  ],
  data_subject_request: [
    ID,
    {
      key: 'requesterName',
      label: 'Requester',
      kind: 'text',
      required: true,
      aliases: [
        'requester',
        'requester name',
        'data subject',
        'name',
        'full name',
        'subject name'
      ]
    },
    {
      key: 'requesterContact',
      label: 'Requester contact',
      kind: 'text',
      aliases: [
        'email',
        'contact',
        'requester email',
        'email address',
        'contact details'
      ]
    },
    {
      key: 'representative',
      label: 'Acting for them',
      kind: 'text',
      aliases: ['representative', 'agent', 'on behalf of', 'authorised agent']
    },
    {
      key: 'rights',
      label: 'Rights',
      kind: 'list',
      required: true,
      hint: 'Access, erasure, rectification, restriction, portability, objection, automated decisions, or withdrawing consent, by name or Article. Separate several with ";".',
      aliases: ['rights', 'right', 'request type', 'type', 'request types']
    },
    {
      key: 'channel',
      label: 'How it arrived',
      kind: 'text',
      aliases: ['channel', 'received via', 'source', 'submitted via']
    },
    {
      key: 'receivedAt',
      label: 'Received on',
      kind: 'date',
      aliases: [
        'received',
        'received on',
        'date received',
        'submitted',
        'submitted on',
        'created',
        'created on',
        'opened'
      ]
    },
    {
      key: 'description',
      label: 'What was asked',
      kind: 'text',
      aliases: ['description', 'request', 'details', 'request details', 'notes']
    },
    {
      key: 'jurisdiction',
      label: 'Law',
      kind: 'choice',
      hint: "Empty: the entity's. A request under EU law to an entity under UK law only is not imported.",
      aliases: ['jurisdiction', 'law', 'regulation', 'regime law'],
      choices: [
        choice('uk', 'UK law', 'uk', 'uk gdpr', 'united kingdom'),
        choice(
          'eu',
          'EU law',
          'eu',
          'eu gdpr',
          'gdpr',
          'ireland',
          'european union'
        ),
        choice('uk_eu', 'Both', 'uk and eu', 'both', 'uk_eu')
      ]
    },
    {
      key: 'regime',
      label: 'Regime',
      kind: 'choice',
      hint: 'Part 3 of the Data Protection Act 2018 is for law enforcement processing by a competent authority.',
      aliases: ['regime', 'processing regime'],
      choices: [
        choice('gdpr', 'UK GDPR', 'gdpr', 'general processing'),
        choice('dpa_part3', 'Part 3', 'law enforcement', 'part 3', 'dpa part 3')
      ]
    },
    {
      key: 'owner',
      label: 'Handler',
      kind: 'text',
      hint: 'Their email address. Someone who is not a member here is kept with it, and it shows no handler.',
      aliases: ['owner', 'handler', 'assignee', 'assigned to', 'owner email']
    },
    {
      key: 'status',
      label: 'Status',
      kind: 'choice',
      hint: 'Waiting for proof of identity, or for clarification, needs the date it was asked for. A closed one needs its date.',
      aliases: ['status', 'state', 'stage'],
      choices: [
        choice('received', 'Received', 'new', 'open', 'submitted'),
        choice(
          'verifying',
          'Verifying identity',
          'verifying',
          'awaiting identity',
          'id verification',
          'identity pending'
        ),
        choice(
          'in_progress',
          'In progress',
          'in progress',
          'processing',
          'assigned',
          'working'
        ),
        choice(
          'paused',
          'Waiting for clarification',
          'paused',
          'on hold',
          'awaiting clarification',
          'awaiting information'
        ),
        choice(
          'responded',
          'Responded',
          'responded',
          'completed',
          'complete',
          'fulfilled',
          'done'
        ),
        choice(
          'refused',
          'Refused',
          'refused',
          'rejected',
          'declined',
          'denied'
        ),
        choice('withdrawn', 'Withdrawn', 'withdrawn', 'cancelled', 'canceled'),
        choice('closed', 'Closed', 'closed', 'archived')
      ]
    },
    {
      key: 'identityRequestedAt',
      label: 'Proof of identity asked for on',
      kind: 'date',
      aliases: [
        'identity requested',
        'id requested',
        'verification requested',
        'identity requested on'
      ]
    },
    {
      key: 'identityVerifiedAt',
      label: 'Identity verified on',
      kind: 'date',
      aliases: [
        'identity verified',
        'id verified',
        'verified on',
        'identity verified on',
        'verified'
      ]
    },
    {
      key: 'identityMethod',
      label: 'How identity was checked',
      kind: 'text',
      aliases: ['identity method', 'verification method', 'id method']
    },
    {
      key: 'clarificationRequestedAt',
      label: 'Clarification asked for on',
      kind: 'date',
      aliases: [
        'clarification requested',
        'clarification requested on',
        'information requested'
      ]
    },
    {
      key: 'clarificationReceivedAt',
      label: 'Clarification received on',
      kind: 'date',
      aliases: [
        'clarification received',
        'clarification received on',
        'information received'
      ]
    },
    {
      key: 'extended',
      label: 'Time extended',
      kind: 'yesno',
      hint: 'An extension needs the date it was decided, or the deadline cannot be worked out.',
      aliases: ['extended', 'extension', 'time extended']
    },
    {
      key: 'extendedAt',
      label: 'Extended on',
      kind: 'date',
      aliases: [
        'extended on',
        'extension date',
        'extension decided on',
        'date extended'
      ]
    },
    {
      key: 'extensionReason',
      label: 'Why it was extended',
      kind: 'text',
      aliases: ['extension reason', 'reason for extension']
    },
    {
      key: 'respondedAt',
      label: 'Responded on',
      kind: 'date',
      aliases: [
        'responded',
        'responded on',
        'response date',
        'completed on',
        'date completed',
        'fulfilled on'
      ]
    },
    {
      key: 'responseSummary',
      label: 'Response',
      kind: 'text',
      aliases: ['response', 'response summary', 'outcome', 'resolution']
    },
    {
      key: 'closedAt',
      label: 'Closed on',
      kind: 'date',
      aliases: ['closed', 'closed on', 'date closed', 'withdrawn on']
    },
    {
      key: 'closureRationale',
      label: 'Why it was closed',
      kind: 'text',
      aliases: ['closure reason', 'reason closed', 'closure rationale']
    },
    FILE
  ],
  breach: [
    ID,
    {
      key: 'title',
      label: 'Title',
      kind: 'text',
      required: true,
      aliases: ['title', 'name', 'breach', 'incident', 'summary', 'subject']
    },
    {
      key: 'description',
      label: 'What happened',
      kind: 'text',
      aliases: ['description', 'details', 'what happened', 'incident details']
    },
    {
      key: 'classification',
      label: 'Breach or near miss',
      kind: 'choice',
      hint: 'Empty: a breach. A near miss compromised no personal data, so it comes in with nobody told and no clock running.',
      aliases: [
        'classification',
        'breach or near miss',
        'incident classification'
      ],
      choices: [
        choice(
          'breach',
          'Breach',
          'breach',
          'personal data breach',
          'data breach',
          'confirmed breach'
        ),
        choice('near_miss', 'Near miss', 'near miss', 'near-miss', 'nearmiss')
      ]
    },
    {
      key: 'controllerRole',
      label: 'Our role',
      kind: 'choice',
      hint: "A processor tells the controller; the seventy-two hours to the authority is the controller's.",
      aliases: ['role', 'our role', 'controller or processor'],
      choices: [
        choice('controller', 'Controller', 'controller'),
        choice('joint_controller', 'Joint controller', 'joint controller'),
        choice('processor', 'Processor', 'processor')
      ]
    },
    {
      key: 'laws',
      label: 'Law',
      kind: 'choice',
      hint: "Empty: the entity's. A breach under EU law at an entity under UK law only is not imported.",
      aliases: ['jurisdiction', 'law', 'laws', 'regulation'],
      choices: [
        choice('uk', 'UK law', 'uk', 'uk gdpr', 'united kingdom'),
        choice(
          'eu',
          'EU law',
          'eu',
          'eu gdpr',
          'gdpr',
          'ireland',
          'european union'
        ),
        choice('uk_eu', 'Both', 'uk and eu', 'both', 'uk_eu')
      ]
    },
    {
      key: 'regime',
      label: 'Regime',
      kind: 'choice',
      hint: 'Part 3 of the Data Protection Act 2018 is for law enforcement processing by a competent authority.',
      aliases: ['regime', 'processing regime'],
      choices: [
        choice('gdpr', 'UK GDPR', 'gdpr', 'general processing'),
        choice('dpa_part3', 'Part 3', 'law enforcement', 'part 3', 'dpa part 3')
      ]
    },
    {
      key: 'affectedStates',
      label: 'Member States affected',
      kind: 'list',
      hint: 'EEA countries where affected people live, by two-letter code, such as "IE; FR".',
      aliases: ['affected states', 'member states', 'countries affected']
    },
    {
      key: 'discoveredAt',
      label: 'Discovered on',
      kind: 'date',
      hint: 'When the organisation became aware. The seventy-two hours runs from this.',
      aliases: [
        'discovered',
        'discovered on',
        'date discovered',
        'identified',
        'identified on',
        'date identified',
        'aware',
        'became aware',
        'reported internally'
      ]
    },
    {
      key: 'occurredAt',
      label: 'Happened on',
      kind: 'date',
      aliases: ['occurred', 'occurred on', 'date occurred', 'incident date']
    },
    {
      key: 'containedAt',
      label: 'Contained on',
      kind: 'date',
      aliases: ['contained', 'contained on', 'date contained']
    },
    {
      key: 'categories',
      label: 'Kind of breach',
      kind: 'list',
      hint: 'Confidentiality, integrity or availability. Separate several with ";".',
      aliases: ['category', 'categories', 'breach type', 'breach category']
    },
    {
      key: 'subjectsAffected',
      label: 'People affected',
      kind: 'number',
      aliases: [
        'people affected',
        'subjects affected',
        'data subjects affected',
        'number of data subjects',
        'individuals affected'
      ]
    },
    {
      key: 'recordsAffected',
      label: 'Records affected',
      kind: 'number',
      aliases: ['records affected', 'number of records']
    },
    {
      key: 'specialCategory',
      label: 'Special category data',
      kind: 'yesno',
      aliases: ['special category', 'special category data', 'sensitive data']
    },
    {
      key: 'likelyConsequences',
      label: 'Likely consequences',
      kind: 'text',
      aliases: ['consequences', 'likely consequences', 'impact']
    },
    {
      key: 'measuresTaken',
      label: 'Measures taken',
      kind: 'text',
      aliases: [
        'measures',
        'measures taken',
        'remediation',
        'actions taken',
        'containment'
      ]
    },
    {
      key: 'dataUnintelligible',
      label: 'Data unintelligible',
      kind: 'yesno',
      hint: 'Encrypted or otherwise unreadable to whoever got it.',
      aliases: ['encrypted', 'data encrypted', 'unintelligible']
    },
    {
      key: 'pecrServiceBreach',
      label: 'In providing a communications service',
      kind: 'yesno',
      hint: 'Only for a provider of a public electronic communications service (PECR reg 5A).',
      aliases: ['pecr', 'pecr breach', 'communications service breach']
    },
    {
      key: 'owner',
      label: 'Handler',
      kind: 'text',
      hint: 'Their email address. Someone who is not a member here is kept with it, and it shows no handler.',
      aliases: ['owner', 'handler', 'assignee', 'assigned to', 'owner email']
    },
    {
      key: 'status',
      label: 'Status',
      kind: 'choice',
      hint: 'Empty: worked out from its dates. A closed one needs its date.',
      aliases: ['status', 'state', 'stage'],
      choices: [
        choice('discovered', 'Discovered', 'new', 'open', 'reported', 'logged'),
        choice(
          'assessing',
          'Assessing',
          'assessing',
          'investigating',
          'in progress',
          'under investigation'
        ),
        choice('contained', 'Contained', 'contained', 'remediated'),
        choice('notified', 'Notified', 'notified', 'reported to regulator'),
        choice('closed', 'Closed', 'closed', 'resolved', 'complete', 'archived')
      ]
    },
    {
      key: 'authorityDecision',
      label: 'The supervisory authority',
      kind: 'choice',
      hint: 'Whether it was notified, or judged not to need notifying. Empty: not decided there.',
      aliases: [
        'reported to regulator',
        'reported to ico',
        'notifiable',
        'regulator notified',
        'ico notified',
        'authority notified'
      ],
      choices: [
        choice('notified', 'Notified', 'yes', 'notified', 'reported', 'true'),
        choice(
          'not_required',
          'Not required',
          'no',
          'not required',
          'not notifiable',
          'not reportable',
          'false'
        )
      ]
    },
    {
      key: 'authority',
      label: 'Which authority',
      kind: 'text',
      hint: 'Needed only where the breach is owed to more than one, such as under both UK and EU law. By name or code, such as "ICO" or "ie-dpc".',
      aliases: ['authority', 'regulator', 'supervisory authority']
    },
    {
      key: 'authorityNotifiedAt',
      label: 'Authority notified on',
      kind: 'date',
      hint: 'Needed for a notified breach: whether it was in time is read from it.',
      aliases: [
        'date reported to regulator',
        'regulator notified on',
        'ico notified on',
        'authority notified on',
        'date notified',
        'notified on'
      ]
    },
    {
      key: 'authorityRef',
      label: "Authority's reference",
      kind: 'text',
      aliases: ['regulator reference', 'ico reference', 'case number']
    },
    {
      key: 'authorityRationale',
      label: 'Why (the authority)',
      kind: 'text',
      aliases: [
        'notification rationale',
        'reason not reported',
        'reason not notified'
      ]
    },
    {
      key: 'lateReason',
      label: 'Why it was late',
      kind: 'text',
      aliases: ['late reason', 'reason for delay', 'delay reason']
    },
    {
      key: 'subjectsDecision',
      label: 'The people affected',
      kind: 'choice',
      hint: 'Whether they were told, or judged not to need telling. Empty: not decided there, or told on the date given.',
      aliases: [
        'individuals notified',
        'data subjects notified',
        'subjects notified'
      ],
      choices: [
        choice('told', 'Told', 'yes', 'told', 'notified', 'true'),
        choice('not_required', 'Not required', 'no', 'not required', 'false')
      ]
    },
    {
      key: 'subjectsNotifiedAt',
      label: 'People affected told on',
      kind: 'date',
      aliases: [
        'individuals notified on',
        'data subjects notified on',
        'subjects notified on',
        'date individuals notified'
      ]
    },
    {
      key: 'subjectsRationale',
      label: 'Why (the people affected)',
      kind: 'text',
      aliases: [
        'reason individuals not notified',
        'reason subjects not notified'
      ]
    },
    {
      key: 'pecrNotifiedAt',
      label: 'Commissioner told under PECR on',
      kind: 'date',
      aliases: ['pecr notified', 'pecr notified on', 'pecr report date']
    },
    {
      key: 'closedAt',
      label: 'Closed on',
      kind: 'date',
      aliases: ['closed on', 'date closed', 'resolved on']
    },
    {
      key: 'closureRationale',
      label: 'Why it was closed',
      kind: 'text',
      aliases: [
        'closure reason',
        'reason closed',
        'closure rationale',
        'lessons learned'
      ]
    },
    FILE
  ],
  data_protection_complaint: [
    ID,
    {
      key: 'complainantName',
      label: 'Complainant',
      kind: 'text',
      required: true,
      aliases: [
        'complainant',
        'complainant name',
        'data subject',
        'name',
        'full name',
        'raised by'
      ]
    },
    {
      key: 'complainantContact',
      label: 'Complainant contact',
      kind: 'text',
      aliases: [
        'email',
        'contact',
        'complainant email',
        'email address',
        'contact details'
      ]
    },
    {
      key: 'representative',
      label: 'Acting for them',
      kind: 'text',
      aliases: ['representative', 'agent', 'on behalf of', 'authorised agent']
    },
    {
      key: 'channel',
      label: 'How it arrived',
      kind: 'text',
      aliases: ['channel', 'received via', 'submitted via']
    },
    {
      key: 'receivedAt',
      label: 'Received on',
      kind: 'date',
      hint: 'Starts the thirty days to acknowledge it, for a complaint under UK law received from 19 June 2026.',
      aliases: [
        'received',
        'received on',
        'date received',
        'submitted',
        'submitted on',
        'created',
        'created on',
        'opened'
      ]
    },
    {
      key: 'subject',
      label: 'About',
      kind: 'choice',
      hint: "Empty: something else. The complainant's own words go in what they said.",
      aliases: ['subject', 'category', 'complaint type', 'about', 'topic'],
      choices: [
        choice(
          'request_handling',
          COMPLAINT_SUBJECTS.request_handling,
          'request handling',
          'dsar',
          'subject access',
          'data subject request',
          'request'
        ),
        choice(
          'accuracy',
          COMPLAINT_SUBJECTS.accuracy,
          'accuracy',
          'inaccurate data'
        ),
        choice(
          'security',
          COMPLAINT_SUBJECTS.security,
          'security',
          'breach',
          'data breach',
          'loss'
        ),
        choice(
          'disclosure',
          COMPLAINT_SUBJECTS.disclosure,
          'disclosure',
          'sharing',
          'data sharing'
        ),
        choice(
          'retention',
          COMPLAINT_SUBJECTS.retention,
          'retention',
          'kept too long'
        ),
        choice(
          'marketing',
          COMPLAINT_SUBJECTS.marketing,
          'marketing',
          'direct marketing',
          'spam'
        ),
        choice(
          'lawfulness',
          COMPLAINT_SUBJECTS.lawfulness,
          'lawfulness',
          'lawful basis',
          'unlawful processing'
        ),
        choice(
          'transparency',
          COMPLAINT_SUBJECTS.transparency,
          'transparency',
          'privacy notice',
          'right to be informed'
        ),
        choice(
          'automated_decision',
          COMPLAINT_SUBJECTS.automated_decision,
          'automated decision',
          'automated decision making',
          'profiling'
        ),
        choice(
          'other',
          COMPLAINT_SUBJECTS.other,
          'other',
          'something else',
          'general'
        )
      ]
    },
    {
      key: 'description',
      label: 'What they said',
      kind: 'text',
      aliases: [
        'description',
        'complaint',
        'details',
        'complaint details',
        'notes'
      ]
    },
    {
      key: 'jurisdiction',
      label: 'Law',
      kind: 'choice',
      hint: "Empty: the entity's. A complaint under EU law to an entity under UK law only is not imported.",
      aliases: ['jurisdiction', 'law', 'regulation'],
      choices: [
        choice('uk', 'UK law', 'uk', 'uk gdpr', 'united kingdom'),
        choice(
          'eu',
          'EU law',
          'eu',
          'eu gdpr',
          'gdpr',
          'ireland',
          'european union'
        ),
        choice('uk_eu', 'Both', 'uk and eu', 'both', 'uk_eu')
      ]
    },
    {
      key: 'controllerRole',
      label: 'Our role',
      kind: 'choice',
      hint: "A processor passes the complaint to the controller; the thirty days are the controller's.",
      aliases: ['role', 'our role', 'controller or processor'],
      choices: [
        choice('controller', 'Controller', 'controller'),
        choice('joint_controller', 'Joint controller', 'joint controller'),
        choice('processor', 'Processor', 'processor')
      ]
    },
    {
      key: 'requestRef',
      label: 'The request it is about',
      kind: 'text',
      hint: 'Its reference here, such as DSR-2026-0001, or its ID in the platform it was imported from. Import the requests first: a row naming a request Govern does not have is not imported.',
      aliases: ['request id', 'related request', 'dsr id', 'request reference']
    },
    {
      key: 'owner',
      label: 'Handler',
      kind: 'text',
      hint: 'Their email address. Someone who is not a member here is kept with it, and it shows no handler.',
      aliases: ['owner', 'handler', 'assignee', 'assigned to', 'owner email']
    },
    {
      key: 'status',
      label: 'Status',
      kind: 'choice',
      hint: 'Empty: worked out from its dates. Withdrawn and closed need the date it ended; outcome sent needs the outcome and its date.',
      aliases: ['status', 'state', 'stage'],
      choices: [
        choice('received', 'Received', 'received', 'new', 'open', 'submitted'),
        choice('acknowledged', 'Acknowledged', 'acknowledged'),
        choice(
          'investigating',
          'Investigating',
          'investigating',
          'in progress',
          'under investigation'
        ),
        choice(
          'outcome_sent',
          'Outcome sent',
          'outcome sent',
          'responded',
          'answered'
        ),
        choice('withdrawn', 'Withdrawn', 'withdrawn', 'cancelled'),
        choice(
          'closed',
          'Closed',
          'closed',
          'resolved',
          'complete',
          'completed'
        )
      ]
    },
    {
      key: 'acknowledgedAt',
      label: 'Acknowledged on',
      kind: 'date',
      aliases: [
        'acknowledged',
        'acknowledged on',
        'date acknowledged',
        'acknowledgement date'
      ]
    },
    {
      key: 'acknowledgementChannel',
      label: 'Acknowledged by',
      kind: 'text',
      aliases: ['acknowledgement channel', 'acknowledged via']
    },
    {
      key: 'acknowledgementLateReason',
      label: 'Why the acknowledgement was late',
      kind: 'text',
      aliases: ['acknowledgement late reason', 'reason acknowledgement late']
    },
    {
      key: 'lastUpdateAt',
      label: 'Last updated them on',
      kind: 'date',
      hint: 'The latest progress update the complainant was given. Updates are counted on from it.',
      aliases: [
        'last update',
        'last updated complainant',
        'last progress update'
      ]
    },
    {
      key: 'outcome',
      label: 'Outcome',
      kind: 'choice',
      aliases: ['outcome', 'result', 'finding'],
      choices: [
        choice('upheld', 'Upheld', 'upheld', 'justified', 'substantiated'),
        choice(
          'partly_upheld',
          'Partly upheld',
          'partly upheld',
          'partially upheld',
          'partly justified'
        ),
        choice(
          'not_upheld',
          'Not upheld',
          'not upheld',
          'rejected',
          'unjustified',
          'unsubstantiated'
        ),
        choice(
          'passed_to_controller',
          'Passed to the controller',
          'passed to controller',
          'referred to controller'
        )
      ]
    },
    {
      key: 'outcomeAt',
      label: 'Outcome sent on',
      kind: 'date',
      aliases: [
        'outcome date',
        'outcome sent on',
        'responded on',
        'date responded',
        'response date'
      ]
    },
    {
      key: 'outcomeChannel',
      label: 'Outcome sent by',
      kind: 'text',
      aliases: ['outcome channel', 'response channel', 'responded via']
    },
    {
      key: 'outcomeSummary',
      label: 'What they were told',
      kind: 'text',
      aliases: [
        'outcome summary',
        'what they were told',
        'response',
        'response summary',
        'resolution'
      ]
    },
    {
      key: 'remedialAction',
      label: 'What is changing because of it',
      kind: 'text',
      aliases: [
        'remedial action',
        'remediation',
        'actions taken',
        'corrective action'
      ]
    },
    {
      key: 'toldOfRegulatorRight',
      label: 'Told they may complain to the regulator',
      kind: 'yesno',
      aliases: [
        'told of right to complain',
        'regulator right',
        'ico rights given'
      ]
    },
    {
      key: 'outcomeLateReason',
      label: 'Why the outcome took longer',
      kind: 'text',
      aliases: ['outcome late reason', 'reason for delay', 'delay reason']
    },
    {
      key: 'closedAt',
      label: 'Closed on',
      kind: 'date',
      aliases: ['closed on', 'date closed', 'resolved on', 'withdrawn on']
    },
    {
      key: 'closureRationale',
      label: 'Why it was closed',
      kind: 'text',
      aliases: [
        'closure reason',
        'reason closed',
        'closure rationale',
        'withdrawal reason'
      ]
    },
    FILE
  ],
  information_request: [
    ID,
    {
      key: 'requesterName',
      label: 'Requester',
      kind: 'text',
      required: true,
      aliases: [
        'requester',
        'requester name',
        'applicant',
        'applicant name',
        'name',
        'full name'
      ]
    },
    {
      key: 'correspondenceAddress',
      label: 'Address for correspondence',
      kind: 'text',
      aliases: [
        'email',
        'address',
        'correspondence address',
        'contact',
        'email address',
        'contact details'
      ]
    },
    {
      key: 'kind',
      label: 'Kind of information',
      kind: 'choice',
      hint: "Empty: general. Environmental goes under the entity's environmental regulations; both, under both.",
      aliases: ['regime', 'request type', 'legislation', 'kind of information'],
      choices: [
        choice(
          'general',
          'General',
          'general',
          'foi',
          'foia',
          'freedom of information',
          'foisa'
        ),
        choice(
          'environmental',
          'Environmental',
          'environmental',
          'eir',
          'eisr',
          'environmental information'
        ),
        choice(
          'both',
          'Both',
          'both',
          'foi and eir',
          'foia and eir',
          'foi/eir',
          'foisa and eisr'
        )
      ]
    },
    {
      key: 'channel',
      label: 'How it arrived',
      kind: 'choice',
      hint: 'A request that is not environmental must be in writing, so one by phone or in person is not imported.',
      aliases: ['channel', 'received via', 'submitted via'],
      choices: [
        choice('email', 'Email', 'email', 'e-mail'),
        choice(
          'web_form',
          'Web form',
          'web form',
          'online form',
          'webform',
          'website',
          'portal'
        ),
        choice('post', 'Post', 'post', 'letter', 'mail'),
        choice('social_media', 'Social media', 'social media', 'twitter', 'x'),
        choice('phone', 'Phone', 'phone', 'telephone'),
        choice('in_person', 'In person', 'in person', 'face to face')
      ]
    },
    {
      key: 'receivedAt',
      label: 'Received on',
      kind: 'date',
      aliases: [
        'received',
        'received on',
        'date received',
        'submitted',
        'submitted on',
        'created',
        'created on',
        'opened'
      ]
    },
    {
      key: 'description',
      label: 'What was asked for',
      kind: 'text',
      aliases: [
        'description',
        'request',
        'details',
        'request details',
        'subject'
      ]
    },
    {
      key: 'owner',
      label: 'Handler',
      kind: 'text',
      hint: 'Their email address. Someone who is not a member here is kept with it, and it shows no handler.',
      aliases: ['owner', 'handler', 'assignee', 'assigned to', 'owner email']
    },
    {
      key: 'status',
      label: 'Status',
      kind: 'choice',
      hint: 'Empty: worked out from its dates. Responded needs its response date; closed, with no response owed, its closing date.',
      aliases: ['status', 'state', 'stage'],
      choices: [
        choice('open', 'Open', 'open', 'new', 'in progress', 'received'),
        choice(
          'responded',
          'Responded',
          'responded',
          'answered',
          'completed',
          'complete',
          'closed responded'
        ),
        choice(
          'closed',
          'Closed, no response owed',
          'closed',
          'withdrawn',
          'duplicate',
          'cancelled'
        )
      ]
    },
    {
      key: 'clarificationSoughtAt',
      label: 'Clarification asked for on',
      kind: 'date',
      aliases: [
        'clarification sought',
        'clarification requested',
        'clarification asked'
      ]
    },
    {
      key: 'clarificationReceivedAt',
      label: 'Clarification received on',
      kind: 'date',
      aliases: ['clarification received', 'clarification answered']
    },
    {
      key: 'feeNoticeAt',
      label: 'Fees notice sent on',
      kind: 'date',
      hint: 'The time stops from the notice until the fee is paid. Give the amount too.',
      aliases: [
        'fees notice',
        'fee notice',
        'fees notice date',
        'fee requested'
      ]
    },
    {
      key: 'feeAmount',
      label: 'Fee asked for',
      kind: 'number',
      aliases: ['fee', 'fee amount', 'charge']
    },
    {
      key: 'feePaidAt',
      label: 'Fee paid on',
      kind: 'date',
      aliases: ['fee paid', 'fee paid date', 'payment received']
    },
    {
      key: 'feeUnder',
      label: 'Fee charged under',
      kind: 'choice',
      hint: 'Only for a request under both regimes.',
      aliases: ['fee regime'],
      choices: [
        choice('general', 'General', 'general', 'foi', 'foia', 'foisa'),
        choice('environmental', 'Environmental', 'environmental', 'eir', 'eisr')
      ]
    },
    {
      key: 'complexityExtendedAt',
      label: 'Extended for complexity on',
      kind: 'date',
      hint: 'Environmental information only (reg 7): the day the requester was told it is complex and voluminous.',
      aliases: [
        'complexity extension',
        'extended for complexity',
        'reg 7 extension'
      ]
    },
    {
      key: 'publicInterestNoticeAt',
      label: 'Public interest notice sent on',
      kind: 'date',
      hint: 'FOIA only (s.10(3)): the notice saying the public interest is still being weighed. Give the exemption and the date it gave too.',
      aliases: [
        'public interest extension',
        'pit extension',
        'public interest notice'
      ]
    },
    {
      key: 'publicInterestDate',
      label: 'Public interest decision due',
      kind: 'date',
      aliases: ['public interest date', 'pit date', 'extended to']
    },
    {
      key: 'publicInterestExemption',
      label: 'Exemption being weighed',
      kind: 'text',
      aliases: ['public interest exemption', 'pit exemption']
    },
    {
      key: 'respondedAt',
      label: 'Responded on',
      kind: 'date',
      aliases: [
        'responded',
        'responded on',
        'response date',
        'date responded',
        'response sent',
        'completed on'
      ]
    },
    {
      key: 'outcome',
      label: 'Outcome',
      kind: 'choice',
      hint: 'Withheld or refused in any part needs the exemptions, or what it was refused as.',
      aliases: ['outcome', 'result', 'response type', 'disclosure'],
      choices: [
        choice(
          'released_in_full',
          'Released in full',
          'released in full',
          'disclosed in full',
          'granted in full',
          'full disclosure'
        ),
        choice(
          'released_in_part',
          'Released in part',
          'released in part',
          'disclosed in part',
          'partially disclosed',
          'part disclosure',
          'granted in part'
        ),
        choice(
          'withheld_in_full',
          'Withheld in full',
          'withheld in full',
          'withheld',
          'refused in full'
        ),
        choice(
          'refused_request',
          'Request refused as a whole',
          'request refused',
          'refused as a whole'
        ),
        choice('not_held', 'Not held', 'not held', 'information not held')
      ]
    },
    {
      key: 'responseSummary',
      label: 'What the response said',
      kind: 'text',
      aliases: ['response summary', 'response', 'resolution']
    },
    {
      key: 'exemptions',
      label: 'Exemptions relied on',
      kind: 'list',
      hint: 'By section or regulation, such as "s.40(2); s.43" or "reg 12(5)(e)". Separate several with ";".',
      aliases: [
        'exemptions',
        'exemptions applied',
        'exceptions',
        'exceptions applied'
      ]
    },
    {
      key: 'refusedAs',
      label: 'Refused as',
      kind: 'choice',
      hint: 'For a request refused as a whole other than under an exception. Not for environmental information.',
      aliases: ['refused as', 'refusal reason', 'refusal ground'],
      choices: [
        choice(
          'cost_limit',
          'Over the cost limit',
          'cost limit',
          's.12',
          'section 12'
        ),
        choice('vexatious', 'Vexatious', 'vexatious', 's.14(1)'),
        choice('repeated', 'Repeated', 'repeated', 'repeat request', 's.14(2)')
      ]
    },
    {
      key: 'lateReason',
      label: 'Why it was late',
      kind: 'text',
      aliases: ['late reason', 'reason for delay', 'delay reason']
    },
    {
      key: 'published',
      label: 'On the disclosure log',
      kind: 'yesno',
      aliases: ['published', 'disclosure log', 'on disclosure log']
    },
    {
      key: 'closedAt',
      label: 'Closed on',
      kind: 'date',
      aliases: ['closed on', 'date closed', 'withdrawn on']
    },
    {
      key: 'closureRationale',
      label: 'Why no response was owed',
      kind: 'text',
      aliases: ['closure reason', 'reason closed', 'closure rationale']
    },
    {
      key: 'reviewRequestedAt',
      label: 'Review asked for on',
      kind: 'date',
      hint: 'The latest internal review, where there was one.',
      aliases: [
        'internal review requested',
        'review requested',
        'review requested on',
        'internal review date'
      ]
    },
    {
      key: 'reviewGrounds',
      label: 'What the review was about',
      kind: 'text',
      aliases: ['review grounds', 'internal review grounds', 'grounds']
    },
    {
      key: 'reviewDecidedAt',
      label: 'Review decided on',
      kind: 'date',
      aliases: [
        'review decided',
        'review completed',
        'internal review completed',
        'review outcome date'
      ]
    },
    {
      key: 'reviewOutcome',
      label: 'Review outcome',
      kind: 'choice',
      aliases: ['review outcome', 'internal review outcome', 'review result'],
      choices: [
        choice('upheld', 'Upheld', 'upheld', 'original decision upheld'),
        choice(
          'varied',
          'Varied',
          'varied',
          'partly upheld',
          'partially upheld'
        ),
        choice('reversed', 'Reversed', 'reversed', 'overturned'),
        choice(
          'declined',
          'Declined, asked too late',
          'declined',
          'out of time'
        )
      ]
    },
    {
      key: 'reviewSummary',
      label: 'What the review decided',
      kind: 'text',
      aliases: ['review summary', 'internal review summary']
    },
    FILE
  ]
};

/** Ratings, whose values a person translates onto this organisation's scale. */
export const RATINGS: ReadonlySet<string> = new Set(
  Object.values(FIELDS)
    .flat()
    .filter((f) => f.kind === 'rating')
    .map((f) => f.key)
);

/**
 * Whether a person may say what a field's values mean here: a rating, on the
 * organisation's scale, or a choice, as one of its values. A source's own
 * words for a status ("In review") otherwise refuse every row that uses them.
 */
export const translates = (f: FieldDef): boolean =>
  f.kind === 'rating' || f.kind === 'choice';

const norm = (s: string) =>
  s
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, ' ');

/** A first matching of columns to fields, by name, for a person to check. */
export function guessMapping(
  recordType: RecordType,
  columns: readonly string[]
): ImportMapping {
  const fields: Record<string, string> = {};
  const taken = new Set<string>();
  // By the names each field is known by first, then by a field's own label
  // for those still unmatched, so a file laid out with Govern's names matches
  // without a label taking a column another field's name claims.
  const by = (named: (f: FieldDef) => readonly string[]) => {
    for (const f of FIELDS[recordType]) {
      if (fields[f.key]) continue;
      const column = columns.find(
        (c) => !taken.has(c) && named(f).includes(norm(c))
      );
      if (column) {
        fields[f.key] = column;
        taken.add(column);
      }
    }
  };
  by((f) => f.aliases);
  by((f) => [norm(f.label)]);
  return { fields, keepUnmapped: true };
}

/** Refused, with the reason, before anything is written. */
export class RowRefused extends Error {}

/** Several values in one cell: separated by semicolons, bars or line breaks. */
export function splitList(value: string): string[] {
  return value
    .split(/[;|\n]+/)
    .map((v) => v.trim())
    .filter(Boolean);
}

/** 2026-03-31, 31/03/2026 (UK order) or 31.03.2026, as an ISO date-time. */
export function readDate(value: string): string {
  const v = value.trim();
  let y: number, m: number, d: number;
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(v);
  const uk = /^(\d{1,2})[/.](\d{1,2})[/.](\d{4})$/.exec(v);
  if (iso) [y, m, d] = [+iso[1], +iso[2], +iso[3]];
  else if (uk) [d, m, y] = [+uk[1], +uk[2], +uk[3]];
  else
    throw new RowRefused(`"${v}" is not a date. Use 2026-03-31 or 31/03/2026.`);
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d)
    throw new RowRefused(`"${v}" is not a real date.`);
  return date.toISOString();
}

export function readRole(
  value: string
): 'controller' | 'processor' | 'joint_controller' {
  const v = norm(value);
  if (/joint/.test(v)) return 'joint_controller';
  if (/processor/.test(v)) return 'processor';
  if (/controller/.test(v)) return 'controller';
  throw new RowRefused(
    `"${value}" is not a role. Use controller, processor or joint controller.`
  );
}

/** "United States (SCCs)", "India: IDTA" or just "Canada". */
export function readTransfers(
  value: string
): Array<{ country: string; mechanism?: string }> {
  return splitList(value).map((entry) => {
    const m = /^(.+?)\s*(?:\((.+)\)|:\s*(.+))$/.exec(entry);
    return m
      ? { country: m[1].trim(), mechanism: (m[2] ?? m[3]).trim() }
      : { country: entry };
  });
}

const words = (s: string) => norm(s).replace(/[^a-z0-9 ]/g, '');

/** A choice field's value from its value, label or a usual word for it. */
export function knownChoice(field: FieldDef, value: string): string | null {
  const v = words(value);
  const found = (field.choices ?? []).find(
    (c) =>
      words(c.value.replace(/_/g, ' ')) === v ||
      words(c.label) === v ||
      c.words.some((w) => words(w) === v)
  );
  return found?.value ?? null;
}

/**
 * A choice field's value: what a person said this source's value means here,
 * or else its value, label or a usual word for it. Nothing else is guessed.
 */
export function readChoice(
  field: FieldDef,
  value: string,
  said: Record<string, string> = {}
): string {
  const chosen = said[value.trim().toLowerCase()];
  if (chosen && (field.choices ?? []).some((c) => c.value === chosen))
    return chosen;
  const known = knownChoice(field, value);
  if (!known)
    throw new RowRefused(
      `"${value}" is not a ${field.label.toLowerCase()} Govern knows. Say what it means on the matching step, or use one of: ${(
        field.choices ?? []
      )
        .map((c) => c.label)
        .join(', ')}.`
    );
  return known;
}

export function readNumber(field: FieldDef, value: string): number {
  const v = value.trim();
  if (!/^\d+$/.test(v))
    throw new RowRefused(
      `"${value}" is not a whole number, for ${field.label.toLowerCase()}.`
    );
  return Number(v);
}

export function readYesNo(field: FieldDef, value: string): boolean {
  const v = words(value);
  if (['yes', 'y', 'true', '1'].includes(v)) return true;
  if (['no', 'n', 'false', '0'].includes(v)) return false;
  throw new RowRefused(
    `"${value}" is not yes or no, for ${field.label.toLowerCase()}.`
  );
}

/** Its identifier there, or what names it when the file has none. */
function refOf(recordType: RecordType, valueOf: (key: string) => string) {
  const given = valueOf('externalRef');
  if (given) return given;
  if (recordType === 'dpa') {
    const supplier = valueOf('supplier');
    const title = valueOf('title');
    return supplier && title ? `${supplier} / ${title}` : null;
  }
  if (recordType === 'evidence') {
    // A title alone would make next year's "Annual penetration test" this
    // year's, written over it: when and which file tell them apart.
    const title = valueOf('title');
    return title
      ? [title, valueOf('collectedAt'), valueOf('file')]
          .filter(Boolean)
          .join(' / ')
      : null;
  }
  if (
    recordType === 'risk' ||
    recordType === 'policy_document' ||
    recordType === 'policy' ||
    recordType === 'assessment'
  )
    return valueOf('title') || null;
  if (recordType === 'breach') {
    // What and when tell two breaches apart where the source gave no ID.
    const title = valueOf('title');
    const discovered = valueOf('discoveredAt');
    return title && discovered ? `${title} / ${discovered}` : null;
  }
  if (recordType === 'information_request') {
    // Who and when tell two requests apart where the source gave no ID.
    const name = valueOf('requesterName');
    const received = valueOf('receivedAt');
    return name && received ? `${name} / ${received}` : null;
  }
  if (recordType === 'data_protection_complaint') {
    // Who and when tell two complaints apart where the source gave no ID.
    const name = valueOf('complainantName');
    const received = valueOf('receivedAt');
    return name && received ? `${name} / ${received}` : null;
  }
  if (recordType === 'data_subject_request') {
    // Who and when tell two requests apart where the source gave no ID.
    const name = valueOf('requesterName');
    const received = valueOf('receivedAt');
    return name && received ? `${name} / ${received}` : null;
  }
  if (recordType === 'mitigation') {
    const risk = valueOf('risk');
    const description = valueOf('description');
    return risk && description ? `${risk} / ${description}` : null;
  }
  return valueOf('name') || null;
}

/**
 * What each kind of record is checked against: the Integration API's own
 * contract, with the import's field names put into its terms.
 */
function checkAs(recordType: RecordType, data: Record<string, unknown>) {
  switch (recordType) {
    case 'processing_activity':
      return processingActivityIn.safeParse(data);
    case 'supplier':
      return vendorIn.safeParse(data);
    case 'dpa': {
      const { supplier, file: _file, ...rest } = data;
      return dpaIn.safeParse({ ...rest, vendorName: supplier });
    }
    case 'evidence': {
      const { file: _file, ...rest } = data;
      return evidenceIn.safeParse(rest);
    }
    case 'ai_use_case':
      return aiUseCaseIn.safeParse(data);
    case 'information_asset':
      return informationAssetIn.safeParse(data);
    case 'risk':
      return riskIn.safeParse(data);
    case 'mitigation':
      return mitigationIn.safeParse(data);
    case 'policy_document': {
      const { file: _file, ...rest } = data;
      return policyDocumentIn.safeParse(rest);
    }
    case 'policy': {
      const { file: _file, ...rest } = data;
      return policyIn.safeParse(rest);
    }
    case 'assessment': {
      const { file: _file, ...rest } = data;
      return assessmentIn.safeParse(rest);
    }
    case 'data_subject_request': {
      const { file: _file, ...rest } = data;
      return dataSubjectRequestIn.safeParse(rest);
    }
    case 'breach': {
      const { file: _file, ...rest } = data;
      return breachIn.safeParse(rest);
    }
    case 'data_protection_complaint': {
      const { file: _file, ...rest } = data;
      return complaintIn.safeParse(rest);
    }
    case 'information_request': {
      const { file: _file, ...rest } = data;
      return informationRequestIn.safeParse(rest);
    }
  }
}

/** Contract field names that differ from the import's. */
const CONTRACT_KEY: Record<string, string> = { vendorName: 'supplier' };

export type Converted =
  | { action: 'skip' }
  | { action: 'refuse'; sourceRef: string | null; reason: string }
  | { action: 'ok'; sourceRef: string; record: ImportRecord };

/**
 * One row as a record, checked as the Integration API checks a pushed one.
 * Nothing is guessed: a value that cannot be read refuses the row, with why.
 */
export function convertRow(
  recordType: RecordType,
  mapping: ImportMapping,
  row: Record<string, string>
): Converted {
  if (Object.values(row).every((v) => v.trim() === ''))
    return { action: 'skip' };
  const defs = FIELDS[recordType];
  const valueOf = (key: string) => {
    const column = mapping.fields[key];
    return column
      ? (row[column] ?? '').trim()
      : (mapping.everyRow?.[key] ?? '');
  };
  const sourceRef = refOf(recordType, valueOf);
  try {
    const data: Record<string, unknown> = {};
    for (const f of defs) {
      const raw = valueOf(f.key);
      if (!raw) {
        if (f.required) throw new RowRefused(`${f.label} is empty.`);
        continue;
      }
      data[f.key] =
        f.kind === 'list'
          ? splitList(raw)
          : f.kind === 'date'
            ? readDate(raw)
            : f.kind === 'role'
              ? readRole(raw)
              : f.kind === 'transfers'
                ? readTransfers(raw)
                : f.kind === 'choice'
                  ? readChoice(f, raw, mapping.values?.[f.key])
                  : f.kind === 'yesno'
                    ? readYesNo(f, raw)
                    : f.kind === 'number'
                      ? readNumber(f, raw)
                      : raw;
    }
    data.externalRef = sourceRef!;
    // Evidence is a document unless the row only gives a link.
    if (recordType === 'evidence' && !data.kind)
      data.kind = data.file || !data.uri ? 'document' : 'link';

    const mapped = new Set(Object.values(mapping.fields));
    // A case's other columns are mostly about the person who asked: kept
    // nowhere, as the register holds no more of them than it must.
    const unmapped =
      mapping.keepUnmapped && !CASE_HISTORY.has(recordType)
        ? Object.entries(row).filter(
            ([column, value]) => !mapped.has(column) && value.trim() !== ''
          )
        : [];
    // An assessment's other columns are its questions, answered: kept as a
    // list, in the file's order, which an object stored as JSON would lose.
    const asAnswers = recordType === 'assessment';
    if (asAnswers)
      data.answers = unmapped.map(([question, answer]) => ({
        question,
        answer
      }));
    const legacy = asAnswers ? {} : Object.fromEntries(unmapped);

    const checked = checkAs(recordType, data);
    if (!checked.success) {
      const issue = checked.error.issues[0];
      const key = String(issue.path[0] ?? '');
      const field = defs.find((f) => f.key === (CONTRACT_KEY[key] ?? key));
      throw new RowRefused(
        `${field?.label ?? (key || 'A value')}: ${
          issue.code === 'too_big' ? 'too long' : 'not accepted'
        }.`
      );
    }
    // The contract's defaults (empty lists) applied; the import's own names
    // and the file kept, which the contract does not know.
    const clean: Record<string, unknown> = {
      ...data,
      ...checked.data,
      externalRef: sourceRef!
    };
    if (recordType === 'dpa') delete clean.vendorName;
    return {
      action: 'ok',
      sourceRef: sourceRef!,
      record: { kind: recordType, data: clean, legacy } as ImportRecord
    };
  } catch (error) {
    if (error instanceof RowRefused)
      return { action: 'refuse', sourceRef, reason: error.message };
    throw error;
  }
}
