import {LockRespStackElement} from "../types";

export class LockRespStack {
    private stack: LockRespStackElement[] = [];

    constructor() {
        this.stack = [];
    }

    get first(){
        return this.stack[0]
    }

    push(lockReq: LockRespStackElement) {
        this.stack.push(lockReq);
    }

    respFirst(msg?: string) {
        this.stack.shift()?.resp.success(msg);
    }
    respAll(msg?: string) {
        this.stack.forEach(el => el.resp.success(msg));
        this.stack = [];
    }
    rejectAll(msg?: string) {
        this.stack.forEach(el => el.resp.fail(msg));
        this.stack = [];
    }
    isEmpty() {
        return this.stack.length === 0;
    }

    public toString(){
        return '[' + this.stack.map(el => el.id).join(", ") + ']'
    }
}
