import {AppendEntriesRequest, LogEntry, Message, MsgType, Role, SystemState, VoteRequest, VoteResponse} from "../types";
import net from "net";
import {clearTimeout} from "timers";
import {RaftStorage} from "./RaftStorage";
import {RaftLogEntry} from "./RaftLogEntry";
import {TwoWayMap} from "./TwoWayMap";
//Clear-Host; yarn doc; $env:RAFTPORT='5000'; $env:EXPRESSPORT='3000'; yarn packdev
//Clear-Host; yarn doc; $env:RAFTPORT='6000'; $env:EXPRESSPORT='3001'; yarn packdev
//Clear-Host; yarn doc; $env:RAFTPORT='7000'; $env:EXPRESSPORT='3002'; yarn packdev
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
    private logEntry: RaftLogEntry = new RaftLogEntry()
    private SECONDS_MULTIPLIER: number = 20;

    private electPrefix = "🗳️ELECTION"
    private connPrefix = "🔗 CONNECTION"
    private selfConnPrefix = "🔗 SELF CONNECTION"
    private timeoutPrefix = "⏰  TIMEOUT"
    private readPrefix = "📩 READ"
    private writePrefix = "📡 WRITE"

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
        this.server.listen(this.selfPort, '127.0.0.1');

        console.log("Server listening on port: " + this.selfPort);

        this.filteredPorts.forEach(port => {
            this.selfConnect(port)
        })

        this.heartbeatInterval = this.startHeartbeatInterval()
        this.electionTimeout = this.startElectionTimeout()
    }

    public addLogEntry(key: string, value: string) {
        this.logEntry.push(
            {
                term: this.state.currentTerm,
                command: {
                    key: key,
                    value: value
                }
            },
            this.logEntry.prevIndex,
            this.logEntry.prevTerm
        )
    }

    get role() {
        return this.state.role
    }

    //SECTION: REPLICATION

    private replicate() {

    }

    //SECTION: TIME

    private getTime = (ms: number) => {
        return ms * this.SECONDS_MULTIPLIER
    }

    //SECTION: LOGS

    private getPrefix(prefix: string) {
        return `[${prefix} - ${new Date().getSeconds()}.${new Date().getMilliseconds()}]`
    }

    private customLog(prefix: string, ...args: any[]) {
        console.log(this.getPrefix(prefix), ...args)
    }

    //SECTION: SOCKET MESSAGE ENCODDING | DECODING | SENDING

    private bcMsg(data: Message) {
        this.clients.forEach(client => {
            client.write(JSON.stringify(data))
        })
        this.customLog((this.writePrefix), "Sent BC", data, "To", this.clientPortMap)
    }

    private sendMsg(client: net.Socket, data: Message) {
        client.write(JSON.stringify(data));
        this.customLog((this.writePrefix), "Sent to node ", data, client.remotePort)
    }

    private acceptMsg(data: string): Message {
        const json = JSON.parse(data)
        this.customLog((this.readPrefix), "Got ", json)
        return json as Message
    }

    //SECTION: CONNECTIONS

    private socketHandler(socket: net.Socket) {
        this.customLog((this.connPrefix), "Connection", socket.remoteAddress, socket.remotePort, this.clients.map(c => c.remotePort))
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
            this.customLog(this.readPrefix, "Msg from", port, this.clientPortMap.get(port))

            const msg = this.acceptMsg(msgstr)
            switch (msg.type) {
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
                    break;
            }
        });

        socket.on("end", () => {
            this.customLog((this.connPrefix), "Disconnected from port: ", port)
            popClient()
        })

        socket.on("error", (error) => {
            this.customLog((this.connPrefix), "Error in connection to port: ", port)
            popClient()
        });

        this.clients.push(socket)
    }

    private selfConnect(port: number) {

        this.customLog((this.selfConnPrefix), "Trying to connect to port: " + port)
        const client = net.createConnection({
            port: port
        }, () => {
            this.customLog((this.selfConnPrefix), "Connected to port: " + port, this.clients.map(c => c.remotePort))
            this.sendMsg(client, {
                type: MsgType.BondRequest,
                data: this.selfPort
            })
            this.clientPortMap.set(port, port)
            this.socketHandler(client)
        })
        client.on("error", (error) => {
            this.customLog((this.selfConnPrefix), "Error connecting to port: " + port)
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
        this.customLog((this.electPrefix), "Voted for self", this.state)
    }

    private resetRole2Follower() {
        this.state = {
            votedFor: 0,
            voteCount: 0,
            currentTerm: this.state.currentTerm,
            role: Role.Follower,
        }
        this.customLog((this.electPrefix), "Reset to follower", this.state)
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
            this.customLog((this.electPrefix), "Voted for", data.candidateId, this.state)
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
            if (this.state.voteCount > this.ports.length / 2) {
                this.state.role = Role.Leader
                this.customLog((this.electPrefix), "Became leader", this.state)
            }
        }
    }

    //SECTION: [SEND] APPEAND ENTRIES

    private sendAppendEntries(entries: LogEntry[] = []) {
        this.bcMsg({
            type: MsgType.AppendEntriesRequest,
            data: {
                term: this.state.currentTerm,
                leaderId: this.selfPort,
                prevLogIndex: this.logEntry.prevIndex,
                prevLogTerm: this.logEntry.prevTerm,
                entries: entries,
                leaderCommit: this.logEntry.commitIndex
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
            if (data.entries.length > 0) {
                this.customLog((this.electPrefix), "Pushed entry", data.entries[0], this.state)
                return this.logEntry.push(data.entries[0], data.prevLogIndex, data.prevLogTerm)
            }
            return true
        }

        if (data.term < this.state.currentTerm) {
            return false
        }
        if (data.term > this.state.currentTerm) {
            this.resetElectionTimeout()
            this.state.currentTerm = data.term
            this.resetRole2Follower()
            return true
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


    //SECTION: TIMEOUTS

    private startElectionTimeout() {
        const randTime = this.getTime(Math.floor(Math.random() * 150) + 150)
        this.customLog((this.timeoutPrefix), "Starting election timeout", randTime, this.state)
        const timeout = setTimeout(() => {
            this.customLog((this.timeoutPrefix), "Election timeout", randTime, this.state)
            this.selfVote()
            this.sendVoteRequest()
            this.electionTimeout = this.startElectionTimeout()
        }, randTime)
        return timeout
    }

    private resetElectionTimeout() {
        this.customLog((this.timeoutPrefix), "Resetting election timeout")
        clearTimeout(this.electionTimeout)
        this.electionTimeout = this.startElectionTimeout()
        // timeout.refresh()
    }

    private startHeartbeatInterval() {
        return setInterval(() => {
            if (this.state.role == Role.Leader) {
                this.resetElectionTimeout()
                this.sendAppendEntries()
            }
        }, this.getTime(100))
    }
}
