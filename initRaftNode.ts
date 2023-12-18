import {RaftNode} from "./classes/RaftNode";

const selfPort = parseInt(process.env.RAFTPORT as string);
const ports: number[] = [8000, 9000, 10000]

const raftNode = new RaftNode({selfPort, ports});

export default async () => {
    raftNode.start();
}


export { raftNode };
