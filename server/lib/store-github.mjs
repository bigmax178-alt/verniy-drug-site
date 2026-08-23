// Хранилище для бессерверной среды (Vercel): данные лежат прямо в git-репозитории.
//
// Почему так: у Vercel эфемерная файловая система — то, что записано на диск,
// исчезает после завершения функции. Git решает это лучше базы: карточки животных
// версионируются, видно кто и когда что менял, откат — одна команда, а коммит
// автоматически запускает пересборку сайта.
//
// ВАЖНО: репозиторий публичный, а сервер — за пределами России. Поэтому здесь
// НЕ хранятся персональные данные: ни заявки, ни имена опекунов. За это отвечает
// флаг features.personalData в роутере. См. server/README.md.

const API = 'https://api.github.com';

const repo = process.env.GITHUB_REPO || '';
const branch = process.env.GITHUB_BRANCH || 'main';
const token = process.env.GITHUB_TOKEN || '';

// Файл, который читает сборщик сайта напрямую — промежуточная синхронизация не нужна.
const ANIMALS_PATH = 'src/data/admin/animals.json';
const MEDIA_DIR = 'public/media/admin';

export const paths = { root: `github:${repo}@${branch}` };

export function isConfigured() {
  return Boolean(repo && token);
}

async function gh(pathname, options = {}) {
  const res = await fetch(`${API}${pathname}`, {
    ...options,
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${token}`,
      'user-agent': 'verniy-drug-admin',
      'x-github-api-version': '2022-11-28',
      ...(options.headers || {}),
    },
  });
  if (res.status === 404) return null;
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const err = new Error(`GitHub ${res.status}: ${text.slice(0, 200)}`);
    err.statusCode = res.status === 409 ? 409 : 502;
    throw err;
  }
  return res.json();
}

async function getFile(filePath) {
  const data = await gh(`/repos/${repo}/contents/${encodeURI(filePath)}?ref=${encodeURIComponent(branch)}`);
  if (!data) return null;
  return { sha: data.sha, content: Buffer.from(data.content || '', 'base64') };
}

async function putFile(filePath, buffer, message, sha) {
  return gh(`/repos/${repo}/contents/${encodeURI(filePath)}`, {
    method: 'PUT',
    body: JSON.stringify({
      message,
      content: Buffer.from(buffer).toString('base64'),
      branch,
      ...(sha ? { sha } : {}),
    }),
  });
}

export async function ensureDirs() {
  /* в git каталоги создаются вместе с файлами */
}

// ── животные ────────────────────────────────────────────────────────────────

const EMPTY = { version: 1, updatedAt: null, animals: [] };

export async function getAnimals() {
  const file = await getFile(ANIMALS_PATH);
  if (!file) return { ...structuredClone(EMPTY), _sha: null };
  try {
    const data = JSON.parse(file.content.toString('utf8'));
    return { ...data, animals: data.animals || [], _sha: file.sha };
  } catch {
    return { ...structuredClone(EMPTY), _sha: file.sha };
  }
}

export async function saveAnimals(animals, message = 'admin: обновление карточек животных') {
  const current = await getAnimals();
  const data = { version: 1, updatedAt: new Date().toISOString(), animals };
  await putFile(ANIMALS_PATH, JSON.stringify(data, null, 1), message, current._sha || undefined);
  return data;
}

export async function upsertAnimal(record) {
  const data = await getAnimals();
  const i = data.animals.findIndex((a) => a.id === record.id);
  const now = new Date().toISOString();
  if (i >= 0) data.animals[i] = { ...data.animals[i], ...record, updatedAt: now };
  else data.animals.push({ ...record, createdAt: now, updatedAt: now });
  return saveAnimals(data.animals, `admin: карточка «${record.name}»`);
}

export async function deleteAnimal(id) {
  const data = await getAnimals();
  const next = data.animals.filter((a) => a.id !== id);
  if (next.length === data.animals.length) return false;
  await saveAnimals(next, 'admin: удаление карточки');
  return true;
}

// ── медиафайлы ──────────────────────────────────────────────────────────────

const SAFE_NAME = /^[a-zA-Z0-9._-]+$/;

export function mediaPath(name) {
  if (!SAFE_NAME.test(name) || name.includes('..')) throw Object.assign(new Error('Недопустимое имя файла'), { statusCode: 400 });
  return `${MEDIA_DIR}/${name}`;
}

export async function saveMedia(buffer, ext) {
  const { createHash } = await import('node:crypto');
  const hash = createHash('sha256').update(buffer).digest('hex').slice(0, 16);
  const name = `${hash}.${ext}`;
  const filePath = mediaPath(name);
  const existing = await getFile(filePath);
  if (!existing) await putFile(filePath, buffer, `admin: фотография ${name}`);
  // Путь совпадает с тем, где файл окажется на сайте после сборки.
  return { name, url: `/media/admin/${name}`, bytes: buffer.length };
}

/** Читает файл из репозитория — нужно, пока свежая фотография ещё не попала в сборку. */
export async function readMedia(name) {
  const file = await getFile(mediaPath(name));
  return file ? file.content : null;
}

export async function listMedia() {
  const data = await gh(`/repos/${repo}/contents/${encodeURI(MEDIA_DIR)}?ref=${encodeURIComponent(branch)}`);
  return Array.isArray(data) ? data.map((f) => f.name) : [];
}

export async function deleteMedia() {
  // Фотографии остаются в истории git — так безопаснее: случайное удаление обратимо.
  return false;
}

// ── персональные данные: в этой среде не хранятся ───────────────────────────
// Функции есть, чтобы роутер не падал, но они ничего не принимают.
// Приём заявок включается только там, где база находится в России.

const PD_DISABLED = 'В этой среде персональные данные не обрабатываются: нужен сервер в России (ч. 5 ст. 18 152-ФЗ).';

export async function addApplication() {
  throw Object.assign(new Error(PD_DISABLED), { statusCode: 503 });
}
export async function listApplications() {
  return [];
}
export async function updateApplication() {
  return null;
}
export async function deleteApplication() {
  return false;
}
export async function logConsent() {
  throw Object.assign(new Error(PD_DISABLED), { statusCode: 503 });
}
export async function listConsents() {
  return [];
}

// ── журнал действий ─────────────────────────────────────────────────────────
// Коммитить файл на каждое действие — слишком шумно, поэтому пишем в лог Vercel.

export async function audit(action, details = {}) {
  console.log('[audit]', JSON.stringify({ at: new Date().toISOString(), action, ...details }));
}
export async function listAudit() {
  return [];
}
