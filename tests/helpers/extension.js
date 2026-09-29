// Charge les scripts de l'extension dans un bac à sable Node, avec un faux
// « browser » (API WebExtension) en mémoire. Les scripts partagent le même
// espace global, comme dans Firefox.

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const EXT = path.join(__dirname, '..', '..', 'extension');

// Mini DOMParser : juste ce dont sources.js a besoin (liens, id, scripts en ligne)
class FakeDOMParser {
  parseFromString(html) {
    return {
      getElementById: (id) => {
        const m = html.match(new RegExp(`id="${id}"[^>]*>([^<]*)<`));
        return m ? { innerHTML: m[1] } : null;
      },
      querySelectorAll: (selector) => {
        if (selector === 'a[href]') {
          return [...html.matchAll(/<a[^>]*href="([^"]*)"/g)].map((m) => ({ getAttribute: () => m[1] }));
        }
        if (selector === 'script:not([src])') {
          return [...html.matchAll(/<script(?![^>]*src)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => ({ textContent: m[1] }));
        }
        return [];
      },
    };
  }
}

function createBrowser() {
  const listeners = {};
  const on = (name) => ({ addListener: (fn) => (listeners[name] ||= []).push(fn) });
  const fire = (name, ...args) => (listeners[name] || []).map((fn) => fn(...args));
  const store = {};
  const calls = { notifications: [], downloads: [], badges: {}, tabsCreated: [] };
  let activeTab = { id: 1, url: 'about:blank', title: '' };

  const browser = {
    storage: {
      local: {
        // Comme Firefox : on rend toujours des copies
        get: async (keys) => {
          const pick = typeof keys === 'string' ? [keys] : Array.isArray(keys) ? keys : Object.keys(store);
          return structuredClone(Object.fromEntries(pick.map((k) => [k, store[k]])));
        },
        set: async (items) => {
          const changes = {};
          for (const [k, v] of Object.entries(items)) {
            changes[k] = { oldValue: structuredClone(store[k]), newValue: structuredClone(v) };
            store[k] = structuredClone(v);
          }
          fire('storage', changes, 'local');
        },
      },
      onChanged: on('storage'),
    },
    tabs: {
      onUpdated: on('tabs'),
      query: async () => [activeTab],
      sendMessage: async () => {},
      create: (opts) => calls.tabsCreated.push(opts.url),
    },
    runtime: { onMessage: on('message'), onInstalled: on('installed'), onStartup: on('startup'), getURL: (p) => p },
    permissions: { onAdded: on('permissions'), contains: async () => true },
    alarms: { create() {}, onAlarm: on('alarm') },
    notifications: {
      create: (idOrOpts, opts) => calls.notifications.push(opts ?? idOrOpts), // l'identifiant est facultatif
      onClicked: on('notificationClick'),
      clear() {},
    },
    action: {
      setBadgeText: (o) => (calls.badges[o.tabId ?? 'global'] = o.text),
      setBadgeBackgroundColor() {},
    },
    commands: { onCommand: on('command') },
    menus: { create() {}, removeAll: async () => {}, onClicked: on('menuClick') },
    scripting: { executeScript: async () => [] },
    downloads: { download: async (opts) => calls.downloads.push(opts) },
  };

  return { browser, store, calls, fire, setActiveTab: (tab) => (activeTab = { id: 1, ...tab }) };
}

/**
 * files : scripts de extension/ à charger, dans l'ordre
 * fetch : faux fetch (par défaut : réseau coupé)
 */
function loadExtension(files, { fetch } = {}) {
  const fake = createBrowser();
  const context = vm.createContext({
    browser: fake.browser,
    fetch: fetch || (async () => ({ ok: false, status: 503 })),
    DOMParser: FakeDOMParser,
    URL: Object.assign(class extends URL {}, { createObjectURL: () => 'blob:test', revokeObjectURL() {} }),
    Blob,
    URLSearchParams,
    console: { ...console, warn() {}, error() {} }, // les échecs réseau attendus restent silencieux
    // Minuteurs accélérés : les pauses courtes (politesse envers les sites) passent
    // tout de suite, et les longues (nettoyage dans 60 s) ne bloquent pas la fin des tests
    setTimeout: (fn, ms = 0) => {
      if (ms < 10000) return setTimeout(fn, 0);
      const timer = setTimeout(fn, ms);
      timer.unref();
      return timer;
    },
    structuredClone,
    crypto,
  });
  for (const file of files) {
    vm.runInContext(fs.readFileSync(path.join(EXT, file), 'utf8'), context, { filename: file });
  }
  // Laisse passer les tâches en file d'attente de background.js
  // (`queue` est un `let` : il n'est pas visible comme propriété du contexte)
  const settle = async () => {
    for (let i = 0; i < 5; i++) {
      await new Promise((r) => setTimeout(r, 5));
      const queue = vm.runInContext('typeof queue === "undefined" ? null : queue', context);
      if (queue) await queue;
    }
  };
  return { ext: context, ...fake, settle };
}

module.exports = { loadExtension };
