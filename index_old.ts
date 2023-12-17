/*
import net from "net"
import readline from 'node:readline';
import {stdin as input, stdout as output} from 'node:process';
const rl = readline.createInterface({ input, output });
require('dotenv').config()
const ports: number[] = [5000, 6000, 7000]
const selfPort = parseInt(process.env.PORT as string);

const writeClients: net.Socket[] = [];
const writeClientExist = (port:number) => {
    console.log("[LOG] Checking", port, " on ", writeClients.map(c => c.remotePort))
    return writeClients.map(c => c.remotePort).includes(port)
}
const readClients: net.Socket[] = [];

const rwMap = new Map<number, number>([])

const sendToAll = (data: string) => {
    if(writeClients.length === 0)
        return
    writeClients.forEach(client => {
        client.write(data)
    })
    console.log("[WRITE] Sent ", writeClients.map(c => c.remotePort))
    console.log("[STATUS] ", rwMap)
}
let i = 0;
setInterval(() => {
    sendToAll(`[${i}]`+ '  ' + selfPort)
    i++
}, 2000);

const connectOnWrite = (port: number, readPort: number) => {
    console.log("[SELF] Trying to connect to port: " + port)
    const client = net.createConnection({
        port: port
    }, () => {
        console.log("[SELF] Connected to port: " + port, writeClients.map(c => c.remotePort))
        client.write("CONNECT " + selfPort)
        rwMap.set(port, readPort)
        writeSocketHandler(client)
    })
    client.on("error", (error) => {
        console.log("[SELF] Error connecting to port: " + port)
    })
}

const socketHandler = (socket: net.Socket, clients: net.Socket[], prefix: string) => {

    console.log(prefix, "Connection", socket.remoteAddress, socket.remotePort, clients.map(c => c.remotePort))

    const port = socket.remotePort;

    socket.on("data", (data) => {
        const msg = data.toString();
        if(msg.startsWith("CONNECT")) {
            const writePort = parseInt(msg.split(" ")[1])
            if(!writeClientExist(writePort))
                connectOnWrite(writePort, port!)
            else
                rwMap.set(writePort, port!)
        }
        console.log(prefix, "Got:", data.toString(), clients.map(c => c.remotePort))
    });

    const popClient = () => {
        const index = clients.indexOf(socket);
        if (index > -1) {
            clients.splice(index, 1);
        }
    }

    socket.on("end", () => {
        console.log(prefix, "Disconnected from port: " + port)
        popClient()
    })

    socket.on("error", (error) => {
        console.log(prefix, "Error in connection to port: " + port)
        popClient()
    });

    clients.push(socket)
}

const readSocketHandler: (socket: net.Socket) => void = (socket) => {
    return socketHandler(socket, readClients, "[READ]")
}

const writeSocketHandler: (socket: net.Socket) => void = (socket) => {
    return socketHandler(socket, writeClients, "[WRITE]")
}


let server = net.createServer(readSocketHandler);

//$env:PORT='5000'; yarn dev
const filteredPorts = ports.filter(p => p !== selfPort);

server.listen(selfPort, '127.0.0.1');
console.log("Server listening on port: " + selfPort);

setTimeout(() => {
    filteredPorts.forEach(port => {
        if (!writeClientExist(port))
            connectOnWrite(port, 0)
    })
}, 0)



*/
