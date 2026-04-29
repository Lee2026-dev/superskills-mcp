// src/runner.ts
import { spawn } from "node:child_process";
import { ResolvedSkill, SkillInput, SkillOutput } from "./types.js";

export class SkillRunnerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SkillRunnerError";
  }
}

/**
 * Entry point: routes to CLI mode or adapter (JSON stdin/stdout) mode
 * based on whether skill.cliRunner is defined.
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
// CLI Mode: maps MCP args → command-line arguments and runs the process directly
// ---------------------------------------------------------------------------

async function runSkillCli(
  skill: ResolvedSkill,
  args: Record<string, unknown>
): Promise<string> {
  const cli = skill.cliRunner!;

  /** Substitute {skillDir} and {args.key} placeholders in a template string */
  const sub = (tpl: string): string =>
    tpl
      .replace(/\{skillDir\}/g, skill.skillDir)
      .replace(/\{args\.(\w+)\}/g, (_, key) => String(args[key] ?? ""));

  // Build required positional args
  const resolvedArgs = cli.args.map(sub);

  // Append optional flag-value pairs only when the value is non-empty
  if (cli.optionalArgs) {
    for (const [flag, valueTpl] of cli.optionalArgs) {
      const value = sub(valueTpl);
      if (!value || value === "undefined" || value === "null") continue;
      // Boolean flag: just add --flag without a value
      if (value === "true" || value === "1") {
        resolvedArgs.push(flag);
      } else {
        resolvedArgs.push(flag, value);
      }
    }
  }

  console.error(`[mcp] CLI execute: ${cli.command} ${resolvedArgs.join(" ")}`);

  const child = spawn(cli.command, resolvedArgs, {
    cwd: skill.skillDir,
    env: { ...process.env, ...skill.env },
    shell: false,
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
    // Some CLI tools write results to stderr and exit 0
    return stderrText || "✅ Done (no output)";
  }

  return parseSkillOutput(raw);
}

// ---------------------------------------------------------------------------
// Adapter Mode: sends JSON to mcp-adapter.ts via stdin, reads JSON from stdout
// ---------------------------------------------------------------------------

async function runSkillAdapter(
  skill: ResolvedSkill,
  args: Record<string, unknown>
): Promise<string> {
  const input: SkillInput = {
    tool: skill.name,
    args,
    context: {
      skillDir: skill.skillDir,
      skillName: skill.name
    }
  };

  const child = spawn(skill.runner.command, skill.runner.args, {
    cwd: skill.skillDir,
    env: {
      ...process.env,
      ...skill.env
    },
    shell: false,
    stdio: ["pipe", "pipe", "pipe"]
  });

  let stdout = Buffer.alloc(0);
  let stderr = Buffer.alloc(0);
  let killedByOutputLimit = false;

  const timeout = setTimeout(() => {
    child.kill("SIGKILL");
  }, skill.timeoutMs);

  child.stdout.on("data", (chunk: Buffer) => {
    stdout = Buffer.concat([stdout, chunk]);
    if (stdout.length > skill.maxOutputBytes) {
      killedByOutputLimit = true;
      child.kill("SIGKILL");
    }
  });

  child.stderr.on("data", (chunk: Buffer) => {
    stderr = Buffer.concat([stderr, chunk]);
    if (stderr.length > skill.maxOutputBytes) {
      child.kill("SIGKILL");
    }
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

// ---------------------------------------------------------------------------
// Shared output parser (handles both JSON protocol and raw text/markdown)
// ---------------------------------------------------------------------------

function parseSkillOutput(raw: string): string {
  let parsed: SkillOutput | undefined;
  try {
    parsed = JSON.parse(raw) as SkillOutput;
  } catch {
    // Not JSON → treat as raw Markdown/text
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
