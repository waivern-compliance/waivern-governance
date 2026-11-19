/**
 * A select with its own save button says where the change stands: offered
 * once the choice differs, saving, saved or refused.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { InlineSelectForm } from '@/components/InlineSelectForm';
import {
  describeInlineSelect,
  reconcileInlineSelect
} from '@/lib/inline-select';

const saved = { ok: true, message: 'Saved.' };
const refused = { ok: false, message: 'The last owner cannot be changed.' };

describe('a one-choice edit', () => {
  it('offers no save while the choice is what is saved', () => {
    assert.deepEqual(
      describeInlineSelect({
        saved: 'a',
        selected: 'a',
        pending: false,
        result: null
      }),
      { state: 'unchanged', mayDispatch: false }
    );
  });

  it('offers a save once the choice differs', () => {
    assert.deepEqual(
      describeInlineSelect({
        saved: 'a',
        selected: 'b',
        pending: false,
        result: null
      }),
      { state: 'changed', mayDispatch: true }
    );
  });

  it('cannot be saved twice while saving', () => {
    assert.deepEqual(
      describeInlineSelect({
        saved: 'a',
        selected: 'b',
        pending: true,
        result: null
      }),
      { state: 'saving', mayDispatch: false }
    );
  });

  it('says it was saved once the saved value is the choice', () => {
    assert.deepEqual(
      describeInlineSelect({
        saved: 'b',
        selected: 'b',
        pending: false,
        result: saved
      }),
      { state: 'saved', mayDispatch: false }
    );
  });

  it('no longer says saved once the choice changes again', () => {
    assert.equal(
      describeInlineSelect({
        saved: 'b',
        selected: 'c',
        pending: false,
        result: saved
      }).state,
      'changed'
    );
  });

  it('keeps a refused choice and lets it be retried', () => {
    assert.deepEqual(
      describeInlineSelect({
        saved: 'a',
        selected: 'b',
        pending: false,
        result: refused
      }),
      { state: 'refused', mayDispatch: true }
    );
  });
});

describe('keeping up with the server', () => {
  const memory = (selected: string, saved: string) => ({
    selected,
    saved,
    seen: null,
    spent: null
  });

  it('decides nothing while a save is running', () => {
    assert.equal(
      reconcileInlineSelect(memory('b', 'a'), {
        value: 'b',
        result: null,
        pending: true
      }),
      null
    );
  });

  it('shows what a kept save stored, even where it is not what was chosen', () => {
    assert.deepEqual(
      reconcileInlineSelect(memory('b', 'a'), {
        value: 'a',
        result: saved,
        pending: false
      }),
      { selected: 'a', saved: 'a', seen: saved, spent: null }
    );
  });

  it('keeps the choice when the save is refused', () => {
    assert.equal(
      reconcileInlineSelect(memory('b', 'a'), {
        value: 'a',
        result: refused,
        pending: false
      })?.selected,
      'b'
    );
  });

  it("takes somebody else's change and retires an earlier refusal", () => {
    const after = { selected: 'b', saved: 'a', seen: refused, spent: null };
    assert.deepEqual(
      reconcileInlineSelect(after, {
        value: 'c',
        result: refused,
        pending: false
      }),
      { selected: 'c', saved: 'c', seen: refused, spent: refused }
    );
  });

  it('leaves an up-to-date form alone', () => {
    assert.equal(
      reconcileInlineSelect(memory('b', 'a'), {
        value: 'a',
        result: null,
        pending: false
      }),
      null
    );
  });
});

describe('the one-choice form', () => {
  const html = renderToStaticMarkup(
    createElement(InlineSelectForm, {
      action: async () => saved,
      name: 'persona',
      label: 'Shows as',
      value: 'engineering',
      options: [
        { value: '', label: 'Not set' },
        { value: 'engineering', label: 'Engineering' }
      ],
      submitLabel: 'Set'
    })
  );

  it('shows the saved choice selected', () => {
    assert.match(html, /<option value="engineering" selected="">/);
  });

  it('disables its button until the choice changes', () => {
    assert.match(html, /<button type="submit" disabled=""[^>]*>Set<\/button>/);
  });

  it('has a live region in place before there is anything to announce', () => {
    assert.match(html, /role="status"/);
    assert.match(html, /aria-describedby="[^"]+"/);
  });
});
