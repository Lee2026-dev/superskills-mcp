document.addEventListener('DOMContentLoaded', () => {
  fetchSkills();
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
    console.error("Link Failure", err);
    document.getElementById('uptime').textContent = 'Offline';
  }
}

function renderDashboard(skills) {
  document.getElementById('stat-total').textContent = skills.length;
  document.getElementById('stat-static').textContent = skills.filter(s => s.source === 'static').length;
  document.getElementById('stat-auto').textContent = skills.filter(s => s.source === 'auto').length;

  const grid = document.getElementById('skills-grid');
  grid.innerHTML = '';

  skills.forEach((skill) => {
    const card = document.createElement('div');
    card.className = `skill-card ${skill.enabled ? '' : 'disabled'}`;
    
    card.innerHTML = `
      <div class="card-content">
        <div class="card-top">
          <div class="skill-name">${skill.name}</div>
          <div class="badge">${skill.source}</div>
        </div>
        <div class="skill-desc">${skill.description || 'No description available.'}</div>
      </div>
      <div class="card-footer">
        <label class="switch">
          <input type="checkbox" ${skill.enabled ? 'checked' : ''} onchange="toggleSkill('${skill.name}', this.checked)">
          <span class="slider"></span>
        </label>
        <div class="call-count">${skill.callCount} calls</div>
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
    if (res.ok) fetchSkills();
  } catch (err) {
    console.error("Sync Error", err);
    fetchSkills(); 
  }
}
