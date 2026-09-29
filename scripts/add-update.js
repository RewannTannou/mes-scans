// Ajoute une version à updates.json, le fichier que Firefox consulte (via
// "update_url" dans le manifest) pour savoir qu'une mise à jour existe.
//
// Utilisation : node scripts/add-update.js <version> <lien du .xpi> <chemin du .xpi>
// Appelé par la publication automatique (.github/workflows/release.yml).

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const [version, link, xpiPath] = process.argv.slice(2);
if (!version || !link || !xpiPath) {
  console.error('Utilisation : node scripts/add-update.js <version> <lien du .xpi> <chemin du .xpi>');
  process.exit(1);
}

const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'extension', 'manifest.json'), 'utf8'));
const id = manifest.browser_specific_settings.gecko.id;
const file = path.join(__dirname, '..', 'updates.json');
const updates = JSON.parse(fs.readFileSync(file, 'utf8'));

// Empreinte du fichier : Firefox vérifie que le .xpi téléchargé est bien celui-ci
const hash = crypto.createHash('sha256').update(fs.readFileSync(xpiPath)).digest('hex');

const list = (updates.addons[id] ??= { updates: [] }).updates.filter((u) => u.version !== version);
list.unshift({ version, update_link: link, update_hash: `sha256:${hash}` });
updates.addons[id].updates = list;

fs.writeFileSync(file, `${JSON.stringify(updates, null, 2)}\n`);
console.log(`updates.json : version ${version} ajoutée (${list.length} au total)`);
