// Авторизация для бессерверной среды: учётная запись из переменных окружения,
// сессия — в подписанной куке (на диск писать некуда и незачем).
//
// Пароль хранится только хэшем scrypt, как и в обычной сборке: значение
// ADMIN_PASSWORD_HASH получают командой `node scripts/make-admin-hash.mjs`.

import { createHmac, timingSafeEqual, randomBytes } from 'node:crypto';
import { hashPassword, verifyPassword } from './auth.mjs';

const SESSION_COOKIE = 'vd_session';
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

const LOGIN = process.env.ADMIN_LOGIN || '';
const PASSWORD_HASH = process.env.ADMIN_PASSWORD_HASH || '';
const NAME = process.env.ADMIN_NAME || LOGIN;
// Секрет подписи. Без него вход невозможен — это защита от случайного запуска
// с предсказуемым ключом.
const SECRET = process.env.SESSION_SECRET || '';

export function isConfigured() {
  return Boolean(LOGIN && PASSWORD_HASH && SECRET);
}

function sign(payload) {
  return createHmac('sha256', SECRET).update(payload).digest('base64url');
}

function safeEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}

export async function listAdmins() {
  if (!isConfigured()) return [];
  return [{ id: 'env', login: LOGIN, name: NAME, role: 'owner', passwordHash: PASSWORD_HASH }];
}

export async function findAdmin(login) {
  const admins = await listAdmins();
  return admins.find((a) => a.login.toLowerCase() === String(login || '').trim().toLowerCase()) || null;
}

export async function createAdmin() {
  throw Object.assign(
    new Error('Учётная запись задаётся переменными окружения ADMIN_LOGIN и ADMIN_PASSWORD_HASH в настройках проекта.'),
    { statusCode: 400 },
  );
}

export async function setPassword() {
  throw Object.assign(
    new Error('Пароль меняется в переменной ADMIN_PASSWORD_HASH в настройках проекта на Vercel — так он не хранится на сервере.'),
    { statusCode: 400 },
  );
}

/** Кука вида base64(json).подпись — состояние на сервере не нужно. */
export async function createSession(admin) {
  const data = {
    adminId: admin.id,
    login: admin.login,
    name: admin.name,
    role: admin.role,
    csrf: randomBytes(24).toString('base64url'),
    expiresAt: Date.now() + SESSION_TTL_MS,
  };
  const payload = Buffer.from(JSON.stringify(data)).toString('base64url');
  return { id: `${payload}.${sign(payload)}`, ...data };
}

export async function getSession(raw) {
  if (!raw || !isConfigured()) return null;
  const dot = raw.lastIndexOf('.');
  if (dot < 1) return null;
  const payload = raw.slice(0, dot);
  const signature = raw.slice(dot + 1);
  if (!safeEqual(signature, sign(payload))) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!data.expiresAt || Date.now() > data.expiresAt) return null;
    return { id: raw, ...data };
  } catch {
    return null;
  }
}

export async function destroySession() {
  // Кука стирается на стороне браузера; хранить нечего.
}

export function csrfValid(session, provided) {
  return Boolean(session?.csrf && provided) && safeEqual(session.csrf, provided);
}

export { SESSION_COOKIE, SESSION_TTL_MS, hashPassword, verifyPassword };
