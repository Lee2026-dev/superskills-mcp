import fs from "node:fs";
import path from "node:path";
import { ResolvedSkill, MultiSkillConfig, InputFieldSchema } from "./types.js";

export class SkillScanner {
  constructor(private config: MultiSkillConfig) {}

  /**
   * Scans a root directory for subdirectories containing SKILL.md
   */
  public scanRoot(rootPath: string): ResolvedSkill[] {
    const skills: ResolvedSkill[] = [];
    if (!fs.existsSync(rootPath)) {
      console.warn(`[mcp] Scan root does not exist: ${rootPath}`);
      return [];
    }

    try {
      const entries = fs.readdirSync(rootPath, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const skillPath = path.join(rootPath, entry.name);
          const resolved = this.tryParseSkill(skillPath);
          if (resolved) {
            skills.push(resolved);
          }
        }
      }
    } catch (err) {
      console.error(`[mcp] Failed to scan root ${rootPath}: ${err instanceof Error ? err.message : String(err)}`);
    }

    return skills;
  }

  /**
   * Attempts to parse a directory as a skill
   */
  private tryParseSkill(skillDir: string): ResolvedSkill | null {
    const skillMdPath = path.join(skillDir, "SKILL.md");
    if (!fs.existsSync(skillMdPath)) {
      return null;
    }

    try {
      const content = fs.readFileSync(skillMdPath, "utf8");

      const nameMatch = content.match(/^name:\s*(.+)$/m);
      if (!nameMatch) {
        return null;
      }

      const descMatch = content.match(/^description:\s*(.+)$/m);
      const name = nameMatch[1].trim();
      const description = descMatch ? descMatch[1].trim() : "Auto-discovered skill";

      const input = this.inferInputSchema(skillDir, content);

      if (Object.keys(input).length > 0) {
        console.error(`[mcp] Auto-inferred input for '${name}': ${Object.keys(input).join(", ")}`);
      }

      return {
        name,
        description,
        skillDir,
        input,
        timeoutMs: this.config.defaults.timeoutMs,
        maxOutputBytes: this.config.defaults.maxOutputBytes,
        runner: this.config.defaults.runner,
        env: {}
      };
    } catch (err) {
      console.error(`[mcp] Error parsing skill at ${skillDir}: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
  }

  /**
   * Infers the input schema for a skill using layered strategies:
   * 1. SKILL.md YAML frontmatter `input:` block
   * 2. .superskills.json sidecar file (non-invasive override for 3rd-party skills)
   * 3. Static analysis of run scripts (shell/python/js)
   * 4. Fallback: single `input` string parameter so args are never silently lost
   */
  private inferInputSchema(skillDir: string, skillMdContent: string): Record<string, InputFieldSchema> {
    // Layer 1: SKILL.md frontmatter
    const fromFrontmatter = this.parseFromFrontmatter(skillMdContent);
    if (fromFrontmatter) return fromFrontmatter;

    // Layer 2: .superskills.json sidecar
    const fromSidecar = this.parseFromSidecar(skillDir);
    if (fromSidecar) return fromSidecar;

    // Layer 3: Static script analysis
    const fromScripts = this.inferFromScripts(skillDir);
    if (Object.keys(fromScripts).length > 0) return fromScripts;

    // Layer 4: Fallback — single generic `input` param
    // Better than {} which silently discards all arguments
    return {
      input: {
        type: "string",
        description: "Input for this skill (auto-inferred: no schema found)"
      }
    };
  }

  /**
   * Layer 1: Parse `input:` block from SKILL.md YAML frontmatter
   *
   * Supported format:
   * ---
   * name: my_skill
   * description: Does something
   * input:
   *   url:
   *     type: string
   *     format: uri
   *     description: The URL to process
   *   mode:
   *     type: string
   *     enum: [fast, deep]
   * ---
   */
  private parseFromFrontmatter(content: string): Record<string, InputFieldSchema> | null {
    const fmMatch = content.match(/^---\s*\n([\s\S]*?)\n---/);
    if (!fmMatch) return null;

    const frontmatter = fmMatch[1];
    const inputBlockMatch = frontmatter.match(/^input:\s*\n((?:[ \t]+.+\n?)*)/m);
    if (!inputBlockMatch) return null;

    const inputBlock = inputBlockMatch[1];
    const result: Record<string, InputFieldSchema> = {};

    // Parse each field (2-space indent for field name, 4-space for properties)
    const fieldRegex = /^[ \t]{2}(\w+):\s*$((?:\n[ \t]{4}.+)*)/gm;
    let fieldMatch: RegExpExecArray | null;

    while ((fieldMatch = fieldRegex.exec(inputBlock)) !== null) {
      const fieldName = fieldMatch[1];
      const fieldBody = fieldMatch[2] ?? "";

      const typeMatch = fieldBody.match(/type:\s*(\w+)/);
      const formatMatch = fieldBody.match(/format:\s*(\S+)/);
      const descMatch = fieldBody.match(/description:\s*(.+)/);
      const enumMatch = fieldBody.match(/enum:\s*\[([^\]]+)\]/);

      const schema: InputFieldSchema = {
        type: (typeMatch?.[1] as "string" | "number" | "boolean") ?? "string"
      };
      if (formatMatch) schema.format = formatMatch[1].trim();
      if (descMatch) schema.description = descMatch[1].trim();
      if (enumMatch) {
        schema.enum = enumMatch[1].split(",").map(s => s.trim().replace(/['"]/g, ""));
      }

      result[fieldName] = schema;
    }

    return Object.keys(result).length > 0 ? result : null;
  }

  /**
   * Layer 2: Parse from .superskills.json sidecar file.
   * Place this file in the skill directory to add input schema without
   * modifying the third-party SKILL.md.
   *
   * Format: { "input": { "url": { "type": "string", "description": "..." } } }
   */
  private parseFromSidecar(skillDir: string): Record<string, InputFieldSchema> | null {
    const sidecarPath = path.join(skillDir, ".superskills.json");
    if (!fs.existsSync(sidecarPath)) return null;

    try {
      const raw = JSON.parse(fs.readFileSync(sidecarPath, "utf8"));
      if (raw.input && typeof raw.input === "object" && Object.keys(raw.input).length > 0) {
        return raw.input as Record<string, InputFieldSchema>;
      }
    } catch {
      console.warn(`[mcp] Failed to parse .superskills.json in ${skillDir}`);
    }
    return null;
  }

  /**
   * Layer 3: Statically analyze run scripts to infer input parameters.
   * Supports shell, Python, and JS/TS patterns.
   */
  private inferFromScripts(skillDir: string): Record<string, InputFieldSchema> {
    const candidates = new Map<string, InputFieldSchema>();

    const scriptFiles = [
      "run.sh", "run.bash",
      "run.py", "main.py",
      "run.ts", "run.js", "index.ts", "index.js",
      "main.sh"
    ];

    for (const filename of scriptFiles) {
      const filePath = path.join(skillDir, filename);
      if (!fs.existsSync(filePath)) continue;

      const source = fs.readFileSync(filePath, "utf8");
      const ext = path.extname(filename);

      if (ext === ".sh" || ext === ".bash") {
        this.extractShellArgs(source, candidates);
      } else if (ext === ".py") {
        this.extractPythonArgs(source, candidates);
      } else if (ext === ".ts" || ext === ".js") {
        this.extractJsArgs(source, candidates);
      }
    }

    return Object.fromEntries(candidates);
  }

  /**
   * Extract env var references from shell scripts.
   * Matches: $URL, ${URL}, $QUERY_STRING
   * Ignores common shell builtins ($HOME, $PATH, $1, etc.)
   */
  private extractShellArgs(source: string, out: Map<string, InputFieldSchema>): void {
    const shellInternals = new Set([
      "HOME", "PATH", "PWD", "USER", "SHELL", "TMPDIR",
      "0", "1", "2", "3", "4", "5", "6", "7", "8", "9",
      "@", "*", "#", "?", "!", "-", "$", "_", "IFS", "OLDPWD"
    ]);

    const varPattern = /\$\{?([A-Z][A-Z0-9_]{1,})\}?/g;
    let m: RegExpExecArray | null;
    while ((m = varPattern.exec(source)) !== null) {
      const varName = m[1];
      if (shellInternals.has(varName)) continue;
      const key = varName.toLowerCase();
      if (!out.has(key)) {
        out.set(key, {
          type: this.guessType(key),
          description: `Inferred from shell $${varName}`
        });
      }
    }
  }

  /**
   * Extract arguments from Python scripts.
   * Matches: os.environ['URL'], os.environ.get('URL'), argparse --url
   */
  private extractPythonArgs(source: string, out: Map<string, InputFieldSchema>): void {
    const envPattern = /os\.environ(?:\.get)?\s*\(\s*['"]([A-Za-z][A-Za-z0-9_]*)['"]/g;
    let m: RegExpExecArray | null;
    while ((m = envPattern.exec(source)) !== null) {
      const key = m[1].toLowerCase();
      if (!out.has(key)) {
        out.set(key, {
          type: this.guessType(key),
          description: `Inferred from Python os.environ['${m[1]}']`
        });
      }
    }

    const argparsePattern = /add_argument\s*\(\s*['"]--([a-z][a-z0-9_-]*)['"]/g;
    while ((m = argparsePattern.exec(source)) !== null) {
      const key = m[1].replace(/-/g, "_");
      if (!out.has(key)) {
        out.set(key, {
          type: this.guessType(key),
          description: `Inferred from argparse --${m[1]}`
        });
      }
    }
  }

  /**
   * Extract arguments from JS/TS scripts.
   * Matches: process.env.URL, args.url, toolArgs.url, args['url']
   */
  private extractJsArgs(source: string, out: Map<string, InputFieldSchema>): void {
    const processEnvPattern = /process\.env\.([A-Z][A-Z0-9_]+)/g;
    let m: RegExpExecArray | null;
    while ((m = processEnvPattern.exec(source)) !== null) {
      const key = m[1].toLowerCase();
      if (!out.has(key)) {
        out.set(key, {
          type: this.guessType(key),
          description: `Inferred from process.env.${m[1]}`
        });
      }
    }

    // args.url, toolArgs['url'], input.query, params.mode, etc.
    const argsAccessPattern = /\b(?:args|toolArgs|input|params)\s*(?:\.\s*([a-z][a-zA-Z0-9_]*)|\[\s*['"]([a-z][a-zA-Z0-9_]*)['"]\s*\])/g;
    while ((m = argsAccessPattern.exec(source)) !== null) {
      const key = (m[1] ?? m[2]).toLowerCase();
      if (!out.has(key)) {
        out.set(key, {
          type: this.guessType(key),
          description: `Inferred from args.${key}`
        });
      }
    }
  }

  /**
   * Heuristically guess the type of a parameter based on its name.
   */
  private guessType(key: string): "string" | "number" | "boolean" {
    const numberKeys = /^(count|num|number|limit|page|size|max|min|port|timeout|retries|depth|width|height|index|offset)$/i;
    const boolKeys = /^(debug|verbose|force|dry.?run|enable|disable|strict|recursive|watch|follow)$/i;
    if (numberKeys.test(key)) return "number";
    if (boolKeys.test(key)) return "boolean";
    return "string";
  }
}
