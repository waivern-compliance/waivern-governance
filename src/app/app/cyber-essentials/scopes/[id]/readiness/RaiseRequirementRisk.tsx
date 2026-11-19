import { EditForm } from '@/components/EditForm';

import { raiseReadinessRiskAction } from '../../../actions';

type Point = { value: number; label: string };

const label =
  'block text-xs font-medium uppercase tracking-wider text-ink-soft';
const field =
  'w-full rounded border border-line bg-ground px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-brand';

/**
 * A risk proposed from an unmet requirement, for a person to confirm.
 *
 * Everything is filled in to start from: the risk filed as cyber security,
 * and a mitigation naming the requirement. The person rates it, says who will
 * put the requirement in place and by when, and may reword any of it. Nothing
 * reaches the register until they press Raise.
 */
export function RaiseRequirementRisk({
  scopeId,
  code,
  title,
  description,
  mitigation,
  likelihood,
  impact,
  members,
  viewerId
}: {
  scopeId: string;
  code: string;
  title: string;
  description: string;
  mitigation: string;
  likelihood: readonly Point[];
  impact: readonly Point[];
  members: ReadonlyArray<{ id: string; email: string }>;
  viewerId: string;
}) {
  const middle = (scale: readonly Point[]) =>
    String(scale[Math.floor(scale.length / 2)].value);
  return (
    <details className="basis-full rounded border border-line bg-ground">
      <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-brand">
        Raise a risk for this requirement
      </summary>
      <EditForm
        action={raiseReadinessRiskAction.bind(null, scopeId, code)}
        className="space-y-3 border-t border-line p-3"
      >
        <label className="block space-y-1">
          <span className={label}>Risk</span>
          <input
            name="title"
            required
            defaultValue={title}
            className={field}
          />
        </label>
        <label className="block space-y-1">
          <span className={label}>What could go wrong, and for whom?</span>
          <textarea
            name="description"
            required
            rows={2}
            defaultValue={description}
            className={field}
          />
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block space-y-1">
            <span className={label}>Likelihood</span>
            <select
              name="likelihood"
              defaultValue={middle(likelihood)}
              className={field}
            >
              {likelihood.map((p) => (
                <option
                  key={p.value}
                  value={p.value}
                >
                  {p.value} - {p.label}
                </option>
              ))}
            </select>
          </label>
          <label className="block space-y-1">
            <span className={label}>Impact</span>
            <select
              name="impact"
              defaultValue={middle(impact)}
              className={field}
            >
              {impact.map((p) => (
                <option
                  key={p.value}
                  value={p.value}
                >
                  {p.value} - {p.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="block space-y-1">
          <span className={label}>Mitigation: what will be done</span>
          <textarea
            name="mitigation"
            required
            rows={2}
            defaultValue={mitigation}
            className={field}
          />
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block space-y-1">
            <span className={label}>Mitigation owner</span>
            <select
              name="ownerId"
              defaultValue={viewerId}
              className={field}
            >
              {members.map((m) => (
                <option
                  key={m.id}
                  value={m.id}
                >
                  {m.email}
                </option>
              ))}
            </select>
          </label>
          <label className="block space-y-1">
            <span className={label}>Due</span>
            <input
              name="dueAt"
              type="date"
              className={field}
            />
          </label>
        </div>
        <p className="text-xs text-ink-soft">
          Filed as cyber security, raised from the readiness assessment and
          linked to this scope. The mitigation names {code}; once it is verified
          it shows here as evidence.
        </p>
        <button
          type="submit"
          className="rounded border border-line bg-surface px-4 py-2 text-sm hover:border-brand focus-visible:outline-2 focus-visible:outline-brand"
        >
          Raise risk
        </button>
      </EditForm>
    </details>
  );
}
