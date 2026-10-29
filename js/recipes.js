// Browsing Ricette's recipes in the picker: folders, tags, search and "what can I cook now".
// Uses Ricette's own rules (recipe-tools.js, copied from Ricette) so recipes get exactly the tags
// you see in Ricette: automatic ones ("auto:primo", renamed or switched off in data/tags.json)
// plus your own. Folders are data/folders.json ({id, name, parentId}); a recipe has one folderId.
import { normalizeName } from './parse.js';
import { tagsOf as ricetteTags, minutesOf as ricetteMinutes } from './recipe-tools.js';

export function tagsOf(r, defs = []) { return ricetteTags(r, defs); }

// The name shown for a tag: own tags as written; automatic ones as renamed in Ricette, else the
// built-in name (autoName, e.g. from the translations), else the id.
export function tagLabel(tag, defs = [], autoName = null) {
  if (!String(tag).startsWith('auto:')) return tag;
  const id = tag.slice(5);
  const d = defs.find((x) => x && !x.deleted && x.id === id);
  return (d && (d.label || d.name)) || (autoName && autoName(id)) || id;
}

export function minutesOf(r) { return r ? ricetteMinutes(r.time) : null; }

const live = (folders) => folders.filter((f) => f && !f.deleted);

// A recipe's folder, or null if it has none (or its folder was deleted).
export function folderOfRecipe(r, folders = []) {
  return r.folderId && live(folders).some((f) => f.id === r.folderId) ? r.folderId : null;
}

// Folders in order, subfolders under their parent: [{id, name, parentId, depth}].
export function folderTree(folders = []) {
  const all = live(folders);
  const ids = new Set(all.map((f) => f.id));
  const out = [];
  const walk = (parent, depth) => {
    for (const f of all.filter((x) => (ids.has(x.parentId) ? x.parentId : null) === parent).sort((a, b) => (a.name || '').localeCompare(b.name || ''))) {
      if (out.some((y) => y.id === f.id)) continue;
      out.push({ id: f.id, name: f.name || '', parentId: f.parentId || null, depth });
      walk(f.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

function descendants(id, folders) {
  const out = new Set([id]);
  let grew = true;
  while (grew) { grew = false; for (const f of live(folders)) if (out.has(f.parentId) && !out.has(f.id)) { out.add(f.id); grew = true; } }
  return out;
}

// filter: {q, folder ('' all, '__none', or an id: includes subfolders), tags: Set of tag ids,
//          maxMinutes, canCook: (r) => bool, sort: 'name' | 'quick' | 'cooked'}
// ctx: {folders, defs (Ricette's tag settings), label (tag id → name, for search)}
export function filterRecipes(recipes, { q = '', folder = '', tags = new Set(), maxMinutes = null, canCook = null, sort = 'name' } = {}, ctx = {}) {
  const folders = ctx.folders || [];
  const defs = ctx.defs || [];
  const label = ctx.label || ((tg) => tagLabel(tg, defs));
  const query = normalizeName(q);
  const inFolder = folder && folder !== '__none' ? descendants(folder, folders) : null;
  const list = recipes.filter((r) => {
    if (r.deleted) return false;
    const fid = folderOfRecipe(r, folders);
    if (folder === '__none' && fid) return false;
    if (inFolder && !inFolder.has(fid)) return false;
    const rt = tagsOf(r, defs);
    for (const tg of tags) if (!rt.includes(tg)) return false;
    if (maxMinutes) { const m = minutesOf(r); if (m == null || m > maxMinutes) return false; }
    if (query) {
      const hay = normalizeName([r.title, ...rt.map(label), ...(r.ingredients || []).map((i) => i.name || i.raw || '')].join(' '));
      if (!query.split(' ').every((w) => hay.includes(w))) return false;
    }
    if (canCook && !canCook(r)) return false;
    return true;
  });
  const byName = (a, b) => (a.title || '').localeCompare(b.title || '');
  const by = {
    name: byName,
    quick: (a, b) => (minutesOf(a) ?? 1e9) - (minutesOf(b) ?? 1e9) || byName(a, b),
    cooked: (a, b) => (b.cookedCount || 0) - (a.cookedCount || 0) || (b.lastCooked || 0) - (a.lastCooked || 0) || byName(a, b),
  };
  return list.sort(by[sort] || byName);
}

// Tags in use: Ricette's pinned tags first, then the most used. [{tag, n, pinned}]
export function tagCounts(recipes, defs = [], pinned = []) {
  const m = new Map();
  for (const r of recipes) if (!r.deleted) for (const tg of tagsOf(r, defs)) m.set(tg, (m.get(tg) || 0) + 1);
  return [...m.entries()].map(([tag, n]) => ({ tag, n, pinned: pinned.includes(tag) }))
    .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.n - a.n || a.tag.localeCompare(b.tag));
}
