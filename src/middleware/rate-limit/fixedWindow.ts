import type { Request, Response, NextFunction } from "express";
import { defaultKeyGenerator, type RateLimitOptions } from "./types.js";
import { redis } from "../../config/redis.js";

export interface FixedWindowOptions extends RateLimitOptions {
    max: number;
    windowSeconds: number;
}

export const fixedWindowRateLimiter = (options: FixedWindowOptions) => {
    const keyGenerator = options.keyGenerator ?? defaultKeyGenerator;
    const failureMode = options.failureMode ?? 'open';

    return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        const nowSeconds = Math.floor(Date.now() / 1000);
        const windowIndex = Math.floor(nowSeconds / options.windowSeconds);
        const windowResetAt = (windowIndex + 1) * options.windowSeconds;

        const identifier = keyGenerator(req);
        const key = `${options.keyPrefix}:${identifier}:${windowIndex}`;

        let count: number;
        try {
            count = await redis.incr(key);
            await redis.expire(key, options.windowSeconds, 'NX');
        } catch (err) {
            console.error('Rate limiter: Redis error, failing', failureMode, err);
            if (failureMode === 'closed') {
                res.status(503).json({ error: 'Rate limiter unavailable' });
                return;
            }
            next();
            return;
        }

        const remaining = Math.max(options.max - count, 0);
        res.setHeader('RateLimit-Limit', options.max);
        res.setHeader('RateLimit-Remaining', remaining);
        res.setHeader('RateLimit-Reset', windowResetAt);

        if (count > options.max) {
            const retryAfter = windowResetAt - nowSeconds;
            res.setHeader('Retry-After', retryAfter);
            res.status(429).json({ error: 'Too many requests', retryAfter });
            return;
        }
        next();
    }
}