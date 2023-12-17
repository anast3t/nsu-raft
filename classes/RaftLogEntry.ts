import {LogEntry} from "../types";

export class RaftLogEntry {
    private logEntries: LogEntry[] = [{
        term: 0,
        command: {
            key: "init",
            value: "init"
        }
    }];
    private _commitIndex: number = 1;
    private _lastApplied: number = 0;
    private nextIndex: Map<string, number> = new Map();
    private matchIndex: Map<string, number> = new Map();

    get commitIndex(): number {
        return this._commitIndex;
    }

    get lastApplied(): number {
        return this._lastApplied;
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

    public reinitIndex(clients: string[]) {
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

    get prevIndex(): number {
        return this.logEntries.length - 1;
    }

    get prevTerm(): number {
        return this.logEntries[this.prevIndex].term;
    }

    public push(logEntry: LogEntry, prevLogIndex: number, prevLogTerm: number): boolean {
        /*
        1. Reply false if term < currentTerm (§5.1) (проверять выше)

        2. Reply false if log doesn’t contain an entry at prevLogIndex
        whose term matches prevLogTerm (§5.3) (проверить тут через get)

        3. If an existing entry conflicts with a new one (same index
        but different terms), delete the existing entry and all that
        follow it (§5.3)

        4. Append any new entries not already in the log

        5. If leaderCommit > commitIndex, set commitIndex = min(leaderCommit, index of last new entry)
        */

        if (this.get(prevLogIndex)?.term != prevLogTerm) {
            return false;
        }

        this.logEntries.push(logEntry);

        return true;
    }

}
