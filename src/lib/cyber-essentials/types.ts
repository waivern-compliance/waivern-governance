/**
 * The shape of the Cyber Essentials control library.
 *
 * Cyber Essentials is a certification scheme, not law: an organisation takes
 * it up, or a contract asks for it (PPN 014 for central government and NHS
 * buyers). Nothing here should be presented as a legal duty.
 */

/** An edition of NCSC's "Requirements for IT Infrastructure", by its version number. */
export type CeEditionId = 'v3.2' | 'v3.3';

/** The five technical controls, in the order NCSC sets them out. */
export type CeThemeId =
  | 'firewalls'
  | 'secure_configuration'
  | 'update_management'
  | 'user_access_control'
  | 'malware_protection';

/** What a control applies to, from the "Applies to" line under each theme. */
export type CeDeviceClass =
  | 'boundary_firewall'
  | 'router'
  | 'server'
  | 'desktop'
  | 'laptop'
  | 'tablet'
  | 'mobile_phone'
  | 'thin_client'
  | 'iaas'
  | 'paas'
  | 'saas';

export type CeCloudModel = 'iaas' | 'paas' | 'saas';

/**
 * Who typically implements a control on a cloud service (Table 1). The
 * organisation stays responsible either way; where the provider does it, the
 * provider must have committed to it in the contract or documents it refers to.
 */
export type CeImplementer =
  'organisation' | 'provider' | 'both' | 'provider_and_sometimes_organisation';

export type CeTheme = {
  id: CeThemeId;
  label: string;
  /** NCSC's aim for the theme, in Govern's words. */
  aim: string;
  appliesTo: readonly CeDeviceClass[];
  cloud: Readonly<Record<CeCloudModel, CeImplementer>>;
};

/**
 * One requirement, paraphrased.
 *
 * `code` is stable across editions while the requirement means the same thing,
 * so a status recorded against it carries into the next edition. `pages` says
 * which editions hold it and where: a requirement without a page for an
 * edition is not part of that edition.
 */
export type CeRequirement = {
  code: string;
  theme: CeThemeId;
  summary: string;
  pages: Partial<Record<CeEditionId, number>>;
  /** Meeting any one of these codes meets this one too (malware protection's two options). */
  alternatives?: readonly string[];
};

/** A rule about what a certification scope must or may contain. */
export type CeScopeRule = {
  code: string;
  summary: string;
  pages: Partial<Record<CeEditionId, number>>;
  /** Wording that applied in an earlier edition, where it differed. */
  earlier?: Partial<Record<CeEditionId, string>>;
};

/** A requirement whose failure fails the whole assessment, and the questions that test it. */
export type CeAutoFail = { code: string; questions: readonly string[] };

export type CeEdition = {
  id: CeEditionId;
  /** IASME's name for the question set that goes with this edition. */
  questionSet: 'Willow' | 'Danzell';
  /** The date new assessment accounts start on this edition. */
  effectiveFrom: string;
  /** The NCSC Cyber Essentials Plus test specification in force alongside it. */
  plusSpecification: 'v3.2';
  requirementsUrl: string;
  /** Requirements marked as automatic fails in this edition's question set. */
  autoFail: readonly CeAutoFail[];
};
