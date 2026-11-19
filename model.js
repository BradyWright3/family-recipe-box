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

export function searchableRecipes(recipes) {
  return recipes.map(recipe => ({
    ...recipe,
    searchText: normalize([
      recipe.id, String(Number(recipe.id)), recipe.title, recipe.creator, recipe.category,
      recipe.original.ingredients, recipe.published.ingredients
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
  if (hash === '#/install') return { page: 'install' };
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
        !Array.isArray(recipe.published.urls)) throw new Error('Invalid recipe record');
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
