import {
    AppendEntriesRequest,
    AppendEntriesResponse,
    LockEvent,
    LockRequest,
    LogEntry,
    Message,
    MsgType,
    Role,
    SystemState,
    VoteRequest,
    VoteResponse
} from "../types";
import net from "net";
import {clearTimeout} from "timers";
import {RaftStorage} from "./RaftStorage";
import {RaftLogEntry} from "./RaftLogEntry";
import {TwoWayMap} from "./TwoWayMap";
import {customLog, getMilliseconds, getSeconds} from "../utils";
import {answerLateAnswer} from "../initExpress";


//Clear-Host; yarn doc; $env:RAFTPORT='5000'; $env:EXPRESSPORT='3000'; yarn packdev
//Clear-Host; yarn doc; $env:RAFTPORT='6000'; $env:EXPRESSPORT='3001'; yarn packdev
//Clear-Host; yarn doc; $env:RAFTPORT='7000'; $env:EXPRESSPORT='3002'; yarn packdev

//clear && yarn doc &&export RAFTPORT='5000' &&export EXPRESSPORT='3000' && yarn packdev
//clear && yarn doc &&export RAFTPORT='6000' &&export EXPRESSPORT='3001' && yarn packdev
//clear && yarn doc &&export RAFTPORT='7000' &&export EXPRESSPORT='3002' && yarn packdev

export class RaftNode {
    private server: net.Server | undefined = undefined;
    private _state: SystemState = {
        role: Role.Follower,
        currentTerm: 0,
        votedFor: 0,
        voteCount: 0,
        leaderId: 0
    };
    private clients: net.Socket[] = [];
    private _selfPort: number;
    private ports: number[];
    private clientPortMap = new TwoWayMap<number, number>(); // clientPort -> realPort
    private filteredPorts: number[];
    private electionTimeout: NodeJS.Timeout | undefined = undefined
    private heartbeatInterval: NodeJS.Timeout | undefined = undefined
    private lockTimeout: NodeJS.Timeout | undefined = undefined
    private dropLockRequestTimeout: NodeJS.Timeout | undefined = undefined
    private updateLockInterval: NodeJS.Timeout | undefined = undefined
    private _storage: RaftStorage = new RaftStorage();
    private _logEntries: RaftLogEntry = new RaftLogEntry(this._storage, this)
    private SECONDS_MULTIPLIER: number = 20;
    private _appendixLogEntry: LogEntry | undefined = undefined
    //TODO: appendix reset on timer

    private electPrefix = "🗳️ELECTION"
    private connPrefix = "🔗 CONNECTION"
    private selfConnPrefix = "🔗 SELF CONNECTION"
    private timeoutPrefix = "⏰  TIMEOUT"
    private readPrefix = "📩 READ"
    private writePrefix = "📡 WRITE"
    private replicatePrefix = "📝 REPLICATE"
    private commitPrefix = "💾 COMMIT"
    private lockPrefix = "🔒 LOCK"

    constructor(
        args: {
            selfPort: number,
            ports: number[]
        }
    ) {
        this._selfPort = args.selfPort;
        this.ports = args.ports;
        this.filteredPorts = this.ports.filter(p => p !== this.selfPort);
    }

    //SECTION: PUBLIC

    public start() {
        this.server = net.createServer(this.socketHandler.bind(this));
        this.server.listen(this.selfPort, 'localhost');

        customLog(this.connPrefix, "Server listening on port: " + this.selfPort);

        this.filteredPorts.forEach(port => {
            this.selfConnect(port)
        })

        this.heartbeatInterval = this.startHeartbeatInterval()
        this.electionTimeout = this.startElectionTimeout()
    }

    public leaderAddLogEntry(key: string, value: string) {
        this.logEntries.leaderPush(
            {
                term: this.state.currentTerm,
                command: {
                    key: key,
                    value: value
                }
            }
        )
    }

    public firstLock(id: number) {
        const logEntry = {
            term: this.state.currentTerm,
            command: {
                key: "locked_by",
                value: JSON.stringify({
                    id: id,
                    time: getSeconds(),
                    event: LockEvent.Lock
                })
            }
        }
        if(this.state.role == Role.Follower && !this.appendixLogEntry){
            if(this.state.leaderId == 0){
                return false
            }
            this._appendixLogEntry = logEntry
            this.startDropLockRequestTimeout()
            return true
        }
        customLog(this.lockPrefix, "Trying leader lock",
            this.state.role==Role.Leader,
            !this.storage.lock,
            this.storage.lock,
            id,
            this.selfPort
        )
        if(this.state.role == Role.Leader && !this.storage.lock?.id && id == this.selfPort){
            this.processLockEvents(logEntry)
            return true
        }
        return false
    }

    public unlock() {

        const logEntry = {
            term: this.state.currentTerm,
            command: {
                key: "locked_by",
                value: JSON.stringify({
                    id: this.storage.lock?.id,
                    time: this.storage.lock?.time,
                    event: LockEvent.Unlock
                })
            }
        }
        if(this.state.role == Role.Follower && !this.appendixLogEntry){
            if(this.state.leaderId == 0){
                return false
            }
            this._appendixLogEntry = logEntry
            this.startDropLockRequestTimeout()
            return true
        }
        if(this.state.role == Role.Leader && this.storage.lock?.id){
            this.processLockEvents(logEntry)
            return true
        }
        return false
    }

    public updateLock() {

        const logEntry = {
            term: this.state.currentTerm,
            command: {
                key: "locked_by",
                value: JSON.stringify({
                    id: this.storage.lock?.id,
                    time: getSeconds() + 10,
                    time_old: this.storage.lock?.time,
                    id_old: this.storage.lock?.id,
                    event: LockEvent.Update
                } as LockRequest)
            }
        }
        if(this.state.role == Role.Follower && !this.appendixLogEntry){
            if(this.state.leaderId == 0){
                return false
            }
            this._appendixLogEntry = logEntry
            return true
        }
        if(this.state.role == Role.Leader && this.storage.lock?.id){
            this.processLockEvents(logEntry)
            return true
        }
        return false
    }

    get role() {
        return this.state.role
    }

    get logEntries() {
        return this._logEntries
    }

    get storage() {
        return this._storage
    }

    get selfPort(){
        return this._selfPort
    }

    get appendixLogEntry(){
        return this._appendixLogEntry
    }

    set appendixLogEntry(entry: LogEntry | undefined){
        this._appendixLogEntry = entry
    }

    get state() {
        return this._state
    }



    //SECTION: TIME

    private getTime = (ms: number) => {
        return ms * this.SECONDS_MULTIPLIER
    }

    //SECTION: SOCKET MESSAGE ENCODDING | DECODING | SENDING

    private bcMsg(data: Message) {
        this.clients.forEach(client => {
            client.write(JSON.stringify(data))
        })
        customLog((this.writePrefix), "Sent BC", data, "To", this.clientPortMap)
    }

    private sendMsg(client: net.Socket, data: Message) {
        client.write(JSON.stringify(data));
        customLog((this.writePrefix), "Sent to node ", data, client.remotePort)
    }

    private acceptMsg(data: string): Message {
        const json = JSON.parse(data)
        customLog((this.readPrefix), "Got ", json)
        return json as Message
    }

    //SECTION: CONNECTIONS

    private socketHandler(socket: net.Socket) {
        customLog((this.connPrefix), "Connection", socket.remoteAddress, socket.remotePort, this.clients.map(c => c.remotePort))
        const port = socket.remotePort as number;

        const popClient = () => {
            const index = this.clients.indexOf(socket);
            if (index > -1) {
                this.clients.splice(index, 1);
            }
            this.clientPortMap.delete(port)
        }

        socket.on("data", (raw) => {
            const msgstr = raw.toString();
            customLog(this.readPrefix, "Msg from", port, this.clientPortMap.get(port))

            const msg = this.acceptMsg(msgstr)
            switch (msg.type) {
                //TODO: Атомарность либо обработки, либо хертбита
                //INFO: Она будет сохраняться тк асинхронные ивенты будут вызываться полностью после отработки колстэка
                case MsgType.BondRequest:
                    this.clientPortMap.set(port, msg.data)
                    break;
                case MsgType.VoteRequest:
                    this.sendVoteResponse(socket, this.acceptVoteRequest(msg.data))
                    break;
                case MsgType.AppendEntriesRequest:
                    this.sendAppendEntriesResponse(socket, this.acceptAppendEntries(msg.data))
                    break;
                case MsgType.VoteResponse:
                    this.acceptVoteResponse(msg.data);
                    break;
                case MsgType.AppendEntriesResponse:
                    this.acceptAppendEntriesResponse(msg.data, socket)
                    break;
            }
        });

        socket.on("end", () => {
            customLog((this.connPrefix), "Disconnected from port: ", port)
            popClient()
        })

        socket.on("error", (error) => {
            customLog((this.connPrefix), "Error in connection to port: ", port)
            popClient()
        });

        this.clients.push(socket)
    }

    private selfConnect(port: number) {

        customLog((this.selfConnPrefix), "Trying to connect to port: " + port)
        const client = net.createConnection({
            port: port
        }, () => {
            customLog((this.selfConnPrefix), "Connected to port: " + port, this.clients.map(c => c.remotePort))
            this.sendMsg(client, {
                type: MsgType.BondRequest,
                data: this.selfPort
            })
            this.clientPortMap.set(port, port)
            this.socketHandler(client)
        })
        client.on("error", (error) => {
            customLog((this.selfConnPrefix), "Error connecting to port: " + port)
        })
    }

    //SECTION STATE CONTROLL

    private selfVote() {
        this._state = {
            votedFor: -1,
            voteCount: 1,
            currentTerm: this.state.currentTerm + 1,
            role: Role.Candidate,
            leaderId: 0
        }
        customLog((this.electPrefix), "Voted for self", this.state)
    }

    private resetRole2Follower() {
        this._state = {
            votedFor: 0,
            voteCount: 0,
            currentTerm: this.state.currentTerm,
            role: Role.Follower,
            leaderId: 0
        }
        customLog((this.electPrefix), "Reset to follower", this.state)
    }

    private tryBecomeLeader() {
        if (this.state.voteCount > this.ports.length / 2) {
            customLog((this.electPrefix), "Became leader", this.state)
            this.state.role = Role.Leader
            this.logEntries.reinitIndex(this.filteredPorts);
        }
    }

    //SECTION: [SEND] VOTE REQUEST

    private sendVoteRequest() {
        this.bcMsg({
            type: MsgType.VoteRequest,
            data: {
                term: this.state.currentTerm,
                candidateId: this.selfPort,
                lastLogIndex: 0,
                lastLogTerm: 0
            }
        })
    }

    private sendVoteResponse(client: net.Socket, voteGranted: boolean) {
        this.sendMsg(client, {
            type: MsgType.VoteResponse,
            data: {
                term: this.state.currentTerm,
                voteGranted: voteGranted
            }
        })
    }

    //SECTION: [ACCEPT] VOTE REQUEST

    private acceptVoteRequest(data: VoteRequest) {
        //TODO: Check if log is up to date

        const vote = () => {
            this.state.votedFor = data.candidateId
            customLog((this.electPrefix), "Voted for", data.candidateId, this.state)
        }

        if (data.term < this.state.currentTerm) {
            return false
        }
        if (data.term > this.state.currentTerm) {
            this.resetElectionTimeout()
            this.state.currentTerm = data.term
            this.resetRole2Follower()
            vote()
            return true
        }
        if (this.state.votedFor == 0 || this.state.votedFor == data.candidateId) {
            vote()
            return true
        }
        return false
    }

    private acceptVoteResponse(data: VoteResponse) {
        if (data.term < this.state.currentTerm) {
            return
        }
        if (data.term > this.state.currentTerm) {
            this.resetElectionTimeout()
            this.state.currentTerm = data.term
            this.resetRole2Follower()
            return
        }
        if (data.voteGranted) {
            this.state.voteCount++
            this.tryBecomeLeader()
        }
    }

    //SECTION: [SEND] APPEND ENTRIES

    private sendAppendEntries(
        client: net.Socket,
        entries: LogEntry[] = [],
        prevLogIndex: number,
        prevLogTerm: number
    ) {
        this.sendMsg(client, {
            type: MsgType.AppendEntriesRequest,
            data: {
                term: this.state.currentTerm,
                leaderId: this.selfPort,
                prevLogIndex: prevLogIndex,
                prevLogTerm: prevLogTerm,
                entries: entries,
                leaderCommit: this.logEntries.commitIndex
            }
        })
    }

    private sendAppendEntriesToClient(port: number) {
        const nextIndex = this.logEntries.getNextIndex(port) as number;
        const entries = this.logEntries.getEntriesFrom(nextIndex);
        this.sendAppendEntries(
            this.clients.find(c => c.remotePort == this.clientPortMap.rGet(port)) as net.Socket,
            entries,
            Math.max(nextIndex - 1, 0),
            this.logEntries.getLogTerm(nextIndex - 1) as number
        )
    }

    private bcReplicate() {
        this.filteredPorts.forEach(port => {
            if (this.clientPortMap.rHas(port)) {
                this.sendAppendEntriesToClient(port)
            }
        })
    }

    private sendAppendEntriesResponse(client: net.Socket, success: boolean) {
        let appendix = undefined
        if(this.appendixLogEntry)
            appendix = this.clientPortMap.get(client.remotePort as number) == this.state.leaderId ? this.appendixLogEntry : undefined
        this.sendMsg(client, {
            type: MsgType.AppendEntriesResponse,
            data: {
                term: this.state.currentTerm,
                success: success,
                logEntry: appendix
            }
        })
    }

    //SECTION: [ACCEPT] APPEND ENTRIES

    private acceptAppendEntries(data: AppendEntriesRequest) {
        const push = () => {
            this.resetElectionTimeout()
            this.state.leaderId = data.leaderId
            if (data.entries.length > 0)
                customLog((this.replicatePrefix), "Pushing entries", JSON.stringify(data.entries))
            const res = this.logEntries.followerPush(data)
            if (!res) {
                if (data.entries.length > 0)
                    customLog((this.replicatePrefix), "Pushing entries failed")
                return false
            }
            if (data.entries.length > 0)
                customLog(
                    (this.replicatePrefix),
                    "Pushing entries succeeded",
                )
            return true
        }

        if (data.term < this.state.currentTerm) {
            return false
        }
        if (data.term > this.state.currentTerm) {
            this.resetElectionTimeout()
            this.state.currentTerm = data.term
            this.resetRole2Follower()
            return push()
        }
        if (this.state.role == Role.Candidate) {
            this.resetRole2Follower()
            return push()
        }
        if (this.state.role == Role.Follower) {
            return push()
        }
        return false
    }

    private processLockEvents(data: LogEntry){
        let entry = JSON.parse(data.command.value) as LockRequest
        customLog(this.lockPrefix, "GOT APPENDIX", entry)
        if(entry.event == LockEvent.Update){
            customLog(this.lockPrefix, "GOT UPDATING MESSAGE")
            this.logEntries.leaderCASUpdateLock(data)
        }
        else if(entry.event == LockEvent.Unlock){
            customLog(this.lockPrefix, "GOT UNLOCKING MESSAGE")
            this.logEntries.leaderCASUnlock(data)
        } else if (entry.event == LockEvent.Lock){
            customLog(this.lockPrefix, "GOT LOCKING MESSAGE")
            this.logEntries.leaderSetLock(data)
        }
    }

    private acceptAppendEntriesResponse(data: AppendEntriesResponse, client: net.Socket) {
        if (data.term < this.state.currentTerm) {
            return
        }
        if (data.term > this.state.currentTerm) {
            this.resetElectionTimeout()
            this.state.currentTerm = data.term
            this.resetRole2Follower()
            return
        }
        const port = this.clientPortMap.get(client.remotePort as number) as number
        if (data.success) {
            customLog((this.replicatePrefix),
                "Incrementing nextIndex for",
                port, "to",
                this.logEntries.prevIndex + 1
            )
            this.logEntries.setNextIndex(
                port,
                this.logEntries.prevIndex + 1,
            )
            this.logEntries.setMatchIndex(
                port,
                this.logEntries.prevIndex,
            )
            if(data.logEntry){
                this.processLockEvents(data.logEntry)
            }
            this.logEntries.leaderTryCommit()
        } else {
            customLog((this.replicatePrefix),
                "Decrementing nextIndex for",
                port, "to",
                this.logEntries.getNextIndex(port) - 1);
            this.logEntries.setNextIndex(
                port,
                this.logEntries.getNextIndex(port) - 1,
            )
        }
    }

    //SECTION: TIMEOUTS

    private startElectionTimeout() {
        const randTime = this.getTime(Math.floor(Math.random() * 150) + 150)
        customLog((this.timeoutPrefix), "Starting election timeout", randTime, this.state)
        const timeout = setTimeout(() => {
            customLog((this.timeoutPrefix), "Election timeout", randTime, this.state)
            this.selfVote()
            this.sendVoteRequest()
            this.electionTimeout = this.startElectionTimeout()
        // }, (this.selfPort * 2) - 7000)
        }, randTime)
        return timeout
    }

    private resetElectionTimeout() {
        customLog((this.timeoutPrefix), "Resetting election timeout")
        clearTimeout(this.electionTimeout)
        this.electionTimeout = this.startElectionTimeout()
    }

    private startHeartbeatInterval() {
        return setInterval(() => {
            if (this.state.role == Role.Leader) {
                this.resetElectionTimeout()
                this.bcReplicate()
            }
        }, this.getTime(100))
    }

    //SECTION: LOCK TIMEOUT

    public startUnlockTimeout() {
        const timeoutTime = (this.storage.lock?.time??2)*1000 - getMilliseconds()
        customLog(this.timeoutPrefix, "Starting lock timeout", timeoutTime)
        this.lockTimeout = setTimeout(() => {
            customLog(this.timeoutPrefix, "Lock first timeout", timeoutTime)
            this.unlock()
        }, timeoutTime)
    }

    public refreshUnlockTimeout() {
        customLog(this.timeoutPrefix, "Refreshing lock timeout")
        this.lockTimeout?.refresh()
    }

    public clearUnlockTimeout() {
        customLog(this.timeoutPrefix, "Clearing lock timeout")
        clearTimeout(this.lockTimeout)
    }

    public startUpdateLockInterval() {
        customLog(this.timeoutPrefix, "Starting update lock interval")
        this.updateLockInterval = setInterval(() => {
            customLog(this.timeoutPrefix, "Updating lock interval")
            this.updateLock()
        }, this.getTime(500))
    }

    public clearUpdateLockInterval() {
        customLog(this.timeoutPrefix, "Clearing update lock interval")
        clearInterval(this.updateLockInterval)
    }

    public startDropLockRequestTimeout() {
        customLog(this.timeoutPrefix, "Starting drop lock request timeout")
        this.dropLockRequestTimeout = setTimeout(() => {
            customLog(this.timeoutPrefix, "Drop lock request timeout")
            answerLateAnswer(this.selfPort, false, "Drop lock request timeout")
            this.appendixLogEntry = undefined
        }, this.getTime(500))
    }

    public clearDropLockRequestTimeout() {
        customLog(this.timeoutPrefix, "Clearing drop lock request timeout")
        clearTimeout(this.dropLockRequestTimeout)
    }
}
