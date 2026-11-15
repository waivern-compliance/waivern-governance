import { COLLEAGUES } from '@/services/trial-demo';

/** Who the trial's simulated colleagues are, and how the work reaches them. */
export function Colleagues() {
  return (
    <section className="space-y-2 text-sm">
      <h2 className="font-semibold">Your simulated colleagues</h2>
      <p className="text-ink-soft">
        So you can see work move between people, the demo company has colleagues
        who are made up. Approvals, reviews and tasks for their roles go to them
        in the app only: they are never emailed, and nobody real is ever told.
        You decide their approvals yourself: as the owner, you may decide every
        stage, so draft, submit and approve to see the whole loop.
      </p>
      <ul className="list-disc space-y-1 pl-5">
        {COLLEAGUES.map((c) => (
          <li key={c.local}>
            {c.name} (simulated), {c.title}
          </li>
        ))}
      </ul>
    </section>
  );
}
