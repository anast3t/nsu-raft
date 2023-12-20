import {AppendEntriesRequest, LockEvent, LockRequest, LogEntry, Role} from "../types";
import {RaftStorage} from "./RaftStorage";
import {customLog} from "../utils";
import {RaftNode} from "./RaftNode";
import {answerLateAnswer} from "../initExpress";

export class RaftLogEntry {
    private _logEntries: LogEntry[] = [{
        term: 0,
        command: {
            key: "init",
            value: "init"
        }
    }]; //INDEX FROM 1
    private _commitIndex: number = 0;
    private _lastApplied: number = 0;
    private nextIndex: Map<number, number> = new Map();
    private matchIndex: Map<number, number> = new Map();
    private raftNode: RaftNode;

    private lockCommitIndex: number = 0;

    private commitPrefix = "💾 COMMIT"
    private lockPrefix = "🔒 LOCK"

    private storage: RaftStorage;

    constructor(storage: RaftStorage, node: RaftNode) {
        this.storage = storage;
        this.raftNode = node;
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

    get prevIndex(): number {
        return Math.max(this.logEntries.length - 1, 0);
    }

    get prevTerm(): number {
        return Math.max(this.logEntries[this.prevIndex].term, 0);
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

    public followerPush(
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
            let jsonEl: LockRequest | undefined = undefined
            customLog(this.lockPrefix, "Checking EL IN APPENDIX CHECK", el)
            try{
                jsonEl = JSON.parse(el.command.value) as LockRequest
                let jsonApendix = JSON.parse(this.raftNode.appendixLogEntry?.command.value??"") as LockRequest
                customLog(this.lockPrefix, "Checking appendix", jsonEl, jsonApendix)
                if(el.command.key === "locked_by" &&
                    jsonEl.id == jsonApendix.id &&
                    jsonEl.time == jsonApendix.time
                ){
                    customLog(this.lockPrefix, "Lock committed, CLEARING APPENDIX", el)
                    this.lockCommitIndex = this.logEntries.length - 1
                    this.raftNode.appendixLogEntry = undefined
                }
            } catch(e){

            }

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
            this.storage.set(entry.command.key, entry.command.value);
        }
        this._lastApplied = end;
        customLog(this.lockPrefix, "Lock commit index", this.lockCommitIndex, "start", start, "end", end)
        if(this.lockCommitIndex > start && this.lockCommitIndex <= end){
            this.lockCommitIndex = 0
            customLog(this.lockPrefix,
                this.storage.lock,
                this.storage.lock?.event === LockEvent.Lock,
                this.storage.lock?.event == LockEvent.Lock,
                this.storage.lock?.event == 0,
                this.storage.lock?.event
            )
            if(this.storage.lock?.event === LockEvent.Update){
                customLog(this.lockPrefix, "Got Update in Log")
                if(this.raftNode.state.role === Role.Leader){
                    this.raftNode.refreshUnlockTimeout()
                }
            }
            else if(this.storage.lock?.event === LockEvent.Unlock){
                customLog(this.lockPrefix, "Got Unlock in Log")
                if(this.raftNode.state.role === Role.Leader)
                    this.raftNode.clearUnlockTimeout()
                else if(this.raftNode.selfPort == this.storage.lock.id){
                    this.raftNode.clearUpdateLockInterval()
                    this.raftNode.clearDropLockRequestTimeout()
                    answerLateAnswer(this.raftNode.selfPort, true)
                }
                this.storage.deleteLock()
            } else if(this.storage.lock?.event === LockEvent.Lock){
                customLog(this.lockPrefix, "Got Lock in Log")
                if(this.raftNode.state.role === Role.Leader){
                    this.raftNode.startUnlockTimeout()
                }
                if(this.raftNode.selfPort == this.storage.lock.id){
                    this.raftNode.clearDropLockRequestTimeout()
                    answerLateAnswer(this.raftNode.selfPort, true)
                    this.raftNode.startUpdateLockInterval()
                }
                customLog(this.lockPrefix, "Lock timeout started")
            }
        }
        customLog(this.commitPrefix,"Pushed to storage", Array.from(this.storage.storage.entries()))
    }

    public leaderSetIfEmpty(logEntry: LogEntry) {
        if(this.storage.check_if_empty(logEntry.command.key)){
            customLog(this.commitPrefix, "SIE success")

            const lockData = JSON.parse(logEntry.command.value) as LockRequest
            const lockDataShort = {
                id: lockData.id,
                time: lockData.time,
                event: lockData.event
            } as LockRequest

            const customLogEntry: LogEntry = {
                term: logEntry.term,
                command: {
                    key: logEntry.command.key,
                    value: JSON.stringify(lockDataShort)
                }
            }

            this.leaderPush(customLogEntry)
            return true
        }
        customLog(this.commitPrefix, "SIE fail")
        return false
    }

    public leaderSetLock(logEntry: LogEntry) {
        customLog(this.lockPrefix, "Pushing lock in log", logEntry)
        if(this.leaderSetIfEmpty(logEntry) && this.lockCommitIndex == 0){
            this.lockCommitIndex = this.prevIndex + 1;
            return true
        }
        return false
    }

    public leaderCompareAndSwap(logEntry: LogEntry) {
        if(this.storage.check_if_equals(logEntry.command.key, logEntry.command.value)){
            customLog(this.commitPrefix, "CAS success")
            this.leaderPush(logEntry)
            return true
        }
        customLog(this.commitPrefix, "CAS fail")
        return false
    }

    public leaderCASUpdateLock(logEntry: LogEntry) {
        const updateLock = JSON.parse(logEntry.command.value) as LockRequest
        let compareLock: LockRequest | undefined = undefined
        if(updateLock?.event == LockEvent.Update){
            // @ts-ignore
            compareLock = {
                id: updateLock.id_old,
                time: updateLock.time_old,
                event: this.storage.lock?.event as LockEvent
            }
        }

        let setLock = {
            id: updateLock.id,
            time: updateLock.time,
            event: LockEvent.Update
        } as LockRequest

        const customLogEntry: LogEntry = {
            term: logEntry.term,
            command: {
                key: logEntry.command.key,
                value: JSON.stringify(setLock)
            }
        }

        if(this.storage.check_if_equals(logEntry.command.key, JSON.stringify(compareLock))){
            customLog(this.lockPrefix, "CAS Update success")
            this.leaderPush(customLogEntry)
            return true
        }
        customLog(this.lockPrefix, "CAS Update fail")
        return false
    }

    public leaderCASUnlock(logEntry: LogEntry) {
        const updateLock = JSON.parse(logEntry.command.value) as LockRequest
        let compareLock: LockRequest | undefined = undefined
            // @ts-ignore
        compareLock = {
            id: updateLock.id,
            time: updateLock.time,
            event: this.storage.lock?.event as LockEvent
        }
        let setLock = {
            id: updateLock.id,
            time: updateLock.time,
            event: LockEvent.Unlock
        } as LockRequest

        const customLogEntry: LogEntry = {
            term: logEntry.term,
            command: {
                key: logEntry.command.key,
                value: JSON.stringify(setLock)
            }
        }

        if(this.storage.check_if_equals(logEntry.command.key, JSON.stringify(compareLock))){
            customLog(this.lockPrefix, "CAS Update success")
            this.leaderPush(customLogEntry)
            return true
        }
        customLog(this.lockPrefix, "CAS Update fail")
        return false
    }
}
