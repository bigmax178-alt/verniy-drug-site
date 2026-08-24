#!/usr/bin/env node
// Публикует локальную админку в интернет через Cloudflare Tunnel, чтобы заявки
// с боевого сайта доходили до этого компьютера.
//
//   npm run tunnel
//
// Что делает:
//   1. поднимает туннель к http://localhost:8787;
//   2. узнаёт выданный адрес (он меняется при каждом запуске);
//   3. прописывает адрес в Vercel и в переменные GitHub Actions;
//   4. пересобирает сайт, чтобы форма заявки стучалась по новому адресу.
//
// Пока туннель работает — заявки приходят на этот компьютер. Закроете окно
// или выключите Mac — форма на сайте вернётся к телефону куратора.
//
// ВАЖНО про закон: сами заявки хранятся здесь, на этом компьютере. Через
// Cloudflare они только проходят транзитом, но трафик там расшифровывается,
// поэтому это решение временное — до переезда на сервер в России.

import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import os from 'node:os';
import path from 'node:path';

const run = promisify(execFile);

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

async function setVercelEnv(url) {
  // Пересоздаём переменную: значение меняется при каждом запуске туннеля.
  await run('npx', ['vercel', 'env', 'rm', 'ADMIN_API_URL', 'production', '--yes'], { cwd: process.cwd() }).catch(() => {});
  const child = spawn('npx', ['vercel', 'env', 'add', 'ADMIN_API_URL', 'production'], { cwd: process.cwd(), stdio: ['pipe', 'pipe', 'pipe'] });
  child.stdin.write(url);
  child.stdin.end();
  await new Promise((resolve) => child.on('close', resolve));
}

async function setGithubVariable(url) {
  // Нужна, чтобы плановая сборка забирала карточки животных из админки.
  await run('gh', ['variable', 'set', 'ADMIN_API_URL', '--repo', REPO, '--body', url], {
    env: { ...process.env, PATH: `${path.join(os.homedir(), '.local/bin')}:${process.env.PATH}` },
  }).catch((e) => console.warn('  ! не удалось записать переменную GitHub:', e.message));
}

async function redeploy() {
  await run('npx', ['vercel', '--prod', '--yes'], { cwd: process.cwd(), maxBuffer: 10 * 1024 * 1024 });
}

async function applyUrl(url) {
  if (url === currentUrl) return;
  currentUrl = url;
  console.log(`\nАдрес туннеля: ${url}`);
  console.log('Прописываю его в Vercel и GitHub…');
  await setVercelEnv(url);
  await setGithubVariable(url);
  console.log('Пересобираю сайт, чтобы форма заявки знала новый адрес…');
  await redeploy();
  console.log('\nГотово. Форма на боевом сайте отправляет заявки на этот компьютер.');
  console.log('Проверить: https://verniy-drug-site.vercel.app/animals/ben/');
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

  const stop = () => {
    console.log('\nЗакрываю туннель. Форма на сайте вернётся к телефону куратора.');
    cf.kill();
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
