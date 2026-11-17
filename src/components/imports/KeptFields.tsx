/** The source's fields with no home here, folded away until wanted. */
export function KeptFields({
  sourceName,
  legacy
}: {
  sourceName: string;
  legacy: Record<string, string> | null;
}) {
  const kept = Object.entries(legacy ?? {});
  if (kept.length === 0) return null;
  return (
    <details>
      <summary className="cursor-pointer text-xs font-medium">
        From {sourceName}, with no field here ({kept.length})
      </summary>
      <dl className="mt-2 grid gap-x-4 gap-y-1 text-xs sm:grid-cols-[auto_1fr]">
        {kept.map(([k, v]) => (
          <div
            key={k}
            className="contents"
          >
            <dt className="font-medium">{k}</dt>
            <dd className="whitespace-pre-wrap break-words">{v}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}
