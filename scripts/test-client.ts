import { loadConfig } from "../src/config.js";
import { runSkill } from "../src/runner.js";

async function main() {
  const url = process.argv[2];
  if (!url) {
    console.error("Usage: pnpm tsx scripts/test-client.ts <url>");
    process.exit(1);
  }

  // 加载配置
  const { skills } = loadConfig();
  const targetSkill = skills.find((s) => s.name === "read_x_to_markdown");

  if (!targetSkill) {
    console.error("Error: read_x_to_markdown skill not found in config.");
    process.exit(1);
  }

  console.log(`[test] Found skill: ${targetSkill.name}`);
  console.log(`[test] Testing URL: ${url}\n`);
  console.log("----------------------------------------\n");

  try {
    const result = await runSkill(targetSkill, { url });
    console.log(result);
  } catch (err) {
    console.error("\n[test] execution failed:", err);
  }
}

main();
