# superskills-mcp

A general-purpose MCP gateway that exposes your local CLI skills to any AI assistant. Any MCP client (ChatGPT, Claude Desktop, Cursor, etc.) can connect to it and invoke your local scripts as intelligent tools.

```text
read_x_to_markdown({ url })   ← registered automatically from config
my_custom_skill({ ... })      ← just add to skills array, zero code change
```

---

## 1. Quick Start (Global Installation)

Install the CLI tool globally on your system:

```bash
npm install -g .
# Or via pnpm: pnpm link --global
```

Initialize your configuration file (creates `~/.superskills/mcp-config.json`):

```bash
superskills-mcp init
```

Start the server:

```bash
superskills-mcp serve
# To run in the background: superskills-mcp serve &
```

List registered skills:

```bash
superskills-mcp list
```

Stop the server:

```bash
superskills-mcp stop
```

---

## 2. Register Your Skills

Open `~/.superskills/mcp-config.json`. To add a new skill, append a JSON block to the `skills` array — **no code changes needed**.

```json
{
  "server": {
    "name": "superskills-mcp",
    "version": "0.4.0",
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
| `defaults.runner.args` | `{serverDir}` is auto-replaced with this project's absolute installation path |
| `skills[].skillDir` | Absolute path to your local skill directory |
| `skills[].input` | Input schema — each field becomes a validated MCP tool parameter |
| `skills[].env` | Environment variables forwarded to the adapter |

### Adding a new skill

1. Add a new entry to `skills[]` in `~/.superskills/mcp-config.json`
2. Restart the server (`superskills-mcp serve`)
3. The new tool is automatically available to all connected MCP clients

---

## 3. Connect to ChatGPT (HTTP Transport)

For ChatGPT or any remote MCP client, the server must be running in HTTP mode (which is the default).

```bash
superskills-mcp serve
```

Verify it's running:

```bash
curl http://127.0.0.1:8787/health
# → {"ok":true,"name":"superskills-mcp","version":"0.4.0","tools":["read_x_to_markdown"]}
```

### Expose to ChatGPT via Ngrok

Ngrok provides a free static domain which is ideal for persistent MCP server connections. You can get your free static domain from your Ngrok dashboard.

```bash
ngrok http --domain=your-free-static-domain.ngrok-free.app 8787
```

Copy the URL `https://your-free-static-domain.ngrok-free.app/mcp` and paste it into ChatGPT's MCP connector settings.

---

## 4. Connect to Claude Desktop / Cursor (Stdio Transport)

For local MCP clients like Claude Desktop or Cursor, they will spawn the process using stdio.

Example Claude Desktop config (`~/Library/Application Support/Claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "superskills-mcp": {
      "command": "superskills-mcp",
      "args": ["serve", "--transport", "stdio"]
    }
  }
}
```

---

## 5. Security

- `skillDir` must exist and be a directory (validated on startup)
- Runner scripts must be inside `serverDir` (built-in adapter) or `skillDir` (skill's own scripts)
- `shell: false` — no shell injection
- Timeout and output size limits enforced per skill
- Do not expose HTTP transport publicly without a reverse proxy or auth layer
