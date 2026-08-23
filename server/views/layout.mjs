// Разметка админки. Сервер отдаёт готовый HTML — так панель открывается мгновенно
// даже с телефона в приюте, где интернет медленный, и не нужен сборщик.

export function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Тег-шаблон: значения экранируются автоматически, кроме обёрнутых в raw(). */
export function html(strings, ...values) {
  return strings.reduce((acc, str, i) => {
    if (i === 0) return str;
    const v = values[i - 1];
    const rendered = v === null || v === undefined || v === false ? '' : v?.__raw ? v.value : Array.isArray(v) ? v.map((x) => (x?.__raw ? x.value : esc(x))).join('') : esc(v);
    return acc + rendered + str;
  }, '');
}

export function raw(value) {
  return { __raw: true, value };
}

const STYLES = `
:root{
  --paper:#f5f6f1;--surface:#fff;--surface-2:#eceee6;--line:#d9ded3;
  --ink:#1b221d;--ink-2:#47524a;--muted:#6f7a71;
  --green:#245c43;--green-2:#2e7a57;--green-soft:#e2eee5;
  --amber:#c9781d;--amber-soft:#fbeedb;--rose:#b4432f;--rose-soft:#f9e6e2;
  --radius:14px;
}
*,*::before,*::after{box-sizing:border-box}
body{margin:0;background:var(--paper);color:var(--ink);
  font:16px/1.5 -apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;-webkit-text-size-adjust:100%}
a{color:var(--green)}
h1,h2,h3{margin:0;line-height:1.2;font-family:Georgia,"Times New Roman",serif;font-weight:600}
h1{font-size:1.6rem}h2{font-size:1.25rem}h3{font-size:1.05rem}
.wrap{max-width:1080px;margin:0 auto;padding:20px 16px 64px}
.wrap--narrow{max-width:640px}
header.top{background:var(--green);color:#fff;position:sticky;top:0;z-index:10}
header.top .bar{max-width:1080px;margin:0 auto;padding:10px 16px;display:flex;gap:14px;align-items:center;flex-wrap:wrap}
header.top a{color:#fff;text-decoration:none;font-weight:600;opacity:.85;padding:6px 2px}
header.top a:hover,header.top a[aria-current]{opacity:1;text-decoration:underline}
header.top .brand{font-family:Georgia,serif;font-size:1.1rem;margin-right:auto;opacity:1}
header.top .who{font-size:.85rem;opacity:.8;font-weight:400}
.card{background:var(--surface);border:1px solid var(--line);border-radius:var(--radius);padding:18px;margin-bottom:16px}
.card--soft{background:var(--green-soft);border-color:transparent}
.card--warn{background:var(--amber-soft);border-color:transparent}
.card--danger{background:var(--rose-soft);border-color:transparent}
label{display:block;margin-bottom:12px;font-size:.92rem}
label>span.lbl{display:block;font-weight:600;margin-bottom:4px}
label .hint{display:block;color:var(--muted);font-weight:400;font-size:.85rem;margin-top:3px}
input[type=text],input[type=password],input[type=number],input[type=email],input[type=tel],input[type=search],select,textarea{
  width:100%;padding:11px 12px;border:1.5px solid var(--line);border-radius:10px;font:inherit;background:#fff;color:var(--ink)}
input:focus,select:focus,textarea:focus{outline:none;border-color:var(--green)}
textarea{min-height:130px;resize:vertical;line-height:1.5}
.row{display:flex;gap:12px;flex-wrap:wrap;align-items:center}
.grid{display:grid;gap:14px}
.grid--2{grid-template-columns:repeat(auto-fit,minmax(min(100%,230px),1fr))}
.grid--cards{grid-template-columns:repeat(auto-fill,minmax(min(100%,220px),1fr))}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:7px;padding:11px 18px;border-radius:11px;
  border:1.5px solid transparent;font:600 1rem inherit;cursor:pointer;text-decoration:none;min-height:44px}
.btn--primary{background:var(--amber);color:#fff}
.btn--primary:hover{background:#a86112;color:#fff}
.btn--green{background:var(--green);color:#fff}
.btn--green:hover{background:var(--green-2);color:#fff}
.btn--ghost{background:#fff;border-color:var(--line);color:var(--ink)}
.btn--ghost:hover{background:var(--surface-2)}
.btn--danger{background:#fff;border-color:var(--rose);color:var(--rose)}
.btn--danger:hover{background:var(--rose);color:#fff}
.btn--sm{padding:7px 12px;min-height:36px;font-size:.9rem;border-radius:9px}
.pill{display:inline-block;padding:3px 9px;border-radius:999px;font-size:.78rem;font-weight:700;background:var(--surface-2);color:var(--ink-2)}
.pill--green{background:var(--green-soft);color:var(--green)}
.pill--amber{background:var(--amber-soft);color:#a86112}
.pill--rose{background:var(--rose-soft);color:var(--rose)}
.muted{color:var(--muted)}
.small{font-size:.87rem}
.notice{padding:13px 15px;border-radius:11px;margin-bottom:16px;border-left:4px solid var(--green);background:var(--green-soft)}
.notice--error{background:var(--rose-soft);border-left-color:var(--rose)}
.notice--warn{background:var(--amber-soft);border-left-color:var(--amber)}
table{width:100%;border-collapse:collapse;font-size:.93rem}
th,td{text-align:left;padding:9px 10px;border-bottom:1px solid var(--line);vertical-align:top}
th{font-size:.75rem;text-transform:uppercase;letter-spacing:.06em;color:var(--muted)}
.table-wrap{overflow-x:auto}
.thumbs{display:flex;gap:8px;flex-wrap:wrap;margin-top:8px}
.thumb{position:relative;width:88px;height:88px;border-radius:9px;overflow:hidden;border:1px solid var(--line);background:var(--surface-2)}
.thumb img{width:100%;height:100%;object-fit:cover;display:block}
.thumb button{position:absolute;top:3px;right:3px;width:24px;height:24px;border-radius:50%;border:0;
  background:rgba(0,0,0,.65);color:#fff;cursor:pointer;font-size:15px;line-height:1;padding:0}
.animal-tile{display:block;background:var(--surface);border:1px solid var(--line);border-radius:var(--radius);
  overflow:hidden;text-decoration:none;color:var(--ink)}
.animal-tile:hover{border-color:var(--green)}
.animal-tile img{width:100%;aspect-ratio:4/3;object-fit:cover;display:block;background:var(--surface-2)}
.animal-tile .body{padding:10px 12px}
.animal-tile .name{font-weight:700}
.checkbox{display:flex;gap:10px;align-items:flex-start;font-weight:400}
.checkbox input{width:20px;height:20px;margin:2px 0 0;flex:none}
fieldset{border:1px solid var(--line);border-radius:var(--radius);padding:16px;margin:0 0 16px}
legend{font-weight:700;padding:0 6px}
.split{display:grid;gap:18px}
@media(min-width:820px){.split{grid-template-columns:1.4fr 1fr;align-items:start}}
.sticky-actions{position:sticky;bottom:0;background:var(--paper);padding:12px 0;border-top:1px solid var(--line);margin-top:18px}
`;

export function page({ title, session, body, active = '', wide = true }) {
  const nav = session
    ? [
        ['/admin/', 'Животные', 'animals'],
        ['/admin/applications', 'Заявки', 'applications'],
        ['/admin/publish', 'Публикация', 'publish'],
        ['/admin/account', 'Профиль', 'account'],
      ]
    : [];
  return `<!doctype html>
<html lang="ru"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="robots" content="noindex,nofollow">
<title>${esc(title)} — админка «Верный друг»</title>
<style>${STYLES}</style>
</head><body>
${
  session
    ? `<header class="top"><div class="bar">
        <a class="brand" href="/admin/">🐾 Верный друг</a>
        ${nav.map(([href, label, key]) => `<a href="${href}"${key === active ? ' aria-current="page"' : ''}>${label}</a>`).join('')}
        <span class="who">${esc(session.name || session.login)}</span>
        <form method="post" action="/admin/logout" style="margin:0">
          <input type="hidden" name="csrf" value="${esc(session.csrf)}">
          <button class="btn btn--sm btn--ghost" type="submit">Выйти</button>
        </form>
      </div></header>`
    : ''
}
<div class="wrap${wide ? '' : ' wrap--narrow'}">${body}</div>
</body></html>`;
}

export function notice(text, kind = '') {
  if (!text) return '';
  const cls = kind === 'error' ? ' notice--error' : kind === 'warn' ? ' notice--warn' : '';
  return `<div class="notice${cls}">${esc(text)}</div>`;
}
