import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  appealDeadline,
  clockStartsAt,
  costLimit,
  EIR_EXCEPTIONS,
  EISR_EXCEPTIONS,
  exceedsCostLimit,
  feeLapsesAt,
  FOIA_EXEMPTIONS,
  FOISA_EXEMPTIONS,
  foisaMaximumFee,
  informationRequestReviewClock,
  isWorkingDay,
  publicInterestGuideDate,
  responseDeadline,
  reviewAskedLate,
  reviewDeadline,
  reviewDueAt,
  reviewRequestDeadline,
  withinAggregationWindow,
  workingDayAfter
} from '@/lib/foi/statutory';

const d = (s: string) => new Date(`${s}T12:00:00Z`);
const day = (x: Date) => x.toISOString().slice(0, 10);

describe('working days', () => {
  it('counts a bank holiday in any part of the UK against a FOIA clock', () => {
    // 13 July 2026: the Battle of the Boyne, Northern Ireland only.
    assert.equal(isWorkingDay(d('2026-07-13'), 'foia'), false);
    // 3 August 2026: summer bank holiday, Scotland only.
    assert.equal(isWorkingDay(d('2026-08-03'), 'foia'), false);
    // 31 August 2026: summer bank holiday, England, Wales and Northern Ireland.
    assert.equal(isWorkingDay(d('2026-08-31'), 'foia'), false);
  });

  it("counts only Scotland's bank holidays against a FOI(S)A clock", () => {
    assert.equal(isWorkingDay(d('2026-07-13'), 'foisa'), true);
    assert.equal(isWorkingDay(d('2026-08-03'), 'foisa'), false);
    assert.equal(isWorkingDay(d('2026-08-31'), 'foisa'), true);
  });

  it('never counts a weekend or Christmas Day', () => {
    assert.equal(isWorkingDay(d('2026-11-07'), 'foia'), false);
    assert.equal(isWorkingDay(d('2026-11-08'), 'foisa'), false);
    assert.equal(isWorkingDay(d('2030-12-25'), 'foia'), false);
  });
});

describe('the response deadline', () => {
  it('is the twentieth working day following receipt, skipping St Andrew’s Day for FOIA too', () => {
    // Received Monday 2 November 2026; 30 November is a Scottish bank holiday.
    const due = responseDeadline({ regime: 'foia', startsAt: d('2026-11-02') });
    assert.equal(day(due), '2026-12-01');
    assert.equal(due.toISOString().slice(11), '23:59:59.999Z');
  });

  it('differs between FOIA and FOI(S)A where their bank holidays differ', () => {
    const startsAt = d('2026-07-10');
    assert.equal(
      day(responseDeadline({ regime: 'foia', startsAt })),
      '2026-08-11'
    );
    assert.equal(
      day(responseDeadline({ regime: 'foisa', startsAt })),
      '2026-08-10'
    );
  });

  it('gives an environmental request forty working days only when extended', () => {
    const startsAt = d('2026-01-05');
    assert.equal(
      day(responseDeadline({ regime: 'eir', startsAt })),
      '2026-02-02'
    );
    assert.equal(
      day(
        responseDeadline({
          regime: 'eir',
          startsAt,
          extendedForComplexity: true
        })
      ),
      '2026-03-02'
    );
    // The extension is for environmental requests only.
    assert.equal(
      day(
        responseDeadline({
          regime: 'foia',
          startsAt,
          extendedForComplexity: true
        })
      ),
      '2026-02-02'
    );
  });

  it('gives an archive thirty working days for FOIA, not for the EIR', () => {
    const startsAt = d('2026-01-05');
    assert.equal(
      day(responseDeadline({ regime: 'foia', startsAt, profile: 'archive' })),
      '2026-02-16'
    );
    assert.equal(
      day(responseDeadline({ regime: 'eir', startsAt, profile: 'archive' })),
      '2026-02-02'
    );
  });

  it("caps a school's date, and a Commission-set date, at the sixtieth working day", () => {
    const startsAt = d('2026-01-05');
    const sixtieth = day(workingDayAfter(startsAt, 60, 'foia'));
    assert.equal(
      day(responseDeadline({ regime: 'foia', startsAt, profile: 'school' })),
      sixtieth
    );
    assert.equal(
      day(
        responseDeadline({
          regime: 'foia',
          startsAt,
          profile: 'school',
          schoolDaysDeadline: d('2026-02-20')
        })
      ),
      '2026-02-20'
    );
    assert.equal(
      day(
        responseDeadline({
          regime: 'foia',
          startsAt,
          commissionSetDeadline: d('2026-12-31')
        })
      ),
      sixtieth
    );
  });

  it('disregards the days from a fees notice to payment, both included', () => {
    const startsAt = d('2026-01-05');
    const due = responseDeadline({
      regime: 'foia',
      startsAt,
      // Monday to Wednesday: three working days.
      feePauses: [{ from: d('2026-01-12'), to: d('2026-01-14') }]
    });
    assert.equal(day(due), '2026-02-05');
  });
});

describe('clarification', () => {
  it('starts the clock again when the answer arrives', () => {
    assert.equal(
      clockStartsAt({
        receivedAt: d('2026-01-05'),
        clarificationSoughtAt: d('2026-01-06'),
        clarificationReceivedAt: null
      }),
      null
    );
    assert.equal(
      day(
        clockStartsAt({
          receivedAt: d('2026-01-05'),
          clarificationSoughtAt: d('2026-01-06'),
          clarificationReceivedAt: d('2026-01-20')
        })!
      ),
      '2026-01-20'
    );
  });
});

describe('extensions, fees and reviews', () => {
  it('suggests ending a public interest extension twenty working days later', () => {
    assert.equal(day(publicInterestGuideDate(d('2026-02-02'))), '2026-03-02');
  });

  it('lets a FOIA fee lapse after three months and an EIR charge after sixty working days', () => {
    assert.equal(day(feeLapsesAt('foia', d('2026-01-05'))), '2026-04-05');
    assert.equal(
      day(feeLapsesAt('eir', d('2026-01-05'))),
      day(workingDayAfter(d('2026-01-05'), 60, 'foia'))
    );
  });

  it('runs the review windows each regime sets', () => {
    const respondedAt = d('2026-01-05');
    assert.equal(
      day(
        reviewRequestDeadline({
          regime: 'foia',
          respondedAt,
          deadline: respondedAt
        })
      ),
      '2026-03-02'
    );
    assert.equal(
      day(reviewDeadline({ regime: 'foia', requestedAt: respondedAt })),
      '2026-02-02'
    );
    assert.equal(
      day(
        reviewDeadline({
          regime: 'foia',
          requestedAt: respondedAt,
          exceptional: true
        })
      ),
      '2026-03-02'
    );
    assert.equal(
      day(reviewDeadline({ regime: 'eir', requestedAt: respondedAt })),
      '2026-03-02'
    );
  });

  it('counts a Scottish review from the deadline when no response came', () => {
    assert.equal(
      day(
        reviewRequestDeadline({ regime: 'foisa', deadline: d('2026-01-05') })
      ),
      day(workingDayAfter(d('2026-01-05'), 40, 'foisa'))
    );
  });
});

describe('the cost limit', () => {
  it('is 24 hours for central government and 18 for everyone else', () => {
    assert.equal(costLimit('foia', { centralGovernment: true })?.hours, 24);
    assert.equal(costLimit('foia')?.hours, 18);
    assert.equal(exceedsCostLimit('foia', 18), false);
    assert.equal(exceedsCostLimit('foia', 18.5), true);
  });

  it('has no sum under the EIR', () => {
    assert.equal(costLimit('eir'), null);
    assert.equal(exceedsCostLimit('eir', 100), null);
  });

  it('aggregates only within sixty consecutive working days', () => {
    const a = d('2026-01-05');
    assert.equal(
      withinAggregationWindow(a, workingDayAfter(a, 59, 'foia')),
      true
    );
    assert.equal(
      withinAggregationWindow(a, workingDayAfter(a, 60, 'foia')),
      false
    );
  });
});

describe('exemptions', () => {
  it('treats exactly the s.2(3) list as absolute', () => {
    const absolute = FOIA_EXEMPTIONS.filter((e) => e.absolute).map(
      (e) => e.provision
    );
    assert.deepEqual(absolute, [
      's.21',
      's.23',
      's.32',
      's.34',
      's.37(1)(a)-(ab)',
      's.40(1)',
      's.40(2), first condition',
      's.41',
      's.44'
    ]);
  });

  it('keeps four EIR exceptions away from information on emissions', () => {
    assert.deepEqual(
      EIR_EXCEPTIONS.filter((e) => e.notForEmissions).map((e) => e.provision),
      ['reg 12(5)(d)', 'reg 12(5)(e)', 'reg 12(5)(f)', 'reg 12(5)(g)']
    );
  });
});

describe('Scotland', () => {
  it('counts a FOI(S)A review request from the deadline, even after an early response', () => {
    const deadline = d('2026-02-02');
    const early = d('2026-01-12');
    assert.equal(
      day(
        reviewRequestDeadline({ regime: 'foisa', respondedAt: early, deadline })
      ),
      day(workingDayAfter(deadline, 40, 'foisa'))
    );
    // A late response starts it afresh.
    const late = d('2026-02-16');
    assert.equal(
      day(
        reviewRequestDeadline({ regime: 'foisa', respondedAt: late, deadline })
      ),
      day(workingDayAfter(late, 40, 'foisa'))
    );
    // FOIA counts from the response itself.
    assert.equal(
      day(
        reviewRequestDeadline({ regime: 'foia', respondedAt: early, deadline })
      ),
      day(workingDayAfter(early, 40, 'foia'))
    );
  });

  it('gives Scottish special schools the school-days rule for responses and reviews', () => {
    const startsAt = d('2026-01-05');
    assert.equal(
      day(
        responseDeadline({
          regime: 'foisa',
          startsAt,
          profile: 'school',
          schoolDaysDeadline: d('2026-02-20')
        })
      ),
      '2026-02-20'
    );
    assert.equal(
      day(
        reviewDeadline({
          regime: 'foisa',
          requestedAt: startsAt,
          profile: 'school'
        })
      ),
      day(workingDayAfter(startsAt, 60, 'foisa'))
    );
  });

  it('caps costs at £600 at £15 an hour, and fees at ten per cent above £100', () => {
    assert.deepEqual(costLimit('foisa'), {
      pounds: 600,
      hourlyRate: 15,
      hours: 40
    });
    assert.equal(foisaMaximumFee(100), 0);
    assert.equal(foisaMaximumFee(350), 25);
    assert.equal(foisaMaximumFee(600), 50);
    assert.equal(foisaMaximumFee(601), null);
  });

  it('treats exactly the s.2(2) list as absolute', () => {
    assert.deepEqual(
      FOISA_EXEMPTIONS.filter((e) => e.absolute).map((e) => e.provision),
      [
        's.25',
        's.26',
        's.36(2)',
        's.37',
        's.38(1)(a)',
        's.38(1)(b), first condition',
        's.38(1)(c)-(d)'
      ]
    );
  });

  it('numbers the EI(S)R exceptions under regs 10 and 11', () => {
    assert.ok(EISR_EXCEPTIONS.every((e) => /^reg 1[01]/.test(e.provision)));
    assert.deepEqual(
      EISR_EXCEPTIONS.filter((e) => e.notForEmissions).map((e) => e.provision),
      ['reg 10(5)(d)', 'reg 10(5)(e)', 'reg 10(5)(f)', 'reg 10(5)(g)']
    );
  });
});

describe('reviews and the regulator', () => {
  it('takes the earliest part of a mixed review, and the code extension for FOIA alone', () => {
    // Requested Monday 2 November 2026: FOIA 20 working days, EIR 40. St
    // Andrew's Day, 30 November, is a Scottish bank holiday, so it stops a
    // FOIA clock too.
    const requestedAt = d('2026-11-02');
    assert.equal(
      day(reviewDueAt({ regimes: ['foia', 'eir'], requestedAt })),
      '2026-12-01'
    );
    assert.equal(
      day(
        reviewDueAt({
          regimes: ['foia', 'eir'],
          requestedAt,
          exceptional: true
        })
      ),
      day(reviewDueAt({ regimes: ['eir'], requestedAt }))
    );
    assert.equal(
      day(reviewDueAt({ regimes: ['foisa'], requestedAt, exceptional: true })),
      day(reviewDueAt({ regimes: ['foisa'], requestedAt }))
    );
  });

  it('marks only the parts asked about after their window as late', () => {
    // FOI(S)A counts from the deadline however early the response came.
    const deadline = d('2026-06-01');
    const respondedAt = d('2026-05-04');
    const requestedAt = d('2026-07-27');
    assert.deepEqual(
      reviewAskedLate({
        regimes: ['foisa', 'eisr'],
        requestedAt,
        respondedAt,
        deadline
      }),
      ['eisr']
    );
  });

  it('says how a review stands', () => {
    const requestedAt = d('2026-11-02');
    const base = { regimes: ['foia' as const], requestedAt };
    assert.equal(
      informationRequestReviewClock({ ...base, now: d('2026-11-03') }).state,
      'running'
    );
    assert.equal(
      informationRequestReviewClock({ ...base, now: d('2026-11-26') }).state,
      'due_soon'
    );
    assert.equal(
      informationRequestReviewClock({ ...base, now: d('2026-12-02') }).state,
      'overdue'
    );
    assert.equal(
      informationRequestReviewClock({
        ...base,
        decidedAt: d('2026-12-02'),
        now: d('2026-12-03')
      }).state,
      'late'
    );
    assert.equal(
      informationRequestReviewClock({ ...base, withdrawn: true }).state,
      'withdrawn'
    );
  });

  it('allows 28 days to appeal to the tribunal, and 42 to the Court of Session', () => {
    assert.equal(day(appealDeadline('foia', d('2026-11-02'))), '2026-11-30');
    assert.equal(day(appealDeadline('foisa', d('2026-11-02'))), '2026-12-14');
  });
});
