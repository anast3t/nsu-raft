import {Request, Response} from "express";
import {Resp} from "./Resp";

export class RespStack {
    private stack: Resp[];

    constructor() {
        this.stack = [];
    }

    push(lockReq: Response) {
        this.stack.push(new Resp(lockReq));
    }
    respFirst(msg?: string) {
        this.stack.shift()?.success(msg);
    }
    respAll(msg?: string) {
        this.stack.forEach(resp => resp.success(msg));
        this.stack = [];
    }
    rejectAll(msg?: string) {
        this.stack.forEach(resp => resp.fail(msg));
        this.stack = [];
    }
    isEmpty() {
        return this.stack.length === 0;
    }
}
