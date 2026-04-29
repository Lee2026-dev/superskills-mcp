// src/runner.ts
import { spawn } from "node:child_process";
import path from "node:path";
import os from "node:os";
import { ResolvedSkill, SkillInput, SkillOutput } from "./types.js";

export class SkillRunnerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SkillRunnerError";
  }
}

/**
 * Entry point: routes to CLI mode or adapter (JSON stdin/stdout) mode
 */
export async function runSkill(
  skill: ResolvedSkill,
  args: Record<string, unknown>
): Promise<string> {
  if (skill.cliRunner) {
    return runSkillCli(skill, args);
  }
  return runSkillAdapter(skill, args);
}

// ---------------------------------------------------------------------------
// CLI Mode
// ---------------------------------------------------------------------------

async function runSkillCli(
  skill: ResolvedSkill,
  args: Record<string, unknown>
): Promise<string> {
  const cli = skill.cliRunner!;

  /** Substitute placeholders with path normalization and tilde expansion */
  const sub = (tpl: string): string =>
    tpl
      .replace(/\{skillDir\}/g, skill.skillDir)
      .replace(/\{args\.(\w+)\}/g, (_, key) => {
        let val = String(args[key] ?? "");
        // Expand tilde
        if (val.startsWith("~/")) {
          val = path.join(os.homedir(), val.slice(2));
        }
        // Normalize Unicode (NFC) to fix macOS Chinese path mismatch issues
        return val.normalize("NFC");
      });

  const resolvedArgs = cli.args.map(sub);

  if (cli.optionalArgs) {
    for (const [flag, valueTpl] of cli.optionalArgs) {
      const value = sub(valueTpl);
      if (!value || value === "undefined" || value === "null") continue;
      if (value === "true" || value === "1") {
        resolvedArgs.push(flag);
      } else {
        resolvedArgs.push(flag, value);
      }
    }
  }

  // Quote arguments for logging to make it clear how they are separated
  const logCmd = [cli.command, ...resolvedArgs]
    .map(a => a.includes(" ") ? `"${a}"` : a)
    .join(" ");
  console.error(`[mcp] CLI execute: ${logCmd}`);

  const child = spawn(cli.command, resolvedArgs, {
    cwd: skill.skillDir,
    env: { ...process.env, ...skill.env },
    shell: false, // spawn with array handles spaces automatically
    stdio: ["ignore", "pipe", "pipe"]
  });

  let stdout = Buffer.alloc(0);
  let stderr = Buffer.alloc(0);
  let killedByOutputLimit = false;

  const timeout = setTimeout(() => child.kill("SIGKILL"), skill.timeoutMs);

  child.stdout.on("data", (chunk: Buffer) => {
    stdout = Buffer.concat([stdout, chunk]);
    if (stdout.length > skill.maxOutputBytes) {
      killedByOutputLimit = true;
      child.kill("SIGKILL");
    }
  });

  child.stderr.on("data", (chunk: Buffer) => {
    stderr = Buffer.concat([stderr, chunk]);
  });

  const exit = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
    (resolve, reject) => {
      child.on("error", reject);
      child.on("close", (code, signal) => resolve({ code, signal }));
    }
  ).finally(() => clearTimeout(timeout));

  const stderrText = stderr.toString("utf8").trim();

  if (killedByOutputLimit) {
    throw new SkillRunnerError(`CLI output exceeds maxOutputBytes=${skill.maxOutputBytes}`);
  }

  if (exit.code !== 0) {
    throw new SkillRunnerError(
      `CLI skill failed (exit code ${exit.code}). stderr: ${stderrText || "(none)"}`
    );
  }

  const raw = stdout.toString("utf8").trim();
  if (!raw) {
    return stderrText || "✅ Done (no output)";
  }

  return parseSkillOutput(raw);
}

// ---------------------------------------------------------------------------
// Adapter Mode
// ---------------------------------------------------------------------------

async function runSkillAdapter(
  skill: ResolvedSkill,
  args: Record<string, unknown>
): Promise<string> {
  // Normalize args for adapter mode too
  const normalizedArgs: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args)) {
    if (typeof v === "string") {
      let val = v;
      if (val.startsWith("~/")) val = path.join(os.homedir(), val.slice(2));
      normalizedArgs[k] = val.normalize("NFC");
    } else {
      normalizedArgs[k] = v;
    }
  }

  const input: SkillInput = {
    tool: skill.name,
    args: normalizedArgs,
    context: {
      skillDir: skill.skillDir,
      skillName: skill.name
    }
  };

  const child = spawn(skill.runner.command, skill.runner.args, {
    cwd: skill.skillDir,
    env: { ...process.env, ...skill.env },
    shell: false,
    stdio: ["pipe", "pipe", "pipe"]
  });

  let stdout = Buffer.alloc(0);
  let stderr = Buffer.alloc(0);
  let killedByOutputLimit = false;

  const timeout = setTimeout(() => child.kill("SIGKILL"), skill.timeoutMs);

  child.stdout.on("data", (chunk: Buffer) => {
    stdout = Buffer.concat([stdout, chunk]);
    if (stdout.length > skill.maxOutputBytes) {
      killedByOutputLimit = true;
      child.kill("SIGKILL");
    }
  });

  child.stderr.on("data", (chunk: Buffer) => {
    stderr = Buffer.concat([stderr, chunk]);
  });

  child.stdin.write(JSON.stringify(input));
  child.stdin.end();

  const exit = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
    (resolve, reject) => {
      child.on("error", reject);
      child.on("close", (code, signal) => resolve({ code, signal }));
    }
  ).finally(() => clearTimeout(timeout));

  const stderrText = stderr.toString("utf8").trim();

  if (killedByOutputLimit || stdout.length > skill.maxOutputBytes) {
    throw new SkillRunnerError(`Skill output exceeds maxOutputBytes=${skill.maxOutputBytes}`);
  }

  if (exit.code !== 0) {
    throw new SkillRunnerError(
      `Skill process failed with code=${exit.code}, signal=${exit.signal}. stderr=${stderrText}`
    );
  }

  const raw = stdout.toString("utf8").trim();
  if (!raw) {
    throw new SkillRunnerError("Skill returned empty stdout");
  }

  return parseSkillOutput(raw);
}

function parseSkillOutput(raw: string): string {
  let parsed: SkillOutput | undefined;
  try {
    parsed = JSON.parse(raw) as SkillOutput;
  } catch {
    return raw;
  }

  if (parsed.ok === false) {
    throw new SkillRunnerError(
      parsed.error?.message ?? parsed.error?.code ?? "Skill returned ok=false"
    );
  }

  if (Array.isArray(parsed.content)) {
    return parsed.content
      .filter((item) => item.type === "text")
      .map((item) => item.text)
      .join("\n\n");
  }

  if (typeof parsed.markdown === "string") return parsed.markdown;
  if (typeof parsed.text === "string") return parsed.text;

  return JSON.stringify(parsed.data ?? parsed, null, 2);
}
