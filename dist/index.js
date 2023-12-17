"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const net_1 = __importDefault(require("net"));
const node_readline_1 = __importDefault(require("node:readline"));
const node_process_1 = require("node:process");
const types_1 = require("./types");
const timers_1 = require("timers");
const rl = node_readline_1.default.createInterface({ input: node_process_1.stdin, output: node_process_1.stdout });
require('dotenv').config();
const ports = [5000, 6000, 7000];
const selfPort = parseInt(process.env.PORT);
const startTime = Date.now();
const getPrefix = (prefix) => {
    // return `[${prefix} : ${(((Date.now() - startTime))/1000).toFixed(4)}s]`
    return `[${prefix} - ${new Date().getSeconds()}.${new Date().getMilliseconds()}]`;
};
const SECONDS_MULTIPLIER = 20;
const getTime = (ms) => {
    return ms * SECONDS_MULTIPLIER;
};
const clients = [];
const state = {
    role: types_1.Role.Follower,
    currentTerm: 0,
    votedFor: 0,
    voteCount: 0,
    log: []
};
const sendToAll = (data) => {
    clients.forEach(client => {
        client.write(data);
    });
    console.log(getPrefix("WRITE"), "Sent BC", data, "To", clients.map(c => c.remotePort));
};
const bcJSON = (data) => {
    sendToAll(JSON.stringify(data));
};
const bcMsg = (data) => {
    bcJSON(data);
};
const sendMsg = (client, data) => {
    client.write(JSON.stringify(data));
    console.log(getPrefix("WRITE"), "Sent to node ", data, client.remotePort);
};
const acceptJSON = (data) => {
    const json = JSON.parse(data);
    console.log(getPrefix("READ"), "Got ", json);
    return json;
};
const acceptMsg = (data) => {
    const json = acceptJSON(data);
    return json;
};
//SECTION: Connections
const connPrefix = "CONN";
const socketHandler = (socket, clients) => {
    console.log(getPrefix(connPrefix), "Connection", socket.remoteAddress, socket.remotePort, clients.map(c => c.remotePort));
    const port = socket.remotePort;
    const popClient = () => {
        const index = clients.indexOf(socket);
        if (index > -1) {
            clients.splice(index, 1);
        }
    };
    socket.on("data", (raw) => {
        const msgstr = raw.toString();
        console.log(getPrefix("READ"), "Msg from", socket.remotePort);
        const msg = acceptMsg(msgstr);
        switch (msg.type) {
            case types_1.MsgType.VoteRequest:
                sendVoteResponse(socket, acceptVoteRequest(msg.data));
                break;
            case types_1.MsgType.AppendEntriesRequest:
                sendAppendEntriesResponse(socket, acceptAppendEntries(msg.data));
                break;
            case types_1.MsgType.VoteResponse:
                acceptVoteResponse(msg.data);
                break;
            case types_1.MsgType.AppendEntriesResponse:
                break;
        }
    });
    socket.on("end", () => {
        console.log(getPrefix(connPrefix), "Disconnected from port: " + port);
        popClient();
    });
    socket.on("error", (error) => {
        console.log(getPrefix(connPrefix), "Error in connection to port: " + port);
        popClient();
    });
    clients.push(socket);
};
const selfConnect = (port) => {
    const selfConnPrefix = "SELFCONN";
    console.log(getPrefix(selfConnPrefix), "Trying to connect to port: " + port);
    const client = net_1.default.createConnection({
        port: port
    }, () => {
        console.log(getPrefix(selfConnPrefix), "Connected to port: " + port, clients.map(c => c.remotePort));
        socketHandler(client, clients);
    });
    client.on("error", (error) => {
        console.log(getPrefix(selfConnPrefix), "Error connecting to port: " + port);
    });
};
const serverSocketHandler = (socket) => {
    socketHandler(socket, clients);
};
const server = net_1.default.createServer(serverSocketHandler);
//$env:PORT='5000'; yarn dev
const filteredPorts = ports.filter(p => p !== selfPort);
server.listen(selfPort, '127.0.0.1');
console.log("Server listening on port: " + selfPort);
filteredPorts.forEach(port => {
    selfConnect(port);
});
//SECTION: Election
const electPrefix = "ELECT";
const sendVoteRequest = () => {
    bcMsg({
        type: types_1.MsgType.VoteRequest,
        data: {
            term: state.currentTerm,
            candidateId: selfPort,
            lastLogIndex: 0,
            lastLogTerm: 0
        }
    });
};
const sendVoteResponse = (client, voteGranted) => {
    sendMsg(client, {
        type: types_1.MsgType.VoteResponse,
        data: {
            term: state.currentTerm,
            voteGranted: voteGranted
        }
    });
};
const acceptVoteRequest = (data) => {
    //TODO: Check if log is up to date
    const vote = () => {
        state.votedFor = data.candidateId;
        console.log(getPrefix(electPrefix), "Voted for", data.candidateId, state);
    };
    if (data.term < state.currentTerm) {
        return false;
    }
    if (data.term > state.currentTerm) {
        resetElectionTimeout();
        state.currentTerm = data.term;
        resetRole2Follower();
        vote();
        return true;
    }
    if (state.votedFor == 0 || state.votedFor == data.candidateId) {
        vote();
        return true;
    }
    return false;
};
const acceptVoteResponse = (data) => {
    if (data.term < state.currentTerm) {
        return;
    }
    if (data.term > state.currentTerm) {
        resetElectionTimeout();
        state.currentTerm = data.term;
        resetRole2Follower();
        return;
    }
    if (data.voteGranted) {
        state.voteCount++;
        if (state.voteCount > ports.length / 2) {
            state.role = types_1.Role.Leader;
            console.log(getPrefix(electPrefix), "Became leader", state);
        }
    }
};
const selfVote = () => {
    state.votedFor = -1;
    state.voteCount = 1;
    state.currentTerm++;
    state.role = types_1.Role.Candidate;
    console.log(getPrefix(electPrefix), "Voted for self", state);
};
const resetRole2Follower = () => {
    state.role = types_1.Role.Follower;
    state.votedFor = 0;
    state.voteCount = 0;
    console.log(getPrefix(electPrefix), "Reset to follower", state);
};
const timeoutPrefix = "TIMEOUT";
const startElectionTimeout = () => {
    const randTime = getTime(Math.floor(Math.random() * 150) + 150);
    console.log(getPrefix(timeoutPrefix), "Starting election timeout", randTime, state);
    const timeout = setTimeout(() => {
        console.log(getPrefix(timeoutPrefix), "Election timeout", randTime, state);
        selfVote();
        sendVoteRequest();
        electionTimeout = startElectionTimeout();
    }, randTime);
    return timeout;
};
const resetElectionTimeout = () => {
    console.log(getPrefix(timeoutPrefix), "Resetting election timeout");
    (0, timers_1.clearTimeout)(electionTimeout);
    electionTimeout = startElectionTimeout();
    // timeout.refresh()
};
let electionTimeout = startElectionTimeout();
//SECTION: HEARTBEAT & LOG REPLICATION
const heartbeatPrefix = "HEARTBEAT";
const sendHeartbeat = () => {
    bcMsg({
        type: types_1.MsgType.AppendEntriesRequest,
        data: {
            term: state.currentTerm,
            leaderId: selfPort,
            prevLogIndex: 0,
            prevLogTerm: 0,
            entries: [],
            leaderCommit: 0
        }
    });
};
const acceptAppendEntries = (data) => {
    if (data.term < state.currentTerm) {
        return false;
    }
    if (data.term > state.currentTerm) {
        //TODO: rollback log
        resetElectionTimeout();
        state.currentTerm = data.term;
        resetRole2Follower();
        return true;
    }
    if (state.role == types_1.Role.Candidate) {
        resetElectionTimeout();
        resetRole2Follower();
        return true;
    }
    if (state.role == types_1.Role.Follower) {
        resetElectionTimeout();
        return true;
    }
    return false;
};
const sendAppendEntriesResponse = (client, success) => {
    sendMsg(client, {
        type: types_1.MsgType.AppendEntriesResponse,
        data: {
            term: state.currentTerm,
            success: success
        }
    });
};
const heartbeatTimeout = setInterval(() => {
    if (state.role == types_1.Role.Leader) {
        resetElectionTimeout();
        sendHeartbeat();
    }
}, getTime(100));
