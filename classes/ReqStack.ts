import {Request, Response} from "express";

export class ReqStack {
    private stack: Response[];

    constructor() {
        this.stack = [];
    }

    push(lockReq: Response) {
        this.stack.push(lockReq);
    }
    respFirst(msg?: string) {
        this.stack.shift()?.status(200).send(msg);
    }
    respAll(msg?: string) {
        this.stack.forEach(resp => resp.status(200).send(msg));
        this.stack = [];
    }
    isEmpty() {
        return this.stack.length === 0;
    }
}
