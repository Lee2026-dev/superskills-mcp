# Web Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a built-in, full-featured Web Dashboard to `superskills-mcp` served by the existing Express process, requiring zero extra dependencies, to visually manage and monitor skills.

**Architecture:** 
1. Add `DashboardRegistry` to track call counts and enabled state in memory.
2. Expose REST APIs (`/api/skills`, `/dashboard`) via a new `src/dashboard.ts` router.
3. Serve a Vanilla HTML/CSS/JS frontend from `src/dashboard/` that interacts with these APIs.

**Tech Stack:** Node.js (Express), Vanilla JS, HTML, CSS (Glassmorphism dark theme).

---

### Task 1: Extend Types and Runtime Registry

**Files:**
- Modify: `src/types.ts:60-93`

- [ ] **Step 1: Add `SkillMeta` and `DashboardRegistry` types**

```typescript
export interface SkillMeta {
  callCount: number;
  enabled: boolean;
  source: 'static' | 'auto';
}

export type DashboardRegistry = Map<string, SkillMeta>;
```

- [ ] **Step 2: Commit**

```bash
git add src/types.ts
git commit -m "feat: add types for DashboardRegistry"
```

---

### Task 2: Implement Backend API and Dashboard Router

**Files:**
- Create: `src/dashboard.ts`
- Modify: `src/mcp.ts`

- [ ] **Step 1: Create `src/dashboard.ts`**

```typescript
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ResolvedSkill, DashboardRegistry } from './types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function createDashboardRouter(
  skillsGetter: () => ResolvedSkill[],
  registry: DashboardRegistry,
  addSkillAction?: (skillDir: string) => void,
  removeSkillAction?: (name: string) => void
) {
  const router = express.Router();

  // Serve static files
  router.use('/', express.static(path.join(__dirname, 'dashboard')));

  // API: Get all skills with metadata
  router.get('/api/skills', (req, res) => {
    const skills = skillsGetter();
    const result = skills.map(s => {
      const meta = registry.get(s.name) || { callCount: 0, enabled: true, source: 'static' };
      return {
        name: s.name,
        description: s.description,
        skillDir: s.skillDir,
        ...meta
      };
    });
    res.json({ ok: true, skills: result });
  });

  // API: Toggle enable/disable
  router.patch('/api/skills/:name', (req, res) => {
    const { name } = req.params;
    const { enabled } = req.body;
    
    const meta = registry.get(name);
    if (meta) {
      meta.enabled = Boolean(enabled);
      registry.set(name, meta);
      res.json({ ok: true });
    } else {
      res.status(404).json({ ok: false, error: 'Skill not found' });
    }
  });

  // API: Add skill (optional capability)
  router.post('/api/skills', (req, res) => {
    if (!addSkillAction) {
      return res.status(501).json({ ok: false, error: 'Add skill not supported' });
    }
    const { skillDir } = req.body;
    if (!skillDir) return res.status(400).json({ ok: false, error: 'skillDir required' });
    
    try {
      addSkillAction(skillDir);
      res.json({ ok: true });
    } catch (err) {
      res.status(400).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  });

  // API: Remove skill (optional capability)
  router.delete('/api/skills/:name', (req, res) => {
    if (!removeSkillAction) {
      return res.status(501).json({ ok: false, error: 'Remove skill not supported' });
    }
    const { name } = req.params;
    const meta = registry.get(name);
    
    if (meta?.source === 'auto') {
      return res.status(400).json({ ok: false, error: 'Cannot remove auto-discovered skills via API. Remove the directory instead.' });
    }

    try {
      removeSkillAction(name);
      res.json({ ok: true });
    } catch (err) {
      res.status(400).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  });

  return router;
}
```

- [ ] **Step 2: Update `src/mcp.ts` to accept and track `registry`**

Change `startHttp` to accept the router and registry. Wrap the tool handler to increment `callCount` and check `enabled`.

*Note: Since the actual wiring of the router needs to happen in `startHttp`, modify it to accept `registry` and mount `/dashboard`.*

```typescript
import { createDashboardRouter } from "./dashboard.js";
import { DashboardRegistry } from "./types.js";

// Change startHttp signature
export async function startHttp(
  globalConfig: MultiSkillConfig,
  skillsOrGetter: ResolvedSkill[] | (() => ResolvedSkill[]),
  registry: DashboardRegistry
): Promise<void> {
  // ... existing setup
  const app = express();
  app.use(express.json({ limit: "4mb" }));

  // Mount Dashboard
  app.use("/dashboard", createDashboardRouter(
    typeof skillsOrGetter === "function" ? skillsOrGetter : () => skillsOrGetter,
    registry
  ));

  app.post("/mcp", async (req, res) => {
    const allSkills = typeof skillsOrGetter === "function" ? skillsOrGetter() : skillsOrGetter;
    // Filter out disabled skills
    const enabledSkills = allSkills.filter(s => registry.get(s.name)?.enabled !== false);
    
    const server = new McpServer({
      name: globalConfig.server.name,
      version: globalConfig.server.version
    });

    for (const skill of enabledSkills) {
      const shape = buildZodShape(skill.input);
      server.tool(skill.name, skill.description, shape, async (toolArgs) => {
        // Increment call count
        const meta = registry.get(skill.name);
        if (meta) {
          meta.callCount++;
          registry.set(skill.name, meta);
        }
        // ... rest of tool execution logic
```

- [ ] **Step 3: Commit**

```bash
git add src/dashboard.ts src/mcp.ts
git commit -m "feat: implement dashboard API routes and tool execution tracking"
```

---

### Task 3: Wire Registry in Main Entrypoint

**Files:**
- Modify: `src/index.ts`

- [ ] **Step 1: Initialize Registry and pass to `startHttp`**

In `runServe()`:

```typescript
import { DashboardRegistry } from "./types.js";

// Inside runServe()
const registry: DashboardRegistry = new Map();

// Helper to update registry when skills are refreshed
const syncRegistry = (staticS: ResolvedSkill[], dynamicS: ResolvedSkill[]) => {
  // Mark static
  for (const s of staticS) {
    if (!registry.has(s.name)) {
      registry.set(s.name, { callCount: 0, enabled: true, source: 'static' });
    } else {
      const m = registry.get(s.name)!;
      m.source = 'static';
    }
  }
  // Mark dynamic
  const staticNames = new Set(staticS.map(s => s.name));
  for (const s of dynamicS) {
    if (!staticNames.has(s.name)) {
      if (!registry.has(s.name)) {
        registry.set(s.name, { callCount: 0, enabled: true, source: 'auto' });
      } else {
        const m = registry.get(s.name)!;
        m.source = 'auto';
      }
    }
  }
};

// ... inside updateDynamicSkills() after newSkills is populated
syncRegistry(staticSkills, newSkills);

// Update startHttp call
if (config.server.transport === "http") {
  await startHttp(config, getCombinedSkills, registry);
}
```

- [ ] **Step 2: Commit**

```bash
git add src/index.ts
git commit -m "feat: wire DashboardRegistry in main entrypoint"
```

---

### Task 4: Build Frontend Static Files

**Files:**
- Create: `src/dashboard/index.html`
- Create: `src/dashboard/style.css`
- Create: `src/dashboard/app.js`

- [ ] **Step 1: Create `src/dashboard/index.html`**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>superskills-mcp | Dashboard</title>
  <link rel="stylesheet" href="style.css">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
</head>
<body>
  <header>
    <div class="logo">⚡ superskills-mcp</div>
    <div class="status-indicator">
      <div class="pulse"></div>
      <span id="uptime">Online</span>
    </div>
  </header>

  <main>
    <section class="stats-bar">
      <div class="stat-card">
        <div class="stat-label">Total Skills</div>
        <div class="stat-value" id="stat-total">0</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Static Configured</div>
        <div class="stat-value" id="stat-static">0</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Auto Discovered</div>
        <div class="stat-value" id="stat-auto">0</div>
      </div>
    </section>

    <section class="skills-grid" id="skills-grid">
      <!-- Cards rendered here via JS -->
    </section>
  </main>

  <script src="app.js"></script>
</body>
</html>
```

- [ ] **Step 2: Create `src/dashboard/style.css`**

```css
:root {
  --bg-color: #0a0e1a;
  --card-bg: rgba(255, 255, 255, 0.03);
  --card-border: rgba(255, 255, 255, 0.08);
  --text-main: #f0f4ff;
  --text-muted: #8a96b3;
  --accent: #00f0ff;
  --accent-glow: rgba(0, 240, 255, 0.4);
  --auto-badge: #10b981;
  --static-badge: #3b82f6;
}

* { box-sizing: border-box; margin: 0; padding: 0; }

body {
  font-family: 'Inter', sans-serif;
  background-color: var(--bg-color);
  color: var(--text-main);
  min-height: 100vh;
  padding: 2rem;
  background-image: radial-gradient(circle at 50% 0%, #1a233a 0%, transparent 50%);
}

header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 3rem;
  padding-bottom: 1rem;
  border-bottom: 1px solid var(--card-border);
}

.logo { font-size: 1.5rem; font-weight: 700; text-shadow: 0 0 10px var(--accent-glow); }

.status-indicator { display: flex; align-items: center; gap: 0.5rem; color: var(--auto-badge); font-weight: 500;}
.pulse { width: 10px; height: 10px; border-radius: 50%; background-color: var(--auto-badge); box-shadow: 0 0 8px var(--auto-badge); animation: pulsate 2s infinite; }
@keyframes pulsate { 0% { opacity: 0.5; } 50% { opacity: 1; box-shadow: 0 0 12px var(--auto-badge); } 100% { opacity: 0.5; } }

.stats-bar { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1.5rem; margin-bottom: 3rem; }
.stat-card { background: var(--card-bg); border: 1px solid var(--card-border); border-radius: 12px; padding: 1.5rem; backdrop-filter: blur(10px); }
.stat-label { color: var(--text-muted); font-size: 0.9rem; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 0.5rem; }
.stat-value { font-size: 2.5rem; font-weight: 700; color: var(--accent); }

.skills-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(350px, 1fr)); gap: 1.5rem; }
.skill-card { background: var(--card-bg); border: 1px solid var(--card-border); border-radius: 12px; padding: 1.5rem; display: flex; flex-direction: column; gap: 1rem; transition: transform 0.2s; }
.skill-card:hover { transform: translateY(-3px); border-color: var(--accent-glow); }
.skill-card.disabled { opacity: 0.5; filter: grayscale(1); }

.card-header { display: flex; justify-content: space-between; align-items: flex-start; }
.skill-name { font-size: 1.25rem; font-weight: 600; word-break: break-all;}
.badge { font-size: 0.75rem; padding: 0.25rem 0.5rem; border-radius: 4px; font-weight: 600; text-transform: uppercase; }
.badge.auto { background: rgba(16, 185, 129, 0.2); color: var(--auto-badge); }
.badge.static { background: rgba(59, 130, 246, 0.2); color: var(--static-badge); }

.skill-desc { color: var(--text-muted); font-size: 0.9rem; line-height: 1.5; flex-grow: 1; }

.card-footer { display: flex; justify-content: space-between; align-items: center; border-top: 1px solid var(--card-border); padding-top: 1rem; }
.call-count { font-size: 0.85rem; color: var(--text-muted); display: flex; align-items: center; gap: 0.5rem; }

/* Toggle Switch */
.switch { position: relative; display: inline-block; width: 44px; height: 24px; }
.switch input { opacity: 0; width: 0; height: 0; }
.slider { position: absolute; cursor: pointer; top: 0; left: 0; right: 0; bottom: 0; background-color: #374151; transition: .4s; border-radius: 24px; }
.slider:before { position: absolute; content: ""; height: 18px; width: 18px; left: 3px; bottom: 3px; background-color: white; transition: .4s; border-radius: 50%; }
input:checked + .slider { background-color: var(--accent); }
input:checked + .slider:before { transform: translateX(20px); }
```

- [ ] **Step 3: Create `src/dashboard/app.js`**

```javascript
document.addEventListener('DOMContentLoaded', () => {
  fetchSkills();
  // Poll every 5 seconds
  setInterval(fetchSkills, 5000);
});

async function fetchSkills() {
  try {
    const res = await fetch('/dashboard/api/skills');
    const data = await res.json();
    if (data.ok) {
      renderDashboard(data.skills);
    }
  } catch (err) {
    console.error("Failed to fetch skills", err);
  }
}

function renderDashboard(skills) {
  // Update Stats
  document.getElementById('stat-total').textContent = skills.length;
  document.getElementById('stat-static').textContent = skills.filter(s => s.source === 'static').length;
  document.getElementById('stat-auto').textContent = skills.filter(s => s.source === 'auto').length;

  const grid = document.getElementById('skills-grid');
  grid.innerHTML = '';

  skills.forEach(skill => {
    const card = document.createElement('div');
    card.className = `skill-card ${skill.enabled ? '' : 'disabled'}`;
    
    card.innerHTML = `
      <div class="card-header">
        <div class="skill-name">${skill.name}</div>
        <div class="badge ${skill.source}">${skill.source}</div>
      </div>
      <div class="skill-desc">${skill.description || 'No description provided.'}</div>
      <div class="card-footer">
        <div class="call-count">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>
          ${skill.callCount} calls
        </div>
        <label class="switch">
          <input type="checkbox" ${skill.enabled ? 'checked' : ''} onchange="toggleSkill('${skill.name}', this.checked)">
          <span class="slider"></span>
        </label>
      </div>
    `;
    grid.appendChild(card);
  });
}

window.toggleSkill = async function(name, enabled) {
  try {
    const res = await fetch(`/dashboard/api/skills/${name}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled })
    });
    if (!res.ok) throw new Error("Toggle failed");
    fetchSkills();
  } catch (err) {
    console.error(err);
    alert("Failed to update skill state.");
    fetchSkills(); // Revert UI
  }
}
```

- [ ] **Step 4: Commit**

```bash
git add src/dashboard
git commit -m "feat: add frontend static assets for web dashboard"
```

---

### Task 5: Build Integration & Verification

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Ensure frontend assets are included in `files` array**

Check `package.json`. If `src/dashboard` is not compiled by `tsc` (it isn't, they are static), we need to copy them to `dist/dashboard` during build.

Update `package.json` scripts:
```json
"scripts": {
  "build": "tsc && cp -r src/dashboard dist/dashboard",
  // ...
}
```

- [ ] **Step 2: Commit**

```bash
git add package.json
git commit -m "build: copy dashboard static assets to dist during build"
```

- [ ] **Step 3: Build & Verify**

Run `npm run build`. Start the server with `npm run dev`.
Navigate to `http://127.0.0.1:8787/dashboard` and verify the UI loads and displays skills.

---

计划已保存至 `docs/superpowers/plans/2026-04-27-web-dashboard.md`。

**有两种执行方案可选：**

1. **子代理驱动（推荐）** - 我会为每一个 Task 派遣一个专门的子代理去执行，任务之间我会进行严格的代码审查和验证，速度快且质量高。
2. **当前会话执行** - 我直接在当前对话中按步骤执行，适合小规模改动。

**你希望采用哪种方式开始？**
