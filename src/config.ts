// src/config.ts
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MultiSkillConfig, ResolvedSkill, RunnerConfig, SkillDefaults } from "./types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
/** MCP server 自身的根目录（dist/ 的上级） */
export const SERVER_DIR = path.resolve(__dirname, "..");

function readArg(name: string): string | undefined {
  const idx = process.argv.indexOf(name);
  if (idx === -1) return undefined;
  return process.argv[idx + 1];
}

function normalizeTransport(value: unknown): "stdio" | "http" {
  if (value === "http" || value === "stdio") return value;
  return "http";
}

/** 将 runner.args 中的 {serverDir} 替换为实际路径 */
function resolveRunnerArgs(args: string[]): string[] {
  return args.map((a) => a.replace("{serverDir}", SERVER_DIR));
}

function resolveRunner(runner: RunnerConfig): RunnerConfig {
  return { command: runner.command, args: resolveRunnerArgs(runner.args) };
}

export function loadConfig(): { global: MultiSkillConfig; skills: ResolvedSkill[] } {
  const configPathArg = readArg("--config");
  const configPath = configPathArg
    ? path.resolve(configPathArg)
    : path.resolve("config/skills.example.json");

  if (!fs.existsSync(configPath)) {
    throw new Error(`Config file not found: ${configPath}`);
  }

  const raw = JSON.parse(fs.readFileSync(configPath, "utf8")) as MultiSkillConfig;

  const transportArg = readArg("--transport");
  const portArg = readArg("--port");
  const hostArg = readArg("--host");

  // 命令行参数覆盖全局 server 字段
  raw.server.transport = normalizeTransport(transportArg ?? raw.server.transport);
  raw.server.host = hostArg ?? raw.server.host ?? "127.0.0.1";
  raw.server.port = Number(portArg ?? raw.server.port ?? 8787);

  const defaults: SkillDefaults = {
    timeoutMs: Number(raw.defaults?.timeoutMs ?? 120000),
    maxOutputBytes: Number(raw.defaults?.maxOutputBytes ?? 10485760),
    runner: resolveRunner(
      raw.defaults?.runner ?? { command: "bun", args: ["{serverDir}/scripts/mcp-adapter.ts"] }
    )
  };

  if (!Array.isArray(raw.skills) || raw.skills.length === 0) {
    throw new Error("Config must contain at least one skill in the 'skills' array.");
  }

  const skills: ResolvedSkill[] = raw.skills.map((s, i) => {
    if (!s.name) throw new Error(`skills[${i}] is missing 'name'`);
    if (!s.skillDir) throw new Error(`skills[${i}] ('${s.name}') is missing 'skillDir'`);

    return {
      name: s.name,
      description: s.description ?? "",
      skillDir: path.resolve(s.skillDir),
      input: s.input ?? {},
      env: s.env ?? {},
      runner: s.runner ? resolveRunner(s.runner) : defaults.runner,
      timeoutMs: s.timeoutMs ?? defaults.timeoutMs,
      maxOutputBytes: s.maxOutputBytes ?? defaults.maxOutputBytes
    };
  });

  return { global: raw, skills };
}
