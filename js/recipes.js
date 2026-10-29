// Browsing Ricette's recipes: folders, tags, search and "what can I cook now".
// Pure functions (no DOM) so they can be tested. The readers below accept the field names
// Ricette might use, so the browser keeps working if Ricette's format grows.
import { normalizeName } from './parse.js';
import { recipeMinutes } from './smart.js';

const arr = (v) => (Array.isArray(v) ? v : v == null || v === '' ? [] : [v]);

export function tagsOf(r) {
  return [...new Set([...arr(r.tags), ...arr(r.labels), ...arr(r.tag)].map((x) => String(typeof x === 'object' ? x.name ?? x.label ?? '' : x).trim()).filter(Boolean))];
}

// Folder ids of a recipe: {folder}, {folderId}, {folders: [...]}, or folders listing their recipes.
export function foldersOf(r, folders = []) {
  const ids = [...arr(r.folder), ...arr(r.folderId), ...arr(r.folders)].map((x) => String(typeof x === 'object' ? x.id ?? x.name : x));
  for (const f of folders) if (arr(f.recipes ?? f.recipeIds).includes(r.id)) ids.push(String(f.id));
  return [...new Set(ids)];
}

// Folder list: from folders.json when there is one, else made up from the names used on recipes.
export function folderList(recipes, folders = []) {
  const out = new Map(folders.filter((f) => !f.deleted).map((f) => [String(f.id), { id: String(f.id), name: f.name || f.title || String(f.id), parent: f.parent ?? f.parentId ?? null }]));
  for (const r of recipes) for (const id of foldersOf(r, folders)) if (!out.has(id)) out.set(id, { id, name: id, parent: null });
  return [...out.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function minutesOf(r) { return recipeMinutes(r.time) ?? null; }

// filter: {q, folder, tags: Set, maxMinutes, canCook: (r) => bool, sort: 'name'|'quick'|'new'}
export function filterRecipes(recipes, { q = '', folder = '', tags = new Set(), maxMinutes = null, canCook = null, sort = 'name' } = {}, folders = []) {
  const query = normalizeName(q);
  const inFolder = (r) => {
    if (!folder) return true;
    const ids = foldersOf(r, folders);
    if (folder === '__none') return ids.length === 0;
    // A folder includes its subfolders.
    const sub = new Set([folder]);
    let grew = true;
    while (grew) { grew = false; for (const f of folders) if (sub.has(String(f.parent ?? f.parentId)) && !sub.has(String(f.id))) { sub.add(String(f.id)); grew = true; } }
    return ids.some((id) => sub.has(id));
  };
  const list = recipes.filter((r) => {
    if (r.deleted) return false;
    if (!inFolder(r)) return false;
    const rt = tagsOf(r).map((x) => x.toLowerCase());
    for (const tg of tags) if (!rt.includes(tg.toLowerCase())) return false;
    if (maxMinutes) { const m = minutesOf(r); if (m == null || m > maxMinutes) return false; }
    if (query) {
      const hay = normalizeName([r.title, ...tagsOf(r), ...(r.ingredients || []).map((i) => i.name || i.raw || '')].join(' '));
      if (!query.split(' ').every((w) => hay.includes(w))) return false;
    }
    if (canCook && !canCook(r)) return false;
    return true;
  });
  const by = {
    name: (a, b) => (a.title || '').localeCompare(b.title || ''),
    quick: (a, b) => (minutesOf(a) ?? 1e9) - (minutesOf(b) ?? 1e9) || by.name(a, b),
    new: (a, b) => (b.createdAt || b.updatedAt || 0) - (a.createdAt || a.updatedAt || 0),
  };
  return list.sort(by[sort] || by.name);
}

// Tags in use, most used first.
export function tagCounts(recipes) {
  const m = new Map();
  for (const r of recipes) for (const tg of tagsOf(r)) m.set(tg, (m.get(tg) || 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}
