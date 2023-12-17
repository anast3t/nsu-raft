import {AppendEntriesRequest, Message, MsgType, Role, SystemState, VoteRequest, VoteResponse} from "../types";
import net from "net";
import {clearTimeout} from "timers";
//Clear-Host; yarn doc; $env:RAFTPORT='5000'; $env:EXPRESSPORT='3000'; yarn packdev
//Clear-Host; yarn doc; $env:RAFTPORT='6000'; $env:EXPRESSPORT='3001'; yarn packdev
//Clear-Host; yarn doc; $env:RAFTPORT='7000'; $env:EXPRESSPORT='3002'; yarn packdev
export class RaftNode {
    private server: net.Server | undefined = undefined;
    private state: SystemState;
    private clients: net.Socket[] = [];
    private selfPort: number;
    private ports: number[];
    private filteredPorts: number[];
    private electionTimeout: NodeJS.Timeout | undefined = undefined
    private heartbeatInterval: NodeJS.Timeout | undefined = undefined
    private storage: Map<string, object>;
    private SECONDS_MULTIPLIER: number = 20;

    private electPrefix = "ELECT"
    private connPrefix = "CONN"
    private timeoutPrefix = "TIMEOUT"

    constructor(
        args: {
            selfPort: number,
            ports: number[]
        }
    ) {
        this.selfPort = args.selfPort;
        this.ports = args.ports;
        this.state = {
            role: Role.Follower,
            currentTerm: 0,
            votedFor: 0,
            voteCount: 0,
            log: []
        }
        this.filteredPorts = this.ports.filter(p => p !== this.selfPort);
        this.storage = new Map<string, object>()
    }

    //SECTION: PUBLIC

    public start(){
        this.server = net.createServer(this.socketHandler.bind(this));
        this.server.listen(this.selfPort, '127.0.0.1');

        console.log("Server listening on port: " + this.selfPort);

        this.filteredPorts.forEach(port => {
            this.selfConnect(port)
        })

        this.heartbeatInterval = this.startHeartbeatInterval()
        this.electionTimeout = this.startElectionTimeout()
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

    //SECTION: SOCKET MESSAGE ENCODDING AND DECODING

    private bcMsg(data: Message) {
        this.clients.forEach(client => {
            client.write(JSON.stringify(data))
        })
        this.customLog(("WRITE"), "Sent BC", data, "To", this.clients.map(c => c.remotePort))
    }

    private sendMsg(client: net.Socket, data: Message) {
        client.write(JSON.stringify(data));
        this.customLog(("WRITE"), "Sent to node ", data, client.remotePort)
    }

    private acceptMsg(data: string): Message {
        const json = JSON.parse(data)
        this.customLog(("READ"), "Got ", json)
        return json as Message
    }

    //SECTION: CONNECTIONS

    private socketHandler(socket: net.Socket) {
        this.customLog((this.connPrefix), "Connection", socket.remoteAddress, socket.remotePort, this.clients.map(c => c.remotePort))
        const port = socket.remotePort;

        const popClient = () => {
            const index = this.clients.indexOf(socket);
            if (index > -1) {
                this.clients.splice(index, 1);
            }
        }

        socket.on("data", (raw) => {
            const msgstr = raw.toString();
            this.customLog(("READ"), "Msg from", socket.remotePort)

            const msg = this.acceptMsg(msgstr)
            switch (msg.type) {
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
        const selfConnPrefix = "SELFCONN"

        this.customLog((selfConnPrefix), "Trying to connect to port: " + port)
        const client = net.createConnection({
            port: port
        }, () => {
            this.customLog((selfConnPrefix), "Connected to port: " + port, this.clients.map(c => c.remotePort))
            this.socketHandler(client)
        })
        client.on("error", (error) => {
            this.customLog((selfConnPrefix), "Error connecting to port: " + port)
        })
    }

    //SECTION STATE CONTROLL

    private selfVote() {
        this.state = {
            votedFor: -1,
            voteCount: 1,
            currentTerm: this.state.currentTerm + 1,
            role: Role.Candidate,
            log: this.state.log
        }
        this.customLog((this.electPrefix), "Voted for self", this.state)
    }

    private resetRole2Follower() {
        this.state = {
            votedFor: 0,
            voteCount: 0,
            currentTerm: this.state.currentTerm,
            role: Role.Follower,
            log: this.state.log
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

    private sendAppendEntries() {
        this.bcMsg({
            type: MsgType.AppendEntriesRequest,
            data: {
                term: this.state.currentTerm,
                leaderId: this.selfPort,
                prevLogIndex: 0,
                prevLogTerm: 0,
                entries: [],
                leaderCommit: 0
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
        if (data.term < this.state.currentTerm) {
            return false
        }
        if (data.term > this.state.currentTerm) {
            //TODO: rollback log
            this.resetElectionTimeout()
            this.state.currentTerm = data.term
            this.resetRole2Follower()
            return true
        }
        if (this.state.role == Role.Candidate) {
            this.resetElectionTimeout()
            this.resetRole2Follower()
            return true
        }
        if (this.state.role == Role.Follower) {
            this.resetElectionTimeout()
            return true
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
