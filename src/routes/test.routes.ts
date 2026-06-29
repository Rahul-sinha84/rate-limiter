import { Router } from "express";

const testRoute = Router();

testRoute.get("/", (_, response) => {
    try {
        response.status(200).json({
            message: "ok"
        })
    } catch (err: unknown) {
        response.status(500).json({
            message: "Error",
            err
        })
    }
})

export default testRoute;