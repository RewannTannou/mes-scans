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

// Plus longue série de jours consécutifs avec au moins un chapitre lu
function bestStreak(history) {
  const days = Object.keys(history).filter((k) => dayTotal(history, k) > 0).sort();
  let best = 0;
  let run = 0;
  let prev = null;
  for (const key of days) {
    const d = new Date(`${key}T12:00:00`);
    run = prev && Math.round((d - prev) / 86400000) === 1 ? run + 1 : 1;
    best = Math.max(best, run);
    prev = d;
  }
  return best;
}

// Calendrier de l'année (façon GitHub) : une case par jour, une colonne par semaine.
// Une seule teinte, de plus en plus soutenue selon le nombre de chapitres lus.
function yearHeatmap(history) {
  const cell = 12;
  const gap = 3;
  const today = new Date();
  const start = new Date(today);
  start.setDate(start.getDate() - 364);
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7)); // commence un lundi
  const values = [];
  for (let d = new Date(start); d <= today; d.setDate(d.getDate() + 1)) values.push({ key: dayKey(d), n: dayTotal(history, dayKey(d)) });
  const max = Math.max(1, ...values.map((v) => v.n));
  const level = (n) => (n === 0 ? 0 : Math.min(4, Math.ceil((n / max) * 4)));
  const weeks = Math.ceil(values.length / 7);
  const left = 26;
  const top = 16;
  let months = '';
  let lastMonth = -1;
  let lastLabelWeek = -10; // un nom de mois au plus toutes les 3 semaines, pour qu'ils ne se chevauchent pas
  const cells = values
    .map((v, i) => {
      const week = Math.floor(i / 7);
      const x = left + week * (cell + gap);
      const y = top + (i % 7) * (cell + gap);
      const month = new Date(`${v.key}T12:00:00`).getMonth();
      if (i % 7 === 0 && month !== lastMonth) {
        lastMonth = month;
        if (week - lastLabelWeek < 3) return rect();
        lastLabelWeek = week;
        months += `<text class="tick" x="${x}" y="10">${new Date(`${v.key}T12:00:00`).toLocaleDateString('fr-FR', { month: 'short' })}</text>`;
      }
      return rect();
      function rect() {
        const label = `${formatDay(v.key, { weekday: 'short', day: 'numeric', month: 'short' })} : ${v.n} chapitre${v.n > 1 ? 's' : ''}`;
        return `<rect class="hm l${level(v.n)}" x="${x}" y="${y}" width="${cell}" height="${cell}" rx="3" data-tip="${escapeHtml(label)}"/>`;
      }
    })
    .join('');
  const width = left + weeks * (cell + gap);
  const height = top + 7 * (cell + gap);
  const dayLabels = ['lun', 'mer', 'ven'].map((d, i) => `<text class="tick" x="0" y="${top + (i * 2) * (cell + gap) + 10}">${d}</text>`).join('');
  return `
    <div class="chart-wrap heatmap-wrap">
      <svg viewBox="0 0 ${width} ${height}" class="chart heatmap" role="img" aria-label="Chapitres lus chaque jour sur les 12 derniers mois">${months}${dayLabels}${cells}</svg>
      <div class="chart-tip" hidden></div>
      <p class="hm-legend">Moins ${[0, 1, 2, 3, 4].map((l) => `<span class="hm-swatch l${l}"></span>`).join('')} Plus</p>
    </div>`;
}

// Succès : [icône, nom, description, débloqué ?]
function achievements(history) {
  const totalChapters = scans.reduce((a, s) => a + Math.floor(s.chapter || 0), 0);
  const done = scans.filter((s) => s.status === 'done').length;
  const sites = new Set(scans.flatMap((s) => scanLinks(s).map(siteName)).filter(Boolean)).size;
  const upToDate = scans.filter((s) => s.status === 'reading' && unreadCount(s) === 0).length;
  const bestDay = Math.max(0, ...Object.keys(history).map((k) => dayTotal(history, k)));
  const favorites = scans.filter((s) => s.favorite).length;
  return [
    ['📖', 'Lecteur', '100 chapitres lus', totalChapters >= 100],
    ['📚', 'Dévoreur', '1 000 chapitres lus', totalChapters >= 1000],
    ['🏆', 'Légende', '5 000 chapitres lus', totalChapters >= 5000],
    ['🏛️', 'Bibliothécaire', '20 mangas suivis', scans.length >= 20],
    ['✅', 'Finisseur', '5 séries terminées', done >= 5],
    ['🔥', 'Assidu', '7 jours de lecture d’affilée', bestStreak(history) >= 7],
    ['⚡', 'Marathon', '30 chapitres en un jour', bestDay >= 30],
    ['🧭', 'Explorateur', 'Lire sur 3 sites différents', sites >= 3],
    ['🎯', 'À jour', '5 séries en cours sans retard', upToDate >= 5],
    ['⭐', 'Coups de cœur', '5 favoris', favorites >= 5],
  ];
}

// Chapitres lus par genre (d'après les genres AniList de tes mangas)
function genreBreakdown() {
  const perGenre = {};
  for (const s of scans) for (const g of s.pub?.genres || []) perGenre[g] = (perGenre[g] || 0) + Math.floor(s.chapter || 0);
  return Object.entries(perGenre).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]).slice(0, 8);
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
  const genres = genreBreakdown();
  const unlocked = achievements(history);

  const tile = (value, label) => `<div class="tile"><b>${value}</b><span>${label}</span></div>`;

  setHTML($('#stats-content'), `
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
    </div>

    <h3>Ton année de lecture <span class="muted-small">— meilleure série : ${bestStreak(history)} jour${bestStreak(history) > 1 ? 's' : ''} d'affilée</span></h3>
    ${yearHeatmap(history)}

    ${genres.length ? `
      <h3>Tes genres <span class="muted-small">— chapitres lus par genre</span></h3>
      <ol class="top-list">
        ${genres.map(([g, n]) => `
          <li>
            <span class="top-title">${escapeHtml(g)}</span>
            <span class="top-bar"><span style="width:${(n / genres[0][1]) * 100}%"></span></span>
            <span class="top-n">${n.toLocaleString('fr-FR')}</span>
          </li>`).join('')}
      </ol>` : ''}

    <h3>Succès <span class="muted-small">— ${unlocked.filter((a) => a[3]).length} / ${unlocked.length} débloqués</span></h3>
    <div class="badges">
      ${unlocked.map(([icon, name, desc, ok]) => `
        <div class="badge ${ok ? 'on' : ''}" title="${escapeHtml(desc)}">
          <span class="badge-icon">${icon}</span>
          <b>${escapeHtml(name)}</b>
          <span>${escapeHtml(desc)}</span>
        </div>`).join('')}
    </div>`);
}

// Info-bulle au survol des barres et des cases du calendrier
$('#stats-content').addEventListener('mousemove', (e) => {
  const col = e.target.closest('[data-tip]');
  $('#stats-content').querySelectorAll('.chart-tip').forEach((t) => (t.hidden = true));
  const tip = col?.closest('.chart-wrap')?.querySelector('.chart-tip');
  if (!col || !tip) return;
  const wrap = tip.parentElement.getBoundingClientRect();
  tip.textContent = col.dataset.tip;
  tip.hidden = false;
  const x = Math.min(Math.max(e.clientX - wrap.left, 70), wrap.width - 70);
  tip.style.left = `${x}px`;
  tip.style.top = `${e.clientY - wrap.top - 40}px`;
  $('#stats-content').querySelectorAll('.col').forEach((c) => c.classList.toggle('active', c === col));
});
$('#stats-content').addEventListener('mouseleave', () => {
  $('#stats-content').querySelectorAll('.chart-tip').forEach((t) => (t.hidden = true));
});

$('#btn-stats').addEventListener('click', async () => {
  await renderStats();
  $('#stats-dialog').showModal();
});
$('#btn-stats-close').addEventListener('click', () => $('#stats-dialog').close());
