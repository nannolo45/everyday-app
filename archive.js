// js/archive.js (v117): ✓ Fatte → 📦 Archivia. Done things leave the app and go to archive/AAAA-MM.json in the
// data repository; Impostazioni › Archivio lists the months and puts any of them back. With «Archivia da sola»
// the ones done more than 30 days ago go there by themselves (once a day, when the app opens).
import { esc, modal, relDay, toast } from './core.js';
import { getLang, t } from './i18n.js';
import { get, live, remove, saveSettings, state, upsert } from './store.js';
import { changed } from './shell.js';
import { openModal } from './widgets.js';
import { today } from './plan.js';
import { archiveMonths, archiveTasks, isConfigured, readArchive, unarchive } from './sync.js';

const doneOnes = () => live('tasks').filter((x) => !x.deleted && x.done && !x.travelRole);
const putBack = (recs) => { for (const r of recs) { const { archivedAt, ...x } = r; void archivedAt; upsert('tasks', { ...x, deleted: false }, { silent: true }); } };

export async function archiveDone(list = doneOnes(), { quiet = false } = {}) {
  if (!list.length) return 0;
  if (!isConfigured()) { if (!quiet) toast(t('archiveNeedsRepo'), 5000); return 0; }
  if (!quiet) toast(t('archiving'));
  try {
    const month = await archiveTasks(list.map((x) => get('tasks', x.id) || x));
    const ids = list.map((x) => x.id);
    for (const id of ids) remove('tasks', id);
    changed();
    if (!quiet) toast(t('archivedN', ids.length), 7000, [{ label: t('undo'), run: async () => { try { putBack(await unarchive(month, ids)); changed(); } catch { toast(t('archiveFail')); } } }]);
    return ids.length;
  } catch {
    if (!quiet) toast(t('archiveFail'), 5000);
    return 0;
  }
}

// «Archivia da sola»: what was done more than 30 days ago, at most once a day
export function autoArchive() {
  if (!state.settings.autoArchive || !isConfigured()) return;
  const td = today();
  if (state.settings.autoArchiveOn === td) return;
  const cut = Date.now() - 30 * 86400000;
  const old = doneOnes().filter((x) => x.doneAt && x.doneAt < cut);
  saveSettings({ autoArchiveOn: td });
  if (old.length) archiveDone(old, { quiet: true });
}

export async function openArchive(month = null) {
  const shell = (body) => openModal(`<h2>📦 ${esc(t('archiveTitle'))}</h2>${body}
    <button type="button" class="pl-tog${state.settings.autoArchive ? ' on' : ''}" data-arch-auto><span>${esc(t('archiveAuto'))}<small>${esc(t('archiveAutoSub'))}</small></span><i></i></button>
    <div class="button-row">${month ? `<button class="btn" value="back" formnovalidate>‹ ${esc(t('back'))}</button>` : ''}<button class="btn primary" value="cancel" formnovalidate>${esc(t('doneBtn'))}</button></div>`, (form, action, e) => {
    e.preventDefault();
    const [a, b] = action.split(':');
    if (a === 'month') { openArchive(b); return; }
    if (a === 'back') { openArchive(); return; }
    if (a === 'one' || a === 'all') {
      const ids = a === 'all' ? [...form.querySelectorAll('[data-arch-id]')].map((el) => el.dataset.archId) : [b];
      unarchive(month, ids).then((recs) => { putBack(recs); changed(); toast(t('restoredN', recs.length)); openArchive(month); }).catch(() => toast(t('archiveFail')));
      return;
    }
    modal.close();
  }, { cls: 'sheet arch-sheet' });
  const wireAuto = () => modal.querySelector('[data-arch-auto]')?.addEventListener('click', (e) => { e.preventDefault(); saveSettings({ autoArchive: !state.settings.autoArchive, autoArchiveOn: null }); e.currentTarget.classList.toggle('on', Boolean(state.settings.autoArchive)); autoArchive(); });
  if (!isConfigured()) { shell(`<p class="hint">${esc(t('archiveNeedsRepo'))}</p>`); wireAuto(); return; }
  shell(`<p class="hint">${esc(t('archiveLoading'))}</p>`); wireAuto();
  try {
    if (!month) {
      const ms = await archiveMonths();
      shell(`<p class="hint">${esc(t('archiveHint2'))}</p>${ms.length ? `<div class="add-opts">${ms.map((m) => `<button class="add-opt" value="month:${esc(m)}"><span class="item-text">${esc(new Date(`${m}-15T12:00:00`).toLocaleDateString(getLang(), { month: 'long', year: 'numeric' }))}<small>archive/${esc(m)}.json</small></span></button>`).join('')}</div>` : `<p class="empty">${esc(t('archiveEmpty'))}</p>`}`);
    } else {
      const recs = (await readArchive(month)).sort((x, y) => (y.doneAt || 0) - (x.doneAt || 0));
      shell(`<p class="hint">${esc(t('archiveMonthN', recs.length))}</p>${recs.length ? `<ul class="list arch-list">${recs.map((r) => `<li data-arch-id="${esc(r.id)}"><span class="item-text">${esc(r.title || '…')}<small>${esc(r.doneAt ? relDay(new Date(r.doneAt).toISOString().slice(0, 10)) : '')}</small></span><button class="btn small" value="one:${esc(r.id)}" formnovalidate>↺ ${esc(t('restore'))}</button></li>`).join('')}</ul>
        <div class="button-row"><button class="btn" value="all" formnovalidate>↺ ${esc(t('restoreAll'))}</button></div>` : `<p class="empty">${esc(t('archiveEmpty'))}</p>`}`);
    }
    wireAuto();
  } catch { shell(`<p class="hint">${esc(t('archiveFail'))}</p>`); wireAuto(); }
}
