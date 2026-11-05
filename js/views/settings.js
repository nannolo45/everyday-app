// views/settings.js: moved from app.js (v36). See app.js for how the modules fit together.
import { LOW_MODES } from '../kitchen.js';
import { lowPref } from '../lowstock.js';
import { advancedListsHtml } from './tasks.js';
import { isPalestra, lastSessionAt, PALESTRA_APP, palestraTooNew } from '../palestra.js';
import { advancedOn, APP_VERSION, categories, catName, esc, fmtDay, relDay, route, ui, weekdayNames } from '../core.js';
import { getLang, LANGS, t } from '../i18n.js';
import { kindOf } from '../kinds.js';
import { addDays, dateStr, fmtDur, fmtTime, nowMinutes, today } from '../plan.js';
import { allPlaces, hasHours, openState, placeEmoji } from '../places.js';
import { autoHoursFor, tripMode } from '../planning.js';
import { changed } from '../shell.js';
import { contractTooNew, get, live, state } from '../store.js';
import { isConfigured, palestraConfigured, repoLabel, repoTarget, ricetteConfigured } from '../sync.js';
import { ensureLegTasks, LEGS, legTemplate, travelCfg } from '../travel-plan.js';
import { MODE_ICON, MODES as TRAVEL_MODES } from '../travel.js';
import { glance, GLANCE, planStyle, VIEWS } from './planner.js';
import { THEMES, themeChoice } from '../theme.js';
import { shopsList } from './shop.js';
import { taskGroupsCfg } from './tasks.js';
import { TIME24 } from '../widgets.js';
import { gcalSection, ghConnected } from '../connections.js';
import { classic } from './impegni.js';

// ---------- view: settings ----------

// Saved tasks that can serve as "Get there" / "Come back" (no meals).
export function savedForLegs() { return live('tasks').filter((x) => kindOf(x) === 'saved' && !x.done).sort((a, b) => a.title.localeCompare(b.title)); }
export function viewSettings() {
  const s = state.settings;
  const msg = ui.connMsg;
  if (ensureLegTasks()) setTimeout(changed, 0);
  return settingsHtml(s, msg);
}
// (v95) «Di un altro account GitHub» under the Ricette / Palestra repository: the owner and a token of its own.
function extFields(key, tokenKey) {
  const s = state.settings; const cur = String(s[key] || ''); const other = cur.includes('/') ? cur.split('/')[0] : '';
  const dis = isConfigured() ? '' : 'disabled';
  return `<details class="ext-other" ${other || s[tokenKey] ? 'open' : ''}><summary>${esc(t('extOther'))}</summary>
    <label>${esc(t('extOwner'))}<input name="${key}Owner" value="${esc(other)}" placeholder="${esc(s.owner || '')}" autocomplete="off" autocapitalize="off" spellcheck="false" ${dis}></label>
    <label>${esc(t('extToken'))}<input name="${key}Token" type="password" placeholder="${esc(t(s[tokenKey] ? 'tokenSaved' : 'extTokenPh'))}" autocomplete="off" ${dis}>
      <small>${esc(t('extWhy'))}</small></label></details>`;
}
export function settingsHtml(s, msg) {
  const hourOpts = (sel, from, to) => Array.from({ length: to - from + 1 }, (_, i) => from + i).map((h) => `<option value="${h}" ${h === Number(sel) ? 'selected' : ''}>${fmtTime(h * 60)}</option>`).join('');
  const opts = (vals, sel, label) => vals.map((v) => `<option value="${v}" ${v === Number(sel) ? 'selected' : ''}>${esc(label(v))}</option>`).join('');
  // An option with a line saying what it changes.
  const why = (key) => `<small class="why">${esc(t(key))}</small>`;
  // (v62) the Planner's own options move to a page of their own; the marker below is where the day page ends
  const PLAN_CUT = '<!--plan-->';
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
    <label class="check"><input type="checkbox" name="smartLearn" ${s.smartLearn ? 'checked' : ''}> <span>✦ ${esc(t('smartLearn'))}<small>${esc(t('smartLearnWhy'))}</small></span></label>
    ${PLAN_CUT}
    <div class="field-label">${esc(t('weekCardSet'))}</div>
    <div class="two">
      <label>${esc(t('weekCardDay'))}<select name="weekCardDay">${[1, 2, 3, 4, 5, 6, 0].map((d) => `<option value="${d}" ${d === Number(s.weekCardDay ?? 0) ? 'selected' : ''}>${esc(fmtDay(addDays('2026-11-01', d), { weekday: 'long' }))}</option>`).join('')}</select></label>
      <label>${esc(t('weekCardHour'))}<select name="weekCardHour">${hourOpts(s.weekCardHour ?? 18, 0, 23)}</select></label>
    </div>${why('weekCardWhy')}
    <label>${esc(t('planStyleL'))}<select name="planStyle">${['agenda', 'hours', 'scaletta', 'mappa'].map((v) => `<option value="${v}" ${v === planStyle() ? 'selected' : ''}>${esc(t(`ps_${v}`))}</option>`).join('')}</select></label>
    <label>${esc(t('defaultView'))}<select name="defaultView">${VIEWS.map((v) => `<option value="${v}" ${v === currentViewDefault() ? 'selected' : ''}>${esc(t(`v_${v}`))}</option>`).join('')}</select></label>
  </form>`;
  const [dayTop, planRest] = dayCard.split(PLAN_CUT);
  const dayPage = `${dayTop}</form>`;
  const plannerPage = `<form class="form" id="planner-form">${planRest.replace('</form>', '')}
    <label class="opt">${esc(t('snap'))}<select name="snap">${opts([5, 10, 15, 30], s.snap, (m) => `${m} min`)}</select>${why('snapWhy')}</label>
    <label>${esc(t('clockL'))}<select name="clock12"><option value="0" ${!s.clock12 ? 'selected' : ''}>${esc(t('clock24'))}</option><option value="1" ${s.clock12 ? 'selected' : ''}>${esc(t('clock12'))}</option></select></label>
    <div class="field-label">${esc(t('badgesL'))}</div>
    ${[['conflicts', 'badgeConflicts', 'red'], ['behind', 'badgeBehind', 'yel'], ['toPlan', 'badgeToPlan', 'acc']].map(([k, l, c]) => `<label class="check"><input type="checkbox" name="badge_${k}" ${(s.planBadges || {})[k] !== false ? 'checked' : ''}> <span><i class="bdot ${c}"></i> ${esc(t(l))}</span></label>`).join('')}
    ${why('badgesWhy')}
  </form>`; // (v82) the clock and the Planner icon's numbers
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
    <div class="conn-main"><span class="ok-dot"></span><div><b>${esc(repoLabel(s.ricetteRepo))}</b>${s.ricetteToken ? ` <small class="ext-tok">· ${esc(t('extSepToken'))}</small>` : ''}
      ${repoTarget(s.ricetteRepo).owner !== String(s.owner || '').trim() ? `<small>${esc(t('extShared', repoTarget(s.ricetteRepo).owner))}</small>` : ''}<small>${esc(t('ricetteStatus', live('r_recipes').length, live('r_pantry').length, live('r_shopping').filter((x) => !x.checked).length))}</small>${contractTooNew() ? `<p class="sl-frozen" role="alert">⚠ ${esc(t('sl_contract'))}</p>` : ''}</div></div>
    ${ui.ricMsg && ui.ricMsg !== 'connected' ? `<p class="conn bad">${esc(t(ui.ricMsg))}</p>` : ''}
    <label class="opt low-pref">${esc(t('lowPrefL'))}<select data-action="low-pref" ${contractTooNew() ? 'disabled' : ''}>${LOW_MODES.map((m) => `<option value="${m}" ${m === lowPref() ? 'selected' : ''}>${esc(t(`lowPref_${m}`))}</option>`).join('')}</select><small>${esc(t('lowPrefWhy'))}</small></label>
    <div class="button-row"><button class="btn small ghost" type="button" data-action="ric-off">${esc(t('disconnect'))}</button></div>
  </div>` : `
  <form class="form" id="ric-form">
    <label>${esc(t('ricetteRepo'))}<input name="ricetteRepo" value="${esc(s.ricetteRepo || 'ricette-data')}" autocomplete="off" autocapitalize="off" spellcheck="false" ${isConfigured() ? '' : 'disabled'}>
      <small>${esc(isConfigured() ? t('ricetteRepoHint') : t('ricetteNeedsSync'))}</small></label>
    ${extFields('ricetteRepo', 'ricetteToken')}
    ${ui.ricMsg ? `<p class="conn ${ui.ricMsg === 'connected' ? 'good' : 'bad'}">${esc(t(ui.ricMsg))}</p>` : ''}
    <div class="button-row"><button class="btn primary" ${isConfigured() ? '' : 'disabled'}>${esc(t('connect'))}</button></div>
  </form>`;
  const nPal = live('tasks').filter((x) => isPalestra(x) && !x.archived).length; const lastS = lastSessionAt();
  const palestra = palestraConfigured() ? `
  <div class="conn-card">
    <div class="conn-main"><span class="ok-dot"></span><div><b>${esc(repoLabel(s.palestraRepo))}</b>${s.palestraToken ? ` <small class="ext-tok">· ${esc(t('extSepToken'))}</small>` : ''}
      <small>${esc(t('palStatus', nPal, lastS ? relDay(dateStr(new Date(lastS))) : ''))}</small>${palestraTooNew() ? `<p class="sl-frozen" role="alert">⚠ ${esc(t('palContract'))}</p>` : ''}</div></div>
    ${ui.palMsg && ui.palMsg !== 'connected' ? `<p class="conn bad">${esc(t(ui.palMsg))}</p>` : ''}
    <div class="button-row"><a class="btn small" href="${esc(PALESTRA_APP)}" target="_blank" rel="noopener">${esc(t('palOpen'))} ↗</a><button class="btn small ghost" type="button" data-action="pal-off">${esc(t('disconnect'))}</button></div>
  </div>` : `
  <form class="form" id="pal-form">
    <p class="hint">${esc(t('palWhy'))}</p>
    <label>${esc(t('palRepo'))}<input name="palestraRepo" value="${esc(s.palestraRepo || 'palestra-data')}" autocomplete="off" autocapitalize="off" spellcheck="false" ${isConfigured() ? '' : 'disabled'}>
      <small>${esc(isConfigured() ? t('ricetteRepoHint') : t('ricetteNeedsSync'))}</small></label>
    ${extFields('palestraRepo', 'palestraToken')}
    ${ui.palMsg ? `<p class="conn ${ui.palMsg === 'connected' ? 'good' : 'bad'}">${esc(t(ui.palMsg))}</p>` : ''}
    <div class="button-row"><button class="btn primary" ${isConfigured() ? '' : 'disabled'}>${esc(t('connect'))}</button></div>
  </form>`;
  const connections = `
  <h4>${esc(t('sync'))}</h4>${github}
  <h4>${esc(t('ricette'))}</h4>${ricette}
  <h4>${esc(t('palestra'))}</h4>${palestra}
  <h4>${esc(t('gcal'))}</h4>${gcalSection()}`;
  const cats = `
  ${why('catsWhy')}
  <ul class="list">
    ${categories().map((c) => `<li><button class="task-main" type="button" data-action="cat-edit" data-id="${esc(c.id)}"><span class="item-text"><span class="cat" style="--c:${esc(c.color)}">${esc(catName(c))}</span></span></button></li>`).join('')}
  </ul>
  <button class="btn small" type="button" data-action="cat-new">+ ${esc(t('newCategory'))}</button>`;
  // (v85) Luoghi salvati: Casa, then every place; 🛒 Negozi is a filter (its order is the shopping preference).
  const pf = ui.placeFilter || 'all';
  const nowM = nowMinutes(); const tdy = today();
  const stateTxt = (p) => {
    const o = openState(p, tdy, nowM, addDays);
    if (!o) return p.shop ? `<span class="st-open">${esc(t('alwaysOpen'))}</span>` : '';
    if (o.k === 'open') return `<span class="${o.to - nowM <= 60 ? 'st-soon' : 'st-open'}">${esc(t('plcOpenTo', fmtTime(o.to)))}</span>`;
    if (o.k === 'later') return `<span class="st-closed">${esc(t('plcOpensAt', fmtTime(o.from)))}</span>`;
    if (o.k === 'next') return `<span class="st-closed">${esc(t('plcOpensOn', relDay(o.date), fmtTime(o.from)))}</span>`;
    return `<span class="st-closed">${esc(t('plcClosed'))}</span>`;
  };
  const allP = allPlaces();
  const shown = pf === 'shop' ? allP.filter((p) => p.shop) : pf === 'hours' ? allP.filter((p) => hasHours(p)) : allP;
  const shops = `
  ${why('placesWhy')}
  <a class="plc-home" href="#/settings/travel"><span class="plc-em" aria-hidden="true">🏠</span><span class="item-text"><b>${esc(t('homeAddress'))}</b><small>${esc(travelCfg().home || t('noHomeYet'))} · ${esc(t('plcHomeSub'))}</small></span><span class="set-chev" aria-hidden="true">›</span></a>
  <div class="seg plc-filter" role="tablist">${[['all', t('plcAll', allP.length)], ['shop', t('plcShops', allP.filter((p) => p.shop).length)], ['hours', t('plcWithHours')]].map(([k, l]) => `<button type="button" role="tab" aria-selected="${pf === k}" class="${pf === k ? 'on' : ''}" data-action="place-filter" data-value="${k}">${esc(l)}</button>`).join('')}</div>
  ${shown.length ? `<ul class="list plc-list">${shown.map((p) => `<li><button class="task-main" type="button" data-action="place-edit" data-id="${esc(p.id)}"><span class="plc-em" aria-hidden="true">${esc(placeEmoji(p))}</span><span class="item-text">${esc(p.name)}<small>${[stateTxt(p), p.shop ? esc(`🛒 ${fmtDur(p.minutes || 30)}`) : '', esc(p.place || '')].filter(Boolean).join(' · ')}</small></span></button></li>`).join('')}</ul>` : `<p class="hint">${esc(t(pf === 'shop' ? 'plcNoShops' : 'plcNone'))}</p>`}
  ${pf === 'shop' && shown.length > 1 ? `<p class="hint">${esc(t('plcOrderHint'))}</p>` : ''}
  <button class="btn small" type="button" data-action="${pf === 'shop' ? 'shop-new' : 'place-new'}">+ ${esc(t(pf === 'shop' ? 'newShop' : 'plcNew'))}</button>
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
  ${advancedOn() ? advancedListsHtml() : ''}
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
    <div class="field-label">${esc(t('appearance'))}</div>
    <div class="seg theme-seg" role="radiogroup" aria-label="${esc(t('appearance'))}">${THEMES.map((k) => `<label class="${k === themeChoice() ? 'on' : ''}"><input type="radio" name="theme" value="${k}" ${k === themeChoice() ? 'checked' : ''}><span>${esc(t(`theme_${k}`))}</span></label>`).join('')}</div>
    <p class="hint">${esc(t('themeHint'))}</p>
  </form>`;
  // (v62) Avanzate as a list too: each connection and each group of options on a page of its own
  const v2 = !classic();
  const travelMore = `
  <form class="form" id="advanced-form">
    <div class="field-label">${esc(t('advTravelMore'))}</div>
    <label class="opt">${esc(t('travelBuffer'))}<select name="travelBuffer">${[0, 5, 10, 15].map((m) => `<option value="${m}" ${m === Number(travelCfg().buffer) ? 'selected' : ''}>${m ? `${m} min` : esc(t('none'))}</option>`).join('')}</select>${why('travelBufferWhy')}</label>
    <label class="opt">${esc(t('googleKey'))}<input name="googleKey" value="${esc(travelCfg().googleKey)}" placeholder="AIza…" autocomplete="off">${why('googleKeyWhy')}</label>
  </form>`;
  const tasksPage = `
  <form class="form" id="advanced-form">
    <div class="field-label">${esc(t('taskGroupsLabel'))}</div>
    <div class="days glance">${['today', 'tomorrow', 'soon'].map((k) => `<label class="day-pill"><input type="checkbox" name="tg" value="${k}" ${taskGroupsCfg()[k] ? 'checked' : ''}><span>${esc(k === 'soon' ? t('grp_soon') : t(`grp_${k}`))}</span></label>`).join('')}</div>
    ${why('taskGroupsWhy')}
    <label class="opt">${esc(t('soonDays'))}<select name="soonDays">${[3, 5, 7, 14, 30].map((n) => `<option value="${n}" ${n === Number(taskGroupsCfg().soonDays) ? 'selected' : ''}>${esc(t('nDays', n))}</option>`).join('')}</select></label>
    <div class="field-label">${esc(t('glanceTitle'))}</div>
    <div class="days glance">${GLANCE.map((k) => `<label class="day-pill"><input type="checkbox" name="glance" value="${k}" ${glance().has(k) ? 'checked' : ''}><span>${esc(t(`gl_${k}`))}</span></label>`).join('')}</div>
    ${why('glanceWhy')}
    <label class="check"><input type="checkbox" name="longUnits" ${s.longUnits ? 'checked' : ''}> <span>${esc(t('longUnits'))}<small>${esc(t('longUnitsWhy'))}</small></span></label>
  </form>`;
  const rulesPage = `
  <form class="form" id="advanced-form">
    <label class="check"><input type="checkbox" name="advancedFeatures" ${advancedOn() ? 'checked' : ''}> <span>${esc(t('advancedFeatures'))}<small>${esc(t('advancedFeaturesWhy'))}</small></span></label>
  </form>
  ${advancedOn() ? advancedListsHtml() : ''}`;
  const dataPage = `  ${why('dataWhy')}
  <div class="button-row">
    <button class="btn small" type="button" data-action="export">${esc(t('export'))}</button>
    ${ghConnected() ? `<button class="btn small ghost" type="button" data-action="wipe-local">${esc(t('wipeLocal'))}</button>` : ''}
  </div>`;
  const conn = (on, label) => (on ? label : t('notConnected'));
  const advPages = {
    sync: { icon: '🔄', title: t('sync'), sub: conn(ghConnected(), `${s.owner}/${s.repo}`), body: `${why('connectionsWhy')}${github}` },
    ric: { icon: '🍲', title: t('ricette'), sub: conn(ricetteConfigured(), repoLabel(s.ricetteRepo)), body: ricette },
    pal: { icon: '🏋', title: t('palestra'), sub: conn(palestraConfigured(), t('palStatus', nPal, '')), body: palestra },
    gcal: { icon: '📆', title: t('gcal'), sub: t('gcalRowSub'), body: gcalSection() },
    tasks: { icon: '☑', title: t('advTasks'), sub: t('advTasksSub'), body: tasksPage },
    rules: { icon: '🧩', title: t('advancedFeatures'), sub: advancedOn() ? t('onWord') : t('offWord'), body: rulesPage },
    data: { icon: '💾', title: t('advData'), sub: t('advDataSub'), body: dataPage },
  };
  // Settings is a list; each item opens a page of its own (#/settings/<key>), as in Ricette.
  const pages = {
    day: { icon: '☀️', title: t('myDay'), sub: `${fmtTime((s.dayStart ?? 6) * 60)}–${fmtTime((s.dayEnd ?? 23) * 60)} · ${t('maxLoadShort', s.maxLoad ?? 8)}`, body: v2 ? dayPage : dayCard },
    ...(v2 ? { planner: { icon: '📅', title: t('tabPlan'), sub: `${t(`ps_${planStyle()}`).split(' (')[0]} · ${t(`v_${currentViewDefault()}`)}`, body: plannerPage } } : {}),
    travel: { icon: '🚌', title: t('travelSettings'), sub: [travelCfg().home || t('noHomeYet'), `${MODE_ICON[travelCfg().mode] || ''} ${t(`tm_${travelCfg().mode}`)}`].join(' · '), body: v2 ? travelCard + travelMore : travelCard },
    cats: { icon: '🏷', title: t('categories'), sub: t('nCategories', categories().length), body: cats },
    shops: { icon: '📍', title: t('placesTitle'), sub: t('nPlaces', allPlaces().length, shopsList().length), body: shops },
    adv: { icon: '⚙', title: t('advanced'), sub: v2 ? t('advancedSub2') : t('advancedSub'), body: advanced },
    lang: { icon: '🌐', title: t('langLook'), sub: `${LANGS[getLang()] || getLang()} · ${t(`theme_${themeChoice()}`)}`, body: langForm },
  };
  const row = (href, icon, title, sub, ext = false) => `<a class="set-row" href="${href}" ${ext ? 'target="_blank" rel="noopener"' : ''}>
    <span class="set-ico" aria-hidden="true">${icon}</span><span class="set-text"><b>${esc(title)}</b><small>${esc(sub)}</small></span><span class="set-chev" aria-hidden="true">›</span></a>`;
  if (v2 && route().id === 'adv') {
    const sp = advPages[route().sub];
    if (sp) return `
  <a class="set-back" href="#/settings/adv">← ${esc(t('advanced'))}</a>
  <h1 class="set-title"><span aria-hidden="true">${sp.icon}</span> ${esc(sp.title)}</h1>
  <div class="set-page set-adv-${esc(route().sub)}">${sp.body}</div>`;
    return `
  <a class="set-back" href="#/settings">← ${esc(t('tabSettings'))}</a>
  <h1 class="set-title"><span aria-hidden="true">⚙</span> ${esc(t('advanced'))}</h1>
  <p class="hint">${esc(t('advListHint'))}</p>
  <div class="set-sub-h">${esc(t('connections'))}</div>
  <nav class="set-list">${['sync', 'ric', 'pal', 'gcal'].map((k) => row(`#/settings/adv/${k}`, advPages[k].icon, advPages[k].title, advPages[k].sub)).join('')}</nav>
  <div class="set-sub-h">${esc(t('advOptions'))}</div>
  <nav class="set-list">${['tasks', 'rules', 'data'].map((k) => row(`#/settings/adv/${k}`, advPages[k].icon, advPages[k].title, advPages[k].sub)).join('')}</nav>`;
  }
  const page = pages[route().id];
  if (page) {
    return `
  <a class="set-back" href="#/settings">← ${esc(t('tabSettings'))}</a>
  <h1 class="set-title"><span aria-hidden="true">${page.icon}</span> ${esc(page.title)}</h1>
  <div class="set-page set-${esc(route().id)}">${page.body}</div>`;
  }
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
    <a class="btn small" href="${v2 ? '#/settings/adv/sync' : '#/settings/adv'}">${esc(t('connect'))}</a>
  </div>`;
  return `
  <h1>${esc(t('tabSettings'))}</h1>
  ${status}
  <nav class="set-list" aria-label="${esc(t('tabSettings'))}">
    ${Object.entries(pages).map(([k, p]) => row(`#/settings/${k}`, p.icon, p.title, p.sub)).join('')}
    ${row(`guide-${getLang() === 'it' ? 'it' : 'en'}.html`, '📖', t('guide'), t('guideSub'))}
  </nav>
  <p class="version">${esc(t('appName'))} ${APP_VERSION}</p>`;
}

export function currentViewDefault() { const v = state.settings.defaultView || 'day'; return VIEWS.includes(v) ? v : 'day'; }

// Reminders: Google Calendar notifies you (the "Everyday" calendar's events carry them). A default for
// everything (shared through the data repo, read by the sync), and each task can have its own.
export const REMINDS = [-1, 0, 5, 10, 15, 30, 60, 120, 1440];
export function remindDefault() { const v = get('config', 'reminders')?.value?.default; return v == null ? 10 : Number(v); }
export const remindOn = (k) => get('config', 'reminders')?.value?.[k] !== false; // (v94) 🚶 leave / 📅 appointments / the rest
export function remindLabel(m) { return m < 0 ? t('remindNone') : m === 0 ? t('remindAtStart') : m === 1440 ? t('remindDayBefore') : t('remindBefore', fmtDur(m)); }

export function daysLabel(days) {
  const set = new Set(days);
  if (set.size === 7) return t('everyDay');
  if (set.size === 5 && [1, 2, 3, 4, 5].every((d) => set.has(d))) return t('weekdaysLabel');
  if (set.size === 2 && set.has(0) && set.has(6)) return t('weekendLabel');
  return weekdayNames().filter(([wd]) => set.has(wd)).map(([, n]) => n).join(', ');
}
