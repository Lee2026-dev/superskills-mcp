# ⚡ superskills-mcp

<div align="center">
  <p><strong>A Universal, Agent-Agnostic MCP Gateway for Local Scripts & CLI Tools</strong></p>
</div>

`superskills-mcp` is a lightweight, globally installable Model Context Protocol (MCP) gateway. It allows you to effortlessly expose your local bash scripts, python tools, or Node.js skills to any AI assistant (ChatGPT, Claude Desktop, Cursor, etc.) via a unified interface.

Instead of writing a custom MCP server for every small script you create, `superskills-mcp` acts as a dynamic registry. You simply drop your skill's path into the configuration, and it is instantly available to the AI.

---

## ✨ Key Features

- 🌍 **Global Installation:** Run it from anywhere on your system via the `superskills-mcp` CLI.
- 🔌 **Dynamic Tool Registration:** Add or remove skills dynamically without touching the server code.
- 🔄 **Hot Reloading:** Apply configuration changes on the fly with zero downtime using `superskills-mcp reload`.
- 📝 **Native Logging:** Built-in background daemon management and real-time log tailing.
- 🛡️ **Secure Execution:** Strict path validations, restricted runner boundaries, and input schema validation via Zod.
- 🌐 **Multi-Transport Support:** Expose tools over HTTP (for ChatGPT/Ngrok) or Stdio (for local Claude/Cursor).
- 📊 **Web Dashboard:** An integrated, premium dark-themed UI to monitor tool usage, toggle skills, and manage your local environment.

---

## 🚀 Quick Start

### 1. Installation

Install the CLI tool globally via npm or pnpm:

```bash
npm install -g superskills-mcp
```

### 2. Initialization

Generate your global configuration file (this will safely create `~/.superskills/mcp-config.json`):

```bash
superskills-mcp init
```

### 3. Start the Gateway

Launch the MCP server in the background:

```bash
superskills-mcp serve &
```

*(You can verify it is running by typing `superskills-mcp status` or by checking `curl http://127.0.0.1:8787/health`)*

---

## 🛠️ CLI Reference

`superskills-mcp` comes with a powerful suite of management commands akin to PM2 or Nginx:

| Command | Description |
|---|---|
| `superskills-mcp init` | Initialize the global config at `~/.superskills/mcp-config.json`. |
| `superskills-mcp serve` | Start the MCP server using the global config. |
| `superskills-mcp status` | Check if the server is actively running in the background. |
| `superskills-mcp stop` | Gracefully terminate the running server. |
| `superskills-mcp reload` | Smoothly restart the server to apply configuration changes instantly. |
| `superskills-mcp list` | Print a formatted list of all currently registered skills. |
| `superskills-mcp add <path>` | Auto-parse and add a new local skill directory to your global config. |
| `superskills-mcp remove <name>` | Unregister a skill from your global config by its name. |
| `superskills-mcp log` | Tail the real-time background logs (`[INFO]` and `[ERROR]`). |

---

## 📊 Web Dashboard

`superskills-mcp` 现在内置了一个精美的 Web 控制面板。你可以通过它实时监控技能的调用次数，并随时开启或禁用特定的技能。

1. 确保服务器正在运行 (`superskills-mcp serve &`)。
2. 在浏览器中打开：`http://127.0.0.1:8787/dashboard/`

该面板完全集成在 Express 服务器中，无需安装任何额外依赖，即插即用。

---

## 📦 Managing Skills

### Adding Skills Automatically

You can use the CLI to dynamically attach a new local skill:

```bash
superskills-mcp add /path/to/your/custom_skill
```
*Note: This command extracts the skill name and description, but sets the `input` schema to `{}`. If your skill requires specific arguments (like `url` or `query`), open `~/.superskills/mcp-config.json` and define the JSON schema under the `input` key.*

### Removing Skills

To detach a skill:

```bash
superskills-mcp remove my_custom_skill
```

### Applying Changes

After adding, removing, or manually editing your config, reload the gateway:

```bash
superskills-mcp reload
```

---

## 🔍 Auto-Discovery (Zero Configuration)

If you have a collection of skills in a folder, you can let `superskills-mcp` discover them automatically. 

Any sub-directory containing a `SKILL.md` file will be recognized as a tool.

1. Open `~/.superskills/mcp-config.json`.
2. Add `scanRoots` and `scanSettings`:

```json
{
  "scanRoots": [
    "~/.baoyu-skills/skills"
  ],
  "scanSettings": {
    "watch": true,
    "ignore": ["node_modules", ".git"]
  }
}
```

- **`scanRoots`**: An array of directories to scan for sub-folders containing `SKILL.md`.
- **`watch`**: If `true`, the server will monitor these directories in real-time. Adding or removing a folder will instantly update the available tools for your AI assistant—**no restart required**.


---

## ⚙️ Configuration File Structure

Your global configuration lives at `~/.superskills/mcp-config.json`.

```json
{
  "server": {
    "name": "superskills-mcp",
    "version": "0.5.0",
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
      "skillDir": "/Users/username/my-skills/twitter-scraper",
      "input": {
        "url": {
          "type": "string",
          "format": "uri",
          "description": "X/Twitter post URL to read"
        }
      },
      "env": {
        "KEEP_OUTPUT": "false"
      }
    }
  ]
}
```

- **`defaults.runner.args`**: The `{serverDir}` placeholder is automatically replaced with this gateway's actual installation path.
- **`skills[].input`**: Defines the exact JSON schema that the AI must fulfill when calling your tool.
- **`skills[].env`**: Environment variables scoped specifically to that single skill's execution.

---

## 🔗 Connecting AI Assistants

### 🌐 Connecting to ChatGPT (HTTP Transport)

For cloud-based AI like ChatGPT, the server must be exposed to the internet. 

1. Ensure the gateway is running (`superskills-mcp serve &`).
2. Expose the local port via a persistent [Ngrok](https://ngrok.com/) tunnel:

```bash
ngrok http --domain=your-free-static-domain.ngrok-free.app 8787
```

3. In your ChatGPT MCP Configuration, provide the proxy URL with the `/mcp` path:
`https://your-free-static-domain.ngrok-free.app/mcp`

*Tip: You can test if the proxy is bypassing Ngrok's browser warnings by running:*
`curl -H "ngrok-skip-browser-warning: true" https://your-free-static-domain.ngrok-free.app/health`

### 🖥️ Connecting to Claude Desktop / Cursor (Stdio Transport)

Local clients prefer communicating via standard input/output (`stdio`). You do not need to run `serve &` manually for these clients; they will spawn the gateway themselves.

Add this block to your local client config (e.g., `~/Library/Application Support/Claude/claude_desktop_config.json`):

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

## 🔒 Security Principles

- **Isolated Execution**: Skills are executed using restricted runners without shell interpolation (`shell: false`), eliminating command injection risks.
- **Directory Verification**: The gateway strictly validates that runner scripts exist within the trusted `serverDir` or the specific `skillDir`.
- **Resource Limits**: Configurable `timeoutMs` and `maxOutputBytes` prevent runaway scripts from crashing your system.
