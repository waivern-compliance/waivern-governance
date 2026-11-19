import {
  questionsOf,
  type Answers,
  type AnswerValue,
  type EvaluationResult
} from './logic';
import type { Question, RequirementAnswer, TemplateSchema } from './schema';

/**
 * What an assessment's answers say about the requirements of a control
 * framework, for templates whose questions name the codes they test
 * (`question.controls`).
 *
 * Framework-agnostic: the codes are whatever the template names. Cyber
 * Essentials reads its own requirements through this, and another scheme
 * could do the same.
 */

/** `unknown` is a requirement a visible question tests that has no answer yet. */
export type RequirementStatus = RequirementAnswer | 'unknown';

export type RequirementOutcome = {
  code: string;
  status: RequirementStatus;
  /** A question testing it that fails the whole assessment was not met. */
  autoFailed: boolean;
  /** The asked questions that test it, and what each answer said. */
  questions: Array<{
    key: string;
    label: string;
    answer: RequirementAnswer | null;
    autoFail: boolean;
  }>;
};

/** What one answer says about the requirements its question tests, or null if unanswered. */
export function answerMeets(
  question: Question,
  value: AnswerValue | undefined
): RequirementAnswer | null {
  if (question.type === 'boolean') {
    if (value === true) return 'met';
    if (value === false) return 'not_met';
    return null;
  }
  if (question.type === 'single_select' && typeof value === 'string') {
    return question.options?.find((o) => o.value === value)?.meets ?? null;
  }
  return null;
}

/**
 * Each requirement the template tests, in the order its questions first name
 * it.
 *
 * A question that is not being asked says nothing: a branch for servers the
 * organisation said it does not have leaves server requirements not
 * applicable, rather than unmet. Among the questions asked, one "no" is
 * enough for a requirement to be unmet, since the requirement holds only if
 * everything that tests it does.
 */
export function requirementOutcomes(
  schema: TemplateSchema,
  answers: Answers,
  evaluation: EvaluationResult
): RequirementOutcome[] {
  const byCode = new Map<string, RequirementOutcome>();
  for (const { question } of questionsOf(schema)) {
    for (const code of question.controls ?? []) {
      const outcome = byCode.get(code) ?? {
        code,
        status: 'not_applicable' as RequirementStatus,
        autoFailed: false,
        questions: []
      };
      byCode.set(code, outcome);
      if (!evaluation.questions[question.key]?.visible) continue;
      const answer = answerMeets(question, answers[question.key]);
      outcome.questions.push({
        key: question.key,
        label: question.label,
        answer,
        autoFail: question.autoFail ?? false
      });
    }
  }
  return [...byCode.values()].map((o) => {
    const said = o.questions.map((q) => q.answer);
    const status: RequirementStatus = said.includes('not_met')
      ? 'not_met'
      : said.includes(null)
        ? 'unknown'
        : said.includes('met')
          ? 'met'
          : 'not_applicable';
    const autoFailed = o.questions.some(
      (q) => q.autoFail && q.answer === 'not_met'
    );
    return { ...o, status, autoFailed };
  });
}
