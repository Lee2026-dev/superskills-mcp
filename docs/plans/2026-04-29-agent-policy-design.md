# Agent Policy Design

Date: 2026-04-29
Project: `superskills-mcp`
Status: Approved

## Summary

The next feature for `superskills-mcp` should be an Agent Policy system for Agent Mode. The goal is to make long-running remote deployments safe enough for ChatGPT-facing HTTP usage.

This feature adds a configurable policy layer that constrains Agent Mode primitives before execution. It applies to file access, command execution, and sensitive agent tools.

## Why this feature next

`superskills-mcp` already has a strong MCP gateway foundation:

- static and auto-discovered skills
- HTTP and stdio transports
- dashboard support
- notes tools
- ngrok integration
- Agent Mode primitives (`run`, `read`, `write`, `list`, `env`, `invoke`)

The main product risk now is that Agent Mode is powerful but not yet bounded enough for safe external exposure. For the target use case of long-running internet-exposed usage, security boundaries are a higher priority than additional convenience features.

## Alternatives considered

### 1. Agent Policy system (**recommended**)
Add a unified policy layer for Agent Mode tools.

Pros:
- directly addresses the biggest risk in remote deployments
- fits the current architecture
- improves trust and adoptability
- preserves Agent Mode flexibility

Cons:
- not a true OS-level sandbox
- requires careful policy design and docs

### 2. Dashboard management enhancements
Add dashboard-powered add/remove/edit/reload flows.

Pros:
- good usability win
- existing API shape already hints at this direction

Cons:
- does not solve the primary remote-deployment risk
- product becomes easier to use before it becomes safe to use

### 3. Execution history / audit logging
Record tool calls, args, duration, and outcome.

Pros:
- improves observability
- useful companion to Agent Mode

Cons:
- helps explain incidents rather than prevent them
- better as a follow-up after policy controls exist

## Recommendation

Build **Agent Policy: configurable filesystem and command sandbox for Agent Mode**.

## Goals

- make Agent Mode safer for long-running remote HTTP deployments
- enforce a default-deny model around high-risk primitives
- provide one consistent policy surface across all agent tools
- support global defaults plus skill-level appended exceptions
- produce clear rejection messages that models can self-correct from

## Non-goals

- OS-level sandboxing
- per-user auth or multi-tenant isolation
- network egress sandboxing beyond command restrictions
- replacing the existing skill runner security model

## Configuration model

Policy should exist in two places:

- global: `agentPolicy`
- per skill: `skills[].agentPolicy`

The merge model is:

- global policy defines the baseline
- skill policy inherits and appends
- skill policy must not weaken global deny rules

## Proposed policy shape

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
      "{skillDir}",
      "~/Documents/superskills-workspace"
    ],
    "allowedCommands": ["bun", "node", "python3", "uv"],
    "blockedCommands": ["rm", "sudo", "ssh", "scp", "curl", "wget", "git"],
    "allowEnv": false,
    "allowSkillInvoke": true
  }
}
```

Per-skill overrides should support appended values only, for example:

```json
{
  "name": "some_skill",
  "agentPolicy": {
    "allowedPaths": ["~/Downloads/special-skill-dir"],
    "allowedCommands": ["bash"]
  }
}
```

## Policy semantics

### 1. File tools
Applies to:

- `superskills_read_file`
- `superskills_write_file`
- `superskills_list_dir`

Rules:

- requested path must resolve inside at least one `allowedPaths` entry
- path checks must happen after normalization
- support placeholders:
  - `{skillDir}`
  - `{notesDir}`
  - `{cwd}`
- skill-level `allowedPaths` are appended to global `allowedPaths`

This prevents path traversal and accidental access outside explicit work areas.

### 2. Command execution
Applies to:

- `superskills_run`

Rules:

- if command matches `blockedCommands`, reject immediately
- otherwise command must appear in `allowedCommands`
- skill-level `allowedCommands` are appended to global `allowedCommands`
- skill policy must not remove or override global blocked commands

This makes command execution explicit and bounded.

### 3. Other agent tools
Applies to:

- `superskills_env`
- `superskills_invoke`
- optionally all tools through `enabledTools`

Rules:

- `enabledTools` provides per-tool availability
- `allowEnv` controls `.env` access
- `allowSkillInvoke` controls whether skill manuals can be loaded
- a skill may further restrict tools, but may not re-enable a globally disabled tool

## Architecture

Add a new module:

- `src/policy.ts`

Responsibilities:

- define policy types
- merge global and skill policies
- resolve placeholders into concrete paths
- normalize and evaluate path access
- validate command access
- validate tool availability
- generate consistent denial reasons

## Integration points

### `src/types.ts`
Add:

- global `agentPolicy`
- `skills[].agentPolicy`
- policy-related type definitions

### `src/agent.ts`
Before executing each `superskills_*` tool:

1. resolve optional `skill_name`
2. compute effective policy
3. validate tool/path/command access
4. execute only if allowed
5. otherwise return a structured denial message

## Skill context handling

Some policy rules depend on skill context, especially `{skillDir}`. For that reason:

- `superskills_invoke(skill_name)` already has skill context
- `superskills_env(skill_name)` already supports skill context
- `superskills_run`, `superskills_read_file`, `superskills_write_file`, and `superskills_list_dir` should gain an optional `skill_name`

Behavior:

- when `skill_name` is provided, apply global policy plus the skill’s appended policy
- when omitted, apply global policy only

This avoids hidden state and makes policy evaluation explicit.

## Data flow

For each agent tool call:

1. receive request
2. resolve tool name and optional `skill_name`
3. compute effective policy
4. normalize requested path or command
5. evaluate allow/deny
6. return denial reason or execute action

This creates a single enforcement layer that future dashboard or audit features can reuse.

## Error handling

Denials should be explicit and model-friendly, for example:

- tool disabled by policy
- path not allowed by agent policy
- command not in allowedCommands
- command explicitly blocked
- unknown skill
- skill context required for this operation

The goal is to help the model recover instead of failing opaquely.

## Testing strategy

### File access
Verify:

- access inside allowed directories succeeds
- access outside allowed directories fails
- `~`, relative paths, Unicode paths, and normalized paths work correctly
- `../` traversal cannot escape policy boundaries

### Command execution
Verify:

- allowed commands succeed
- commands outside the allowlist fail
- blocked commands fail even if otherwise allowed
- skill-appended commands work
- skill overrides cannot bypass global blocked commands

### Tool switches
Verify:

- globally disabled tools stay disabled
- skill-level policy can further restrict tools
- `superskills_env` and `superskills_invoke` respect dedicated controls

### Inheritance semantics
Verify:

- effective policy is global plus appended skill rules
- omitted `skill_name` uses global-only policy
- provided `skill_name` correctly expands skill-specific rules

### Transport parity
Verify:

- HTTP and stdio behavior match
- denial messages are consistent across transports

## Documentation requirements

README should gain a dedicated section for remote deployment safety, including:

- what Agent Policy is
- recommended default-remote configuration
- examples for notes-only, workspace-only, and skillDir-only setups
- warnings about enabling `superskills_run`, `superskills_write_file`, and `superskills_env`

## Acceptance criteria

The feature is complete when:

- global `agentPolicy` is supported in config
- per-skill appended `agentPolicy` is supported
- all Agent Mode primitives are checked through one policy layer before execution
- denial messages are clear and actionable
- README documents safe remote deployment configuration
- at least one secure default example is provided

## Proposed implementation sequence

1. add policy types to config and resolved skill types
2. implement `src/policy.ts`
3. wire policy checks into `src/agent.ts`
4. add optional `skill_name` to file/run/list tools
5. add tests for path and command enforcement
6. document safe remote deployment usage in README

## Final decision

The next feature for this project should be:

**Agent Policy: a configurable filesystem and command sandbox for Agent Mode, using global defaults plus skill-level appended rules, designed for safer long-running remote deployments.**
