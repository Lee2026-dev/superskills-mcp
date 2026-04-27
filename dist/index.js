#!/usr/bin/env node
// src/index.ts
import fs from "node:fs";
import path from "node:path";
import { loadConfig, DEFAULT_CONFIG_DIR, DEFAULT_CONFIG_PATH } from "./config.js";
import { assertSafeSkills } from "./security.js";
import { startHttp, startStdio } from "./mcp.js";
const PID_FILE_PATH = path.join(DEFAULT_CONFIG_DIR, "server.pid");
const DEFAULT_CONFIG_CONTENT = JSON.stringify({
    server: {
        name: "superskills-mcp",
        version: "0.4.0",
        transport: "http",
        host: "127.0.0.1",
        port: 8787
    },
    defaults: {
        timeoutMs: 120000,
        maxOutputBytes: 10485760,
        runner: {
            command: "bun",
            args: ["{serverDir}/scripts/mcp-adapter.ts"]
        }
    },
    skills: [
        {
            name: "read_x_to_markdown",
            description: "Read a given X/Twitter link and return clean Markdown.",
            skillDir: "/Users/wenli/.baoyu-skills/skills/baoyu-danger-x-to-markdown",
            input: {
                "url": {
                    "type": "string",
                    "format": "uri",
                    "description": "X/Twitter post URL to read"
                }
            },
            "env": {
                "BAOYU_X_TO_MARKDOWN_DOWNLOAD_MEDIA": "true",
                "BAOYU_X_TO_MARKDOWN_KEEP_OUTPUT": "false"
            }
        }
    ]
}, null, 2);
async function runServe() {
    const { global: globalConfig, skills } = loadConfig();
    assertSafeSkills(skills);
    console.error(`[mcp] server=${globalConfig.server.name} v${globalConfig.server.version}`);
    console.error(`[mcp] transport=${globalConfig.server.transport}`);
    console.error(`[mcp] ${skills.length} skill(s) loaded:`);
    for (const s of skills) {
        console.error(`  - ${s.name} (skillDir=${s.skillDir})`);
    }
    // Manage PID file for 'stop' command
    fs.writeFileSync(PID_FILE_PATH, process.pid.toString(), "utf8");
    const cleanup = () => {
        if (fs.existsSync(PID_FILE_PATH)) {
            fs.unlinkSync(PID_FILE_PATH);
        }
        process.exit(0);
    };
    process.on("SIGINT", cleanup);
    process.on("SIGTERM", cleanup);
    if (globalConfig.server.transport === "http") {
        await startHttp(globalConfig, skills);
    }
    else {
        await startStdio(globalConfig, skills);
    }
}
function runInit() {
    if (fs.existsSync(DEFAULT_CONFIG_PATH)) {
        console.error(`[mcp] Configuration already exists at ${DEFAULT_CONFIG_PATH}`);
        process.exit(0);
    }
    fs.mkdirSync(DEFAULT_CONFIG_DIR, { recursive: true });
    fs.writeFileSync(DEFAULT_CONFIG_PATH, DEFAULT_CONFIG_CONTENT, "utf8");
    console.error(`[mcp] Created default configuration at ${DEFAULT_CONFIG_PATH}`);
    console.error(`[mcp] Edit this file to register your skills, then run 'superskills-mcp serve'`);
}
function runList() {
    let config;
    try {
        config = loadConfig();
    }
    catch (err) {
        console.error(`[mcp] Failed to load config: ${err instanceof Error ? err.message : String(err)}`);
        process.exit(1);
    }
    const skills = config.skills;
    console.log(`\n📋 Registered Skills (${skills.length}):\n`);
    skills.forEach((skill, index) => {
        console.log(`${index + 1}. \x1b[36m${skill.name}\x1b[0m`);
        console.log(`   Description : ${skill.description || 'No description provided'}`);
        console.log(`   Directory   : ${skill.skillDir}`);
        console.log(`   Inputs      : ${Object.keys(skill.input).join(", ") || 'None'}`);
        console.log(""); // Empty line for spacing
    });
}
function runStop() {
    if (!fs.existsSync(PID_FILE_PATH)) {
        console.error("[mcp] No PID file found. The server does not appear to be running.");
        process.exit(0);
    }
    const pidStr = fs.readFileSync(PID_FILE_PATH, "utf8").trim();
    const pid = parseInt(pidStr, 10);
    if (isNaN(pid)) {
        console.error("[mcp] Invalid PID file content. Cleaning up...");
        fs.unlinkSync(PID_FILE_PATH);
        process.exit(1);
    }
    try {
        // Test if process exists by sending signal 0
        process.kill(pid, 0);
    }
    catch (e) {
        if (e.code === "ESRCH") {
            console.error(`[mcp] Process ${pid} is not running. Cleaning up stale PID file...`);
            fs.unlinkSync(PID_FILE_PATH);
            process.exit(0);
        }
    }
    try {
        // Send termination signal
        process.kill(pid, "SIGTERM");
        console.log(`[mcp] Successfully stopped server (PID: ${pid}).`);
        // Note: The serve process has a cleanup handler that removes the PID file.
    }
    catch (err) {
        console.error(`[mcp] Failed to stop process ${pid}: ${err.message}`);
        process.exit(1);
    }
}
function printHelp() {
    console.error(`
Usage: superskills-mcp <command> [options]

Commands:
  init      Generate a default config file at ~/.superskills/mcp-config.json
  serve     Start the MCP server (reads config from ~/.superskills/mcp-config.json by default)
  list      List all currently registered skills
  stop      Stop a running MCP server

Options for 'serve' & 'list':
  --config <path>      Path to custom config JSON
  
Options for 'serve' only:
  --transport <type>   'http' or 'stdio'
  --port <number>      Port for HTTP transport
  --host <string>      Host for HTTP transport
`);
}
async function main() {
    const command = process.argv[2];
    switch (command) {
        case "init":
            runInit();
            break;
        case "serve":
            await runServe();
            break;
        case "list":
            runList();
            break;
        case "stop":
            runStop();
            break;
        default:
            printHelp();
            process.exit(1);
    }
}
main().catch((error) => {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    process.exit(1);
});
