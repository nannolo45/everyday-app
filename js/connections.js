// connections.js: moved from app.js (v36). See app.js for how the modules fit together.
import { $, esc, hint, small, toast, ui } from './core.js';
import { askScope, openMealPick, openQuickTask, openSpare } from './editors.js';
import { detectLang, getLang, setLang, t } from './i18n.js';
import { setDecimalSeparator } from './parse.js';
import { today } from './plan.js';
import { cancelScheduledSync, render, runSync } from './shell.js';
import { COLLECTIONS, get, live, remove, replaceCollection, resetSharedSettings, RICETTE, saveMeta, saveSettings, state, upsert } from './store.js';
import { isConfigured, pauseSync, resumeSync, runWorkflow, testConnection } from './sync.js';
import { remindDefault, remindLabel, remindOn, REMINDS } from './views/settings.js';

export function gcalSection() {
  const st = get('gcal', 'status');
  if (!st) {
    return `${hint('gcalIntro')}
      <details class="steps-box"><summary>${esc(t('gcalHow'))}</summary><ol class="steps">${[1, 2, 3, 4].map((i) => `<li>${esc(t(`gcalStep${i}`))}</li>`).join('')}</ol></details>
      ${hint('gcalGuide')}
      ${ghConnected() ? `<div class="button-row"><button class="btn small" type="button" data-action="sync-now">${esc(t('gcalCheck'))}</button></div>` : ''}`;
  }
  return `<div class="conn-card">
    <div class="conn-main"><span class="ok-dot ${st.error ? 'bad' : ''}"></span><div><b>${esc(t('gcalLast', new Date(st.lastRun).toLocaleString(getLang())))}</b>
      <small>${st.error ? '' : esc(t('gcalStats', st.events || 0, (st.imported || []).join(', ') || '—', st.blocks || 0, st.calendar || 'Everyday'))}</small></div></div>
    ${st.error ? `<p class="conn bad">${esc(st.error)}</p>` : ''}
    ${ui.gcalMsg ? `<p class="hint">${esc(t(ui.gcalMsg))}</p>` : ''}
    <label class="check"><input type="checkbox" id="show-events" ${state.settings.showEvents === false ? '' : 'checked'}> ${esc(t('showEvents'))}</label>
    <label>🔔 ${esc(t('remindDefault'))}<select id="remind-default">${REMINDS.map((m) => `<option value="${m}" ${m === remindDefault() ? 'selected' : ''}>${esc(remindLabel(m))}</option>`).join('')}</select>
      ${small('remindHint')}</label>
    <div class="rm-kinds" role="group" aria-label="${esc(t('remindKinds'))}">${['leave', 'appt', 'rest'].map((k) => `<label class="check"><input type="checkbox" data-remind="${k}" ${remindOn(k) ? 'checked' : ''}> ${esc(t(`remind_${k}`))}</label>`).join('')}</div>
    <div class="button-row"><button class="btn small" type="button" data-action="gcal-now">${esc(t('gcalNow'))}</button>
      <button class="btn small ghost" type="button" data-action="gcal-remove">${esc(t('gcalRemove'))}</button></div>
    ${hint('gcalRemoveHint')}
  </div>`;
}

// Start the Google Calendar workflow now, then pick up its results a little later.
export async function gcalNow(quiet = false) {
  const res = await runWorkflow('google-calendar.yml');
  ui.lastDispatch = Date.now();
  if (!quiet) { ui.gcalMsg = res === 'ok' ? 'gcalStarted' : res === 'forbidden' ? 'gcalNeedsActions' : 'err_network'; render(); }
  if (res === 'ok') for (const wait of [45_000, 90_000]) setTimeout(runSync, wait);
}

// Connected = saved and tested (or, for setups from before this check existed, synced at least once).
export function ghConnected() { return isConfigured() && (state.meta.ghOk ?? Boolean(state.meta.lastSync)); }

// Everything this device holds, gone (the repos are untouched): for handing a device to someone
// else, or a fresh start. Settings stay.
export async function wipeLocalData() {
  // A sync still talking to the repository must not bring the data back while the device empties.
  cancelScheduledSync();
  await pauseSync();
  try {
    for (const c of [...COLLECTIONS, ...Object.keys(RICETTE)]) await replaceCollection(c, []);
    await resetSharedSettings();
    await saveSettings({ travelCache: {} });
    await saveMeta({ dirty: false, dirtyShards: {}, syncedShards: {}, lastSync: null, lastError: null, ricetteSynced: null });
    ui.assign = null;
  } finally { resumeSync(); }
}
export async function saveGithub(form, { fresh = null } = {}) {
  const prev = state.settings;
  const next = { owner: form.owner.value.trim(), repo: form.repo.value.trim(), token: form.token.value.trim() || state.settings.token, branch: form.branch.value.trim() || 'main' };
  const switching = prev.owner && prev.repo && (prev.owner !== next.owner || prev.repo !== next.repo) && live('tasks').concat(live('blocks')).length > 0;
  if (switching && fresh === null) {
    // Another repo: the data on this device would otherwise be merged into it (and its calendar
    // and tasks would keep showing until the first successful sync).
    askScope({
      title: t('switchRepoTitle'), thisLabel: t('switchRepoFresh'), followingLabel: t('switchRepoKeep'),
      onThis: () => saveGithub(form, { fresh: true }), onFollowing: () => saveGithub(form, { fresh: false }),
    });
    return;
  }
  // Nothing from the old repository after this: syncing pauses until the new one is saved.
  const moving = switching || Boolean(prev.repo && (prev.repo !== next.repo || prev.owner !== next.owner));
  if (moving) { cancelScheduledSync(); await pauseSync(); }
  try {
    if (fresh) await wipeLocalData();
    await saveSettings(next);
  } finally { if (moving) resumeSync(); }
  const res = await testConnection();
  ui.connMsg = res.ok ? 'connected' : `err_${res.error}`;
  await saveMeta({ ghOk: Boolean(res.ok) });
  if (res.ok) { ui.editGithub = false; toast(t('connected')); }
  render();
  if (res.ok) {
    await runSync();
    ui.connMsg = state.meta.lastError ? `err_${state.meta.lastError}` : 'connected';
    render();
  }
}

export async function saveRicette(form) {
  const repo = form.ricetteRepo.value.trim();
  if (!repo) return;
  const res = await testConnection(repo);
  ui.ricMsg = res.ok ? 'connected' : `err_${res.error}`;
  if (res.ok) {
    await saveSettings({ ricetteRepo: repo });
    await runSync();
    // Items added to Everyday's own list before connecting move to Ricette's list.
    const own = live('shopping');
    for (const it of own) upsert('r_shopping', { ...it }, { silent: true });
    for (const it of own) remove('shopping', it.id);
    for (const sh of live('shops')) { upsert('r_shops', { ...sh }, { silent: true }); remove('shops', sh.id); }
    if (own.length) await runSync();
    if (state.meta.lastError) ui.ricMsg = `err_${state.meta.lastError}`;
  }
  render();
}

// (v54) Palestra: the data repository's name; same user and token.
export async function savePalestra(form) {
  const repo = form.palestraRepo.value.trim();
  if (!repo) return;
  const res = await testConnection(repo);
  ui.palMsg = res.ok ? 'connected' : `err_${res.error}`;
  if (res.ok) {
    await saveSettings({ palestraRepo: repo });
    await runSync();
    if (state.meta.lastError) ui.palMsg = `err_${state.meta.lastError}`;
  }
  render();
}

export function exportData() {
  const data = {};
  for (const c of COLLECTIONS) data[c] = state[c];
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `everyday-backup-${today()}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export function applyLang(code) {
  setLang(code || detectLang());
  setDecimalSeparator(getLang() === 'en' ? '.' : ',');
}

// Home-screen shortcuts (long-press the app icon): ?go=today | add | time | meal
export function handleShortcut() {
  const go = new URLSearchParams(location.search).get('go');
  if (!go) return;
  history.replaceState(null, '', location.pathname + (go === 'add' ? '#/tasks' : go === 'today' ? '#/today' : '#/plan'));
  render();
  if (go === 'add') setTimeout(openQuickTask, 50);
  if (go === 'time') setTimeout(openSpare, 50);
  if (go === 'meal') setTimeout(() => openMealPick(today()), 50);
}

export function showUpdateBar() {
  if ($('.update-bar')) return;
  const bar = document.createElement('div');
  bar.className = 'update-bar';
  bar.innerHTML = `<span>${esc(t('newVersion'))}</span><button class="btn small primary" type="button">${esc(t('reloadNow'))}</button>`;
  bar.querySelector('button').addEventListener('click', () => location.reload());
  document.body.append(bar);
}
