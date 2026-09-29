const $ = (sel) => document.querySelector(sel);

let scans = [];
let currentTab = 'all';
let editingId = null;

function save() {
  return saveScans(scans);
}

// Si l'extension met à jour un chapitre pendant que la page est ouverte,
// on rafraîchit l'affichage.
browser.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes[STORAGE_KEY]) {
    scans = changes[STORAGE_KEY].newValue || [];
    render();
  }
});

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

const hasNew = (s) => unreadCount(s) > 0 && s.status !== 'done' && s.status !== 'dropped';

function renderTabs() {
  const counts = { all: scans.length, new: scans.filter(hasNew).length };
  for (const s of scans) counts[s.status] = (counts[s.status] || 0) + 1;
  const tabs = [['all', 'Tous'], ['new', '🔴 Nouveautés'], ...Object.entries(STATUSES).map(([k, v]) => [k, v.label])];
  $('#tabs').innerHTML = tabs
    .map(([key, label]) => `<button data-tab="${key}" class="${key === currentTab ? 'active' : ''}">${label}<span class="count">${counts[key] || 0}</span></button>`)
    .join('');
}

function renderSiteFilter() {
  const select = $('#filter-site');
  const current = select.value;
  const sites = [...new Set(scans.flatMap((s) => scanLinks(s).map(siteName)).filter(Boolean))].sort();
  select.innerHTML = '<option value="">Tous les sites</option>' + sites.map((s) => `<option>${escapeHtml(s)}</option>`).join('');
  select.value = sites.includes(current) ? current : '';
  $('#btn-rename-site').hidden = !select.value;
}

const onSite = (s, site) => scanLinks(s).some((l) => siteName(l) === site);

function visibleScans() {
  const q = $('#search').value.trim().toLowerCase();
  const site = $('#filter-site').value;
  const sort = $('#sort').value;
  return scans
    .filter((s) => currentTab === 'all' || (currentTab === 'new' ? hasNew(s) : s.status === currentTab))
    .filter((s) => !q || s.title.toLowerCase().includes(q))
    .filter((s) => !site || onSite(s, site))
    .sort((a, b) => {
      if (sort === 'title') return a.title.localeCompare(b.title, 'fr');
      if (sort === 'added') return b.createdAt.localeCompare(a.createdAt);
      if (sort === 'unread') return (unreadCount(b) ?? -1) - (unreadCount(a) ?? -1);
      return (b.lastRead || '').localeCompare(a.lastRead || '');
    });
}

// « ● Terminé · 268 ch. » d'après AniList
function pubLine(s) {
  const pub = PUB_STATUSES[s.pub?.status];
  if (!pub) return '';
  const chapters = s.pub.chapters ? ` · ${s.pub.chapters} ch.` : '';
  return `<span class="pub" style="color:${pub.color}" title="Parution du manga (AniList)">${pub.label}${chapters}</span>`;
}

function renderCard(s) {
  const st = STATUSES[s.status];
  const site = siteName(s.url);
  const others = scanLinks(s).slice(1).map(siteName);
  const sitesTitle = [site, ...others].join(', ');
  const unread = unreadCount(s);
  const unreadPill = unread === null ? ''
    : unread > 0 ? `<span class="unread">${unread} à lire</span>`
    : '<span class="unread uptodate">✓ À jour</span>';
  const cover = s.cover
    ? `<img src="${escapeHtml(s.cover)}" alt="" loading="lazy" referrerpolicy="no-referrer" data-initials="${escapeHtml(initials(s.title))}">`
    : `<span class="initials">${escapeHtml(initials(s.title))}</span>`;
  return `
    <article class="card" data-id="${s.id}">
      <div class="cover" data-action="edit">
        ${cover}
        <span class="status" style="color:${st.color}">${st.label}</span>
        ${unreadPill}
        <button class="edit" data-action="edit" title="Modifier">✏️</button>
      </div>
      <div class="body">
        <h3 class="title" title="${escapeHtml(s.title)}">${escapeHtml(s.title)}</h3>
        ${pubLine(s)}
        <div class="meta">
          <span class="site" title="${escapeHtml(sitesTitle)}">${site ? escapeHtml(site) : 'aucun site'}${others.length ? ` <b>+${others.length}</b>` : ''}</span>
          <span>${timeAgo(s.lastRead)}</span>
        </div>
        <div class="chapter">
          <button data-action="dec" title="Chapitre précédent">−</button>
          <span>Ch. ${formatChapter(s.chapter)}${s.latest != null ? `<span class="total"> / ${formatChapter(s.latest)}</span>` : ''}</span>
          <button data-action="inc" title="Chapitre suivant">+</button>
        </div>
        <button class="read" data-action="read" ${s.url ? '' : 'disabled'}>${s.url ? 'Lire ▸' : 'Pas de lien'}</button>
      </div>
    </article>`;
}

// Les 5 derniers scans « En cours » lus, en grand, pour reprendre en un clic
function renderResume() {
  const filtered = currentTab !== 'all' || $('#search').value.trim() || $('#filter-site').value;
  const recent = scans
    .filter((s) => s.status === 'reading' && s.lastRead && s.url)
    .sort((a, b) => b.lastRead.localeCompare(a.lastRead))
    .slice(0, 5);
  $('#resume').hidden = filtered || !recent.length;
  $('#resume-row').innerHTML = recent
    .map((s) => {
      const unread = unreadCount(s);
      const thumb = s.cover
        ? `<img src="${escapeHtml(s.cover)}" alt="" referrerpolicy="no-referrer" data-initials="${escapeHtml(initials(s.title))}">`
        : `<span class="initials">${escapeHtml(initials(s.title))}</span>`;
      return `
        <article class="resume-item card" data-id="${s.id}">
          <div class="resume-thumb">${thumb}</div>
          <div class="resume-body">
            <h3 class="title" title="${escapeHtml(s.title)}">${escapeHtml(s.title)}</h3>
            <p class="muted-small">Ch. ${formatChapter(s.chapter)} · ${timeAgo(s.lastRead)}${unread > 0 ? ` · <b class="accent">${unread} à lire</b>` : ''}</p>
            <button class="read" data-action="read">Continuer ▸</button>
          </div>
        </article>`;
    })
    .join('');
}

function render() {
  renderTabs();
  renderSiteFilter();
  renderResume();
  const list = visibleScans();
  $('#grid').innerHTML = list.map(renderCard).join('');
  $('#empty').hidden = list.length > 0;
}

// Couverture introuvable : on affiche les initiales à la place.
// (Les extensions interdisent les onerror="" dans le HTML, d'où l'écouteur ici.)
const onImageError = (e) => {
  const img = e.target;
  if (img.tagName !== 'IMG') return;
  const span = document.createElement('span');
  span.className = 'initials';
  span.textContent = img.dataset.initials;
  img.replaceWith(span);
};
$('#grid').addEventListener('error', onImageError, true);
$('#resume-row').addEventListener('error', onImageError, true);

// ---------- Actions ----------

function update(id, changes) {
  Object.assign(scans.find((x) => x.id === id), changes);
  save();
  render();
}

const onCardClick = (e) => {
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
      browser.tabs.create({ url: chapterUrl(s) });
      update(id, { lastRead: new Date().toISOString(), status: s.status === 'plan' ? 'reading' : s.status });
      break;
    case 'edit':
      openForm(s);
      break;
  }
};
$('#grid').addEventListener('click', onCardClick);
$('#resume-row').addEventListener('click', onCardClick);

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
  form.altUrls.value = (scan?.altUrls || []).map((l) => l.replace('{ch}', formatChapter(scan.chapter))).join('\n');
  form.chapter.value = scan ? scan.chapter : 1;
  form.status.value = scan ? scan.status : 'reading';
  form.cover.value = scan ? scan.cover : '';
  form.anilist.value = scan?.pub?.url || '';
  const hint = $('#anilist-hint');
  hint.innerHTML = scan?.pub?.url
    ? `Trouvé : <a href="${escapeHtml(scan.pub.url)}" target="_blank">${escapeHtml(scan.pub.title || 'fiche AniList')}</a>. Si ce n'est pas le bon manga, colle ici le lien de la bonne fiche.`
    : scan?.pub?.checkedAt ? 'Aucune fiche trouvée pour ce titre : colle le lien de la fiche AniList.' : '';
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

  // Lien (ou titre) déjà dans la liste : on propose d'ouvrir le scan existant
  if (!editingId) {
    const existing = (url && matchScan(scans, url)?.scan) || findByTitle(scans, form.title.value);
    if (existing && confirm(`Tu suis déjà « ${existing.title} » (ch. ${formatChapter(existing.chapter)}).\n\nOK : ouvrir ce scan\nAnnuler : l'ajouter quand même`)) {
      openForm(existing);
      return;
    }
  }

  const altUrls = form.altUrls.value
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => detectChapter(l)?.template || l);
  const data = {
    title: form.title.value.trim(),
    url: detected ? detected.template : url,
    altUrls,
    chapter: parseFloat(form.chapter.value) || 0,
    status: form.status.value,
    cover: form.cover.value.trim(),
  };
  // Fiche AniList changée à la main : on la recharge (l'extension s'en occupe)
  const anilistId = anilistIdFromUrl(form.anilist.value.trim());
  const current = editingId && scans.find((s) => s.id === editingId);
  if (anilistId && anilistId !== current?.pub?.id) data.pub = { id: anilistId, checkedAt: null };

  if (editingId) {
    Object.assign(current, data);
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

$('#btn-export').addEventListener('click', async () => {
  const { history = {} } = await browser.storage.local.get('history');
  const blob = new Blob([JSON.stringify({ scans, history }, null, 2)], { type: 'application/json' });
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
    // Ancien format : juste la liste ; nouveau : { scans, history }
    const data = JSON.parse(await file.text());
    const imported = Array.isArray(data) ? data : data.scans;
    if (!Array.isArray(imported)) throw new Error();
    if (!confirm(`Importer ${imported.length} scans ? Ta liste actuelle sera remplacée.`)) return;
    scans = imported;
    if (data.history) await browser.storage.local.set({ history: data.history });
    save();
    render();
  } catch {
    alert("Ce fichier n'est pas une sauvegarde valide.");
  } finally {
    e.target.value = '';
  }
});

// ---------- Nouveaux chapitres ----------

async function renderLastCheck() {
  const { lastCheck } = await browser.storage.local.get('lastCheck');
  $('#last-check').textContent = lastCheck ? `Dernière vérification : ${timeAgo(lastCheck)}` : '';
}

$('#btn-check').addEventListener('click', async () => {
  const btn = $('#btn-check');
  btn.disabled = true;
  btn.textContent = '⏳ Vérification…';
  try {
    await browser.runtime.sendMessage({ type: 'checkNow' });
  } finally {
    btn.disabled = false;
    btn.textContent = '🔄 Vérifier les sorties';
    renderLastCheck();
  }
});

$('#notify').addEventListener('change', async (e) => {
  saveSettings({ ...(await loadSettings()), notify: e.target.checked });
});

$('#backup').addEventListener('change', async (e) => {
  saveSettings({ ...(await loadSettings()), backup: e.target.checked });
  if (e.target.checked) browser.runtime.sendMessage({ type: 'backupNow' });
});

loadSettings().then((settings) => {
  $('#notify').checked = settings.notify;
  $('#backup').checked = settings.backup;
});

// ---------- Changement de domaine ----------

$('#btn-rename-site').addEventListener('click', () => {
  const from = $('#filter-site').value;
  const to = prompt(`Nouvelle adresse du site « ${from} » :
(ex : anime-sama.fr)`, from)?.trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  if (!to || to === from) return;
  renameHost(scans, from, to);
  save();
  $('#filter-site').value = to.replace(/^www\./, '');
  render();
});
renderLastCheck();

// Promesse utilisée par releases.js pour attendre la liste des scans
const scansReady = loadScans().then((data) => {
  scans = data;
  render();
});
