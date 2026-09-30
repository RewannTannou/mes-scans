// Onglet « Dernières sorties » : le journal des nouveaux chapitres détectés
// (enregistré par background.js dans releases = [{ id, from, to, link, at }, …]),
// affiché en liste ou en catalogue, regroupé par jour.

let releases = [];
let layout = 'list';

// Petites préférences d'affichage propres à ce navigateur (vue, liste/catalogue)
const pref = {
  get: (key, fallback) => {
    try {
      return localStorage.getItem(`mes-scans:${key}`) ?? fallback;
    } catch {
      return fallback;
    }
  },
  set: (key, value) => {
    try {
      localStorage.setItem(`mes-scans:${key}`, value);
    } catch {
      // stockage indisponible : la préférence ne sera simplement pas retenue
    }
  },
};

function dayLabel(iso) {
  const d = new Date(iso);
  const key = d.toLocaleDateString('sv');
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  if (key === new Date().toLocaleDateString('sv')) return "Aujourd'hui";
  if (key === yesterday.toLocaleDateString('sv')) return 'Hier';
  const recent = Date.now() - d < 7 * 86400000;
  return d.toLocaleDateString('fr-FR', recent ? { weekday: 'long', day: 'numeric', month: 'long' } : { day: 'numeric', month: 'long', year: 'numeric' });
}

const timeLabel = (iso) => new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

function coverHtml(scan) {
  return scan.cover
    ? `<img src="${escapeHtml(scan.cover)}" alt="" loading="lazy" referrerpolicy="no-referrer" data-initials="${escapeHtml(initials(scan.title))}">`
    : `<span class="initials">${escapeHtml(initials(scan.title))}</span>`;
}

function releaseItem(r, scan, index) {
  const unread = isUnread(r, scan);
  const state = unread ? '<span class="rel-new">Nouveau</span>' : '<span class="rel-read">✓ Lu</span>';
  const site = escapeHtml(siteName(r.link || scan.url));

  if (layout === 'catalog') {
    return `
      <article class="rel-card card ${unread ? '' : 'is-read'}" data-release="${index}">
        <div class="cover">
          ${coverHtml(scan)}
          <span class="rel-badge">${escapeHtml(chaptersLabel(r).replace('Chapitres ', 'Ch. ').replace('Chapitre ', 'Ch. '))}</span>
        </div>
        <div class="body">
          <h3 class="title" title="${escapeHtml(scan.title)}">${escapeHtml(scan.title)}</h3>
          <div class="meta"><span class="site">${site}</span><span>${timeLabel(r.at)}</span></div>
          <div class="rel-foot">${state}<button class="read small-read" data-action="open">Lire ▸</button></div>
        </div>
      </article>`;
  }

  return `
    <article class="rel-row ${unread ? '' : 'is-read'}" data-release="${index}">
      <div class="rel-thumb">${coverHtml(scan)}</div>
      <div class="rel-info">
        <h3 class="title" title="${escapeHtml(scan.title)}">${escapeHtml(scan.title)}</h3>
        <p><b>${escapeHtml(chaptersLabel(r))}</b> · ${site} · ${timeLabel(r.at)}</p>
        <p class="muted-small">Tu en es au chapitre ${formatChapter(scan.chapter)}${unread && scan.latest != null ? ` · ${unreadCount(scan)} à lire` : ''}</p>
      </div>
      ${state}
      <button class="read small-read" data-action="open">Lire ▸</button>
    </article>`;
}

function renderReleases() {
  const byId = new Map(scans.map((s) => [s.id, s]));
  const hideRead = $('#hide-read').checked;
  // On oublie les sorties des scans supprimés depuis
  const visible = releases
    .map((r, index) => ({ r, index, scan: byId.get(r.id) }))
    .filter(({ r, scan }) => scan && (!hideRead || isUnread(r, scan)));

  // Compteur sur l'onglet : sorties pas encore lues
  const unreadCountAll = releases.filter((r) => byId.has(r.id) && isUnread(r, byId.get(r.id))).length;
  $('#releases-count').textContent = unreadCountAll;
  $('#releases-count').hidden = !unreadCountAll;

  document.querySelectorAll('#release-layout button').forEach((b) => b.classList.toggle('active', b.dataset.layout === layout));

  if (!visible.length) {
    $('#releases').innerHTML = `
      <p class="empty">${releases.length
        ? 'Tu as lu toutes les dernières sorties 🎉'
        : "Aucune sortie détectée pour l'instant.<br>Les nouveaux chapitres de tes scans apparaîtront ici dès leur sortie (vérification toutes les heures)."}</p>`;
    return;
  }

  // Regroupement par jour, dans l'ordre du journal (plus récent d'abord)
  const groups = [];
  for (const item of visible) {
    const label = dayLabel(item.r.at);
    if (groups.at(-1)?.label !== label) groups.push({ label, items: [] });
    groups.at(-1).items.push(item);
  }

  $('#releases').innerHTML = groups
    .map(({ label, items }) => `
      <section class="rel-day">
        <h2>${escapeHtml(label)} <span class="muted-small">${items.length} sortie${items.length > 1 ? 's' : ''}</span></h2>
        <div class="${layout === 'catalog' ? 'grid' : 'rel-list'}">
          ${items.map(({ r, scan, index }) => releaseItem(r, scan, index)).join('')}
        </div>
      </section>`)
    .join('');
}

// ---------- Actions ----------

$('#releases').addEventListener('click', (e) => {
  const item = e.target.closest('[data-release]');
  if (!item) return;
  const r = releases[Number(item.dataset.release)];
  const scan = scans.find((s) => s.id === r?.id);
  if (!scan) return;
  if (e.target.closest('[data-action="open"]') || layout === 'catalog' || e.target.closest('.rel-thumb, .rel-info')) {
    browser.tabs.create({ url: releaseUrl(r, scan) });
  }
});
$('#releases').addEventListener('error', onImageError, true);

$('#release-layout').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-layout]');
  if (!btn) return;
  layout = btn.dataset.layout;
  pref.set('layout', layout);
  renderReleases();
});

$('#hide-read').addEventListener('change', () => {
  pref.set('hideRead', $('#hide-read').checked ? '1' : '');
  renderReleases();
});

// ---------- Bibliothèque / Dernières sorties ----------

const VIEWS = ['library', 'releases', 'planning', 'discover'];

function showView(view) {
  if (!VIEWS.includes(view)) view = 'library';
  for (const v of VIEWS) $(`#view-${v}`).hidden = v !== view;
  // La barre « Vérifier les sorties » ne concerne pas « Découvrir »
  $('.check-bar').hidden = view === 'discover' || view === 'planning';
  document.querySelectorAll('#views button').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
  pref.set('view', view);
  if (view === 'releases') renderReleases();
  if (view === 'discover' && typeof renderDiscover === 'function') renderDiscover();
  if (view === 'planning' && typeof renderPlanning === 'function') renderPlanning();
}

$('#views').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-view]');
  if (btn) showView(btn.dataset.view);
});

// Nouvelle sortie ou chapitre lu pendant que la page est ouverte
browser.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.releases) releases = changes.releases.newValue || [];
  if (changes.releases || changes[STORAGE_KEY]) renderReleases();
});

(async () => {
  layout = pref.get('layout', 'list');
  $('#hide-read').checked = pref.get('hideRead', '') === '1';
  ({ releases = [] } = await browser.storage.local.get('releases'));
  // Attendre que la bibliothèque ait chargé la liste des scans
  await scansReady;
  showView(pref.get('view', 'library'));
  renderReleases();
})();
