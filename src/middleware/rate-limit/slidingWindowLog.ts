import type { Request, Response, NextFunction } from "express";
import { defaultKeyGenerator, type RateLimitOptions } from "./types.js";
import { redis } from "../../config/redis.js";

// for lua script
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const luaScript = readFileSync(join(__dirname, "slidingWindowLog.lua"), 'utf-8');

export interface SlidingWindowLogOptions extends RateLimitOptions {
    max: number;
    windowSeconds: number;
}

export const slidingWindowLogRateLimiter = (options: SlidingWindowLogOptions) => {
    const keyGenerator = options.keyGenerator ?? defaultKeyGenerator;
    const failureMode = options.failureMode ?? 'open';

    return async (req: Request, res: Response, next: NextFunction) => {
        // const startTimestamp = new Date().getTime();
        const identifier = keyGenerator(req);
        const key = `${options.keyPrefix}:${identifier}`;
        const nowTimestamp = new Date().getTime();
        const windowStartTimestampFromNow = (nowTimestamp - (options.windowSeconds * 1000));
        let count: number;
        let isAllowed: boolean;

        try {
            // lua script for atomic transaction
            const result = await redis.eval(luaScript, {
                keys: [key],
                arguments: [
                    String(windowStartTimestampFromNow),
                    String(options.max),
                    String(nowTimestamp),
                    `${nowTimestamp}-${Math.random().toString(36).slice(2, 8)}`,

                ]
            })

            const [redisCount, allowedFlag] = result as [number, number];

            isAllowed = allowedFlag === 1;
            count = redisCount;

            // * below is the code without lua script
            // * not handling concurrency calls
            // // removing old entries first
            // await redis.zRemRangeByScore(key, '-inf', windowStartTimestampFromNow);

            // // counting the remaining ones
            // count = await redis.zCount(key, windowStartTimestampFromNow, '+inf');

            // isAllowed = count < options.max;

            // if (isAllowed) {
            //     // adding the entry
            //     await redis.zAdd(key, {
            //         score: nowTimestamp,
            //         // appending with random value for avoiding the overwrites during concurrency
            //         value: `${nowTimestamp}-${Math.random().toString(36).slice(2, 8)}`
            //     })
            //     count++;
            // } else {
            //     // max reached, 429 error response
            // }

            // refreshing the TTL of the identifier
            // ? not putting this into the lua script as even concurrent
            // ? calls would have no severe effect here
            await redis.expire(key, options.windowSeconds);
        } catch (err) {
            console.error('Rate limiter: Redis error, failing', failureMode, err);
            if (failureMode === 'closed') {
                res.status(503).json({ error: 'Rate limiter unavailable' });
                // const endTimestamp = new Date().getTime();
                // console.log({ diff: endTimestamp - startTimestamp, startTimestamp, endTimestamp });
                return;
            }
            // const endTimestamp = new Date().getTime();
            // console.log({ diff: endTimestamp - startTimestamp, startTimestamp, endTimestamp });
            next();
            return;
        }

        const remaining = Math.max(options.max - count, 0);

        const resetTimestamp = (nowTimestamp) + (options.windowSeconds * 1000);

        res.setHeader("RateLimit-Limit", options.max);
        res.setHeader("RateLimit-Remaining", remaining)
        res.setHeader("RateLimit-Reset", Math.ceil(resetTimestamp / 1000));

        if (!isAllowed) {
            const retryAfter = Math.ceil(Math.max(resetTimestamp - nowTimestamp, 0) / 1000);
            res.setHeader("Retry-After", retryAfter);
            res.status(429).json({ error: "Too many requests", retryAfter });
            // const endTimestamp = new Date().getTime();
            // console.log({ diff: endTimestamp - startTimestamp, startTimestamp, endTimestamp });
            return;
        }
        // const endTimestamp = new Date().getTime();
        // console.log({ diff: endTimestamp - startTimestamp, startTimestamp, endTimestamp });
        next();
    }
}