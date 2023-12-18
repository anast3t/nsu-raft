import {AppendEntriesRequest, LogEntry} from "../types";

export class RaftLogEntry {
    private _logEntries: LogEntry[] = [{
        term: 0,
        command: {
            key: "init",
            value: "init"
        }
    }];
    private _commitIndex: number = 1;
    private _lastApplied: number = 0;
    private nextIndex: Map<number, number> = new Map();
    private matchIndex: Map<number, number> = new Map();

    get commitIndex(): number {
        return this._commitIndex;
    }

    get lastApplied(): number {
        return this._lastApplied;
    }

    get logEntries(): LogEntry[] {
        return this._logEntries;
    }

    /*
        • If command received from client: append entry to local log,
          respond after entry applied to state machine (§5.3)
        • If last log index ≥ nextIndex for a follower: send
          AppendEntries RPC with log entries starting at nextIndex
        • If successful: update nextIndex and matchIndex for
          follower (§5.3)
        • If AppendEntries fails because of log inconsistency:
          decrement nextIndex and retry (§5.3)
    */

    public reinitIndex(clients: number[]) {
        this.nextIndex.clear();
        this.matchIndex.clear();
        clients.forEach(client => {
            this.nextIndex.set(client, this.prevIndex + 1);
            this.matchIndex.set(client, 0);
        });
    }

    public get(index: number): LogEntry | undefined {
        return this.logEntries[index];
    }

    public getLogTerm(index: number): number | undefined {
        return this.logEntries[index]?.term;
    }

    public getEntriesFrom(index: number): LogEntry[] {
        return this.logEntries.slice(index);
    }

    public getNextIndex(client: number): number {
        return this.nextIndex.get(client) ?? 0;
    }

    public getMatchIndex(client: number): number {
        return this.matchIndex.get(client) ?? 0;
    }

    public setNextIndex(client: number, index: number) {
        this.nextIndex.set(client, index);
    }

    public setMatchIndex(client: number, index: number) {
        this.matchIndex.set(client, index);
    }

    get prevIndex(): number {
        return this.logEntries.length - 1;
    }

    get prevTerm(): number {
        return this.logEntries[this.prevIndex].term;
    }

    public push(
        data: AppendEntriesRequest
    ): boolean {
        /*
        1. Reply false if term < currentTerm (§5.1) (проверять выше)

        2. Reply false if log doesn’t contain an entry at prevLogIndex
        whose term matches prevLogTerm (§5.3) (проверить тут через get)

        3. If an existing entry conflicts with a new one (same index
        but different terms), delete the existing entry and all that
        follow it (§5.3) (ОНИ ЗАТРУТСЯ САМОСТОЯТЕЛЬНО)

        4. Append any new entries not already in the log

        5. If leaderCommit > commitIndex, set commitIndex = min(leaderCommit, index of last new entry)
        */

        if (this.get(data.prevLogIndex)?.term != data.prevLogTerm) {
            return false;
        }

        data.entries.forEach(el => {
            this.logEntries.push(el);
        })

        if (this.commitIndex < data.leaderCommit){
            this._commitIndex = Math.min(data.leaderCommit, this.prevIndex);
        }

        return true;
    }

    public leaderPush (logEntry: LogEntry) {
        this.logEntries.push(logEntry);
        this._commitIndex++
    }

}
