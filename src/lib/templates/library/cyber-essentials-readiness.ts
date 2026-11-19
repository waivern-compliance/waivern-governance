import { isAutoFail } from '@/lib/cyber-essentials/editions';
import { readinessFramework } from '@/lib/cyber-essentials/readiness';
import { ceReferenceCode } from '@/lib/cyber-essentials/references';
import type { CeEditionId } from '@/lib/cyber-essentials/types';

import type { Question, Section, TemplateDefinition } from '../schema';

/**
 * Cyber Essentials readiness, for requirements v3.3 and IASME's Danzell
 * question set.
 *
 * Every question is in Govern's words. The question set is IASME's and
 * carries no licence to reuse it, so nothing here reproduces it: each question
 * cites the NCSC requirement it tests (Open Government Licence), and its help
 * names the part of the question set it corresponds to, so answers can be
 * carried across to the assessment portal. The sections follow the question
 * set's order; its insurance section is left out, because it tests no control.
 *
 * Each question names the requirement codes it tests (`controls`), so the
 * scope's status per requirement is read from the answers rather than kept
 * apart from them. Where the edition marks a requirement as an automatic
 * fail, so is every question testing it.
 *
 * Cyber Essentials is a scheme an organisation takes up, or a contract asks
 * for. It is not a legal duty, and nothing here says it is.
 */
const EDITION: CeEditionId = 'v3.3';

const NOT_APPLICABLE_HELP =
  'Not applicable leaves the requirement out of the count; say why in the notes.';

type Spec = {
  key: string;
  label: string;
  controls: readonly string[];
  /** Where the question set asks about it. */
  danzell: string;
  help?: string;
  showWhen?: Question['showWhen'];
  /** Offered as a third answer, when the requirement may not apply. */
  notApplicable?: string;
};

function requirement(spec: Spec): Question {
  const help = [spec.help, `Danzell ${spec.danzell}.`]
    .filter(Boolean)
    .join(' ');
  const base = {
    key: spec.key,
    label: spec.label,
    required: true,
    legalRefs: spec.controls.map((c) => ceReferenceCode(EDITION, c)),
    evidence: 'optional' as const,
    controls: [...spec.controls],
    ...(spec.controls.some((c) => isAutoFail(EDITION, c))
      ? { autoFail: true }
      : {}),
    ...(spec.showWhen ? { showWhen: spec.showWhen } : {})
  };
  if (!spec.notApplicable) return { ...base, type: 'boolean', help };
  return {
    ...base,
    type: 'single_select',
    help: `${help} ${NOT_APPLICABLE_HELP}`,
    options: [
      { value: 'yes', label: 'Yes', meets: 'met' },
      { value: 'no', label: 'No', meets: 'not_met' },
      {
        value: 'not_applicable',
        label: spec.notApplicable,
        meets: 'not_applicable'
      }
    ]
  };
}

const ORGANISATION: Section = {
  key: 'organisation',
  title: 'Organisation',
  description:
    'Who answers for the assessment. The certificate names the legal entities the scope covers, so check they are listed on the scope.',
  questions: [
    {
      key: 'signatory',
      label:
        'Who will sign the self-assessment off for the board, or its equivalent?',
      type: 'short_text',
      required: true,
      help: 'Under Danzell the declaration also covers keeping the controls in place for the whole year the certificate runs. Danzell section A1.',
      legalRefs: ['ncsc.ce.requirements'],
      evidence: 'none'
    }
  ]
};

const SCOPE: Section = {
  key: 'scope',
  title: 'Scope',
  description:
    "What the certificate covers. The scope's own page checks the assets placed in it against these rules.",
  questions: [
    requirement({
      key: 'scope_end_user_devices',
      label:
        'Does the scope include the laptops, desktops, tablets and phones people use for work?',
      controls: ['SCOPE.END_USER_DEVICES'],
      danzell: 'section A2',
      help: 'A scope without end-user devices is not accepted.'
    }),
    requirement({
      key: 'scope_cloud',
      label:
        'Is every cloud service that holds your data or runs your services in scope?',
      controls: ['SCOPE.CLOUD_INCLUDED'],
      danzell: 'A2.9, which lists them',
      help: 'Cloud services cannot be left out of a scope.'
    }),
    requirement({
      key: 'scope_byod',
      label:
        "Are devices people own themselves in scope, where they reach the organisation's data or services?",
      controls: ['SCOPE.BYOD'],
      danzell: 'section A2',
      help: "A device used only for its own calls and texts, or for an MFA app, is out of scope, and so are students' own devices.",
      notApplicable: 'Nobody uses their own device for work'
    }),
    requirement({
      key: 'scope_third_party_accounts',
      label:
        'Are the accounts suppliers and managed service providers use on your behalf in scope?',
      controls: ['SCOPE.THIRD_PARTY_ACCOUNTS'],
      danzell: 'section A2',
      notApplicable: 'No supplier or provider has an account'
    }),
    {
      key: 'untrusted_networks',
      label:
        'Are devices in scope used on networks you do not control, such as home or public wifi?',
      type: 'boolean',
      required: true,
      help: 'A home router the organisation did not supply counts as one. Danzell section A2.',
      legalRefs: [ceReferenceCode(EDITION, 'SCOPE.HOME_WORKING')],
      evidence: 'none'
    }
  ]
};

const FIREWALLS: Section = {
  key: 'firewalls',
  title: 'Firewalls',
  questions: [
    requirement({
      key: 'fw_every_device',
      label:
        'Is every device in scope behind a correctly configured firewall, or a network device that does the job of one?',
      controls: ['FW.PROTECT_EVERY_DEVICE'],
      danzell: 'section A4'
    }),
    requirement({
      key: 'fw_software_untrusted',
      label:
        'Do the devices used on networks you do not control run their own software firewall, switched on and configured?',
      controls: ['FW.SOFTWARE_FIREWALL_UNTRUSTED'],
      danzell: 'section A4',
      showWhen: { op: 'equals', question: 'untrusted_networks', value: true }
    }),
    requirement({
      key: 'fw_default_password',
      label:
        "Has every firewall's default administrator password been replaced with a strong, unique one, or remote administration switched off?",
      controls: ['FW.DEFAULT_ADMIN_PASSWORD'],
      danzell: 'section A4'
    }),
    {
      key: 'fw_admin_from_internet',
      label:
        "Can any firewall's administration interface be reached from the internet?",
      type: 'boolean',
      required: true,
      help: 'Danzell section A4.',
      legalRefs: [ceReferenceCode(EDITION, 'FW.ADMIN_INTERFACE')],
      evidence: 'none'
    },
    requirement({
      key: 'fw_admin_protected',
      label:
        'Is there a documented business need for that, and is the interface protected by MFA, or by an allow list of a few trusted addresses with managed passwords?',
      controls: ['FW.ADMIN_INTERFACE'],
      danzell: 'section A4',
      showWhen: {
        op: 'equals',
        question: 'fw_admin_from_internet',
        value: true
      }
    }),
    requirement({
      key: 'fw_block_inbound',
      label:
        'Are inbound connections that are not authenticated blocked by default?',
      controls: ['FW.BLOCK_INBOUND'],
      danzell: 'section A4'
    }),
    requirement({
      key: 'fw_inbound_approved',
      label:
        'Is each inbound rule approved by an authorised person and documented with the business need for it?',
      controls: ['FW.INBOUND_RULES_APPROVED'],
      danzell: 'section A4',
      notApplicable: 'No inbound connections are allowed'
    }),
    requirement({
      key: 'fw_remove_rules',
      label: 'Are rules no longer needed removed or disabled?',
      controls: ['FW.REMOVE_UNNEEDED_RULES'],
      danzell: 'section A4',
      notApplicable: 'No inbound connections are allowed'
    })
  ]
};

const SECURE_CONFIGURATION: Section = {
  key: 'secure_configuration',
  title: 'Secure configuration',
  questions: [
    requirement({
      key: 'sc_remove_accounts',
      label:
        'Are accounts that are not needed, such as guest accounts and unused administrator accounts, regularly removed or disabled?',
      controls: ['SC.REMOVE_ACCOUNTS'],
      danzell: 'section A5'
    }),
    requirement({
      key: 'sc_default_passwords',
      label: 'Are default and guessable account passwords changed?',
      controls: ['SC.DEFAULT_PASSWORDS'],
      danzell: 'section A5'
    }),
    requirement({
      key: 'sc_remove_software',
      label:
        'Is software that is not needed, including applications, system utilities and network services, removed or disabled?',
      controls: ['SC.REMOVE_SOFTWARE'],
      danzell: 'section A5'
    }),
    requirement({
      key: 'sc_autorun',
      label:
        'Is auto-run disabled wherever it would run a file, such as a download, without the user agreeing?',
      controls: ['SC.AUTORUN'],
      danzell: 'section A5'
    }),
    requirement({
      key: 'sc_authenticate',
      label:
        "Are users authenticated before they reach the organisation's data or services?",
      controls: ['SC.AUTHENTICATE_ACCESS'],
      danzell: 'section A5'
    }),
    requirement({
      key: 'sc_device_locking',
      label:
        'Does every device someone uses in person need a biometric, password or PIN before it gives access?',
      controls: ['SC.DEVICE_LOCKING'],
      danzell: 'section A5'
    }),
    requirement({
      key: 'sc_unlock_guessing',
      label:
        'Where it can be configured, is unlocking limited to 10 attempts in 5 minutes, or locked after no more than 10 failures?',
      controls: ['SC.UNLOCK_BRUTE_FORCE'],
      danzell: 'section A5',
      help: "Where it cannot be configured, the vendor's default counts."
    }),
    requirement({
      key: 'sc_unlock_length',
      label:
        'Is a PIN or password that only unlocks a device at least 6 characters long?',
      controls: ['SC.UNLOCK_CREDENTIAL_QUALITY'],
      danzell: 'section A5',
      help: 'One that also signs the user in follows the password rules under user access control.',
      notApplicable: 'No device uses an unlock-only PIN or password'
    })
  ]
};

const UPDATE_MANAGEMENT: Section = {
  key: 'update_management',
  title: 'Security update management',
  questions: [
    requirement({
      key: 'sum_licensed',
      label:
        'Is all software on devices in scope licensed and supported, with a date the vendor has given for the end of support?',
      controls: ['SUM.LICENSED_SUPPORTED'],
      danzell: 'section A6',
      help: 'Supported means on the date the certificate is issued. The scope page flags assets past their supported-until date.'
    }),
    requirement({
      key: 'sum_unsupported',
      label:
        'Is software that loses support removed, or moved into a sub-set with no traffic to or from the internet?',
      controls: ['SUM.REMOVE_UNSUPPORTED'],
      danzell: 'section A6',
      notApplicable: 'Nothing in scope is out of support'
    }),
    requirement({
      key: 'sum_automatic',
      label: 'Are automatic updates switched on wherever possible?',
      controls: ['SUM.AUTOMATIC_UPDATES'],
      danzell: 'section A6'
    }),
    requirement({
      key: 'sum_os_14_days',
      label:
        'Are critical and high-risk updates to operating systems, and to router and firewall firmware, installed within 14 days of release?',
      controls: ['SUM.CRITICAL_14_DAYS'],
      danzell: 'A6.4, an automatic fail if not',
      help: 'High risk means the vendor calls it critical or high, it fixes anything scored 7 or more on CVSS v3, or the vendor gives no severity.'
    }),
    requirement({
      key: 'sum_apps_14_days',
      label:
        'Are critical and high-risk updates to applications, including their files and extensions, installed within 14 days of release?',
      controls: ['SUM.CRITICAL_14_DAYS'],
      danzell: 'A6.5, an automatic fail if not'
    })
  ]
};

const USER_ACCESS_CONTROL: Section = {
  key: 'user_access_control',
  title: 'User access control',
  questions: [
    requirement({
      key: 'uac_account_process',
      label: 'Is there a process to create and approve user accounts?',
      controls: ['UAC.ACCOUNT_PROCESS'],
      danzell: 'section A7'
    }),
    requirement({
      key: 'uac_unique',
      label:
        'Does everyone sign in with credentials of their own before they reach applications or devices?',
      controls: ['UAC.UNIQUE_CREDENTIALS'],
      danzell: 'section A7'
    }),
    requirement({
      key: 'uac_remove_accounts',
      label:
        'Are accounts removed or disabled when no longer needed, such as when someone leaves?',
      controls: ['UAC.REMOVE_ACCOUNTS'],
      danzell: 'section A7'
    }),
    requirement({
      key: 'uac_third_party',
      label:
        'Are the accounts suppliers, contractors and managed service providers use controlled like any other?',
      controls: ['UAC.THIRD_PARTY_ACCOUNTS'],
      danzell: 'section A7',
      notApplicable: 'No supplier or provider has an account'
    }),
    requirement({
      key: 'uac_separate_admin',
      label:
        'Is administration done from separate accounts used for nothing else: no email, web browsing or everyday work?',
      controls: ['UAC.SEPARATE_ADMIN'],
      danzell: 'section A7'
    }),
    requirement({
      key: 'uac_remove_privileges',
      label:
        'Are special access privileges removed or disabled when no longer needed, such as when someone changes role?',
      controls: ['UAC.REMOVE_PRIVILEGES'],
      danzell: 'section A7'
    }),
    requirement({
      key: 'uac_mfa',
      label: 'Is multi-factor authentication used wherever it is available?',
      controls: ['UAC.MFA'],
      danzell: 'section A7'
    }),
    requirement({
      key: 'uac_mfa_cloud_users',
      label: 'Does every user sign in to every cloud service with MFA?',
      controls: ['UAC.MFA_CLOUD'],
      danzell:
        'A7.14 to A7.17, where missing MFA on a cloud service that offers it, free or paid, is an automatic fail'
    }),
    requirement({
      key: 'uac_mfa_cloud_admins',
      label:
        'Does every administrator sign in to every cloud service with MFA?',
      controls: ['UAC.MFA_CLOUD'],
      danzell:
        'A7.14 to A7.17, where missing MFA on a cloud service that offers it, free or paid, is an automatic fail'
    }),
    requirement({
      key: 'uac_mfa_password_length',
      label:
        'Is the password part of multi-factor authentication at least 8 characters, with no maximum length?',
      controls: ['UAC.MFA_PASSWORD_LENGTH'],
      danzell: 'section A7'
    }),
    requirement({
      key: 'uac_password_guessing',
      label:
        'Are passwords protected against guessing by MFA, by allowing no more than 10 attempts in 5 minutes, or by locking after no more than 10 failures?',
      controls: ['UAC.PASSWORD_BRUTE_FORCE'],
      danzell: 'section A7'
    }),
    requirement({
      key: 'uac_password_quality',
      label:
        'Is password quality enforced by MFA, a 12-character minimum, or an 8-character minimum with common passwords blocked, and with no maximum length?',
      controls: ['UAC.PASSWORD_QUALITY'],
      danzell: 'section A7'
    }),
    requirement({
      key: 'uac_password_support',
      label:
        'Are people helped to choose unique passwords, without forced expiry or complexity rules?',
      controls: ['UAC.PASSWORD_SUPPORT'],
      danzell: 'section A7',
      help: 'Telling them what to avoid, encouraging several words, and giving them somewhere safe to keep passwords.'
    }),
    requirement({
      key: 'uac_compromised',
      label:
        'Is there a process to change a password promptly when it, or its account, is known or suspected to be compromised?',
      controls: ['UAC.COMPROMISED_PASSWORDS'],
      danzell: 'section A7'
    })
  ]
};

const MALWARE_PROTECTION: Section = {
  key: 'malware_protection',
  title: 'Malware protection',
  questions: [
    requirement({
      key: 'mp_every_device',
      label:
        'Does every device in scope have at least one active form of malware protection, anti-malware software or application allow listing, kept up to date?',
      controls: ['MP.ACTIVE_ON_EVERY_DEVICE'],
      danzell: 'section A8'
    }),
    requirement({
      key: 'mp_anti_malware',
      label:
        'Where anti-malware software is used, is it updated as the vendor recommends, does it stop malicious code running, and does it block malicious websites?',
      controls: ['MP.ANTI_MALWARE'],
      danzell: 'section A8',
      notApplicable: 'No device relies on anti-malware software'
    }),
    requirement({
      key: 'mp_allow_listing',
      label:
        'Where application allow listing is used, do only approved, code-signed applications run, from a list kept current?',
      controls: ['MP.ALLOW_LISTING'],
      danzell: 'section A8',
      notApplicable: 'No device relies on allow listing'
    })
  ]
};

export const CYBER_ESSENTIALS_READINESS: TemplateDefinition = {
  schema: {
    sections: [
      ORGANISATION,
      SCOPE,
      FIREWALLS,
      SECURE_CONFIGURATION,
      UPDATE_MANAGEMENT,
      USER_ACCESS_CONTROL,
      MALWARE_PROTECTION
    ]
  },
  scoring: {
    method: 'requirements',
    framework: readinessFramework(EDITION),
    bands: [
      { min: 0, max: 0, label: 'Ready to apply', tier: 'low' },
      {
        min: 1,
        max: 3,
        label: 'Not ready: a few requirements to meet',
        tier: 'medium'
      },
      { min: 4, max: 999, label: 'Not ready', tier: 'high' }
    ],
    autoFailBand: {
      min: 0,
      max: 999,
      label: 'Not ready: an automatic fail',
      tier: 'critical'
    }
  },
  // Certificates run for 12 months, so readiness comes round before renewal.
  reviewIntervalMonths: 12
};
