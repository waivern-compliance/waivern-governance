import type {
  Condition,
  Question,
  Section,
  TemplateDefinition
} from '../schema';

/**
 * Security and privacy due diligence on a supplier, in two depths.
 *
 * Light, for medium and low tier suppliers, asks what data the supplier gets,
 * where it goes, who else touches it, what certifications it holds, how it
 * reports a breach, and who to contact. Full, for critical and high tiers,
 * adds the controls behind Article 32 and the terms behind Article 28(3).
 * Full is light plus more sections, built from the same questions, so an
 * answer means the same thing at either depth.
 *
 * Grounded in UK GDPR Articles 28 and 32, with the EU GDPR articles cited
 * beside them; the form shows the EU ones only where the assessment's entity
 * is subject to the EU GDPR. ISO/IEC 27001, Cyber Essentials and SOC 2 are
 * named as evidence a supplier may offer, never as requirements: Article 32
 * asks for security appropriate to the risk, not for a particular badge.
 *
 * Never carries every key the AI supplier assessment is recognised by
 * (`AI_SUPPLIER_KEYS`), so a due-diligence assessment is never read as an
 * assessment of a supplier's AI. It does ask `ai_involvement`, which the
 * supplier assessment workflow reads to send it to Responsible AI review. Sent to the supplier through contributor
 * links and approved through the supplier assessment workflow like any other
 * `supplier_record`. The score rises with what is missing or unknown, not
 * with what the supplier does.
 */

/** The shipped names, which installs and updates match on. */
export const DUE_DILIGENCE_NAMES = {
  light: 'Supplier due diligence (light)',
  full: 'Supplier due diligence (full)'
} as const;

/** The depth a supplier of this tier is assessed at: full for critical and high, light below. */
export function dueDiligenceDepth(
  tier: 'critical' | 'high' | 'medium' | 'low'
): keyof typeof DUE_DILIGENCE_NAMES {
  return tier === 'critical' || tier === 'high' ? 'full' : 'light';
}

const PROCESSOR = ['ukgdpr.art28', 'eugdpr.art28'];
const SECURITY = ['ukgdpr.art32', 'eugdpr.art32'];
const TRANSFERS = [
  'ukgdpr.art44',
  'ukgdpr.art46',
  'eugdpr.art44',
  'eugdpr.art46'
];

const PERSONAL_DATA: Condition = {
  op: 'equals',
  question: 'personal_data',
  value: true
};

/** An evidence question asked, and required, only while `when` holds. */
function evidenceFor(
  key: string,
  label: string,
  when: Condition,
  legalRefs: string[]
): Question {
  return {
    key,
    label,
    type: 'evidence',
    required: false,
    showWhen: when,
    requireWhen: when,
    help: 'Give the issuing body, the reference or certificate number, the date and what it covers, or a link to where it can be checked. Send a copy of the document itself to whoever sent you this questionnaire, so it can be kept on your record with us.',
    legalRefs,
    evidence: 'required'
  };
}

const holds = (value: string): Condition => ({
  op: 'includes',
  question: 'certifications',
  value
});

const ABOUT: Section = {
  key: 'about',
  title: 'The supplier and the service',
  description:
    'Who the supplier is, what it does for us, and who to talk to about security and data protection.',
  questions: [
    {
      key: 'supplier_name',
      label: 'Which supplier is this?',
      type: 'short_text',
      required: true,
      legalRefs: [],
      evidence: 'none'
    },
    {
      key: 'service',
      label: 'What does the supplier provide to us?',
      type: 'long_text',
      required: true,
      legalRefs: [],
      evidence: 'none'
    },
    {
      key: 'security_contact',
      label:
        "Who is the supplier's contact for security and data protection, including breaches?",
      type: 'short_text',
      required: true,
      help: 'A name or role, and an email address or telephone number that is answered out of hours.',
      legalRefs: [],
      evidence: 'none'
    },
    {
      // The key and values the supplier assessment workflow reads to send an
      // assessment to Responsible AI review. On its own it does not make this
      // an AI supplier assessment, which also asks about training on our data.
      key: 'ai_involvement',
      label: 'How does the supplier use AI?',
      type: 'single_select',
      required: true,
      help: "If it does, the assessment goes to Responsible AI review before approval. Record it on the supplier's page as well, and assess the AI itself with the AI supplier assessment.",
      legalRefs: [],
      evidence: 'none',
      options: [
        {
          value: 'in_delivery',
          label: 'Uses AI in delivering the service to us'
        },
        {
          value: 'ai_product',
          label: 'Supplies an AI product, model or service'
        },
        { value: 'none', label: 'Does not use AI in what it provides' }
      ]
    }
  ]
};

const DATA: Section = {
  key: 'data',
  title: 'Our data',
  description:
    'What the supplier holds or can reach, where it is processed, and who else touches it.',
  questions: [
    {
      key: 'personal_data',
      label: 'Will the supplier process personal data on our behalf?',
      type: 'boolean',
      required: true,
      help: 'Including only being able to see it, such as when hosting or supporting a system that holds it. If so, the supplier is a processor.',
      legalRefs: PROCESSOR,
      evidence: 'none'
    },
    {
      key: 'data_categories',
      label: 'Which categories of personal data?',
      type: 'data_category',
      required: false,
      showWhen: PERSONAL_DATA,
      requireWhen: PERSONAL_DATA,
      legalRefs: PROCESSOR,
      evidence: 'none'
    },
    {
      key: 'processing_locations',
      label: 'Where is our data processed and stored, including for support?',
      type: 'single_select',
      required: true,
      legalRefs: TRANSFERS,
      evidence: 'none',
      options: [
        { value: 'uk', label: 'In the UK only', weight: 0 },
        {
          value: 'uk_eea_adequate',
          label:
            'In the UK, the EEA or countries with an adequacy decision or regulations',
          weight: 0
        },
        {
          value: 'elsewhere',
          label: 'Elsewhere as well',
          weight: 2
        },
        { value: 'unknown', label: 'Not established', weight: 4 }
      ]
    },
    {
      key: 'processing_locations_detail',
      label: 'Which countries, and for what?',
      type: 'long_text',
      required: false,
      showWhen: {
        op: 'or',
        any: [
          {
            op: 'equals',
            question: 'processing_locations',
            value: 'uk_eea_adequate'
          },
          {
            op: 'equals',
            question: 'processing_locations',
            value: 'elsewhere'
          }
        ]
      },
      requireWhen: {
        op: 'equals',
        question: 'processing_locations',
        value: 'elsewhere'
      },
      legalRefs: TRANSFERS,
      evidence: 'none'
    },
    {
      key: 'sub_processors',
      label: 'Does the supplier use sub-processors or subcontractors for it?',
      type: 'single_select',
      required: true,
      help: 'A processor may engage another only with our authorisation, and must tell us of changes so that we can object.',
      legalRefs: PROCESSOR,
      evidence: 'none',
      options: [
        { value: 'none', label: 'No', weight: 0 },
        {
          value: 'listed_notified',
          label: 'Yes, listed, and we are told before any change',
          weight: 0
        },
        {
          value: 'listed_not_notified',
          label: 'Yes, listed, but we are not told of changes',
          weight: 2
        },
        { value: 'not_disclosed', label: 'Yes, not disclosed', weight: 4 }
      ]
    },
    {
      key: 'sub_processor_list',
      label: 'Who are they, what do they do, and where?',
      type: 'long_text',
      required: false,
      showWhen: {
        op: 'or',
        any: [
          {
            op: 'equals',
            question: 'sub_processors',
            value: 'listed_notified'
          },
          {
            op: 'equals',
            question: 'sub_processors',
            value: 'listed_not_notified'
          }
        ]
      },
      requireWhen: {
        op: 'or',
        any: [
          {
            op: 'equals',
            question: 'sub_processors',
            value: 'listed_notified'
          },
          {
            op: 'equals',
            question: 'sub_processors',
            value: 'listed_not_notified'
          }
        ]
      },
      legalRefs: PROCESSOR,
      evidence: 'optional'
    }
  ]
};

const CERTIFICATIONS: Section = {
  key: 'certifications',
  title: 'Certifications and reports',
  description:
    'Independent evidence of security the supplier already holds. None is required: Article 32 asks for security appropriate to the risk, and these are ways of showing it.',
  questions: [
    {
      key: 'certifications',
      label: 'Which of these does the supplier hold?',
      type: 'multi_select',
      required: true,
      legalRefs: [
        ...SECURITY,
        'iso27001',
        'ncsc.cyberessentials',
        'aicpa.soc2'
      ],
      evidence: 'none',
      options: [
        { value: 'iso27001', label: 'ISO/IEC 27001 certification', weight: 0 },
        { value: 'cyber_essentials', label: 'Cyber Essentials', weight: 0 },
        {
          value: 'cyber_essentials_plus',
          label: 'Cyber Essentials Plus',
          weight: 0
        },
        { value: 'soc2', label: 'A SOC 2 report', weight: 0 },
        { value: 'other', label: 'Another certification or report', weight: 0 },
        { value: 'none', label: 'None', weight: 3 }
      ]
    },
    evidenceFor(
      'evidence_iso27001',
      'Your ISO/IEC 27001 certificate',
      holds('iso27001'),
      ['iso27001']
    ),
    evidenceFor(
      'evidence_cyber_essentials',
      'Your Cyber Essentials certificate',
      {
        op: 'or',
        any: [holds('cyber_essentials'), holds('cyber_essentials_plus')]
      },
      ['ncsc.cyberessentials']
    ),
    evidenceFor('evidence_soc2', 'Your SOC 2 report', holds('soc2'), [
      'aicpa.soc2'
    ]),
    evidenceFor(
      'evidence_other',
      'The other certification or report, and who issued it',
      holds('other'),
      []
    ),
    {
      key: 'certification_scope',
      label: 'Does what the supplier holds cover the service it provides us?',
      type: 'single_select',
      required: false,
      help: 'A certificate covers what its scope statement says, which may be one office or one product rather than the service we buy.',
      showWhen: {
        op: 'and',
        all: [
          { op: 'answered', question: 'certifications' },
          { op: 'not', condition: holds('none') }
        ]
      },
      requireWhen: {
        op: 'and',
        all: [
          { op: 'answered', question: 'certifications' },
          { op: 'not', condition: holds('none') }
        ]
      },
      legalRefs: SECURITY,
      evidence: 'none',
      options: [
        { value: 'all', label: 'Yes, all of it', weight: 0 },
        { value: 'part', label: 'Part of it', weight: 1 },
        { value: 'no', label: 'No', weight: 3 }
      ]
    }
  ]
};

const BREACHES: Section = {
  key: 'breaches',
  title: 'Breaches',
  description:
    'A processor must tell us of a personal data breach without undue delay, and we have 72 hours from becoming aware of it to report it to the regulator.',
  questions: [
    {
      key: 'breach_notification',
      label:
        'How soon will the supplier tell us of a breach affecting our data?',
      type: 'single_select',
      required: true,
      legalRefs: ['ukgdpr.art33', 'eugdpr.art33', ...PROCESSOR],
      evidence: 'optional',
      options: [
        { value: 'within_24h', label: 'Within 24 hours', weight: 0 },
        { value: 'within_72h', label: 'Within 72 hours', weight: 1 },
        {
          value: 'undue_delay',
          label: 'Without undue delay, with no period given',
          weight: 2
        },
        { value: 'no_commitment', label: 'No commitment', weight: 4 }
      ]
    },
    {
      key: 'recent_breaches',
      label:
        'Has the supplier had a security incident or breach in the last three years that affected customer data?',
      type: 'single_select',
      required: true,
      legalRefs: [],
      evidence: 'none',
      options: [
        { value: 'no', label: 'No', weight: 0 },
        { value: 'yes', label: 'Yes, and has described it', weight: 1 },
        { value: 'declined', label: 'Declined to say', weight: 3 }
      ]
    },
    {
      key: 'recent_breaches_detail',
      label: 'What happened, and what changed afterwards?',
      type: 'long_text',
      required: false,
      showWhen: { op: 'equals', question: 'recent_breaches', value: 'yes' },
      requireWhen: { op: 'equals', question: 'recent_breaches', value: 'yes' },
      legalRefs: [],
      evidence: 'none'
    }
  ]
};

/** A single-select control question scored good, partial or absent. */
function control(
  key: string,
  label: string,
  options: [good: string, partial: string, absent: string],
  legalRefs: string[] = SECURITY,
  help?: string
): Question {
  return {
    key,
    label,
    type: 'single_select',
    required: true,
    ...(help ? { help } : {}),
    legalRefs,
    evidence: 'optional',
    options: [
      { value: 'yes', label: options[0], weight: 0 },
      { value: 'partly', label: options[1], weight: 2 },
      { value: 'no', label: options[2], weight: 4 }
    ]
  };
}

const ACCESS_AND_ENCRYPTION: Section = {
  key: 'access_and_encryption',
  title: 'Access control and encryption',
  questions: [
    control(
      'access_control',
      'How is access to our data controlled?',
      [
        'Role-based, with multi-factor authentication for all access and regular review',
        'Role-based, but without multi-factor authentication everywhere or without review',
        'Not controlled by role'
      ],
      SECURITY,
      "Including the supplier's own staff and administrators, and remote support."
    ),
    control('encryption_in_transit', 'Is our data encrypted in transit?', [
      'Yes, with current TLS everywhere',
      'Only on some connections',
      'No'
    ]),
    control('encryption_at_rest', 'Is our data encrypted at rest?', [
      'Yes, everywhere it is stored, including backups',
      'In some places only',
      'No'
    ]),
    {
      key: 'key_management',
      label: 'Who holds the encryption keys, and how are they protected?',
      type: 'long_text',
      required: false,
      legalRefs: SECURITY,
      evidence: 'none'
    }
  ]
};

const VULNERABILITIES: Section = {
  key: 'vulnerabilities',
  title: 'Vulnerability management and testing',
  questions: [
    control(
      'patching',
      'How quickly are security updates applied?',
      [
        'Critical and high-risk updates within 14 days',
        'Within 30 days, or without a set period',
        'No policy'
      ],
      [...SECURITY, 'ncsc.cyberessentials'],
      'Cyber Essentials expects critical and high-risk updates within 14 days of release.'
    ),
    {
      key: 'penetration_testing',
      label:
        'Is the service tested by an independent penetration tester, and how often?',
      type: 'single_select',
      required: true,
      help: 'Article 32(1)(d) asks for a process for regularly testing and evaluating the effectiveness of security measures.',
      legalRefs: SECURITY,
      evidence: 'none',
      options: [
        { value: 'annual', label: 'At least once a year', weight: 0 },
        {
          value: 'occasional',
          label: 'Less often, or not regularly',
          weight: 2
        },
        { value: 'never', label: 'Not tested', weight: 4 }
      ]
    },
    evidenceFor(
      'evidence_penetration_test',
      'A summary of the latest penetration test: who tested, when, what was in scope, and whether the findings have been fixed',
      {
        op: 'or',
        any: [
          { op: 'equals', question: 'penetration_testing', value: 'annual' },
          {
            op: 'equals',
            question: 'penetration_testing',
            value: 'occasional'
          }
        ]
      },
      SECURITY
    )
  ]
};

const RESILIENCE: Section = {
  key: 'resilience',
  title: 'Continuity, people and logging',
  questions: [
    control(
      'business_continuity',
      'Can the service be restored after an incident, and has that been tested?',
      [
        'Yes, with a continuity and recovery plan tested in the last year',
        'There is a plan, but it has not been tested',
        'No plan'
      ],
      SECURITY,
      'Article 32(1)(b) and (c): resilience, and restoring availability and access in a timely manner.'
    ),
    {
      key: 'recovery_objectives',
      label:
        'How long would it take to restore the service, and how much data could be lost?',
      type: 'short_text',
      required: false,
      help: 'The recovery time and recovery point objectives, if the supplier has set them.',
      legalRefs: SECURITY,
      evidence: 'none'
    },
    control(
      'staff_vetting',
      'Are staff with access to our data vetted and trained?',
      [
        'Screened before they start (for example to BPSS) and trained in security and data protection each year',
        'Screened or trained, but not both',
        'Neither'
      ],
      [...SECURITY, ...PROCESSOR],
      'A processor must make sure people authorised to process the data are under a duty of confidence.'
    ),
    control('logging', 'Is access to our data logged and monitored?', [
      'Logged, monitored for misuse, and the logs kept',
      'Logged but not monitored',
      'Not logged'
    ])
  ]
};

const TERMS: Section = {
  key: 'terms',
  title: 'Transfers and contract terms',
  description: 'What the agreement holds the supplier to.',
  questions: [
    {
      key: 'international_transfers',
      label:
        'Is our personal data sent to a country without an adequacy decision or regulations, and if so how is it protected?',
      type: 'single_select',
      required: false,
      showWhen: PERSONAL_DATA,
      requireWhen: PERSONAL_DATA,
      help: 'Under UK law, a country without UK adequacy regulations; under EU law, one outside the EEA without an EU adequacy decision. Ask about both where both laws apply.',
      legalRefs: [...TRANSFERS, 'ico.idta'],
      evidence: 'optional',
      options: [
        {
          value: 'none',
          label:
            'No, it stays where adequacy decisions or regulations cover it',
          weight: 0
        },
        {
          value: 'safeguarded',
          label:
            'Yes, under standard contractual clauses (the EU clauses, with the UK Addendum for UK law, or the IDTA), binding corporate rules or another Article 46 safeguard',
          weight: 1
        },
        {
          value: 'unprotected',
          label: 'Yes, with no safeguard',
          weight: 5
        },
        { value: 'unknown', label: 'Not established', weight: 3 }
      ]
    },
    {
      key: 'article_28_terms',
      label: 'Which of the Article 28(3) terms does the agreement include?',
      type: 'multi_select',
      required: false,
      showWhen: PERSONAL_DATA,
      requireWhen: PERSONAL_DATA,
      help: "Each is required in a contract with a processor. Whether an agreement is held at all is recorded on the supplier's page, where the third-party register checks it; this asks what it says.",
      legalRefs: PROCESSOR,
      evidence: 'optional',
      options: [
        {
          value: 'instructions',
          label: 'Acts only on our documented instructions'
        },
        {
          value: 'confidentiality',
          label: 'People processing it are bound to confidentiality'
        },
        { value: 'security', label: 'Takes the measures Article 32 requires' },
        {
          value: 'sub_processors',
          label:
            'Engages sub-processors only with our authorisation, on the same terms'
        },
        {
          value: 'rights',
          label: "Helps us answer people's requests to exercise their rights"
        },
        {
          value: 'obligations',
          label:
            'Helps us with security, breaches and DPIAs (Articles 32 to 36)'
        },
        {
          value: 'end_of_contract',
          label: 'Deletes or returns the data at the end of the contract'
        },
        {
          value: 'audit',
          label:
            'Gives us the information to show compliance, and allows audits'
        }
      ]
    },
    {
      key: 'end_of_contract',
      label: 'What happens to our data when the contract ends?',
      type: 'single_select',
      required: true,
      legalRefs: PROCESSOR,
      evidence: 'optional',
      options: [
        {
          value: 'deleted_certified',
          label:
            'Returned or deleted, including copies, and deletion confirmed in writing',
          weight: 0
        },
        {
          value: 'deleted',
          label: 'Returned or deleted, with no confirmation',
          weight: 1
        },
        { value: 'kept', label: 'Kept by the supplier', weight: 4 },
        { value: 'unknown', label: 'Not established', weight: 3 }
      ]
    }
  ]
};

const CONCLUSION: Section = {
  key: 'conclusion',
  title: 'Conclusion',
  description:
    'For us to answer. It is never sent to the supplier, even on a link to the whole assessment.',
  organisationOnly: true,
  questions: [
    {
      key: 'evidence_received',
      label:
        'Has the evidence the supplier described been received and checked?',
      type: 'single_select',
      required: true,
      legalRefs: [],
      evidence: 'none',
      options: [
        { value: 'checked', label: 'Yes, received and checked' },
        { value: 'received', label: 'Received, not yet checked' },
        { value: 'outstanding', label: 'Some is still outstanding' },
        { value: 'none_described', label: 'None was described' }
      ]
    },
    {
      key: 'recommendation',
      label: 'What do you recommend?',
      type: 'single_select',
      required: true,
      legalRefs: [],
      evidence: 'none',
      options: [
        { value: 'proceed', label: 'Proceed' },
        { value: 'proceed_with_conditions', label: 'Proceed, with conditions' },
        { value: 'do_not_proceed', label: 'Do not proceed' }
      ]
    },
    {
      key: 'conditions',
      label: 'On what conditions?',
      type: 'long_text',
      required: false,
      showWhen: {
        op: 'equals',
        question: 'recommendation',
        value: 'proceed_with_conditions'
      },
      requireWhen: {
        op: 'equals',
        question: 'recommendation',
        value: 'proceed_with_conditions'
      },
      legalRefs: [],
      evidence: 'none'
    }
  ]
};

const LIGHT_SCORED = [
  'processing_locations',
  'sub_processors',
  'certifications',
  'certification_scope',
  'breach_notification',
  'recent_breaches'
];

const FULL_SCORED = [
  ...LIGHT_SCORED,
  'access_control',
  'encryption_in_transit',
  'encryption_at_rest',
  'patching',
  'penetration_testing',
  'business_continuity',
  'staff_vetting',
  'logging',
  'international_transfers',
  'end_of_contract'
];

export const SUPPLIER_DUE_DILIGENCE_LIGHT: TemplateDefinition = {
  schema: {
    sections: [ABOUT, DATA, CERTIFICATIONS, BREACHES, CONCLUSION]
  },
  scoring: {
    method: 'weighted_sum',
    questions: LIGHT_SCORED,
    // The worst case sums to 18: holding nothing and holding something that
    // covers none of the service score alike, and only one can be true. A
    // supplier keeping our data in the UK, certified for the service and
    // promising notice of a breach within a day scores 0. One that will not
    // say where the data goes or who else has it is moderate on that alone,
    // and high once it holds nothing either.
    bands: [
      { min: 0, max: 3, label: 'Low', tier: 'low' },
      { min: 4, max: 8, label: 'Moderate', tier: 'medium' },
      { min: 9, max: 14, label: 'High', tier: 'high' },
      {
        min: 15,
        max: 100,
        label: 'Not acceptable without change',
        tier: 'critical'
      }
    ]
  },
  reviewIntervalMonths: 24
};

export const SUPPLIER_DUE_DILIGENCE_FULL: TemplateDefinition = {
  schema: {
    sections: [
      ABOUT,
      DATA,
      CERTIFICATIONS,
      BREACHES,
      ACCESS_AND_ENCRYPTION,
      VULNERABILITIES,
      RESILIENCE,
      TERMS,
      CONCLUSION
    ]
  },
  scoring: {
    method: 'weighted_sum',
    questions: FULL_SCORED,
    // The worst case sums to 59. Each control missing outright adds 4 and an
    // unprotected transfer 5, so three or four serious gaps reach the high
    // band on their own. Whether a processor agreement is held is not scored
    // here: the third-party register reads it from the agreement itself.
    bands: [
      { min: 0, max: 6, label: 'Low', tier: 'low' },
      { min: 7, max: 15, label: 'Moderate', tier: 'medium' },
      { min: 16, max: 28, label: 'High', tier: 'high' },
      {
        min: 29,
        max: 200,
        label: 'Not acceptable without change',
        tier: 'critical'
      }
    ]
  },
  reviewIntervalMonths: 12
};

/**
 * Whether a definition is a due diligence questionnaire, recognised by the
 * questions it asks so that an organisation's own copy counts as a review.
 */
export function isDueDiligenceDefinition(definition: {
  schema: { sections: Array<{ questions: Array<{ key: string }> }> };
}): boolean {
  const keys = new Set(
    definition.schema.sections.flatMap((s) => s.questions.map((q) => q.key))
  );
  return ['certifications', 'breach_notification', 'recommendation'].every(
    (k) => keys.has(k)
  );
}
