/**
 * EU GDPR Article 8(1): an information society service offered directly to a
 * child, on the basis of consent. Below the age of digital consent, consent
 * must be given or authorised by whoever holds parental responsibility. The
 * Regulation sets 16 and lets each member State set a lower age, not below
 * 13, so the age depends on where the children are.
 *
 * Pure. Ages are held only where they were checked against the State's own
 * law, with the provision and where it was read (decision 7 of the EU GDPR
 * plan). A State not listed is unknown, and a record offering a service there
 * says so rather than assuming 16 or 13. Updated by a release, for every
 * client at once.
 */

import type { DataProtectionLaw } from '@/lib/dpa2018/applies';

import { EEA_STATES, isEeaState } from './authorities';
import type { LawfulBasis } from './lawful-basis';

export type DigitalConsentAge = {
  age: number;
  /** The national provision setting it, or saying nothing different. */
  provision: string;
  /** Where the provision was read. */
  source: string;
};

/** When the ages below were last checked. */
export const DIGITAL_CONSENT_AGES_REVIEWED_AT = '2026-11-11';

/**
 * Checked ages, by ISO code. A State is absent until its own law has been
 * read; see the module comment. Not yet established (official text not
 * readable when checked): Austria, Bulgaria, Cyprus, Czechia, Estonia, Greece,
 * Hungary, Iceland, Italy, Lithuania, Luxembourg, Portugal, Romania, Slovenia.
 * Pending changes seen on 11 November 2026: a Spanish bill (Congreso
 * 121/000052) raising 14 to 16, a Norwegian proposal raising 13 to 15, and an
 * Icelandic bill to 15 from August 2027.
 */
export const DIGITAL_CONSENT_AGES: Readonly<Record<string, DigitalConsentAge>> =
  {
    BE: {
      age: 13,
      provision:
        "Loi du 30 juillet 2018 relative à la protection des personnes physiques à l'égard des traitements de données à caractère personnel, art. 7",
      source:
        'https://www.ejustice.just.fgov.be/cgi_loi/change_lg.pl?language=fr&la=F&cn=2018073046&table_name=loi'
    },
    DE: {
      age: 16,
      provision:
        "Bundesdatenschutzgesetz 2018: no Article 8 provision, so the Regulation's 16 applies",
      source: 'https://www.gesetze-im-internet.de/bdsg_2018/'
    },
    DK: {
      age: 13,
      provision:
        'Databeskyttelsesloven (lov nr. 502 af 23. maj 2018), § 6(2)-(3), as enacted',
      source: 'https://www.retsinformation.dk/eli/lta/2018/502/dan/pdf'
    },
    ES: {
      age: 14,
      provision: 'Ley Orgánica 3/2018 (LOPDGDD), art. 7.1',
      source: 'https://www.boe.es/buscar/act.php?id=BOE-A-2018-16673'
    },
    FI: {
      age: 13,
      provision: 'Tietosuojalaki 1050/2018, 5 §',
      source:
        'https://opendata.finlex.fi/finlex/avoindata/v1/akn/fi/act/statute-consolidated/2018/1050/fin@'
    },
    FR: {
      age: 15,
      provision: 'Loi n° 78-17 du 6 janvier 1978, art. 45',
      source:
        'https://www.legifrance.gouv.fr/loda/article_lc/LEGIARTI000037823135/2026-11-11'
    },
    HR: {
      age: 16,
      provision:
        'Zakon o provedbi Opće uredbe o zaštiti podataka (NN 42/2018), čl. 19(1)',
      source: 'https://narodne-novine.nn.hr/clanci/sluzbeni/2018_05_42_805.html'
    },
    IE: {
      age: 16,
      provision: 'Data Protection Act 2018, s. 31(1)',
      source: 'https://revisedacts.lawreform.ie/eli/2018/act/7/revised/en/html'
    },
    LI: {
      age: 16,
      provision:
        "Datenschutzgesetz (LGBl. 2018 Nr. 272): no Article 8 provision, so the Regulation's 16 applies",
      source: 'https://www.gesetze.li/konso/pdf/2018272000?version=4'
    },
    LV: {
      age: 13,
      provision: 'Fizisko personu datu apstrādes likums, 33. pants',
      source:
        'https://likumi.lv/ta/id/300099-fizisko-personu-datu-apstrades-likums'
    },
    MT: {
      age: 13,
      provision:
        "S.L. 586.11 (Processing of Child's Personal Data in relation to the Offer of Information Society Services Regulations), reg. 4",
      source: 'https://legislation.mt/eli/sl/586.11/eng/pdf'
    },
    NL: {
      age: 16,
      provision:
        "Uitvoeringswet AVG: no lower Article 8 age, so the Regulation's 16 applies",
      source: 'https://wetten.overheid.nl/BWBR0040940/'
    },
    NO: {
      age: 13,
      provision: 'Personopplysningsloven (LOV-2018-06-15-38), § 5',
      source: 'https://lovdata.no/dokument/NL/lov/2018-06-15-38/%C2%A75'
    },
    PL: {
      age: 16,
      provision:
        "Ustawa z 10 maja 2018 o ochronie danych osobowych: no Article 8 provision, so the Regulation's 16 applies",
      source: 'https://api.sejm.gov.pl/eli/acts/DU/2019/1781/text.html'
    },
    SE: {
      age: 13,
      provision: 'Lag (2018:218), 2 kap. 4 §',
      source:
        'https://www.riksdagen.se/sv/dokument-och-lagar/dokument/svensk-forfattningssamling/lag-2018218-med-kompletterande-bestammelser-till_sfs-2018-218/'
    },
    SK: {
      age: 16,
      provision: 'Zákon č. 18/2018 Z. z., § 15(1)',
      source: 'https://static.slov-lex.sk/static/SK/ZZ/2018/18/20260818.html'
    }
  };

/** The checked age for a member State, or null where it is not established. */
export function digitalConsentAge(code: string): DigitalConsentAge | null {
  return DIGITAL_CONSENT_AGES[code.toUpperCase()] ?? null;
}

export type ChildrenGap = 'children_age_unknown' | 'children_parental_consent';

export const CHILDREN_GAP_WORDS: Record<ChildrenGap, string> = {
  children_age_unknown:
    'Offered to children on consent in a member State whose age of digital consent Govern has not established (Article 8(1))',
  children_parental_consent:
    'Offered to children on consent in a member State whose age of digital consent is above 13: below it, a parent must give or authorise consent (Article 8(1))'
};

/** Whether Article 8(1) is engaged: EU law, consent, and States named. */
function engaged(input: {
  laws: DataProtectionLaw;
  lawfulBases: readonly LawfulBasis[];
  childrenMemberStates: readonly string[];
}): boolean {
  return (
    input.laws !== 'uk' &&
    input.lawfulBases.includes('consent') &&
    input.childrenMemberStates.length > 0
  );
}

/** Each State named, with its age where it is established. */
export function childrenAges(
  states: readonly string[]
): Array<{ code: string; name: string; age: DigitalConsentAge | null }> {
  return [...new Set(states.map((s) => s.toUpperCase()))]
    .filter(isEeaState)
    .sort()
    .map((code) => ({
      code,
      name: EEA_STATES[code],
      age: digitalConsentAge(code)
    }));
}

/** What a record offering a service to children on consent needs to show. */
export function childrenConsentGaps(input: {
  laws: DataProtectionLaw;
  lawfulBases: readonly LawfulBasis[];
  childrenMemberStates: readonly string[];
}): ChildrenGap[] {
  if (!engaged(input)) return [];
  const ages = childrenAges(input.childrenMemberStates);
  const gaps: ChildrenGap[] = [];
  if (ages.some((a) => a.age === null)) gaps.push('children_age_unknown');
  if (ages.some((a) => a.age !== null && a.age.age > 13))
    gaps.push('children_parental_consent');
  return gaps;
}

export class ChildrenStatesRefused extends Error {}

/** The States as stored: EEA codes, upper case, once each. */
export function cleanChildrenStates(states: readonly string[]): string[] {
  const codes = [...new Set(states.map((s) => s.trim().toUpperCase()))].filter(
    Boolean
  );
  const unknown = codes.filter((c) => !isEeaState(c));
  if (unknown.length > 0)
    throw new ChildrenStatesRefused(
      `Not an EEA member State: ${unknown.join(', ')}.`
    );
  return codes.sort();
}
