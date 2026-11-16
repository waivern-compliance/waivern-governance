/**
 * The hosted sign-in page offers the demo company only where trials are
 * open: anywhere else /trial answers that trials are not offered.
 */
import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { Hero, Pitch } from '@/app/sign-in/Pitch';
import { sql as pg } from '@/db/client';
import { TRIAL_LENGTH } from '@/lib/trial';
import { DEMO_HIGHLIGHTS } from '@/services/trial-demo';

const hero = (trials: boolean) =>
  renderToStaticMarkup(
    createElement(Hero, { providers: ['Google'], open: true, trials })
  );
const pitch = (trials: boolean) =>
  renderToStaticMarkup(createElement(Pitch, { trials }));

after(async () => {
  await pg.end();
});

describe('the sign-in pitch', () => {
  it('offers the demo company where trials are open', () => {
    assert.match(hero(true), /href="\/trial"/);
    assert.match(hero(true), new RegExp(`for ${TRIAL_LENGTH} first`));
    const page = pitch(true);
    assert.match(page, /See it working before you sign up/);
    for (const line of DEMO_HIGHLIGHTS) assert.ok(page.includes(line), line);
    assert.match(page, /fictional data only/);
  });

  it('says nothing of a trial where trials are closed', () => {
    for (const html of [hero(false), pitch(false)]) {
      assert.doesNotMatch(html, /href="\/trial"/);
      assert.doesNotMatch(html, /demo company|fictional/i);
    }
  });

  it('never says the service itself runs out', () => {
    for (const trials of [true, false])
      assert.doesNotMatch(pitch(trials), /no trial that runs out/);
  });
});
