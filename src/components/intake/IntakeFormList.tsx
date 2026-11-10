import type { ReactNode } from 'react';

import { RefusableForm } from '@/components/foi/RefusableForm';
import type { IntakeLink } from '@/services/dsr-intake';

type Result = { ok: boolean; message: string } | null;

/**
 * The public forms one register has published: where each is, what it has
 * taken, and the way to withdraw it. Shared by the data protection and the
 * freedom of information registers, which add their own controls in `extra`.
 */
export function IntakeFormList({
  forms,
  origin,
  withdraw,
  extra
}: {
  forms: ReadonlyArray<{ link: IntakeLink; entityName: string }>;
  origin: string;
  /** The withdraw action for a form, or null where this person may not. */
  withdraw: ((linkId: string) => (prev: Result) => Promise<Result>) | null;
  /** Anything else a register shows for an open form. */
  extra?: (link: IntakeLink, entityName: string) => ReactNode;
}) {
  if (forms.length === 0) return null;
  return (
    <ul className="divide-y divide-line overflow-hidden rounded border border-line">
      {forms.map(({ link, entityName }) => (
        <li
          key={link.id}
          className="space-y-1 px-3 py-2.5 text-sm"
        >
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="font-medium">
              {link.label}{' '}
              <span className="text-xs font-normal text-ink-soft">
                · {entityName}
              </span>
            </span>
            <span className="font-mono text-[11px] text-ink-soft">
              {link.revokedAt
                ? `withdrawn ${link.revokedAt.toISOString().slice(0, 10)}`
                : `${link.submissions} submission${link.submissions === 1 ? '' : 's'}`}
            </span>
          </div>
          {!link.revokedAt ? (
            <>
              <p className="break-all font-mono text-xs">{`${origin}/request/${link.slug}`}</p>
              {extra?.(link, entityName)}
              {withdraw ? (
                <RefusableForm
                  action={withdraw(link.id)}
                  submit="Withdraw this form"
                  className="pt-1"
                >
                  <span className="sr-only">Withdraw {link.label}</span>
                </RefusableForm>
              ) : null}
            </>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
