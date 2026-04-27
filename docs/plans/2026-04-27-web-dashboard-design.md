# Design Doc: Web Dashboard for superskills-mcp

- **Status**: Approved
- **Date**: 2026-04-27
- **Author**: Antigravity

## 1. Overview

Add a built-in, full-featured Web Dashboard to `superskills-mcp`. The dashboard is served by the existing Express process at `/dashboard`, requires zero extra dependencies or startup steps, and gives users a beautiful visual interface to manage their skills.

## 2. Goals

- **Visualize** all registered skills (static + auto-discovered) in a premium card-based UI.
- **Manage** skills: add new ones by path, remove static ones, enable/disable any skill at runtime.
- **Monitor** basic server stats: uptime, total tool count, call counts per tool.

## 3. Non-Goals

- No separate frontend build step (Vite, React, etc.)
- No real-time log streaming in this iteration (future feature)
- No authentication in this iteration

## 4. Architecture

### 4.1 Backend: REST API Routes (in `src/mcp.ts` / new `src/dashboard.ts`)

New Express routes added alongside the existing `/mcp` and `/health` endpoints:

| Method | Path | Description |
|---|---|---|
| `GET` | `/dashboard` | Serves the HTML page |
| `GET` | `/api/skills` | Returns merged static + dynamic skills with call counts & enabled status |
| `POST` | `/api/skills` | Adds a new skill by `skillDir` path (calls `runAdd` logic) |
| `DELETE` | `/api/skills/:name` | Removes a static skill by name (calls `runRemove` logic) |
| `PATCH` | `/api/skills/:name` | Toggles enabled/disabled status in runtime registry |

### 4.2 Frontend: Static Files (`src/dashboard/`)

- `index.html`: The single-page app shell
- `style.css`: All visual styling (dark theme, glassmorphism, animations)
- `app.js`: All client-side logic (fetch API calls, DOM manipulation)

Express serves this directory via `express.static()`.

### 4.3 Runtime State: In-Memory Registry

A new `DashboardRegistry` object (a `Map<string, SkillMeta>`) tracks:
```typescript
interface SkillMeta {
  callCount: number;
  enabled: boolean;
  source: 'static' | 'auto';
}
```

This registry is initialized on server start and updated on each tool call.

## 5. Visual Design

### Theme
- **Dark mode** glassmorphism aesthetic
- **Color palette**: Deep navy background (`#0a0e1a`), glass cards with `backdrop-filter: blur`, accent color electric blue/purple gradient
- **Typography**: Inter or Outfit from Google Fonts

### Layout
- **Header**: Logo + server name + uptime + animated green status pulse
- **Stats Bar**: 3 metric cards — Total Tools, Static, Auto-Discovered
- **Skills Grid**: Responsive CSS grid (3 cols on desktop, 1 on mobile)
- **Skill Card** contains:
  - Tool name (gradient text)
  - Description (truncated)
  - Source badge (`[auto]` in green, `[static]` in blue)
  - Call count with icon
  - Enable/disable toggle switch
  - Delete button (static skills only, with confirmation)
- **FAB (Floating Action Button)**: `+` button bottom-right, opens modal to add skill by path

## 6. Data Flow

```
User opens /dashboard
  → Express serves index.html
  → app.js calls GET /api/skills
  → Server merges static + dynamic skills with DashboardRegistry metadata
  → Cards rendered in grid

User clicks "Disable" toggle
  → app.js calls PATCH /api/skills/:name { enabled: false }
  → Server updates DashboardRegistry in memory
  → Next MCP request filters out disabled skills

User clicks "+" FAB, enters path, submits
  → app.js calls POST /api/skills { skillDir: "/path/to/skill" }
  → Server validates path, parses SKILL.md, writes to mcp-config.json
  → Returns updated skill list
  → UI re-renders

User clicks "Delete"
  → Confirmation modal shown
  → app.js calls DELETE /api/skills/:name
  → Server removes from mcp-config.json
  → UI removes card with animation
```

## 7. Files to Create/Modify

| File | Action | Purpose |
|---|---|---|
| `src/dashboard.ts` | Create | REST API routes + static file serving |
| `src/dashboard/index.html` | Create | Dashboard HTML shell |
| `src/dashboard/style.css` | Create | All visual styling |
| `src/dashboard/app.js` | Create | Client-side fetch + DOM logic |
| `src/mcp.ts` | Modify | Import and mount dashboard routes |
| `src/types.ts` | Modify | Add `SkillMeta` and `DashboardRegistry` types |

## 8. Error Handling

- If `POST /api/skills` path doesn't contain `SKILL.md`: return `400` with clear message.
- If `DELETE /api/skills/:name` targets an auto-discovered skill: return `400` (must remove from directory instead).
- All API errors return `{ ok: false, error: "..." }`.
