import { Response } from "express";

export class Resp{
    private resp: Response;
    constructor(resp: Response){
        this.resp = resp;
    }
    success(msg?: string){
        this.resp.status(200).send(msg);
    }
    fail(msg?: string){
        this.resp.status(400).send(msg);
    }
}
