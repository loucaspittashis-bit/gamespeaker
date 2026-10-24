// Fixed-window counter per key (IP address or user id). Small and in-memory:
// this server has a handful of users, so nothing needs to survive restarts.
export class RateLimiter {
  private hits = new Map<string, { count: number; resetAt: number }>();
  private readonly limit: number;
  private readonly windowMs: number;

  constructor(limit: number, windowMs: number) {
    this.limit = limit;
    this.windowMs = windowMs;
  }

  /** Records a hit. Returns false once the key is over the limit for this window. */
  hit(key: string, now = Date.now()): boolean {
    const entry = this.hits.get(key);
    if (!entry || entry.resetAt <= now) {
      this.hits.set(key, { count: 1, resetAt: now + this.windowMs });
      this.sweep(now);
      return true;
    }
    entry.count += 1;
    return entry.count <= this.limit;
  }

  retryAfterSec(key: string, now = Date.now()): number {
    const entry = this.hits.get(key);
    return entry ? Math.max(1, Math.ceil((entry.resetAt - now) / 1000)) : 0;
  }

  reset(key: string): void {
    this.hits.delete(key);
  }

  private sweep(now: number): void {
    if (this.hits.size < 1000) return;
    for (const [key, entry] of this.hits) if (entry.resetAt <= now) this.hits.delete(key);
  }
}
