// src/types.ts
export type TransportMode = "stdio" | "http";

/** 单个字段的 JSON Schema 简化描述 */
export interface InputFieldSchema {
  type: "string" | "number" | "boolean";
  format?: string; // e.g. "uri"
  description?: string;
  enum?: string[];
}

/** Runner 配置，支持 {serverDir} 占位符 */
export interface RunnerConfig {
  command: string;
  args: string[];
}

/**
 * CLI Runner 配置：直接将 MCP 参数映射为命令行调用。
 * 适用于"instruction-based"类 skill（非 JSON stdin/stdout 协议）。
 *
 * 占位符规则：
 *   {skillDir}   → skill 目录绝对路径
 *   {args.key}   → 对应 MCP 输入参数的值
 *
 * optionalArgs: 二元组 [flag, "{args.key}"]
 *   - 仅当 args.key 有值时才追加到命令行
 *   - 若值为 "true" 或 "1"，则只追加 flag（布尔开关模式）
 *   - 否则追加 flag 和值两个 token
 */
export interface CliRunnerConfig {
  command: string;
  args: string[];
  optionalArgs?: [string, string][];
}

/** 单个 skill 的定义（来自 config 文件） */
export interface SkillDef {
  name: string;
  description: string;
  skillDir: string;
  input: Record<string, InputFieldSchema>;
  env?: Record<string, string>;
  // 可覆盖 defaults 中的 runner（JSON stdin/stdout 协议）
  runner?: RunnerConfig;
  // CLI 直接调用模式（优先级高于 runner）
  cliRunner?: CliRunnerConfig;
  timeoutMs?: number;
  maxOutputBytes?: number;
}

/** 全局 server 配置 */
export interface ServerGlobalConfig {
  name: string;
  version: string;
  transport: TransportMode;
  host: string;
  port: number;
  /** 可选：ngrok 认证令牌，配置后启动时自动开启隧道 */
  ngrokToken?: string;
  /** 可选：ngrok 自定义域名 */
  ngrokDomain?: string;
  /** 可选：是否开启 ngrok 连接池，防止地址占用错误 */
  ngrokPooling?: boolean;
}

/** defaults，供所有 skill 继承 */
export interface SkillDefaults {
  timeoutMs: number;
  maxOutputBytes: number;
  runner: RunnerConfig;
}

/** 本地笔记工具配置 */
export interface NotesConfig {
  /** 笔记目录，支持 ~ 展开 */
  dir: string;
}

/** 顶层配置文件结构 */
export interface MultiSkillConfig {
  server: ServerGlobalConfig;
  defaults: SkillDefaults;
  scanRoots?: string[];
  scanSettings?: {
    watch?: boolean;
    ignore?: string[];
  };
  /** 内置本地笔记工具配置 */
  notes?: NotesConfig;
  skills: SkillDef[];
}

/** runner 执行时用的完整 skill 上下文（defaults 已合并） */
export interface ResolvedSkill {
  name: string;
  description: string;
  skillDir: string;
  input: Record<string, InputFieldSchema>;
  env: Record<string, string>;
  runner: RunnerConfig;
  /** 若定义了 cliRunner，则跳过 mcp-adapter，直接执行 CLI 命令 */
  cliRunner?: CliRunnerConfig;
  timeoutMs: number;
  maxOutputBytes: number;
}

/** adapter stdin 协议 */
export interface SkillInput {
  tool: string;
  args: Record<string, unknown>;
  context: {
    skillDir: string;
    skillName: string;
  };
}

/** adapter stdout 协议 */
export interface SkillOutput {
  ok?: boolean;
  content?: Array<{ type: "text"; text: string }>;
  markdown?: string;
  text?: string;
  data?: unknown;
  error?: {
    code?: string;
    message?: string;
  };
}

/** Dashboard metadata tracking */
export interface SkillMeta {
  callCount: number;
  enabled: boolean;
  source: 'static' | 'auto';
}

export type DashboardRegistry = Map<string, SkillMeta>;
