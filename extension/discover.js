// Onglet « Découvrir » : recherche AniList, recommandations d'après tes mangas,
// tendances du moment, import d'une liste AniList. Un manga ajouté d'ici est
// ensuite cherché sur anime-sama par l'arrière-plan (background.js).

let discoverQuery = '';
let discoverResults = null; // résultats de la recherche en cours
let discoverCache = null; // { recs, trending } : chargés une fois par ouverture de la page
let discoverLoading = null;
const searchingSite = new Set(); // scans ajoutés dont on attend la recherche sur anime-sama

// ---------- Petits messages ----------

let toastTimer = null;
function toast(message, duration = 4000) {
  const el = $('#toast');
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), duration);
}

// ---------- Rendu ----------

function formatLabel(media) {
  if (media.format === 'NOVEL') return 'Roman';
  if (media.format === 'ONE_SHOT') return 'One shot';
  return { KR: 'Manhwa', CN: 'Manhua', TW: 'Manhua' }[media.countryOfOrigin] || 'Manga';
}

function mediaCard(media, because = []) {
  const tracked = findTrackedMedia(scans, media);
  const pub = PUB_STATUSES[media.status];
  const meta = [
    formatLabel(media),
    media.startDate?.year,
    pub && `<span style="color:${pub.color}">${pub.short}</span>`,
    media.chapters && `${media.chapters} ch.`,
    media.averageScore && `★ ${media.averageScore}%`,
  ].filter(Boolean).join(' · ');
  const becauseTitles = because
    .map((id) => scans.find((s) => s.pub?.id === id)?.title)
    .filter(Boolean)
    .slice(0, 2);
  const cover = media.coverImage?.large
    ? `<img src="${escapeHtml(media.coverImage.large)}" alt="" loading="lazy" referrerpolicy="no-referrer" data-initials="${escapeHtml(initials(mediaTitle(media)))}">`
    : `<span class="initials">${escapeHtml(initials(mediaTitle(media)))}</span>`;
  const actions = tracked
    ? `<span class="in-list">✓ Dans ta liste${tracked.url ? '' : ' (site à trouver)'}</span>`
    : `<button class="primary small-btn" data-add="plan">+ À lire</button>
       <button class="ghost small-btn" data-add="reading">▶ Je le lis</button>`;
  return `
    <article class="media-card card" data-media="${media.id}">
      <a class="media-cover" href="${escapeHtml(media.siteUrl)}" target="_blank" title="Voir la fiche AniList">${cover}</a>
      <div class="media-body">
        <h3 class="title" title="${escapeHtml(mediaTitle(media))}">${escapeHtml(mediaTitle(media))}</h3>
        <p class="media-meta">${meta}</p>
        ${becauseTitles.length ? `<p class="media-because">Parce que tu lis ${becauseTitles.map(escapeHtml).join(' et ')}</p>` : ''}
        <p class="media-genres">${(media.genres || []).slice(0, 3).map((g) => `<span>${escapeHtml(g)}</span>`).join('')}</p>
        <p class="media-desc">${escapeHtml(plainDescription(media.description))}</p>
        <div class="media-actions">${actions}</div>
      </div>
    </article>`;
}

// Garde les résultats en mémoire pour retrouver la fiche au clic sur « Ajouter »
const mediaById = new Map();
function remember(list) {
  for (const m of list) mediaById.set(m.id, m);
  return list;
}

function section(title, cards, subtitle = '') {
  return `
    <section class="discover-section">
      <h2>${title}${subtitle ? ` <span class="muted-small">${subtitle}</span>` : ''}</h2>
      <div class="media-grid">${cards.join('')}</div>
    </section>`;
}

async function loadDiscoverHome() {
  // Recommandations à partir de tes mangas : d'abord ceux que tu lis, les plus récents
  const base = scans
    .filter((s) => s.pub?.id && s.status !== 'dropped')
    .sort((a, b) => (a.status === 'reading' ? -1 : 0) - (b.status === 'reading' ? -1 : 0) || (b.lastRead || '').localeCompare(a.lastRead || ''))
    .slice(0, 10)
    .map((s) => s.pub.id);
  const [recs, trending] = await Promise.all([recommendationsFor(base), trendingAniList()]);
  remember(recs.map((r) => r.media));
  remember(trending);
  discoverCache = { recs, trending };
}

async function renderDiscover() {
  const el = $('#discover');

  if (discoverQuery) {
    if (!discoverResults) {
      el.innerHTML = '<p class="empty">Recherche…</p>';
      return;
    }
    el.innerHTML = discoverResults.length
      ? section(`Résultats pour « ${escapeHtml(discoverQuery)} »`, discoverResults.map((m) => mediaCard(m)))
      : `<p class="empty">Aucun manga trouvé pour « ${escapeHtml(discoverQuery)} ».</p>`;
    return;
  }

  if (!discoverCache) {
    el.innerHTML = '<p class="empty">Chargement des recommandations…</p>';
    discoverLoading ??= loadDiscoverHome().catch(() => (discoverCache = { error: true }));
    await discoverLoading;
    if (discoverQuery) return; // une recherche a commencé entre-temps
  }
  if (discoverCache.error) {
    el.innerHTML = '<p class="empty">AniList ne répond pas pour l’instant. Réessaie dans quelques minutes.</p>';
    discoverCache = null;
    discoverLoading = null;
    return;
  }

  const notTracked = (m) => !findTrackedMedia(scans, m);
  const recs = discoverCache.recs.filter((r) => notTracked(r.media)).slice(0, 12);
  const trending = discoverCache.trending.filter(notTracked);
  el.innerHTML =
    (recs.length
      ? section('Recommandé pour toi', recs.map((r) => mediaCard(r.media, r.because)), "d'après tes mangas")
      : '<p class="muted-small">Ajoute quelques mangas pour recevoir des recommandations.</p>') +
    section('Tendances du moment', trending.map((m) => mediaCard(m)), 'sur AniList');
}

// ---------- Recherche ----------

let searchTimer = null;
$('#discover-search').addEventListener('input', (e) => {
  clearTimeout(searchTimer);
  const query = e.target.value.trim();
  searchTimer = setTimeout(async () => {
    discoverQuery = query.length >= 2 ? query : '';
    discoverResults = null;
    renderDiscover();
    if (!discoverQuery) return;
    try {
      const results = remember(await searchAniList(discoverQuery));
      if (query === discoverQuery) discoverResults = results; // ignore une réponse arrivée trop tard
    } catch {
      discoverResults = [];
      toast('AniList ne répond pas pour l’instant.');
    }
    renderDiscover();
  }, 450);
});

// ---------- Ajouter ----------

$('#discover').addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-add]');
  if (!btn) return;
  const media = mediaById.get(Number(btn.closest('[data-media]').dataset.media));
  if (!media || findTrackedMedia(scans, media)) return;
  const scan = scanFromMedia(media, { status: btn.dataset.add });
  scans.push(scan);
  searchingSite.add(scan.id);
  await save();
  render();
  renderDiscover();
  toast(`« ${scan.title} » ajouté ! Recherche du manga sur anime-sama…`);
});
$('#discover').addEventListener('error', onImageError, true);

// Résultat de la recherche sur anime-sama (faite par l'arrière-plan)
browser.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes[STORAGE_KEY]) return;
  for (const scan of changes[STORAGE_KEY].newValue || []) {
    if (!searchingSite.has(scan.id) || !scan.sourceSearchedAt) continue;
    searchingSite.delete(scan.id);
    toast(scan.url
      ? `✓ « ${scan.title} » trouvé sur ${siteName(scan.url)}`
      : `« ${scan.title} » n'est pas sur anime-sama : ajoute le lien de ton site avec ✏️ dans la bibliothèque.`, 6000);
  }
  if (!$('#view-discover').hidden) renderDiscover();
});

// ---------- Import AniList ----------

$('#btn-import-anilist').addEventListener('click', async () => {
  const userName = prompt('Ton pseudo AniList (ta liste doit être publique) :')?.trim();
  if (!userName) return;
  toast('Chargement de ta liste AniList…');
  let entries;
  try {
    entries = await fetchAniListUserList(userName);
  } catch {
    toast(`Liste introuvable pour « ${userName} » : vérifie le pseudo et que ta liste est publique.`, 6000);
    return;
  }
  const copy = structuredClone(scans);
  const { added, updated } = mergeAniListEntries(copy, entries);
  if (!added && !updated) {
    toast(`Ta liste AniList (${entries.length} mangas) est déjà à jour dans Mes Scans.`);
    return;
  }
  if (!confirm(`${entries.length} mangas trouvés sur AniList :\n• ${added} nouveaux à ajouter\n• ${updated} déjà suivis dont le chapitre avancera\n\nImporter ?`)) return;
  scans = copy;
  await save();
  render();
  renderDiscover();
  toast(`${added} mangas ajoutés, ${updated} mis à jour. Leurs sites sont cherchés sur anime-sama en arrière-plan.`, 6000);
});

// L'onglet a pu être ouvert (préférence retenue) avant le chargement de ce fichier
if (!$('#view-discover').hidden) scansReady.then(renderDiscover);
