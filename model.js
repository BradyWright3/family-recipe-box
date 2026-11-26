export const categories = [
  'Meal', 'Side', 'Breakfast', 'Snack', 'Dessert', 'Bread & Baking', 'Unclear', 'Non-recipe'
];

export const categoryStyle = {
  Meal: ['meal', 'dish'],
  Side: ['side', 'leaf'],
  Breakfast: ['breakfast', 'sun'],
  Snack: ['snack', 'bowl'],
  Dessert: ['dessert', 'cake'],
  'Bread & Baking': ['bread', 'bread'],
  Unclear: ['unclear', 'bookmark'],
  'Non-recipe': ['other', 'book']
};

const normalize = value => value.toLowerCase().normalize('NFKD')
  .replace(/\p{M}/gu, '').replace(/['’]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

export function searchableRecipes(recipes, edits = {}) {
  return recipes.map(recipe => ({
    ...recipe,
    searchText: normalize([
      recipe.id, String(Number(recipe.id)), recipe.title, recipe.creator, recipe.category,
      recipe.original.ingredients, recipe.published.ingredients, recipe.cleaned?.ingredients || '',
      edits[recipe.id]?.ingredients || ''
    ].join(' '))
  }));
}

export function filterRecipes(recipes, { query = '', category = '', favorites } = {}) {
  const terms = normalize(query).split(/\s+/).filter(Boolean);
  return recipes.filter(recipe => (
    (!category || category === recipe.category) &&
    (!favorites || favorites.has(recipe.id)) &&
    terms.every(term => recipe.searchText.includes(term))
  ));
}

export const recipeHash = id => '#/recipe/' + id;

export function readRoute(hash) {
  if (hash === '' || hash === '#/' || hash === '#') return { page: 'cookbook' };
  if (hash === '#/favorites') return { page: 'favorites' };
  if (hash === '#/videos') return { page: 'videos' };
  if (hash === '#/my-recipes') return { page: 'my-recipes' };
  if (hash === '#/my-recipes/new') return { page: 'my-recipes', edit: true };
  const custom = /^#\/my-recipes\/([0-9a-f-]{36})(\/edit)?$/.exec(hash);
  if (custom) return { page: 'my-recipes', id: custom[1], edit: Boolean(custom[2]) };
  if (hash === '#/install') return { page: 'install' };
  const edit = /^#\/recipe\/(\d{3})\/edit$/.exec(hash);
  if (edit) return { page: 'recipe', id: edit[1], edit: true };
  const match = /^#\/(recipe|videos)\/(\d{3})$/.exec(hash);
  return match ? { page: match[1], id: match[2] } : { page: 'missing' };
}

export function parseDrive(input) {
  const value = input.trim();
  if (/^[\w-]{10,200}$/.test(value)) return { id: value };
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.hostname !== 'drive.google.com' ||
        url.port || url.username || url.password) return null;
    const id = /^\/file\/(?:u\/\d+\/)?d\/([\w-]{10,200})(?:\/|$)/.exec(url.pathname)?.[1] ||
      (['/open', '/uc'].includes(url.pathname) ? url.searchParams.get('id') : '');
    const key = url.searchParams.get('resourcekey');
    if (!/^[\w-]{10,200}$/.test(id || '') || (key && !/^[\w-]{1,200}$/.test(key))) return null;
    return key ? { id, resourceKey: key } : { id };
  } catch {
    return null;
  }
}

export function parseYouTube(input) {
  try {
    const url = new URL(input.trim());
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
    let id;
    if (url.hostname === 'youtu.be') id = /^\/([\w-]{11})\/?$/.exec(url.pathname)?.[1];
    else if (['youtube.com', 'www.youtube.com', 'm.youtube.com'].includes(url.hostname)) {
      id = url.pathname === '/watch' ? url.searchParams.get('v')
        : /^\/(?:shorts|embed)\/([\w-]{11})\/?$/.exec(url.pathname)?.[1];
    }
    return /^[\w-]{11}$/.test(id || '') ? id : null;
  } catch {
    return null;
  }
}

export function driveUrl(video, mode = 'view') {
  const url = new URL('https://drive.google.com/file/d/' + encodeURIComponent(video.id) + '/' + mode);
  if (video.resourceKey) url.searchParams.set('resourcekey', video.resourceKey);
  return url.href;
}

export function sameVideo(a, b) {
  return a?.id === b?.id && a?.resourceKey === b?.resourceKey;
}

export function applyVideoEdits(videos, edits) {
  const result = { ...videos };
  for (const [id, value] of Object.entries(edits)) {
    if (value) result[id] = value;
    else delete result[id];
  }
  return result;
}

export function safeLink(value) {
  try {
    const url = new URL(value);
    if (url.protocol === 'https:' || url.protocol === 'http:') return url;
  } catch {
    return null;
  }
  return null;
}

export function validateCatalog(catalog) {
  if (catalog?.schema !== 1 || !Array.isArray(catalog.recipes) || !catalog.recipes.length ||
      !catalog.videos || Array.isArray(catalog.videos) || typeof catalog.videos !== 'object') {
    throw new Error('Invalid cookbook catalog');
  }
  const ids = new Set();
  for (const recipe of catalog.recipes) {
    if (!/^\d{3}$/.test(recipe.id) || ids.has(recipe.id) || !recipe.title ||
        !categories.includes(recipe.category) || !recipe.original || !recipe.published ||
        !Array.isArray(recipe.published.urls) ||
        (recipe.cleaned !== undefined && !validCleaned(recipe.cleaned))) throw new Error('Invalid recipe record');
    ids.add(recipe.id);
  }
  for (const [id, video] of Object.entries(catalog.videos)) {
    if (!ids.has(id) || !/^[\w-]{10,200}$/.test(video?.id || '') ||
        (video.resourceKey && !/^[\w-]{1,200}$/.test(video.resourceKey))) {
      throw new Error('Invalid video mapping');
    }
  }
  return catalog;
}

const cleanupFormat = 'family-recipe-box/cleanup-v1';

export function validCleaned(value) {
  return Boolean(value) && typeof value === 'object' &&
    typeof value.ingredients === 'string' && value.ingredients.length <= 8000 &&
    typeof value.method === 'string' && value.method.length <= 12000 &&
    (value.ingredients.trim() || value.method.trim() || value.notes?.length) &&
    ['video', 'none'].includes(value.check) &&
    Array.isArray(value.notes) && value.notes.length <= 12 &&
    value.notes.every(note => typeof note === 'string' && note.length <= 800);
}

// Checks a cleanup file before it is merged. Returns the recipe map or throws.
export function validateCleanup(data) {
  if (data?.format !== cleanupFormat || !data.recipes || typeof data.recipes !== 'object' ||
      Array.isArray(data.recipes)) throw new Error('This is not a recipe cleanup file.');
  const entries = Object.entries(data.recipes);
  if (!entries.length || entries.length > 500) throw new Error('The cleanup file has no recipes.');
  for (const [id, cleaned] of entries) {
    if (!/^\d{3}$/.test(id) || !validCleaned(cleaned)) throw new Error('The cleanup file has a damaged entry (' + id + ').');
  }
  return data.recipes;
}

// Returns a new catalog with the cleaned text attached. Unknown ids are skipped.
export function mergeCleanup(catalog, cleanup) {
  let applied = 0;
  const recipes = catalog.recipes.map(recipe => {
    const cleaned = cleanup[recipe.id];
    if (!cleaned) return recipe;
    applied += 1;
    return { ...recipe, cleaned: {
      ingredients: cleaned.ingredients.trim(), method: cleaned.method.trim(),
      notes: cleaned.notes.map(note => note.trim()).filter(Boolean), check: cleaned.check
    } };
  });
  return { catalog: { ...catalog, recipes }, applied, skipped: Object.keys(cleanup).length - applied };
}

// Row helpers shared by the recipe page and cooking mode.
const bullet = /^(?:[-\u2022\u25aa\u25cf*]\s+|\(?\d{1,2}[.)]\s+)/;
export function recipeRows(value) {
  return (value || '').split(/\r?\n|;\s+/).map(row => row.trim().replace(bullet, '').trim()).filter(Boolean);
}

// Splits rows into groups: a short row ending in a colon starts a new group.
export function groupRows(rows) {
  const groups = [];
  for (const row of rows) {
    if (row.endsWith(':') && row.length <= 60) groups.push({ heading: row.slice(0, -1), items: [] });
    else {
      if (!groups.length) groups.push({ heading: '', items: [] });
      groups[groups.length - 1].items.push(row);
    }
  }
  return groups.filter(group => group.items.length || group.heading);
}

const glyphs = { '1/2': '\u00bd', '1/4': '\u00bc', '3/4': '\u00be', '1/3': '\u2153', '2/3': '\u2154', '1/8': '\u215b' };
export function prettyText(value) {
  return value
    .replace(/(?<![\d/])(1\/2|1\/4|3\/4|1\/3|2\/3|1\/8)(?![\d/])/g, match => glyphs[match])
    .replace(/(\d) ([\u00bc\u00bd\u00be\u2153\u2154\u215b])/g, '$1$2');
}
