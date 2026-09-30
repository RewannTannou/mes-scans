# 📚 Mes Scans

Extension Firefox qui regroupe tous tes scans (mangas, manhwas, webtoons) au même endroit et **retient automatiquement le chapitre où tu en es**, quel que soit le site sur lequel tu lis.

Plus besoin de noter tes chapitres ni de passer d'un site à l'autre pour savoir s'il y a du nouveau : l'extension suit ta lecture, te prévient des sorties et t'affiche ta bibliothèque en un clic.

---

## Sommaire

- [Fonctionnalités](#fonctionnalités)
- [Sites pris en charge](#sites-pris-en-charge)
- [Installation](#installation)
- [Utilisation](#utilisation)
- [Confidentialité et permissions](#confidentialité-et-permissions)
- [Limites connues](#limites-connues)
- [Développement](#développement)
- [Structure du projet](#structure-du-projet)
- [Licence](#licence)

---

## Fonctionnalités

### Suivi automatique de la lecture
- **Chapitre détecté tout seul** quand tu lis : dans l'adresse de la page (`…/chapitre/63`), dans le titre de l'onglet (« Chapitre 63 »), ou directement dans la page (menu déroulant de chapitre, titre, fil d'Ariane).
- Fonctionne aussi sur les sites qui **changent de chapitre sans changer d'adresse** (ex. anime-sama).
- Le chapitre suit ta lecture **en avant comme en arrière**.
- **Chapitre lu jusqu'au bout** : un chapitre ne compte comme lu (statistiques) qu'une fois ses images parcourues jusqu'à la fin, ou quand tu passes au suivant. Relire un ancien chapitre ne compte pas.
- **Reprendre à la bonne page** : en revenant sur un chapitre commencé, un bandeau propose « Tu t'étais arrêté à 45 % — Reprendre ». La progression apparaît aussi sur les cartes et dans le popup.
- **Badge sur l'icône** : vert = chapitre enregistré, bleu = scan reconnu mais chapitre introuvable sur la page.
- **Raccourcis clavier** pour les sites où le chapitre n'est pas visible : `Alt+Maj+↑` (+1) et `Alt+Maj+↓` (−1).

### Bibliothèque
- Tous tes scans sous forme de cartes : couverture, statut, site, dernière lecture, chapitre actuel / dernier chapitre sorti.
- **Reprendre la lecture** : tes 5 derniers scans en cours, en haut, avec un bouton « Continuer ».
- Onglets par statut (En cours, À lire, En pause, Terminé, Abandonné) et **🔴 Nouveautés**.
- Recherche, filtre par site, tri (lu récemment, titre, ajout récent, chapitres à lire).
- Le bouton **Lire** ouvre directement ton chapitre actuel sur le dernier site où tu as lu.

### Découvrir et ajouter
- Onglet **🔍 Découvrir** : recherche de n'importe quel manga, manhwa ou webtoon sur AniList (couverture, résumé, genres, note, état de parution), ajout en un clic (« À lire » ou « Je le lis »).
- Le manga ajouté est **cherché automatiquement sur anime-sama** : son lien est rempli tout seul s'il y a des scans.
- **Recommandé pour toi** : suggestions AniList d'après les mangas de ta liste, et **tendances du moment**.
- **Importer ta liste AniList** (liste publique) à partir de ton pseudo : nouveaux mangas ajoutés, chapitres des mangas déjà suivis avancés.
- **Clic droit** sur un lien ou une page → **Ajouter à Mes Scans**.

### Lecture
- **Statuts suggérés** : « Tu as tout lu et la série est terminée → Terminé », « Pas lu depuis 1 mois → En pause », « La série continue → En cours ». Accepte ou refuse d'un clic.
- **Rattrapage** : dans l'onglet Nouveautés, le total de chapitres à lire, le temps de lecture estimé et la date à laquelle tu auras rattrapé à ton rythme habituel.
- **Version sur anime-sama** : choix entre les versions proposées (couleur / noir et blanc…) dans le formulaire ✏️.

### Nouveaux chapitres
- Vérification **toutes les heures** du dernier chapitre disponible de chaque scan.
- Onglet **🆕 Dernières sorties** : toutes les sorties détectées, regroupées par jour (aujourd'hui, hier…), en **liste** ou en **catalogue** de couvertures. Chaque sortie indique si tu l'as déjà lue, et « Lire » ouvre directement le prochain chapitre à lire. Option pour masquer les chapitres déjà lus.
- Pastille **« 201 à lire »** sur les cartes, compteur sur l'icône de l'extension.
- **Notifications** Firefox quand un chapitre sort pour un scan « En cours » (désactivables).

### État de parution
- État du **manga lui-même** (en cours, terminé, en pause, arrêté, à venir) et nombre de chapitres, récupérés sur [AniList](https://anilist.co) — et non l'état de l'anime qu'affichent certains sites.
- **Couverture officielle** ajoutée automatiquement si tu n'en as pas mis.
- Fiche AniList corrigeable à la main si le mauvais manga a été trouvé.

### Plusieurs sites et changements de domaine
- Un même manga peut être suivi sur **plusieurs sites** ; les nouveautés sont cherchées sur tous.
- Quand un site **change de domaine** (`anime-sama.to` → `anime-sama.fr`), l'extension le reconnaît et met à jour tous ses liens. Correction manuelle possible aussi.

### Statistiques
- Chapitres lus aujourd'hui, sur 7 et 30 jours, jours de lecture d'affilée, record.
- Graphique des 30 derniers jours et mangas les plus lus.

### Sauvegarde
- **Export / import** d'un fichier de sauvegarde (scans + historique).
- **Sauvegarde automatique** chaque semaine dans `Téléchargements/MesScans/` (désactivable).

---

## Sites pris en charge

Le suivi du chapitre fonctionne sur **la plupart des sites de scans**. La vérification des nouveaux chapitres dépend du site :

| Site | Suivi du chapitre | Nouveaux chapitres |
|---|---|---|
| **anime-sama** | ✅ via le menu de chapitre de la page | ✅ vérification toutes les heures |
| **Sites avec le chapitre dans l'adresse** (phenix-scans, …) | ✅ via l'adresse | ✅ lecture de la liste des chapitres sur la page du manga* |
| **Autres sites** | ✅ si le numéro apparaît dans le titre ou la page, sinon bouton +1 / raccourci | ⚠️ relevé quand tu visites la page |

\* Si le site est protégé par une page anti-robots (Cloudflare), la vérification peut échouer : le dernier chapitre est alors relevé quand tu visites la page.

Pour ajouter la prise en charge d'un site, voir [Ajouter un site](docs/ARCHITECTURE.md#ajouter-un-site).

---

## Installation

L'extension nécessite **Firefox 142 ou plus récent** (ordinateur).

### Version signée (recommandée)
1. Télécharge le fichier `.xpi` de la dernière version sur la page [Releases](https://github.com/RewannTannou/mes-scans/releases).
2. Ouvre-le avec Firefox (ou `about:addons` → roue ⚙️ → **Installer un module depuis un fichier…**).
3. Accepte les autorisations demandées.

Les versions suivantes **s'installent ensuite toutes seules** : Firefox vérifie les mises à jour environ une fois par jour. Pour vérifier tout de suite : `about:addons` → roue ⚙️ → **Rechercher des mises à jour**.

### Mode développeur (temporaire)
1. Ouvre `about:debugging#/runtime/this-firefox`.
2. **Charger un module complémentaire temporaire…** → choisis `extension/manifest.json`.

> ⚠️ Un module temporaire disparaît à la fermeture de Firefox (tes données, elles, sont conservées). Il faut le recharger à chaque démarrage.

---

## Utilisation

### Ajouter un scan
- **Depuis la page du site** (le plus simple) : ouvre un chapitre, clique sur l'icône de l'extension. Titre, chapitre et couverture sont remplis automatiquement → **Ajouter à ma liste**.
- **Depuis la bibliothèque** : **+ Ajouter un scan**, colle le lien du chapitre que tu lis. Si le numéro de chapitre est dans le lien, il est détecté et le bouton « Lire » suivra ton chapitre.

Si le manga est déjà dans ta liste (même lien ou même titre), l'extension te le montre au lieu de créer un doublon.

### Lire
Lis normalement : le chapitre s'enregistre tout seul, sans ouvrir le popup. Tu peux fermer la page quand tu veux.

Si le badge de l'icône est **bleu**, le chapitre n'a pas été trouvé sur ce site : clique sur **+1** dans le popup ou utilise `Alt+Maj+↑` après chaque chapitre.

### Même manga sur un autre site
Sur la page du nouveau site, ouvre le popup : « Tu suis déjà ce manga sur … » → **+ Ajouter ce site à ce manga**. Les autres sites se gèrent aussi dans le formulaire ✏️ (« Autres sites où tu le lis »).

### Site qui change d'adresse
Normalement automatique. Sinon : dans la bibliothèque, choisis le site dans le filtre → **✏️ Changer le domaine**.

### Mauvaise fiche AniList
Clique sur ✏️ sur la carte : le formulaire indique la fiche trouvée. Colle le lien de la bonne fiche (`https://anilist.co/manga/…`) dans **Fiche AniList** et enregistre.

### Raccourcis clavier
| Raccourci | Action |
|---|---|
| `Alt+Maj+↑` | Chapitre suivant (+1) sur la page d'un scan suivi |
| `Alt+Maj+↓` | Chapitre précédent (−1) |

Modifiables dans `about:addons` → roue ⚙️ → **Gérer les raccourcis des extensions**.

---

## Confidentialité et permissions

**Aucune donnée ne quitte ton navigateur.** Pas de compte, pas de serveur, pas de statistiques d'usage : tout est stocké localement dans Firefox (`storage.local`).

Les seules requêtes réseau faites par l'extension :
- vers **les sites de tes scans**, pour connaître le dernier chapitre sorti ;
- vers **AniList** (`graphql.anilist.co`), avec le titre du manga (état de parution, recherche, recommandations) ou ton pseudo si tu importes ta liste ;
- vers **anime-sama**, avec le titre du manga, pour trouver sa page de scans.

| Permission | Pourquoi |
|---|---|
| Accès à tous les sites | Détecter le chapitre sur la page que tu lis, quel que soit le site. Le script ne fait rien sur les pages qui ne sont pas un de tes scans. |
| `tabs` | Lire l'adresse et le titre de l'onglet pour reconnaître le chapitre. |
| `storage` | Enregistrer ta bibliothèque. |
| `scripting`, `activeTab` | Lire le titre et la couverture de la page quand tu ajoutes un scan. |
| `alarms` | Vérifier les nouveaux chapitres toutes les heures. |
| `notifications` | Te prévenir des sorties. |
| `downloads` | Enregistrer la sauvegarde automatique hebdomadaire. |
| `menus` | Ajouter « Ajouter à Mes Scans » au menu du clic droit. |

---

## Limites connues

- **Firefox ordinateur uniquement.** Firefox pour iPhone n'accepte pas les extensions ; Firefox pour Android n'a pas été testé.
- La vérification des nouveautés et les notifications ne tournent que **quand Firefox est ouvert**.
- **Pas de synchronisation** entre plusieurs appareils (utilise Exporter / Importer).
- L'état de parution AniList est celui de la **version originale** : un webtoon peut être « Terminé » en Corée alors que la traduction française n'a pas rattrapé.
- Rouvrir un ancien chapitre pour le relire fait **revenir** ton chapitre enregistré à celui-là.
- Les statistiques ne comptent que les lectures faites **depuis la version 2.0**.
- La progression dans un chapitre se mesure en **défilement** : en lecture « page par page », elle n'est pas mesurée (le chapitre compte comme lu quand tu passes au suivant).

---

## Développement

### Prérequis
- [Node.js](https://nodejs.org) 20 ou plus (tests et outils `web-ext` de Mozilla, lancés via `npx`, sans installation).
- Firefox 142+.

### Commandes utiles
Depuis la racine du projet :

```bash
npm test         # tests automatiques (node:test, sans dépendance)
npm run lint     # vérification officielle de Mozilla (web-ext lint)
npm start        # lance Firefox avec l'extension chargée (profil temporaire)
npm run build    # crée le zip dans dist/
```

### Tests et vérification automatique
Les tests se trouvent dans `tests/`. Ils chargent les vrais scripts de l'extension dans un bac à sable Node avec un faux Firefox en mémoire (`tests/helpers/extension.js`) : détection des chapitres, reconnaissance des scans, sources, comportement de l'arrière-plan (historique, sorties, raccourcis, sauvegarde…). Aucun accès réseau.

À chaque envoi sur GitHub, le workflow **Vérification** (`.github/workflows/ci.yml`) lance les tests et `web-ext lint`.

### Publier une version (automatique)
1. Augmente `version` dans `extension/manifest.json` et envoie sur `main`.
2. Le workflow **Publication** (`.github/workflows/release.yml`) :
   - fait signer l'extension par Mozilla (canal *unlisted*, non listé sur le store) ;
   - crée une [Release](https://github.com/RewannTannou/mes-scans/releases) avec le `.xpi` signé ;
   - ajoute la version à `updates.json`, le fichier que Firefox consulte via `update_url` : les installations existantes se mettent à jour toutes seules.

**Prérequis (une seule fois)** : créer des clés API sur [addons.mozilla.org › Clés API](https://addons.mozilla.org/developers/addon/api/key/), puis les ajouter dans le dépôt GitHub (**Settings › Secrets and variables › Actions**) sous les noms `AMO_JWT_ISSUER` (« émetteur JWT ») et `AMO_JWT_SECRET` (« secret JWT »). Sans ces secrets, la publication est simplement ignorée.

> Si Mozilla met la version en vérification manuelle (plus d'une heure), le workflow échoue : une fois la version approuvée, télécharge le `.xpi` depuis addons.mozilla.org et joins-le à une release à la main.

### Documentation technique
Le fonctionnement interne (modèle de données, détection des chapitres, messages entre scripts, ajout d'un site…) est décrit dans **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)**.

---

## Structure du projet

```
GroupScanSite/
├── extension/            L'extension Firefox (c'est ce dossier qui est publié)
│   ├── manifest.json     Déclaration de l'extension (permissions, scripts, raccourcis)
│   ├── shared.js         Fonctions communes : stockage, détection et reconnaissance des chapitres
│   ├── background.js     Arrière-plan : suivi des onglets, nouveautés, notifications, historique, sauvegarde
│   ├── sources.js        Dernier chapitre par site (anime-sama, liste de chapitres) + AniList
│   ├── catalog.js        Recherche / recommandations / import AniList, recherche sur anime-sama
│   ├── content.js        Script de page : surveille le chapitre affiché sur les pages de tes scans
│   ├── popup.html/js/css Menu de l'icône : scan de la page, +1/−1, ajout
│   ├── dashboard.html/js La bibliothèque
│   ├── stats.js          Fenêtre des statistiques
│   ├── releases.js       Onglet « Dernières sorties » (liste / catalogue)
│   ├── discover.js       Onglet « Découvrir »
│   ├── reading.js        Suggestions de statut, rattrapage, versions anime-sama
│   ├── style.css         Styles communs (bibliothèque et popup)
│   └── icons/            Icônes
├── docs/
│   └── ARCHITECTURE.md   Documentation technique
├── tests/                Tests automatiques (npm test)
├── scripts/
│   └── add-update.js     Ajoute une version à updates.json (utilisé par la publication)
├── .github/workflows/    Vérification (tests + lint) et publication automatique
├── updates.json          Versions disponibles, consulté par Firefox pour les mises à jour
├── package.json          Commandes npm (test, lint, build, start)
├── index.html, app.js,   Premier prototype : page web autonome, sans extension
│   style.css             (données dans le navigateur, suivi manuel)
└── dist/                 Zips générés pour Mozilla (non versionnés)
```

---

## Licence

Distribué sous licence **MIT** : tu peux utiliser, modifier et redistribuer ce code librement, à condition de conserver la mention de copyright et le texte de la licence. Voir [LICENSE](LICENSE).
