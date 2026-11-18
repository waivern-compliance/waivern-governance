import type { CeRequirement, CeTheme, CeThemeId } from './types';

/**
 * The five technical controls of Cyber Essentials and the requirements under
 * each, from NCSC's "Cyber Essentials: Requirements for IT Infrastructure".
 *
 * Paraphrased, not quoted: the summaries are Govern's words, and each carries
 * the page of the NCSC document it comes from so a reader can check it. The
 * question set that goes with the requirements is IASME's and is not
 * reproduced anywhere in Govern.
 *
 * The technical requirements did not change between v3.2 and v3.3; what
 * changed was scope (see `scope.ts`) and the question set's marking (see
 * `editions.ts`). So one list serves both, with each edition's pages.
 */

const CLOUD_FIREWALL_MALWARE = {
  iaas: 'both',
  paas: 'provider_and_sometimes_organisation',
  saas: 'provider'
} as const;

const ALL_USER_DEVICES = [
  'server',
  'desktop',
  'laptop',
  'tablet',
  'mobile_phone',
  'iaas',
  'paas',
  'saas'
] as const;

export const CE_THEMES: readonly CeTheme[] = [
  {
    id: 'firewalls',
    label: 'Firewalls',
    aim: 'Only secure and necessary network services can be reached from the internet.',
    appliesTo: [
      'boundary_firewall',
      'desktop',
      'laptop',
      'router',
      'server',
      'iaas',
      'paas',
      'saas'
    ],
    cloud: CLOUD_FIREWALL_MALWARE
  },
  {
    id: 'secure_configuration',
    label: 'Secure configuration',
    aim: 'Computers and network devices are set up to reduce vulnerabilities and run only the services their role needs.',
    appliesTo: [
      'server',
      'desktop',
      'laptop',
      'tablet',
      'mobile_phone',
      'thin_client',
      'iaas',
      'paas',
      'saas'
    ],
    cloud: { iaas: 'both', paas: 'both', saas: 'both' }
  },
  {
    id: 'update_management',
    label: 'Security update management',
    aim: 'Devices and software are not open to known weaknesses that already have a fix.',
    appliesTo: [
      'server',
      'desktop',
      'laptop',
      'tablet',
      'mobile_phone',
      'boundary_firewall',
      'router',
      'iaas',
      'paas',
      'saas'
    ],
    cloud: { iaas: 'both', paas: 'both', saas: 'provider' }
  },
  {
    id: 'user_access_control',
    label: 'User access control',
    aim: 'Accounts go only to authorised people, and give access only to what their role needs.',
    appliesTo: ALL_USER_DEVICES,
    cloud: { iaas: 'organisation', paas: 'organisation', saas: 'organisation' }
  },
  {
    id: 'malware_protection',
    label: 'Malware protection',
    aim: 'Known malware and untrusted software cannot run, cause damage or reach data.',
    appliesTo: ALL_USER_DEVICES,
    cloud: CLOUD_FIREWALL_MALWARE
  }
];

export const CE_REQUIREMENTS: readonly CeRequirement[] = [
  // Firewalls
  {
    code: 'FW.PROTECT_EVERY_DEVICE',
    theme: 'firewalls',
    summary:
      'Every device in scope sits behind a correctly configured firewall, or a network device that does the job of one.',
    pages: { 'v3.2': 14, 'v3.3': 13 }
  },
  {
    code: 'FW.SOFTWARE_FIREWALL_UNTRUSTED',
    theme: 'firewalls',
    summary:
      "A device used on a network the organisation doesn't control, such as public wifi, runs its own software firewall.",
    pages: { 'v3.2': 14, 'v3.3': 14 }
  },
  {
    code: 'FW.DEFAULT_ADMIN_PASSWORD',
    theme: 'firewalls',
    summary:
      "A firewall's default administrator password is replaced with a strong, unique one, or remote administration is switched off.",
    pages: { 'v3.2': 14, 'v3.3': 14 }
  },
  {
    code: 'FW.ADMIN_INTERFACE',
    theme: 'firewalls',
    summary:
      "A firewall's administration interface cannot be reached from the internet, unless there is a documented business need and it is protected by MFA, or by an allow list of a few trusted addresses together with managed passwords.",
    pages: { 'v3.2': 14, 'v3.3': 14 }
  },
  {
    code: 'FW.BLOCK_INBOUND',
    theme: 'firewalls',
    summary:
      'Inbound connections that are not authenticated are blocked by default.',
    pages: { 'v3.2': 14, 'v3.3': 14 }
  },
  {
    code: 'FW.INBOUND_RULES_APPROVED',
    theme: 'firewalls',
    summary:
      'Each inbound rule is approved by an authorised person and documented with the business need for it.',
    pages: { 'v3.2': 14, 'v3.3': 14 }
  },
  {
    code: 'FW.REMOVE_UNNEEDED_RULES',
    theme: 'firewalls',
    summary: 'Rules no longer needed are removed or disabled.',
    pages: { 'v3.2': 14, 'v3.3': 14 }
  },

  // Secure configuration
  {
    code: 'SC.REMOVE_ACCOUNTS',
    theme: 'secure_configuration',
    summary:
      'Accounts that are not needed, such as guest accounts and unused administrator accounts, are regularly removed or disabled.',
    pages: { 'v3.2': 15, 'v3.3': 15 }
  },
  {
    code: 'SC.DEFAULT_PASSWORDS',
    theme: 'secure_configuration',
    summary: 'Default and guessable account passwords are changed.',
    pages: { 'v3.2': 16, 'v3.3': 15 }
  },
  {
    code: 'SC.REMOVE_SOFTWARE',
    theme: 'secure_configuration',
    summary:
      'Software that is not needed, including applications, system utilities and network services, is removed or disabled.',
    pages: { 'v3.2': 16, 'v3.3': 15 }
  },
  {
    code: 'SC.AUTORUN',
    theme: 'secure_configuration',
    summary:
      'Auto-run is disabled wherever it would run a file, such as a download, without the user agreeing.',
    pages: { 'v3.2': 16, 'v3.3': 15 }
  },
  {
    code: 'SC.AUTHENTICATE_ACCESS',
    theme: 'secure_configuration',
    summary:
      "Users are authenticated before they reach the organisation's data or services.",
    pages: { 'v3.2': 16, 'v3.3': 15 }
  },
  {
    code: 'SC.DEVICE_LOCKING',
    theme: 'secure_configuration',
    summary:
      'A device someone uses in person needs a biometric, password or PIN before it gives access.',
    pages: { 'v3.2': 16, 'v3.3': 16 }
  },
  {
    code: 'SC.UNLOCK_BRUTE_FORCE',
    theme: 'secure_configuration',
    summary:
      "Where it can be configured, unlocking is protected against guessing: no more than 10 attempts in 5 minutes, or a lock after no more than 10 failures. Otherwise the vendor's default applies.",
    pages: { 'v3.2': 16, 'v3.3': 16 }
  },
  {
    code: 'SC.UNLOCK_CREDENTIAL_QUALITY',
    theme: 'secure_configuration',
    summary:
      'A PIN or password that only unlocks the device is at least 6 characters. One that also signs the user in meets the password rules under user access control.',
    pages: { 'v3.2': 16, 'v3.3': 16 }
  },

  // Security update management
  {
    code: 'SUM.LICENSED_SUPPORTED',
    theme: 'update_management',
    summary:
      'All software on in-scope devices is licensed and supported: the vendor fixes vulnerabilities and has said when that support ends.',
    pages: { 'v3.2': 17, 'v3.3': 17 }
  },
  {
    code: 'SUM.REMOVE_UNSUPPORTED',
    theme: 'update_management',
    summary:
      'Software that loses support is removed, or moved into a sub-set that has no traffic to or from the internet.',
    pages: { 'v3.2': 17, 'v3.3': 17 }
  },
  {
    code: 'SUM.AUTOMATIC_UPDATES',
    theme: 'update_management',
    summary: 'Automatic updates are on wherever possible.',
    pages: { 'v3.2': 17, 'v3.3': 17 }
  },
  {
    code: 'SUM.CRITICAL_14_DAYS',
    theme: 'update_management',
    summary:
      'An update is installed within 14 days of release when the vendor calls what it fixes critical or high risk, when it fixes anything scored 7 or more on CVSS v3, or when the vendor gives no severity. An update that bundles such a fix with others counts.',
    pages: { 'v3.2': 17, 'v3.3': 17 }
  },

  // User access control
  {
    code: 'UAC.ACCOUNT_PROCESS',
    theme: 'user_access_control',
    summary: 'There is a process to create and approve user accounts.',
    pages: { 'v3.2': 20, 'v3.3': 19 }
  },
  {
    code: 'UAC.UNIQUE_CREDENTIALS',
    theme: 'user_access_control',
    summary:
      'Users sign in with credentials of their own before they reach applications or devices.',
    pages: { 'v3.2': 20, 'v3.3': 19 }
  },
  {
    code: 'UAC.REMOVE_ACCOUNTS',
    theme: 'user_access_control',
    summary:
      'Accounts are removed or disabled when no longer needed, such as when someone leaves or after a set period unused.',
    pages: { 'v3.2': 20, 'v3.3': 19 }
  },
  {
    code: 'UAC.THIRD_PARTY_ACCOUNTS',
    theme: 'user_access_control',
    summary:
      'Accounts that suppliers, contractors or managed service providers use to support the organisation are controlled like any other.',
    pages: { 'v3.2': 20, 'v3.3': 19 }
  },
  {
    code: 'UAC.MFA',
    theme: 'user_access_control',
    summary: 'Multi-factor authentication is used wherever it is available.',
    pages: { 'v3.2': 20, 'v3.3': 20 }
  },
  {
    code: 'UAC.MFA_CLOUD',
    theme: 'user_access_control',
    summary:
      'Every sign-in to a cloud service uses multi-factor authentication, for users and administrators alike.',
    pages: { 'v3.2': 20, 'v3.3': 20 }
  },
  {
    code: 'UAC.SEPARATE_ADMIN',
    theme: 'user_access_control',
    summary:
      'Administration is done from separate accounts used for nothing else: no email, web browsing or everyday work.',
    pages: { 'v3.2': 20, 'v3.3': 20 }
  },
  {
    code: 'UAC.REMOVE_PRIVILEGES',
    theme: 'user_access_control',
    summary:
      'Special access privileges are removed or disabled when no longer needed, such as when someone changes role.',
    pages: { 'v3.2': 20, 'v3.3': 20 }
  },
  {
    code: 'UAC.MFA_PASSWORD_LENGTH',
    theme: 'user_access_control',
    summary:
      'The password part of multi-factor authentication is at least 8 characters, with no maximum length.',
    pages: { 'v3.2': 22, 'v3.3': 21 }
  },
  {
    code: 'UAC.PASSWORD_BRUTE_FORCE',
    theme: 'user_access_control',
    summary:
      'Passwords are protected against guessing by at least one of: multi-factor authentication, no more than 10 attempts in 5 minutes, or a lock after no more than 10 failures.',
    pages: { 'v3.2': 21, 'v3.3': 21 }
  },
  {
    code: 'UAC.PASSWORD_QUALITY',
    theme: 'user_access_control',
    summary:
      'Password quality is enforced technically by one of: multi-factor authentication, a 12-character minimum, or an 8-character minimum with common passwords blocked. None sets a maximum length.',
    pages: { 'v3.2': 21, 'v3.3': 22 }
  },
  {
    code: 'UAC.PASSWORD_SUPPORT',
    theme: 'user_access_control',
    summary:
      'People are helped to choose unique passwords: told what to avoid, encouraged to use several words, and given somewhere safe to keep them. Passwords are not forced to expire and complexity rules are not imposed.',
    pages: { 'v3.2': 21, 'v3.3': 22 }
  },
  {
    code: 'UAC.COMPROMISED_PASSWORDS',
    theme: 'user_access_control',
    summary:
      'There is a process to change a password promptly when it, or its account, is known or suspected to be compromised.',
    pages: { 'v3.2': 21, 'v3.3': 22 }
  },

  // Malware protection
  {
    code: 'MP.ACTIVE_ON_EVERY_DEVICE',
    theme: 'malware_protection',
    summary:
      'Every device in scope has at least one active form of malware protection, kept up to date as the vendor says.',
    pages: { 'v3.2': 24, 'v3.3': 23 },
    alternatives: ['MP.ANTI_MALWARE', 'MP.ALLOW_LISTING']
  },
  {
    code: 'MP.ANTI_MALWARE',
    theme: 'malware_protection',
    summary:
      'Anti-malware software, an option for Windows and macOS devices, is updated as the vendor recommends, stops malware and malicious code running, and blocks connections to malicious websites.',
    pages: { 'v3.2': 24, 'v3.3': 24 }
  },
  {
    code: 'MP.ALLOW_LISTING',
    theme: 'malware_protection',
    summary:
      'Application allow listing, an option for any device: only approved, code-signed applications run, each approved before it is deployed, from a list kept current. Unsigned or wrongly signed applications cannot be installed.',
    pages: { 'v3.2': 25, 'v3.3': 24 }
  }
];

const BY_CODE = new Map(CE_REQUIREMENTS.map((r) => [r.code, r]));
const THEME_BY_ID = new Map(CE_THEMES.map((t) => [t.id, t]));

/** A requirement by its code, whichever edition holds it. */
export function ceRequirement(code: string): CeRequirement | null {
  return BY_CODE.get(code) ?? null;
}

export function ceTheme(id: CeThemeId): CeTheme {
  const theme = THEME_BY_ID.get(id);
  if (!theme) throw new Error(`Unknown Cyber Essentials theme: ${id}`);
  return theme;
}
