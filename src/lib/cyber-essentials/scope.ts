import type { CeScopeRule } from './types';

/**
 * What a Cyber Essentials scope must and may contain, from section D (C in
 * v3.2) of NCSC's requirements. The scope is agreed with the certification
 * body before assessment, and the certificate covers only what is in it.
 */
export const CE_SCOPE_RULES: readonly CeScopeRule[] = [
  {
    code: 'SCOPE.BOUNDARY',
    summary:
      'A scope covers the whole IT infrastructure, or a well-defined, separately managed sub-set, with its business unit, network boundary and location stated.',
    pages: { 'v3.2': 6, 'v3.3': 6 }
  },
  {
    code: 'SCOPE.SUBSET_SEGREGATED',
    summary:
      'A sub-set is separated from the rest of the organisation by a firewall or VLAN, and leaving anything out of scope is justified to the assessor.',
    pages: { 'v3.2': 6, 'v3.3': 6 },
    earlier: {
      'v3.2':
        'A sub-set is separated from the rest of the organisation by a firewall or VLAN.'
    }
  },
  {
    code: 'SCOPE.INTERNET_CONNECTED',
    summary:
      'The requirements apply to in-scope devices and software that can accept connections from the internet, can connect out to it, or control traffic between such devices and the internet.',
    pages: { 'v3.2': 6, 'v3.3': 6 },
    earlier: {
      'v3.2':
        'The requirements apply to in-scope devices and software that can accept connections from untrusted internet-connected hosts, can make user-initiated connections out to the internet, or control traffic between such devices and the internet.'
    }
  },
  {
    code: 'SCOPE.END_USER_DEVICES',
    summary: 'A scope must include end-user devices.',
    pages: { 'v3.2': 6, 'v3.3': 7 }
  },
  {
    code: 'SCOPE.CLOUD_INCLUDED',
    summary:
      "Cloud services that hold the organisation's data or run its services are in scope and cannot be excluded.",
    pages: { 'v3.2': 9, 'v3.3': 7 },
    earlier: {
      'v3.2':
        "Cloud services that hold the organisation's data or run its services must be in scope."
    }
  },
  {
    code: 'SCOPE.BYOD',
    summary:
      "Devices staff own that reach the organisation's data or services are in scope, unless used only for native calls, native texts or an MFA app.",
    pages: { 'v3.2': 8, 'v3.3': 8 }
  },
  {
    code: 'SCOPE.HOME_WORKING',
    summary:
      'Devices used for work at home or remotely are in scope, and so is a router the organisation supplies. Any other home router is out, so the device needs its own firewall; on a corporate VPN, the boundary is the company firewall.',
    pages: { 'v3.2': 8, 'v3.3': 9 }
  },
  {
    code: 'SCOPE.WIRELESS',
    summary:
      'Wireless devices, access points included, are in scope if they can talk to other devices over the internet, and out if they can only be attacked from within signal range or are part of a home ISP router.',
    pages: { 'v3.2': 9, 'v3.3': 9 }
  },
  {
    code: 'SCOPE.THIRD_PARTY_ACCOUNTS',
    summary:
      'Every account the organisation owns is in scope, including those suppliers or managed service providers use, and externally managed services must be shown to meet the controls.',
    pages: { 'v3.2': 10, 'v3.3': 11 }
  },
  {
    code: 'SCOPE.THIRD_PARTY_DEVICES',
    summary:
      "The organisation's devices are in scope wherever they are, including those lent to others. Devices owned by a managed service provider, contractor or customer are out, as are students' own devices.",
    pages: { 'v3.2': 11, 'v3.3': 11 }
  },
  {
    code: 'SCOPE.WEB_APPLICATIONS',
    summary:
      'Commercial web applications anyone can buy are in scope by default; bespoke components the organisation builds are out, and are better covered by the Software Security Code of Practice.',
    pages: { 'v3.2': 11, 'v3.3': 12 },
    earlier: {
      'v3.2':
        "Commercial web applications anyone can buy are in scope by default; bespoke components the organisation builds are out, and are better covered by OWASP's Application Security Verification Standard."
    }
  }
];

/**
 * Why an asset may be out of a scope, each traced to the rule that allows it.
 * Anything else needs a note, because the assessor will ask.
 */
export const OUT_OF_SCOPE_REASONS = [
  {
    value: 'subset_segregated',
    label: 'In a segregated sub-set',
    rule: 'SCOPE.SUBSET_SEGREGATED'
  },
  {
    value: 'no_internet_connectivity',
    label: 'Cannot reach or be reached from the internet',
    rule: 'SCOPE.INTERNET_CONNECTED'
  },
  {
    value: 'byod_voice_text_mfa_only',
    label: 'Own device used only for calls, texts or an MFA app',
    rule: 'SCOPE.BYOD'
  },
  {
    value: 'third_party_owned',
    label: 'Owned by a managed service provider, contractor or customer',
    rule: 'SCOPE.THIRD_PARTY_DEVICES'
  },
  {
    value: 'student_byod',
    label: "A student's own device",
    rule: 'SCOPE.THIRD_PARTY_DEVICES'
  },
  {
    value: 'home_router_not_supplied',
    label: 'A home router the organisation did not supply',
    rule: 'SCOPE.HOME_WORKING'
  },
  {
    value: 'bespoke_application_component',
    label: 'A bespoke component of a web application',
    rule: 'SCOPE.WEB_APPLICATIONS'
  },
  { value: 'other', label: 'Other (explain why)', rule: null }
] as const;

export type OutOfScopeReason = (typeof OUT_OF_SCOPE_REASONS)[number]['value'];
