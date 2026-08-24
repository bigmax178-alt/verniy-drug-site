// Хранилище данных: обычные JSON-файлы с атомарной записью.
//
// Почему не база: у приюта десятки животных и единицы заявок в неделю. Файлы легко
// бэкапить (просто скопировать папку), открыть глазами и восстановить руками, а
// зависимостей и админства требуют ноль.
//
// ВАЖНО про 152-ФЗ: файлы с персональными данными (заявки, журнал согласий) лежат
// отдельно от публичных (карточки животных) и НИКОГДА не попадают в сборку сайта
// и в git. См. README.md в этой папке.

import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

const DATA_DIR = path.resolve(process.env.DATA_DIR || './data-runtime');

export const paths = {
  root: DATA_DIR,
  // Публичные данные — уезжают на сайт при публикации.
  animals: path.join(DATA_DIR, 'public', 'animals.json'),
  publicDir: path.join(DATA_DIR, 'public'),
  mediaDir: path.join(DATA_DIR, 'public', 'media'),
  // Персональные данные — только здесь, только в РФ, в git не попадают.
  applications: path.join(DATA_DIR, 'private', 'applications.jsonl'),
  consents: path.join(DATA_DIR, 'private', 'consents.jsonl'),
  privateDir: path.join(DATA_DIR, 'private'),
  // Служебное.
  admins: path.join(DATA_DIR, 'private', 'admins.json'),
  sessions: path.join(DATA_DIR, 'private', 'sessions.json'),
  audit: path.join(DATA_DIR, 'private', 'audit.jsonl'),
};

export async function ensureDirs() {
  for (const dir of [paths.publicDir, paths.mediaDir, paths.privateDir]) {
    await fs.mkdir(dir, { recursive: true, mode: 0o750 });
  }
}

// ── атомарная запись ────────────────────────────────────────────────────────
// Пишем во временный файл и переименовываем: если процесс упадёт на середине,
// старый файл останется целым.
const locks = new Map();

async function withLock(file, fn) {
  const prev = locks.get(file) || Promise.resolve();
  let release;
  const next = new Promise((r) => (release = r));
  locks.set(file, prev.then(() => next));
  await prev;
  try {
    return await fn();
  } finally {
    release();
    if (locks.get(file) === next) locks.delete(file);
  }
}

async function writeAtomic(file, content, mode = 0o640) {
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, content, { mode });
  await fs.rename(tmp, file);
}

export async function readJsonFile(file, fallback) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch (e) {
    if (e.code === 'ENOENT') return fallback;
    throw e;
  }
}

export async function writeJsonFile(file, data, mode) {
  return withLock(file, () => writeAtomic(file, JSON.stringify(data, null, 2), mode));
}

/** Дописывает строку в JSONL (журналы заявок, согласий, аудита). */
export async function appendLine(file, obj, mode = 0o640) {
  return withLock(file, async () => {
    await fs.appendFile(file, JSON.stringify(obj) + '\n', { mode });
  });
}

export async function readLines(file) {
  try {
    const text = await fs.readFile(file, 'utf8');
    return text
      .split('\n')
      .filter(Boolean)
      .map((l) => {
        try {
          return JSON.parse(l);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  } catch (e) {
    if (e.code === 'ENOENT') return [];
    throw e;
  }
}

/** Перезаписывает JSONL целиком — нужно для удаления ПДн по запросу субъекта. */
export async function rewriteLines(file, records, mode = 0o640) {
  return withLock(file, () => writeAtomic(file, records.map((r) => JSON.stringify(r)).join('\n') + (records.length ? '\n' : ''), mode));
}

// ── животные ────────────────────────────────────────────────────────────────
// Структура: { version, updatedAt, animals: [...] }
// Каждая запись — либо самостоятельное животное (source: 'manual'),
// либо переопределение полей животного из ВКонтакте (source: 'override', id совпадает с VK).

const EMPTY_ANIMALS = { version: 1, updatedAt: null, animals: [] };

export async function getAnimals() {
  return readJsonFile(paths.animals, structuredClone(EMPTY_ANIMALS));
}

export async function saveAnimals(animals) {
  const data = { version: 1, updatedAt: new Date().toISOString(), animals };
  await writeJsonFile(paths.animals, data, 0o644);
  return data;
}

export async function upsertAnimal(record) {
  const data = await getAnimals();
  const i = data.animals.findIndex((a) => a.id === record.id);
  if (i >= 0) data.animals[i] = { ...data.animals[i], ...record, updatedAt: new Date().toISOString() };
  else data.animals.push({ ...record, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
  return saveAnimals(data.animals);
}

export async function deleteAnimal(id) {
  const data = await getAnimals();
  const next = data.animals.filter((a) => a.id !== id);
  await saveAnimals(next);
  return data.animals.length !== next.length;
}

// ── заявки и согласия ───────────────────────────────────────────────────────

export async function addApplication(app) {
  await appendLine(paths.applications, app, 0o600);
  return app;
}

export async function listApplications() {
  const list = await readLines(paths.applications);
  return list.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export async function updateApplication(id, patch) {
  const list = await readLines(paths.applications);
  let found = null;
  const next = list.map((a) => {
    if (a.id !== id) return a;
    found = { ...a, ...patch, updatedAt: new Date().toISOString() };
    return found;
  });
  if (found) await rewriteLines(paths.applications, next, 0o600);
  return found;
}

/** Удаление заявки — по отзыву согласия или по достижении цели обработки. */
export async function deleteApplication(id) {
  const list = await readLines(paths.applications);
  const next = list.filter((a) => a.id !== id);
  if (next.length === list.length) return false;
  await rewriteLines(paths.applications, next, 0o600);
  return true;
}

/**
 * Журнал согласий: доказательство того, что согласие было получено.
 * Хранится отдельно от заявки, чтобы пережить её удаление (ст. 9 152-ФЗ:
 * оператор обязан подтвердить получение согласия).
 */
export async function logConsent(entry) {
  await appendLine(paths.consents, entry, 0o600);
}

export async function listConsents() {
  return readLines(paths.consents);
}

// ── аудит действий администратора ───────────────────────────────────────────

export async function audit(action, details = {}) {
  await appendLine(paths.audit, { at: new Date().toISOString(), action, ...details }, 0o600);
}

export async function listAudit(limit = 200) {
  const list = await readLines(paths.audit);
  return list.slice(-limit).reverse();
}

// ── медиафайлы ──────────────────────────────────────────────────────────────

const SAFE_NAME = /^[a-zA-Z0-9._-]+$/;

export function mediaPath(name) {
  if (!SAFE_NAME.test(name) || name.includes('..')) throw Object.assign(new Error('Недопустимое имя файла'), { statusCode: 400 });
  return path.join(paths.mediaDir, name);
}

export async function saveMedia(buffer, ext) {
  const hash = createHash('sha256').update(buffer).digest('hex').slice(0, 16);
  const name = `${hash}.${ext}`;
  const file = mediaPath(name);
  try {
    await fs.access(file);
  } catch {
    await fs.writeFile(file, buffer, { mode: 0o644 });
  }
  return { name, url: `/media/${name}`, bytes: buffer.length };
}

export async function listMedia() {
  try {
    return await fs.readdir(paths.mediaDir);
  } catch {
    return [];
  }
}

export async function deleteMedia(name) {
  try {
    await fs.unlink(mediaPath(name));
    return true;
  } catch {
    return false;
  }
}

// ── животные, которые уже есть на сайте ─────────────────────────────────────
// Приходят из ВКонтакте или со старого сайта. Админка показывает их, чтобы
// карточку можно было поправить: правка сохраняется отдельной записью
// с source: 'override', а исходные данные остаются нетронутыми.

const REPO_DIR = path.resolve(process.env.REPO_DIR || process.cwd());

export async function listSiteAnimals() {
  const vk = await readJsonFile(path.join(REPO_DIR, 'src/data/vk/market.json'), null);
  if (vk?.animals?.length) return vk.animals;
  const seed = await readJsonFile(path.join(REPO_DIR, 'data/seed/animals.json'), null);
  return Array.isArray(seed) ? seed : [];
}

// ── публикация карточек на сайт ─────────────────────────────────────────────
// Сайт собирается из репозитория, поэтому «Опубликовать» кладёт туда публичную
// часть карточек. Персональные данные опекунов при этом снимаются: в репозиторий
// (он публичный и за границей) уходит только пометка, что опекун есть.

async function ghRequest(repo, token, pathname, options = {}) {
  const res = await fetch(`https://api.github.com/repos/${repo}/${pathname}`, {
    ...options,
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${token}`,
      'user-agent': 'verniy-drug-admin',
      'x-github-api-version': '2022-11-28',
      ...(options.headers || {}),
    },
  });
  return res;
}

export async function publishAnimalsToRepo(publicAnimals) {
  const repo = process.env.GITHUB_REPO;
  const token = process.env.PUBLISH_TOKEN || process.env.GITHUB_TOKEN;
  const branch = process.env.GITHUB_BRANCH || 'main';
  if (!repo || !token) {
    throw Object.assign(new Error('Публикация не настроена: нужны GITHUB_REPO и PUBLISH_TOKEN.'), { statusCode: 400 });
  }

  // Фотографии лежат на этом компьютере, поэтому вместе с карточками кладём в
  // репозиторий и сами файлы, а ссылки переписываем на их будущий адрес на сайте.
  const uploaded = new Map();
  async function publishPhoto(url) {
    if (!url || !url.startsWith('/media/')) return url;
    const name = url.slice('/media/'.length);
    if (uploaded.has(name)) return uploaded.get(name);
    let buffer;
    try {
      buffer = await fs.readFile(mediaPath(name));
    } catch {
      return null; // файла нет — лучше карточка без фото, чем битая картинка
    }
    const target = `public/media/admin/${name}`;
    const head = await ghRequest(repo, token, `contents/${target}?ref=${encodeURIComponent(branch)}`);
    if (head.status === 404) {
      const put = await ghRequest(repo, token, `contents/${target}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message: `admin: фотография ${name}`, content: buffer.toString('base64'), branch }),
      });
      if (!put.ok) {
        const text = await put.text().catch(() => '');
        throw Object.assign(new Error(`Не удалось загрузить фото: GitHub ${put.status} ${text.slice(0, 120)}`), { statusCode: 502 });
      }
    }
    const publicUrl = `/media/admin/${name}`;
    uploaded.set(name, publicUrl);
    return publicUrl;
  }

  const animals = [];
  for (const a of publicAnimals) {
    const photos = [];
    for (const ph of a.photos || []) {
      const src = await publishPhoto(ph.src);
      if (!src) continue;
      const thumb = ph.thumb && ph.thumb !== ph.src ? await publishPhoto(ph.thumb) : src;
      photos.push({ ...ph, src, thumb: thumb || src });
    }
    let patron = a.patron || null;
    if (patron && !patron.anonymous && patron.photo) patron = { ...patron, photo: await publishPhoto(patron.photo) };
    animals.push({ ...a, photos, patron });
  }

  const filePath = 'src/data/admin/animals.json';
  const head = await ghRequest(repo, token, `contents/${filePath}?ref=${encodeURIComponent(branch)}`);
  const sha = head.ok ? (await head.json()).sha : undefined;

  const body = JSON.stringify({ version: 1, updatedAt: new Date().toISOString(), animals }, null, 1);
  const res = await ghRequest(repo, token, `contents/${filePath}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      message: `admin: публикация карточек (${animals.length})`,
      content: Buffer.from(body).toString('base64'),
      branch,
      ...(sha ? { sha } : {}),
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw Object.assign(new Error(`GitHub ответил ${res.status}: ${text.slice(0, 150)}`), { statusCode: 502 });
  }
  return animals.length;
}
