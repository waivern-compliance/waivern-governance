import type { Question, TemplateDefinition } from '../schema';

/**
 * The duties the Irish ePrivacy Regulations (S.I. No. 336 of 2011) put on a
 * provider of a publicly available electronic communications network or
 * service, as a checklist (decision 7 of the Irish ePrivacy plan): security
 * (regulation 4), traffic and location data (6 and 9), billing, line
 * identification, forwarding and directories (7, 8, 11 and 12), the National
 * Directory Database (14), and procedures for requests to access users' data
 * (16(1)). Breach notification is in the breach register, not here.
 *
 * A checklist, not a score: each duty is confirmed, with how it is met. It
 * decides nothing, and it is offered only to an entity marked as a provider
 * in Ireland.
 */

const met = (
  key: string,
  label: string,
  ref: string,
  help?: string
): Question[] => [
  {
    key,
    label,
    type: 'single_select',
    required: true,
    legalRefs: [ref],
    evidence: 'optional',
    ...(help ? { help } : {}),
    options: [
      { value: 'met', label: 'Yes, in place' },
      { value: 'partly', label: 'Partly' },
      { value: 'not_met', label: 'No' },
      { value: 'not_applicable', label: 'Does not apply to our service' }
    ]
  },
  {
    key: `${key}_how`,
    label: 'How, and where it is written down',
    type: 'long_text',
    required: false,
    legalRefs: [],
    evidence: 'none'
  }
];

export const IE_PROVIDER_DUTIES: TemplateDefinition = {
  schema: {
    sections: [
      {
        key: 'service',
        title: 'The service',
        questions: [
          {
            key: 'service',
            label:
              'Which publicly available network or service does this cover?',
            type: 'long_text',
            required: true,
            legalRefs: ['ie.si336.reg3'],
            evidence: 'none',
            help: 'Regulation 3: services in public networks in the State. Since 9 June 2023 the definitions come from the Electronic Communications Code Regulations, which include interpersonal communications services.'
          }
        ]
      },
      {
        key: 'security',
        title: 'Security',
        questions: [
          ...met(
            'security_measures',
            'Are appropriate technical and organisational measures in place, with access limited to authorised staff for authorised purposes?',
            'ie.si336.reg4',
            'Regulation 4(1) and (2): measures appropriate to the risk, protection against accidental or unlawful destruction, loss, alteration or unauthorised access, and a security policy.'
          ),
          ...met(
            'security_policy',
            'Is there a security policy for the processing of personal data?',
            'ie.si336.reg4'
          ),
          ...met(
            'risk_notice',
            'Are subscribers told of any particular risk of a breach of network security, and of what they can do about it?',
            'ie.si336.reg4',
            'Regulation 4(4).'
          ),
          ...met(
            'breach_inventory',
            'Is every personal data breach kept in an inventory, with its facts, its effects and the remedial action taken?',
            'ie.si336.reg4',
            "Regulation 4(12). Govern's breach register can be that inventory."
          )
        ]
      },
      {
        key: 'traffic_location',
        title: 'Traffic and location data',
        questions: [
          ...met(
            'traffic_erased',
            'Is traffic data erased or made anonymous when it is no longer needed to transmit a communication, subject to the data retention law?',
            'ie.si336.reg6',
            'Regulation 6. Data for billing may be kept only until the bill can no longer be challenged.'
          ),
          ...met(
            'traffic_marketing',
            'Is traffic data used to market the service, or for value-added services, only with prior consent that can be withdrawn at any time?',
            'ie.si336.reg6'
          ),
          ...met(
            'location_consent',
            'Is location data other than traffic data used only anonymised, or with consent for a value-added service, after telling the user what, why, for how long and to whom?',
            'ie.si336.reg9',
            'Regulation 9. The user can withdraw consent, and refuse it for each connection, free of charge.'
          )
        ]
      },
      {
        key: 'subscriber_rights',
        title: 'What subscribers can ask for',
        questions: [
          ...met(
            'itemised_billing',
            'Can a subscriber ask for bills that are not itemised?',
            'ie.si336.reg7'
          ),
          ...met(
            'line_identification',
            'Can callers suppress calling line identification, per call and per line, free; and can called subscribers block it and reject anonymous calls?',
            'ie.si336.reg8',
            'Regulation 8. The provider publishes this information, including on its website.'
          ),
          ...met(
            'call_forwarding',
            'Can a subscriber stop calls being forwarded to them automatically by a third party, free of charge?',
            'ie.si336.reg11'
          ),
          ...met(
            'directories',
            'Are subscribers told, free, of a directory and its search functions, and can they choose whether and what is included, and check, correct or withdraw it?',
            'ie.si336.reg12',
            'Regulation 12, for providers of number-based interpersonal communications services that attribute numbers.'
          ),
          ...met(
            'national_directory',
            "Are subscribers' refusals of marketing calls, automated calls and faxes recorded in the National Directory Database?",
            'ie.si336.reg14',
            'Regulation 14. Ex-directory subscribers are treated as not consenting.'
          )
        ]
      },
      {
        key: 'access_requests',
        title: "Requests for access to users' data",
        questions: [
          ...met(
            'access_procedures',
            "Where a law restricts these rights under Article 15(1) of the Directive, are there internal procedures for answering requests for access to users' personal data, such as from the authorities?",
            'ie.si336.reg16',
            'Regulation 16(1). The Data Protection Commission may ask for the procedures, the number of requests, the legal justification and the responses, to be given within 28 days.'
          )
        ]
      }
    ]
  },
  scoring: { method: 'none' },
  reviewIntervalMonths: 12
};
