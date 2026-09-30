// Onglet « Découvrir » : une bannière de recommandations, des rangées d'affiches
// (recommandé pour toi, tendances, mieux notés…), la recherche AniList, une fiche
// détaillée et l'import d'une liste AniList. Un manga ajouté d'ici est ensuite
// cherché sur anime-sama par l'arrière-plan (background.js).

let discoverQuery = '';
let discoverResults = null; // résultats de la recherche en cours
let discoverCache = null; // { recs, rows } : chargés une fois par ouverture de la page
let discoverLoading = null;
let heroIndex = 0;
let heroTimer = null;
const searchingSite = new Set(); // scans ajoutés dont on attend la recherche sur anime-sama
const mediaById = new Map(); // fiches déjà reçues, pour les retrouver au clic
const becauseById = new Map(); // fiche recommandée -> ids AniList de tes mangas qui la recommandent

// ---------- Petits messages ----------

let toastTimer = null;
function toast(message, duration = 4000) {
  const el = $('#toast');
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), duration);
}

// ---------- Aides d'affichage ----------

function remember(list) {
  for (const m of list) mediaById.set(m.id, m);
  return list;
}

function formatLabel(media) {
  if (media.format === 'NOVEL') return 'Roman';
  if (media.format === 'ONE_SHOT') return 'One shot';
  return { KR: 'Manhwa', CN: 'Manhua', TW: 'Manhua' }[media.countryOfOrigin] || 'Manga';
}

function becauseText(mediaId) {
  const titles = (becauseById.get(mediaId) || [])
    .map((id) => scans.find((s) => s.pub?.id === id)?.title)
    .filter(Boolean)
    .slice(0, 2);
  return titles.length ? `Parce que tu lis ${titles.join(' et ')}` : '';
}

function coverImg(media, size = 'large') {
  const src = (size === 'extraLarge' && media.coverImage?.extraLarge) || media.coverImage?.large;
  return src
    ? `<img src="${escapeHtml(src)}" alt="" loading="lazy" referrerpolicy="no-referrer" data-initials="${escapeHtml(initials(mediaTitle(media)))}">`
    : `<span class="initials">${escapeHtml(initials(mediaTitle(media)))}</span>`;
}

// Couleur dominante de la couverture (fournie par AniList), pour les reflets
const tint = (media) => (media.coverImage?.color ? `--tint:${escapeHtml(media.coverImage.color)}` : '');

function statusDot(media) {
  const pub = PUB_STATUSES[media.status];
  return pub ? `<span class="dot-status" style="color:${pub.color}">${pub.short}</span>` : '';
}

function addButtons(media, compact = false) {
  const tracked = findTrackedMedia(scans, media);
  if (tracked) {
    return `<span class="in-list">✓ Dans ta liste${tracked.url ? '' : ' · site à trouver'}</span>`;
  }
  return `
    <button class="primary" data-add="plan">+ À lire</button>
    <button class="ghost ${compact ? '' : 'on-dark'}" data-add="reading">▶ Je le lis</button>`;
}

// ---------- Affiche (carte verticale) ----------

function poster(media) {
  const tracked = findTrackedMedia(scans, media);
  return `
    <article class="poster" data-media="${media.id}" style="${tint(media)}" tabindex="0" title="${escapeHtml(mediaTitle(media))}">
      <div class="poster-cover">
        ${coverImg(media)}
        <span class="poster-format">${formatLabel(media)}</span>
        ${media.averageScore ? `<span class="poster-score">★ ${media.averageScore}</span>` : ''}
        ${tracked
          ? '<span class="poster-tracked">✓ Dans ta liste</span>'
          : '<button class="poster-add" data-add="plan" title="Ajouter à « À lire »">+</button>'}
      </div>
      <h3 class="poster-title">${escapeHtml(mediaTitle(media))}</h3>
      <p class="poster-meta">${[media.startDate?.year, statusDot(media)].filter(Boolean).join(' · ')}</p>
    </article>`;
}

function row(key, title, subtitle, list) {
  if (!list.length) return '';
  return `
    <section class="shelf">
      <div class="shelf-head">
        <h2>${title} ${subtitle ? `<span class="muted-small">${subtitle}</span>` : ''}</h2>
        <div class="shelf-arrows">
          <button class="ghost" data-scroll="${key}" data-dir="-1" aria-label="Précédent">‹</button>
          <button class="ghost" data-scroll="${key}" data-dir="1" aria-label="Suivant">›</button>
        </div>
      </div>
      <div class="shelf-row" id="shelf-${key}">${list.map(poster).join('')}</div>
    </section>`;
}

// ---------- Bannière ----------

function heroSlide(media) {
  const backdrop = media.bannerImage || media.coverImage?.extraLarge || media.coverImage?.large;
  const because = becauseText(media.id);
  return `
    <div class="hero-backdrop ${media.bannerImage ? '' : 'is-cover'}" style="background-image:url('${escapeHtml(backdrop || '')}')"></div>
    <div class="hero-content" data-media="${media.id}" style="${tint(media)}">
      <div class="hero-cover" data-open>${coverImg(media, 'extraLarge')}</div>
      <div class="hero-info">
        ${because ? `<p class="hero-because">${escapeHtml(because)}</p>` : '<p class="hero-because">Tendance du moment</p>'}
        <h2 class="hero-title" data-open>${escapeHtml(mediaTitle(media))}</h2>
        <p class="hero-meta">${[formatLabel(media), media.startDate?.year, statusDot(media), media.chapters && `${media.chapters} chapitres`, media.averageScore && `★ ${media.averageScore}%`].filter(Boolean).join(' · ')}</p>
        <p class="hero-genres">${(media.genres || []).slice(0, 4).map((g) => `<span>${escapeHtml(g)}</span>`).join('')}</p>
        <p class="hero-desc">${escapeHtml(plainDescription(media.description, 320))}</p>
        <div class="hero-actions">${addButtons(media)}<button class="ghost on-dark" data-open>Voir la fiche</button></div>
      </div>
    </div>`;
}

function heroItems() {
  const notTracked = (m) => !findTrackedMedia(scans, m);
  const fromRecs = discoverCache.recs.map((r) => r.media).filter(notTracked);
  // Bannières avec une vraie image de bannière en priorité : plus jolies
  const pool = (fromRecs.length ? fromRecs : discoverCache.rows.trending.filter(notTracked)).slice(0, 12);
  return [...pool.filter((m) => m.bannerImage), ...pool.filter((m) => !m.bannerImage)].slice(0, 5);
}

function renderHero() {
  const hero = $('#hero');
  if (!hero) return;
  const items = heroItems();
  if (!items.length) {
    hero.remove();
    return;
  }
  heroIndex %= items.length;
  setHTML(hero.querySelector('.hero-slide'), heroSlide(items[heroIndex]));
  setHTML(hero.querySelector('.hero-dots'), items
    .map((_, i) => `<button class="${i === heroIndex ? 'active' : ''}" data-hero="${i}" aria-label="Recommandation ${i + 1}"></button>`)
    .join(''));
}

function startHeroTimer() {
  clearInterval(heroTimer);
  heroTimer = setInterval(() => {
    if ($('#view-discover').hidden || discoverQuery || $('#hero')?.matches(':hover')) return;
    heroIndex++;
    renderHero();
  }, 8000);
}

// ---------- Rendu de l'onglet ----------

function skeleton() {
  const shelf = `<section class="shelf"><div class="shelf-head"><h2><span class="skel skel-text"></span></h2></div>
    <div class="shelf-row">${'<div class="poster"><div class="poster-cover skel"></div><span class="skel skel-text"></span></div>'.repeat(8)}</div></section>`;
  return `<div class="hero skel"></div>${shelf}${shelf}`;
}

async function loadDiscoverHome() {
  // Recommandations à partir de tes mangas : d'abord ceux que tu lis, les plus récents
  const base = scans
    .filter((s) => s.pub?.id && s.status !== 'dropped')
    .sort((a, b) => (b.status === 'reading') - (a.status === 'reading') || (b.lastRead || '').localeCompare(a.lastRead || ''))
    .slice(0, 10)
    .map((s) => s.pub.id);
  const [recs, rows] = await Promise.all([recommendationsFor(base), discoverRows()]);
  for (const r of recs) becauseById.set(r.media.id, r.because);
  remember(recs.map((r) => r.media));
  Object.values(rows).forEach(remember);
  discoverCache = { recs, rows };
}

async function renderDiscover() {
  const el = $('#discover');

  if (discoverQuery) {
    if (!discoverResults) {
      setHTML(el, `<div class="search-grid">${'<div class="poster"><div class="poster-cover skel"></div><span class="skel skel-text"></span></div>'.repeat(12)}</div>`);
      return;
    }
    setHTML(el, discoverResults.length
      ? `<h2 class="search-title">${discoverResults.length} résultat${discoverResults.length > 1 ? 's' : ''} pour « ${escapeHtml(discoverQuery)} »</h2>
         <div class="search-grid">${discoverResults.map(poster).join('')}</div>`
      : `<p class="empty">Aucun manga trouvé pour « ${escapeHtml(discoverQuery)} ».<br>Essaie le titre anglais ou le titre original.</p>`);
    return;
  }

  if (!discoverCache) {
    setHTML(el, skeleton());
    discoverLoading ??= loadDiscoverHome().catch(() => (discoverCache = { error: true }));
    await discoverLoading;
    if (discoverQuery) return; // une recherche a commencé entre-temps
  }
  if (discoverCache.error) {
    setHTML(el, '<p class="empty">AniList ne répond pas pour l’instant.<br>Réessaie dans quelques minutes.</p>');
    discoverCache = null;
    discoverLoading = null;
    return;
  }

  const notTracked = (m) => !findTrackedMedia(scans, m);
  const { rows } = discoverCache;
  const recs = discoverCache.recs.map((r) => r.media).filter(notTracked);
  setHTML(el, `
    <section class="hero" id="hero">
      <div class="hero-slide"></div>
      <div class="hero-dots"></div>
    </section>
    ${recs.length ? row('recs', 'Recommandé pour toi', "d'après tes mangas", recs.slice(0, 20)) : ''}
    ${row('trending', 'Tendances du moment', '', rows.trending)}
    ${row('top', 'Les mieux notés', 'de tous les temps', rows.top)}
    ${row('manhwa', 'Manhwa populaires', '', rows.manhwa)}
    ${row('fresh', 'Nouveautés populaires', 'sorties depuis l’an dernier', rows.fresh)}`);
  renderHero();
  startHeroTimer();
}

// ---------- Fiche détaillée ----------

function openMedia(media) {
  const backdrop = media.bannerImage || media.coverImage?.extraLarge || media.coverImage?.large;
  const because = becauseText(media.id);
  const facts = [
    ['Format', formatLabel(media)],
    ['Parution', PUB_STATUSES[media.status]?.label],
    ['Année', media.startDate?.year],
    ['Chapitres', media.chapters],
    ['Volumes', media.volumes],
    ['Note', media.averageScore && `★ ${media.averageScore}%`],
    ['Popularité', media.popularity && `${media.popularity.toLocaleString('fr-FR')} lecteurs`],
  ].filter(([, v]) => v);
  const otherTitles = mediaTitles(media).filter((t) => t !== mediaTitle(media)).slice(0, 3);

  setHTML($('#media-content'), `
    <div class="md-banner ${media.bannerImage ? '' : 'is-cover'}" style="background-image:url('${escapeHtml(backdrop || '')}')"></div>
    <div class="md-head" data-media="${media.id}" style="${tint(media)}">
      <div class="md-cover">${coverImg(media, 'extraLarge')}</div>
      <div class="md-titles">
        ${because ? `<p class="hero-because">${escapeHtml(because)}</p>` : ''}
        <h2>${escapeHtml(mediaTitle(media))}</h2>
        ${otherTitles.length ? `<p class="md-alt">${otherTitles.map(escapeHtml).join(' · ')}</p>` : ''}
        <div class="md-actions">${addButtons(media, true)}<a class="button ghost" href="${escapeHtml(media.siteUrl)}" target="_blank">Voir sur AniList ↗</a></div>
      </div>
    </div>
    <div class="md-body">
      <dl class="md-facts">${facts.map(([k, v]) => `<div><dt>${k}</dt><dd>${escapeHtml(v)}</dd></div>`).join('')}</dl>
      <p class="hero-genres">${(media.genres || []).map((g) => `<span>${escapeHtml(g)}</span>`).join('')}</p>
      <p class="md-desc">${escapeHtml(plainDescription(media.description, 2000)) || 'Pas de résumé disponible.'}</p>
    </div>`);
  $('#media-dialog').showModal();
}

$('#media-close').addEventListener('click', () => $('#media-dialog').close());
$('#media-dialog').addEventListener('click', (e) => {
  if (e.target === $('#media-dialog')) $('#media-dialog').close(); // clic à côté de la fiche
});

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

// ---------- Clics : ajouter, ouvrir une fiche, faire défiler ----------

async function addMedia(media, status) {
  if (!media || findTrackedMedia(scans, media)) return;
  const scan = scanFromMedia(media, { status });
  scans.push(scan);
  searchingSite.add(scan.id);
  await save();
  render();
  toast(`« ${scan.title} » ajouté ! Recherche d’un site où le lire…`);
}

async function onDiscoverClick(e) {
  const card = e.target.closest('[data-media]');
  const media = card && mediaById.get(Number(card.dataset.media));

  const scrollBtn = e.target.closest('[data-scroll]');
  if (scrollBtn) {
    const shelf = $(`#shelf-${scrollBtn.dataset.scroll}`);
    shelf.scrollBy({ left: Number(scrollBtn.dataset.dir) * shelf.clientWidth * 0.85, behavior: 'smooth' });
    return;
  }
  const dot = e.target.closest('[data-hero]');
  if (dot) {
    heroIndex = Number(dot.dataset.hero);
    renderHero();
    return;
  }
  if (!media) return;

  const addBtn = e.target.closest('[data-add]');
  if (addBtn) {
    await addMedia(media, addBtn.dataset.add);
    // Rafraîchit la carte / la fiche pour afficher « Dans ta liste »
    if ($('#media-dialog').open) openMedia(media);
    renderDiscover();
    return;
  }
  if (e.target.closest('[data-open]') || e.target.closest('.poster')) openMedia(media);
}

$('#discover').addEventListener('click', onDiscoverClick);
$('#media-content').addEventListener('click', onDiscoverClick);
$('#discover').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.matches('.poster')) openMedia(mediaById.get(Number(e.target.dataset.media)));
});
$('#discover').addEventListener('error', onImageError, true);
$('#media-content').addEventListener('error', onImageError, true);

// Résultat de la recherche sur anime-sama (faite par l'arrière-plan)
browser.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes[STORAGE_KEY]) return;
  for (const scan of changes[STORAGE_KEY].newValue || []) {
    if (!searchingSite.has(scan.id) || !scan.sourceSearchedAt) continue;
    searchingSite.delete(scan.id);
    toast(scan.url
      ? `✓ « ${scan.title} » trouvé sur ${siteName(scan.url)}`
      : `« ${scan.title} » ajouté : ajoute le lien de ton site de lecture avec ✏️ dans la bibliothèque.`, 6000);
  }
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
  toast(`${added} mangas ajoutés, ${updated} mis à jour. Leurs sites de lecture sont cherchés en arrière-plan.`, 6000);
});

// L'onglet a pu être ouvert (préférence retenue) avant le chargement de ce fichier
if (!$('#view-discover').hidden) scansReady.then(renderDiscover);
