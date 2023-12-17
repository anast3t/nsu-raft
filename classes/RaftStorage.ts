import {LogEntry} from "../types";
export class RaftStorage {
    private storage: Map<string, string> = new Map([["init", "init"]]);

    public get(key: string): string | undefined {
        return this.storage.get(key);
    }

    public set(key: string, value: string) {
        this.storage.set(key, value);
    }

    public delete(key: string) {
        this.storage.delete(key);
    }

    public has(key: string): boolean {
        return this.storage.has(key);
    }

    public clear() {
        this.storage.clear();
    }

    public size(): number {
        return this.storage.size;
    }

    public keys(): string[] {
        return Array.from(this.storage.keys());
    }

    public values(): string[] {
        return Array.from(this.storage.values());
    }
}
