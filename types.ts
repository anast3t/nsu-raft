export enum Role {
    "Follower",
    "Candidate",
    "Leader"
}

export type SystemState = {
    role: Role;
    currentTerm: number;
    votedFor: number;
    voteCount: number;
    log: LogEntry[];
}

export type LogEntry = {
    term: number;
    command: LogCommand;
}

export type LogCommand = {
    key: string;
    value: string
}

export enum MsgType {
    "VoteRequest",
    "AppendEntriesRequest",
    "VoteResponse",
    "AppendEntriesResponse"
}

export type VoteRequest = {
    term: number;
    candidateId: number;
    lastLogIndex: number;
    lastLogTerm: number;
}

export type VoteResponse = {
    term: number;
    voteGranted: boolean;
}

export type AppendEntriesRequest = {
    term: number;
    leaderId: number;
    prevLogIndex: number;
    prevLogTerm: number;
    entries: LogEntry[];
    leaderCommit: number;
}

export type AppendEntriesResponse = {
    term: number;
    success: boolean;
}

export type Message = {
    type: MsgType.VoteRequest,
    data: VoteRequest
} | {
    type: MsgType.AppendEntriesRequest,
    data: AppendEntriesRequest
} | {
    type: MsgType.VoteResponse,
    data: VoteResponse
} | {
    type: MsgType.AppendEntriesResponse,
    data: AppendEntriesResponse
}
