#!/usr/bin/env node
// src/index.ts
import { loadConfig } from "./config.js";
import { assertSafeSkills } from "./security.js";
import { startHttp, startStdio } from "./mcp.js";

async function main() {
  const { global: globalConfig, skills } = loadConfig();
  assertSafeSkills(skills);

  console.error(`[mcp] server=${globalConfig.server.name} v${globalConfig.server.version}`);
  console.error(`[mcp] transport=${globalConfig.server.transport}`);
  console.error(`[mcp] ${skills.length} skill(s) loaded:`);
  for (const s of skills) {
    console.error(`  - ${s.name} (skillDir=${s.skillDir})`);
  }

  if (globalConfig.server.transport === "http") {
    await startHttp(globalConfig, skills);
  } else {
    await startStdio(globalConfig, skills);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
});
