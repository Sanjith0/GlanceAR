/**
 * Counts quick repeated taps for a hidden shortcut. `tap` returns true on the tap
 * that completes the run, then starts over. A pause longer than `gapMs` also starts over.
 */
export class TapCounter {
  private count = 0;
  private last = -Infinity;
  constructor(private readonly needed = 6, private readonly gapMs = 700) {}
  tap(now: number): boolean {
    this.count = now - this.last <= this.gapMs ? this.count + 1 : 1;
    this.last = now;
    if (this.count < this.needed) return false;
    this.count = 0;
    this.last = -Infinity;
    return true;
  }
}
