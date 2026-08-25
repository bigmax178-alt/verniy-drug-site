#!/usr/bin/env node
// Публикует локальную админку в интернет через Cloudflare Tunnel, чтобы заявки
// с боевого сайта доходили до этого компьютера.
//
//   npm run tunnel
//
// Что делает:
//   1. поднимает туннель к http://localhost:8787;
//   2. узнаёт выданный адрес (он меняется при каждом переподключении);
//   3. кладёт адрес в репозиторий — сайт спрашивает его во время работы,
//      поэтому пересобирать сайт при смене адреса не нужно.
//
// Пока туннель работает — заявки приходят на этот компьютер. Закроете окно
// или выключите Mac — форма на сайте вернётся к телефону куратора.
//
// ВАЖНО про закон: сами заявки хранятся здесь, на этом компьютере. Через
// Cloudflare они только проходят транзитом, но трафик там расшифровывается,
// поэтому это решение временное — до переезда на сервер в России.

import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

const PORT = process.env.ADMIN_PORT || '8787';
const CLOUDFLARED = process.env.CLOUDFLARED || path.join(os.homedir(), '.local/bin/cloudflared');
const REPO = process.env.GITHUB_REPO || 'bigmax178-alt/verniy-drug-site';

let currentUrl = null;

async function localAdminAlive() {
  try {
    const res = await fetch(`http://localhost:${PORT}/healthz`, { signal: AbortSignal.timeout(3000) });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Кладёт адрес туннеля в репозиторий отдельным файлом. Сайт спрашивает его во
 * время работы, поэтому пересобирать всё из-за смены адреса не нужно.
 */
async function publishBackendUrl(url) {
  const repo = process.env.GITHUB_REPO || REPO;
  const token = process.env.PUBLISH_TOKEN || process.env.GITHUB_TOKEN;
  if (!token) throw new Error('нет PUBLISH_TOKEN — адрес некуда записать');
  const filePath = 'src/data/admin/backend.json';
  const api = `https://api.github.com/repos/${repo}/contents/${filePath}`;
  const headers = {
    accept: 'application/vnd.github+json',
    authorization: `Bearer ${token}`,
    'user-agent': 'verniy-drug-tunnel',
    'x-github-api-version': '2022-11-28',
  };
  const head = await fetch(`${api}?ref=main`, { headers });
  const sha = head.ok ? (await head.json()).sha : undefined;
  const body = JSON.stringify({ url, updatedAt: new Date().toISOString() }, null, 1);
  const res = await fetch(api, {
    method: 'PUT',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify({
      message: 'tunnel: адрес приёма заявок',
      content: Buffer.from(body).toString('base64'),
      branch: 'main',
      ...(sha ? { sha } : {}),
    }),
  });
  if (!res.ok) throw new Error(`GitHub ${res.status}`);
}

async function applyUrl(url) {
  if (url === currentUrl) return;
  currentUrl = url;
  console.log(`\nАдрес туннеля: ${url}`);
  try {
    await publishBackendUrl(url);
    console.log('Сайт узнает новый адрес в течение минуты — пересборка не нужна.');
    console.log('Форма заявки на боевом сайте работает и шлёт заявки на этот компьютер.');
    console.log('Проверить: https://verniy-drug-site.vercel.app/animals/boss/');
  } catch (e) {
    console.error('Не удалось сообщить сайту адрес:', e.message);
    console.error('Заявки с боевого сайта приходить не будут, форма покажет телефон куратора.');
  }
  console.log('Не закрывайте это окно — туннель живёт, пока оно открыто.\n');
}

async function main() {
  if (!(await localAdminAlive())) {
    console.error(`Админка не отвечает на http://localhost:${PORT}. Запустите: npm run admin:start`);
    process.exit(1);
  }

  console.log('Поднимаю туннель…');
  const cf = spawn(CLOUDFLARED, ['tunnel', '--url', `http://localhost:${PORT}`, '--no-autoupdate'], { stdio: ['ignore', 'pipe', 'pipe'] });

  cf.on('error', (e) => {
    console.error(`Не удалось запустить cloudflared (${CLOUDFLARED}): ${e.message}`);
    console.error('Установите его — команда есть в server/README.md, раздел «Туннель».');
    process.exit(1);
  });

  const onData = (buf) => {
    const text = buf.toString();
    const m = text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
    if (m) applyUrl(m[0]).catch((e) => console.error('Ошибка настройки:', e.message));
    if (process.env.TUNNEL_VERBOSE) process.stderr.write(text);
  };
  cf.stdout.on('data', onData);
  cf.stderr.on('data', onData);

  const stop = async () => {
    console.log('\nЗакрываю туннель…');
    cf.kill();
    // Сообщаем сайту, что приём выключен: иначе форма осталась бы висеть
    // с мёртвым адресом и молча теряла заявки.
    try {
      await publishBackendUrl(null);
      console.log('Форма на сайте вернулась к телефону куратора.');
    } catch {
      console.log('Не удалось сообщить сайту об остановке — проверьте вручную.');
    }
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
