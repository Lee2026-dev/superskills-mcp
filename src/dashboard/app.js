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
