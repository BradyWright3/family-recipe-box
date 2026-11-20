import {
  categories, categoryStyle, searchableRecipes, filterRecipes, recipeHash, readRoute,
  parseDrive, driveUrl, sameVideo, applyVideoEdits, safeLink, validateCatalog, parseYouTube
} from './model.js';
import { checkEnvelope, deriveKey, seal, unseal } from './crypto.js';
import { icon } from './icons.js';

const root = new URL('./', import.meta.url);
const namespace = 'family-recipe-box:' + root.pathname;
const header = document.querySelector('#header');
const main = document.querySelector('#main');
const toast = document.querySelector('#toast');
const state = {
  catalog: null, key: null, envelope: null, recipes: [], byId: new Map(),
  favorites: new Set(readFavorites()), edits: {}, backTo: '#/',
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

async function unlock(key) {
  const catalog = validateCatalog(await unseal(state.envelope, key));
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
  state.recipes = searchableRecipes(catalog.recipes);
  state.byId = new Map(state.recipes.map(recipe => [recipe.id, recipe]));
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
  const lock = button('', 'icon-button lock-button', lockCookbook, 'lock');
  lock.setAttribute('aria-label', 'Lock cookbook');
  lock.title = 'Lock cookbook';
  header.append(nav, lock);
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
  const remember = element('input', { type: 'checkbox', id: 'remember' });
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
      p('Enter the passphrase shared with your family.', 'muted'), form)));
}

async function lockCookbook() {
  state.catalog = null;
  state.key = null;
  state.recipes = [];
  state.byId.clear();
  state.edits = {};
  state.views = { cookbook: { query: '', category: '' }, favorites: { query: '', category: '' } };
  state.videoQuery = '';
  state.videoFilter = 'all';
  renderRoute(true);
  await keyStore('readwrite', store => store.delete('unlock')).catch(() => {
    notify('This browser could not clear its saved unlock. Clear site data if needed.');
  });
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

function footer() {
  return element('footer', { class: 'footer' }, anchor('Install on iPhone or iPad', '#/install', 'text-link', 'phone'));
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

function textList(value, steps = false) {
  if (!value) return p(steps ? 'Instructions are unavailable.' : 'Ingredients are unavailable.', 'muted');
  const rows = value.split(/\r?\n|;\s+/).map(item => item.trim()).filter(Boolean);
  if (rows.length === 1) return p(rows[0], 'recipe-copy');
  return element(steps ? 'ol' : 'ul', { class: 'recipe-list' },
    rows.map(row => element('li', {}, row)));
}

function recipeText(title, copy, description) {
  return element('section', { class: 'panel recipe-text' },
    element('h2', {}, title),
    description && p(description, 'source-label'),
    element('div', { class: 'recipe-columns' },
      element('div', {}, element('h3', {}, 'Ingredients'), textList(copy.ingredients)),
      element('div', {}, element('h3', {}, 'Instructions'), textList(copy.method, true))));
}

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
          anchor('Edit recipe', customPath + '/' + recipe.id + '/edit', 'button secondary')),
        element('div', { class: 'custom-detail' }, video, content), footer());
      return;
    }
    heading.append(anchor('Add recipe or Short', customPath + '/new', 'button primary custom-add'));
    const list = element('div', { class: 'video-list' }, recipes.sort((a, b) => b.updated - a.updated).map(item =>
      anchor([element('span', { class: 'video-title' }, item.title),
        element('span', { class: 'video-state' }, item.youtube ? 'YouTube video' : item.category)],
      customPath + '/' + item.id, 'video-row custom-row')));
    main.replaceChildren(heading, recipes.length ? list : p('Your saved recipes and Shorts will appear here.', 'muted'), footer());
  } catch {
    if (current()) main.replaceChildren(heading, p('Saved recipes could not be opened on this device.', 'form-status'));
  }
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

function renderRecipe(recipe) {
  document.title = recipe.title + ' · Recipe Box';
  const hasOriginal = recipe.original.ingredients || recipe.original.method;
  const hasPublished = recipe.published.ingredients || recipe.published.method;
  const sources = recipe.published.urls.map(safeLink).filter(Boolean);
  const original = safeLink(recipe.original.url);
  const recipeBlocks = [];
  if (recipe.category === 'Non-recipe') {
    recipeBlocks.push(element('section', { class: 'panel recipe-text' },
      element('h2', {}, 'Saved post'), p('The workbook marks this entry as a non-recipe.', 'muted')));
  } else {
    if (hasOriginal) recipeBlocks.push(recipeText('From the saved caption', recipe.original));
    if (hasPublished) recipeBlocks.push(recipeText('Published recipe candidate', recipe.published,
      'Exact match to the saved TikTok is unverified.'));
    if (!hasOriginal && !hasPublished) recipeBlocks.push(element('section', { class: 'panel recipe-text' },
      element('h2', {}, 'Recipe details'), p('Ingredients and instructions are unavailable in the workbook.', 'muted')));
  }
  const notes = element('section', { class: 'panel recipe-text' }, element('h2', {}, 'Source notes'),
    recipe.categoryNote && p('Category review. ' + recipe.categoryNote, 'source-note'),
    recipe.original.note && p(recipe.original.note, 'source-note'),
    recipe.published.note && p(recipe.published.note, 'source-note'),
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
      element('div', { class: 'detail-actions' }, favoriteButton(recipe),
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
      element('div', {}, element('h2', {}, pending ? pending + (pending === 1 ? ' local edit' : ' local edits') : 'Publish video links'),
        p('Replace catalog.enc.json in your GitHub Pages repository with the encrypted download to share your edits across devices.', 'muted')),
      download),
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
  const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
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
      p('Scanning a printed QR code may open Safari. If Safari asks, enter the same family passphrase.', 'help')));
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
  else if (route.page === 'recipe' && state.byId.has(route.id)) renderRecipe(state.byId.get(route.id));
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
