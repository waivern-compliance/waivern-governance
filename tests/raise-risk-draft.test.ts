/**
 * Raising a risk is one write, made when Raise is pressed. Until then the risk
 * is a draft in the browser that can be thrown away, because a raised risk is
 * audited and is never deleted afterwards.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { raiseRisk } from '@/app/app/risks/actions';
import { RaiseRiskForm } from '@/components/RaiseRiskForm';
import { AI_FRAMEWORKS } from '@/lib/ai-frameworks';
import { discardDraft } from '@/lib/discard-draft';
import { SCALES } from '@/lib/risk/scale';

function render() {
  return renderToStaticMarkup(
    createElement(RaiseRiskForm, {
      entities: [{ id: '00000000-0000-0000-0000-000000000001', name: '' }],
      assessmentId: '00000000-0000-0000-0000-000000000002',
      categories: AI_FRAMEWORKS.uk_dsit.categories,
      likelihood: SCALES['4x4'].likelihood,
      impact: SCALES['4x4'].impact
    })
  );
}

const buttons = (html: string) =>
  [...html.matchAll(/<button[^>]*>([^<]*)<\/button>/g)].map((m) => ({
    type: /type="([^"]+)"/.exec(m[0])?.[1],
    text: m[1]
  }));

describe('the raise a risk form', () => {
  it('has Raise as its only submit', () => {
    const submits = buttons(render()).filter((b) => b.type === 'submit');
    assert.deepEqual(
      submits.map((b) => b.text),
      ['Raise']
    );
  });

  it('offers a Discard that does not submit', () => {
    const discard = buttons(render()).find((b) => b.text === 'Discard');
    assert.equal(discard?.type, 'button');
  });

  it('says nothing is saved until Raise, and that a raised risk stays', () => {
    const html = render();
    assert.match(html, /Nothing is saved until you press Raise/);
    assert.match(html, /close it with a reason/);
  });
});

describe('discarding a draft', () => {
  function standIn({ inDetails = true } = {}) {
    const calls: string[] = [];
    const summary = { focus: () => calls.push('focus summary') };
    const details = {
      removeAttribute: (name: string) => calls.push(`remove ${name}`),
      querySelector: () => summary
    };
    return {
      calls,
      button: {
        form: { reset: () => calls.push('reset') },
        closest: () => (inDetails ? details : null)
      }
    };
  }

  it('clears the form, folds it away and leaves focus on its summary', () => {
    const { calls, button } = standIn();
    discardDraft(button);
    assert.deepEqual(calls, ['reset', 'remove open', 'focus summary']);
  });

  it('still clears a form that is not in a disclosure', () => {
    const { calls, button } = standIn({ inDetails: false });
    discardDraft(button);
    assert.deepEqual(calls, ['reset']);
  });
});

describe('raising a risk', () => {
  function form(fields: Record<string, string>) {
    const data = new FormData();
    for (const [k, v] of Object.entries(fields)) data.set(k, v);
    return data;
  }
  const entityId = '00000000-0000-0000-0000-000000000001';

  it('refuses a title of spaces, saying why', async () => {
    assert.deepEqual(
      await raiseRisk(
        null,
        form({ entityId, title: '   ', description: 'Something' })
      ),
      { ok: false, message: 'Give the risk a title.' }
    );
  });

  it('refuses a description of spaces, saying why', async () => {
    assert.deepEqual(
      await raiseRisk(
        null,
        form({ entityId, title: 'A risk', description: ' ' })
      ),
      { ok: false, message: 'Say what could go wrong, and for whom.' }
    );
  });
});
