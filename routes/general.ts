import express, {Request, Response} from "express";
import {raftNode} from "../initRaftNode";
import {Role} from "../types";

const router = express.Router();

router.get('/ping', (req: Request, res: Response)=>{
    res.send("pong");
})

router.get('/get/:key', (req: Request, res: Response)=>{
    const key = req.params.key;
})

router.get('/get', (req: Request, res: Response)=>{
    res.status(200).send(raftNode.logEntries.logEntries)
})

router.get('/getStorage', (req: Request, res: Response)=>{
    res.status(200).send(Array.from(raftNode.storage.storage.entries()))
})

router.post('/set', (req: Request, res: Response)=>{
    const key = req.body.key;
    const val = req.body.value;
    console.log(key, val)
    if(raftNode.role !== Role.Leader){
        //TODO: redirect to leader
        res.sendStatus(400)
        return
    }
    raftNode.addLogEntry(key, val)
    res.sendStatus(200)
})

export default router;
