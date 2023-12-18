import {LogEntry} from "../types";
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
        customLog(this.storagePrefix, "SET", key, value)
        this.storage.set(key, value);
        customLog(this.storagePrefix,"STORAGE STATE", this.storage)
    }
}
