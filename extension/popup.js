const $ = (sel) => document.querySelector(sel);

$('#open-dashboard').addEventListener('click', () => {
  openDashboard();
  window.close();
});

function setThumb(el, cover, title) {
  el.textContent = initials(title || '?');
  if (!cover) return;
  const img = document.createElement('img');
  img.referrerPolicy = 'no-referrer';
  img.src = cover;
  img.onload = () => el.replaceChildren(img);
}

// Récupère le titre et l'image de la page (balises og:title / og:image que
// la plupart des sites de scans remplissent).
async function readPageInfo(tabId) {
  try {
    const [res] = await browser.scripting.executeScript({
      target: { tabId },
      func: () => {
        const meta = (p) => document.querySelector(`meta[property="${p}"], meta[name="${p}"]`)?.content || '';
        return { title: meta('og:title') || document.title, image: meta('og:image') };
      },
    });
    return res.result || {};
  } catch {
    return {};
  }
}

// mode : 'auto'   -> chapitre lu dans l'adresse et enregistré tout seul
//        'manual' -> scan reconnu, mais chapitre invisible dans l'adresse
//                    (on essaie alors de le lire dans la page)
//        'title'  -> reconnu seulement grâce au titre (lien différent)
async function showTracked(scans, scan, mode, tab) {
  $('#add').hidden = true;
  $('#tracked').hidden = false;
  $('#t-title').textContent = scan.title;
  $('#t-site').textContent = siteName(scan.url);
  setThumb($('#t-cover'), scan.cover, scan.title);

  const renderChapter = () => {
    const total = scan.latest != null ? ` / ${formatChapter(scan.latest)}` : '';
    const p = scan.position?.chapter === scan.chapter && scan.position.progress < FINISHED_AT ? scan.position.progress : 0;
    $('#t-chapter').textContent = `Chapitre ${formatChapter(scan.chapter)}${p >= 0.02 ? ` (${Math.round(p * 100)} %)` : ''}${total}`;
    const unread = unreadCount(scan);
    const pub = PUB_STATUSES[scan.pub?.status];
    $('#t-site').textContent = siteName(scan.url)
      + (unread === null ? '' : unread > 0 ? ` · 🔴 ${unread} à lire` : ' · ✓ À jour')
      + (pub ? ` · ${pub.short}` : '');
  };
  renderChapter();
  const change = (delta) => {
    scan.chapter = Math.max(0, scan.chapter + delta);
    scan.lastRead = new Date().toISOString();
    saveScans(scans);
    renderChapter();
    browser.action.setBadgeText({ tabId: tab.id, text: formatChapter(scan.chapter) });
  };
  $('#t-inc').onclick = () => change(1);
  $('#t-dec').onclick = () => change(-1);
  $('#t-next').onclick = () => change(1);

  // Scan de cette page : on demande à content.js de surveiller le chapitre
  if (mode !== 'title') browser.tabs.sendMessage(tab.id, { type: 'watch' }).catch(() => {});

  // Chapitre absent de l'adresse : on le cherche dans le titre de l'onglet, puis dans la page
  if (mode === 'manual') {
    const num = chapterFromText(tab.title) ?? (await readChapterFromPage(tab.id));
    if (num !== null) {
      mode = 'page';
      if (num !== scan.chapter) change(num - scan.chapter);
    }
  }

  const note = $('#t-note');
  note.className = mode === 'auto' || mode === 'page' ? 'saved' : 'saved info';
  note.textContent = {
    auto: '✓ Chapitre enregistré automatiquement',
    page: '✓ Chapitre détecté dans la page',
    manual: "Chapitre introuvable sur cette page : clique sur « +1 » après chaque chapitre lu (ou Alt+Maj+↑ sans ouvrir ce menu).",
    title: `Tu suis déjà ce manga sur ${siteName(scan.url) || 'un autre lien'}.`,
  }[mode];
  $('#t-next').hidden = mode !== 'manual';
  $('#t-add-anyway').hidden = mode !== 'title';
  $('#t-move').hidden = mode !== 'title';
  // Même manga sur un nouveau site : on ajoute ce lien (il devient le principal,
  // l'ancien reste dans « autres sites »)
  $('#t-move').onclick = async () => {
    const detected = detectChapter(tab.url);
    promoteLink(scan, detected ? detected.template : tab.url);
    if (detected) scan.chapter = detected.num;
    scan.lastRead = new Date().toISOString();
    await saveScans(scans);
    showTracked(scans, scan, detected ? 'auto' : 'manual', tab);
  };
  $('#t-add-anyway').onclick = () => {
    $('#tracked').hidden = true;
    showAddForm(scans, tab, true);
  };

  // Sans la permission de lire les pages (retirée dans about:addons…), le suivi
  // ne marche qu'en ouvrant le popup : on propose de la rétablir.
  const enable = $('#t-enable');
  enable.hidden = await hasAllSitesPermission();
  enable.onclick = () => {
    browser.permissions.request(ALL_SITES).then((granted) => {
      if (!granted) return;
      enable.hidden = true;
      note.textContent = '✓ Suivi automatique activé';
    });
  };
}

async function showAddForm(scans, tab, skipTitleCheck = false) {
  const form = $('#add');
  const detected = detectChapter(tab.url);
  const info = await readPageInfo(tab.id);
  const title = cleanTitle(info.title || tab.title, tab.url);

  // Même manga déjà suivi, mais avec un autre lien ?
  const sameTitle = !skipTitleCheck && findByTitle(scans, title);
  if (sameTitle) return showTracked(scans, sameTitle, 'title', tab);

  form.status.innerHTML = Object.entries(STATUSES).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join('');
  form.title.value = title;
  form.chapter.value = detected ? detected.num : chapterFromText(info.title || tab.title) ?? (await readChapterFromPage(tab.id)) ?? 1;
  form.status.value = 'reading';
  form.cover.value = info.image || '';
  setThumb($('#a-preview'), form.cover.value, form.title.value);
  form.cover.addEventListener('change', () => setThumb($('#a-preview'), form.cover.value, form.title.value));

  const hint = $('#a-hint');
  if (detected) {
    hint.textContent = `✓ Chapitre ${formatChapter(detected.num)} détecté : les prochains chapitres seront suivis automatiquement.`;
  } else {
    hint.className = 'hint warn';
    hint.textContent = "Pas de numéro de chapitre dans l'adresse : l'extension le cherchera dans la page (sinon, bouton « +1 »).";
  }

  form.hidden = false;
  form.title.focus();

  form.onsubmit = async (e) => {
    e.preventDefault();
    scans.push({
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      lastRead: new Date().toISOString(),
      title: form.title.value.trim(),
      url: detected ? detected.template : tab.url,
      chapter: parseFloat(form.chapter.value) || 0,
      status: form.status.value,
      cover: form.cover.value.trim(),
    });
    await saveScans(scans);
    showTracked(scans, scans[scans.length - 1], detected ? 'auto' : 'manual', tab);
  };
}

(async () => {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  const scans = await loadScans();

  if (!tab?.url || !/^https?:/.test(tab.url)) {
    $('#unsupported').hidden = false;
    return;
  }
  const hit = matchScan(scans, tab.url) || matchByPageTitle(scans, tab);
  if (hit) showTracked(scans, hit.scan, hit.num !== null ? 'auto' : 'manual', tab);
  else showAddForm(scans, tab);
})();
