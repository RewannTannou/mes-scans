const STORAGE_KEY = 'mes-scans-v1';

const STATUSES = {
  reading: { label: 'En cours', color: 'var(--reading)' },
  plan:    { label: 'À lire',   color: 'var(--plan)' },
  paused:  { label: 'En pause', color: 'var(--paused)' },
  done:    { label: 'Terminé',  color: 'var(--done)' },
  dropped: { label: 'Abandonné', color: 'var(--dropped)' },
};

const $ = (sel) => document.querySelector(sel);

let scans = load();
let currentTab = 'all';
let editingId = null;

// ---------- Stockage ----------

function load() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
  } catch {
    return [];
  }
}

function save() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(scans));
}

// ---------- Liens de chapitre ----------

// Trouve le numéro de chapitre dans une URL et renvoie un modèle avec {ch}
// pour que le bouton « Lire » suive automatiquement le chapitre actuel.
// Ex : https://site.com/one-piece/chapitre-1100/  ->  https://site.com/one-piece/chapitre-{ch}/
function detectChapter(url) {
  if (!url) return null;
  const keyword = /(chap(?:ter|itre)?|ch|episode|ep|scan)([-_/.\s]*)(\d+(?:[.,]\d+)?)(?![A-Za-z0-9])/i;
  let m = url.match(keyword);
  if (m) {
    const start = m.index + m[1].length + m[2].length;
    return { num: parseFloat(m[3].replace(',', '.')), template: url.slice(0, start) + '{ch}' + url.slice(start + m[3].length) };
  }
  // Sinon : dernier segment du chemin entièrement numérique (ex : /one-piece/1100/)
  m = url.match(/\/(\d+(?:\.\d+)?)\/?(?:[?#].*)?$/);
  if (m) {
    const start = m.index + 1;
    return { num: parseFloat(m[1]), template: url.slice(0, start) + '{ch}' + url.slice(start + m[1].length) };
  }
  return null;
}

function chapterUrl(scan) {
  if (!scan.url) return '';
  return scan.url.replace('{ch}', formatChapter(scan.chapter));
}

function siteName(url) {
  try {
    return new URL(url.replace('{ch}', '0')).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

function formatChapter(n) {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 10) / 10);
}

// ---------- Rendu ----------

function timeAgo(iso) {
  if (!iso) return 'jamais lu';
  const diff = (Date.now() - new Date(iso)) / 1000;
  if (diff < 60) return "à l'instant";
  if (diff < 3600) return `il y a ${Math.floor(diff / 60)} min`;
  if (diff < 86400) return `il y a ${Math.floor(diff / 3600)} h`;
  const days = Math.floor(diff / 86400);
  if (days < 30) return `il y a ${days} j`;
  return new Date(iso).toLocaleDateString('fr-FR');
}

function initials(title) {
  return title.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function renderTabs() {
  const counts = { all: scans.length };
  for (const s of scans) counts[s.status] = (counts[s.status] || 0) + 1;
  const tabs = [['all', 'Tous'], ...Object.entries(STATUSES).map(([k, v]) => [k, v.label])];
  $('#tabs').innerHTML = tabs
    .map(([key, label]) => `<button data-tab="${key}" class="${key === currentTab ? 'active' : ''}">${label}<span class="count">${counts[key] || 0}</span></button>`)
    .join('');
}

function renderSiteFilter() {
  const select = $('#filter-site');
  const current = select.value;
  const sites = [...new Set(scans.map((s) => siteName(s.url)).filter(Boolean))].sort();
  select.innerHTML = '<option value="">Tous les sites</option>' + sites.map((s) => `<option>${escapeHtml(s)}</option>`).join('');
  select.value = sites.includes(current) ? current : '';
}

function visibleScans() {
  const q = $('#search').value.trim().toLowerCase();
  const site = $('#filter-site').value;
  const sort = $('#sort').value;
  return scans
    .filter((s) => currentTab === 'all' || s.status === currentTab)
    .filter((s) => !q || s.title.toLowerCase().includes(q))
    .filter((s) => !site || siteName(s.url) === site)
    .sort((a, b) => {
      if (sort === 'title') return a.title.localeCompare(b.title, 'fr');
      if (sort === 'added') return b.createdAt.localeCompare(a.createdAt);
      return (b.lastRead || '').localeCompare(a.lastRead || '');
    });
}

function renderCard(s) {
  const st = STATUSES[s.status];
  const site = siteName(s.url);
  const cover = s.cover
    ? `<img src="${escapeHtml(s.cover)}" alt="" loading="lazy" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'initials',textContent:'${escapeHtml(initials(s.title))}'}))">`
    : `<span class="initials">${escapeHtml(initials(s.title))}</span>`;
  return `
    <article class="card" data-id="${s.id}">
      <div class="cover" data-action="edit">
        ${cover}
        <span class="status" style="color:${st.color}">${st.label}</span>
        <button class="edit" data-action="edit" title="Modifier">✏️</button>
      </div>
      <div class="body">
        <h3 class="title" title="${escapeHtml(s.title)}">${escapeHtml(s.title)}</h3>
        <div class="meta">
          <span class="site">${site ? escapeHtml(site) : 'aucun site'}</span>
          <span>${timeAgo(s.lastRead)}</span>
        </div>
        <div class="chapter">
          <button data-action="dec" title="Chapitre précédent">−</button>
          <span>Ch. ${formatChapter(s.chapter)}</span>
          <button data-action="inc" title="Chapitre suivant">+</button>
        </div>
        <button class="read" data-action="read" ${s.url ? '' : 'disabled'}>${s.url ? 'Lire ▸' : 'Pas de lien'}</button>
      </div>
    </article>`;
}

function render() {
  renderTabs();
  renderSiteFilter();
  const list = visibleScans();
  $('#grid').innerHTML = list.map(renderCard).join('');
  $('#empty').hidden = list.length > 0;
}

// ---------- Actions ----------

function update(id, changes) {
  const s = scans.find((x) => x.id === id);
  Object.assign(s, changes);
  save();
  render();
}

$('#grid').addEventListener('click', (e) => {
  const actionEl = e.target.closest('[data-action]');
  if (!actionEl) return;
  const id = actionEl.closest('.card').dataset.id;
  const s = scans.find((x) => x.id === id);
  switch (actionEl.dataset.action) {
    case 'inc':
      update(id, { chapter: s.chapter + 1, lastRead: new Date().toISOString() });
      break;
    case 'dec':
      update(id, { chapter: Math.max(0, s.chapter - 1) });
      break;
    case 'read':
      window.open(chapterUrl(s), '_blank', 'noopener');
      update(id, { lastRead: new Date().toISOString(), status: s.status === 'plan' ? 'reading' : s.status });
      break;
    case 'edit':
      openForm(s);
      break;
  }
});

$('#tabs').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-tab]');
  if (!btn) return;
  currentTab = btn.dataset.tab;
  render();
});

$('#search').addEventListener('input', render);
$('#filter-site').addEventListener('change', render);
$('#sort').addEventListener('change', render);

// ---------- Formulaire ----------

const form = $('#form');
const dialog = $('#dialog');
form.status.innerHTML = Object.entries(STATUSES).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join('');

function openForm(scan = null) {
  editingId = scan ? scan.id : null;
  $('#form-title').textContent = scan ? 'Modifier le scan' : 'Ajouter un scan';
  $('#btn-delete').hidden = !scan;
  form.title.value = scan ? scan.title : '';
  form.url.value = scan ? chapterUrl(scan) : '';
  form.chapter.value = scan ? scan.chapter : 1;
  form.status.value = scan ? scan.status : 'reading';
  form.cover.value = scan ? scan.cover : '';
  updateUrlHint();
  dialog.showModal();
  form.title.focus();
}

function updateUrlHint() {
  const hint = $('#url-hint');
  const url = form.url.value.trim();
  if (!url) { hint.textContent = ''; return; }
  const d = detectChapter(url);
  if (d) {
    hint.className = 'hint';
    hint.textContent = `✓ Chapitre ${formatChapter(d.num)} détecté : le bouton « Lire » ouvrira toujours ton chapitre actuel.`;
  } else {
    hint.className = 'hint warn';
    hint.textContent = 'Aucun numéro de chapitre trouvé : le bouton « Lire » ouvrira ce lien tel quel.';
  }
}

form.url.addEventListener('input', () => {
  const d = detectChapter(form.url.value.trim());
  if (d) form.chapter.value = d.num;
  updateUrlHint();
});

form.addEventListener('submit', (e) => {
  e.preventDefault();
  const url = form.url.value.trim();
  const detected = detectChapter(url);
  const data = {
    title: form.title.value.trim(),
    url: detected ? detected.template : url,
    chapter: parseFloat(form.chapter.value) || 0,
    status: form.status.value,
    cover: form.cover.value.trim(),
  };
  if (editingId) {
    Object.assign(scans.find((s) => s.id === editingId), data);
  } else {
    scans.push({ id: crypto.randomUUID(), createdAt: new Date().toISOString(), lastRead: null, ...data });
  }
  save();
  render();
  dialog.close();
});

$('#btn-cancel').addEventListener('click', () => dialog.close());
$('#btn-add').addEventListener('click', () => openForm());

$('#btn-delete').addEventListener('click', () => {
  const s = scans.find((x) => x.id === editingId);
  if (!confirm(`Supprimer « ${s.title} » ?`)) return;
  scans = scans.filter((x) => x.id !== editingId);
  save();
  render();
  dialog.close();
});

// ---------- Sauvegarde ----------

$('#btn-export').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(scans, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `mes-scans-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
});

$('#input-import').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (!Array.isArray(data)) throw new Error();
    if (!confirm(`Importer ${data.length} scans ? Ta liste actuelle sera remplacée.`)) return;
    scans = data;
    save();
    render();
  } catch {
    alert("Ce fichier n'est pas une sauvegarde valide.");
  } finally {
    e.target.value = '';
  }
});

render();
