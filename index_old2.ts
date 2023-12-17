import net from "net"
import readline from 'node:readline';
import {stdin as input, stdout as output} from 'node:process';
import {
    SystemState,
    Message,
    VoteRequest,
    AppendEntriesRequest,
    AppendEntriesResponse,
    VoteResponse,
    LogEntry,
    MsgType,
    Role
} from "./types";
import {clearTimeout} from "timers";

import initExpress from "./initExpress";

initExpress()

const rl = readline.createInterface({input, output});
require('dotenv').config()
const ports: number[] = [5000, 6000, 7000]
const selfPort = parseInt(process.env.PORT as string);

const getPrefix = (prefix: string) => {
    return `[${prefix} - ${new Date().getSeconds()}.${new Date().getMilliseconds()}]`
}

const SECONDS_MULTIPLIER = 20;
const getTime = (ms: number) => {
    return ms * SECONDS_MULTIPLIER
}

const clients: net.Socket[] = [];

const state: SystemState = {
    role: Role.Follower,
    currentTerm: 0,
    votedFor: 0,
    voteCount: 0,
    log: []
}

const bcMsg = (data: Message) => {
    clients.forEach(client => {
        client.write(JSON.stringify(data))
    })
    console.log(getPrefix("WRITE"), "Sent BC", data, "To", clients.map(c => c.remotePort))
}

const sendMsg = (client: net.Socket, data: Message) => {
    client.write(JSON.stringify(data));
    console.log(getPrefix("WRITE"), "Sent to node ", data, client.remotePort)
}

const acceptMsg = (data: string): Message => {
    const json = JSON.parse(data)
    console.log(getPrefix("READ"), "Got ", json)
    return json as Message
}

//SECTION: Connections

const connPrefix = "CONN"


const socketHandler = (socket: net.Socket, clients: net.Socket[]) => {
    console.log(getPrefix(connPrefix), "Connection", socket.remoteAddress, socket.remotePort, clients.map(c => c.remotePort))
    const port = socket.remotePort;

    const popClient = () => {
        const index = clients.indexOf(socket);
        if (index > -1) {
            clients.splice(index, 1);
        }
    }

    socket.on("data", (raw) => {
        const msgstr = raw.toString();
        console.log(getPrefix("READ"), "Msg from", socket.remotePort)

        const msg = acceptMsg(msgstr)
        switch (msg.type) {
            case MsgType.VoteRequest:
                sendVoteResponse(socket, acceptVoteRequest(msg.data))
                break;
            case MsgType.AppendEntriesRequest:
                sendAppendEntriesResponse(socket, acceptAppendEntries(msg.data))
                break;
            case MsgType.VoteResponse:
                acceptVoteResponse(msg.data);
                break;
            case MsgType.AppendEntriesResponse:
                break;
        }
    });

    socket.on("end", () => {
        console.log(getPrefix(connPrefix), "Disconnected from port: " + port)
        popClient()
    })

    socket.on("error", (error) => {
        console.log(getPrefix(connPrefix), "Error in connection to port: " + port)
        popClient()
    });

    clients.push(socket)
}

const selfConnect = (port: number) => {
    const selfConnPrefix = "SELFCONN"

    console.log(getPrefix(selfConnPrefix), "Trying to connect to port: " + port)
    const client = net.createConnection({
        port: port
    }, () => {
        console.log(getPrefix(selfConnPrefix), "Connected to port: " + port, clients.map(c => c.remotePort))
        socketHandler(client, clients)
    })
    client.on("error", (error) => {
        console.log(getPrefix(selfConnPrefix), "Error connecting to port: " + port)
    })
}

const serverSocketHandler = (socket: net.Socket) => {
    socketHandler(socket, clients)
}

const server = net.createServer(serverSocketHandler);

//$env:PORT='5000'; yarn dev
const filteredPorts = ports.filter(p => p !== selfPort);

server.listen(selfPort, '127.0.0.1');
console.log("Server listening on port: " + selfPort);

filteredPorts.forEach(port => {
    selfConnect(port)
})


//SECTION: Election

const electPrefix = "ELECT"

const sendVoteRequest = () => {
    bcMsg({
        type: MsgType.VoteRequest,
        data: {
            term: state.currentTerm,
            candidateId: selfPort,
            lastLogIndex: 0,
            lastLogTerm: 0
        }
    })
}

const sendVoteResponse = (client: net.Socket,voteGranted: boolean) => {
    sendMsg(client,{
        type: MsgType.VoteResponse,
        data: {
            term: state.currentTerm,
            voteGranted: voteGranted
        }
    })
}

const acceptVoteRequest = (data: VoteRequest) => {
    //TODO: Check if log is up to date

    const vote = () => {
        state.votedFor = data.candidateId
        console.log(getPrefix(electPrefix), "Voted for", data.candidateId, state)
    }

    if (data.term < state.currentTerm) {
        return false
    }
    if (data.term > state.currentTerm) {
        resetElectionTimeout()
        state.currentTerm = data.term
        resetRole2Follower()
        vote()
        return true
    }
    if (state.votedFor == 0 || state.votedFor == data.candidateId) {
        vote()
        return true
    }
    return false
}

const acceptVoteResponse = (data: VoteResponse) => {
    if (data.term < state.currentTerm) {
        return
    }
    if (data.term > state.currentTerm) {
        resetElectionTimeout()
        state.currentTerm = data.term
        resetRole2Follower()
        return
    }
    if (data.voteGranted) {
        state.voteCount++
        if (state.voteCount > ports.length / 2) {
            state.role = Role.Leader
            console.log(getPrefix(electPrefix), "Became leader", state)
        }
    }
}

const selfVote = () => {
    state.votedFor = -1
    state.voteCount = 1
    state.currentTerm++
    state.role = Role.Candidate
    console.log(getPrefix(electPrefix), "Voted for self", state)
}

const resetRole2Follower = () => {
    state.role = Role.Follower
    state.votedFor = 0
    state.voteCount = 0
    console.log(getPrefix(electPrefix), "Reset to follower", state)
}

const timeoutPrefix = "TIMEOUT"

const startElectionTimeout = () => {
    const randTime = getTime(Math.floor(Math.random() * 150) + 150)
    console.log(getPrefix(timeoutPrefix), "Starting election timeout", randTime, state)
    const timeout = setTimeout(() => {
        console.log(getPrefix(timeoutPrefix), "Election timeout", randTime, state)
        selfVote()
        sendVoteRequest()
        electionTimeout = startElectionTimeout()
    }, randTime)
    return timeout
}

const resetElectionTimeout = () => {
    console.log(getPrefix(timeoutPrefix), "Resetting election timeout")
    clearTimeout(electionTimeout)
    electionTimeout = startElectionTimeout()
    // timeout.refresh()
}

let electionTimeout = startElectionTimeout()

//SECTION: HEARTBEAT & LOG REPLICATION

const heartbeatPrefix = "HEARTBEAT"

const storage: Map<string, object> = new Map()

const sendAppendEntities = () => {
    bcMsg({
        type: MsgType.AppendEntriesRequest,
        data: {
            term: state.currentTerm,
            leaderId: selfPort,
            prevLogIndex: 0,
            prevLogTerm: 0,
            entries: [],
            leaderCommit: 0
        }
    })
}

const acceptAppendEntries = (data: AppendEntriesRequest) => {
    if (data.term < state.currentTerm) {
        return false
    }
    if (data.term > state.currentTerm) {
        //TODO: rollback log
        resetElectionTimeout()
        state.currentTerm = data.term
        resetRole2Follower()
        return true
    }
    if (state.role == Role.Candidate) {
        resetElectionTimeout()
        resetRole2Follower()
        return true
    }
    if (state.role == Role.Follower) {
        resetElectionTimeout()
        return true
    }
    return false
}

const sendAppendEntriesResponse = (client: net.Socket, success: boolean) => {
    sendMsg(client, {
        type: MsgType.AppendEntriesResponse,
        data: {
            term: state.currentTerm,
            success: success
        }
    })
}

const heartbeatInterval = setInterval(() => {
    if (state.role == Role.Leader) {
        resetElectionTimeout()
        sendAppendEntities()
    }
}, getTime(100))
