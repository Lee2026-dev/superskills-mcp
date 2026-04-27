// src/runner.ts
import { spawn } from "node:child_process";
import { ResolvedSkill, SkillInput, SkillOutput } from "./types.js";

export class SkillRunnerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SkillRunnerError";
  }
}

export async function runSkill(
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

  // Prefer JSON protocol. If the skill prints raw Markdown, accept it.
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
