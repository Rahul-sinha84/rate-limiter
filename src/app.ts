import express, { type Express } from 'express';
import { router } from './routes/index.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { fixedWindowRateLimiter } from './middleware/rate-limit/fixedWindow.js';

export function createApp(): Express {
    const app = express();
    app.use(express.json());
    app.use(fixedWindowRateLimiter({
        keyPrefix: 'rl:global',
        windowSeconds: 60,
        max: 10
    }));
    
    app.use('/api/test', router.testRoute);
    app.use('/api/auth', router.authRoute)
    
    app.use(notFoundHandler);
    app.use(errorHandler);
    return app;
}