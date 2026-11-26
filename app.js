import {
  categories, categoryStyle, searchableRecipes, filterRecipes, recipeHash, readRoute,
  parseDrive, driveUrl, sameVideo, applyVideoEdits, safeLink, validateCatalog, parseYouTube,
  recipeRows, groupRows, prettyText, validateCleanup, mergeCleanup
} from './model.js';
import { checkEnvelope, deriveKey, seal, unseal } from './crypto.js';
import { icon } from './icons.js';
import { backupFileName, makeBackup, readBackup, mergeBackup, describeMerge } from './backup.js';

const root = new URL('./', import.meta.url);
const namespace = 'family-recipe-box:' + root.pathname;
const header = document.querySelector('#header');
const main = document.querySelector('#main');
const toast = document.querySelector('#toast');
const state = {
  catalog: null, key: null, envelope: null, recipes: [], byId: new Map(),
  favorites: new Set(readFavorites()), edits: {}, textEdits: {}, backTo: '#/',
  views: { cookbook: { query: '', category: '' }, favorites: { query: '', category: '' } },
  videoQuery: '', videoFilter: 'all'
};
let toastTimer;
let deferredInstall;
let starting = false;

function element(tag, attributes = {}, ...children) {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) {
    if (value !== false && value !== null && value !== undefined) {
      node.setAttribute(name, value === true ? '' : value);
    }
  }
  for (const child of children.flat(Infinity)) {
    if (child !== null && child !== undefined && child !== false) node.append(child);
  }
  return node;
}

const p = (content, className) => element('p', { class: className }, content);
const button = (label, className, onclick, glyph) => {
  const control = element('button', { type: 'button', class: className }, glyph && icon(glyph), label);
  control.addEventListener('click', onclick);
  return control;
};
const anchor = (label, href, className, glyph) => element('a', {
  href, class: className
}, glyph && icon(glyph), label);
const outside = (label, url, className) => element('a', {
  class: className, href: url, target: '_blank', rel: 'noopener noreferrer'
}, icon('external'), label);

function storageGet(name) {
  try { return localStorage.getItem(namespace + ':' + name); }
  catch { return null; }
}

function storageSet(name, value) {
  try {
    if (value === null) localStorage.removeItem(namespace + ':' + name);
    else localStorage.setItem(namespace + ':' + name, value);
    return true;
  } catch { return false; }
}

function readFavorites() {
  try {
    const ids = JSON.parse(storageGet('favorites'));
    return Array.isArray(ids) ? ids.filter(id => /^\d{3}$/.test(id)) : [];
  } catch { return []; }
}

function keyStore(mode, action) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(namespace, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('device');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      try {
        const transaction = db.transaction('device', mode);
        const operation = action(transaction.objectStore('device'));
        transaction.oncomplete = () => { db.close(); resolve(operation.result); };
        transaction.onabort = transaction.onerror = () => { db.close(); reject(transaction.error); };
      } catch (error) {
        db.close();
        reject(error);
      }
    };
  });
}

function notify(message) {
  toast.textContent = message;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.textContent = ''; }, 4200);
}

async function loadCatalog() {
  const response = await fetch(new URL('catalog.enc.json', root), { cache: 'no-cache' });
  if (!response.ok) throw new Error('Cookbook unavailable');
  state.envelope = checkEnvelope(await response.json());
}

const editKey = id => 'edit:' + id;

async function loadTextEdits(key) {
  const records = await keyStore('readonly', store =>
    store.getAll(IDBKeyRange.bound('edit:', 'edit:\uffff'))).catch(() => []);
  const found = {};
  await Promise.all(records.map(async record => {
    try { found[record.id] = await unseal(record.envelope, key, editKey(record.id)); }
    catch { /* A damaged local edit is skipped; the original recipe still shows. */ }
  }));
  return found;
}

function rebuildRecipes() {
  state.recipes = searchableRecipes(state.catalog.recipes, state.textEdits);
  state.byId = new Map(state.recipes.map(recipe => [recipe.id, recipe]));
}

async function unlock(key) {
  const catalog = validateCatalog(await unseal(state.envelope, key));
  const textEdits = await loadTextEdits(key);
  const edits = {};
  await Promise.all(catalog.recipes.map(async recipe => {
    const storageName = 'video:' + recipe.id;
    const saved = storageGet(storageName);
    if (!saved) return;
    try {
      const envelope = JSON.parse(saved);
      if (envelope.salt !== state.envelope.salt) return;
      const edit = await unseal(envelope, key, storageName);
      if (sameVideo(catalog.videos[recipe.id], edit)) storageSet(storageName, null);
      else edits[recipe.id] = edit;
    } catch { /* A damaged local draft can be replaced from the editor. */ }
  }));
  state.catalog = catalog;
  state.key = key;
  state.edits = edits;
  state.textEdits = textEdits;
  rebuildRecipes();
}

async function start() {
  renderHeader('locked');
  if (!window.isSecureContext || !crypto.subtle) {
    initialError('Open the HTTPS site to unlock the cookbook.');
    return;
  }
  if (starting) return;
  starting = true;
  main.replaceChildren(element('section', { class: 'startup', role: 'status' }, 'Opening the recipe box…'));
  let storedKey;
  try {
    await loadCatalog();
    storedKey = await keyStore('readonly', store => store.get('unlock')).catch(() => null);
  } catch {
    initialError('The cookbook could not load. Check your connection and try again.');
    return;
  } finally {
    starting = false;
  }
  if (storedKey?.salt === state.envelope.salt) {
    try { await unlock(storedKey.key); }
    catch { /* The passphrase form remains available. */ }
  }
  renderRoute(false);
}


function renderHeader(page) {
  const logo = element('a', { href: '#/', class: 'brand', 'aria-label': 'Family Recipe Box home' },
    element('span', { class: 'brand-mark' }, icon('book')), element('span', {}, 'Recipe Box'));
  header.replaceChildren(logo);
  if (!state.catalog) return;
  const nav = element('nav', { 'aria-label': 'Main', class: 'nav' });
  for (const [id, label, glyph, href] of [
    ['cookbook', 'Cookbook', 'book', '#/'],
    ['favorites', 'Favorites', 'heart', '#/favorites'],
    ['my-recipes', 'My Recipes', 'book', '#/my-recipes'],
    ['videos', 'Videos', 'video', '#/videos']
  ]) {
    const link = anchor(label, href, 'nav-item', glyph);
    if (page === id || (page === 'recipe' && id === 'cookbook')) link.setAttribute('aria-current', 'page');
    nav.append(link);
  }
  header.append(nav);
}

function initialError(message) {
  main.replaceChildren(element('section', { class: 'empty panel' },
    element('h1', {}, 'Recipe Box'), p(message),
    button('Try again', 'button primary', () => location.reload())));
}

function renderLock() {
  document.title = 'Family Recipe Box';
  const passphrase = element('input', {
    id: 'passphrase', type: 'password', required: true, autocomplete: 'current-password',
    autocapitalize: 'none', spellcheck: 'false', placeholder: 'Family passphrase'
  });
  const remember = element('input', { type: 'checkbox', id: 'remember', checked: true });
  const submit = element('button', { type: 'submit', class: 'button primary' }, 'Unlock cookbook', icon('arrow'));
  const status = element('p', { role: 'alert', class: 'form-status' });
  const form = element('form', { class: 'unlock-form' },
    element('label', { for: 'passphrase', class: 'field-label' }, 'Passphrase'),
    passphrase,
    element('label', { class: 'check-label' }, remember, 'Remember on this device'),
    submit, status);
  form.addEventListener('submit', async event => {
    event.preventDefault();
    submit.disabled = true;
    submit.firstChild.textContent = 'Unlocking…';
    status.textContent = '';
    try {
      const key = await deriveKey(passphrase.value, state.envelope.salt);
      await unlock(key);
      passphrase.value = '';
      if (remember.checked) {
        try {
          await keyStore('readwrite', store => store.put({ salt: state.envelope.salt, key }, 'unlock'));
        } catch { notify('This browser could not remember the unlock.'); }
      }
      renderRoute(true);
    } catch {
      status.textContent = 'That passphrase didn’t unlock the cookbook. Try again.';
      passphrase.focus();
    } finally {
      submit.disabled = false;
      submit.firstChild.textContent = 'Unlock cookbook';
    }
  });
  main.replaceChildren(element('section', { class: 'lock-layout' },
    element('div', { class: 'hero lock-hero' }, heroArt(),
      element('div', { class: 'hero-text' }, element('h1', {}, 'Family Recipe Box'))),
    element('div', { class: 'panel unlock-panel' },
      element('span', { class: 'brand-mark' }, icon('lock')),
      element('h2', {}, 'Open the cookbook'),
      p('Enter your passphrase.', 'muted'), form)));
}

function heroArt() {
  return element('div', { class: 'hero-art', 'aria-hidden': 'true' },
    element('div', { class: 'art-grid' }),
    element('div', { class: 'art-plate' }, icon('dish')),
    element('div', { class: 'art-diamond one' }), element('div', { class: 'art-diamond two' }));
}

function searchBox(id, value, placeholder, change) {
  const input = element('input', { type: 'search', id, value, placeholder, 'aria-label': placeholder,
    autocapitalize: 'none', spellcheck: 'false' });
  input.addEventListener('input', () => change(input.value));
  return element('div', { class: 'search-field' }, icon('search'), input);
}

function categoryBadge(recipe) {
  const [style, glyph] = categoryStyle[recipe.category];
  return element('span', { class: 'badge tone-' + style }, icon(glyph), recipe.category);
}

function favoriteButton(recipe, after) {
  const control = button('', 'icon-button favorite-button', () => {
    const marked = !state.favorites.has(recipe.id);
    if (marked) state.favorites.add(recipe.id);
    else state.favorites.delete(recipe.id);
    const saved = storageSet('favorites', JSON.stringify([...state.favorites]));
    update();
    after?.(control);
    notify(saved ? (marked ? 'Added to favorites' : 'Removed from favorites') : 'Favorites are available for this visit.');
  }, 'heart');
  function update() {
    const marked = state.favorites.has(recipe.id);
    control.setAttribute('aria-pressed', String(marked));
    control.setAttribute('aria-label', 'Favorite ' + recipe.title);
    control.title = marked ? 'Remove from favorites' : 'Add to favorites';
  }
  update();
  return control;
}

function videoFor(id) {
  return Object.hasOwn(state.edits, id) ? state.edits[id] : state.catalog.videos[id];
}

function recipeCard(recipe, page, afterFavorite) {
  const [, glyph] = categoryStyle[recipe.category];
  const [style] = categoryStyle[recipe.category];
  const titleLink = anchor(recipe.title, recipeHash(recipe.id), 'card-link');
  titleLink.addEventListener('click', () => {
    state.backTo = page === 'favorites' ? '#/favorites' : '#/';
    state.views[page].scroll = window.scrollY;
  });
  const info = [recipe.category, videoFor(recipe.id) ? 'Video' : (recipe.categoryReview === 'Review' ? 'Category under review' : '')]
    .filter(Boolean).join(' · ');
  return element('article', { class: 'recipe-card' },
    element('span', { class: 'category-symbol tone-' + style }, icon(glyph)),
    element('div', { class: 'card-body' },
      p(info, 'card-category'), element('h3', {}, titleLink), p(recipe.creator, 'creator')),
    favoriteButton(recipe, afterFavorite));
}

function renderCollection(page) {
  const favorites = page === 'favorites';
  const view = state.views[page];
  const grid = element('div', { class: 'recipe-grid' });
  const count = element('span', { class: 'result-count', 'aria-live': 'polite' });
  const filters = element('div', { class: 'filter-row', role: 'group', 'aria-label': 'Filter by category' });
  const clear = button('Clear filters', 'text-button', () => {
    view.query = '';
    view.category = '';
    search.querySelector('input').value = '';
    updateFilters();
    updateResults();
    search.querySelector('input').focus();
  });
  const search = searchBox('recipe-search', view.query, 'Search recipes, ingredients, or creators', value => {
    view.query = value;
    updateResults();
  });
  function updateFilters() {
    for (const chip of filters.children) {
      chip.setAttribute('aria-pressed', String(chip.dataset.category === view.category));
    }
  }
  for (const category of ['', ...categories]) {
    const chip = button(category || 'All', 'filter-chip', () => {
      view.category = category;
      updateFilters();
      updateResults();
    });
    chip.dataset.category = category;
    filters.append(chip);
  }
  function updateResults() {
    const matches = filterRecipes(state.recipes, {
      query: view.query, category: view.category, favorites: favorites ? state.favorites : null
    });
    count.textContent = matches.length + (matches.length === 1 ? ' entry' : ' entries');
    clear.hidden = !(view.query || view.category);
    if (matches.length) {
      grid.replaceChildren(...matches.map(recipe => recipeCard(recipe, page, favorites ? old => {
        const focusIndex = [...grid.querySelectorAll('.favorite-button')].indexOf(old);
        updateResults();
        const remaining = grid.querySelectorAll('.favorite-button');
        (remaining[Math.min(focusIndex, remaining.length - 1)] || search.querySelector('input')).focus();
      } : null)));
    } else {
      grid.replaceChildren(element('div', { class: 'empty panel' }, icon(favorites ? 'heart' : 'search'),
        element('h3', {}, favorites && !state.favorites.size ? 'No favorites yet' : 'No matching recipes'),
        p(favorites && !state.favorites.size ? 'Tap the heart on a recipe to save it here.' : 'Try a different search or category.')));
    }
  }
  const hero = favorites
    ? element('section', { class: 'page-heading' },
      element('h1', {}, 'Favorites'), p('Your saved recipes on this device.', 'muted'))
    : element('section', { class: 'hero' }, heroArt(), element('div', { class: 'hero-text' },
      element('h1', {}, 'Family Recipe Box')));
  main.replaceChildren(hero,
    element('section', { class: 'collection', 'aria-labelledby': 'collection-heading' },
      search, filters,
      element('div', { class: 'section-heading' },
        element('h2', { id: 'collection-heading' }, favorites ? 'Saved recipes' : (view.category || 'All recipes')),
        count, clear),
      grid),
    footer());
  const heading = main.querySelector('#collection-heading');
  filters.addEventListener('click', () => { heading.textContent = favorites ? 'Saved recipes' : (view.category || 'All recipes'); });
  clear.addEventListener('click', () => { heading.textContent = favorites ? 'Saved recipes' : 'All recipes'; });
  updateFilters();
  updateResults();
}

const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;

function footer() {
  return element('footer', { class: 'footer' },
    !isStandalone() && anchor('Add to your home screen', '#/install', 'text-link', 'phone'));
}

function recipeUrl(id) {
  const url = new URL(root);
  url.hash = recipeHash(id);
  return url.href;
}

async function copyRecipeLink(id) {
  const url = recipeUrl(id);
  try {
    await navigator.clipboard.writeText(url);
    notify('Recipe link copied');
  } catch {
    const field = main.querySelector('#permalink');
    field.hidden = false;
    field.value = url;
    field.focus();
    field.select();
  }
}

const splitRows = value => value.split(/\r?\n|;\s+/).map(item => item.trim()).filter(Boolean);

function textList(value, steps = false) {
  const groups = groupRows(recipeRows(value));
  if (!groups.length) return p(steps ? 'No written steps saved. Follow the video.' : 'Ingredients are unavailable.', 'muted');
  const count = groups.reduce((total, group) => total + group.items.length, 0);
  if (count === 1 && groups.length === 1 && !groups[0].heading) return p(prettyText(groups[0].items[0]), 'recipe-copy');
  return element('div', { class: 'recipe-groups' }, groups.map(group => [
    group.heading && element('h4', { class: 'recipe-group' }, prettyText(group.heading)),
    group.items.length > 0 && element(steps ? 'ol' : 'ul', { class: 'recipe-list' },
      group.items.map(row => element('li', {}, prettyText(row))))
  ]));
}

function recipeText(title, copy, description) {
  return element('section', { class: 'panel recipe-text' },
    element('h2', {}, title),
    description && p(description, 'source-label'),
    element('div', { class: 'recipe-columns' },
      element('div', {}, element('h3', {}, 'Ingredients'), textList(copy.ingredients)),
      element('div', {}, element('h3', {}, 'Instructions'), textList(copy.method, true))));
}

const checkLabel = cleaned => cleaned.check === 'video'
  ? 'Checked against the video.'
  : 'Not checked against the video. Amounts come from the written source.';

function renderVideo(recipe) {
  const video = videoFor(recipe.id);
  const panel = element('section', { class: 'panel video-panel' }, element('h2', {}, 'Recipe video'));
  if (!video) {
    panel.append(element('div', { class: 'video-placeholder' }, icon('video'), p('Video hasn’t been added yet.')),
      anchor('Add Drive link', '#/videos/' + recipe.id, 'text-link', 'link'));
    return panel;
  }
  return videoPanel(recipe.title, driveUrl(video, 'preview'), driveUrl(video), 'Google Drive', panel);
}

function videoPanel(title, embed, external, provider, panel = element('section', { class: 'panel video-panel' },
  element('h2', {}, 'Recipe video'))) {
  const placeholder = element('div', { class: 'video-placeholder with-video' },
    button('Load video', 'button primary', () => {
      const frame = element('iframe', {
        class: 'drive-player', src: embed, title: 'Video for ' + title,
        allow: 'autoplay; fullscreen; encrypted-media; picture-in-picture',
        allowfullscreen: true, referrerpolicy: 'strict-origin-when-cross-origin'
      });
      placeholder.replaceWith(frame);
      frame.focus();
    }, 'play'));
  panel.append(placeholder, outside('Open in ' + provider, external, 'text-link'));
  return panel;
}

let wakeLock = null;
async function holdScreen() {
  try { wakeLock = await navigator.wakeLock?.request('screen') || null; }
  catch { wakeLock = null; }
  return Boolean(wakeLock);
}

function openCooking(title, sources, opener) {
  let index = 0;
  const overlay = element('div', { class: 'cooking', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Cooking mode: ' + title });
  const body = element('div', { class: 'cooking-body' });
  const awake = element('p', { class: 'cooking-awake', role: 'status' });
  const tabs = sources.length > 1 && element('div', { class: 'cooking-tabs', role: 'group', 'aria-label': 'Recipe version' },
    sources.map((source, position) => {
      const tab = button(source.label, 'filter-chip', () => { index = position; render(); });
      tab.dataset.position = position;
      return tab;
    }));

  function checklist(value, ordered) {
    const groups = groupRows(recipeRows(value));
    if (!groups.length) return p(ordered ? 'Instructions are unavailable.' : 'Ingredients are unavailable.', 'muted');
    const count = groups.reduce((total, group) => total + group.items.length, 0);
    if (count === 1 && groups.length === 1 && !groups[0].heading) return p(prettyText(groups[0].items[0]), 'cook-copy');
    return element('div', {}, groups.map(group => [
      group.heading && element('h3', { class: 'cook-group' }, prettyText(group.heading)),
      group.items.length > 0 && element(ordered ? 'ol' : 'ul', { class: 'cook-list' }, group.items.map((row, position) =>
        element('li', {}, element('label', { class: 'cook-item' },
          element('input', { type: 'checkbox' }),
          element('span', {}, ordered && element('b', { class: 'cook-step' }, String(position + 1)), prettyText(row))))))
    ]));
  }

  function render() {
    const source = sources[index];
    if (tabs) for (const tab of tabs.children) tab.setAttribute('aria-pressed', String(Number(tab.dataset.position) === index));
    body.replaceChildren(
      element('h2', {}, 'Ingredients'), checklist(source.ingredients, false),
      element('h2', {}, 'Instructions'), checklist(source.method, true));
  }

  const onKey = event => { if (event.key === 'Escape') close(); };
  const onVisible = () => { if (document.visibilityState === 'visible' && overlay.isConnected) void holdScreen(); };
  function close() {
    overlay.remove();
    document.body.classList.remove('cooking-open');
    header.inert = false;
    main.inert = false;
    wakeLock?.release().catch(() => {});
    wakeLock = null;
    document.removeEventListener('keydown', onKey);
    document.removeEventListener('visibilitychange', onVisible);
    window.removeEventListener('hashchange', close);
    opener?.focus();
  }

  const closeButton = button('Done', 'button secondary', close, 'check');
  overlay.append(element('div', { class: 'cooking-inner' },
    element('div', { class: 'cooking-top' }, element('h1', {}, title), closeButton),
    tabs, awake, body));
  render();
  header.inert = true;
  main.inert = true;
  document.body.classList.add('cooking-open');
  document.body.append(overlay);
  document.addEventListener('keydown', onKey);
  document.addEventListener('visibilitychange', onVisible);
  window.addEventListener('hashchange', close);
  closeButton.focus();
  void holdScreen().then(held => { awake.textContent = held ? 'Screen will stay on while you cook.' : ''; });
}

const customPath = '#/my-recipes';
const customKey = id => 'custom:' + id;

async function renderMyRecipes(route) {
  const hash = location.hash;
  const key = state.key;
  const current = () => state.key === key && location.hash === hash;
  const heading = element('section', { class: 'page-heading' }, element('h1', {}, 'My Recipes'),
    p('Saved on this device.', 'muted'));
  main.replaceChildren(heading, p('Loading recipes…', 'muted'));
  try {
    const records = route.id
      ? [await keyStore('readonly', store => store.get(customKey(route.id)))].filter(Boolean)
      : route.edit ? [] : await keyStore('readonly', store =>
        store.getAll(IDBKeyRange.bound('custom:', 'custom:\uffff')));
    const recipes = await Promise.all(records.map(async record => {
      const recipe = await unseal(record.envelope, key, customKey(record.id));
      return { ...recipe, id: record.id };
    }));
    if (!current()) return;
    const recipe = recipes[0];
    if (route.id && !recipe) return renderMissing();
    if (route.edit) {
      main.replaceChildren(anchor('Back to My Recipes', customPath, 'back text-link', 'back'),
        customForm(recipe, current), footer());
      return;
    }
    if (route.id) {
      document.title = recipe.title + ' · Recipe Box';
      const content = element('div', { class: 'detail-content' },
        (recipe.ingredients || recipe.method) && recipeText('Recipe', recipe),
        recipe.notes && element('section', { class: 'panel recipe-text' }, element('h2', {}, 'Notes'),
          p(recipe.notes, 'caption-copy')));
      const video = recipe.youtube && videoPanel(recipe.title,
        'https://www.youtube.com/embed/' + recipe.youtube + '?playsinline=1&rel=0',
        'https://www.youtube.com/watch?v=' + recipe.youtube, 'YouTube');
      main.replaceChildren(anchor('Back to My Recipes', customPath, 'back text-link', 'back'),
        element('section', { class: 'detail-heading' }, recipe.category && categoryBadge(recipe),
          element('h1', {}, recipe.title),
          element('div', { class: 'detail-actions' },
            (recipe.ingredients || recipe.method) && button('Cook mode', 'button primary',
              event => openCooking(recipe.title, [{ ingredients: recipe.ingredients, method: recipe.method }],
                event.currentTarget), 'dish'),
            anchor('Edit recipe', customPath + '/' + recipe.id + '/edit', 'button secondary'))),
        element('div', { class: 'custom-detail' }, video, content), footer());
      return;
    }
    heading.append(anchor('Add recipe or Short', customPath + '/new', 'button primary custom-add'));
    const list = element('div', { class: 'video-list' }, recipes.sort((a, b) => b.updated - a.updated).map(item =>
      anchor([element('span', { class: 'video-title' }, item.title),
        element('span', { class: 'video-state' }, item.youtube ? 'YouTube video' : item.category)],
      customPath + '/' + item.id, 'video-row custom-row')));
    main.replaceChildren(heading, recipes.length ? list : p('Your saved recipes and Shorts will appear here.', 'muted'), backupPanel(), footer());
  } catch {
    if (current()) main.replaceChildren(heading, p('Saved recipes could not be opened on this device.', 'form-status'));
  }
}

async function readCustomRecipes() {
  const key = state.key;
  const records = await keyStore('readonly', store => store.getAll(IDBKeyRange.bound('custom:', 'custom:￿')));
  return Promise.all(records.map(async record =>
    ({ id: record.id, recipe: await unseal(record.envelope, key, customKey(record.id)) })));
}

function snapshot(recipes) {
  return { favorites: [...state.favorites], recipes, videos: state.edits, edits: state.textEdits };
}

async function exportBackup(control, refresh) {
  const key = state.key;
  control.disabled = true;
  try {
    const envelope = await makeBackup(snapshot(await readCustomRecipes()), key, state.envelope.salt);
    if (state.key !== key) return;
    const name = backupFileName();
    const text = JSON.stringify(envelope) + '\n';
    const file = new File([text], name, { type: 'text/plain' });
    let shared = false;
    if (navigator.canShare?.({ files: [file] })) {
      try { await navigator.share({ files: [file], title: 'Recipe Box backup' }); shared = true; }
      catch (error) { if (error?.name === 'AbortError') return; }
    }
    if (!shared) saveBlob(name, text);
    storageSet('lastBackup', String(Date.now()));
    refresh();
    notify('Backup ready');
  } catch {
    notify('The backup could not be created. Try again.');
  } finally {
    control.disabled = false;
  }
}

async function importBackup(file, status, refresh) {
  const key = state.key;
  status.textContent = '';
  try {
    const incoming = await readBackup(await file.text(), key, state.envelope.salt);
    const local = snapshot(await readCustomRecipes());
    const merged = mergeBackup(local, incoming);
    const sealed = await Promise.all([
      ...merged.recipes.map(async ({ id, recipe }) =>
        ({ id, name: customKey(id), envelope: await seal(recipe, key, state.envelope.salt, customKey(id)) })),
      ...Object.entries(merged.edits).map(async ([id, edit]) =>
        ({ id, name: editKey(id), envelope: await seal(edit, key, state.envelope.salt, editKey(id)) }))
    ]);
    if (state.key !== key) return;
    if (sealed.length) {
      await keyStore('readwrite', store => {
        let request;
        for (const { id, name, envelope } of sealed) request = store.put({ id, envelope }, name);
        return request;
      });
      Object.assign(state.textEdits, merged.edits);
      rebuildRecipes();
    }
    for (const [id, video] of Object.entries(merged.videos)) await writeVideoEdit(id, video);
    state.favorites = new Set(merged.favorites);
    storageSet('favorites', JSON.stringify(merged.favorites));
    refresh();
    notify(describeMerge(merged.summary));
    if (state.key === key && location.hash.startsWith(customPath)) void renderMyRecipes(readRoute(location.hash));
  } catch (error) {
    status.textContent = error?.message?.startsWith('That') || error?.message?.startsWith('This')
      ? error.message : 'The backup could not be imported. Nothing was changed.';
  }
}

function backupPanel() {
  const when = element('p', { class: 'help' });
  const status = element('p', { role: 'alert', class: 'form-status' });
  const refresh = () => {
    const last = Number(storageGet('lastBackup'));
    when.textContent = last ? 'Last backup from this device: ' + new Date(last).toLocaleDateString(undefined,
      { year: 'numeric', month: 'short', day: 'numeric' }) + '.' : 'No backup made from this device yet.';
  };
  refresh();
  const picker = element('input', { type: 'file', accept: '.json,application/json,text/plain', hidden: true });
  picker.addEventListener('change', async () => {
    const [file] = picker.files;
    picker.value = '';
    if (file) await importBackup(file, status, refresh);
  });
  const save = button('Back up', 'button secondary', () => exportBackup(save, refresh), 'download');
  const load = button('Import backup', 'button secondary', () => picker.click(), 'arrow');
  return element('section', { class: 'panel export-panel backup-panel' },
    element('div', {},
      element('h2', {}, 'Backup and sync'),
      p('Your recipes, recipe edits, favorites and video links live on each device (the home screen app and Safari count separately). ' +
        'Back up here, then import on another device to bring it up to date. Backups are encrypted with your passphrase.', 'muted'),
      when, status),
    element('div', { class: 'detail-actions backup-actions' }, save, load, picker));
}

function customForm(recipe, current) {
  const fields = [
    ['title', 'Recipe name', 'input', 150], ['ingredients', 'Ingredients', 'textarea', 8000],
    ['method', 'Instructions', 'textarea', 12000], ['notes', 'Notes', 'textarea', 8000],
    ['youtube', 'YouTube Short or video link', 'input', 500]
  ];
  const category = element('select', { name: 'category', id: 'custom-category' },
    element('option', { value: '' }, 'Choose a category'),
    categories.filter(name => !['Unclear', 'Non-recipe'].includes(name)).map(name =>
      element('option', { value: name, selected: recipe?.category === name }, name)));
  const status = element('p', { role: 'alert', class: 'form-status' });
  const submit = element('button', { type: 'submit', class: 'button primary' }, 'Save recipe');
  const form = element('form', { class: 'video-form custom-form' },
    fields.map(([name, label, tag, maxlength]) => {
      const value = name === 'youtube' && recipe?.youtube
        ? 'https://www.youtube.com/shorts/' + recipe.youtube : recipe?.[name] || '';
      const input = element(tag, { name, id: 'custom-' + name, maxlength, required: name === 'title',
        ...(tag === 'textarea' ? { rows: 4 } : { type: name === 'youtube' ? 'url' : 'text', value }) });
      if (tag === 'textarea') input.value = value;
      return element('label', { class: 'custom-field', for: 'custom-' + name },
        element('span', { class: 'field-label' }, label), input);
    }),
    element('label', { class: 'custom-field', for: 'custom-category' },
      element('span', { class: 'field-label' }, 'Category'), category), submit, status);
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const entry = Object.fromEntries([...new FormData(form)].map(([name, value]) => [name, value.trim()]));
    const youtube = entry.youtube ? parseYouTube(entry.youtube) : null;
    if (!entry.title || (entry.youtube && !youtube)) {
      status.textContent = !entry.title ? 'Enter a recipe name.' : 'Paste a valid YouTube Shorts or watch link.';
      return;
    }
    const id = recipe?.id || crypto.randomUUID();
    submit.disabled = true;
    status.textContent = '';
    try {
      const envelope = await seal({ ...entry, youtube, updated: Date.now() },
        state.key, state.envelope.salt, customKey(id));
      if (!current()) return;
      await keyStore('readwrite', store => store.put({ id, envelope }, customKey(id)));
      if (current()) location.hash = customPath + '/' + id;
    } catch {
      status.textContent = 'The recipe could not be saved on this device. Try again.';
    } finally {
      submit.disabled = false;
    }
  });
  if (recipe) form.append(button('Delete recipe', 'text-button', async event => {
    if (!confirm('Delete this recipe from this device?')) return;
    event.currentTarget.disabled = true;
    try {
      await keyStore('readwrite', store => store.delete(customKey(recipe.id)));
      if (current()) location.hash = customPath;
    } catch {
      status.textContent = 'The recipe could not be deleted.';
      form.querySelector('button.text-button').disabled = false;
    }
  }));
  return element('section', { class: 'panel video-editor custom-editor' },
    element('h1', {}, recipe ? 'Edit recipe' : 'Add recipe or Short'),
    p('A name and a YouTube link are enough to save a Short.', 'muted'), form);
}

function renderRecipeEditor(recipe) {
  document.title = 'Edit · ' + recipe.title;
  const mine = state.textEdits[recipe.id];
  const bases = [
    recipe.cleaned && (recipe.cleaned.ingredients || recipe.cleaned.method) && { label: 'Cleaned recipe', ...recipe.cleaned },
    (recipe.original.ingredients || recipe.original.method) && { label: 'Saved caption', ...recipe.original },
    (recipe.published.ingredients || recipe.published.method) && { label: 'Published version', ...recipe.published }
  ].filter(Boolean);
  const rows = value => value ? recipeRows(value).join('\n') : '';
  const first = mine || bases[0] || {};
  let dirty = false;
  const ingredients = element('textarea', { id: 'edit-ingredients', rows: 9, maxlength: 8000 });
  const method = element('textarea', { id: 'edit-method', rows: 12, maxlength: 12000 });
  const fill = source => { ingredients.value = rows(source.ingredients); method.value = rows(source.method); };
  fill(first);
  for (const field of [ingredients, method]) field.addEventListener('input', () => { dirty = true; });
  const status = element('p', { role: 'alert', class: 'form-status' });
  const submit = element('button', { type: 'submit', class: 'button primary' }, 'Save', icon('check'));
  const base = !mine && bases.length > 1 && element('select', { id: 'edit-base', 'aria-label': 'Start from' },
    bases.map(source => element('option', { value: source.label }, 'Start from: ' + source.label)));
  base && base.addEventListener('change', () => {
    if (!dirty) fill(bases.find(source => source.label === base.value));
  });
  const back = recipeHash(recipe.id);
  const form = element('form', { class: 'video-form custom-form' },
    base,
    element('label', { class: 'custom-field', for: 'edit-ingredients' },
      element('span', { class: 'field-label' }, 'Ingredients (one per line)'), ingredients),
    element('label', { class: 'custom-field', for: 'edit-method' },
      element('span', { class: 'field-label' }, 'Instructions (one step per line)'), method),
    element('div', { class: 'detail-actions' }, submit, anchor('Cancel', back, 'button secondary')), status);
  const key = state.key;
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const edit = { ingredients: ingredients.value.trim(), method: method.value.trim(), updated: Date.now() };
    if (!edit.ingredients && !edit.method) {
      status.textContent = 'Add at least one ingredient or step, or use Reset to original.';
      return;
    }
    submit.disabled = true;
    status.textContent = '';
    try {
      const envelope = await seal(edit, key, state.envelope.salt, editKey(recipe.id));
      if (state.key !== key) return;
      await keyStore('readwrite', store => store.put({ id: recipe.id, envelope }, editKey(recipe.id)));
      state.textEdits[recipe.id] = edit;
      rebuildRecipes();
      notify('Saved on this device');
      location.hash = back;
    } catch {
      status.textContent = 'This could not be saved on this device. Try again.';
    } finally {
      submit.disabled = false;
    }
  });
  if (mine) form.querySelector('.detail-actions').append(button('Reset to original', 'text-button', async event => {
    if (!confirm('Discard your edits and go back to the original ingredients and steps?')) return;
    event.currentTarget.disabled = true;
    try {
      await keyStore('readwrite', store => store.delete(editKey(recipe.id)));
      delete state.textEdits[recipe.id];
      rebuildRecipes();
      notify('Back to the original');
      location.hash = back;
    } catch {
      status.textContent = 'The original could not be restored. Try again.';
      event.currentTarget.disabled = false;
    }
  }));
  main.replaceChildren(anchor('Back to recipe', back, 'back text-link', 'back'),
    element('section', { class: 'panel video-editor custom-editor' },
      element('h1', {}, 'Edit ' + recipe.title),
      p('Fix mistakes or make it your own. The original stays safe and you can reset anytime. ' +
        'Saved on this device; use Back up on the My Recipes page to copy edits to another device.', 'muted'),
      form),
    footer());
}

function renderRecipe(recipe) {
  document.title = recipe.title + ' · Recipe Box';
  const hasOriginal = recipe.original.ingredients || recipe.original.method;
  const hasPublished = recipe.published.ingredients || recipe.published.method;
  const sources = recipe.published.urls.map(safeLink).filter(Boolean);
  const original = safeLink(recipe.original.url);
  const recipeBlocks = [];
  const mine = state.textEdits[recipe.id];
  const cleaned = recipe.cleaned && (recipe.cleaned.ingredients || recipe.cleaned.method) ? recipe.cleaned : null;
  const cookSources = [
    mine && { label: 'My version', ...mine },
    ...(recipe.category === 'Non-recipe' ? [] : cleaned
      ? [{ label: 'Recipe', ...cleaned }]
      : [
        hasOriginal && { label: 'Saved caption', ...recipe.original },
        hasPublished && { label: 'Published version', ...recipe.published }
      ])
  ].filter(Boolean);
  if (mine) recipeBlocks.push(recipeText('My version', mine, 'Edited on this device. The original text is below.'));
  if (recipe.category === 'Non-recipe') {
    recipeBlocks.push(element('section', { class: 'panel recipe-text' },
      element('h2', {}, 'Saved post'), p('The workbook marks this entry as a non-recipe.', 'muted')));
  } else if (cleaned) {
    recipeBlocks.push(recipeText(mine ? 'Cleaned recipe' : 'Recipe', cleaned, checkLabel(cleaned)));
    if (hasOriginal || hasPublished) {
      recipeBlocks.push(element('details', { class: 'panel source-versions' },
        element('summary', {}, 'Original text before cleanup'),
        recipe.original.note && p(recipe.original.note, 'source-note'),
        recipe.published.note && p(recipe.published.note, 'source-note'),
        hasOriginal && recipeText('From the saved caption', recipe.original),
        hasPublished && recipeText('Published recipe candidate', recipe.published,
          'Exact match to the saved TikTok is unverified.')));
    }
  } else {
    if (hasOriginal) recipeBlocks.push(recipeText('From the saved caption', recipe.original));
    if (hasPublished) recipeBlocks.push(recipeText('Published recipe candidate', recipe.published,
      'Exact match to the saved TikTok is unverified.'));
    if (!hasOriginal && !hasPublished && !mine) recipeBlocks.push(element('section', { class: 'panel recipe-text' },
      element('h2', {}, 'Recipe details'), p('Ingredients and instructions are unavailable in the workbook.', 'muted')));
  }
  const notes = element('section', { class: 'panel recipe-text' }, element('h2', {}, 'Notes & sources'),
    recipe.categoryNote && p('Category review. ' + recipe.categoryNote, 'source-note'),
    cleaned && cleaned.notes.map(note => p(note, 'source-note')),
    !cleaned && recipe.original.note && p(recipe.original.note, 'source-note'),
    !cleaned && recipe.published.note && p(recipe.published.note, 'source-note'),
    recipe.description && element('details', { class: 'caption' }, element('summary', {}, 'Original caption'),
      p(recipe.description, 'caption-copy')),
    element('div', { class: 'source-links' },
      original && outside('Original TikTok post', original.href, 'text-link'),
      sources.map(url => outside(url.hostname.replace(/^www\./, ''), url.href, 'text-link'))));
  main.replaceChildren(
    anchor(state.backTo === '#/favorites' ? 'Back to favorites' : 'Back to cookbook', state.backTo, 'back text-link', 'back'),
    element('section', { class: 'detail-heading' },
      element('div', { class: 'detail-tags' }, categoryBadge(recipe),
        recipe.categoryReview === 'Review' && element('span', { class: 'review-badge' }, 'Category under review')),
      element('h1', {}, recipe.title),
      p(recipe.creator, 'detail-creator'),
      element('div', { class: 'detail-actions' },
        cookSources.length > 0 && button('Cook mode', 'button primary',
          event => openCooking(recipe.title, cookSources, event.currentTarget), 'dish'),
        anchor(mine ? 'Edit my version' : 'Edit ingredients & steps', recipeHash(recipe.id) + '/edit', 'button secondary', 'pencil'),
        favoriteButton(recipe),
        button('Copy recipe link', 'button secondary', () => copyRecipeLink(recipe.id), 'link')),
      element('input', { id: 'permalink', type: 'text', readonly: true, hidden: true, 'aria-label': 'Recipe link' })),
    element('div', { class: 'detail-layout' },
      element('div', { class: 'detail-content' }, recipeBlocks, notes), renderVideo(recipe)),
    footer());
}

function saveBlob(name, value) {
  const url = URL.createObjectURL(new Blob([value], { type: 'application/json' }));
  const link = element('a', { href: url, download: name });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

async function exportCatalog(control) {
  const catalog = state.catalog;
  const key = state.key;
  control.disabled = true;
  try {
    const payload = { ...catalog, videos: applyVideoEdits(catalog.videos, state.edits) };
    const envelope = await seal(payload, key, state.envelope.salt);
    if (state.key !== key) return;
    saveBlob('catalog.enc.json', JSON.stringify(envelope) + '\n');
    notify('Encrypted update downloaded');
  } catch {
    notify('The update could not be exported. Try again.');
  } finally {
    control.disabled = false;
  }
}

async function writeVideoEdit(id, video) {
  const key = state.key;
  const storageName = 'video:' + id;
  if (sameVideo(state.catalog.videos[id], video)) {
    delete state.edits[id];
    return storageSet(storageName, null);
  }
  const envelope = await seal(video, key, state.envelope.salt, storageName);
  if (state.key !== key) throw new Error('Cookbook locked');
  state.edits[id] = video;
  return storageSet(storageName, JSON.stringify(envelope));
}

function renderVideoEditor(recipe) {
  const current = videoFor(recipe.id);
  const isPending = Object.hasOwn(state.edits, recipe.id);
  const field = element('input', {
    id: 'drive-link', type: 'text', value: current ? driveUrl(current) : '',
    autocapitalize: 'none', spellcheck: 'false', autocomplete: 'off',
    placeholder: 'Google Drive file link or ID'
  });
  const status = element('p', { role: 'alert', class: 'form-status' });
  const submit = element('button', { type: 'submit', class: 'button primary' }, 'Save video', icon('check'));
  const actions = element('div', { class: 'detail-actions' }, submit);
  const form = element('form', { class: 'video-form' },
    element('label', { class: 'field-label', for: 'drive-link' }, 'Drive file link or ID'), field, actions, status);
  async function save(video) {
    field.disabled = true;
    for (const control of actions.querySelectorAll('button')) control.disabled = true;
    try {
      const kept = await writeVideoEdit(recipe.id, video);
      notify(kept ? 'Video update saved on this device' : 'Export this update before leaving this page.');
      if (location.hash === '#/videos/' + recipe.id && state.catalog) {
        renderRoute(false);
        main.querySelector('#drive-link').focus();
      }
    } catch {
      status.textContent = 'The video update could not be saved.';
      field.disabled = false;
      for (const control of actions.querySelectorAll('button')) control.disabled = false;
    }
  }
  form.addEventListener('submit', event => {
    event.preventDefault();
    const value = parseDrive(field.value);
    if (value) void save(value);
    else {
      status.textContent = 'Enter a Google Drive file ID or a drive.google.com file link.';
      field.focus();
    }
  });
  if (current) actions.append(button('Remove video', 'button secondary', () => save(null)));
  if (isPending) actions.append(button('Discard local edit', 'text-button', () => save(state.catalog.videos[recipe.id] ?? null)));
  return element('section', { class: 'panel video-editor' },
    p('Post ' + recipe.id + ' · ' + recipe.category, 'card-category'),
    element('h2', {}, recipe.title), form,
    anchor('View recipe', recipeHash(recipe.id), 'text-link', 'arrow'));
}

function renderCleanupPanel() {
  const status = element('p', { role: 'status', class: 'form-status' });
  const picker = element('input', { type: 'file', accept: '.json,application/json,text/plain', hidden: true });
  picker.addEventListener('change', async () => {
    const [file] = picker.files;
    picker.value = '';
    if (!file) return;
    try {
      if (file.size > 3000000) throw new Error('That file is too large to be a cleanup file.');
      const cleanup = validateCleanup(JSON.parse(await file.text()));
      const { catalog, applied, skipped } = mergeCleanup(state.catalog, cleanup);
      state.catalog = catalog;
      rebuildRecipes();
      status.textContent = 'Cleaned text applied to ' + applied + (applied === 1 ? ' recipe' : ' recipes') +
        (skipped ? ' (' + skipped + ' not found)' : '') +
        '. Now use Download encrypted update above and replace catalog.enc.json on GitHub to keep it on every device.';
    } catch (error) {
      status.textContent = error instanceof SyntaxError ? 'That file could not be read.' : error.message;
    }
  });
  return element('section', { class: 'panel export-panel' },
    element('div', {}, element('h2', {}, 'Apply recipe cleanup'),
      p('Choose the recipe-cleanup file you were given. It adds one clean, consistent version of each recipe and keeps the original text underneath. ' +
        'The cleanup is not permanent until you download the encrypted update and upload it.', 'muted'), status),
    element('div', { class: 'detail-actions' }, button('Choose cleanup file', 'button secondary', () => picker.click(), 'arrow'), picker));
}

function renderVideos(id) {
  const recipe = id && state.byId.get(id);
  if (id && !recipe) { renderMissing(); return; }
  const pending = Object.keys(state.edits).length;
  const list = element('div', { class: 'video-list' });
  const count = element('span', { class: 'result-count', 'aria-live': 'polite' });
  const select = element('select', { 'aria-label': 'Video status' },
    [['all', 'All entries'], ['missing', 'Missing a video'], ['linked', 'Video linked'], ['pending', 'Local edits']]
      .map(([value, label]) => element('option', { value, selected: value === state.videoFilter }, label)));
  select.addEventListener('change', () => { state.videoFilter = select.value; update(); });
  function update() {
    const matches = filterRecipes(state.recipes, { query: state.videoQuery }).filter(item => {
      if (state.videoFilter === 'missing') return !videoFor(item.id);
      if (state.videoFilter === 'linked') return !!videoFor(item.id);
      if (state.videoFilter === 'pending') return Object.hasOwn(state.edits, item.id);
      return true;
    });
    count.textContent = matches.length + (matches.length === 1 ? ' entry' : ' entries');
    list.replaceChildren(...matches.map(item => {
      const label = videoFor(item.id) ? 'Video linked' : 'Video missing';
      const row = element('a', { class: 'video-row', href: '#/videos/' + item.id },
        element('span', { class: 'video-number' }, item.id),
        element('span', { class: 'video-title' }, item.title),
        element('span', { class: 'video-state' }, Object.hasOwn(state.edits, item.id) ? 'Local edit' : label),
        icon('arrow'));
      if (id === item.id) row.setAttribute('aria-current', 'page');
      return row;
    }));
    if (!matches.length) list.append(p('No matching entries.', 'muted'));
  }
  const download = button('Download encrypted update', 'button secondary', () => exportCatalog(download), 'download');
  main.replaceChildren(
    id && anchor('Back to video list', '#/videos', 'back text-link', 'back'),
    element('section', { class: 'page-heading' },
      element('h1', {}, 'Manage videos'),
      p('Paste a Drive file link or ID beside the corresponding recipe.', 'muted'),
      !id && anchor('Save a YouTube Short', customPath + '/new', 'button secondary custom-add', 'video')),
    recipe && renderVideoEditor(recipe),
    element('section', { class: 'panel export-panel' },
      element('div', {}, element('h2', {}, pending ? pending + (pending === 1 ? ' local edit' : ' local edits') : 'Make video links permanent'),
        p('Video links are saved on this device and included in your backup. To make them permanent for every device, replace catalog.enc.json in your GitHub repository with this download.', 'muted')),
      download),
    !recipe && renderCleanupPanel(),
    !recipe && element('section', { class: 'video-browser' },
      element('div', { class: 'video-filters' },
        searchBox('video-search', state.videoQuery, 'Search by recipe or post number', value => {
          state.videoQuery = value;
          update();
        }), select),
      count, list), footer());
  if (!recipe) update();
}

function renderInstall() {
  const standalone = isStandalone();
  main.replaceChildren(anchor('Back to cookbook', '#/', 'back text-link', 'back'),
    element('section', { class: 'panel install-panel' },
      element('span', { class: 'brand-mark' }, icon('phone')),
      element('h1', {}, 'Install Recipe Box'),
      standalone ? p('Recipe Box is open as a home screen app.', 'muted') :
        element('ol', { class: 'recipe-list' },
          ['Open this page in Safari on your iPhone or iPad.',
            'Tap Share, then Add to Home Screen.',
            'Turn on Open as Web App, then tap Add.'].map(step => element('li', {}, step))),
      !standalone && deferredInstall && button('Install app', 'button primary', async () => {
        await deferredInstall?.prompt();
      }),
      p('Scanning a printed QR code may open Safari. If Safari asks, enter your passphrase.', 'help')));
}

function renderMissing() {
  main.replaceChildren(element('section', { class: 'panel empty' },
    element('h1', {}, 'Recipe link unavailable'),
    p('Open the cookbook to find the recipe.'),
    anchor('Browse cookbook', '#/', 'button primary', 'book')));
}

let previousPage = '';
function renderRoute(navigate) {
  const route = readRoute(location.hash);
  document.title = 'Family Recipe Box';
  renderHeader(route.page);
  if (starting) return;
  if (!state.catalog) {
    if (state.envelope) renderLock();
    if (navigate) main.focus({ preventScroll: true });
    return;
  }
  if (route.page === 'cookbook' || route.page === 'favorites') renderCollection(route.page);
  else if (route.page === 'recipe' && state.byId.has(route.id)) {
    (route.edit ? renderRecipeEditor : renderRecipe)(state.byId.get(route.id));
  }
  else if (route.page === 'videos') renderVideos(route.id);
  else if (route.page === 'my-recipes') void renderMyRecipes(route);
  else if (route.page === 'install') renderInstall();
  else renderMissing();
  if (navigate) {
    main.focus({ preventScroll: true });
    const view = state.views[route.page];
    const scroll = previousPage === 'recipe' ? view?.scroll || 0 : 0;
    window.scrollTo(0, scroll);
  }
  previousPage = route.page;
}

document.querySelector('[data-skip]').addEventListener('click', event => {
  event.preventDefault();
  main.focus();
});
window.addEventListener('hashchange', () => renderRoute(true));
window.addEventListener('beforeinstallprompt', event => {
  event.preventDefault();
  deferredInstall = event;
  if (state.catalog && readRoute(location.hash).page === 'install') renderInstall();
});
window.addEventListener('appinstalled', () => {
  deferredInstall = null;
  if (state.catalog && readRoute(location.hash).page === 'install') renderInstall();
});
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register(new URL('sw.js', root)).catch(() => {});
}
void start();
