import { setTierAction } from '@/app/app/third-parties/actions';
import { EditForm } from '@/components/EditForm';
import { savedKey } from '@/lib/saved-key';
import {
  SUPPLIER_TIERS,
  TIER_LABEL,
  type SupplierTier,
  type TierRecommendation
} from '@/lib/thirdparty/tier';

const field = 'rounded border border-line bg-ground px-3 py-2 text-sm';

/** A supplier's tier: what is set, what the register suggests and why, and the form to set it. */
export function TierPanel({
  supplierId,
  tier,
  tierReason,
  recommendation,
  mayEdit
}: {
  supplierId: string;
  tier: SupplierTier | null;
  tierReason: string | null;
  recommendation: TierRecommendation;
  mayEdit: boolean;
}) {
  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold">Tier</h2>
      <p className="text-sm">
        {tier ? TIER_LABEL[tier] : 'Not set'}
        {tier && tierReason ? (
          <span className="text-ink-soft"> - {tierReason}</span>
        ) : null}
      </p>
      <div className="rounded border-l-2 border-line px-3 py-2 text-xs text-ink-soft">
        <p>
          The register suggests{' '}
          <strong>{TIER_LABEL[recommendation.tier].toLowerCase()}</strong>:
        </p>
        <ul className="list-disc pl-5">
          {recommendation.reasons.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      </div>
      {mayEdit ? (
        <EditForm
          key={savedKey({ tier, tierReason })}
          action={setTierAction.bind(null, supplierId)}
          className="flex flex-wrap items-end gap-2"
        >
          <label className="block space-y-1">
            <span className="block text-xs font-medium uppercase tracking-wider text-ink-soft">
              Tier
            </span>
            <select
              name="tier"
              defaultValue={tier ?? recommendation.tier}
              className={field}
            >
              {SUPPLIER_TIERS.map((t) => (
                <option
                  key={t}
                  value={t}
                >
                  {TIER_LABEL[t]}
                  {t === recommendation.tier ? ' (suggested)' : ''}
                </option>
              ))}
            </select>
          </label>
          <label className="block min-w-64 flex-1 space-y-1">
            <span className="block text-xs font-medium uppercase tracking-wider text-ink-soft">
              Why, if not the suggestion
            </span>
            <input
              name="reason"
              defaultValue={tierReason ?? ''}
              className={`${field} w-full`}
            />
          </label>
          <button
            type="submit"
            className="rounded border border-line bg-surface px-4 py-2 text-sm hover:border-brand"
          >
            Set the tier
          </button>
        </EditForm>
      ) : null}
    </section>
  );
}
