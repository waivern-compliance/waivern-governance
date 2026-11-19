import type { RiskCategoryDef } from '@/lib/ai-frameworks/types';
import {
  CE_TREATMENT_SOURCE,
  CE_TREATMENTS
} from '@/lib/cyber-essentials/treatments';

import type { AppetiteLevel } from './appetite';
import type { TreatmentSuggestion } from './treatment-library';

/**
 * Risk categories that are not about AI, offered whichever AI framework the
 * organisation follows, and kept as they are when it moves to another.
 *
 * The AI framework packs file AI risk by harm. A risk to the organisation's
 * IT from common internet attacks is not AI risk, so it does not belong to a
 * pack, and appetite for it does not change when the AI framework does.
 */
export type GeneralCategory = RiskCategoryDef & {
  appetiteGuidance: Record<AppetiteLevel, string>;
  treatments: readonly TreatmentSuggestion[];
  treatmentSource: { name: string; detail: string; tag: string };
};

export const GENERAL_CATEGORIES: readonly GeneralCategory[] = [
  {
    value: 'cyber_security',
    label: 'Cyber security',
    // DSIT's security category stays for risk particular to an AI system:
    // attacks on a model, its data or its outputs.
    summary:
      "Compromise of the organisation's IT through common internet attacks: phishing, guessed or stolen passwords, software left unpatched, malware. Security risk particular to an AI system stays under the AI framework's own category.",
    appetiteGuidance: {
      averse:
        'No exposure to common internet attacks is accepted; every system meets the Cyber Essentials controls before it is used.',
      minimal:
        'Exposure only where a control cannot yet be applied, isolated from the internet and with a date to close it.',
      cautious:
        'Some exposure where a control is being put in place, tracked to a date and kept away from sensitive data.',
      open: 'Exposure accepted for a clear benefit, with the controls applied where they matter most.'
    },
    treatments: CE_TREATMENTS,
    treatmentSource: CE_TREATMENT_SOURCE
  }
];

const BY_VALUE = new Map(GENERAL_CATEGORIES.map((c) => [c.value, c]));

export function generalCategory(
  value: string | null | undefined
): GeneralCategory | null {
  return value ? (BY_VALUE.get(value) ?? null) : null;
}
