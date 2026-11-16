import Link from 'next/link';

import { NOTICE_WORDS } from '@/lib/thirdparty/contracts';
import type { ContractRow } from '@/services/contracts';

const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

/** A supplier's contracts, as shown on its page. */
export function SupplierContracts({
  supplierId,
  contracts,
  mayAdd
}: {
  supplierId: string;
  contracts: ContractRow[];
  mayAdd: boolean;
}) {
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold">Contracts</h2>
      {contracts.length > 0 ? (
        <ul className="space-y-0.5 text-sm">
          {contracts.map((c) => (
            <li key={c.contract.id}>
              <Link
                href={`/app/contracts/${c.contract.id}`}
                className="hover:text-brand"
              >
                <span className="font-mono text-xs text-ink-soft">
                  {c.contract.reference}
                </span>{' '}
                {c.contract.title}{' '}
                <span className="text-xs text-ink-soft">
                  {c.entityName} · {NOTICE_WORDS[c.notice]}
                  {c.noticeBy && c.notice !== 'renewed' && !c.contract.endedAt
                    ? `, notice by ${day(c.noticeBy)}`
                    : ''}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-ink-soft">No contract recorded.</p>
      )}
      {mayAdd ? (
        <Link
          href={`/app/contracts?supplier=${supplierId}`}
          className="text-xs text-brand hover:underline"
        >
          Add a contract
        </Link>
      ) : null}
    </section>
  );
}
