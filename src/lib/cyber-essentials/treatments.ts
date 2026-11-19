import type { TreatmentSuggestion } from '@/lib/risk/treatment-library';

import { formatControlRef } from './control-ref';
import { CE_EDITIONS } from './editions';

/** The edition the suggestions point at: the latest Govern holds. */
const EDITION = CE_EDITIONS[CE_EDITIONS.length - 1].id;

const ref = (code: string) => formatControlRef(EDITION, code);

/**
 * Treatments for a cyber security risk, one per Cyber Essentials theme.
 *
 * The themes describe controls, not harm, so they are where a mitigation
 * comes from rather than what a risk is filed under. Each fills in the
 * requirement it puts in place (`control_ref`). On a risk raised from a
 * scope's status page, which links the risk to the scope, that page reads it
 * back as evidence once the mitigation is verified; Govern does not guess
 * which scope a risk raised elsewhere is about. Like every suggestion,
 * nothing is added until a person chooses it.
 *
 * Paraphrased from NCSC's Cyber Essentials requirements, Open Government
 * Licence v3.0.
 */
export const CE_TREATMENTS: readonly TreatmentSuggestion[] = [
  {
    key: 'ce.firewalls',
    theme: 'Firewalls',
    categories: ['cyber_security'],
    treatment: 'limitation',
    controlRef: ref('FW.PROTECT_EVERY_DEVICE'),
    text: 'Put a correctly configured firewall in front of every device in scope, blocking inbound connections that have not been approved and documented.'
  },
  {
    key: 'ce.secure_configuration',
    theme: 'Secure configuration',
    categories: ['cyber_security'],
    treatment: 'limitation',
    controlRef: ref('SC.REMOVE_SOFTWARE'),
    text: 'Remove or disable software, services and accounts that devices do not need, and change every default password.'
  },
  {
    key: 'ce.update_management',
    theme: 'Security update management',
    categories: ['cyber_security'],
    treatment: 'limitation',
    controlRef: ref('SUM.CRITICAL_14_DAYS'),
    text: 'Install critical and high-risk security updates within 14 days of release, with automatic updates on wherever they are offered.'
  },
  {
    key: 'ce.user_access_control',
    theme: 'User access control',
    categories: ['cyber_security'],
    treatment: 'limitation',
    controlRef: ref('UAC.MFA_CLOUD'),
    text: 'Require multi-factor authentication on every cloud service, give each person their own account, and keep administrator accounts for administration only.'
  },
  {
    key: 'ce.malware_protection',
    theme: 'Malware protection',
    categories: ['cyber_security'],
    treatment: 'limitation',
    controlRef: ref('MP.ACTIVE_ON_EVERY_DEVICE'),
    text: 'Keep anti-malware software or application allow listing active and up to date on every device in scope.'
  }
];

export const CE_TREATMENT_SOURCE = {
  name: 'Cyber Essentials',
  detail:
    "From the five technical controls of NCSC's Cyber Essentials requirements. Each fills in the requirement it puts in place. To have a verified one shown as evidence for a scope, raise the risk from the scope's status by requirement page.",
  tag: 'from Cyber Essentials'
};
