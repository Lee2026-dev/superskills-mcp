// src/mcp.ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express from "express";
import { z, ZodRawShape } from "zod";
import { MultiSkillConfig, ResolvedSkill, DashboardRegistry } from "./types.js";
import { runSkill } from "./runner.js";
import { createDashboardRouter } from "./dashboard.js";


/** 将 InputFieldSchema 定义转换为 Zod schema shape */
function buildZodShape(input: ResolvedSkill["input"]): ZodRawShape {
  const shape: ZodRawShape = {};
  for (const [key, field] of Object.entries(input)) {
    let schema: z.ZodTypeAny;
    switch (field.type) {
      case "number":
        schema = z.number();
        break;
      case "boolean":
        schema = z.boolean();
        break;
      default: {
        // string (default)
        if (field.enum && field.enum.length > 0) {
          schema = z.enum(field.enum as [string, ...string[]]);
        } else {
          let s = z.string();
          if (field.format === "uri") s = s.url();
          schema = s;
        }
      }
    }
    if (field.description) schema = schema.describe(field.description);
    shape[key] = schema;
  }
  return shape;
}

export function createMcpServer(
  globalConfig: MultiSkillConfig,
  skills: ResolvedSkill[],
  registry?: DashboardRegistry
): McpServer {
  const server = new McpServer({
    name: globalConfig.server.name,
    version: globalConfig.server.version
  });

  const enabledSkills = registry ? skills.filter(s => registry.get(s.name)?.enabled !== false) : skills;

  for (const skill of enabledSkills) {
    const shape = buildZodShape(skill.input);
    server.tool(skill.name, skill.description, shape, async (toolArgs) => {
      if (registry) {
        const meta = registry.get(skill.name);
        if (meta) {
          meta.callCount++;
          registry.set(skill.name, meta);
        }
      }
      try {
        const markdown = await runSkill(skill, toolArgs as Record<string, unknown>);
        return {
          content: [{ type: "text", text: markdown }]
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          isError: true,
          content: [{ type: "text", text: `[${skill.name}] failed: ${message}` }]
        };
      }
    });
  }

  return server;
}

export async function startStdio(
  globalConfig: MultiSkillConfig,
  skillsOrGetter: ResolvedSkill[] | (() => ResolvedSkill[])
): Promise<void> {
  const skills = typeof skillsOrGetter === "function" ? skillsOrGetter() : skillsOrGetter;
  const server = createMcpServer(globalConfig, skills);
  await server.connect(new StdioServerTransport());
}

export async function startHttp(
  globalConfig: MultiSkillConfig,
  skillsOrGetter: ResolvedSkill[] | (() => ResolvedSkill[]),
  registry?: DashboardRegistry
): Promise<void> {
  const cfg = globalConfig.server;
  const app = express();
  app.use(express.json({ limit: "4mb" }));

  if (registry) {
    app.use("/dashboard", createDashboardRouter(
      typeof skillsOrGetter === "function" ? skillsOrGetter : () => skillsOrGetter,
      registry
    ));
  }

  app.post("/mcp", async (req, res) => {
    const skills = typeof skillsOrGetter === "function" ? skillsOrGetter() : skillsOrGetter;
    const server = createMcpServer(globalConfig, skills, registry);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined
    });

    res.on("close", () => {
      transport.close();
      server.close();
    });

    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });

  app.get("/health", (_req, res) => {
    const skills = typeof skillsOrGetter === "function" ? skillsOrGetter() : skillsOrGetter;
    res.json({
      ok: true,
      name: cfg.name,
      version: cfg.version,
      tools: skills.map((s) => s.name)
    });
  });

  app.listen(cfg.port, cfg.host, () => {
    const skills = typeof skillsOrGetter === "function" ? skillsOrGetter() : skillsOrGetter;
    console.error(`[mcp] HTTP server listening on http://${cfg.host}:${cfg.port}/mcp`);
    console.error(
      `[mcp] Registered ${skills.length} tool(s): ${skills.map((s) => s.name).join(", ")}`
    );
  });
}
