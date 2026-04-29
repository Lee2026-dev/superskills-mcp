# Agent Policy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a configurable Agent Policy layer that restricts Agent Mode file access, command execution, and sensitive tool availability for safer long-running remote deployments.

**Architecture:** Introduce a focused `src/policy.ts` module that computes effective agent policy from global config plus skill-level appended overrides, then enforce it inside `src/agent.ts` before any primitive executes. Keep config loading simple by extending `src/types.ts` and `src/config.ts`, then document the feature in `README.md` with safe remote examples.

**Tech Stack:** TypeScript, Node.js, Express, MCP SDK, Zod

---

## File structure

### Create
- `src/policy.ts` — policy types, merge helpers, placeholder resolution, path checks, command checks, denial helpers
- `docs/superpowers/plans/2026-04-29-agent-policy.md` — this implementation plan

### Modify
- `src/types.ts` — add `AgentPolicy`, `ToolPolicyMap`, and config/skill fields
- `src/config.ts` — normalize new config fields and carry skill-level policy into resolved skills
- `src/agent.ts` — enforce policy in all `superskills_*` primitives and add optional `skill_name` where needed
- `README.md` — add Agent Policy config docs and remote safety examples

### Verify
- `npm run build`
- manual smoke tests via local stdio or HTTP setup after build

> Note: this repo currently has no dedicated automated test directory. This plan uses build verification plus a manual smoke-test script path. If a test harness is added later, mirror the policy checks there.

### Task 1: Add policy types to the config model

**Files:**
- Modify: `src/types.ts`
- Verify: `npm run build`

- [ ] **Step 1: Add the new config types in `src/types.ts`**

Add these interfaces near the existing config/type definitions:

```ts
export interface ToolPolicyMap {
  superskills_invoke?: boolean;
  superskills_run?: boolean;
  superskills_read_file?: boolean;
  superskills_write_file?: boolean;
  superskills_list_dir?: boolean;
  superskills_env?: boolean;
}

export interface AgentPolicy {
  enabledTools?: ToolPolicyMap;
  allowedPaths?: string[];
  allowedCommands?: string[];
  blockedCommands?: string[];
  allowEnv?: boolean;
  allowSkillInvoke?: boolean;
}
```

Then extend existing types:

```ts
export interface SkillDef {
  // existing fields...
  agentPolicy?: AgentPolicy;
}

export interface MultiSkillConfig {
  // existing fields...
  agentPolicy?: AgentPolicy;
}

export interface ResolvedSkill {
  // existing fields...
  agentPolicy?: AgentPolicy;
}
```

- [ ] **Step 2: Run build to catch type issues early**

Run:

```bash
npm run build
```

Expected: TypeScript completes successfully.

- [ ] **Step 3: Commit the type model change**

```bash
git add src/types.ts
git commit -m "feat: add agent policy config types"
```

### Task 2: Carry policy data through config loading

**Files:**
- Modify: `src/config.ts`
- Verify: `npm run build`

- [ ] **Step 1: Preserve global `agentPolicy` and attach skill-level policy in `loadConfig()`**

In the `skills` mapping inside `src/config.ts`, include the new field:

```ts
const skills: ResolvedSkill[] = (raw.skills ?? []).map((s, i) => {
  if (!s.name) throw new Error(`skills[${i}] is missing 'name'`);
  if (!s.skillDir) throw new Error(`skills[${i}] ('${s.name}') is missing 'skillDir'`);

  return {
    name: s.name,
    description: s.description ?? "",
    skillDir: path.resolve(s.skillDir),
    input: s.input ?? {},
    env: s.env ?? {},
    runner: s.runner ? resolveRunner(s.runner) : defaults.runner,
    timeoutMs: s.timeoutMs ?? defaults.timeoutMs,
    maxOutputBytes: s.maxOutputBytes ?? defaults.maxOutputBytes,
    agentPolicy: s.agentPolicy
  };
});
```

Also keep `raw.agentPolicy` intact; no behavior change is needed beyond typed support unless you choose to normalize path-like values later in `src/policy.ts`.

- [ ] **Step 2: Build again**

Run:

```bash
npm run build
```

Expected: Build passes with the new field wired through.

- [ ] **Step 3: Commit config plumbing**

```bash
git add src/config.ts
git commit -m "feat: plumb agent policy through config loading"
```

### Task 3: Implement the shared policy engine

**Files:**
- Create: `src/policy.ts`
- Modify: `src/types.ts` (only if minor type export adjustments are needed)
- Verify: `npm run build`

- [ ] **Step 1: Create `src/policy.ts` with policy merge and enforcement helpers**

Create the file with this initial implementation:

```ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { AgentPolicy, MultiSkillConfig, ResolvedSkill } from "./types.js";

export type AgentToolName =
  | "superskills_invoke"
  | "superskills_run"
  | "superskills_read_file"
  | "superskills_write_file"
  | "superskills_list_dir"
  | "superskills_env";

export interface PolicyContext {
  globalConfig: MultiSkillConfig;
  skill?: ResolvedSkill;
}

export interface PolicyDecision {
  ok: boolean;
  reason?: string;
}

export function normalizeFsPath(input: string): string {
  const expanded = input.startsWith("~/")
    ? path.join(os.homedir(), input.slice(2))
    : input;
  return path.resolve(expanded).normalize("NFC");
}

export function resolvePolicyPathTemplate(template: string, ctx: PolicyContext): string | null {
  const replacements: Record<string, string | undefined> = {
    "{cwd}": process.cwd(),
    "{skillDir}": ctx.skill?.skillDir,
    "{notesDir}": ctx.globalConfig.notes?.dir
  };

  let resolved = template;
  for (const [token, value] of Object.entries(replacements)) {
    if (resolved.includes(token)) {
      if (!value) return null;
      resolved = resolved.replaceAll(token, value);
    }
  }

  return normalizeFsPath(resolved);
}

export function getEffectiveAgentPolicy(ctx: PolicyContext): Required<AgentPolicy> {
  const globalPolicy = ctx.globalConfig.agentPolicy ?? {};
  const skillPolicy = ctx.skill?.agentPolicy ?? {};

  const enabledTools = {
    ...(globalPolicy.enabledTools ?? {}),
    ...(skillPolicy.enabledTools ?? {})
  };

  for (const [tool, globalEnabled] of Object.entries(globalPolicy.enabledTools ?? {})) {
    if (globalEnabled === false) enabledTools[tool as keyof typeof enabledTools] = false;
  }

  const allowEnv = globalPolicy.allowEnv === false
    ? false
    : (skillPolicy.allowEnv ?? globalPolicy.allowEnv ?? true);

  const allowSkillInvoke = globalPolicy.allowSkillInvoke === false
    ? false
    : (skillPolicy.allowSkillInvoke ?? globalPolicy.allowSkillInvoke ?? true);

  return {
    enabledTools,
    allowedPaths: [...(globalPolicy.allowedPaths ?? []), ...(skillPolicy.allowedPaths ?? [])],
    allowedCommands: [...(globalPolicy.allowedCommands ?? []), ...(skillPolicy.allowedCommands ?? [])],
    blockedCommands: [...(globalPolicy.blockedCommands ?? [])],
    allowEnv,
    allowSkillInvoke
  };
}

export function canUseTool(tool: AgentToolName, ctx: PolicyContext): PolicyDecision {
  const policy = getEffectiveAgentPolicy(ctx);
  if (policy.enabledTools[tool] === false) {
    return { ok: false, reason: `tool disabled by agent policy: ${tool}` };
  }
  if (tool === "superskills_env" && policy.allowEnv === false) {
    return { ok: false, reason: "env access disabled by agent policy" };
  }
  if (tool === "superskills_invoke" && policy.allowSkillInvoke === false) {
    return { ok: false, reason: "skill invocation disabled by agent policy" };
  }
  return { ok: true };
}

export function canAccessPath(tool: AgentToolName, inputPath: string, ctx: PolicyContext): PolicyDecision {
  const toolDecision = canUseTool(tool, ctx);
  if (!toolDecision.ok) return toolDecision;

  const policy = getEffectiveAgentPolicy(ctx);
  const target = normalizeFsPath(inputPath);
  const allowedRoots = policy.allowedPaths
    .map(p => resolvePolicyPathTemplate(p, ctx))
    .filter((p): p is string => Boolean(p));

  if (allowedRoots.length === 0) {
    return { ok: false, reason: "no allowedPaths configured for agent policy" };
  }

  const permitted = allowedRoots.some(root => target === root || target.startsWith(`${root}${path.sep}`));
  if (!permitted) {
    return { ok: false, reason: `path not allowed by agent policy: ${target}` };
  }

  return { ok: true };
}

export function canRunCommand(command: string, ctx: PolicyContext): PolicyDecision {
  const toolDecision = canUseTool("superskills_run", ctx);
  if (!toolDecision.ok) return toolDecision;

  const policy = getEffectiveAgentPolicy(ctx);
  if (policy.blockedCommands.includes(command)) {
    return { ok: false, reason: `command explicitly blocked by agent policy: ${command}` };
  }
  if (!policy.allowedCommands.includes(command)) {
    return { ok: false, reason: `command not in allowedCommands: ${command}` };
  }
  return { ok: true };
}

export function policyErrorText(reason: string): string {
  return `[agent-policy] ${reason}`;
}
```

- [ ] **Step 2: Build and fix typing issues**

Run:

```bash
npm run build
```

Expected: Build may fail once or twice for `Required<AgentPolicy>` and tool-key typing. Fix by tightening return types if needed, for example replacing `Required<AgentPolicy>` with a dedicated resolved interface in `src/policy.ts`.

- [ ] **Step 3: Commit the policy module**

```bash
git add src/policy.ts src/types.ts
git commit -m "feat: add shared agent policy engine"
```

### Task 4: Enforce policy in `src/agent.ts`

**Files:**
- Modify: `src/agent.ts`
- Verify: `npm run build`

- [ ] **Step 1: Import policy helpers at the top of `src/agent.ts`**

Add:

```ts
import {
  canAccessPath,
  canRunCommand,
  canUseTool,
  policyErrorText
} from "./policy.js";
```

- [ ] **Step 2: Add a helper to resolve optional `skill_name` into a skill context**

Place this near the helper section:

```ts
function findSkillByName(skills: ResolvedSkill[], skillName?: string): ResolvedSkill | undefined {
  if (!skillName) return undefined;
  return skills.find(s => s.name === skillName);
}
```

- [ ] **Step 3: Extend `superskills_run` schema with `skill_name` and enforce command policy**

Update the tool schema:

```ts
skill_name: z.string().optional().describe("Optional skill context used to apply skill-specific agent policy")
```

Then add the policy check before `execCommand(...)`:

```ts
const skills = getSkills();
const skill = findSkillByName(skills, skill_name);
const ctx = { globalConfig: config, skill };
const commandDecision = canRunCommand(command, ctx);
if (!commandDecision.ok) {
  return {
    isError: true,
    content: [{ type: "text" as const, text: policyErrorText(commandDecision.reason!) }]
  };
}
```

- [ ] **Step 4: Extend file tools with `skill_name` and enforce path policy**

For each of these tools:
- `superskills_read_file`
- `superskills_write_file`
- `superskills_list_dir`

Add the same optional schema field:

```ts
skill_name: z.string().optional().describe("Optional skill context used to apply skill-specific agent policy")
```

Then, before any filesystem action:

```ts
const skills = getSkills();
const skill = findSkillByName(skills, skill_name);
const ctx = { globalConfig: config, skill };
const decision = canAccessPath("superskills_read_file", filePath, ctx);
if (!decision.ok) {
  return {
    isError: true,
    content: [{ type: "text" as const, text: policyErrorText(decision.reason!) }]
  };
}
```

Use the matching tool name for write/list.

- [ ] **Step 5: Enforce `superskills_env` and `superskills_invoke` policy switches**

In each handler, before any sensitive action:

```ts
const ctx = { globalConfig: config, skill };
const decision = canUseTool("superskills_env", ctx);
if (!decision.ok) {
  return {
    isError: true,
    content: [{ type: "text" as const, text: policyErrorText(decision.reason!) }]
  };
}
```

And similarly for `superskills_invoke`.

- [ ] **Step 6: Build after wiring all agent checks**

Run:

```bash
npm run build
```

Expected: Build passes and generated `dist/` includes `policy.js`.

- [ ] **Step 7: Commit enforcement changes**

```bash
git add src/agent.ts src/policy.ts
git commit -m "feat: enforce agent policy in agent mode tools"
```

### Task 5: Add safe default config examples and remote docs

**Files:**
- Modify: `README.md`
- Verify: `npm run build` (sanity check only)

- [ ] **Step 1: Add an `Agent Policy` section to `README.md` after the Agent Mode section**

Insert documentation like this:

```md
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
```

- [ ] **Step 2: Add one recommended remote deployment profile**

Append a short recommendation block:

```md
### Recommended remote profile

For long-running ChatGPT-facing deployments:
- enable `superskills_invoke`, `superskills_read_file`, `superskills_list_dir`
- disable `superskills_write_file` unless needed
- disable `superskills_env` by default
- keep `allowedCommands` minimal
- use workspace-only or notes-only `allowedPaths`
```

- [ ] **Step 3: Sanity-check the repo still builds**

Run:

```bash
npm run build
```

Expected: Build passes; no README-only changes should affect output.

- [ ] **Step 4: Commit docs**

```bash
git add README.md
git commit -m "docs: add agent policy remote safety guide"
```

### Task 6: Manual smoke test the policy behavior

**Files:**
- Modify: none required
- Verify: local commands only

- [ ] **Step 1: Create a temporary config with tight policy rules**

Write a local test config such as `~/.superskills/mcp-config.json` or a disposable file passed with `--config`:

```json
{
  "server": {
    "name": "superskills-mcp",
    "version": "0.6.7",
    "transport": "stdio",
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
  "agentPolicy": {
    "enabledTools": {
      "superskills_invoke": true,
      "superskills_run": true,
      "superskills_read_file": true,
      "superskills_write_file": false,
      "superskills_list_dir": true,
      "superskills_env": false
    },
    "allowedPaths": ["~/Downloads/superskills-mcp"],
    "allowedCommands": ["node"],
    "blockedCommands": ["rm", "curl", "git"],
    "allowEnv": false,
    "allowSkillInvoke": true
  },
  "skills": []
}
```

If the config validator still requires a skill or `scanRoots`, add one harmless `scanRoots` entry or a local static skill entry.

- [ ] **Step 2: Start the server locally**

Run:

```bash
npm run build && node dist/index.js serve --transport stdio --config ~/.superskills/mcp-config.json
```

Expected: server starts without throwing type or config errors.

- [ ] **Step 3: Verify expected allow/deny cases manually**

Test cases to exercise through your MCP client or manual integration harness:

- `superskills_read_file` on a file inside the repo → allowed
- `superskills_read_file` on `~/.ssh/config` → denied with `[agent-policy] path not allowed...`
- `superskills_run` with `node --version` → allowed
- `superskills_run` with `git status` → denied with `[agent-policy] command explicitly blocked...`
- `superskills_write_file` anywhere → denied when disabled
- `superskills_env` → denied when `allowEnv` is false

- [ ] **Step 4: Commit only if a smoke-test helper file or docs were added**

If you created no repo files, no commit is needed for this task. If you added a checked-in fixture or helper doc, commit it with:

```bash
git add <files>
git commit -m "test: add agent policy smoke test fixture"
```

## Self-review

### Spec coverage
- Global + skill-level policy support: covered in Tasks 1-2
- Unified policy module: covered in Task 3
- Enforcement for all agent tools: covered in Task 4
- Clear denial messages: covered in Task 3 and Task 4
- README remote safety docs: covered in Task 5
- Manual validation of allow/deny semantics: covered in Task 6

### Placeholder scan
- No `TODO`, `TBD`, or “implement later” placeholders remain
- Each code-changing task includes concrete snippets
- Each verification step includes exact commands

### Type consistency
- `AgentPolicy` is defined once in `src/types.ts`
- `agentPolicy` field name is consistent across `MultiSkillConfig`, `SkillDef`, and `ResolvedSkill`
- enforcement helpers consistently use `PolicyContext`, `PolicyDecision`, and `AgentToolName`

## Execution handoff

Plan complete and saved to `docs/superpowers/plans/2026-04-29-agent-policy.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
