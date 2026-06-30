# Redis Rate Limiting — Strategy Implementations in TypeScript

A reference implementation of three distinct rate limiting strategies, each backed by Redis, built to compare their trade-offs in practice rather than just in theory. The Express/TypeScript setup around them is intentionally minimal — it exists to give the limiters somewhere real to run, not as the focus of this project.

## Why this exists

Most rate limiter tutorials show one algorithm in isolation. This project implements three side by side against the same Redis instance, so the actual differences in behavior, atomicity requirements, and failure handling are visible and testable — not just described.

## The three strategies

### 1. Fixed Window Counter
`src/middleware/rate-limit/fixedWindow.ts`

The simplest approach: time is sliced into fixed-size windows aligned to the clock (e.g. every 60 seconds, on the minute). Each caller gets one counter per window, incremented via Redis `INCR`. The window's identity lives in the Redis key itself (`prefix:identifier:windowIndex`), so resets happen automatically — there's no explicit "clear the counter" step.

- **Atomicity:** `INCR` alone is sufficient; no multi-step race exists here.
- **Known weakness:** a caller can spend their full limit in the last instant of one window and again in the first instant of the next, briefly allowing up to 2x the intended rate across a boundary.
- **Failure mode:** fails *open* — if Redis is unreachable, traffic is allowed through rather than blocking the whole API.
- **Applied:** globally, via `app.use()` in `app.ts`, as a broad backstop against abuse.

### 2. Fixed Window + Escalating Ban (Auth Limiter)
`src/middleware/rate-limit/authLimiter.ts`

Same windowing mechanism as above, but with a punitive twist suited to sensitive endpoints (login, password reset): crossing the limit doesn't just reject the request, it extends that key's TTL into a much longer ban period. The ban is only ever triggered on the *exact* transition into violation (`count === limit + 1`) — never re-extended on subsequent rejected requests — so a caller can't keep resetting their own ban clock by retrying.

- **Atomicity:** the increment is safe by construction (`INCR` never returns the same value twice), so the transition can only ever be detected once per ban cycle. No Lua script needed here.
- **Failure mode:** fails *closed* — if Redis is unreachable, requests are rejected rather than letting unlimited auth attempts through unmetered.
- **Applied:** scoped to auth routes only, in `routes/auth.routes.ts`.

### 3. Sliding Window Log
`src/middleware/rate-limit/slidingWindowLog.ts` + `slidingWindowLog.lua`

The most precise of the three. Every request is logged as a timestamped entry in a Redis sorted set (ZSET). On each request: expired entries are trimmed, the remainder is counted, and a new entry is conditionally added — all inside a single Lua script executed atomically via `EVAL`.

This one *needs* the Lua script, unlike the other two: the decision ("is this caller under the limit?") depends on a read (`ZCOUNT`) followed by a conditional write (`ZADD`), and those two steps aren't atomic against each other if run as separate Redis calls — concurrent requests could all read the same pre-write count and all be allowed through, overshooting the limit. Wrapping trim + count + conditional add in one Lua script closes that gap, since the entire sequence runs server-side as one indivisible unit.

- **Atomicity:** required and implemented via Lua (`slidingWindowLog.lua`).
- **Advantage over fixed window:** no boundary effect — the window slides continuously per caller rather than resetting at shared clock instants.
- **Cost:** more Redis work per request (a script execution plus a separate `EXPIRE` call) and more storage per caller (one sorted set entry per request in the window, versus a single counter).
- **Applied:** `routes/test.routes.ts`, used here as the demonstration/testing route for this strategy.

## Shared design decisions across all three

- **Identifier precedence:** API key > authenticated user ID > IP address, in that order — IP is the weakest signal (shared NAT/proxies can group unrelated users; trivial to rotate to evade) and is only used as a last resort for anonymous callers.
- **Response headers:** all three set `RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset`, and (on rejection) `Retry-After`, following the conventions of the IETF RateLimit header draft.
- **Configurable failure mode:** each limiter takes a `failureMode: 'open' | 'closed'` option, since whether a Redis outage should fail safe-and-permissive or safe-and-restrictive depends on what's being protected, not a one-size-fits-all default.

## Verifying the atomicity claim

The sliding window log's correctness under concurrency isn't just asserted — it's tested. `test.routes.ts` exposes the sliding window limiter behind a low `max` for exactly this purpose: firing many concurrent requests at it (see the load-test script used during development) and confirming the number of *allowed* responses never exceeds the configured limit, and that the underlying Redis sorted set (`ZCARD`) never holds more entries than `max` at once, even under deliberate concurrent bursts.

## Project Structure
\`\`\`
src/
├── app.ts                        # Express app setup and middleware registration
├── index.ts                      # Server entry point
│
├── config/                       # Environment variables and external client configuration
│   ├── env.ts
│   └── redis.ts
│
├── middleware/                   # Express middleware, including all rate-limiting strategies
│   ├── errorHandler.ts
│   └── rate-limit/
│       ├── authLimiter.ts
│       ├── fixedWindow.ts
│       ├── slidingWindowLog.lua
│       ├── slidingWindowLog.ts
│       └── types.ts
│
├── routes/                       # Route definitions grouped by domain
│   ├── index.ts
│   ├── auth.routes.ts
│   └── test.routes.ts
│
├── services/                     # Thin wrappers around external services (Redis)
│   └── redis/
│       └── connection.ts
│
├── types/                        # Global TypeScript type augmentations
│   └── express.d.ts
│
└── utils/                        # Shared utility classes and helpers
\`\`\`

## Setup

\`\`\`bash
npm install
cp .env.example .env
npm run dev
\`\`\`

Requires a running Redis instance — local (\`redis://localhost:6379\`) or managed (\`rediss://...\`).