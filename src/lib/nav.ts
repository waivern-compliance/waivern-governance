import { can, type Capability, type Grant } from './rbac';

/**
 * What to offer somebody.
 *
 * Every destination names the capability it needs, and the navigation asks
 * before showing it. Offering a link to a page that will render its heading,
 * its table chrome and nothing else is worse than not offering it: the emptiness
 * reads as a fault in the platform rather than as an absence of permission.
 *
 * This is presentation. The pages themselves still check — see `requireCapability`
 * — because a link that is not shown is not a link that cannot be typed.
 */
export type NavItem = {
  href: string;
  label: string;
  hint: string;
  /** Absent means everybody signed in. */
  capability?: Capability;
  /**
   * Offered only where some entity is subject to UK or EU data protection
   * law: the page belongs to the privacy programme, and an organisation
   * using Govern for AI governance alone has no use for it.
   */
  privacy?: true;
  /** Offered only where some entity is subject to UK law: the page is the Data Protection Act 2018's. */
  ukLaw?: true;
  /** Offered only where some entity answers freedom of information requests. */
  foi?: true;
  /** Offered only where some entity is under UK PECR or the Irish ePrivacy Regulations. */
  eprivacy?: true;
  /** Offered only where the organisation has turned Cyber Essentials on. */
  cyberEssentials?: true;
  /**
   * Administration is a different kind of thing from a register, and filing
   * it under "everything else" is how the owner of a platform ends up unable
   * to find the screen that configures it.
   */
  group?: 'admin';
};

export const NAV: NavItem[] = [
  {
    href: '/app/tasks',
    label: 'Tasks',
    hint: 'what is waiting on you'
    // Deliberately open. A task that names you is your business whether or not
    // you may read anything else.
  },
  {
    href: '/app/dashboard',
    label: 'Governance overview',
    hint: 'posture, pipeline and service levels',
    capability: 'record.read'
  },
  {
    href: '/app/trends',
    label: 'Trends',
    hint: 'posture month by month, and how long decisions take',
    capability: 'record.read'
  },
  {
    href: '/app/assessments',
    label: 'Assessments',
    hint: 'start, answer and submit',
    capability: 'record.read'
  },
  {
    href: '/app/reviews',
    label: 'Recurring reviews',
    hint: 'what comes round again, and what is already overdue',
    capability: 'record.read'
  },
  {
    href: '/app/ropa',
    label: 'Processing register',
    hint: 'Article 30 records, and which would fail an inspection',
    capability: 'record.read',
    privacy: true
  },
  {
    href: '/app/policies',
    label: 'Policies',
    hint: 'Each policy, the version in force, its approval and review',
    capability: 'record.read'
  },
  {
    href: '/app/policy-documents',
    label: 'Appropriate policy documents',
    hint: 'Schedule 1 conditions, and what no current document covers',
    capability: 'record.read',
    privacy: true,
    ukLaw: true
  },
  {
    href: '/app/sharing-agreements',
    label: 'Data sharing agreements',
    hint: 'sharing with other controllers, and what no agreement covers',
    capability: 'record.read',
    privacy: true,
    ukLaw: true
  },
  {
    href: '/app/third-parties',
    label: 'Third parties',
    hint: 'suppliers, their agreements, and which are not covered',
    capability: 'record.read'
  },
  {
    href: '/app/assets',
    label: 'Information asset register',
    hint: 'systems and repositories, who owns them and where they are',
    capability: 'record.read'
  },
  {
    href: '/app/cyber-essentials',
    label: 'Cyber Essentials',
    hint: 'certification scopes, and the requirements they are assessed against',
    capability: 'record.read',
    cyberEssentials: true
  },
  {
    href: '/app/contracts',
    label: 'Supplier contracts',
    hint: 'commercial contracts, renewals and notice dates',
    capability: 'record.read'
  },
  {
    href: '/app/ai',
    label: 'AI register',
    hint: 'every AI system, and what nobody has assessed',
    capability: 'record.read'
  },
  {
    href: '/app/ai/intake',
    label: 'AI intake',
    hint: 'proposals to use AI, before anything is built or bought',
    capability: 'record.read'
  },
  {
    href: '/app/ai/incidents',
    label: 'AI incidents and concerns',
    hint: 'harm reported, and what was done about it',
    capability: 'record.read'
  },
  {
    href: '/app/ai/profile',
    label: 'NIST AI RMF profile',
    hint: 'Govern, Map, Measure and Manage: where you stand and where you aim to',
    capability: 'record.read'
  },
  {
    href: '/app/evidence',
    label: 'Evidence',
    hint: 'what supports your records, and what nobody has confirmed',
    capability: 'record.read'
  },
  {
    href: '/app/breaches',
    label: 'Breaches',
    hint: 'the Article 33(5) register, and the seventy-two hours',
    capability: 'record.read',
    privacy: true
  },
  {
    href: '/app/requests',
    label: 'Data subject requests',
    hint: 'access, objection and the other rights, and the month to answer',
    capability: 'dsr.handle',
    privacy: true
  },
  {
    href: '/app/cookies',
    label: 'Cookies and similar technologies',
    hint: 'the inventory, and the ePrivacy basis for each',
    capability: 'record.read',
    privacy: true,
    eprivacy: true
  },
  {
    href: '/app/marketing',
    label: 'Electronic marketing',
    hint: 'email, text and calls, and the ePrivacy basis for each',
    capability: 'record.read',
    privacy: true,
    eprivacy: true
  },
  {
    href: '/app/complaints',
    label: 'Data protection complaints',
    hint: 'complaints made to you, and the 30 days to acknowledge them',
    capability: 'dsr.handle',
    privacy: true
  },
  {
    href: '/app/information-requests',
    label: 'Freedom of information requests',
    hint: 'FOIA, the EIR and the Scottish Acts, and the twenty working days',
    capability: 'foi.handle',
    ukLaw: true,
    foi: true
  },
  {
    href: '/app/risks',
    label: 'Risk register',
    hint: 'mitigations, residual rating, acceptance',
    capability: 'record.read'
  },
  {
    href: '/app/findings',
    label: 'Scan findings',
    hint: 'pushed in by scanning tools, awaiting a decision',
    capability: 'record.read'
  },
  {
    href: '/app/countries',
    label: 'Country library',
    hint: 'UK approval, adequacy, transfer risk, and when it was last checked',
    capability: 'record.read',
    privacy: true
  },
  {
    href: '/app/authorities',
    label: 'Supervisory authorities',
    hint: "the UK regulator and each EEA State's, as complaints and refusals name them",
    capability: 'record.read',
    privacy: true
  },
  {
    href: '/app/exports',
    label: 'Exports',
    hint: 'spreadsheets of anything you can see',
    capability: 'record.read'
  },
  {
    href: '/app/training',
    label: 'AI learning',
    hint: 'what you need to know about AI, and whether it is current'
  },
  {
    href: '/app/templates',
    label: 'Assessment templates',
    hint: 'the questions each kind of assessment asks',
    capability: 'record.read'
  },
  {
    href: '/app/admin/organisation',
    label: 'Organisation',
    hint: 'what this organisation is called throughout',
    capability: 'org.manage',
    group: 'admin'
  },
  {
    href: '/app/admin/people',
    label: 'People and access',
    hint: 'who may sign in, and as what',
    capability: 'member.manage',
    group: 'admin'
  },
  {
    href: '/app/admin/workflows',
    label: 'Approval workflows',
    hint: 'who signs off each kind of assessment',
    capability: 'workflow.configure',
    group: 'admin'
  },
  {
    href: '/app/admin/assistant',
    label: 'Assistant',
    hint: 'point the platform at a model you control',
    capability: 'org.manage',
    group: 'admin'
  }
];

export function navFor(
  grants: readonly Grant[],
  options: {
    privacy?: boolean;
    ukLaw?: boolean;
    foi?: boolean;
    eprivacy?: boolean;
    cyberEssentials?: boolean;
  } = {}
): NavItem[] {
  return NAV.filter(
    (item) =>
      (!item.capability || can(grants, item.capability)) &&
      (options.privacy !== false || !item.privacy) &&
      (options.ukLaw !== false || !item.ukLaw) &&
      (options.foi !== false || !item.foi) &&
      (options.eprivacy !== false || !item.eprivacy) &&
      (options.cyberEssentials !== false || !item.cyberEssentials)
  );
}
