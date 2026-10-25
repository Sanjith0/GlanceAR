type RegistryEntry = { profileId: string; descriptors: object };

/** Compare only opaque ownership and immutable array identity, never template values. */
export function sameRecognitionRegistry(left: readonly RegistryEntry[], right: readonly RegistryEntry[]): boolean {
  if (left.length !== right.length) return false;
  const before = new Map(left.map(entry => [entry.profileId, entry.descriptors]));
  const after = new Map(right.map(entry => [entry.profileId, entry.descriptors]));
  return before.size === left.length && after.size === right.length
    && right.every(entry => before.get(entry.profileId) === entry.descriptors);
}

/**
 * A UI/session fence, not a recognition algorithm. Recreated query wrappers must
 * not restart a hold, but replacement scans and changed permissions must do so.
 */
export class RecognitionScope {
  private key: string | null = null;
  private registry: RegistryEntry[] = [];
  private boundary = 0;
  private version = 0;

  get generation(): number { return this.version; }

  update(key: string, registry: readonly RegistryEntry[], now: number): boolean {
    if (this.key === key && sameRecognitionRegistry(this.registry, registry)) return false;
    this.key = key;
    this.registry = registry.map(entry => ({ profileId: entry.profileId, descriptors: entry.descriptors }));
    this.invalidate(now);
    return true;
  }

  invalidate(now: number): void {
    this.version += 1;
    this.boundary = now;
  }

  isCurrent(generation: number): boolean { return generation === this.version; }

  acceptsFrame(sampledAt: number): boolean {
    return Number.isFinite(sampledAt) && sampledAt >= this.boundary;
  }
}
