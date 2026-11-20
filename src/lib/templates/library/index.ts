import type { AiFrameworkId } from '@/lib/ai-frameworks';
import type { TemplateKind } from '@/services/templates';

import type { TemplateDefinition } from '../schema';
import { AI_RISK } from './ai-risk';
import { AI_SUPPLIER } from './ai-supplier';
import { BREACH_SEVERITY } from './breach';
import { CNIL_PIA } from './cnil-pia';
import { CYBER_ESSENTIALS_READINESS } from './cyber-essentials-readiness';
import { DPIA } from './dpia';
import { DPIA_PART3 } from './dpia-part3';
import { DSIT_AI_RISK } from './dsit-ai-risk';
import { EIA } from './eia';
import { IE_PROVIDER_DUTIES } from './ie-provider';
import { LIA } from './lia';
import { NIST_AI_RISK } from './nist-ai-risk';
import { SCREENING } from './screening';
import {
  DUE_DILIGENCE_NAMES,
  SUPPLIER_DUE_DILIGENCE_FULL,
  SUPPLIER_DUE_DILIGENCE_LIGHT
} from './supplier-due-diligence';
import { TIA_EU, TRA_UK } from './transfers';
import { TRA_PART3 } from './transfers-part3';

export { LEGAL_REFERENCES } from './legal-references';

/** The readiness template a scope starts its assessment from. */
export const CYBER_ESSENTIALS_READINESS_NAME =
  'Cyber Essentials readiness (v3.3, Danzell)';

/**
 * The parts of Govern a shipped template belongs to, as `programmeScope`
 * derives them: data privacy where some entity is under UK or EU data
 * protection law, AI governance always, and cyber security once Cyber
 * Essentials is turned on.
 */
export const TEMPLATE_PROGRAMMES = ['privacy', 'ai', 'cyber'] as const;
export type TemplateProgramme = (typeof TEMPLATE_PROGRAMMES)[number];

export const TEMPLATE_PROGRAMME_LABEL: Record<TemplateProgramme, string> = {
  privacy: 'data privacy',
  ai: 'AI governance',
  cyber: 'cyber security'
};

/**
 * Templates Waivern ships and keeps current. A client may copy one and diverge,
 * but editing ours in place would put their changes at risk the next time we
 * update it — so the copy is the supported route.
 */
export const SYSTEM_TEMPLATES: Array<{
  kind: TemplateKind;
  name: string;
  description: string;
  jurisdiction?: string;
  /** The programme it serves. Required, so a new template cannot go unfiled. */
  programme: TemplateProgramme;
  /**
   * The law it is written for: a UK template (the DPA 2018, the ICO's method,
   * UK procurement or the equality duty) or an EU one (the EDPB's or the
   * CNIL's method, Irish law). Shown by default only where some entity is
   * subject to that law; without one it is shown wherever its programme is.
   */
  law?: 'uk' | 'eu';
  /**
   * Installed only for an organisation following this AI governance
   * framework. Templates without one go to everyone.
   */
  aiFramework?: AiFrameworkId;
  /** Installed only for an organisation with an entity that is a competent authority (Part 3). */
  competentAuthority?: boolean;
  /** Installed only where some entity is a provider of electronic communications services in Ireland. */
  irishProvider?: true;
  /**
   * A UK data protection template — built on the UK GDPR and the Data
   * Protection Act 2018 — installed only where some entity is subject to UK law.
   */
  ukLaw?: true;
  /** Installed only for an organisation that has taken up Cyber Essentials. */
  cyberEssentials?: true;
  definition: TemplateDefinition;
}> = [
  {
    kind: 'screening',
    name: 'DPIA screening questionnaire',
    description:
      'Short triage deciding whether a full DPIA is required, under the UK GDPR, the EU GDPR or both.',
    jurisdiction: 'UK and EU',
    programme: 'privacy',
    definition: SCREENING
  },
  {
    kind: 'dpia',
    name: 'Data protection impact assessment',
    description:
      'Full DPIA covering the minimum content required by Article 35(7).',
    jurisdiction: 'UK',
    ukLaw: true,
    programme: 'privacy',
    law: 'uk',
    definition: DPIA
  },
  {
    kind: 'dpia',
    name: 'Data protection impact assessment (law enforcement, Part 3)',
    description:
      "For a competent authority's law enforcement processing (Data Protection Act 2018 s.64): the purpose, sensitive processing and Schedule 8, categories of data subject, fact and opinion, logging and rights restrictions.",
    jurisdiction: 'UK',
    competentAuthority: true,
    programme: 'privacy',
    law: 'uk',
    definition: DPIA_PART3
  },
  {
    kind: 'dpia',
    name: 'Data protection impact assessment (CNIL method)',
    description:
      "The CNIL's PIA structure - context, fundamental principles, three feared events, validation.",
    jurisdiction: 'EU',
    programme: 'privacy',
    law: 'eu',
    definition: CNIL_PIA
  },
  {
    kind: 'lia',
    name: 'Legitimate interests assessment',
    description:
      "Whether an Annex 1 recognised legitimate interest applies (UK GDPR Article 6(1)(ea)), and if not the three-part test under Article 6(1)(f): purpose, necessity, and the balance against data subjects' rights.",
    jurisdiction: 'UK',
    ukLaw: true,
    programme: 'privacy',
    law: 'uk',
    definition: LIA
  },
  {
    kind: 'tra',
    name: 'Transfer risk assessment (UK)',
    description:
      "UK international transfer assessment following the ICO's TRA structure.",
    jurisdiction: 'UK',
    ukLaw: true,
    programme: 'privacy',
    law: 'uk',
    definition: TRA_UK
  },
  {
    kind: 'tra',
    name: 'Transfer assessment (law enforcement, Part 3)',
    description:
      "For a competent authority's law enforcement transfers (Data Protection Act 2018 ss.73–78): the three conditions, regulations, appropriate safeguards and the data protection test, special circumstances, s.77 recipients, records and the Commission, onward transfers and s.78A.",
    jurisdiction: 'UK',
    competentAuthority: true,
    programme: 'privacy',
    law: 'uk',
    definition: TRA_PART3
  },
  {
    kind: 'tia',
    name: 'Transfer impact assessment (EU)',
    description: "EU transfer assessment following the EDPB's six-step method.",
    jurisdiction: 'EU',
    programme: 'privacy',
    law: 'eu',
    definition: TIA_EU
  },
  {
    kind: 'custom',
    name: 'Electronic communications provider duties (Ireland)',
    description:
      'A checklist of what the Irish ePrivacy Regulations (S.I. 336/2011) ask of a provider of a publicly available network or service: security, traffic and location data, billing, line identification, forwarding, directories, the National Directory Database and access-request procedures.',
    jurisdiction: 'IE',
    irishProvider: true,
    programme: 'privacy',
    law: 'eu',
    definition: IE_PROVIDER_DUTIES
  },
  {
    kind: 'breach',
    name: 'Breach severity assessment',
    description:
      'The factors in WP250, which the ICO and the EDPB both follow, for judging whether a breach must be reported, and whether the people affected must be told. Under the UK GDPR, the EU GDPR or both.',
    jurisdiction: 'UK and EU',
    programme: 'privacy',
    definition: BREACH_SEVERITY
  },
  {
    kind: 'ai_risk',
    name: 'AI risk assessment',
    description:
      'Covers predictive, generative and agentic systems, with structured bias and fairness assessment.',
    programme: 'ai',
    definition: AI_RISK
  },
  {
    kind: 'ai_risk',
    name: 'AI risk identification (DSIT toolkit)',
    description:
      "The nine risk categories of DSIT's AI Risk Management Toolkit, with the UK government AI Playbook's expectations on transparency, oversight and security.",
    jurisdiction: 'UK',
    aiFramework: 'uk_dsit',
    programme: 'ai',
    definition: DSIT_AI_RISK
  },
  {
    kind: 'ai_risk',
    name: 'AI risk identification (NIST AI RMF)',
    description:
      'NIST AI RMF 1.0: context, categorisation, benefits, third parties and impacts from Map, each characteristic of trustworthy AI from Measure, and the go or no-go determination from Manage.',
    jurisdiction: 'US',
    aiFramework: 'nist_ai_rmf',
    programme: 'ai',
    definition: NIST_AI_RISK
  },
  {
    kind: 'supplier_record',
    name: 'AI supplier assessment',
    description:
      "What a supplier's AI does with our data, how it was tested, and what the contract holds them to - following PPN 02/24 and the Crown Commercial Service's data ethics requirements.",
    jurisdiction: 'UK',
    programme: 'ai',
    law: 'uk',
    definition: AI_SUPPLIER
  },
  {
    kind: 'supplier_record',
    name: DUE_DILIGENCE_NAMES.light,
    description:
      'Security and privacy due diligence for medium and low tier suppliers: what data they get, where it is processed, sub-processors, certifications held, breach notification and a contact. Under UK GDPR Articles 28 and 32, with the EU GDPR where it applies.',
    jurisdiction: 'UK and EU',
    programme: 'privacy',
    definition: SUPPLIER_DUE_DILIGENCE_LIGHT
  },
  {
    kind: 'supplier_record',
    name: DUE_DILIGENCE_NAMES.full,
    description:
      'Security and privacy due diligence for critical and high tier suppliers: the light questions, plus access control, encryption, vulnerability management and testing, continuity, staff vetting, logging, international transfers, Article 28 terms and deletion at the end of the contract.',
    jurisdiction: 'UK and EU',
    programme: 'privacy',
    definition: SUPPLIER_DUE_DILIGENCE_FULL
  },
  {
    kind: 'eia',
    name: 'Equality impact assessment',
    description:
      "The public sector equality duty's three aims, and the impact on each protected characteristic - including how an AI system performs across them.",
    jurisdiction: 'UK',
    programme: 'ai',
    law: 'uk',
    definition: EIA
  },
  {
    kind: 'cyber_essentials',
    name: CYBER_ESSENTIALS_READINESS_NAME,
    description:
      "Readiness of a certification scope against NCSC's Cyber Essentials requirements v3.3, in the order of IASME's Danzell question set: firewalls, secure configuration, security update management, user access control and malware protection. Each question cites the requirement it tests; an automatic fail makes the outcome not ready.",
    jurisdiction: 'UK',
    cyberEssentials: true,
    programme: 'cyber',
    definition: CYBER_ESSENTIALS_READINESS
  }
];

/** What an organisation is, as far as which shipped templates it is offered. */
export type TemplateAudience = {
  aiFramework: AiFrameworkId;
  /** Some entity is a competent authority (Part 3). */
  competentAuthority: boolean;
  /** Some entity is subject to UK law, or there is no entity yet. */
  ukLaw: boolean;
  /** Some entity provides electronic communications services in Ireland. */
  irishProvider: boolean;
  /** The organisation has taken up Cyber Essentials. */
  cyberEssentials: boolean;
};

/**
 * Whether an organisation is offered a shipped template. The one place each
 * template's audience is decided: the install, the update offer and the tests
 * all ask here, so a new kind of audience is one change.
 */
export function offeredTo(
  t: (typeof SYSTEM_TEMPLATES)[number],
  o: TemplateAudience
): boolean {
  return (
    (t.aiFramework === undefined || t.aiFramework === o.aiFramework) &&
    // The Part 3 templates, once an entity is a competent authority.
    (!t.competentAuthority || o.competentAuthority) &&
    // The Irish provider checklist, once an entity is a provider in Ireland.
    (!t.irishProvider || o.irishProvider) &&
    // UK data protection templates, once an entity is subject to UK law.
    (!t.ukLaw || o.ukLaw) &&
    // Cyber Essentials readiness, once the organisation has taken it up.
    (!t.cyberEssentials || o.cyberEssentials)
  );
}

/**
 * What an organisation has declared, as far as which templates in its library
 * are shown by default. The install audience, plus the programmes in scope.
 */
export type TemplateRelevance = TemplateAudience & {
  /** Some entity is subject to UK or EU data protection law. */
  privacy: boolean;
  /** Some entity is subject to EU law. */
  euLaw: boolean;
};

/**
 * Whether a shipped template is shown by default in an organisation's library.
 *
 * Presentation only: everything installed stays reachable, and the library
 * shows the rest on request. A template is relevant when the organisation
 * would be offered it today, its programme is in scope, and some entity is
 * subject to the law it is written for.
 */
export function relevantTo(
  t: (typeof SYSTEM_TEMPLATES)[number],
  o: TemplateRelevance
): boolean {
  const programme = {
    privacy: o.privacy,
    ai: true,
    cyber: o.cyberEssentials
  }[t.programme];
  const law = t.law === undefined || (t.law === 'uk' ? o.ukLaw : o.euLaw);
  return programme && law && offeredTo(t, o);
}
