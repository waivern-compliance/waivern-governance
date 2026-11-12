/** A list of points, each with a tick, as the public pages use for what you get. */
export function CheckList({
  items,
  className = 'space-y-2 text-sm'
}: {
  items: readonly string[];
  className?: string;
}) {
  return (
    <ul className={className}>
      {items.map((item) => (
        <li
          key={item}
          className="flex gap-2"
        >
          <span
            aria-hidden
            className="font-semibold text-brand"
          >
            ✓
          </span>
          {item}
        </li>
      ))}
    </ul>
  );
}
