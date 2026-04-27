import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

type McpInput = {
  tool: string;
  args: {
    url: string;
  };
  context: {
    skillDir: string;
    skillName: string;
  };
};

function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    process.stdin.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    process.stdin.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    process.stdin.on("error", reject);
  });
}

function runCommand(command: string, args: string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", reject);

    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(
        new Error(
          [
            `Command failed with exit code ${code}`,
            stdout ? `stdout:\n${stdout}` : "",
            stderr ? `stderr:\n${stderr}` : ""
          ]
            .filter(Boolean)
            .join("\n\n")
        )
      );
    });
  });
}

function envFlag(name: string, defaultValue: boolean): boolean {
  const value = process.env[name];
  if (value == null || value === "") return defaultValue;
  return ["1", "true", "yes", "y", "on"].includes(value.toLowerCase());
}

async function main() {
  const raw = await readStdin();
  const input = JSON.parse(raw) as McpInput;

  const url = input.args?.url;
  const skillDir = input.context?.skillDir;

  if (!skillDir) {
    throw new Error("context.skillDir is required but was not provided");
  }

  if (!url) {
    throw new Error("Missing args.url");
  }

  const keepOutput = envFlag("BAOYU_X_TO_MARKDOWN_KEEP_OUTPUT", false);
  const downloadMedia = envFlag("BAOYU_X_TO_MARKDOWN_DOWNLOAD_MEDIA", true);
  const configuredOutputDir = process.env.BAOYU_X_TO_MARKDOWN_OUTPUT_DIR;

  const outputDir = configuredOutputDir
    ? path.resolve(configuredOutputDir)
    : await mkdtemp(path.join(tmpdir(), "x-to-markdown-"));

  await mkdir(outputDir, { recursive: true });

  const outputPath = path.join(outputDir, "output.md");

  try {
    const args = ["scripts/main.ts", url, "-o", outputPath];

    if (downloadMedia) {
      args.push("--download-media");
    }

    await runCommand("bun", args, skillDir);

    const markdown = await readFile(outputPath, "utf8");

    process.stdout.write(
      JSON.stringify({
        ok: true,
        content: [
          {
            type: "text",
            text: markdown
          }
        ],
        metadata: {
          sourceUrl: url,
          outputPath,
          mediaDownloaded: downloadMedia,
          outputKept: keepOutput || Boolean(configuredOutputDir)
        }
      })
    );
  } finally {
    if (!keepOutput && !configuredOutputDir) {
      await rm(outputDir, {
        recursive: true,
        force: true
      });
    }
  }
}

main().catch((error) => {
  process.stdout.write(
    JSON.stringify({
      ok: false,
      error: {
        code: "X_TO_MARKDOWN_FAILED",
        message: error instanceof Error ? error.message : String(error)
      }
    })
  );

  process.exit(0);
});
