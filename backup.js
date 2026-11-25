import { checkEnvelope, seal, unseal } from './crypto.js';

const purpose = 'backup';
const uuid = /^[0-9a-f-]{36}$/;
const postId = /^\d{3}$/;
const limits = { title: 150, ingredients: 8000, method: 12000, notes: 8000, category: 40 };

export const backupFileName = (date = new Date()) =>
  'recipe-box-backup-' + date.toISOString().slice(0, 10) + '.json';

// recipes: [{ id, recipe }], videos: { '012': { id, resourceKey? } | null }
export function makeBackup({ favorites, recipes, videos, edits = {} }, key, salt, now = Date.now()) {
  return seal({ schema: 1, exportedAt: now, favorites: [...favorites], recipes, videos, edits }, key, salt, purpose);
}

function cleanRecipe(item) {
  const recipe = item?.recipe;
  if (!uuid.test(item?.id || '') || typeof recipe?.title !== 'string' || !recipe.title.trim()) return null;
  const clean = { updated: Number(recipe.updated) || 0 };
  for (const [name, max] of Object.entries(limits)) {
    clean[name] = typeof recipe[name] === 'string' ? recipe[name].slice(0, max) : '';
  }
  clean.youtube = /^[\w-]{11}$/.test(recipe.youtube || '') ? recipe.youtube : null;
  return { id: item.id, recipe: clean };
}

function cleanVideo(video) {
  if (!/^[\w-]{10,200}$/.test(video?.id || '')) return undefined;
  return /^[\w-]{1,200}$/.test(video.resourceKey || '')
    ? { id: video.id, resourceKey: video.resourceKey } : { id: video.id };
}

function cleanEdits(edits) {
  const clean = {};
  if (!edits || typeof edits !== 'object' || Array.isArray(edits)) return clean;
  for (const [id, edit] of Object.entries(edits)) {
    if (!postId.test(id) || typeof edit !== 'object' || !edit) continue;
    const ingredients = typeof edit.ingredients === 'string' ? edit.ingredients.slice(0, limits.ingredients) : '';
    const method = typeof edit.method === 'string' ? edit.method.slice(0, limits.method) : '';
    if (ingredients || method) clean[id] = { ingredients, method, updated: Number(edit.updated) || 0 };
  }
  return clean;
}

export function validateBackup(data) {
  if (data?.schema !== 1 || !Array.isArray(data.favorites) || !Array.isArray(data.recipes) ||
      !data.videos || typeof data.videos !== 'object' || Array.isArray(data.videos)) {
    throw new Error('This backup file is not supported.');
  }
  const videos = {};
  for (const [id, video] of Object.entries(data.videos)) {
    if (!postId.test(id)) continue;
    const clean = video === null ? null : cleanVideo(video);
    if (clean !== undefined) videos[id] = clean;
  }
  return {
    exportedAt: Number(data.exportedAt) || 0,
    favorites: data.favorites.filter(id => postId.test(id)),
    recipes: data.recipes.map(cleanRecipe).filter(Boolean),
    videos,
    edits: cleanEdits(data.edits)
  };
}

export async function readBackup(text, key, salt) {
  let envelope;
  try { envelope = checkEnvelope(JSON.parse(text)); }
  catch { throw new Error('That file is not a Recipe Box backup.'); }
  if (envelope.salt !== salt) throw new Error('That backup was made for a different cookbook or passphrase.');
  let data;
  try { data = await unseal(envelope, key, purpose); }
  catch { throw new Error('That file is not a Recipe Box backup.'); }
  return validateBackup(data);
}

// Union of favorites; for My Recipes the newest edit wins; video links already
// set on this device are kept, new ones from the backup are added.
export function mergeBackup(local, incoming) {
  const favorites = [...new Set([...local.favorites, ...incoming.favorites])].sort();
  const have = new Map(local.recipes.map(item => [item.id, item.recipe.updated || 0]));
  const recipes = [];
  let added = 0;
  let updated = 0;
  for (const item of incoming.recipes) {
    if (!have.has(item.id)) { recipes.push(item); added++; }
    else if (item.recipe.updated > have.get(item.id)) { recipes.push(item); updated++; }
  }
  const videos = {};
  for (const [id, video] of Object.entries(incoming.videos)) {
    if (!Object.hasOwn(local.videos, id)) videos[id] = video;
  }
  const edits = {};
  for (const [id, edit] of Object.entries(incoming.edits || {})) {
    const current = local.edits?.[id];
    if (!current || edit.updated > (current.updated || 0)) edits[id] = edit;
  }
  return {
    favorites, recipes, videos, edits,
    summary: {
      added, updated, edits: Object.keys(edits).length,
      favorites: favorites.length - new Set(local.favorites).size,
      videos: Object.keys(videos).length
    }
  };
}

export function describeMerge({ added, updated, edits = 0, favorites, videos }) {
  const parts = [];
  if (added) parts.push(added + (added === 1 ? ' new recipe' : ' new recipes'));
  if (updated) parts.push(updated + (updated === 1 ? ' recipe updated' : ' recipes updated'));
  if (edits) parts.push(edits + (edits === 1 ? ' recipe edit' : ' recipe edits'));
  if (favorites) parts.push(favorites + (favorites === 1 ? ' favorite' : ' favorites'));
  if (videos) parts.push(videos + (videos === 1 ? ' video link' : ' video links'));
  return parts.length ? 'Imported ' + parts.join(', ') + '.' : 'Nothing new to import. This device is already up to date.';
}
