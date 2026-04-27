// src/security.ts
import fs from "node:fs";
import path from "node:path";
import { SERVER_DIR } from "./config.js";
const SCRIPT_EXTS = [".js", ".mjs", ".cjs", ".ts", ".py", ".sh"];
export function assertSafeSkill(skill) {
    // 1. skillDir 必须存在且是目录
    if (!fs.existsSync(skill.skillDir)) {
        throw new Error(`[${skill.name}] skillDir does not exist: ${skill.skillDir}`);
    }
    if (!fs.statSync(skill.skillDir).isDirectory()) {
        throw new Error(`[${skill.name}] skillDir is not a directory: ${skill.skillDir}`);
    }
    // 2. runner.args 不允许含 NUL 字节
    for (const arg of skill.runner.args) {
        if (arg.includes("\0")) {
            throw new Error(`[${skill.name}] runner.args contains NUL byte`);
        }
    }
    // 3. runner script 只允许来自 serverDir（内置适配器）或 skillDir（skill 自带脚本）
    for (const arg of skill.runner.args) {
        const isScript = SCRIPT_EXTS.some((ext) => arg.endsWith(ext));
        if (!isScript)
            continue;
        const resolved = path.resolve(arg);
        const inServerDir = resolved.startsWith(SERVER_DIR + path.sep);
        const inSkillDir = resolved.startsWith(skill.skillDir + path.sep);
        if (!inServerDir && !inSkillDir) {
            throw new Error(`[${skill.name}] runner script must be inside serverDir or skillDir: ${arg}`);
        }
    }
}
export function assertSafeSkills(skills) {
    for (const skill of skills) {
        assertSafeSkill(skill);
    }
}
