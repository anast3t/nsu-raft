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

const rl = readline.createInterface({input, output});
require('dotenv').config()
const ports: number[] = [5000, 6000, 7000]
const selfPort = parseInt(process.env.PORT as string);

const startTime = Date.now()

const getPrefix = (prefix: string) => {
    // return `[${prefix} : ${(((Date.now() - startTime))/1000).toFixed(4)}s]`
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

const sendToAll = (data: string) => {
    clients.forEach(client => {
        client.write(data)
    })
    console.log(getPrefix("WRITE"), "Sent BC", data, "To", clients.map(c => c.remotePort))
}

const bcJSON = (data: object) => {
    sendToAll(JSON.stringify(data))
}

const bcMsg = (data: Message) => {
    bcJSON(data);
}

const sendMsg = (client: net.Socket, data: Message) => {
    client.write(JSON.stringify(data));
    console.log(getPrefix("WRITE"), "Sent to node ", data, client.remotePort)
}

const acceptJSON = (data: string): object => {
    const json = JSON.parse(data)
    console.log(getPrefix("READ"), "Got ", json)
    return json
}

const acceptMsg = (data: string): Message => {
    const json = acceptJSON(data)
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
                break;
            case MsgType.VoteResponse:
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
        resetElectionTimeout(electionTimeout)
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

const startElectionTimeout = () => {
    const randTime = getTime(Math.floor(Math.random() * 150) + 150)
    console.log(getPrefix(electPrefix), "Starting election timeout", randTime, state)
    const timeout = setTimeout(() => {
        console.log(getPrefix(electPrefix), "Election timeout", randTime, state)
        selfVote()
        sendVoteRequest()
        electionTimeout = startElectionTimeout()
        // timeout.refresh()
    }, randTime)
    return timeout
}

const resetElectionTimeout = (timeout: NodeJS.Timeout) => {
    console.log(getPrefix(electPrefix), "Resetting election timeout")
    clearTimeout(timeout)
    electionTimeout = startElectionTimeout()
    // timeout.refresh()
}

let electionTimeout = startElectionTimeout()

