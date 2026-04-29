import fs from "node:fs";
import path from "node:path";
import { parse } from "yaml";
import { ResolvedSkill, MultiSkillConfig } from "./types.js";

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
      
      let name = "";
      let description = "Auto-discovered skill";
      let input = {};

      const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
      if (frontmatterMatch) {
        try {
          const doc = parse(frontmatterMatch[1]);
          if (doc.name) name = doc.name;
          if (doc.description) description = doc.description;
          if (doc.input) input = doc.input;
        } catch (err) {
          console.warn(`[mcp] Warning: Failed to parse YAML frontmatter in ${skillMdPath}`);
        }
      }

      // Fallback for name/description if not found in YAML
      if (!name) {
        const nameMatch = content.match(/^name:\s*(.+)$/m);
        if (nameMatch) name = nameMatch[1].trim();
      }

      if (!name) {
        return null; // A skill must have a name
      }

      if (description === "Auto-discovered skill" && !frontmatterMatch) {
        const descMatch = content.match(/^description:\s*(.+)$/m);
        if (descMatch) description = descMatch[1].trim();
      }

      return {
        name,
        description,
        skillDir,
        input,
        timeoutMs: this.config.defaults.timeoutMs,
        maxOutputBytes: this.config.defaults.maxOutputBytes,
        runner: this.config.defaults.runner,
        env: {} // Auto-discovered skills start with empty env
      };
    } catch (err) {
      console.error(`[mcp] Error parsing skill at ${skillDir}: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
  }
}
