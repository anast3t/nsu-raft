import {LockRequest, LogEntry} from "../types";
import {customLog} from "../utils";
export class RaftStorage {
    private _storage: Map<string, string> = new Map();

    private storagePrefix = "💽 STORAGE"

    get storage (){
        return this._storage;
    }

    public get(key: string): string | undefined {
        return this.storage.get(key);
    }

    public set(key: string, value: string) {
        customLog(this.storagePrefix, "Set", key, value)
        this.storage.set(key, value);
        customLog(this.storagePrefix,"Storage state", this.storage)
    }

    public check_if_empty(key: string) {
        return !this.get(key);
    }

    public check_if_equals(key: string, value: string) {
        customLog(this.storagePrefix, "Check if equals", this.get(key), value)
        return this.get(key) === value;
    }

    get lock(): LockRequest | undefined {
        return JSON.parse(this.storage.get("locked_by")??"{}") as LockRequest
    }

    public deleteLock() {
        this.storage.delete("locked_by")
    }
}
