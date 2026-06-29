import type { Request } from "express";

export interface RateLimitOptions {
    keyPrefix: string;
    keyGenerator?: (req: Request) => string;
    failureMode?: 'open' | 'closed'; // 'open': let traffic through if redis is down
}

export const defaultKeyGenerator = (req: Request): string => req.ip ?? 'unknown';

