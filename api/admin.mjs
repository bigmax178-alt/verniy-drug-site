// Админка приюта в бессерверной функции Vercel.
//
// Что она умеет: вести карточки животных — их фотографии, описания, статусы.
// Чего она НЕ делает намеренно: не принимает заявки на опекунство и не хранит
// имена и фотографии опекунов. Это персональные данные, а ч. 5 ст. 18 152-ФЗ
// требует записывать их в базу на территории России — Vercel этому не отвечает.
// Полная версия с заявками запускается на российском сервере: server/README.md.
//
// Данные лежат в git-репозитории (src/data/admin/animals.json), поэтому
// сохранение карточки автоматически запускает пересборку сайта.

import * as store from '../server/lib/store-github.mjs';
import * as auth from '../server/lib/auth-stateless.mjs';
import { createRouter } from '../server/lib/router.mjs';
import { sendHtml, sendJson, send } from '../server/lib/http.mjs';
import * as views from '../server/views/pages.mjs';

const route = createRouter({
  store,
  auth,
  features: { acceptsApplications: false, personalData: false, servesMedia: false },
});

const MIME = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };

function setupHint(missing) {
  return views.errorPage(
    `Админка ещё не настроена: в проекте не заданы переменные ${missing.join(', ')}. ` +
      'Добавьте их в Vercel → Settings → Environment Variables и сделайте повторный деплой. Как получить значения — в server/README.md.',
  );
}

export default async function handler(req, res) {
  // Перед функцией стоит правило переадресации, поэтому настоящий путь
  // приходит отдельным параметром: /admin/... или /media/admin/...
  const incoming = new URL(req.url, 'http://localhost');
  const realPath = incoming.searchParams.get('__path') || incoming.pathname;
  const url = new URL(realPath, 'http://localhost');
  for (const [k, v] of incoming.searchParams) if (k !== '__path') url.searchParams.set(k, v);
  // Роутер читает req.url при разборе тела и cookie — приводим к настоящему пути.
  req.url = url.pathname + url.search;

  try {
    const missing = [];
    if (!store.isConfigured()) missing.push('GITHUB_REPO', 'GITHUB_TOKEN');
    if (!auth.isConfigured()) missing.push('ADMIN_LOGIN', 'ADMIN_PASSWORD_HASH', 'SESSION_SECRET');
    if (missing.length) return sendHtml(res, 503, setupHint([...new Set(missing)]));

    // Адрес приёмного сервера заявок. Сайт спрашивает его во время работы, а не
    // берёт из сборки: туннель получает новый адрес при каждом переподключении,
    // и запечённый в страницу адрес молча протухал бы.
    if (req.method === 'GET' && url.pathname === '/api/backend') {
      const info = await store.readBackendInfo();
      return sendJson(res, 200, info, {
        'access-control-allow-origin': '*',
        'cache-control': 'public, max-age=30',
      });
    }

    // Фотография, только что загруженная в админке, ещё не попала в сборку сайта —
    // отдаём её напрямую из репозитория, чтобы предпросмотр работал сразу.
    if (req.method === 'GET' && url.pathname.startsWith('/media/admin/')) {
      const name = decodeURIComponent(url.pathname.slice('/media/admin/'.length));
      const data = await store.readMedia(name);
      if (!data) return send(res, 404, 'Файл не найден', { 'content-type': 'text/plain; charset=utf-8' });
      return send(res, 200, data, {
        'content-type': MIME[name.split('.').pop().toLowerCase()] || 'application/octet-stream',
        'cache-control': 'public, max-age=300',
      });
    }

    await route(req, res, url);
  } catch (e) {
    const status = e.statusCode || 500;
    if (status >= 500) console.error('Ошибка админки', req.method, url.pathname, e);
    if (!res.headersSent) {
      if (url.pathname.startsWith('/api/')) sendJson(res, status, { error: status >= 500 ? 'Внутренняя ошибка' : e.message });
      else sendHtml(res, status, views.errorPage(status >= 500 ? 'Что-то пошло не так. Попробуйте ещё раз.' : e.message));
    }
  }
}
