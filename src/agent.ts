// src/agent.ts
//
// "Agent Mode" infrastructure tools.
//
// These tools give ChatGPT the raw primitives needed to fully execute any
// instruction-based skill (SKILL.md), rather than wrapping the skill as a
// single black-box function call.
//
// Tool inventory:
//   superskills_invoke      - Load a skill's SKILL.md so ChatGPT can follow it
//   superskills_run         - Execute any shell command and return output
//   superskills_read_file   - Read any file on the local filesystem
//   superskills_write_file  - Write (or create) any file
//   superskills_list_dir    - List directory contents
//   superskills_env         - Read .baoyu-skills/.env credentials
//   superskills_list_skills - List all registered skills with descriptions

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ResolvedSkill, MultiSkillConfig } from "./types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resolvePath(p: string): string {
  if (p.startsWith("~/")) {
    p = path.join(os.homedir(), p.slice(2));
  }
  // Normalize Unicode (NFC) to fix macOS Chinese path issues (NFC vs NFD)
  return path.resolve(p).normalize("NFC");
}

/** Read .env file (KEY=VALUE lines) from one or more candidate paths */
function readDotEnv(filePaths: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const fp of filePaths) {
    if (!fs.existsSync(fp)) continue;
    const lines = fs.readFileSync(fp, "utf8").split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim().replace(/^['"]|['"]$/g, "");
      result[key] = val;
    }
    break; // First file found wins
  }
  return result;
}

/** Replace common placeholders in SKILL.md content before returning to ChatGPT */
function resolveSkillMdContent(content: string, skill: ResolvedSkill): string {
  const runnerCmd = skill.runner.command; // e.g. "bun"
  return content
    .replace(/\$\{BUN_X\}/g, runnerCmd)
    .replace(/\{baseDir\}/g, skill.skillDir)
    .replace(/\{skillDir\}/g, skill.skillDir);
}

// ---------------------------------------------------------------------------
// Async command execution helper
// ---------------------------------------------------------------------------

async function execCommand(
  command: string,
  args: string[],
  cwd: string,
  env: Record<string, string>,
  timeoutMs: number
): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: { ...process.env, ...env },
      shell: false,
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stdout = Buffer.alloc(0);
    let stderr = Buffer.alloc(0);
    const MAX = 10 * 1024 * 1024; // 10 MB cap

    child.stdout.on("data", (chunk: Buffer) => {
      stdout = Buffer.concat([stdout, chunk]);
      if (stdout.length > MAX) child.kill("SIGKILL");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = Buffer.concat([stderr, chunk]);
    });

    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);

    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({
        stdout: stdout.toString("utf8").trim(),
        stderr: stderr.toString("utf8").trim(),
        exitCode: code
      });
    });
  });
}

// ---------------------------------------------------------------------------
// Register all agent tools onto an MCP server
// ---------------------------------------------------------------------------

export function registerAgentTools(
  server: McpServer,
  config: MultiSkillConfig,
  getSkills: () => ResolvedSkill[]
): void {

  // ── superskills_list_skills ───────────────────────────────────────────────
  server.tool(
    "superskills_list_skills",
    "List all available skills with their names, descriptions and skill directories. Use this to discover which skill to invoke.",
    {},
    async () => {
      const skills = getSkills();
      if (skills.length === 0) {
        return { content: [{ type: "text" as const, text: "No skills registered." }] };
      }
      const lines = skills.map(s =>
        `**${s.name}**\n  Dir: ${s.skillDir}\n  ${s.description}`
      );
      return {
        content: [{
          type: "text" as const,
          text: `# Available Skills (${skills.length})\n\n${lines.join("\n\n")}`
        }]
      };
    }
  );

  // ── superskills_invoke ────────────────────────────────────────────────────
  server.tool(
    "superskills_invoke",
    [
      "Load a skill's full instruction manual (SKILL.md) so you can execute it step by step.",
      "Returns the skill instructions with all placeholders resolved ({baseDir}, ${BUN_X}, etc.),",
      "plus a summary of the agent tools available to carry out the instructions.",
      "After reading the instructions, use superskills_run / superskills_read_file /",
      "superskills_write_file / superskills_list_dir / superskills_env as needed."
    ].join(" "),
    {
      skill_name: z.string().describe("Name of the skill to invoke, e.g. 'baoyu_post_to_wechat'. Use superskills_list_skills to discover names.")
    },
    async ({ skill_name }) => {
      const skills = getSkills();
      const skill = skills.find(s => s.name === skill_name);
      if (!skill) {
        const names = skills.map(s => s.name).join(", ");
        return {
          isError: true,
          content: [{ type: "text" as const, text: `Skill '${skill_name}' not found. Available: ${names}` }]
        };
      }

      const skillMdPath = path.join(skill.skillDir, "SKILL.md");
      if (!fs.existsSync(skillMdPath)) {
        return {
          isError: true,
          content: [{ type: "text" as const, text: `SKILL.md not found in: ${skill.skillDir}` }]
        };
      }

      const rawContent = fs.readFileSync(skillMdPath, "utf8");
      const resolvedContent = resolveSkillMdContent(rawContent, skill);

      const agentGuide = [
        `# 🚀 Skill Invoked: ${skill.name}`,
        `**Skill Directory:** \`${skill.skillDir}\``,
        `**Runner:** \`${skill.runner.command}\``,
        "",
        "## Agent Execution Tools",
        "You have access to the following tools to carry out the skill instructions:",
        "",
        "| Tool | Purpose |",
        "|------|---------|",
        "| `superskills_run` | Execute any shell command (replaces bash/terminal) |",
        "| `superskills_read_file` | Read any local file |",
        "| `superskills_write_file` | Write or create any local file |",
        "| `superskills_list_dir` | List directory contents |",
        "| `superskills_env` | Read `.baoyu-skills/.env` credentials |",
        "",
        "## Placeholder Reference",
        `- \`{baseDir}\` = \`${skill.skillDir}\``,
        `- \`{skillDir}\` = \`${skill.skillDir}\``,
        `- \`\${BUN_X}\` = \`${skill.runner.command}\``,
        "",
        "---",
        "",
        "## Skill Instructions (SKILL.md)",
        "",
        resolvedContent
      ].join("\n");

      return { content: [{ type: "text" as const, text: agentGuide }] };
    }
  );

  // ── superskills_run ───────────────────────────────────────────────────────
  server.tool(
    "superskills_run",
    [
      "Execute a shell command on the local machine and return its stdout, stderr and exit code.",
      "Use this to run skill scripts, check files, read environment, etc.",
      "Pass command and args as separate parameters (never concatenate into a shell string).",
      "Example: command='bun', args=['/path/to/script.ts', 'file.md', '--theme', 'grace']"
    ].join(" "),
    {
      command: z.string().describe("The executable to run, e.g. 'bun', 'bash', 'node', 'python3'"),
      args: z.array(z.string()).optional().describe("Command arguments as an array (handles spaces safely)"),
      cwd: z.string().optional().describe("Working directory. Defaults to the user home directory."),
      env: z.record(z.string()).optional().describe("Extra environment variables to inject"),
      timeout_ms: z.number().optional().describe("Execution timeout in milliseconds. Default: 120000 (2 min).")
    },
    async ({ command, args = [], cwd, env = {}, timeout_ms = 120000 }) => {
      const resolvedCwd = cwd ? resolvePath(cwd) : os.homedir();
      const resolvedArgs = args.map(a => {
        let v = a;
        if (v.startsWith("~/")) v = path.join(os.homedir(), v.slice(2));
        return v.normalize("NFC");
      });

      const logCmd = [command, ...resolvedArgs]
        .map(a => a.includes(" ") ? `"${a}"` : a)
        .join(" ");
      console.error(`[agent] run: ${logCmd} (cwd=${resolvedCwd})`);

      try {
        const { stdout, stderr, exitCode } = await execCommand(
          command,
          resolvedArgs,
          resolvedCwd,
          env,
          timeout_ms
        );

        const parts: string[] = [];
        if (stdout) parts.push(`**stdout:**\n\`\`\`\n${stdout}\n\`\`\``);
        if (stderr) parts.push(`**stderr:**\n\`\`\`\n${stderr}\n\`\`\``);
        parts.push(`**exit code:** ${exitCode ?? "null"}`);

        return {
          content: [{
            type: "text" as const,
            text: parts.join("\n\n")
          }]
        };
      } catch (err) {
        return {
          isError: true,
          content: [{
            type: "text" as const,
            text: `Failed to execute command: ${err instanceof Error ? err.message : String(err)}`
          }]
        };
      }
    }
  );

  // ── superskills_read_file ─────────────────────────────────────────────────
  server.tool(
    "superskills_read_file",
    "Read the full content of any local file. Supports ~ paths and Chinese/Unicode filenames.",
    {
      path: z.string().describe("Absolute or ~ path to the file, e.g. ~/Downloads/article.md"),
      encoding: z.enum(["utf8", "base64"]).optional().describe("File encoding. Default: utf8")
    },
    async ({ path: filePath, encoding = "utf8" }) => {
      const absPath = resolvePath(filePath);
      if (!fs.existsSync(absPath)) {
        return {
          isError: true,
          content: [{ type: "text" as const, text: `File not found: ${absPath}` }]
        };
      }
      try {
        const stat = fs.statSync(absPath);
        if (stat.isDirectory()) {
          return {
            isError: true,
            content: [{ type: "text" as const, text: `Path is a directory, not a file: ${absPath}. Use superskills_list_dir instead.` }]
          };
        }
        const content = fs.readFileSync(absPath, encoding as BufferEncoding);
        return {
          content: [{
            type: "text" as const,
            text: `**File:** \`${absPath}\` (${stat.size} bytes)\n\n---\n\n${content}`
          }]
        };
      } catch (err) {
        return {
          isError: true,
          content: [{ type: "text" as const, text: `Error reading file: ${err instanceof Error ? err.message : String(err)}` }]
        };
      }
    }
  );

  // ── superskills_write_file ────────────────────────────────────────────────
  server.tool(
    "superskills_write_file",
    "Write content to a local file, creating parent directories automatically. Overwrites existing files.",
    {
      path: z.string().describe("Absolute or ~ path to write to"),
      content: z.string().describe("Content to write to the file"),
      append: z.boolean().optional().describe("If true, append to existing file instead of overwriting. Default: false")
    },
    async ({ path: filePath, content, append = false }) => {
      const absPath = resolvePath(filePath);
      try {
        fs.mkdirSync(path.dirname(absPath), { recursive: true });
        if (append) {
          fs.appendFileSync(absPath, content, "utf8");
        } else {
          fs.writeFileSync(absPath, content, "utf8");
        }
        return {
          content: [{
            type: "text" as const,
            text: `✅ ${append ? "Appended" : "Written"} ${content.length} chars to \`${absPath}\``
          }]
        };
      } catch (err) {
        return {
          isError: true,
          content: [{ type: "text" as const, text: `Error writing file: ${err instanceof Error ? err.message : String(err)}` }]
        };
      }
    }
  );

  // ── superskills_list_dir ──────────────────────────────────────────────────
  server.tool(
    "superskills_list_dir",
    "List the contents of a directory. Returns files and subdirectories with sizes and types.",
    {
      path: z.string().describe("Absolute or ~ path to the directory"),
      recursive: z.boolean().optional().describe("If true, list recursively. Default: false"),
      filter: z.string().optional().describe("File extension filter, e.g. '.md', '.ts'. Default: all files")
    },
    async ({ path: dirPath, recursive = false, filter }) => {
      const absPath = resolvePath(dirPath);
      if (!fs.existsSync(absPath)) {
        return {
          isError: true,
          content: [{ type: "text" as const, text: `Directory not found: ${absPath}` }]
        };
      }

      const entries: string[] = [];

      function walk(dir: string, prefix: string, depth: number) {
        if (depth > 10) return; // safety limit
        let items: fs.Dirent[];
        try {
          items = fs.readdirSync(dir, { withFileTypes: true });
        } catch {
          return;
        }
        for (const item of items) {
          const fullPath = path.join(dir, item.name);
          const rel = prefix ? `${prefix}/${item.name}` : item.name;
          if (item.isDirectory()) {
            entries.push(`📁 ${rel}/`);
            if (recursive) walk(fullPath, rel, depth + 1);
          } else if (item.isFile()) {
            if (filter && !item.name.endsWith(filter)) continue;
            try {
              const { size } = fs.statSync(fullPath);
              const sizeStr = size > 1024 * 1024
                ? `${(size / 1024 / 1024).toFixed(1)} MB`
                : size > 1024
                  ? `${(size / 1024).toFixed(1)} KB`
                  : `${size} B`;
              entries.push(`📄 ${rel} (${sizeStr})`);
            } catch {
              entries.push(`📄 ${rel}`);
            }
          }
        }
      }

      walk(absPath, "", 0);

      if (entries.length === 0) {
        return { content: [{ type: "text" as const, text: `Directory is empty: ${absPath}` }] };
      }

      return {
        content: [{
          type: "text" as const,
          text: `**Directory:** \`${absPath}\`\n\n${entries.join("\n")}\n\n_${entries.length} item(s)_`
        }]
      };
    }
  );

  // ── superskills_env ───────────────────────────────────────────────────────
  server.tool(
    "superskills_env",
    [
      "Read credentials and environment variables from .baoyu-skills/.env files.",
      "Checks project-level (.baoyu-skills/.env) then user-level (~/.baoyu-skills/.env).",
      "You can also optionally check the skill's own directory for .env.",
      "Returns all KEY=VALUE pairs found. Sensitive values are shown — only call this when needed for skill execution."
    ].join(" "),
    {
      skill_name: z.string().optional().describe("Optional: skill name to also check for skill-specific .env"),
      keys: z.array(z.string()).optional().describe("Optional: only return these specific keys instead of all")
    },
    async ({ skill_name, keys }) => {
      const candidatePaths: string[] = [
        path.join(process.cwd(), ".baoyu-skills", ".env"),
        path.join(os.homedir(), ".baoyu-skills", ".env")
      ];

      if (skill_name) {
        const skills = getSkills();
        const skill = skills.find(s => s.name === skill_name);
        if (skill) {
          candidatePaths.unshift(path.join(skill.skillDir, ".env"));
          candidatePaths.unshift(path.join(skill.skillDir, "..", ".env"));
        }
      }

      const envVars = readDotEnv(candidatePaths);

      if (Object.keys(envVars).length === 0) {
        return {
          content: [{
            type: "text" as const,
            text: [
              "No .env file found. Checked paths:",
              ...candidatePaths.map(p => `  - ${p}`),
              "",
              "To create credentials, write a file at `~/.baoyu-skills/.env` with:",
              "```",
              "WECHAT_APP_ID=your_app_id",
              "WECHAT_APP_SECRET=your_app_secret",
              "```"
            ].join("\n")
          }]
        };
      }

      const filtered = keys
        ? Object.fromEntries(Object.entries(envVars).filter(([k]) => keys.includes(k)))
        : envVars;

      const lines = Object.entries(filtered).map(([k, v]) => `${k}=${v}`);
      const foundPath = candidatePaths.find(p => fs.existsSync(p)) ?? "unknown";

      return {
        content: [{
          type: "text" as const,
          text: `**Env file:** \`${foundPath}\`\n\n\`\`\`\n${lines.join("\n")}\n\`\`\``
        }]
      };
    }
  );

  console.error(`[mcp] Agent tools registered: superskills_invoke, superskills_run, superskills_read_file, superskills_write_file, superskills_list_dir, superskills_env, superskills_list_skills`);
}
