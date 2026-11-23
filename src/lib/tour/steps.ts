/**
 * The guided tour of the home page: how the product is meant to be used, in
 * the order it is meant to be used. Set it up once, assess what you do, then
 * answer what comes round.
 *
 * It points at real things on the home page rather than at pictures of them,
 * so somebody leaves knowing where to click. It never moves them off the page:
 * a tour that navigates is a tour that strands somebody half way through a
 * form when they press Escape.
 *
 * Nothing advances on a timer. `seconds` is a reading budget, kept so the
 * whole tour stays inside two minutes for somebody reading at an ordinary
 * pace; a person who reads more slowly takes as long as they need (WCAG 2.2.1).
 */

import type { ProgrammeScope } from '@/services/programme-scope';

/** What a step points at, found on the page by `data-tour`. */
export const TOUR_TARGETS = [
  'guide',
  'entities',
  'settings',
  'templates',
  'assessments',
  'tasks',
  'help'
] as const;
export type TourTarget = (typeof TOUR_TARGETS)[number];

export type TourStage = 'Set up' | 'Assess' | 'Keep it current';

export type TourStep = {
  id: string;
  /** Null for a card in the middle of the page, with nothing highlighted. */
  target: TourTarget | null;
  stage?: TourStage;
  title: string;
  body: string;
  /** Reading budget, not a timer. */
  seconds: number;
};

/** The most the tour may ask of somebody, in reading time. */
export const TOUR_BUDGET_SECONDS = 120;

/** The outcomes stored against a person, as in `tour_outcome`. */
export const TOUR_OUTCOMES = ['finished', 'dismissed'] as const;
export type TourOutcome = (typeof TOUR_OUTCOMES)[number];

export function isTourOutcome(value: unknown): value is TourOutcome {
  return TOUR_OUTCOMES.some((o) => o === value);
}

/** The query string that starts the tour straight away, from Help or the profile page. */
export const TOUR_START_HREF = '/app?tour=start';

/**
 * The steps for an organisation's programme.
 *
 * Only the privacy programme changes the words: an organisation with no entity
 * under UK or EU data protection law is told why it sees AI governance alone,
 * and is not told about citations and deadlines it will never meet.
 */
export function tourSteps(scope: Pick<ProgrammeScope, 'privacy'>): TourStep[] {
  const privacy = scope.privacy;
  return [
    {
      id: 'welcome',
      target: null,
      title: 'How this tool is meant to be used',
      body:
        'It works in three stages: set it up once, assess what you do, then answer ' +
        'what comes round. This tour shows where each one lives. Press Escape to ' +
        'leave at any time.',
      seconds: 8
    },
    {
      id: 'guide',
      target: 'guide',
      stage: 'Set up',
      title: 'Start with the guide',
      body:
        'It puts the set-up in order and ticks each step off from what your ' +
        'registers actually hold, not from a checkbox.',
      seconds: 14
    },
    {
      id: 'entities',
      target: 'entities',
      stage: 'Set up',
      title: 'Your legal entities and their law',
      body: privacy
        ? 'Add each legal entity and say which data protection law it is under: UK, ' +
          'EU, both or neither. That choice decides which questions, deadlines and ' +
          'citations you see.'
        : 'None of your entities is under UK or EU data protection law, so you see ' +
          'the AI governance programme alone. Put one under either law and the ' +
          'privacy programme appears.',
      seconds: 16
    },
    {
      id: 'settings',
      target: 'settings',
      stage: 'Set up',
      title: 'The organisation and its frameworks',
      body:
        'An administrator sets the organisation up in Settings: people and their ' +
        "roles, the AI framework you follow (DSIT's toolkit or the NIST AI RMF), " +
        'and whether you manage Cyber Essentials.',
      seconds: 14
    },
    {
      id: 'templates',
      target: 'templates',
      stage: 'Assess',
      title: 'Choose a template',
      body:
        'Every assessment starts from a template. The library leads with the ones ' +
        'that fit your laws and programmes, and keeps the rest one click away.',
      seconds: 14
    },
    {
      id: 'assessments',
      target: 'assessments',
      stage: 'Assess',
      title: 'Complete it, then have it approved',
      body:
        'Answer the questions and submit. Every answer records who gave it and ' +
        'when. A reviewer approves, returns or rejects it, the decision goes on ' +
        'record under their name, and approval sets the next review date.',
      seconds: 18
    },
    {
      id: 'tasks',
      target: 'tasks',
      stage: 'Keep it current',
      title: 'What comes round lands here',
      body:
        'Every hour the tool checks what has come round: ' +
        (privacy
          ? 'policies, assessments, suppliers and AI systems due for review'
          : 'AI systems, assessments, policies and suppliers due for review') +
        ', and records whose inputs have changed. Each one becomes a task here.',
      seconds: 18
    },
    {
      id: 'help',
      target: 'help',
      title: 'Help is always here',
      body:
        'Help explains every screen. You can take this tour again from there at ' +
        'any time.',
      seconds: 8
    }
  ];
}

/**
 * Whether to offer the tour on the home page.
 *
 * Offered, never started: somebody who has answered once, either way, is not
 * asked again. A simulated colleague in a trial never signs in, so never needs
 * asking.
 */
export function offerTour(person: {
  outcome: TourOutcome | null;
  simulated: boolean;
}): boolean {
  return person.outcome === null && !person.simulated;
}

/** Whether the address asks for the tour to start now, as the replay links do. */
export function tourRequested(param: string | string[] | undefined): boolean {
  return (Array.isArray(param) ? param[0] : param) === 'start';
}
