"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const net_1 = __importDefault(require("net"));
const node_readline_1 = __importDefault(require("node:readline"));
const node_process_1 = require("node:process");
const rl = node_readline_1.default.createInterface({ input: node_process_1.stdin, output: node_process_1.stdout });
require('dotenv').config();
const ports = [5000, 6000, 7000];
const selfPort = parseInt(process.env.PORT);
const clients = [];
const sendToAll = (data) => {
    clients.forEach(client => {
        client.write(data);
    });
    console.log("[WRITE] Sent ", clients.map(c => c.remotePort));
};
let i = 0;
setInterval(() => {
    if (clients.length === 0)
        return;
    sendToAll(`[${i}]` + '  ' + selfPort);
    i++;
}, 2000);
const socketHandler = (socket, clients) => {
    console.log("Connection", socket.remoteAddress, socket.remotePort, clients.map(c => c.remotePort));
    const port = socket.remotePort;
    socket.on("data", (data) => {
        const msg = data.toString();
        console.log("Got:", msg, clients.map(c => c.remotePort));
    });
    const popClient = () => {
        const index = clients.indexOf(socket);
        if (index > -1) {
            clients.splice(index, 1);
        }
    };
    socket.on("end", () => {
        console.log("Disconnected from port: " + port);
        popClient();
    });
    socket.on("error", (error) => {
        console.log("Error in connection to port: " + port);
        popClient();
    });
    clients.push(socket);
};
const selfConnect = (port) => {
    console.log("[SELF] Trying to connect to port: " + port);
    const client = net_1.default.createConnection({
        port: port
    }, () => {
        console.log("[SELF] Connected to port: " + port, clients.map(c => c.remotePort));
        client.write("CONNECT " + selfPort);
        socketHandler(client, clients);
    });
    client.on("error", (error) => {
        console.log("[SELF] Error connecting to port: " + port);
    });
};
const serverSocketHandler = (socket) => {
    socketHandler(socket, clients);
};
let server = net_1.default.createServer(serverSocketHandler);
//$env:PORT='5000'; yarn dev
const filteredPorts = ports.filter(p => p !== selfPort);
server.listen(selfPort, '127.0.0.1');
console.log("Server listening on port: " + selfPort);
setTimeout(() => {
    filteredPorts.forEach(port => {
        selfConnect(port);
    });
}, 0);
