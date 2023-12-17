import express, {Express, Request, Response} from "express";
import cors from "cors";
import general from "./routes/general";
import swaggerUi from 'swagger-ui-express';
// @ts-ignore
import swaggerJSON from './swagger_output.json';
const app: Express = express();
const port = parseInt(process.env.EXPRESSPORT as string);

export default async () => {
    app.use(cors());
    app.use('/doc', swaggerUi.serve, swaggerUi.setup(swaggerJSON))

    app.use((req, res, next) => {
        let date = new Date().toUTCString()
        console.log('📦 [request]')
        console.log('-- Time:', date)
        console.log('-- Req:', req.method, req.url)
        next()
    })

    app.use(express.json())
    app.use('/', general)
    app.listen(port, () => {
        console.log(`⚡️ [server]: Server is running at http://localhost:${port}`);
    });
}

export {
    app
}
