import test from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "./mcp.js";
import type { MultiSkillConfig, ResolvedSkill } from "./types.js";

const config: MultiSkillConfig = {
  server: {
    name: "test-server",
    version: "1.0.0",
    transport: "stdio",
    host: "127.0.0.1",
    port: 0,
  },
  defaults: {
    timeoutMs: 5_000,
    maxOutputBytes: 1024 * 1024,
    runner: {
      command: "node",
      args: ["-e", "process.stdout.write('unused')"],
    },
  },
  skills: [],
};

test("CLI runner optional args are not required by MCP validation", async () => {
  const skill: ResolvedSkill = {
    name: "post-to-wechat",
    description: "test skill",
    skillDir: process.cwd(),
    input: {
      file: { type: "string" },
      theme: { type: "string" },
      title: { type: "string" },
      summary: { type: "string" },
      author: { type: "string" },
      cover: { type: "string" },
      no_cite: { type: "string" },
    },
    env: {},
    runner: config.defaults.runner,
    cliRunner: {
      command: "node",
      args: ["-e", "process.stdout.write('ok')", "{args.file}", "--theme", "{args.theme}"],
      optionalArgs: [
        ["--title", "{args.title}"],
        ["--summary", "{args.summary}"],
        ["--author", "{args.author}"],
        ["--cover", "{args.cover}"],
        ["--no-cite", "{args.no_cite}"],
      ],
    },
    timeoutMs: 5_000,
    maxOutputBytes: 1024 * 1024,
  };

  const server = createMcpServer(config, [skill]);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "1.0.0" });

  await server.connect(serverTransport);
  await client.connect(clientTransport);

  const result = await client.callTool({
    name: "post-to-wechat",
    arguments: {
      file: "/tmp/article.md",
      theme: "default",
    },
  });

  assert.notEqual(result.isError, true);
  assert.deepEqual(result.content, [{ type: "text", text: "ok" }]);

  await client.close();
  await server.close();
});
