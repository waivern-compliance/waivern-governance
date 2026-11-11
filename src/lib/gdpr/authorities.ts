/**
 * The data protection supervisory authorities: the UK's, and one or more for
 * each member State of the European Economic Area (the EU GDPR applies in
 * Iceland, Liechtenstein and Norway through the EEA Agreement).
 *
 * A list in code rather than a table: no organisation edits it, and a wrong
 * entry is fixed for every client at once by a release, which is what the
 * country library's shared rows achieve with a table and a review trail.
 *
 * Taken from the EDPB's list of its members and, for the German Länder, the
 * Federal Commissioner's list of Land authorities, both read on 11 November
 * 2026. Germany supervises the private sector by Land; Bavaria alone splits
 * it from the public sector, with a separate office (BayLDA) for businesses.
 *
 * Pure.
 */

import { EEA } from '@/lib/countries/library';

export const AUTHORITIES_REVIEWED_AT = '2026-11-11';

export const AUTHORITY_SOURCES = [
  {
    title: 'EDPB: Members',
    url: 'https://www.edpb.europa.eu/about-edpb/about-edpb/members_en'
  },
  {
    title: 'BfDI: Data protection supervisory authorities of the Länder',
    url: 'https://www.bfdi.bund.de/EN/Service/Anschriften/Laender/Laender-node.html'
  }
] as const;

export type SupervisoryAuthority = {
  /** Stable key, stored on an entity as its lead authority. */
  code: string;
  name: string;
  /** ISO 3166-1 alpha-2 of the State it supervises in. */
  country: string;
  law: 'uk' | 'eu';
  website: string;
  /** Where a State has more than one, what this one supervises. */
  scope?: string;
};

const de = (
  code: string,
  name: string,
  website: string,
  scope: string
): SupervisoryAuthority => ({
  code: `de-${code}`,
  name,
  country: 'DE',
  law: 'eu',
  website,
  scope
});

export const SUPERVISORY_AUTHORITIES: readonly SupervisoryAuthority[] = [
  {
    code: 'gb-ico',
    name: 'Information Commission',
    country: 'GB',
    law: 'uk',
    website: 'https://ico.org.uk'
  },
  {
    code: 'at-dsb',
    name: 'Österreichische Datenschutzbehörde',
    country: 'AT',
    law: 'eu',
    website: 'https://www.dsb.gv.at'
  },
  {
    code: 'be-apd',
    name: 'Autorité de la protection des données - Gegevensbeschermingsautoriteit (APD-GBA)',
    country: 'BE',
    law: 'eu',
    website: 'https://www.autoriteprotectiondonnees.be'
  },
  {
    code: 'bg-cpdp',
    name: 'Commission for Personal Data Protection',
    country: 'BG',
    law: 'eu',
    website: 'https://www.cpdp.bg'
  },
  {
    code: 'hr-azop',
    name: 'Agencija za zaštitu osobnih podataka (AZOP)',
    country: 'HR',
    law: 'eu',
    website: 'https://azop.hr'
  },
  {
    code: 'cy-dpa',
    name: 'Commissioner for Personal Data Protection (Cyprus)',
    country: 'CY',
    law: 'eu',
    website: 'https://www.gov.cy/dataprotection/'
  },
  {
    code: 'cz-uoou',
    name: 'Office for Personal Data Protection (ÚOOÚ)',
    country: 'CZ',
    law: 'eu',
    website: 'https://uoou.gov.cz'
  },
  {
    code: 'dk-dt',
    name: 'Datatilsynet (Denmark)',
    country: 'DK',
    law: 'eu',
    website: 'https://www.datatilsynet.dk'
  },
  {
    code: 'ee-aki',
    name: 'Andmekaitse Inspektsioon (Estonian Data Protection Inspectorate)',
    country: 'EE',
    law: 'eu',
    website: 'https://www.aki.ee'
  },
  {
    code: 'fi-tsv',
    name: 'Office of the Data Protection Ombudsman',
    country: 'FI',
    law: 'eu',
    website: 'https://tietosuoja.fi/en'
  },
  {
    code: 'fr-cnil',
    name: "Commission Nationale de l'Informatique et des Libertés (CNIL)",
    country: 'FR',
    law: 'eu',
    website: 'https://www.cnil.fr'
  },
  de(
    'bfdi',
    'Die Bundesbeauftragte für den Datenschutz und die Informationsfreiheit (BfDI)',
    'https://www.bfdi.bund.de',
    'Federal public bodies, and telecommunications and postal services'
  ),
  de(
    'bw',
    'Der Landesbeauftragte für den Datenschutz und die Informationsfreiheit Baden-Württemberg',
    'https://www.baden-wuerttemberg.datenschutz.de',
    'Baden-Württemberg'
  ),
  de(
    'by-lda',
    'Bayerisches Landesamt für Datenschutzaufsicht (BayLDA)',
    'https://www.lda.bayern.de',
    'Bavaria: businesses and other non-public bodies'
  ),
  de(
    'by-lfd',
    'Der Bayerische Landesbeauftragte für den Datenschutz',
    'https://www.datenschutz-bayern.de',
    'Bavaria: public bodies'
  ),
  de(
    'be',
    'Berliner Beauftragte für Datenschutz und Informationsfreiheit',
    'https://www.datenschutz-berlin.de',
    'Berlin'
  ),
  de(
    'bb',
    'Die Landesbeauftragte für den Datenschutz und für das Recht auf Akteneinsicht Brandenburg',
    'https://www.lda.brandenburg.de',
    'Brandenburg'
  ),
  de(
    'hb',
    'Der Landesbeauftragte für Datenschutz und Informationsfreiheit der Freien Hansestadt Bremen',
    'https://www.datenschutz.bremen.de',
    'Bremen'
  ),
  de(
    'hh',
    'Der Hamburgische Beauftragte für Datenschutz und Informationsfreiheit',
    'https://www.datenschutz-hamburg.de',
    'Hamburg'
  ),
  de(
    'he',
    'Der Hessische Beauftragte für Datenschutz und Informationsfreiheit',
    'https://www.datenschutz.hessen.de',
    'Hesse'
  ),
  de(
    'mv',
    'Der Landesbeauftragte für Datenschutz und Informationsfreiheit Mecklenburg-Vorpommern',
    'https://www.datenschutz-mv.de',
    'Mecklenburg-Western Pomerania'
  ),
  de(
    'ni',
    'Der Landesbeauftragte für den Datenschutz Niedersachsen',
    'https://www.lfd.niedersachsen.de',
    'Lower Saxony'
  ),
  de(
    'nw',
    'Landesbeauftragte für Datenschutz und Informationsfreiheit Nordrhein-Westfalen',
    'https://www.ldi.nrw.de',
    'North Rhine-Westphalia'
  ),
  de(
    'rp',
    'Der Landesbeauftragte für den Datenschutz und die Informationsfreiheit Rheinland-Pfalz',
    'https://www.datenschutz.rlp.de',
    'Rhineland-Palatinate'
  ),
  de(
    'sl',
    'Unabhängiges Datenschutzzentrum Saarland',
    'https://www.datenschutz.saarland.de',
    'Saarland'
  ),
  de(
    'sn',
    'Die Sächsische Datenschutzbeauftragte',
    'https://www.datenschutz.sachsen.de',
    'Saxony'
  ),
  de(
    'st',
    'Landesbeauftragte für den Datenschutz Sachsen-Anhalt',
    'https://datenschutz.sachsen-anhalt.de',
    'Saxony-Anhalt'
  ),
  de(
    'sh',
    'Unabhängiges Landeszentrum für Datenschutz Schleswig-Holstein',
    'https://www.datenschutzzentrum.de',
    'Schleswig-Holstein'
  ),
  de(
    'th',
    'Thüringer Landesbeauftragter für den Datenschutz und die Informationsfreiheit',
    'https://www.tlfdi.de',
    'Thuringia'
  ),
  {
    code: 'gr-hdpa',
    name: 'Hellenic Data Protection Authority',
    country: 'GR',
    law: 'eu',
    website: 'https://www.dpa.gr'
  },
  {
    code: 'hu-naih',
    name: 'Hungarian National Authority for Data Protection and Freedom of Information (NAIH)',
    country: 'HU',
    law: 'eu',
    website: 'https://www.naih.hu'
  },
  {
    code: 'is-pv',
    name: 'Persónuvernd (Icelandic Data Protection Authority)',
    country: 'IS',
    law: 'eu',
    website: 'https://www.personuvernd.is'
  },
  {
    code: 'ie-dpc',
    name: 'Data Protection Commission',
    country: 'IE',
    law: 'eu',
    website: 'https://www.dataprotection.ie'
  },
  {
    code: 'it-gpdp',
    name: 'Garante per la protezione dei dati personali',
    country: 'IT',
    law: 'eu',
    website: 'https://www.garanteprivacy.it'
  },
  {
    code: 'lv-dvi',
    name: 'Data State Inspectorate (Latvia)',
    country: 'LV',
    law: 'eu',
    website: 'https://www.dvi.gov.lv'
  },
  {
    code: 'li-dss',
    name: 'Data Protection Authority, Principality of Liechtenstein',
    country: 'LI',
    law: 'eu',
    website: 'https://www.datenschutzstelle.li'
  },
  {
    code: 'lt-vdai',
    name: 'State Data Protection Inspectorate (Lithuania)',
    country: 'LT',
    law: 'eu',
    website: 'https://vdai.lrv.lt'
  },
  {
    code: 'lu-cnpd',
    name: 'Commission Nationale pour la Protection des Données (Luxembourg)',
    country: 'LU',
    law: 'eu',
    website: 'https://cnpd.public.lu'
  },
  {
    code: 'mt-idpc',
    name: 'Office of the Information and Data Protection Commissioner (Malta)',
    country: 'MT',
    law: 'eu',
    website: 'https://idpc.org.mt'
  },
  {
    code: 'nl-ap',
    name: 'Autoriteit Persoonsgegevens',
    country: 'NL',
    law: 'eu',
    website: 'https://autoriteitpersoonsgegevens.nl'
  },
  {
    code: 'no-dt',
    name: 'Datatilsynet (Norway)',
    country: 'NO',
    law: 'eu',
    website: 'https://www.datatilsynet.no'
  },
  {
    code: 'pl-uodo',
    name: 'Urząd Ochrony Danych Osobowych (Personal Data Protection Office)',
    country: 'PL',
    law: 'eu',
    website: 'https://uodo.gov.pl'
  },
  {
    code: 'pt-cnpd',
    name: 'Comissão Nacional de Proteção de Dados (CNPD)',
    country: 'PT',
    law: 'eu',
    website: 'https://www.cnpd.pt'
  },
  {
    code: 'ro-anspdcp',
    name: 'National Supervisory Authority for Personal Data Processing (ANSPDCP)',
    country: 'RO',
    law: 'eu',
    website: 'https://www.dataprotection.ro'
  },
  {
    code: 'sk-uoou',
    name: 'Úrad na ochranu osobných údajov Slovenskej republiky',
    country: 'SK',
    law: 'eu',
    website: 'https://dataprotection.gov.sk'
  },
  {
    code: 'si-ip',
    name: 'Information Commissioner of the Republic of Slovenia',
    country: 'SI',
    law: 'eu',
    website: 'https://www.ip-rs.si'
  },
  {
    code: 'es-aepd',
    name: 'Agencia Española de Protección de Datos (AEPD)',
    country: 'ES',
    law: 'eu',
    website: 'https://www.aepd.es'
  },
  {
    code: 'se-imy',
    name: 'Integritetsskyddsmyndigheten (IMY)',
    country: 'SE',
    law: 'eu',
    website: 'https://www.imy.se'
  }
];

const BY_CODE = new Map(SUPERVISORY_AUTHORITIES.map((a) => [a.code, a]));

export function authorityByCode(
  code: string | null | undefined
): SupervisoryAuthority | null {
  return code ? (BY_CODE.get(code) ?? null) : null;
}

/** The EEA States, by ISO code, in which the EU GDPR applies. */
export const EEA_STATES: Readonly<Record<string, string>> =
  Object.fromEntries(EEA);

export function isEeaState(code: string): boolean {
  return code in EEA_STATES;
}

/** The EU authorities of one State: one, or for Germany the federal and Land authorities. */
export function authoritiesIn(country: string): SupervisoryAuthority[] {
  return SUPERVISORY_AUTHORITIES.filter(
    (a) => a.law === 'eu' && a.country === country
  );
}
