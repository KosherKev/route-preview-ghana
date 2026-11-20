// Counts Mapillary API calls and rate-limit events without ever recording a URL, header value other than Retry-After,
// or the token. Wraps a fetch implementation; pass `fetchImpl` and `sleep` to MapillarySource.
export interface RateLimitEvent { atCall: number; status: number; retryAfter: string | null }

export interface CallStats {
  calls: number;
  byStatus: Record<string, number>;
  networkErrors: number;
  /** Responses with status 429 (rate limited) or >= 500 (retried by the client). */
  retriedResponses: number;
  rateLimitEvents: RateLimitEvent[];
  /** Total time slept for retries/back-off (waits longer than the throttle interval), in ms. */
  backoffWaitMs: number;
}

export class CallMeter {
  readonly stats: CallStats = { calls: 0, byStatus: {}, networkErrors: 0, retriedResponses: 0, rateLimitEvents: [], backoffWaitMs: 0 };

  constructor(private readonly minIntervalMs: number) {}

  wrapFetch(inner: typeof fetch): typeof fetch {
    return (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      this.stats.calls++;
      let res: Response;
      try {
        res = await inner(input, init);
      } catch (e) {
        this.stats.networkErrors++;
        throw e;
      }
      const k = String(res.status);
      this.stats.byStatus[k] = (this.stats.byStatus[k] ?? 0) + 1;
      if (res.status === 429 || res.status >= 500) {
        this.stats.retriedResponses++;
        if (res.status === 429) this.stats.rateLimitEvents.push({ atCall: this.stats.calls, status: 429, retryAfter: res.headers.get("retry-after") });
      }
      return res;
    }) as typeof fetch;
  }

  wrapSleep(inner: (ms: number) => Promise<void>): (ms: number) => Promise<void> {
    return (ms) => {
      if (ms > this.minIntervalMs) this.stats.backoffWaitMs += ms;
      return inner(ms);
    };
  }
}
