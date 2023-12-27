import express, {Request, Response} from "express";
import {raftNode} from "../initRaftNode";
import {Role} from "../types";
import {lockRespStack, unlockRespStack} from "../initExpress";
import {Resp} from "../classes/Resp";
import {customLog} from "../utils";

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

router.post('/lock', (req: Request, res: Response)=>{
    const id = req.body.id;
    if(raftNode.role !== Role.Leader){
        res.sendStatus(400)
        return
    }
    lockRespStack.push({
        id: id,
        resp: new Resp(res)
    })
    raftNode.lock(id)
})

router.post('/unlock', (req: Request, res: Response)=>{
    // const id = req.body.id
    if(raftNode.role !== Role.Leader){
        res.sendStatus(400)
        return
    }
    unlockRespStack.push(res)
    raftNode.unlock()
})

export default router;
