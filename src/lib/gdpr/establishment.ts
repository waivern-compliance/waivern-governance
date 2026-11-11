/**
 * Where an entity is established, who represents it, and which authority
 * supervises it, for each law it is subject to.
 *
 * Pure. The UK GDPR and the EU GDPR both apply in two ways (Article 3): to
 * processing in the context of an establishment there, and to a controller
 * established elsewhere that offers goods or services to, or monitors, people
 * there. The second kind must designate a representative (Article 27), unless
 * its processing is occasional and low-risk or it is a public body (27(2)). In
 * the EU a representative must be in a member State where the people are
 * (27(3)); the UK omitted that paragraph.
 *
 * Under the EU GDPR, an entity established in more than one member State, or
 * whose processing substantially affects people in more than one, deals with
 * one lead authority: that of its main establishment (Articles 4(16), 4(23),
 * 56(1)). Which establishment is the main one, and so which authority leads, is
 * a judgement (EDPB Guidelines 8/2022), so it is recorded by a person; Govern
 * suggests and checks it, never decides it.
 */

import type { DataProtectionLaw } from '@/lib/dpa2018/applies';

import {
  authoritiesIn,
  authorityByCode,
  EEA_STATES,
  isEeaState,
  type SupervisoryAuthority
} from './authorities';

export type Representative = {
  name: string;
  /** How to reach them: an address or a mailbox. */
  contact: string;
  /** For an EU representative, the member State it is established in. */
  country: string | null;
};

export type RepresentativeExemption = 'occasional' | 'public_body';

export const REPRESENTATIVE_EXEMPTIONS: Record<
  RepresentativeExemption,
  string
> = {
  occasional:
    'Article 27(2)(a): processing is occasional, does not include large-scale special category or criminal offence data, and is unlikely to result in a risk',
  public_body: 'Article 27(2)(b): a public authority or body'
};

export function isRepresentativeExemption(
  v: unknown
): v is RepresentativeExemption {
  return typeof v === 'string' && v in REPRESENTATIVE_EXEMPTIONS;
}

export type Establishment = {
  ukEstablishment: boolean;
  euEstablishments: string[];
  euMainEstablishment: string | null;
  euLeadAuthority: string | null;
  euRepresentative: Representative | null;
  euRepresentativeExemption: RepresentativeExemption | null;
  ukRepresentative: Representative | null;
  ukRepresentativeExemption: RepresentativeExemption | null;
  euPublicBody: boolean;
};

export class EstablishmentRefused extends Error {}

function cleanRepresentative(
  input: Partial<Representative> | null | undefined,
  eu: boolean
): Representative | null {
  const name = input?.name?.trim() ?? '';
  const contact = input?.contact?.trim() ?? '';
  const country = input?.country?.trim().toUpperCase() || null;
  if (!name && !contact) return null;
  const which = eu ? 'EU' : 'UK';
  if (!name)
    throw new EstablishmentRefused(`Name the ${which} representative.`);
  if (!contact)
    throw new EstablishmentRefused(
      `Give a way to contact the ${which} representative.`
    );
  if (eu) {
    if (!country || !isEeaState(country))
      throw new EstablishmentRefused(
        'Say which member State the EU representative is established in (Article 27(3)).'
      );
    return { name, contact, country };
  }
  return { name, contact, country: null };
}

/**
 * The record as it will be stored, for an entity under `law`. Answers about a
 * law the entity is not subject to are refused rather than kept, so the record
 * never says something about a regime that does not apply.
 */
export function cleanEstablishment(
  law: DataProtectionLaw,
  input: {
    ukEstablishment?: boolean;
    euEstablishments?: readonly string[];
    euMainEstablishment?: string | null;
    euLeadAuthority?: string | null;
    euRepresentative?: Partial<Representative> | null;
    euRepresentativeExemption?: string | null;
    ukRepresentative?: Partial<Representative> | null;
    ukRepresentativeExemption?: string | null;
    euPublicBody?: boolean;
  }
): Establishment {
  const uk = law !== 'eu';
  const eu = law !== 'uk';
  const states = [
    ...new Set((input.euEstablishments ?? []).map((s) => s.toUpperCase()))
  ];
  const unknown = states.filter((s) => !isEeaState(s));
  if (unknown.length > 0)
    throw new EstablishmentRefused(
      `Not an EEA member State: ${unknown.join(', ')}.`
    );
  const main = input.euMainEstablishment?.toUpperCase() || null;
  const lead = input.euLeadAuthority || null;
  const euRep = cleanRepresentative(input.euRepresentative, true);
  const ukRep = cleanRepresentative(input.ukRepresentative, false);
  const euExemption = input.euRepresentativeExemption || null;
  const ukExemption = input.ukRepresentativeExemption || null;

  if (!eu) {
    if (
      states.length > 0 ||
      main ||
      lead ||
      euRep ||
      euExemption ||
      input.euPublicBody
    ) {
      throw new EstablishmentRefused(
        'The EU establishment, lead authority, representative and public body settings are EU law, and this entity is subject to UK law only.'
      );
    }
  }
  if (!uk && (ukRep || ukExemption)) {
    throw new EstablishmentRefused(
      'The UK representative is UK law, and this entity is subject to EU law only.'
    );
  }
  // An establishment in the UK brings the UK GDPR with it (Article 3(1)), so an
  // entity under EU law only is, by that record, not established there.
  if (!uk && input.ukEstablishment === true) {
    throw new EstablishmentRefused(
      'An entity established in the UK is subject to the UK GDPR (Article 3(1)). Record it as subject to both laws first.'
    );
  }
  if (main && !states.includes(main))
    throw new EstablishmentRefused(
      'The main establishment must be one of the EU establishments.'
    );
  if (lead) {
    const authority = authorityByCode(lead);
    if (!authority || authority.law !== 'eu')
      throw new EstablishmentRefused('Choose an EU supervisory authority.');
    // The one-stop shop needs an establishment in the EU (Article 56(1));
    // without one every authority where people are affected is competent.
    if (states.length === 0)
      throw new EstablishmentRefused(
        'A lead authority is for an entity established in the EU (Article 56(1)). With no EU establishment there is none; tick where it is established, or clear the lead authority.'
      );
    const home = main ?? (states.length === 1 ? states[0] : null);
    if (home && authority.country !== home)
      throw new EstablishmentRefused(
        `The lead authority is the authority of the main establishment (Article 56(1)), which is in ${EEA_STATES[home]}.`
      );
    if (!home && !states.includes(authority.country))
      throw new EstablishmentRefused(
        `The lead authority is the authority of the main establishment (Article 56(1)), and ${EEA_STATES[authority.country]} is not among the EU establishments.`
      );
  }
  if (euExemption && !isRepresentativeExemption(euExemption))
    throw new EstablishmentRefused('That is not an Article 27(2) exemption.');
  if (ukExemption && !isRepresentativeExemption(ukExemption))
    throw new EstablishmentRefused('That is not an Article 27(2) exemption.');

  return {
    ukEstablishment: uk ? (input.ukEstablishment ?? true) : false,
    euEstablishments: states,
    euMainEstablishment: main,
    euLeadAuthority: lead,
    euRepresentative: euRep,
    euRepresentativeExemption: euExemption as RepresentativeExemption | null,
    ukRepresentative: ukRep,
    ukRepresentativeExemption: ukExemption as RepresentativeExemption | null,
    euPublicBody: eu && (input.euPublicBody ?? false)
  };
}

/** The member State whose authority would lead: the main establishment, or the only one. */
export function homeState(e: Establishment): string | null {
  return (
    e.euMainEstablishment ??
    (e.euEstablishments.length === 1 ? e.euEstablishments[0] : null)
  );
}

/**
 * The authority to suggest as lead: that of the home State, where it has only
 * one. Germany has one per Land, so a person chooses.
 */
export function suggestedLeadAuthority(
  e: Establishment
): SupervisoryAuthority | null {
  const home = homeState(e);
  if (!home) return null;
  const there = authoritiesIn(home);
  return there.length === 1 ? there[0] : null;
}

export type EstablishmentGap =
  | 'eu_representative'
  | 'eu_main_establishment'
  | 'eu_lead_authority'
  | 'uk_representative';

export const ESTABLISHMENT_GAP_WORDS: Record<EstablishmentGap, string> = {
  eu_representative:
    'Subject to EU law with no EU establishment, and no EU representative or Article 27(2) exemption recorded',
  eu_main_establishment:
    'Established in more than one member State, with no main establishment recorded (Article 4(16))',
  eu_lead_authority:
    'An EU establishment with no lead supervisory authority recorded (Article 56(1))',
  uk_representative:
    'Subject to UK law with no UK establishment, and no UK representative or Article 27(2) exemption recorded'
};

/** What the record does not yet show, for the laws the entity is subject to. */
export function establishmentGaps(
  law: DataProtectionLaw,
  e: Establishment
): EstablishmentGap[] {
  const gaps: EstablishmentGap[] = [];
  if (law !== 'uk') {
    if (
      e.euEstablishments.length === 0 &&
      !e.euRepresentative &&
      !e.euRepresentativeExemption
    )
      gaps.push('eu_representative');
    if (e.euEstablishments.length > 1 && !e.euMainEstablishment)
      gaps.push('eu_main_establishment');
    if (homeState(e) && !e.euLeadAuthority) gaps.push('eu_lead_authority');
  }
  if (
    law !== 'eu' &&
    !e.ukEstablishment &&
    !e.ukRepresentative &&
    !e.ukRepresentativeExemption
  )
    gaps.push('uk_representative');
  return gaps;
}

/**
 * Who a person may complain to about the entity, under one law. `complainTo`
 * reads after "complain to"; `short` names the authority the organisation
 * deals with, in a label such as "Contact with ...".
 *
 * UK law: the Information Commission. EU law: a person may complain to any
 * supervisory authority, in particular in the member State where they live or
 * work or where the alleged infringement took place (Article 77(1)), so that
 * right is what `complainTo` says; the authority the organisation deals with
 * (the recorded lead authority, else the one authority of the only or main
 * establishment's State) is named alongside it and in `short`.
 */
export function regulatorFor(
  jurisdiction: 'uk' | 'eu',
  e: Pick<
    Establishment,
    'euLeadAuthority' | 'euEstablishments' | 'euMainEstablishment'
  >
): {
  complainTo: string;
  short: string;
  authority: SupervisoryAuthority | null;
} {
  if (jurisdiction === 'uk')
    return {
      complainTo: 'the Information Commission',
      short: 'the Information Commission',
      authority: authorityByCode('gb-ico')
    };
  const home =
    e.euMainEstablishment ??
    (e.euEstablishments.length === 1 ? e.euEstablishments[0] : null);
  const there = home ? authoritiesIn(home) : [];
  const authority =
    authorityByCode(e.euLeadAuthority) ??
    (there.length === 1 ? there[0] : null);
  const anywhere =
    'a data protection supervisory authority, in particular in the member State where they live or work or where the alleged infringement took place';
  return authority
    ? {
        complainTo: `${anywhere} (the lead authority for this organisation is ${authority.name})`,
        short: authority.name,
        authority
      }
    : {
        complainTo: anywhere,
        short: 'a supervisory authority',
        authority: null
      };
}
