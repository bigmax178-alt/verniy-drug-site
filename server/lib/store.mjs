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
