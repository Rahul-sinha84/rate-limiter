import { createClient } from "redis";
import { env } from "./env.js";

export const redis = createClient({
    url: env.REDIS_URL,
    socket: {
        reconnectStrategy: (retries) => Math.min(retries * 50, 5000),
    }
})

redis.on("error", err => console.error("Redis client error", err));

export const connectRedis = async (): Promise<void> => {
    await redis.connect();
}

export async function disconnectRedis(): Promise<void> {
    await redis.quit();
}