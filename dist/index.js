"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const initRaftNode_1 = __importDefault(require("./initRaftNode"));
const initExpress_1 = __importDefault(require("./initExpress"));
(0, initRaftNode_1.default)();
(0, initExpress_1.default)();
