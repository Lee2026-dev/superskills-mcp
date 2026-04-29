import os from "node:os";
import path from "node:path";
import { AgentPolicy, MultiSkillConfig, ResolvedSkill, ToolPolicyMap } from "./types.js";

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

interface ResolvedAgentPolicy {
  enabledTools: ToolPolicyMap;
  allowedPaths: string[];
  allowedCommands: string[];
  blockedCommands: string[];
  allowEnv: boolean;
  allowSkillInvoke: boolean;
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

export function getEffectiveAgentPolicy(ctx: PolicyContext): ResolvedAgentPolicy {
  const globalPolicy: AgentPolicy = ctx.globalConfig.agentPolicy ?? {};
  const skillPolicy: AgentPolicy = ctx.skill?.agentPolicy ?? {};

  const enabledTools: ToolPolicyMap = {
    ...(globalPolicy.enabledTools ?? {}),
    ...(skillPolicy.enabledTools ?? {})
  };

  for (const [tool, globalEnabled] of Object.entries(globalPolicy.enabledTools ?? {})) {
    if (globalEnabled === false) {
      enabledTools[tool as keyof ToolPolicyMap] = false;
    }
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
    .map((p) => resolvePolicyPathTemplate(p, ctx))
    .filter((p): p is string => Boolean(p));

  if (allowedRoots.length === 0) {
    return { ok: false, reason: "no allowedPaths configured for agent policy" };
  }

  const permitted = allowedRoots.some((root) => target === root || target.startsWith(`${root}${path.sep}`));
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
