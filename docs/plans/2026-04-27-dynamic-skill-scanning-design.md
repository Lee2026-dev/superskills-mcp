# Design Doc: Dynamic Skill Scanning & Auto-Discovery

- **Status**: Approved
- **Date**: 2026-04-27
- **Author**: Antigravity

## 1. Overview
The goal is to enable "Zero-Configuration" skill management. Users should be able to drop a skill folder into a monitored directory, and `superskills-mcp` should automatically detect, parse, and expose it as an MCP tool in real-time.

## 2. Requirements
- Support multiple "Scan Roots" (directories to monitor).
- Automatically parse `SKILL.md` or `package.json` for metadata.
- Support Real-time watching (add/remove folder = add/remove tool).
- Combine manual `skills: []` definitions with auto-discovered ones.
- Zero-downtime hot-swapping of tools.

## 3. Architecture

### 3.1 Configuration Updates
The `MultiSkillConfig` interface will be extended:
```typescript
interface MultiSkillConfig {
  // ... existing fields
  scanRoots?: string[];
  scanSettings?: {
    watch?: boolean;
    ignore?: string[];
  };
}
```

### 3.2 Scanning Logic (`src/scanner.ts`)
- A new `SkillScanner` class will handle the heavy lifting.
- It will shallow-scan the provided roots for subdirectories.
- A subdirectory is considered a "Skill" if it contains a `SKILL.md` (priority) or `package.json`.
- It will use the same parsing logic used in the `add` command to extract `name` and `description`.

### 3.3 Real-time Watcher
- Integrated with `chokidar`.
- Events to monitor: `addDir` and `unlinkDir`.
- On change, the scanner re-evaluates the root and updates a shared `DynamicRegistry`.

### 3.4 Request Handling
- The `startHttp` logic already creates a new `McpServer` instance for every incoming POST request.
- By providing a reference to the `DynamicRegistry` to the Express route handler, every new request will naturally use the most up-to-date list of tools.

## 4. Implementation Details
- **Dependency**: Add `chokidar` via `npm install`.
- **Path Resolution**: Support `~/` expansion in `scanRoots`.
- **Conflict Handling**: If an auto-discovered skill has the same name as a manually defined one, the manual one takes priority.

## 5. Security
- Auto-discovered skills must still pass the `assertSafeSkills` check (must be within a valid `skillDir`).
- The scanner will ignore hidden folders (starting with `.`) and `node_modules` by default.
