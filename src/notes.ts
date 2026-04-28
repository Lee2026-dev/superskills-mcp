// src/notes.ts
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { NotesConfig } from "./types.js";

/** 展开 ~ 并解析为绝对路径 */
function resolveDir(dir: string): string {
  if (dir.startsWith("~/")) {
    return path.join(os.homedir(), dir.slice(2));
  }
  return path.resolve(dir);
}

/** 递归收集目录下所有 .md 文件，返回相对路径 */
function collectMarkdownFiles(dir: string, base: string): string[] {
  const results: string[] = [];
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        results.push(...collectMarkdownFiles(fullPath, base));
      } else if (entry.isFile() && entry.name.endsWith(".md")) {
        results.push(path.relative(base, fullPath));
      }
    }
  } catch { /* skip unreadable dirs */ }
  return results;
}

/**
 * 将本地笔记读写工具注册到 MCP 服务器上。
 * 只有在 config.notes 配置存在时才注册。
 */
export function registerNotesTools(server: McpServer, config: NotesConfig): void {
  const notesDir = resolveDir(config.dir);

  // ------------------------------------------------------------------ notes_list
  server.tool(
    "notes_list",
    `List all Markdown (.md) files in the notes directory: \`${config.dir}\`. Returns a tree of relative paths.`,
    {},
    async () => {
      if (!fs.existsSync(notesDir)) {
        return {
          isError: true,
          content: [{ type: "text" as const, text: `Notes directory not found: ${notesDir}` }]
        };
      }
      const files = collectMarkdownFiles(notesDir, notesDir);
      if (files.length === 0) {
        return { content: [{ type: "text" as const, text: `No Markdown files found in \`${config.dir}\`.` }] };
      }
      const list = files.map(f => `- ${f}`).join("\n");
      return {
        content: [{
          type: "text" as const,
          text: `**Notes directory:** \`${config.dir}\`\n\n${list}\n\n_${files.length} file(s) total_`
        }]
      };
    }
  );

  // ------------------------------------------------------------------ notes_read
  server.tool(
    "notes_read",
    `Read the full content of a Markdown note by its relative path inside \`${config.dir}\`. Use notes_list first to discover available files.`,
    {
      path: z.string().describe("Relative path to the note file, e.g. `journal/2025-04.md`")
    },
    async ({ path: notePath }) => {
      const absPath = path.join(notesDir, notePath);
      // Path traversal protection
      if (!absPath.startsWith(notesDir + path.sep) && absPath !== notesDir) {
        return {
          isError: true,
          content: [{ type: "text" as const, text: "Security error: path traversal detected." }]
        };
      }
      if (!fs.existsSync(absPath)) {
        return {
          isError: true,
          content: [{ type: "text" as const, text: `File not found: \`${notePath}\`` }]
        };
      }
      const text = fs.readFileSync(absPath, "utf8");
      return {
        content: [{
          type: "text" as const,
          text: `**File:** \`${notePath}\`\n\n---\n\n${text}`
        }]
      };
    }
  );

  // ------------------------------------------------------------------ notes_write
  server.tool(
    "notes_write",
    `Write or overwrite a Markdown note at the given relative path inside \`${config.dir}\`. Creates parent directories automatically. Use this to save organized content back to a note.`,
    {
      path: z.string().describe("Relative path to write to, e.g. `journal/2025-04.md`"),
      content: z.string().describe("Full Markdown content to write to the file")
    },
    async ({ path: notePath, content }) => {
      const absPath = path.join(notesDir, notePath);
      // Path traversal protection
      if (!absPath.startsWith(notesDir + path.sep) && absPath !== notesDir) {
        return {
          isError: true,
          content: [{ type: "text" as const, text: "Security error: path traversal detected." }]
        };
      }
      fs.mkdirSync(path.dirname(absPath), { recursive: true });
      fs.writeFileSync(absPath, content, "utf8");
      return {
        content: [{
          type: "text" as const,
          text: `✅ Saved \`${notePath}\` (${content.length} chars)`
        }]
      };
    }
  );

  console.error(`[mcp] Notes tools registered for directory: ${notesDir}`);
}
