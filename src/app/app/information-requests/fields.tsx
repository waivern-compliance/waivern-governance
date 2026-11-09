import {
  FOI_ACT_REGIMES,
  REGIME,
  type FoiAct,
  type FoiRegime
} from '@/lib/foi/statutory';

export { inputClass, Label } from '../requests/fields';

export const FOI_CHANNEL_LABEL: Record<string, string> = {
  email: 'Email',
  web_form: 'Web form',
  post: 'Post',
  social_media: 'Social media',
  phone: 'Phone (environmental only)',
  in_person: 'In person (environmental only)'
};

export const STATUS_LABEL: Record<string, string> = {
  open: 'open',
  responded: 'responded',
  closed: 'closed',
  converted: 'now a subject access request'
};

export function regimeNames(regimes: readonly FoiRegime[]): string {
  return regimes.map((r) => REGIME[r].short).join(' and ');
}

/**
 * Which regimes the request falls under. Environmental information goes under
 * the environmental regulations whatever the requester called it.
 */
export function RegimesField({
  act,
  selected
}: {
  act: FoiAct;
  selected?: readonly FoiRegime[];
}) {
  const [main, environmental] = FOI_ACT_REGIMES[act];
  const chosen = selected ?? [main];
  return (
    <fieldset className="space-y-1.5">
      <legend className="text-xs font-medium uppercase tracking-wider text-ink-soft">
        Which law
        <span className="block font-normal normal-case tracking-normal">
          The requester need not name it. Information about the environment, or
          about things that affect it, falls under the environmental
          regulations. A request can ask for both kinds.
        </span>
      </legend>
      {[main, environmental].map((r) => (
        <label
          key={r}
          className="flex items-start gap-2.5 text-sm"
        >
          <input
            type="checkbox"
            name="regimes"
            value={r}
            defaultChecked={chosen.includes(r)}
            className="mt-1 accent-brand"
          />
          <span>{REGIME[r].label}</span>
        </label>
      ))}
    </fieldset>
  );
}
