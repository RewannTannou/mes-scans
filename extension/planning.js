// Onglet « Planning » : les 7 prochains jours, avec les mangas dont un chapitre
// est attendu d'après leur rythme de sortie (releaseRhythm, dans shared.js),
// une colonne « En retard » et une liste « Plus tard ».

function startOfDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function planningItem({ s, rhythm }) {
  const next = s.latest != null ? formatChapter(Math.floor(s.latest) + 1) : null;
  const thumb = s.cover
    ? `<img src="${escapeHtml(s.cover)}" alt="" loading="lazy" referrerpolicy="no-referrer" data-initials="${escapeHtml(initials(s.title))}">`
    : `<span class="initials">${escapeHtml(initials(s.title))}</span>`;
  return `
    <article class="plan-item" data-id="${s.id}" title="${escapeHtml(s.title)} — ${escapeHtml(rhythm.label)}">
      <div class="plan-thumb">${thumb}</div>
      <div class="plan-info">
        <h4>${escapeHtml(s.title)}</h4>
        <p>${next ? `Ch. ${next}` : 'Nouveau chapitre'} · ${escapeHtml(rhythm.label)}</p>
      </div>
    </article>`;
}

function renderPlanning() {
  const el = $('#planning');
  const active = scans.filter((s) => ['reading', 'plan', 'paused'].includes(s.status));
  const known = active.map((s) => ({ s, rhythm: releaseRhythm(releases, s.id) })).filter((x) => x.rhythm);
  const waiting = active.length - known.length;

  if (!known.length) {
    setHTML(el, `
      <p class="empty">Le planning se remplit tout seul au fil des sorties.<br>
      Il faut au moins ${MIN_RELEASES_FOR_RHYTHM} sorties enregistrées pour connaître le rythme d'un manga
      (environ 3 semaines pour une série hebdomadaire).${active.length ? `<br>${active.length} manga${active.length > 1 ? 's' : ''} en attente.` : ''}</p>`);
    return;
  }

  const today = startOfDay(new Date());
  const days = Array.from({ length: 7 }, (_, i) => {
    const date = new Date(today);
    date.setDate(date.getDate() + i);
    return { date, items: [] };
  });
  const late = [];
  const later = [];
  for (const item of known) {
    const index = Math.floor((startOfDay(item.rhythm.next) - today) / 86400000);
    if (index < 0) late.push(item);
    else if (index < 7) days[index].items.push(item);
    else later.push(item);
  }

  const dayName = (date, i) =>
    i === 0 ? "Aujourd'hui" : i === 1 ? 'Demain' : date.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric' });
  const column = (title, items, extraClass = '') => `
    <section class="plan-day ${extraClass} ${items.length ? '' : 'is-empty'}">
      <h3>${title} ${items.length ? `<span class="count">${items.length}</span>` : ''}</h3>
      ${items.length ? items.map(planningItem).join('') : '<p class="muted-small">Rien de prévu</p>'}
    </section>`;

  setHTML(el, `
    <div class="plan-grid">
      ${late.length ? column('⏰ En retard', late, 'is-late') : ''}
      ${days.map((d, i) => column(dayName(d.date, i), d.items, i === 0 ? 'is-today' : '')).join('')}
    </div>
    ${later.length ? `<h3 class="plan-later-title">Plus tard</h3><div class="plan-later">${later.map(planningItem).join('')}</div>` : ''}
    <p class="muted-small plan-note">Estimations d'après les ${releases.length} sorties enregistrées.
      ${waiting ? `${waiting} manga${waiting > 1 ? 's' : ''} n'ont pas encore assez de sorties pour connaître leur rythme.` : ''}</p>`);
}

// Clic sur un manga du planning : sa fiche dans la bibliothèque
$('#planning').addEventListener('click', (e) => {
  const item = e.target.closest('[data-id]');
  const scan = item && scans.find((s) => s.id === item.dataset.id);
  if (scan) openForm(scan);
});
$('#planning').addEventListener('error', onImageError, true);

browser.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && (changes.releases || changes[STORAGE_KEY]) && !$('#view-planning').hidden) renderPlanning();
});

if (!$('#view-planning').hidden) scansReady.then(renderPlanning);
