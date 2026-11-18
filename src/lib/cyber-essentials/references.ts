import {
  CE_PLUS_SPECIFICATION_URL,
  ceEdition,
  requirementsOf,
  scopeRulesOf
} from './editions';
import type { CeEditionId } from './types';

/**
 * Cyber Essentials in the shared reference library, so a template question can
 * cite the requirement it tests the way it cites an Article.
 *
 * Only the edition current assessments use goes in. A citation names one
 * document; when a new edition arrives, its requirements join the library
 * under their own codes and the old ones stay for the templates that cite them.
 */
const LIBRARY_EDITION: CeEditionId = 'v3.3';

/** `ncsc.ce.v3_3.uac.mfa_cloud`: the library code for a requirement in an edition. */
export function ceReferenceCode(edition: CeEditionId, code: string): string {
  return `ncsc.ce.${edition.replace('.', '_')}.${code.toLowerCase()}`;
}

function editionReferences(id: CeEditionId) {
  const edition = ceEdition(id);
  const ref = {
    regime: `NCSC Cyber Essentials ${id}`,
    url: edition.requirementsUrl,
    jurisdiction: 'UK'
  };
  return [...requirementsOf(id), ...scopeRulesOf(id)].map((r) => ({
    ...ref,
    code: ceReferenceCode(id, r.code),
    citation: `${r.code}, page ${r.pages[id]}`,
    title: r.summary
  }));
}

export const CE_LEGAL_REFERENCES = [
  {
    code: 'ncsc.ce.requirements',
    regime: 'NCSC',
    citation: `Cyber Essentials: Requirements for IT Infrastructure ${LIBRARY_EDITION}`,
    title:
      'The five technical controls and the scope rules a Cyber Essentials certificate is assessed against',
    url: ceEdition(LIBRARY_EDITION).requirementsUrl,
    jurisdiction: 'UK'
  },
  {
    code: 'ncsc.ce.plus',
    regime: 'NCSC',
    citation: `Cyber Essentials Plus Test Specification ${ceEdition(LIBRARY_EDITION).plusSpecification}`,
    title:
      'The technical tests an assessor runs for Cyber Essentials Plus, and how each passes or fails',
    url: CE_PLUS_SPECIFICATION_URL,
    jurisdiction: 'UK'
  },
  {
    code: 'ppn.014',
    regime: 'Cabinet Office',
    citation: 'PPN 014',
    title:
      'When central government and NHS buyers require Cyber Essentials from suppliers',
    url: 'https://assets.publishing.service.gov.uk/media/67af78c8a75f02dffca29bd8/PPN_014_Cyber_essentials_scheme.pdf',
    jurisdiction: 'UK'
  },
  ...editionReferences(LIBRARY_EDITION)
];
