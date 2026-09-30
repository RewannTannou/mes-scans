# Fiche du store Mozilla (addons.mozilla.org)

Textes à copier-coller dans le formulaire de publication. Les captures sont dans [`captures/`](captures/), dans l'ordre d'affichage conseillé.

---

## Nom
```
Mes Scans
```

## Résumé (250 caractères maximum)
```
Suis tes mangas, manhwas et webtoons sur tous tes sites de lecture : le chapitre où tu en es est retenu tout seul, les nouveaux chapitres sont repérés, et tu retrouves toute ta bibliothèque en un clic.
```

## Description
```
Tu lis des mangas, manhwas ou webtoons sur plusieurs sites ? Mes Scans regroupe tout au même endroit et retient automatiquement où tu en es.

📖 SUIVI AUTOMATIQUE
• Le chapitre en cours est détecté tout seul pendant que tu lis (adresse de la page, titre ou menu de chapitre), même sur les sites qui changent de chapitre sans recharger la page.
• Un chapitre compte comme lu quand tu l'as parcouru jusqu'au bout.
• En revenant sur un chapitre commencé, tu es replacé directement à la page où tu t'étais arrêté.
• Raccourcis clavier Alt+Maj+↑ / ↓ pour avancer ou reculer d'un chapitre.

🆕 NOUVEAUX CHAPITRES
• Vérification régulière des nouveaux chapitres et notifications (désactivables).
• Onglet « Dernières sorties » en liste ou en catalogue de couvertures.
• Planning de la semaine : l'extension apprend le rythme de chaque série (« chaque jeudi ») et te montre ce qui arrive.
• Résumé de ta semaine de lecture.

📚 TA BIBLIOTHÈQUE
• Couvertures, état de parution (source : AniList), chapitres à lire et temps de lecture estimé.
• « Reprendre la lecture », favoris, note sur 10, notes personnelles, genres, filtres et tris.
• Un même manga peut être suivi sur plusieurs sites.
• Statuts suggérés : « Tu as tout lu et la série est terminée → Terminé ».

🔍 DÉCOUVRIR
• Recherche parmi des milliers de titres (base de données AniList), avec résumé, genres et note.
• Recommandations d'après les mangas que tu lis, tendances du moment, mieux notés.
• Import de ta liste AniList publique.
• Clic droit sur un lien ou une page → « Ajouter à Mes Scans ».

📊 STATISTIQUES
• Chapitres lus par jour, calendrier de l'année, séries de jours de lecture, genres préférés et succès à débloquer.

🔒 RESPECT DE TA VIE PRIVÉE
• Aucun compte, aucun serveur, aucune publicité, aucun pistage : ta bibliothèque reste dans ton navigateur.
• Sauvegarde automatique chaque semaine dans ton dossier Téléchargements, export et import en un clic.
• Thème sombre, clair ou automatique.

Mes Scans ne télécharge ni n'héberge aucun contenu : c'est un carnet de suivi qui fonctionne avec les sites de lecture que tu utilises déjà.
```

## Catégories (2 maximum)
- **Alertes et mises à jour** (Alerts & Updates)
- **Marque-pages** (Bookmarks)

## Mots-clés (tags)
```
manga, manhwa, webtoon, lecture, suivi
```

## Licence
**MIT** (déjà dans le dépôt).

## Politique de confidentialité
Case « Cette extension a une politique de confidentialité » : **oui**, puis coller :
```
Mes Scans ne collecte aucune donnée personnelle et n'utilise aucun serveur.

Données stockées : ta bibliothèque (titres, liens, chapitres, notes, préférences), ton historique de lecture et les dates de sortie des chapitres sont enregistrés uniquement dans le stockage local de ton navigateur Firefox. Ils ne sont jamais envoyés au développeur ni à un tiers. Une sauvegarde est enregistrée chaque semaine dans ton dossier Téléchargements (désactivable).

Requêtes réseau : pour fonctionner, l'extension contacte uniquement
• les sites de lecture de ta bibliothèque, pour connaître leur dernier chapitre disponible et trouver la page d'un manga ;
• l'API publique d'AniList (graphql.anilist.co), avec le titre d'un manga (état de parution, couverture, recherche, recommandations) ou ton pseudo AniList si tu choisis d'importer ta liste.
Ces requêtes ne contiennent aucun identifiant personnel ajouté par l'extension.

Pages visitées : l'adresse et le titre des onglets sont comparés, dans ton navigateur, aux liens de ta bibliothèque pour reconnaître le chapitre que tu lis. Ils ne sont ni conservés (en dehors de ta bibliothèque) ni transmis.

Aucune publicité, aucun outil de mesure d'audience, aucune vente de données.
```

## Assistance (facultatif)
- Site web / page d'assistance : `https://github.com/RewannTannou/mes-scans` (⚠️ le README du dépôt cite les sites de scans par leur nom : laisse ce champ vide si tu préfères ne pas les associer à la fiche).

## Notes pour les vérificateurs (en anglais, champ « Notes to Reviewer »)
```
Mes Scans is a personal reading tracker for manga/webtoon readers. It does not download, host or proxy any content; it only records which chapter the user is on and checks when new chapters are released on the sites the user already reads.

Permissions:
- host permissions (*://*/*) + content script: the content script runs on every page but stays inactive unless the background confirms (runtime message "isTracked") that the page belongs to a series in the user's library. It then reads the chapter number shown on the page (chapter <select>, title, headings) and the scroll progress over the chapter images. Nothing is sent anywhere; results go to the extension's background via runtime messages and are stored in storage.local.
- tabs: read the URL/title of tabs to match them locally with the user's library.
- scripting/activeTab: read the page title and og:image when the user adds the current page from the popup.
- alarms: hourly check for new chapters. notifications: new chapter alerts and weekly summary. downloads: optional weekly JSON backup of storage.local to the Downloads folder. menus: "Add to Mes Scans" context menu.

Remote requests (fetch from the background, no remote code):
- graphql.anilist.co (public AniList API): manga metadata, search, recommendations, optional import of a public user list.
- The reading sites present in the user's library: fetch the series page to find the latest chapter number; for one site, its public search endpoint and chapter-count JSON used by its own web page.

HTML rendering: every dynamic HTML string goes through setHTML() in shared.js, which uses DOMPurify.sanitize(..., { RETURN_DOM_FRAGMENT: true }) and replaceChildren(); values are also escaped with escapeHtml(). Selects and the in-page resume banner are built with DOM APIs.

Third-party library: extension/vendor/purify.min.js = DOMPurify 3.4.16, unmodified, from the official npm package (https://registry.npmjs.org/dompurify/-/dompurify-3.4.16.tgz, dist/purify.min.js), SHA-256 2c90a9b46d6463f26038a29b686e82bc91de01fdac9d5229e7cfe3b360134ea2.

All other code is plain, non-minified, non-transpiled JavaScript written for this extension. No data collection (data_collection_permissions: none).
```

## Captures d'écran (1280 × 800)
| Fichier | Légende à mettre |
|---|---|
| `1-library.png` | Ta bibliothèque : reprends ta lecture en un clic |
| `2-discover.png` | Découvre de nouveaux mangas selon tes goûts |
| `3-releases.png` | Les dernières sorties, en liste ou en catalogue |
| `4-planning.png` | Le planning des prochains chapitres |
| `5-stats.png` | Tes statistiques de lecture |
| `6-library-light.png` | Thème clair |
