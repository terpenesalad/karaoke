export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];
export const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
export const dbToGain = db => Math.pow(10, db / 20);
export const fmtTime = s => {
  if (!isFinite(s) || s < 0) s = 0;
  const m = Math.floor(s / 60), r = Math.floor(s % 60);
  return m + ':' + String(r).padStart(2, '0');
};
export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

export const store = {
  get(k, d = null) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  del(k) { try { localStorage.removeItem(k); } catch {} },
};

/** Create an element: h('button.btn.primary', {onclick}, 'Text', child…) */
export function h(tag, props, ...kids) {
  const [name, ...cls] = tag.split('.');
  const el = document.createElement(name || 'div');
  if (cls.length) el.className = cls.join(' ');
  if (props) for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k in el && k !== 'list' && k !== 'form' && !k.includes('-')) el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : String(kid));
  return el;
}

let toastTimer;
/** Short visual notice; also read out politely by screen readers. */
export function toast(msg, ms = 2800) {
  const t = $('#toast');
  t.textContent = msg; t.dataset.show = 'true';
  clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.dataset.show = 'false'), ms);
}
/** Screen-reader-only announcement. */
export function announce(msg, assertive = false) {
  const el = $(assertive ? '#sr-alert' : '#sr-status');
  el.textContent = '';
  requestAnimationFrame(() => (el.textContent = msg));
}

export function download(blob, name) {
  const a = h('a', { href: URL.createObjectURL(blob), download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 15000);
}
