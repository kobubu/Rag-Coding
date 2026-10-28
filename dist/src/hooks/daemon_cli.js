#!/usr/bin/env node
// Keeps one CM configuration loaded for the UserPromptSubmit hook; started by the hook itself or by the user.
import { agentOptions } from "../local-agent/config.js";
import { serve } from "./daemon.js";
const address = await serve(agentOptions(process.argv.slice(2)));
console.log(JSON.stringify({ application: "CM hook daemon", address, pid: process.pid }));
