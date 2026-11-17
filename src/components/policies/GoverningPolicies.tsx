import Link from 'next/link';

import { policiesGoverning, type PolicyLinkKind } from '@/services/policies';

/** The policies linked to an activity or AI system, from their pages. */
export async function GoverningPolicies({
  organisationId,
  kind,
  id
}: {
  organisationId: string;
  kind: PolicyLinkKind;
  id: string;
}) {
  const linked = await policiesGoverning(organisationId, kind, id);
  if (linked.length === 0) return null;
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-ink-soft">
        Policies that govern it
      </h2>
      <ul className="divide-y divide-line overflow-hidden rounded border border-line bg-surface text-sm">
        {linked.map((p) => (
          <li key={p.id}>
            <Link
              href={`/app/policies/${p.id}`}
              className="flex items-baseline justify-between gap-3 px-4 py-2 hover:bg-ground"
            >
              <span>
                <span className="font-mono text-xs text-ink-soft">
                  {p.reference}
                </span>{' '}
                {p.title}
              </span>
              <span className="text-xs text-ink-soft">
                {p.status === 'in_force'
                  ? 'In force'
                  : p.status === 'withdrawn'
                    ? 'Withdrawn'
                    : 'Not yet approved'}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
