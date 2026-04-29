import test from "node:test";
import assert from "node:assert/strict";
import { runSkill } from "./runner.js";
import type { ResolvedSkill } from "./types.js";

function makeCliSkill(script: string): ResolvedSkill {
  return {
    name: "baoyu-post-to-wechat",
    description: "test skill",
    skillDir: process.cwd(),
    input: {
      file: { type: "string" },
      theme: { type: "string" },
    },
    env: {},
    runner: { command: "node", args: ["-e", "process.stdout.write('unused')"] },
    cliRunner: {
      command: "node",
      args: ["-e", script, "{args.file}", "--theme", "{args.theme}"],
    },
    timeoutMs: 5_000,
    maxOutputBytes: 1024 * 1024,
  };
}

test("CLI runner logs spawn, stderr chunks, and exit status", async () => {
  const skill = makeCliSkill([
    "console.error('[wechat-api] phase-1');",
    "console.log('{\"ok\":true,\"text\":\"done\"}');",
  ].join(" "));

  const seen: string[] = [];
  const originalError = console.error;
  console.error = (...args: unknown[]) => {
    seen.push(args.map(String).join(" "));
  };

  try {
    const result = await runSkill(skill, { file: "/tmp/article.md", theme: "default" });
    assert.equal(result, "done");
  } finally {
    console.error = originalError;
  }

  assert.match(seen.join("\n"), /\[tool\] received args/);
  assert.match(seen.join("\n"), /\[tool\] spawning child/);
  assert.match(seen.join("\n"), /\[tool\] child spawned pid=/);
  assert.match(seen.join("\n"), /\[tool\] child stderr chunk: \[wechat-api\] phase-1/);
  assert.match(seen.join("\n"), /\[tool\] child exited code=0/);
});
