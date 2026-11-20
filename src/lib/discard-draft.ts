type Focusable = { focus: () => void };

/** What discarding needs from the pressed button, so a test can stand in. */
export type DiscardTarget = {
  form: { reset: () => void } | null;
  closest: (selector: 'details') => {
    removeAttribute: (name: 'open') => void;
    querySelector: (selector: 'summary') => Focusable | null;
  } | null;
};

/**
 * Throw away what has been typed into a form that has not been submitted, and
 * fold away the disclosure it sits in, handing focus to the disclosure's
 * summary so a keyboard user is left where they were rather than at the top of
 * the page.
 */
export function discardDraft(button: DiscardTarget) {
  button.form?.reset();
  const details = button.closest('details');
  if (!details) return;
  details.removeAttribute('open');
  details.querySelector('summary')?.focus();
}
