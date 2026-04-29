#!/usr/bin/env node
// src/index.ts
import fs from "node:fs";
import path from "node:path";
import util from "node:util";
import { spawn } from "node:child_process";
import chokidar from "chokidar";
import { loadConfig, DEFAULT_CONFIG_DIR, DEFAULT_CONFIG_PATH, SERVER_DIR } from "./config.js";
import { assertSafeSkills } from "./security.js";
import { startHttp, startStdio } from "./mcp.js";
import { SkillScanner } from "./scanner.js";
import { ResolvedSkill, DashboardRegistry } from "./types.js";

const PID_FILE_PATH = path.join(DEFAULT_CONFIG_DIR, "server.pid");
const LOG_FILE_PATH = path.join(DEFAULT_CONFIG_DIR, "mcp.log");

const DEFAULT_CONFIG_CONTENT = JSON.stringify({
  server: {
    name: "superskills-mcp",
    version: "0.6.0",
    transport: "http",
    host: "127.0.0.1",
    port: 8787,
    ngrokToken: "",
    ngrokDomain: ""
  },
  defaults: {
    timeoutMs: 120000,
    maxOutputBytes: 10485760,
    runner: {
      command: "bun",
      args: ["{serverDir}/scripts/mcp-adapter.ts"]
    }
  },
  scanRoots: [
    "~/.agents/skills"
  ],
  scanSettings: {
    watch: true,
    ignore: ["node_modules", ".git"]
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

function setupLogging() {
  const logStream = fs.createWriteStream(LOG_FILE_PATH, { flags: 'a' });
  const originalLog = console.log;
  const originalError = console.error;

  const getTimestamp = () => new Date().toISOString();

  console.log = (...args: any[]) => {
    originalLog.apply(console, args);
    logStream.write(`[${getTimestamp()}] [INFO] ${util.format(...args)}\n`);
  };

  console.error = (...args: any[]) => {
    originalError.apply(console, args);
    logStream.write(`[${getTimestamp()}] [ERROR] ${util.format(...args)}\n`);
  };
}

async function runServe() {
  setupLogging();
  
  const { global: config, skills: staticSkills } = loadConfig();
  assertSafeSkills(staticSkills);

  console.error(`[mcp] server=${config.server.name} v${config.server.version}`);
  console.error(`[mcp] transport=${config.server.transport}`);

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

  const scanner = new SkillScanner(config);
  let dynamicSkills: ResolvedSkill[] = [];
  const registry: DashboardRegistry = new Map();

  const syncRegistry = (staticS: ResolvedSkill[], dynamicS: ResolvedSkill[]) => {
    for (const s of staticS) {
      if (!registry.has(s.name)) {
        registry.set(s.name, { callCount: 0, enabled: true, source: 'static' });
      } else {
        const m = registry.get(s.name)!;
        m.source = 'static';
      }
    }
    const staticNames = new Set(staticS.map(s => s.name));
    for (const s of dynamicS) {
      if (!staticNames.has(s.name)) {
        if (!registry.has(s.name)) {
          registry.set(s.name, { callCount: 0, enabled: true, source: 'auto' });
        } else {
          const m = registry.get(s.name)!;
          m.source = 'auto';
        }
      }
    }
  };

  const updateDynamicSkills = () => {
    const newSkills: ResolvedSkill[] = [];
    if (config.scanRoots && config.scanRoots.length > 0) {
      for (const root of config.scanRoots) {
        newSkills.push(...scanner.scanRoot(root));
      }
    }
    dynamicSkills = newSkills;
    syncRegistry(staticSkills, dynamicSkills);
    console.error(`[mcp] Dynamic registry updated: ${dynamicSkills.length} auto-discovered skills.`);
  };

  // Initial scan
  updateDynamicSkills();

  // Setup Watcher
  if (config.scanSettings?.watch && config.scanRoots && config.scanRoots.length > 0) {
    const watcher = chokidar.watch(config.scanRoots, {
      ignoreInitial: true,
      depth: 1,
      ignored: config.scanSettings.ignore || ["node_modules", ".git"]
    });
    watcher.on("all", () => {
      updateDynamicSkills();
    });
  }

  const getCombinedSkills = () => {
    // Manual skills take priority if names conflict
    const combined = [...staticSkills];
    const existingNames = new Set(staticSkills.map(s => s.name));
    
    for (const ds of dynamicSkills) {
      if (!existingNames.has(ds.name)) {
        combined.push(ds);
      }
    }
    return combined;
  };

  if (config.server.transport === "http") {
    await startHttp(config, getCombinedSkills, registry);
  } else {
    await startStdio(config, getCombinedSkills);
  }
}

function runServeDaemon() {
  const args = process.argv.slice(2).filter(a => a !== "--daemon" && a !== "-d");
  
  console.error("[mcp] Starting server in background mode...");

  const child = spawn(process.argv[0], [process.argv[1], ...args], {
    detached: true,
    stdio: ["ignore", "pipe", "pipe"]
  });

  let capturedOutput = "";
  let isExiting = false;
  
  const onData = (data: Buffer) => {
    if (isExiting) return;
    const chunk = data.toString();
    process.stderr.write(chunk);
    capturedOutput += chunk;

    if (capturedOutput.includes("Public URL:") || capturedOutput.includes("ChatGPT Action URL:")) {
      isExiting = true;
      console.error("\n\x1b[32m[mcp] Background server is ready and running.\x1b[0m");
      console.error("[mcp] Use 'superskills-mcp log' to follow logs.");
      
      child.unref();
      child.stdout?.destroy();
      child.stderr?.destroy();
      process.exit(0);
    }
  };

  child.stdout?.on("data", onData);
  child.stderr?.on("data", onData);

  child.on("error", (err) => {
    console.error(`[mcp] Failed to start background server: ${err.message}`);
    process.exit(1);
  });

  child.on("exit", (code) => {
    if (!isExiting) {
      console.error(`[mcp] Background process exited unexpectedly with code ${code}.`);
      process.exit(code ?? 1);
    }
  });

  // Safety timeout
  setTimeout(() => {
    if (!isExiting) {
      console.error("\n[mcp] Timeout: Ngrok URL not detected within 20s.");
      console.error("[mcp] Checking if server started anyway...");
      child.unref();
      child.stdout?.destroy();
      child.stderr?.destroy();
      process.exit(0);
    }
  }, 20000);
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
  } catch (err) {
    console.error(`[mcp] Failed to load config: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }

  const staticSkills = config.skills;
  const staticNames = new Set(staticSkills.map(s => s.name));

  // Also scan dynamic roots
  const scanner = new SkillScanner(config.global);
  const dynamicSkills = (config.global.scanRoots || [])
    .flatMap(root => scanner.scanRoot(root))
    .filter(s => !staticNames.has(s.name));

  const allSkills = [...staticSkills, ...dynamicSkills];

  if (config.global.notes) {
    console.log("\n--- Built-in Tools (Notes) ---");
    console.log("1. notes_list");
    console.log("2. notes_read");
    console.log("3. notes_write");
    console.log(`   Directory: ${config.global.notes.dir}`);
  }

  console.log(`\n📋 Registered Skills (${allSkills.length} total: ${staticSkills.length} static, ${dynamicSkills.length} auto-discovered):\n`);
  
  staticSkills.forEach((skill, index) => {
    console.log(`${index + 1}. \x1b[36m${skill.name}\x1b[0m`);
    console.log(`   Description : ${skill.description || 'No description provided'}`);
    console.log(`   Directory   : ${skill.skillDir}`);
    console.log(`   Inputs      : ${Object.keys(skill.input).join(", ") || 'None'}`);
    console.log(""); // Empty line for spacing
  });

  dynamicSkills.forEach((skill, index) => {
    console.log(`${staticSkills.length + index + 1}. \x1b[32m${skill.name}\x1b[0m \x1b[33m[auto]\x1b[0m`);
    console.log(`   Description : ${skill.description || 'No description provided'}`);
    console.log(`   Directory   : ${skill.skillDir}`);
    console.log(""); // Empty line for spacing
  });
}

function runAdd(skillPathStr: string) {
  if (!skillPathStr) {
    console.error("[mcp] Error: You must provide a path to the skill directory.");
    console.error("Usage: superskills-mcp add /path/to/skill");
    process.exit(1);
  }

  const absolutePath = path.resolve(skillPathStr);
  if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isDirectory()) {
    console.error(`[mcp] Error: The path ${absolutePath} is not a valid directory.`);
    process.exit(1);
  }

  let name = path.basename(absolutePath);
  let description = "Automatically added skill.";

  const skillMdPath = path.join(absolutePath, "SKILL.md");
  if (fs.existsSync(skillMdPath)) {
    const content = fs.readFileSync(skillMdPath, "utf8");
    const nameMatch = content.match(/^name:\s*(.+)$/m);
    if (nameMatch) name = nameMatch[1].trim();

    const descMatch = content.match(/^description:\s*(.+)$/m);
    if (descMatch) description = descMatch[1].trim();
  }

  let config;
  try {
    config = JSON.parse(fs.readFileSync(DEFAULT_CONFIG_PATH, "utf8"));
  } catch (err) {
    console.error(`[mcp] Failed to load config: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }

  if (config.skills.some((s: any) => s.name === name)) {
    console.error(`[mcp] Error: A skill with the name '${name}' already exists in your config.`);
    process.exit(1);
  }

  const newSkill = {
    name,
    description,
    skillDir: absolutePath,
    input: {},
    env: {}
  };

  config.skills.push(newSkill);
  fs.writeFileSync(DEFAULT_CONFIG_PATH, JSON.stringify(config, null, 2), "utf8");

  console.log(`[mcp] Successfully added skill: ${name}`);
  console.log(`[mcp] You may need to edit ${DEFAULT_CONFIG_PATH} to define the 'input' schema.`);
  console.log(`[mcp] Don't forget to run 'superskills-mcp reload' to apply changes!`);
}

function runRemove(skillName: string) {
  if (!skillName) {
    console.error("[mcp] Error: You must provide the name of the skill to remove.");
    console.error("Usage: superskills-mcp remove <skill-name>");
    process.exit(1);
  }

  let config;
  try {
    config = JSON.parse(fs.readFileSync(DEFAULT_CONFIG_PATH, "utf8"));
  } catch (err) {
    console.error(`[mcp] Failed to load config: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }

  const initialCount = config.skills.length;
  config.skills = config.skills.filter((s: any) => s.name !== skillName);

  if (config.skills.length === initialCount) {
    console.error(`[mcp] Error: Skill '${skillName}' not found in configuration.`);
    process.exit(1);
  }

  fs.writeFileSync(DEFAULT_CONFIG_PATH, JSON.stringify(config, null, 2), "utf8");
  console.log(`[mcp] Successfully removed skill: ${skillName}`);
  console.log(`[mcp] Don't forget to run 'superskills-mcp reload' to apply changes!`);
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
  } catch (e: any) {
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
  } catch (err: any) {
    console.error(`[mcp] Failed to stop process ${pid}: ${err.message}`);
    process.exit(1);
  }
}

function runReload() {
  console.log("[mcp] Reloading server...");

  if (fs.existsSync(PID_FILE_PATH)) {
    const pidStr = fs.readFileSync(PID_FILE_PATH, "utf8").trim();
    const pid = parseInt(pidStr, 10);
    if (!isNaN(pid)) {
      try {
        process.kill(pid, "SIGTERM");
        console.log(`[mcp] Stopped existing server (PID: ${pid}).`);
      } catch (e: any) {
        // Ignored if the process is not actually running
      }
    }
  }

  // Wait briefly for the port to be fully released before spawning the new instance
  setTimeout(() => {
    const child = spawn(process.argv[0], [process.argv[1], "serve"], {
      detached: true,
      stdio: "ignore"
    });

    child.unref();
    console.log(`[mcp] Server restarted successfully and is running in the background (New PID: ${child.pid}).`);
    process.exit(0);
  }, 1000);
}

function runStatus() {
  if (!fs.existsSync(PID_FILE_PATH)) {
    console.log("🔴 superskills-mcp is currently NOT running.");
    process.exit(0);
  }

  const pidStr = fs.readFileSync(PID_FILE_PATH, "utf8").trim();
  const pid = parseInt(pidStr, 10);

  if (isNaN(pid)) {
    console.log("🔴 superskills-mcp is currently NOT running (invalid PID file).");
    process.exit(0);
  }

  try {
    process.kill(pid, 0);
    console.log(`🟢 superskills-mcp is currently RUNNING (PID: ${pid}).`);
  } catch (e: any) {
    if (e.code === "ESRCH") {
      console.log("🔴 superskills-mcp is currently NOT running (stale PID file found and can be ignored).");
    } else {
      console.log(`🟡 superskills-mcp status is UNKNOWN (PID: ${pid}, Error: ${e.message}).`);
    }
  }
}

function runLog() {
  if (!fs.existsSync(LOG_FILE_PATH)) {
    console.error(`[mcp] No log file found at ${LOG_FILE_PATH}`);
    process.exit(1);
  }

  console.log(`\x1b[36mFollowing logs from ${LOG_FILE_PATH} (Press Ctrl+C to exit)...\x1b[0m\n`);
  const tail = spawn("tail", ["-f", LOG_FILE_PATH], { stdio: "inherit" });
  
  tail.on("error", (err) => {
    console.error(`[mcp] Failed to tail log file: ${err.message}`);
    process.exit(1);
  });
}

function runUpdate() {
  console.log("[mcp] Checking for updates and upgrading...");
  const child = spawn("npm", ["install", "-g", "superskills-mcp"], {
    stdio: "inherit",
    shell: true
  });
  child.on("close", (code) => {
    if (code === 0) {
      console.log("[mcp] Successfully updated superskills-mcp to the latest version.");
    } else {
      console.error(`[mcp] Update failed with exit code ${code}.`);
    }
    process.exit(code ?? 1);
  });
}

function getVersion() {
  const pkgPath = path.join(SERVER_DIR, "package.json");
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
  return pkg.version;
}

function printHelp() {
  console.error(`
Usage: superskills-mcp <command> [options]

Commands:
  init      Generate a default config file at ~/.superskills/mcp-config.json
  serve     Start the MCP server (reads config from ~/.superskills/mcp-config.json by default)
  add       Add a new skill by providing its local path
  remove    Remove an existing skill by its name
  list      List all currently registered skills
  stop      Stop a running MCP server
  reload    Smoothly restart the MCP server to apply new configuration changes
  status    Check if the MCP server is currently running
  log       Follow the real-time server logs
  update    Self-upgrade the superskills-mcp package to the latest version

Options:
  -v, --version        Print the current version
  --config <path>      Path to custom config JSON
  
Options for 'serve' only:
  --transport <type>   'http' or 'stdio'
  --port <number>      Port for HTTP transport
  --host <string>      Host for HTTP transport
  --daemon, -d         Run in background after logging the public URL (HTTP only)
`);
}

async function main() {
  const arg = process.argv[2];

  if (arg === "--version" || arg === "-v") {
    console.log(getVersion());
    process.exit(0);
  }

  const command = arg;

  switch (command) {
    case "init":
      runInit();
      break;
    case "serve":
      if (process.argv.includes("--daemon") || process.argv.includes("-d")) {
        runServeDaemon();
      } else {
        await runServe();
      }
      break;
    case "add":
      runAdd(process.argv[3]);
      break;
    case "remove":
      runRemove(process.argv[3]);
      break;
    case "list":
      runList();
      break;
    case "stop":
      runStop();
      break;
    case "reload":
      runReload();
      break;
    case "status":
      runStatus();
      break;
    case "log":
      runLog();
      break;
    case "update":
      runUpdate();
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
