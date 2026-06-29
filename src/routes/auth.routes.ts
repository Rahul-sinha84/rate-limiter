import { type Request, type Response, Router } from "express";
import authLimiter from "../middleware/rate-limit/authLimiter.js";

const authRoute = Router();

authRoute.use(authLimiter({
    banSeconds: 30,
    keyPrefix: "rl:auth",
    limit: 5,
    windowSeconds: 30
}));

authRoute.get("/", (_: Request, res: Response) => {
    try {
        res.status(200).json({
            message: "ok"
        })
    } catch (err) {
        res.status(500).json({
            message: "error",
            err
        })
    }
})

export default authRoute;