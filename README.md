# ⚡ superskills-mcp

<div align="center">
  <p><strong>A Universal, Agent-Agnostic MCP Gateway for Local Scripts & CLI Tools</strong></p>
</div>

`superskills-mcp` is a lightweight, globally installable Model Context Protocol (MCP) gateway. It allows you to effortlessly expose your local bash scripts, python tools, or Node.js skills to any AI assistant (ChatGPT, Claude Desktop, Cursor, etc.) via a unified interface.

Instead of writing a custom MCP server for every small script you create, `superskills-mcp` acts as a dynamic registry. You simply drop your skill's path into the configuration, and it is instantly available to the AI.

---

## ✨ Key Features

- 🌍 **Global Installation:** Run it from anywhere on your system via the `superskills-mcp` CLI.
- 🤖 **Agent Mode (New!):** Empower ChatGPT to "think" and "act" by exposing raw primitives (`run`, `read`, `write`) so it can follow a skill's `SKILL.md` step-by-step.
- 🔌 **Dynamic Tool Registration:** Add or remove skills dynamically without touching the server code.
- 🔄 **Hot Reloading:** Apply configuration changes on the fly with zero downtime using `superskills-mcp reload`.
- 📝 **Native Logging:** Built-in background daemon management and real-time log tailing.
- 🛡️ **Secure Execution:** Strict path validations, restricted runner boundaries, and input schema validation via Zod.
- 🌐 **Multi-Transport Support:** Expose tools over HTTP (for ChatGPT/Ngrok) or Stdio (for local Claude/Cursor).
- 📊 **Web Dashboard:** An integrated, premium dark-themed UI to monitor tool usage, toggle skills, and manage your local environment.
- 🕳️ **Integrated Ngrok:** Built-in tunneling support—expose your local tools to the internet with a single config line.
- 📓 **Built-in Notes:** Native markdown note-taking management tools (`list`, `read`, `write`) included out of the box.

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

Launch the MCP server and run it in the background after logging the public URL:

```bash
superskills-mcp serve -d
```

*(You can verify it is running by typing `superskills-mcp status` or by checking `curl http://127.0.0.1:8787/health`)*

---

## 🤖 Agent Mode (Infrastructure Tools)

Traditional MCP tools are "black boxes"—the AI calls a function and gets a result. However, many complex skills (like `baoyu-post-to-wechat`) are designed as **instruction-based agents**. 

`superskills-mcp` now provides **Agent Mode**, a set of infrastructure tools that give the AI the raw primitives needed to follow a skill's `SKILL.md` instructions manually.

### Available Agent Tools:

| Tool | Description |
|---|---|
| `superskills_list_skills` | List all registered skills, their directories, and descriptions. |
| `superskills_invoke` | Read a skill's `SKILL.md` (with resolved placeholders) to understand its instructions. |
| `superskills_run` | **Execute any shell command** (e.g., `bun`, `python`, `bash`) and return output. |
| `superskills_read_file` | Read the content of any local file. |
| `superskills_write_file` | Write or append content to a local file. |
| `superskills_list_dir` | List contents of any local directory. |
| `superskills_env` | Read credentials from `.baoyu-skills/.env` files. |

**How to use:**
Simply tell ChatGPT: *"Invoke the skill 'baoyu_post_to_wechat' and follow its instructions to publish this file."* ChatGPT will then read the manual, check your credentials, and run the necessary scripts step-by-step.

## 🔐 Agent Policy

When exposing Agent Mode over HTTP or ngrok, you should restrict what the model can read, write, and execute.

Add `agentPolicy` to your config:

```json
{
  "agentPolicy": {
    "enabledTools": {
      "superskills_invoke": true,
      "superskills_run": true,
      "superskills_read_file": true,
      "superskills_write_file": false,
      "superskills_list_dir": true,
      "superskills_env": false
    },
    "allowedPaths": [
      "{notesDir}",
      "~/Documents/superskills-workspace"
    ],
    "allowedCommands": ["bun", "node", "python3"],
    "blockedCommands": ["rm", "sudo", "ssh", "scp", "curl", "wget", "git"],
    "allowEnv": false,
    "allowSkillInvoke": true
  }
}
```

Skill-level `agentPolicy` entries inherit and append to the global policy. They can add paths and commands, but they should not weaken global safety rules.

### Recommended remote profile

For long-running ChatGPT-facing deployments:
- enable `superskills_invoke`, `superskills_read_file`, `superskills_list_dir`
- disable `superskills_write_file` unless needed
- disable `superskills_env` by default
- keep `allowedCommands` minimal
- use workspace-only or notes-only `allowedPaths`

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
| `superskills-mcp update` | Self-upgrade the `superskills-mcp` package to the latest version. |

---

## 📓 Built-in Tools (Notes)

`superskills-mcp` provides a set of native tools for managing markdown notes. This is perfect for letting AI assistants maintain a local knowledge base or journal for you.

To enable it, add the `notes` block to your config:

```json
{
  "notes": {
    "dir": "/Users/username/Documents/Notes"
  }
}
```

This will automatically expose:
- `notes_list`: List all markdown files in the directory.
- `notes_read`: Read the content of a specific note.
- `notes_write`: Create or update a note with given content.

---

## 🕳️ Integrated Ngrok Tunneling

No more running `ngrok` in a separate terminal. `superskills-mcp` can automatically establish a secure tunnel for you.

Simply add your Ngrok token to the `server` config:

```json
{
  "server": {
    "transport": "http",
    "port": 8787,
    "ngrokToken": "your_ngrok_auth_token",
    "ngrokDomain": "your-optional-custom-domain.ngrok-free.app"
  }
}
```

When you run `superskills-mcp serve`, it will log the public URL. Use `{url}/mcp` as the Action URL in ChatGPT.

---

## 📊 Web Dashboard

`superskills-mcp` 现在内置了一个精美的 Web 控制面板。你可以通过它实时监控技能的调用次数，并随时开启或禁用特定的技能。

1. 确保服务器正在运行 (`superskills-mcp serve -d`)。
2. 在浏览器中打开：`http://127.0.0.1:8787/dashboard/`

该面板完全集成在 Express 服务器中，无需安装任何额外依赖，即插即用。

---

## 📦 Managing Skills

### Adding Skills Automatically

You can use the CLI to dynamically attach a new local skill:

```bash
superskills-mcp add /path/to/your/custom_skill
```
*Note: This command extracts the skill name and description. `superskills-mcp` will attempt to automatically infer the input schema from the script source code or a `.superskills.json` sidecar file.*

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
    "version": "0.6.7",
    "transport": "http",
    "host": "127.0.0.1",
    "port": 8787,
    "ngrokToken": "",
    "ngrokDomain": ""
  },
  "notes": {
    "dir": "~/Documents/mcp-notes"
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

1. Recommended: Use the [Integrated Ngrok Tunneling](#-integrated-ngrok-tunneling) by running `superskills-mcp serve -d`.
2. Alternative: Expose the local port via a persistent [Ngrok](https://ngrok.com/) tunnel manually:

```bash
ngrok http --domain=your-free-static-domain.ngrok-free.app 8787
```

3. In your ChatGPT MCP Configuration, provide the proxy URL with the `/mcp` path:
`https://your-free-static-domain.ngrok-free.app/mcp`

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
