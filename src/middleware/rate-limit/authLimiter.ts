import type { Request, Response, NextFunction } from "express";
import { redis } from "../../config/redis.js";

interface AuthLimiterOptions {
    keyPrefix: string;
    limit: number;
    windowSeconds: number;
    banSeconds: number;
}

const getAuthIdentifier = (req: Request): string => {
    const apiKey = req.header('x-api-key');
    if (apiKey) return `key:${apiKey}`;

    const userId = req.user?.id; // only when previous auth middleware sets it
    if (userId) return `user:${userId}`;

    return `ip:${req.ip ?? 'unknown'}`

}

export default (options: AuthLimiterOptions) => {
    return async (req: Request, res: Response, next: NextFunction) => {
        const identifier = getAuthIdentifier(req);
        const key = `${options.keyPrefix}:${identifier}`;

        let count: number;

        try {
            count = await redis.incr(key);

            if (count === 1) {
                // first request, start normal window
                await redis.expire(key, options.windowSeconds, 'NX');
            } else if (count === options.limit + 1) {
                // surpasses the limit 
                // extend the TTL
                await redis.expire(key, options.banSeconds);
            }
        } catch (err) {
            // fail CLOSED, reject the request directly
            console.error('Auth rate limiter: Redis unavailable, rejecting', err);
            res.status(503).json({ error: "Service temporarily unavailable" });
            return;
        }

        if (count > options.limit) {
            const ttl = await redis.ttl(key);
            res.setHeader('Retry-After', ttl > 0 ? ttl : options.banSeconds);
            res.status(429).json({ error: "Too many attempts, try again later" });
            return;
        }

        next();

    }
}

