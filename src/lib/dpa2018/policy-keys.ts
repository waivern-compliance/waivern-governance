/**
 * What an appropriate policy document can cover: a Schedule 1 condition
 * (Schedule 1 Part 4), or Part 3 sensitive processing on consent or a
 * Schedule 8 condition (s.42). One register holds both, because both ask the
 * same of the document.
 */

import {
  describePart3PolicyKey,
  isPart3PolicyKey,
  PART3_POLICY_KEYS,
  type Part3PolicyKey
} from './part3';
import {
  describeSchedule1,
  isSchedule1Condition,
  SCHEDULE_1,
  SCHEDULE_1_KEYS,
  type Schedule1Condition
} from './schedule-1';

export type PolicyKey = Schedule1Condition | Part3PolicyKey;

/** In the order the Act sets them out. */
export const POLICY_KEYS: readonly PolicyKey[] = [
  ...SCHEDULE_1_KEYS,
  ...PART3_POLICY_KEYS
];

export function isPolicyKey(v: unknown): v is PolicyKey {
  return isSchedule1Condition(v) || isPart3PolicyKey(v);
}

/** "para 18", "Sch 8 para 4", "Part 3 consent". */
export function policyKeyShort(key: PolicyKey): string {
  if (isSchedule1Condition(key)) return `para ${SCHEDULE_1[key].paragraph}`;
  return key === 'part3_consent'
    ? 'Part 3 consent'
    : `Sch 8 para ${key.replace('sch8_p', '')}`;
}

export function describePolicyKey(key: PolicyKey): string {
  return isSchedule1Condition(key)
    ? describeSchedule1(key)
    : describePart3PolicyKey(key);
}

const plain = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/**
 * A condition as another platform names it: its key here, its paragraph
 * ("para 18", "Schedule 1 paragraph 18", "Sch 8 para 4"), "Part 3 consent",
 * or its name as the Act gives it. A name two conditions share, or anything
 * else, is not guessed.
 */
export function policyKeyFrom(given: string): PolicyKey | null {
  const v = plain(given);
  if (!v) return null;
  const asKey = v.replace(/ /g, '_');
  if (isPolicyKey(asKey)) return asKey;
  if (/^part 3 consent$|^consent part 3$|^s 35 4$/.test(v))
    return 'part3_consent';
  const sch8 = /^(?:sch(?:edule)? 8 )(?:para(?:graph)? )?(\d+)$/.exec(v);
  if (sch8) {
    const key = `sch8_p${sch8[1]}`;
    return isPolicyKey(key) ? key : null;
  }
  const sch1 = /^(?:sch(?:edule)? 1 )?(?:para(?:graph)? )?(\d+)$/.exec(v);
  if (sch1) {
    const n = Number(sch1[1]);
    return SCHEDULE_1_KEYS.find((k) => SCHEDULE_1[k].paragraph === n) ?? null;
  }
  const named = POLICY_KEYS.filter((k) => {
    const label = isSchedule1Condition(k)
      ? SCHEDULE_1[k].label
      : k === 'part3_consent'
        ? 'Part 3 consent'
        : describePart3PolicyKey(k).split(' - ')[1];
    return plain(label) === v;
  });
  return named.length === 1 ? named[0] : null;
}
