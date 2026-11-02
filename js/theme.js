// theme.js (v62): light, dark or the device's choice (Settings → Language and appearance), per device.
// The page carries `light` or `dark` on <html>; the CSS keys its colours on that. A copy of the choice in
// localStorage lets index.html set the class before the first paint (settings load later, from IndexedDB).
export const THEMES = ['auto', 'light', 'dark'];
const KEY = 'everyday-theme';
const MQ = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null;
let choice = 'auto';
try { choice = localStorage.getItem(KEY) || 'auto'; } catch { /* no storage */ }
export const themeChoice = () => (THEMES.includes(choice) ? choice : 'auto');
export const isDark = () => (themeChoice() === 'auto' ? Boolean(MQ?.matches) : themeChoice() === 'dark');
export function applyTheme(c = themeChoice()) {
  choice = THEMES.includes(c) ? c : 'auto';
  try { localStorage.setItem(KEY, choice); } catch { /* no storage */ }
  const dark = isDark();
  const root = document.documentElement;
  root.classList.toggle('dark', dark); root.classList.toggle('light', !dark);
  document.querySelector('meta[name=theme-color]')?.setAttribute('content', dark ? '#151a1b' : '#ffffff');
}
MQ?.addEventListener?.('change', () => { if (themeChoice() === 'auto') applyTheme('auto'); });
