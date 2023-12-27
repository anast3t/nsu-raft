import {AppendEntriesRequest, LogEntry, MyLock, Role} from "../types";
import {RaftStorage} from "./RaftStorage";
import {customLog} from "../utils";
import {lockRespStack, unlockRespStack} from "../initExpress";
import {raftNode} from "../initRaftNode";

export class RaftLogEntry {
    private _logEntries: LogEntry[] = [{
        term: 0,
        command: {
            key: "",
            value: ""
        }
    }]; //INDEX FROM 1
    private _commitIndex: number = 0;
    private _lastApplied: number = 0;
    private nextIndex: Map<number, number> = new Map();
    private matchIndex: Map<number, number> = new Map();

    private commitPrefix = "💾 COMMIT"

    private storage: RaftStorage;

    constructor(storage: RaftStorage) {
        this.storage = storage;
    }

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

    public getLogTerm(index: number): number {
        return this.logEntries[index]?.term ?? 0;
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
        return Math.max(this.logEntries.length - 1, 0);
    }

    get prevTerm(): number {
        return Math.max(this.logEntries[this.prevIndex].term, 0);
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

        if (data.prevLogTerm !== 0 && this.get(data.prevLogIndex)?.term != data.prevLogTerm) {
            return false;
        }

        data.entries.forEach(el => {
            this.logEntries.push(el);
        })

        if (this.commitIndex < data.leaderCommit) {
            this._commitIndex = Math.min(data.leaderCommit, this.prevIndex);
            this.pushToStorage()
        }

        return true;
    }

    public leaderPush(logEntry: LogEntry) {
        this.logEntries.push(logEntry);
    }

    public leaderTryCommit() {
        const totalLen = this.matchIndex.size
        const res: object = Array
            .from(this.matchIndex.values())
            .filter(el => el > this.commitIndex)
            .reduce(function (acc: any, curr) {
                acc[curr] ? ++acc[curr] : acc[curr] = 1
                return acc
            }, {})

        const matchingLen = Math.max(...Object.values(res), 0);

        customLog(this.commitPrefix,"Got", res, "from", Array.from(this.matchIndex.values()), "with", matchingLen, "when total", totalLen)


        if (matchingLen + 1 > totalLen / 2) {
            this._commitIndex = Math.max(...Array.from(this.matchIndex.values()));
            this.pushToStorage();
            customLog(this.commitPrefix,"Committed", this._commitIndex)
        } else {
            customLog(this.commitPrefix,"NOT COMMITTED")
        }
    }

    private pushToStorage() {
        const start = this.lastApplied;
        const end = this.commitIndex;
        for (let i = start + 1; i <= end; i++) {
            const entry = this.logEntries[i];
            let unlockFlag = false
            if(entry.command.key === "locked_by"){
                if(entry.command.value !== "{}") {
                    customLog(this.commitPrefix,"Got lock", entry.command.value, "from", entry.command.key)
                    const data = JSON.parse(entry.command.value) as MyLock

                    if(!this.storage.lockExists()){
                        customLog(this.commitPrefix,"Locking on", raftNode.role, data.id, raftNode.selfPort, data.id == raftNode.selfPort)
                        if(raftNode.role === Role.Leader){
                            lockRespStack.respFirst("Locked")
                            raftNode.acceptUpdates()
                            raftNode.startUnlockTimeout(
                                (data.time - Date.now()/1000)*1000,
                            )
                        }
                        if (data.id == raftNode.selfPort){
                            raftNode.startLockUpdateInterval()
                        }
                    }

                } else {
                    customLog(this.commitPrefix,"Unlocked", lockRespStack.toString())

                    if(raftNode.role === Role.Leader){
                        unlockRespStack.respAll("Unlocked")
                        raftNode.stopUnlockTimeout()
                        unlockFlag = true
                    }
                    raftNode.stopLockUpdateInterval()
                }
            }

            this.storage.set(entry.command.key, entry.command.value);

            if(!lockRespStack.isEmpty() && unlockFlag)
                raftNode.lock(lockRespStack.first.id)
        }
        this._lastApplied = end;
        customLog(this.commitPrefix,"Pushed to storage", Array.from(this.storage.storage.entries()))
    }
}
