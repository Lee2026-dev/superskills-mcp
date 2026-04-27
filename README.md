# baoyu-local-skills-mcp-server

A general-purpose MCP server that exposes your local baoyu skills as MCP tools. Any MCP client (ChatGPT, Claude Desktop, Cursor, etc.) can connect to it and call all registered skills.

```text
read_x_to_markdown({ url })   ← registered automatically from config
my_next_skill({ ... })        ← just add to skills array, zero code change
```

---

## How It Works

```
MCP Client (ChatGPT / Claude / Cursor)
    │  HTTP or stdio
    ▼
baoyu-local-skills-mcp-server  (this project)
    │  reads config/skills.example.json
    │  resolves {serverDir} → absolute path to this project
    ▼
scripts/mcp-adapter.ts         (built-in adapter, never copied)
    │  receives skillDir via context
    ▼
bun scripts/main.ts            (your actual skill)
```

The adapter (`scripts/mcp-adapter.ts`) is **always part of this server** — you never copy it anywhere. `skillDir` is injected at runtime via the `context` field.

---

## 1. Project Structure

```
baoyu-local-skills-mcp-server/
  config/
    skills.example.json       ← your skill registry
  src/
    index.ts                  ← entry point
    config.ts                 ← loads + resolves config
    security.ts               ← validates skill paths
    runner.ts                 ← spawns adapter per tool call
    mcp.ts                    ← registers MCP tools dynamically
    types.ts                  ← shared TypeScript types
  scripts/
    mcp-adapter.ts            ← built-in adapter (do NOT copy elsewhere)
```

---

## 2. Install

```bash
pnpm install
pnpm build
```

---

## 3. Register Your Skills

Edit `config/skills.example.json`. To add a new skill, append to the `skills` array — **no code changes needed**.

```json
{
  "server": {
    "name": "baoyu-local-skills-mcp",
    "version": "0.3.0",
    "transport": "http",
    "host": "127.0.0.1",
    "port": 8787
  },
  "defaults": {
    "timeoutMs": 120000,
    "maxOutputBytes": 10485760,
    "runner": {
      "command": "bun",
      "args": ["{serverDir}/scripts/mcp-adapter.ts"]
    }
  },
  "skills": [
    {
      "name": "read_x_to_markdown",
      "description": "Read a given X/Twitter link and return clean Markdown.",
      "skillDir": "/Users/wenli/.baoyu-skills/skills/baoyu-danger-x-to-markdown",
      "input": {
        "url": {
          "type": "string",
          "format": "uri",
          "description": "X/Twitter post URL to read"
        }
      },
      "env": {
        "BAOYU_X_TO_MARKDOWN_DOWNLOAD_MEDIA": "true",
        "BAOYU_X_TO_MARKDOWN_KEEP_OUTPUT": "false"
      }
    }
  ]
}
```

### Config fields explained

| Field | Description |
|---|---|
| `server.name` | Server name shown to MCP clients |
| `server.transport` | `"http"` (for ChatGPT / remote) or `"stdio"` (for local clients) |
| `defaults.runner.args` | `{serverDir}` is auto-replaced with this project's absolute path |
| `skills[].skillDir` | Absolute path to your local skill directory |
| `skills[].input` | Input schema — each field becomes a validated MCP tool parameter |
| `skills[].env` | Environment variables forwarded to the adapter |

### Adding a new skill

1. Add a new entry to `skills[]` in the config file
2. Restart the server
3. The new tool is automatically available to all connected MCP clients

---

## 4. Run with HTTP transport

For ChatGPT or any remote MCP client:

```bash
node dist/index.js \
  --config config/skills.example.json \
  --transport http \
  --port 8787
```

Verify it's running:

```bash
curl http://127.0.0.1:8787/health
# → {"ok":true,"name":"baoyu-local-skills-mcp","version":"0.3.0","tools":["read_x_to_markdown"]}
```

### Expose to ChatGPT via Cloudflare Tunnel

```bash
cloudflared tunnel --url http://127.0.0.1:8787
```

Copy the generated `https://<domain>/mcp` URL and paste it into ChatGPT's MCP connector settings.

---

## 5. Run with stdio transport

For Claude Desktop / Cursor / local MCP clients:

```bash
node dist/index.js \
  --config config/skills.example.json \
  --transport stdio
```

Example Claude Desktop config (`~/Library/Application Support/Claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "baoyu-local-skills": {
      "command": "node",
      "args": [
        "/Users/wenli/Downloads/baoyu-x-to-markdown-mcp-server/dist/index.js",
        "--config",
        "/Users/wenli/Downloads/baoyu-x-to-markdown-mcp-server/config/skills.example.json",
        "--transport",
        "stdio"
      ]
    }
  }
}
```

---

## 6. Adapter environment variables

These are set per-skill in the `env` block of `skills.example.json`.

### `BAOYU_X_TO_MARKDOWN_DOWNLOAD_MEDIA`

Default: `true`

When true, the adapter passes `--download-media` to the skill script.

### `BAOYU_X_TO_MARKDOWN_KEEP_OUTPUT`

Default: `false`

When false, the temp output directory is deleted after reading Markdown.

### `BAOYU_X_TO_MARKDOWN_OUTPUT_DIR`

Optional fixed output directory. If set, the adapter never deletes the output.

```json
"env": {
  "BAOYU_X_TO_MARKDOWN_OUTPUT_DIR": "/Users/wenli/Downloads/x-to-markdown-output",
  "BAOYU_X_TO_MARKDOWN_DOWNLOAD_MEDIA": "true"
}
```

---

## 7. Adapter stdin/stdout protocol

The MCP server sends this JSON to the adapter via stdin:

```json
{
  "tool": "read_x_to_markdown",
  "args": { "url": "https://x.com/i/article/demo" },
  "context": {
    "skillDir": "/Users/wenli/.baoyu-skills/skills/baoyu-danger-x-to-markdown",
    "skillName": "baoyu-danger-x-to-markdown"
  }
}
```

The adapter returns:

```json
{
  "ok": true,
  "content": [{ "type": "text", "text": "# Article Title\n\nContent..." }],
  "metadata": {
    "sourceUrl": "https://x.com/i/article/demo",
    "outputPath": "/tmp/x-to-markdown-xxx/output.md"
  }
}
```

---

## 8. Security

- `skillDir` must exist and be a directory (validated on startup)
- Runner scripts must be inside `serverDir` (built-in adapter) or `skillDir` (skill's own scripts)
- `shell: false` — no shell injection
- Timeout and output size limits enforced per skill
- Do not expose HTTP transport publicly without a reverse proxy or auth layer
