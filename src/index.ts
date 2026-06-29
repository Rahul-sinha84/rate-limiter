import { createApp } from './app.js';
import { env } from './config/env.js';
import { connectRedis, disconnectRedis } from './config/redis.js';

const app = createApp();
await connectRedis();

const server = app.listen(env.PORT, () => {
    console.warn(`🚀 Server running on http://localhost:${env.PORT} [${env.NODE_ENV}]`);
});

function shutdown(signal: string): void {
    console.warn(`${signal} received, shutting down gracefully`);
    server.close(() => {
        void disconnectRedis().finally(() => process.exit(0))
    });
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));