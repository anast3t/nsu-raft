import {RaftNode} from "./classes/RaftNode";

const selfPort = parseInt(process.env.RAFTPORT as string);
const ports: number[] = [5000, 6000, 7000]

const raftNode = new RaftNode({selfPort, ports});

export default async () => {
    raftNode.start();
}


export { raftNode };
