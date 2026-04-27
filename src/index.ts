#!/usr/bin/env node
// src/index.ts
import fs from "node:fs";
import { loadConfig, DEFAULT_CONFIG_DIR, DEFAULT_CONFIG_PATH } from "./config.js";
import { assertSafeSkills } from "./security.js";
import { startHttp, startStdio } from "./mcp.js";

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

  if (globalConfig.server.transport === "http") {
    await startHttp(globalConfig, skills);
  } else {
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

function printHelp() {
  console.error(`
Usage: superskills-mcp <command> [options]

Commands:
  init      Generate a default config file at ~/.superskills/mcp-config.json
  serve     Start the MCP server (reads config from ~/.superskills/mcp-config.json by default)

Options for 'serve':
  --config <path>      Path to custom config JSON
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
    default:
      printHelp();
      process.exit(1);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
});
