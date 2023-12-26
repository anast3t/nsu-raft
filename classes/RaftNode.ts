import {
    AppendEntriesRequest,
    AppendEntriesResponse,
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
import {customLog} from "../utils";

//Clear-Host; yarn doc; $env:RAFTPORT='5000'; $env:EXPRESSPORT='3000'; yarn packdev
//Clear-Host; yarn doc; $env:RAFTPORT='6000'; $env:EXPRESSPORT='3001'; yarn packdev
//Clear-Host; yarn doc; $env:RAFTPORT='7000'; $env:EXPRESSPORT='3002'; yarn packdev

//clear && yarn doc &&export RAFTPORT='5000' &&export EXPRESSPORT='3000' && yarn packdev
//clear && yarn doc &&export RAFTPORT='6000' &&export EXPRESSPORT='3001' && yarn packdev
//clear && yarn doc &&export RAFTPORT='7000' &&export EXPRESSPORT='3002' && yarn packdev

export class RaftNode {
    private server: net.Server | undefined = undefined;
    private state: SystemState = {
        role: Role.Follower,
        currentTerm: 0,
        votedFor: 0,
        voteCount: 0,
    };
    private clients: net.Socket[] = [];
    private selfPort: number;
    private ports: number[];
    private clientPortMap = new TwoWayMap<number, number>(); // clientPort -> realPort
    private filteredPorts: number[];
    private electionTimeout: NodeJS.Timeout | undefined = undefined
    private heartbeatInterval: NodeJS.Timeout | undefined = undefined
    private _storage: RaftStorage = new RaftStorage();
    private _logEntries: RaftLogEntry = new RaftLogEntry(this._storage)
    private SECONDS_MULTIPLIER: number = 20;

    private electPrefix = "🗳️ELECTION"
    private connPrefix = "🔗 CONNECTION"
    private selfConnPrefix = "🔗 SELF CONNECTION"
    private timeoutPrefix = "⏰  TIMEOUT"
    private readPrefix = "📩 READ"
    private writePrefix = "📡 WRITE"
    private replicatePrefix = "📝 REPLICATE"

    constructor(
        args: {
            selfPort: number,
            ports: number[]
        }
    ) {
        this.selfPort = args.selfPort;
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

    public addLogEntry(key: string, value: string) {
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

    get role() {
        return this.state.role
    }

    get logEntries() {
        return this._logEntries
    }

    get storage() {
        return this._storage
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
        this.state = {
            votedFor: -1,
            voteCount: 1,
            currentTerm: this.state.currentTerm + 1,
            role: Role.Candidate,
        }
        customLog((this.electPrefix), "Voted for self", this.state)
    }

    private resetRole2Follower() {
        this.state = {
            votedFor: 0,
            voteCount: 0,
            currentTerm: this.state.currentTerm,
            role: Role.Follower,
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
        this.sendMsg(client, {
            type: MsgType.AppendEntriesResponse,
            data: {
                term: this.state.currentTerm,
                success: success
            }
        })
    }

    //SECTION: [ACCEPT] APPEAND ENTRIES

    private acceptAppendEntries(data: AppendEntriesRequest) {
        const push = () => {
            this.resetElectionTimeout()
            if (data.entries.length > 0)
                customLog((this.replicatePrefix), "Pushing entries", JSON.stringify(data.entries))
            const res = this.logEntries.push(data)
            if (!res) {
                if (data.entries.length > 0)
                    customLog((this.replicatePrefix), "Pushing entries failed")
                return false
            }
            if (data.entries.length > 0)
                customLog(
                    (this.replicatePrefix),
                    "Pushing entries succeeded",
                    JSON.stringify(this.logEntries.logEntries)
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
}

//asd
