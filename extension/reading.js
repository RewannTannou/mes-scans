// Bibliothèque, côté lecture : statuts suggérés, résumé « rattrapage » dans
// l'onglet Nouveautés, et choix de la version d'un scan anime-sama
// (couleur / noir et blanc…).

let historyCache = {}; // historique de lecture, pour estimer ton rythme

// ---------- Statuts suggérés ----------

function renderSuggestions() {
  const el = $('#suggestions');
  const list = scans.map((s) => ({ s, sug: suggestionFor(s) })).filter((x) => x.sug);
  el.hidden = currentTab !== 'all' || !list.length;
  if (el.hidden) return;
  const shown = list.slice(0, 3);
  setHTML(el, `
    <h2>💡 Suggestions</h2>
    ${shown.map(({ s, sug }) => `
      <div class="suggestion" data-id="${s.id}" data-key="${escapeHtml(sug.key)}" data-status="${sug.status}">
        <span><b>${escapeHtml(s.title)}</b> — ${escapeHtml(sug.text)}</span>
        <button class="primary small-btn" data-sug="accept">${escapeHtml(sug.action)}</button>
        <button class="ghost small-btn" data-sug="dismiss" title="Ne plus proposer">Non merci</button>
      </div>`).join('')}
    ${list.length > shown.length ? `<p class="muted-small">et ${list.length - shown.length} autre${list.length - shown.length > 1 ? 's' : ''}…</p>` : ''}`);
}

$('#suggestions').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-sug]');
  if (!btn) return;
  const row = btn.closest('.suggestion');
  const scan = scans.find((s) => s.id === row.dataset.id);
  if (!scan) return;
  if (btn.dataset.sug === 'accept') {
    scan.status = row.dataset.status;
  } else {
    scan.dismissed = [...(scan.dismissed || []), row.dataset.key];
  }
  save();
  render();
});

// ---------- Rattrapage (onglet Nouveautés) ----------

// Chapitres lus par jour en moyenne sur les 30 derniers jours
function readingPace() {
  let total = 0;
  for (let i = 0; i < 30; i++) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    total += Object.values(historyCache[d.toLocaleDateString('sv')] || {}).reduce((a, b) => a + b, 0);
  }
  return total / 30;
}

function renderCatchup() {
  const el = $('#catchup');
  const behind = scans.filter((s) => s.status !== 'done' && s.status !== 'dropped' && unreadCount(s) > 0);
  el.hidden = currentTab !== 'new' || !behind.length;
  if (el.hidden) return;
  const total = behind.reduce((a, s) => a + unreadCount(s), 0);
  const pace = readingPace();
  let eta = '';
  if (pace >= 0.1) {
    const days = Math.ceil(total / pace);
    const when = days <= 1 ? 'en un jour' : days < 14 ? `en ${days} jours` : days < 90 ? `en ${Math.round(days / 7)} semaines` : `en ${Math.round(days / 30)} mois`;
    eta = ` · à ton rythme (${Math.round(pace * 10) / 10} chapitres par jour), tu auras rattrapé ${when}`.replace('.', ',');
  }
  setHTML(el, `🔴 <b>${total} chapitre${total > 1 ? 's' : ''} à lire</b> sur ${behind.length} manga${behind.length > 1 ? 's' : ''} · ${readingTime(total)} de lecture${eta}`);
}

function renderReadingExtras() {
  renderSuggestions();
  renderCatchup();
}

browser.storage.local.get('history').then(({ history = {} }) => {
  historyCache = history;
  renderCatchup();
});
browser.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.history) historyCache = changes.history.newValue || {};
});

// ---------- Version anime-sama ----------

let versionsFor = null; // fiche anime-sama dont les versions sont affichées dans le formulaire

async function loadVersions(scan) {
  const field = $('#version-field');
  const select = form.version;
  field.hidden = true;
  versionsFor = null;
  const parts = splitAnimeSamaLink(scan?.url);
  if (!parts) return;
  let versions = [];
  try {
    versions = await animeSamaVersions(parts.catalogue);
  } catch {
    return; // site indisponible : on garde le lien tel quel
  }
  if (versions.length < 2 || editingId !== scan.id) return; // rien à choisir, ou formulaire fermé entre-temps
  versionsFor = parts.catalogue;
  setOptions(select, versions.map((v) => [v.path, v.name]));
  select.value = versions.some((v) => v.path === parts.path) ? parts.path : versions[0].path;
  field.hidden = false;
}

// Lien de la version choisie, si elle diffère du lien saisi (sinon null)
function chosenVersionUrl(url) {
  if (!versionsFor || $('#version-field').hidden) return null;
  const parts = splitAnimeSamaLink(url);
  if (!parts || parts.catalogue !== versionsFor || parts.path === form.version.value) return null;
  return `${versionsFor}${form.version.value}/`;
}

// reading.js est chargé après le premier affichage : on complète tout de suite
renderReadingExtras();
