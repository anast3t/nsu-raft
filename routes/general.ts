import express, {Request, Response} from "express";
import {raftNode} from "../initRaftNode";
import {Role} from "../types";
import {app, setLateAnswer} from "../initExpress";

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
    raftNode.leaderAddLogEntry(key, val)
    res.sendStatus(200)
})

router.post('/lock', (req: Request, res: Response)=> {
    if(!raftNode.firstLock(raftNode.selfPort))
        res.sendStatus(400)
    else
        setLateAnswer(raftNode.selfPort, res)
})

router.post('/unlock', (req: Request, res: Response)=> {
    if(!raftNode.unlock())
        res.sendStatus(400)
    else
        setLateAnswer(raftNode.selfPort, res)
})


export default router;
