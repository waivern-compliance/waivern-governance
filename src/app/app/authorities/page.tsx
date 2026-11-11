import Link from 'next/link';
import { redirect } from 'next/navigation';

import { HelpLink } from '@/components/help/HelpLink';
import { NotPermitted } from '@/components/NotPermitted';
import {
  AUTHORITIES_REVIEWED_AT,
  AUTHORITY_SOURCES,
  EEA_STATES,
  SUPERVISORY_AUTHORITIES
} from '@/lib/gdpr/authorities';
import { can } from '@/lib/rbac';
import { getActiveSession } from '@/lib/session';

const countryName = (code: string) =>
  code === 'GB' ? 'United Kingdom' : (EEA_STATES[code] ?? code);

/**
 * The supervisory authorities, as Govern names them on complaints, request
 * refusals, the public form and an entity's lead authority. Maintained by
 * Waivern for every client; nothing here is edited per organisation.
 */
export default async function AuthoritiesPage() {
  const active = await getActiveSession();
  if (!active) redirect('/sign-in');
  if (!can(active.membership.grants, 'record.read')) {
    return (
      <NotPermitted
        what="The supervisory authorities"
        organisationName={active.membership.organisationName}
      />
    );
  }
  const sorted = [...SUPERVISORY_AUTHORITIES].sort(
    (a, b) =>
      countryName(a.country).localeCompare(countryName(b.country)) ||
      (a.scope ?? '').localeCompare(b.scope ?? '')
  );

  return (
    <main className="mx-auto max-w-4xl space-y-8 px-6 py-12">
      <header className="space-y-2 border-b border-line pb-6">
        <Link
          href="/app"
          className="text-xs text-ink-soft hover:text-brand"
        >
          ← {active.membership.organisationName}
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">
          Supervisory authorities
        </h1>
        <p className="max-w-prose text-sm text-ink-soft">
          The UK&apos;s regulator and the authorities of each EEA State, where
          the EU GDPR applies. An entity&apos;s lead authority is chosen from
          these on the Organisation page, and complaints and refusals name the
          one that applies. Last checked on{' '}
          {new Date(AUTHORITIES_REVIEWED_AT).toLocaleDateString('en-GB', {
            day: 'numeric',
            month: 'long',
            year: 'numeric'
          })}{' '}
          against{' '}
          {AUTHORITY_SOURCES.map((s, i) => (
            <span key={s.url}>
              {i > 0 ? ' and ' : ''}
              <a
                href={s.url}
                className="underline"
                rel="noreferrer"
                target="_blank"
              >
                {s.title}
              </a>
            </span>
          ))}
          .
        </p>
      </header>

      <HelpLink topic="authorities" />

      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-line text-left text-xs uppercase tracking-wider text-ink-soft">
            <th className="py-2 pr-3 font-medium">State</th>
            <th className="py-2 pr-3 font-medium">Authority</th>
            <th className="py-2 font-medium">Law</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {sorted.map((a) => (
            <tr key={a.code}>
              <td className="py-2 pr-3 align-top">{countryName(a.country)}</td>
              <td className="py-2 pr-3 align-top">
                <a
                  href={a.website}
                  className="underline-offset-2 hover:underline"
                  rel="noreferrer"
                  target="_blank"
                >
                  {a.name}
                </a>
                {a.scope ? (
                  <span className="block text-xs text-ink-soft">{a.scope}</span>
                ) : null}
              </td>
              <td className="py-2 align-top font-mono text-[11px]">
                {a.law === 'uk' ? 'UK GDPR' : 'EU GDPR'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
