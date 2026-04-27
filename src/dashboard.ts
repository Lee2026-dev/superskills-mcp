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
