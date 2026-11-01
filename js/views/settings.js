// views/settings.js: moved from app.js (v36). See app.js for how the modules fit together.
import { advancedOn, APP_VERSION, categories, catName, esc, fmtDay, route, ui, weekdayNames } from '../core.js';
import { getLang, LANGS, t } from '../i18n.js';
import { kindOf } from '../kinds.js';
import { addDays, fmtDur, fmtTime } from '../plan.js';
import { autoHoursFor, tripMode } from '../planning.js';
import { changed } from '../shell.js';
import { contractTooNew, get, live, state } from '../store.js';
import { isConfigured, ricetteConfigured } from '../sync.js';
import { ensureLegTasks, LEGS, legTemplate, travelCfg } from '../travel-plan.js';
import { MODE_ICON, MODES as TRAVEL_MODES } from '../travel.js';
import { glance, GLANCE, VIEWS } from './planner.js';
import { shopsList } from './shop.js';
import { taskGroupsCfg } from './tasks.js';
import { TIME24, windowsText } from '../widgets.js';
import { gcalSection, ghConnected } from '../connections.js';

// ---------- view: settings ----------

// Saved tasks that can serve as "Get there" / "Come back" (no meals).
export function savedForLegs() { return live('tasks').filter((x) => kindOf(x) === 'saved' && !x.done).sort((a, b) => a.title.localeCompare(b.title)); }
export function viewSettings() {
  const s = state.settings;
  const msg = ui.connMsg;
  if (ensureLegTasks()) setTimeout(changed, 0);
  return settingsHtml(s, msg);
}
export function settingsHtml(s, msg) {
  const hourOpts = (sel, from, to) => Array.from({ length: to - from + 1 }, (_, i) => from + i).map((h) => `<option value="${h}" ${h === Number(sel) ? 'selected' : ''}>${fmtTime(h * 60)}</option>`).join('');
  const opts = (vals, sel, label) => vals.map((v) => `<option value="${v}" ${v === Number(sel) ? 'selected' : ''}>${esc(label(v))}</option>`).join('');
  // An option with a line saying what it changes.
  const why = (key) => `<small class="why">${esc(t(key))}</small>`;
  const dayCard = `
  <form class="form" id="planner-form">
    <div class="two">
      <label>${esc(t('dayStart'))}<select name="dayStart">${hourOpts(s.dayStart, 0, 12)}</select></label>
      <label>${esc(t('dayEnd'))}<select name="dayEnd">${hourOpts(s.dayEnd, 13, 24)}</select></label>
    </div>
    <div class="field-label">✦ ${esc(t('autoHours'))}</div>
    <div class="auto-hours">
      <span>${esc(t('weekdays'))}</span><input name="ahWdF" ${TIME24} value="${fmtTime(autoHoursFor('2026-11-02')[0])}" aria-label="${esc(t('weekdays'))} ${esc(t('from'))}"> – <input name="ahWdT" ${TIME24} value="${fmtTime(autoHoursFor('2026-11-02')[1])}" aria-label="${esc(t('weekdays'))} ${esc(t('to'))}">
      <span>${esc(t('weekend'))}</span><input name="ahWeF" ${TIME24} value="${fmtTime(autoHoursFor('2026-11-07')[0])}" aria-label="${esc(t('weekend'))} ${esc(t('from'))}"> – <input name="ahWeT" ${TIME24} value="${fmtTime(autoHoursFor('2026-11-07')[1])}" aria-label="${esc(t('weekend'))} ${esc(t('to'))}">
    </div>
    <div class="two">
      <label>${esc(t('maxLoad'))}<select name="maxLoad">${opts([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 14], s.maxLoad ?? 8, (h) => `${h} h`)}</select></label>
      <label>${esc(t('breathing'))}<select name="taskBuffer">${opts([0, 5, 10, 15, 30], s.taskBuffer ?? 0, (m) => (m ? `${m} min` : t('none')))}</select></label>
    </div>
    <label>${esc(t('splitOver'))}<select name="splitOver">${opts([0, 2, 3, 4, 5, 6], s.splitOver ?? 4, (h) => (h ? t('splitOverH', h) : t('splitNever')))}</select>${why('splitOverWhy')}</label>
    <label class="check"><input type="checkbox" name="freeWeekends" ${s.freeWeekends ? 'checked' : ''}> <span>${esc(t('freeWeekends'))}</span></label>
    <div class="field-label">${esc(t('weekCardSet'))}</div>
    <div class="two">
      <label>${esc(t('weekCardDay'))}<select name="weekCardDay">${[1, 2, 3, 4, 5, 6, 0].map((d) => `<option value="${d}" ${d === Number(s.weekCardDay ?? 0) ? 'selected' : ''}>${esc(fmtDay(addDays('2026-11-01', d), { weekday: 'long' }))}</option>`).join('')}</select></label>
      <label>${esc(t('weekCardHour'))}<select name="weekCardHour">${hourOpts(s.weekCardHour ?? 18, 0, 23)}</select></label>
    </div>${why('weekCardWhy')}
    <label>${esc(t('defaultView'))}<select name="defaultView">${VIEWS.map((v) => `<option value="${v}" ${v === currentViewDefault() ? 'selected' : ''}>${esc(t(`v_${v}`))}</option>`).join('')}</select></label>
  </form>`;
  const travelCard = `
  <form class="form" id="travel-form">
    <label>${esc(t('homeAddress'))}<input name="home" value="${esc(travelCfg().home)}" placeholder="${esc(t('homePh'))}" autocomplete="street-address"></label>
    <div class="two">
      <label>${esc(t('travelModeDefault'))}<select name="mode">${TRAVEL_MODES.map((m) => `<option value="${m}" ${m === travelCfg().mode ? 'selected' : ''}>${MODE_ICON[m]} ${esc(t(`tm_${m}`))}</option>`).join('')}</select></label>
      <label class="check tall"><input type="checkbox" name="startHere" ${travelCfg().startHere ? 'checked' : ''}> <span>${esc(t('startHere'))}${state.settings.here ? `<small>${esc(t('hereSetAt', new Date(state.settings.here.at).toLocaleString(getLang())))}</small>` : ''}</span></label>
    </div>
    <div class="field-label">🧭 ${esc(t('legsTitle'))}</div>
    ${LEGS.map((kind) => { const sel = kind === 'there' ? 'thereDefault' : 'backDefault'; return `
    <div class="leg-line">
      <span class="leg-name">${esc(t(kind === 'there' ? 'legBefore' : 'legAfter'))}</span>
      <select name="leg_${kind}" aria-label="${esc(t('legTask'))}">${savedForLegs().map((x) => `<option value="${esc(x.id)}" ${x.travelRole === kind ? 'selected' : ''}>${esc(x.title)}</option>`).join('')}</select>
      <select name="${sel}" aria-label="${esc(t('legWhen'))}">${['place', 'always', 'off'].map((k) => `<option value="${k}" ${k === travelCfg()[sel] ? 'selected' : ''}>${esc(t(`legWhen_${k}`))}</option>`).join('')}</select>
      <button class="icon" type="button" data-action="leg-edit" data-kind="${kind}" aria-label="${esc(t('legEdit', legTemplate(kind)?.title || ''))}" title="${esc(t('legEdit', legTemplate(kind)?.title || ''))}">✎</button>
    </div>`; }).join('')}
    <div class="button-row"><button class="btn small" type="button" data-action="use-location">📍 ${esc(t('useLocation'))}</button><button class="btn small ghost" type="button" data-action="travel-refresh">↻ ${esc(t('travelRefresh'))}</button></div>
    <p class="hint">${esc(travelCfg().googleKey ? t('travelViaGoogle') : t('travelViaFree'))}</p>
  </form>`;
  const github = ghConnected() && !ui.editGithub ? `
  <div class="conn-card">
    <div class="conn-main"><span class="ok-dot"></span><div><b>${esc(s.owner)}/${esc(s.repo)}</b>
      <small>${esc(t('branch'))}: ${esc(s.branch || 'main')} · ${esc(t('lastSync'))}: ${state.meta.lastSync ? esc(new Date(state.meta.lastSync).toLocaleString(getLang())) : esc(t('never'))}</small></div></div>
    ${state.meta.lastError && state.meta.lastError !== 'network' ? `<p class="conn bad">${esc(t(`err_${state.meta.lastError}`))}</p>` : ''}
    <div class="button-row">
      <button class="btn small" type="button" data-action="sync-now">${esc(t('syncNow'))}</button>
      <button class="btn small ghost" type="button" data-action="gh-edit">${esc(t('changeConn'))}</button>
    </div>
  </div>` : `
  <form class="form" id="gh-form">
    <div class="two">
      <label>${esc(t('owner'))}<input name="owner" value="${esc(s.owner)}" autocomplete="off" autocapitalize="off" spellcheck="false"></label>
      <label>${esc(t('repo'))}<input name="repo" value="${esc(s.repo || 'everyday-data')}" autocomplete="off" autocapitalize="off" spellcheck="false"></label>
    </div>
    <label>${esc(t('token'))}<input name="token" type="password" value="" placeholder="${esc(s.token ? t('tokenSaved') : '')}" autocomplete="off" spellcheck="false"><small>${esc(t(s.token ? 'tokenKeepHint' : 'tokenHint'))}</small></label>
    <label>${esc(t('branch'))}<input name="branch" value="${esc(s.branch || 'main')}" autocomplete="off" autocapitalize="off"></label>
    ${msg ? `<p class="conn ${msg === 'connected' ? 'good' : 'bad'}">${esc(t(msg))}</p>` : ''}
    <div class="button-row">
      <button class="btn primary">${esc(t('saveTest'))}</button>
      ${ui.editGithub ? `<button class="btn" type="button" data-action="gh-cancel">${esc(t('cancel'))}</button>` : ''}
    </div>
  </form>`;
  const ricette = ricetteConfigured() ? `
  <div class="conn-card">
    <div class="conn-main"><span class="ok-dot"></span><div><b>${esc(s.owner)}/${esc(s.ricetteRepo)}</b>
      <small>${esc(t('ricetteStatus', live('r_recipes').length, live('r_pantry').length, live('r_shopping').filter((x) => !x.checked).length))}</small>${contractTooNew() ? `<p class="sl-frozen" role="alert">⚠ ${esc(t('sl_contract'))}</p>` : ''}</div></div>
    ${ui.ricMsg && ui.ricMsg !== 'connected' ? `<p class="conn bad">${esc(t(ui.ricMsg))}</p>` : ''}
    <div class="button-row"><button class="btn small ghost" type="button" data-action="ric-off">${esc(t('disconnect'))}</button></div>
  </div>` : `
  <form class="form" id="ric-form">
    <label>${esc(t('ricetteRepo'))}<input name="ricetteRepo" value="${esc(s.ricetteRepo || 'ricette-data')}" autocomplete="off" autocapitalize="off" spellcheck="false" ${isConfigured() ? '' : 'disabled'}>
      <small>${esc(isConfigured() ? t('ricetteRepoHint') : t('ricetteNeedsSync'))}</small></label>
    ${ui.ricMsg ? `<p class="conn ${ui.ricMsg === 'connected' ? 'good' : 'bad'}">${esc(t(ui.ricMsg))}</p>` : ''}
    <div class="button-row"><button class="btn primary" ${isConfigured() ? '' : 'disabled'}>${esc(t('connect'))}</button></div>
  </form>`;
  const connections = `
  <h4>${esc(t('sync'))}</h4>${github}
  <h4>${esc(t('ricette'))}</h4>${ricette}
  <h4>${esc(t('gcal'))}</h4>${gcalSection()}`;
  const cats = `
  ${why('catsWhy')}
  <ul class="list">
    ${categories().map((c) => `<li><button class="task-main" type="button" data-action="cat-edit" data-id="${esc(c.id)}"><span class="item-text"><span class="cat" style="--c:${esc(c.color)}">${esc(catName(c))}</span></span></button></li>`).join('')}
  </ul>
  <button class="btn small" type="button" data-action="cat-new">+ ${esc(t('newCategory'))}</button>`;
  const shops = `
  ${why('shopsWhy')}
  ${shopsList().length ? `<ul class="list">${shopsList().map((sh) => `<li><button class="task-main" type="button" data-action="shop-rec" data-id="${esc(sh.id)}"><span class="item-text">${esc(sh.name)}<small>${esc([fmtDur(sh.minutes || 30), sh.hours?.length ? windowsText(sh.hours) : t('alwaysOpen'), sh.place || ''].filter(Boolean).join(' · '))}</small></span></button></li>`).join('')}</ul>` : ''}
  <button class="btn small" type="button" data-action="shop-new">+ ${esc(t('newShop'))}</button>
  <label class="opt">${esc(t('tripModeLabel'))}<select id="trip-mode">${['perShop', 'oneTrip'].map((m) => `<option value="${m}" ${m === tripMode() ? 'selected' : ''}>${esc(t(`trip_${m}`))}</option>`).join('')}</select>${why('tripModeWhy')}</label>`;
  // Advanced: connections first (set once), then options grouped by the part of the app they change.
  const advanced = `
  <h3>🔗 ${esc(t('connections'))}</h3>
  ${why('connectionsWhy')}
  ${connections}
  <form class="form" id="advanced-form">
    <h3>📅 ${esc(t('advPlanner'))}</h3>
    <label class="opt">${esc(t('snap'))}<select name="snap">${opts([5, 10, 15, 30], s.snap, (m) => `${m} min`)}</select>${why('snapWhy')}</label>
    <label class="opt">${esc(t('travelBuffer'))}<select name="travelBuffer">${[0, 5, 10, 15].map((m) => `<option value="${m}" ${m === Number(travelCfg().buffer) ? 'selected' : ''}>${m ? `${m} min` : esc(t('none'))}</option>`).join('')}</select>${why('travelBufferWhy')}</label>
    <label class="opt">${esc(t('googleKey'))}<input name="googleKey" value="${esc(travelCfg().googleKey)}" placeholder="AIza…" autocomplete="off">${why('googleKeyWhy')}</label>
    <label class="check"><input type="checkbox" name="advancedFeatures" ${advancedOn() ? 'checked' : ''}> <span>${esc(t('advancedFeatures'))}<small>${esc(t('advancedFeaturesWhy'))}</small></span></label>
    <h3>☑ ${esc(t('advTasks'))}</h3>
    <div class="field-label">${esc(t('taskGroupsLabel'))}</div>
    <div class="days glance">${['today', 'tomorrow', 'soon'].map((k) => `<label class="day-pill"><input type="checkbox" name="tg" value="${k}" ${taskGroupsCfg()[k] ? 'checked' : ''}><span>${esc(k === 'soon' ? t('grp_soon') : t(`grp_${k}`))}</span></label>`).join('')}</div>
    ${why('taskGroupsWhy')}
    <label class="opt">${esc(t('soonDays'))}<select name="soonDays">${[3, 5, 7, 14, 30].map((n) => `<option value="${n}" ${n === Number(taskGroupsCfg().soonDays) ? 'selected' : ''}>${esc(t('nDays', n))}</option>`).join('')}</select></label>
    <div class="field-label">${esc(t('glanceTitle'))}</div>
    <div class="days glance">${GLANCE.map((k) => `<label class="day-pill"><input type="checkbox" name="glance" value="${k}" ${glance().has(k) ? 'checked' : ''}><span>${esc(t(`gl_${k}`))}</span></label>`).join('')}</div>
    ${why('glanceWhy')}
    <label class="check"><input type="checkbox" name="longUnits" ${s.longUnits ? 'checked' : ''}> <span>${esc(t('longUnits'))}<small>${esc(t('longUnitsWhy'))}</small></span></label>
  </form>
  <h3>💾 ${esc(t('advData'))}</h3>
  ${why('dataWhy')}
  <div class="button-row">
    <button class="btn small" type="button" data-action="export">${esc(t('export'))}</button>
    ${ghConnected() ? `<button class="btn small ghost" type="button" data-action="wipe-local">${esc(t('wipeLocal'))}</button>` : ''}
  </div>`;
  const langForm = `
  <form class="form" id="lang-form">
    <label>${esc(t('language'))}
      <select name="lang">${Object.entries(LANGS).map(([k, v]) => `<option value="${k}" ${k === getLang() ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select>
    </label>
  </form>`;
  // Settings is a list; each item opens a page of its own (#/settings/<key>), as in Ricette.
  const pages = {
    day: { icon: '☀️', title: t('myDay'), sub: `${fmtTime((s.dayStart ?? 6) * 60)}–${fmtTime((s.dayEnd ?? 23) * 60)} · ${t('maxLoadShort', s.maxLoad ?? 8)}`, body: dayCard },
    travel: { icon: '🚌', title: t('travelSettings'), sub: [travelCfg().home || t('noHomeYet'), `${MODE_ICON[travelCfg().mode] || ''} ${t(`tm_${travelCfg().mode}`)}`].join(' · '), body: travelCard },
    cats: { icon: '🏷', title: t('categories'), sub: t('nCategories', categories().length), body: cats },
    shops: { icon: '🏪', title: t('shopsTitle'), sub: `${t('nShops', shopsList().length)} · ${t(`trip_${tripMode()}`)}`, body: shops },
    adv: { icon: '⚙', title: t('advanced'), sub: t('advancedSub'), body: advanced },
    lang: { icon: '🌐', title: t('language'), sub: LANGS[getLang()] || getLang(), body: langForm },
  };
  const page = pages[route().id];
  if (page) {
    return `
  <a class="set-back" href="#/settings">← ${esc(t('tabSettings'))}</a>
  <h1 class="set-title"><span aria-hidden="true">${page.icon}</span> ${esc(page.title)}</h1>
  <div class="set-page set-${esc(route().id)}">${page.body}</div>`;
  }
  const row = (href, icon, title, sub, ext = false) => `<a class="set-row" href="${href}" ${ext ? 'target="_blank" rel="noopener"' : ''}>
    <span class="set-ico" aria-hidden="true">${icon}</span><span class="set-text"><b>${esc(title)}</b><small>${esc(sub)}</small></span><span class="set-chev" aria-hidden="true">›</span></a>`;
  const err = state.meta.lastError && state.meta.lastError !== 'network' ? t(`err_${state.meta.lastError}`) : '';
  const status = ghConnected() ? `
  <div class="set-status">
    <span class="${err ? 'bad-dot' : 'ok-dot'}"></span>
    <span class="set-text"><b>${esc(err ? t('syncProblem') : t('syncedTitle'))}</b><small>${esc(err || `${s.owner}/${s.repo} · ${state.meta.lastSync ? new Date(state.meta.lastSync).toLocaleString(getLang(), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : t('never')}`)}</small></span>
    <button class="btn small" type="button" data-action="sync-now">${esc(t('syncNow'))}</button>
  </div>` : `
  <div class="set-status">
    <span class="off-dot"></span>
    <span class="set-text"><b>${esc(t('localOnlyTitle'))}</b><small>${esc(t('localOnlySub'))}</small></span>
    <a class="btn small" href="#/settings/adv">${esc(t('connect'))}</a>
  </div>`;
  return `
  <h1>${esc(t('tabSettings'))}</h1>
  ${status}
  <nav class="set-list" aria-label="${esc(t('tabSettings'))}">
    ${Object.entries(pages).map(([k, p]) => row(`#/settings/${k}`, p.icon, p.title, p.sub)).join('')}
    ${row(`guide-${getLang() === 'it' ? 'it' : 'en'}.html`, '📖', t('guide'), t('guideSub'), true)}
  </nav>
  <p class="version">${esc(t('appName'))} ${APP_VERSION}</p>`;
}

export function currentViewDefault() { const v = state.settings.defaultView || 'day'; return VIEWS.includes(v) ? v : 'day'; }

// Reminders: Google Calendar notifies you (the "Everyday" calendar's events carry them). A default for
// everything (shared through the data repo, read by the sync), and each task can have its own.
export const REMINDS = [-1, 0, 5, 10, 15, 30, 60, 120, 1440];
export function remindDefault() { const v = get('config', 'reminders')?.value?.default; return v == null ? 10 : Number(v); }
export function remindLabel(m) { return m < 0 ? t('remindNone') : m === 0 ? t('remindAtStart') : m === 1440 ? t('remindDayBefore') : t('remindBefore', fmtDur(m)); }

export function daysLabel(days) {
  const set = new Set(days);
  if (set.size === 7) return t('everyDay');
  if (set.size === 5 && [1, 2, 3, 4, 5].every((d) => set.has(d))) return t('weekdaysLabel');
  if (set.size === 2 && set.has(0) && set.has(6)) return t('weekendLabel');
  return weekdayNames().filter(([wd]) => set.has(wd)).map(([, n]) => n).join(', ');
}
