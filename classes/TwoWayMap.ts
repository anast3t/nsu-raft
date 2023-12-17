export class TwoWayMap<T, V> {
    private forwardMap: Map<T, V> = new Map();
    private reverseMap: Map<V, T> = new Map();

    public set(key: T, value: V) {
        this.forwardMap.set(key, value);
        this.reverseMap.set(value, key);
    }

    public get(key: T): V | undefined {
        return this.forwardMap.get(key);
    }

    public rGet(key: V): T | undefined {
        return this.reverseMap.get(key);
    }

    public delete(key: T) {
        const value = this.forwardMap.get(key);
        if(value === undefined) return;
        this.forwardMap.delete(key);
        this.reverseMap.delete(value);
    }

    public has(key: T): boolean {
        return this.forwardMap.has(key);
    }

    public clear() {
        this.forwardMap.clear();
        this.reverseMap.clear();
    }

    public size(): number {
        return this.forwardMap.size;
    }


    public keys(): T[] {
        return Array.from(this.forwardMap.keys());
    }

    public rKeys(): V[] {
        return Array.from(this.reverseMap.keys());
    }


    public values(): V[] {
        return Array.from(this.forwardMap.values());
    }

    public rValues(): T[] {
        return Array.from(this.reverseMap.values());
    }


    public entries(): [T, V][] {
        return Array.from(this.forwardMap.entries());
    }

    public rEntries(): [V, T][] {
        return Array.from(this.reverseMap.entries());
    }

    public toString(): string {
        return `TwoWayMap(${this.entries().map(([key, value])=>`${key} => ${value}`).join(", ")})`
    }
}
