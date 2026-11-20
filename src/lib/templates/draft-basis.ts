type Version = { status: string; version: number };

/**
 * The version a new draft copies: the published one, so an edit starts from
 * what assessments run against, never from a draft somebody abandoned. A
 * template that was never published starts from its newest draft that was not
 * abandoned, and failing that from its newest version.
 *
 * `versions` is newest first.
 */
export function draftBasis<V extends Version>(
  versions: readonly V[]
): V | null {
  return (
    versions.find((v) => v.status === 'published') ??
    versions.find((v) => v.status !== 'abandoned') ??
    versions[0] ??
    null
  );
}
