import fs from "node:fs";
import path from "node:path";
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
      
      // Extract name and description from YAML frontmatter or top of file
      const nameMatch = content.match(/^name:\s*(.+)$/m);
      if (!nameMatch) {
        return null;
      }

      const descMatch = content.match(/^description:\s*(.+)$/m);
      const name = nameMatch[1].trim();
      const description = descMatch ? descMatch[1].trim() : "Auto-discovered skill";

      return {
        name,
        description,
        skillDir,
        input: {},
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
