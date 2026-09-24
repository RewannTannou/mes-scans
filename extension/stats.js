// Statistiques de lecture, calculées à partir de l'historique enregistré par
// l'extension : history = { 'AAAA-MM-JJ': { idDuScan: chapitresLus, … }, … }

const dayKey = (date) => date.toLocaleDateString('sv'); // AAAA-MM-JJ, heure locale

function lastDays(n) {
  const days = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    days.push(dayKey(d));
  }
  return days;
}

const dayTotal = (history, key) => Object.values(history[key] || {}).reduce((a, b) => a + b, 0);

// Jours d'affilée avec au moins un chapitre lu (aujourd'hui compte s'il y a déjà une lecture,
// sinon la série continue depuis hier)
function streak(history) {
  let count = 0;
  const d = new Date();
  if (!dayTotal(history, dayKey(d))) d.setDate(d.getDate() - 1);
  while (dayTotal(history, dayKey(d)) > 0) {
    count++;
    d.setDate(d.getDate() - 1);
  }
  return count;
}

function formatDay(key, opts = { day: 'numeric', month: 'short' }) {
  return new Date(`${key}T12:00:00`).toLocaleDateString('fr-FR', opts);
}

// Histogramme des 30 derniers jours (une seule série : pas de légende, le titre la nomme)
function barChart(days, values) {
  const W = 600, H = 170, top = 16, bottom = 24, left = 28;
  const base = H - bottom;
  const max = Math.max(1, ...values);
  const step = (W - left) / days.length;
  const barW = step - 2; // 2 px d'écart entre les barres
  const y = (v) => base - (v / max) * (base - top);

  const bars = values
    .map((v, i) => {
      const x = left + i * step + 1;
      const label = `${formatDay(days[i], { weekday: 'short', day: 'numeric', month: 'short' })} : ${v} chapitre${v > 1 ? 's' : ''}`;
      let mark = '';
      if (v > 0) {
        const yt = y(v);
        const r = Math.min(4, barW / 2, base - yt);
        mark = `<path class="bar" d="M${x},${base} V${yt + r} Q${x},${yt} ${x + r},${yt} H${x + barW - r} Q${x + barW},${yt} ${x + barW},${yt + r} V${base} Z"/>`;
      }
      // Zone de survol plus large que la barre (toute la colonne)
      return `<g class="col" data-tip="${escapeHtml(label)}">${mark}<rect class="hit" x="${left + i * step}" y="${top}" width="${step}" height="${base - top}"/></g>`;
    })
    .join('');

  // Première date alignée à gauche, dernière à droite : elles ne sortent pas du cadre
  const ticks = [
    [0, left, 'start'],
    [Math.floor(days.length / 2), left + Math.floor(days.length / 2) * step + step / 2, 'middle'],
    [days.length - 1, W, 'end'],
  ]
    .map(([i, x, anchor]) => `<text class="tick" x="${x}" y="${H - 6}" text-anchor="${anchor}">${formatDay(days[i])}</text>`)
    .join('');

  return `
    <div class="chart-wrap">
      <svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="Chapitres lus par jour sur les 30 derniers jours, maximum ${max}">
        <line class="grid" x1="${left}" x2="${W}" y1="${y(max)}" y2="${y(max)}"/>
        <text class="tick" x="${left - 6}" y="${y(max) + 4}" text-anchor="end">${max}</text>
        <line class="axis" x1="${left}" x2="${W}" y1="${base}" y2="${base}"/>
        <text class="tick" x="${left - 6}" y="${base + 4}" text-anchor="end">0</text>
        ${bars}${ticks}
      </svg>
      <div class="chart-tip" hidden></div>
    </div>`;
}

async function renderStats() {
  const { history = {} } = await browser.storage.local.get('history');
  const byId = new Map(scans.map((s) => [s.id, s]));
  const days30 = lastDays(30);
  const values = days30.map((k) => dayTotal(history, k));
  const sum = (keys) => keys.reduce((a, k) => a + dayTotal(history, k), 0);
  const allDays = Object.keys(history);
  const best = allDays.reduce((b, k) => (dayTotal(history, k) > (b ? dayTotal(history, b) : 0) ? k : b), null);

  // Mangas les plus lus sur 30 jours
  const perScan = {};
  for (const k of days30) for (const [id, n] of Object.entries(history[k] || {})) perScan[id] = (perScan[id] || 0) + n;
  const top = Object.entries(perScan).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const topMax = top[0]?.[1] || 1;

  const statusCounts = Object.entries(STATUSES)
    .map(([k, v]) => [v.label, scans.filter((s) => s.status === k).length])
    .filter(([, n]) => n);
  const totalChapters = scans.reduce((a, s) => a + Math.floor(s.chapter || 0), 0);

  const tile = (value, label) => `<div class="tile"><b>${value}</b><span>${label}</span></div>`;

  $('#stats-content').innerHTML = `
    <div class="tiles">
      ${tile(dayTotal(history, dayKey(new Date())), "aujourd'hui")}
      ${tile(sum(lastDays(7)), '7 derniers jours')}
      ${tile(sum(days30), '30 derniers jours')}
      ${tile(`${streak(history)} j`, 'jours de lecture d’affilée')}
    </div>

    <h3>Chapitres lus par jour <span class="muted-small">— 30 derniers jours</span></h3>
    ${allDays.length ? barChart(days30, values) : '<p class="muted-small">Les statistiques se rempliront au fil de tes lectures.</p>'}
    ${allDays.length ? `
      <details class="stats-table">
        <summary>Voir les chiffres</summary>
        <table>
          <thead><tr><th>Jour</th><th>Chapitres</th></tr></thead>
          <tbody>${days30.slice().reverse().filter((k) => dayTotal(history, k)).map((k) => `<tr><td>${formatDay(k, { weekday: 'long', day: 'numeric', month: 'long' })}</td><td>${dayTotal(history, k)}</td></tr>`).join('')}</tbody>
        </table>
      </details>` : ''}

    ${top.length ? `
      <h3>Les plus lus <span class="muted-small">— 30 derniers jours</span></h3>
      <ol class="top-list">
        ${top.map(([id, n]) => `
          <li>
            <span class="top-title">${escapeHtml(byId.get(id)?.title || 'Scan supprimé')}</span>
            <span class="top-bar"><span style="width:${(n / topMax) * 100}%"></span></span>
            <span class="top-n">${n}</span>
          </li>`).join('')}
      </ol>` : ''}

    <h3>Ta bibliothèque</h3>
    <div class="tiles small">
      ${tile(scans.length, 'scans suivis')}
      ${tile(totalChapters.toLocaleString('fr-FR'), 'chapitres lus au total')}
      ${best ? tile(dayTotal(history, best), `record, le ${formatDay(best, { day: 'numeric', month: 'long' })}`) : ''}
      ${statusCounts.map(([label, n]) => tile(n, label.toLowerCase())).join('')}
    </div>`;
}

// Info-bulle au survol des barres
$('#stats-content').addEventListener('mousemove', (e) => {
  const col = e.target.closest('.col');
  const tip = $('#stats-content .chart-tip');
  if (!tip) return;
  if (!col) {
    tip.hidden = true;
    return;
  }
  const wrap = tip.parentElement.getBoundingClientRect();
  tip.textContent = col.dataset.tip;
  tip.hidden = false;
  const x = Math.min(Math.max(e.clientX - wrap.left, 70), wrap.width - 70);
  tip.style.left = `${x}px`;
  tip.style.top = `${e.clientY - wrap.top - 40}px`;
  $('#stats-content').querySelectorAll('.col').forEach((c) => c.classList.toggle('active', c === col));
});
$('#stats-content').addEventListener('mouseleave', () => {
  const tip = $('#stats-content .chart-tip');
  if (tip) tip.hidden = true;
});

$('#btn-stats').addEventListener('click', async () => {
  await renderStats();
  $('#stats-dialog').showModal();
});
$('#btn-stats-close').addEventListener('click', () => $('#stats-dialog').close());
