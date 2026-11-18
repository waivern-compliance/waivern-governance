import type { HostingModel } from '@/lib/assets/register';
import { outOfSupport, type AssetDetailValues } from '@/lib/assets/types';

import { OUT_OF_SCOPE_REASONS, type OutOfScopeReason } from './scope';

/**
 * What a Cyber Essentials scope may and may not say, from the scope rules
 * (`scope.ts`). Pure, so the pages and the service judge a scope the same way.
 *
 * Some things are refused when they are written: a sub-set with nothing said
 * about how it is separated, a cloud service left out. Others cannot be known
 * until the scope is complete - a scope with no end-user devices yet is simply
 * unfinished - so they are listed as findings to resolve before assessment.
 */

export const SCOPE_KINDS = ['whole_organisation', 'subset'] as const;
export type ScopeKind = (typeof SCOPE_KINDS)[number];

export const SCOPE_KIND_LABEL: Record<ScopeKind, string> = {
  whole_organisation: 'The whole organisation',
  subset: 'A sub-set of the organisation'
};

export function isScopeKind(value: unknown): value is ScopeKind {
  return (SCOPE_KINDS as readonly unknown[]).includes(value);
}

export function isOutOfScopeReason(value: unknown): value is OutOfScopeReason {
  return OUT_OF_SCOPE_REASONS.some((r) => r.value === value);
}

/** What the checks need to know about an asset. */
export type ScopeAsset = {
  id: string;
  reference: string;
  name: string;
  entityId: string;
  assetType: string;
  hosting: HostingModel | null;
  details: AssetDetailValues;
  retiredAt: Date | null;
};

/** An asset placed in or out of a scope. */
export type ScopePlacement = {
  assetId: string;
  inScope: boolean;
  reason: OutOfScopeReason | null;
  note: string | null;
};

/** Laptops, desktops, tablets and phones: the devices a scope cannot leave out. */
export const isEndUserDevice = (a: Pick<ScopeAsset, 'assetType'>) =>
  a.assetType === 'device';

/** A service run on a cloud provider's infrastructure, which no scope may exclude. */
export function isCloudService(
  a: Pick<ScopeAsset, 'assetType' | 'hosting' | 'details'>
): boolean {
  return (
    a.assetType === 'saas_application' ||
    a.hosting === 'saas' ||
    a.hosting === 'cloud' ||
    a.details.cloudModel !== undefined
  );
}

/** Why the scope as described cannot be saved, or null. */
export function scopeRefusal(scope: {
  name: string;
  kind: ScopeKind;
  segregation: string | null;
  entityIds: readonly string[];
}): string | null {
  if (!scope.name.trim()) return 'Give the scope a name.';
  if (scope.entityIds.length === 0)
    return 'Name at least one legal entity the certificate will cover.';
  if (scope.kind === 'subset' && !scope.segregation?.trim())
    return 'Say how the sub-set is separated from the rest of the organisation, by a firewall or VLAN: the assessor will ask.';
  return null;
}

/** Why an asset cannot be placed as asked, or null. */
export function placementRefusal(
  asset: Pick<ScopeAsset, 'assetType' | 'hosting' | 'details' | 'retiredAt'>,
  placement: Pick<ScopePlacement, 'inScope' | 'reason' | 'note'>
): string | null {
  if (placement.inScope) {
    if (asset.retiredAt)
      return 'A retired asset is out of use, so it cannot be in scope.';
    return null;
  }
  if (isCloudService(asset))
    return 'Cloud services that hold your data or run your services cannot be left out of a Cyber Essentials scope.';
  if (!placement.reason) return 'Say why it is out of scope.';
  if (placement.reason === 'other' && !placement.note?.trim())
    return 'Explain why it is out of scope: the assessor will ask.';
  if (
    asset.details.ownership === 'organisation' &&
    (placement.reason === 'third_party_owned' ||
      placement.reason === 'student_byod' ||
      placement.reason === 'byod_voice_text_mfa_only')
  )
    return 'The organisation owns it, and devices the organisation owns are in scope wherever they are, lent to others included.';
  return null;
}

export type ScopeFinding = {
  /** The scope rule or requirement it comes from. */
  code: string;
  message: string;
  /** The assets it is about, where it is about some. */
  assets: ReadonlyArray<Pick<ScopeAsset, 'id' | 'reference' | 'name'>>;
};

/**
 * What stands between the scope and an assessment.
 *
 * @param candidates the covered entities' assets, retired ones included
 */
export function scopeFindings(
  scope: { kind: ScopeKind },
  placements: readonly ScopePlacement[],
  candidates: readonly ScopeAsset[],
  at: Date
): ScopeFinding[] {
  const byId = new Map(candidates.map((a) => [a.id, a]));
  const placed = new Set(placements.map((p) => p.assetId));
  const inScope = placements
    .filter((p) => p.inScope)
    .flatMap((p) => byId.get(p.assetId) ?? []);
  const unplaced = candidates.filter((a) => !a.retiredAt && !placed.has(a.id));
  const findings: ScopeFinding[] = [];

  if (!inScope.some(isEndUserDevice))
    findings.push({
      code: 'SCOPE.END_USER_DEVICES',
      message:
        'No end-user devices are in scope. A scope must include the laptops, desktops, tablets or phones people use.',
      assets: []
    });

  const cloud = unplaced.filter(isCloudService);
  if (cloud.length)
    findings.push({
      code: 'SCOPE.CLOUD_INCLUDED',
      message:
        'Cloud services of the covered entities are not yet in scope, and cannot be left out.',
      assets: cloud
    });

  const rest = unplaced.filter((a) => !isCloudService(a));
  if (scope.kind === 'whole_organisation' && rest.length)
    findings.push({
      code: 'SCOPE.BOUNDARY',
      message:
        'The scope is the whole organisation, and these assets of the covered entities are neither in it nor left out with a reason.',
      assets: rest
    });

  const unsupported = inScope.filter(
    (a) => !a.retiredAt && outOfSupport(a.details, at)
  );
  if (unsupported.length)
    findings.push({
      code: 'SUM.REMOVE_UNSUPPORTED',
      message:
        'These are in scope and out of vendor support. Upgrade or replace them, or take them out of use.',
      assets: unsupported
    });

  const retired = inScope.filter((a) => a.retiredAt);
  if (retired.length)
    findings.push({
      code: 'SCOPE.BOUNDARY',
      message: 'These have been retired since they were put in scope.',
      assets: retired
    });

  return findings;
}
