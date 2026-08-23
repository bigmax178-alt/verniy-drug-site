#!/usr/bin/env node
// Локальный сервер админки приюта «Верный друг».
//
// Эта сборка умеет всё: и карточки животных, и приём заявок на опекунство.
// Персональные данные (заявки, журнал согласий) остаются только здесь и никогда
// не попадают ни в git, ни в статическую сборку сайта. Поэтому запускать её
// нужно на сервере в России — см. server/README.md.
//
// Запуск:  npm run admin:dev     (или DATA_DIR=./data-runtime node server/index.mjs)
// Первый вход: откройте /admin/ — сервер предложит создать учётную запись.

import http from 'node:http';

import * as store from './lib/store.mjs';
import * as auth from './lib/auth.mjs';
import { createRouter } from './lib/router.mjs';
import { sendHtml, sendJson } from './lib/http.mjs';
import * as views from './views/pages.mjs';

const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || '0.0.0.0';
const COOKIE_SECURE = process.env.COOKIE_SECURE !== '0';

const route = createRouter({ store, auth, features: { acceptsApplications: true, servesMedia: true } });

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  try {
    await route(req, res, url);
  } catch (e) {
    const status = e.statusCode || 500;
    if (status >= 500) console.error('Ошибка запроса', req.method, url.pathname, e);
    if (!res.headersSent) {
      if (url.pathname.startsWith('/api/')) sendJson(res, status, { error: status >= 500 ? 'Внутренняя ошибка' : e.message });
      else sendHtml(res, status, views.errorPage(status >= 500 ? 'Что-то пошло не так. Попробуйте ещё раз.' : e.message));
    }
  }
});

await store.ensureDirs();
server.listen(PORT, HOST, () => {
  console.log(`Админка приюта: http://localhost:${PORT}/admin/`);
  console.log(`Данные: ${store.paths.root}`);
  if (!COOKIE_SECURE) console.log('ВНИМАНИЕ: COOKIE_SECURE=0 — только для локальной отладки.');
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    server.close(() => process.exit(0));
  });
}
