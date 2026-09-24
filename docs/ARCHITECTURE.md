# Architecture de l'extension

Ce document décrit le fonctionnement interne de **Mes Scans** pour qui veut le modifier. Pour l'installation et l'utilisation, voir le [README](../README.md).

L'extension est écrite en JavaScript simple, sans framework ni étape de compilation : les fichiers de `extension/` sont exactement ceux que Firefox charge. Elle utilise le **Manifest V3** de Firefox (API `browser.*` à base de promesses).

---

## Sommaire

- [Vue d'ensemble](#vue-densemble)
- [Modèle de données](#modèle-de-données)
- [Détection du chapitre](#détection-du-chapitre)
- [Reconnaître un scan à partir d'une page](#reconnaître-un-scan-à-partir-dune-page)
- [Messages entre les scripts](#messages-entre-les-scripts)
- [Nouveaux chapitres](#nouveaux-chapitres)
- [État de parution (AniList)](#état-de-parution-anilist)
- [Historique et statistiques](#historique-et-statistiques)
- [Sauvegarde automatique](#sauvegarde-automatique)
- [Ajouter un site](#ajouter-un-site)
- [Conventions](#conventions)

---

## Vue d'ensemble

```
            ┌──────────────────────── Firefox ────────────────────────┐
            │                                                          │
 Page d'un  │  content.js ──(chapter / latest / isTracked)──►          │
 site de    │      ▲                                     background.js │──► sites de scans
 scans      │      └────────────── (watch) ──────────────  + sources.js│──► AniList
            │                                                   │      │
            │  popup.js  ──(lecture/écriture)──┐                │      │
            │  dashboard.js + stats.js ────────┼──► storage.local ◄────┘
            │                                  │   (scans, history,   │
            │                                  │    settings, …)      │
            └──────────────────────────────────────────────────────────┘
```

| Fichier | Contexte | Rôle |
|---|---|---|
| `shared.js` | partout | Stockage, détection du numéro de chapitre, reconnaissance d'un scan à partir d'une URL, utilitaires. Chargé par tous les autres scripts. |
| `background.js` | arrière-plan (page d'événements) | Écoute les onglets, enregistre les chapitres, planifie les vérifications, notifications, badge, raccourcis, historique, sauvegarde. |
| `sources.js` | arrière-plan | Récupère le dernier chapitre disponible par site, et l'état de parution sur AniList. |
| `content.js` | chaque page web | Inactif tant que l'arrière-plan ne confirme pas que la page est un scan suivi ; surveille ensuite le chapitre affiché. |
| `popup.js` | menu de l'icône | Affiche le scan de la page (ou le formulaire d'ajout), boutons +1/−1. |
| `dashboard.js` | onglet `dashboard.html` | La bibliothèque. |
| `stats.js` | onglet `dashboard.html` | La fenêtre des statistiques. |

**Source de vérité unique : `storage.local`.** Chaque contexte lit la liste, la modifie et la réenregistre. Les pages ouvertes (bibliothèque) se rafraîchissent via `storage.onChanged`. Dans l'arrière-plan, toutes les écritures passent par une **file d'attente** (`enqueue`) pour que deux mises à jour rapprochées ne s'écrasent pas.

---

## Modèle de données

Tout est dans `browser.storage.local` :

| Clé | Contenu |
|---|---|
| `scans` | La liste des scans (voir ci-dessous). |
| `history` | Chapitres lus par jour : `{ "2026-09-25": { "<idScan>": 3, … }, … }` (≈ 400 jours conservés). |
| `settings` | `{ notify: bool, backup: bool }` (les deux à `true` par défaut). |
| `lastCheck` | Date ISO de la dernière vérification des nouveautés. |
| `lastBackup` | Date ISO de la dernière sauvegarde automatique. |

### Un scan

```js
{
  id: "c1f0…",                 // UUID
  title: "A Returner's Magic Should Be Special",
  url: "https://phenix-scans.co/manga/a-returners-magic-should-be-special/chapitre/{ch}",
  altUrls: ["https://anime-sama.to/catalogue/a-returners-magic-should-be-special/scan/vf/"],
  chapter: 68,                 // chapitre où tu en es (peut être décimal : 12.5)
  status: "reading",           // reading | plan | paused | done | dropped
  cover: "https://…/cover.jpg",
  lastRead: "2026-09-25T…",    // null si jamais lu
  createdAt: "2026-09-24T…",
  latest: 269,                 // dernier chapitre disponible (rempli par la vérification)
  pub: {                       // état de parution, depuis AniList
    id: 105393, status: "FINISHED", chapters: 268,
    url: "https://anilist.co/manga/105393/…", title: "…", cover: "…",
    checkedAt: "2026-09-25T…"  // null = à (re)charger
  }
}
```

- **`url`** est le lien *principal* : celui qu'ouvre le bouton « Lire ». Il devient automatiquement le dernier site sur lequel tu as lu (`promoteLink`).
- **`{ch}`** dans un lien marque l'emplacement du numéro de chapitre. `chapterUrl(scan)` le remplace par le chapitre actuel. Un lien sans `{ch}` (ex. anime-sama) est ouvert tel quel.

---

## Détection du chapitre

### Dans une adresse — `detectChapter(url)`
Cherche un nombre précédé d'un mot-clé (`chapitre`, `chapter`, `ch`, `episode`, `ep`, `scan`) et suivi d'une fin propre (pas d'identifiant du type `8f3a…`). À défaut, prend un dernier segment entièrement numérique (`/one-piece/1100/`). Renvoie le numéro et le **modèle** avec `{ch}`.

```
https://phenix-scans.co/manga/x/chapitre/62  →  { num: 62, template: "…/chapitre/{ch}" }
https://www.japscan.lol/lecture-en-ligne/one-piece/1100/  →  { num: 1100, template: "…/one-piece/{ch}/" }
```

### Dans un texte — `chapterFromText(text)`
Même principe sur du texte (« CHAPITRE 68 », « Ch. 12.5 », « Episode 4 »). `1,100` est lu comme mille cent, `12,5` comme douze et demi.

### Dans une page — `collectChapterTexts()`
Rassemble, dans cet ordre : l'option sélectionnée des menus déroulants (le sélecteur de chapitre, source la plus fiable), le titre de l'onglet, les `h1`/`h2`, le dernier élément du fil d'Ariane. La fonction est autonome car elle est aussi injectée telle quelle dans la page (`scripting.executeScript`).

### Ordre de priorité à l'enregistrement (`recordChapter`)
1. numéro envoyé par `content.js` (page surveillée) ;
2. numéro dans l'adresse (modèle `{ch}`) ;
3. numéro dans le titre de l'onglet.

Le chapitre enregistré suit la page **dans les deux sens** (pas de « jamais reculer »).

---

## Reconnaître un scan à partir d'une page

`matchScan(scans, pageUrl)` compare l'adresse de la page avec **tous les liens** de chaque scan (`scanLinks`). Les adresses sont normalisées (`normalizeUrl`) : sans `http(s)`, sans `www.`, sans barre finale, sans paramètres ni ancre, en minuscules.

Quatre passes, de la plus stricte à la plus souple :

1. **Page de chapitre** : l'adresse suit exactement un modèle `{ch}` → renvoie aussi le numéro.
2. **Page de la série** : l'adresse est la « série » du lien ou une sous-page (`seriesKey` : ce qui précède `/chapitre/{ch}`). La correspondance la plus longue gagne.
3. et 4. Les deux mêmes passes en ignorant l'**extension du domaine** (`.to`, `.fr`…) : c'est ce qui détecte un site qui a changé d'adresse. Le résultat contient alors `moved: { from, to }` et l'arrière-plan corrige tous les liens de ce site (`renameHost`).

En dernier recours, `matchByPageTitle` reconnaît un scan **du même site** dont le titre apparaît dans le titre de l'onglet (utile quand l'adresse des chapitres n'a rien à voir avec celle du manga).

Le popup ajoute une vérification par **titre exact** (`findByTitle`), tous sites confondus, pour proposer « Ajouter ce site à ce manga » plutôt qu'un doublon.

---

## Messages entre les scripts

`browser.runtime.sendMessage` (vers l'arrière-plan) et `browser.tabs.sendMessage` (vers une page) :

| Message | De → vers | Effet |
|---|---|---|
| `{ type: 'isTracked' }` | content → background | Réponse `true` si la page est un scan suivi ; `content.js` démarre alors sa surveillance. |
| `{ type: 'watch' }` | background/popup → content | Démarre la surveillance (navigation interne vers un scan, scan qui vient d'être ajouté). |
| `{ type: 'chapter', num }` | content → background | Le chapitre affiché a changé. |
| `{ type: 'latest', num }` | content → background | Plus grand chapitre proposé dans les menus de la page (sert de « dernier chapitre » quand la vérification échoue). |
| `{ type: 'checkNow' }` | dashboard → background | Vérifie les nouveautés et les fiches AniList manquantes maintenant. |
| `{ type: 'backupNow' }` | dashboard → background | Sauvegarde immédiate. |

`content.js` vérifie le chapitre affiché au démarrage, à chaque `change` (menu), après chaque clic (boutons « chapitre suivant »), et toutes les 2 secondes par sécurité. Il n'envoie un message que si la valeur change.

---

## Nouveaux chapitres

- Alarme `check-new-chapters` : 1 min après le démarrage, puis toutes les **60 min**. Elle déclenche aussi le rafraîchissement AniList et la sauvegarde hebdomadaire.
- `runCheck` parcourt les scans qui ne sont ni « Terminé » ni « Abandonné » et appelle `fetchLatestChapter`, qui interroge chaque lien du scan via sa source (`sources.js`) et garde le **maximum**.
- `updateLatest` enregistre `scan.latest` ; si la valeur **augmente** par rapport à une valeur déjà connue (pas lors de la première vérification), une notification est envoyée pour les scans « En cours ».
- Badge global de l'icône : nombre de scans « En cours » avec `unreadCount(scan) > 0` (`unreadCount = ceil(latest − chapter)`).

### Sources existantes (`SOURCES` dans `sources.js`)

| Source | Correspond à | Méthode |
|---|---|---|
| `anime-sama` | domaines `anime-sama.*` | Lit le nom exact de l'œuvre (`#titreOeuvre`) sur la page, puis `GET /s2/scans/get_nb_chap_et_img.php?oeuvre=<nom>` (un objet par chapitre). Les listes personnalisées (`resetListe`, `creerListe`, `newSP`, `newSPF`, `finirListe` dans les scripts de la page) sont rejouées comme le fait le site pour obtenir le vrai dernier numéro. |
| `liste de chapitres` | tout lien avec `{ch}` | Télécharge la page du manga (`seriesUrl`) et garde les liens `<a href>` qui suivent le modèle du scan ; prend le plus grand numéro. |

Les requêtes partent de l'arrière-plan avec `credentials: 'include'` (cookies de Firefox), ce qui permet parfois de passer les protections anti-robots déjà validées par le navigateur.

---

## État de parution (AniList)

- API GraphQL publique `https://graphql.anilist.co`, sans clé.
- Recherche par titre (`Page(perPage: 5) { media(search, type: MANGA) }`) ; on retient le résultat dont un titre (anglais, romaji, natif, synonymes) correspond exactement une fois normalisé, sinon le premier.
- Si `scan.pub.id` est défini (fiche choisie à la main), requête directe `Media(id)`.
- Chargée dès qu'un scan n'a pas de `pub.checkedAt` (ajout, fiche modifiée), puis rafraîchie tous les **7 jours**. 2,5 s entre deux requêtes pour respecter la limite d'AniList.
- Remplit `scan.cover` si elle est vide.

---

## Historique et statistiques

- L'arrière-plan compare l'ancienne et la nouvelle liste à chaque modification (`storage.onChanged`). Pour chaque scan dont le chapitre **augmente de 1 à 10**, il ajoute la différence au jour courant dans `history`.
- Un bond de plus de 10 chapitres est considéré comme une correction (import, saisie à la main) et n'est pas compté ; une baisse n'est jamais comptée.
- `stats.js` calcule à l'ouverture : totaux sur 1/7/30 jours, série de jours consécutifs (qui continue depuis hier tant qu'aucune lecture n'a eu lieu aujourd'hui), record, top 5 sur 30 jours. Le graphique est un SVG généré à la main (une seule série, info-bulle au survol, tableau des valeurs dans « Voir les chiffres »).

---

## Sauvegarde automatique

`backupIfNeeded()` écrit `{ scans, history }` en JSON dans `Téléchargements/MesScans/mes-scans-AAAA-MM-JJ.json` via l'API `downloads`, au plus une fois tous les **7 jours** (vérifié à chaque alarme). Le bouton **Exporter** produit le même format ; **Importer** accepte aussi l'ancien format (tableau de scans seul).

---

## Ajouter un site

Pour qu'un nouveau site soit vérifié automatiquement, ajoute une entrée dans `SOURCES` (`extension/sources.js`) **avant** la source générique `liste de chapitres` :

```js
{
  name: 'mon-site',
  match: (link) => siteName(link) === 'mon-site.com',
  latest: async (link, scan) => {
    const doc = await fetchDocument(seriesUrl(link));
    if (!doc) return null;
    // … trouver le plus grand numéro de chapitre dans la page
    return 123; // ou null si introuvable
  },
},
```

- `link` : le lien du scan sur ce site (peut contenir `{ch}`).
- `latest` renvoie le **numéro** du dernier chapitre ou `null`. Une exception est capturée et journalisée sans bloquer les autres sites.
- Teste ta fonction sur une vraie page avant de publier (la console de l'arrière-plan est accessible via `about:debugging` → **Examiner**).

Si le site affiche le chapitre d'une façon que `collectChapterTexts` ne voit pas, c'est dans cette fonction (`shared.js`) qu'il faut ajouter le sélecteur.

---

## Conventions

- Code et commentaires **en français**, comme l'interface.
- Pas de dépendance ni de compilation : garder des fichiers lisibles tels quels (Mozilla les relit lors de la signature).
- `shared.js` utilise `var` pour ses constantes de haut niveau : le fichier peut être injecté deux fois dans la même page, et un `const` redéclaré y provoquerait une erreur.
- Tout texte venant d'un site ou de l'utilisateur passe par `escapeHtml` avant d'être inséré en HTML.
- Avant chaque publication : `npx web-ext lint` doit afficher **0 erreur** (les avertissements `innerHTML` sont attendus, les valeurs étant échappées).
