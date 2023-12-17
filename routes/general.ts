import express from "express";
import {Request, Response} from "express";
import {raftNode} from "../initRaftNode";

const router = express.Router();

router.get('/ping', (req: Request, res: Response)=>{
    res.send("pong");
})

router.get('/get/:key', (req: Request, res: Response)=>{
    const key = req.params.key;
})

router.post('/set', (req: Request, res: Response)=>{
    const key = req.body.key;
    const val = req.body.value;
    console.log(key, val)
    res.sendStatus(200)
})

export default router;
