// Вход администратора: пароль (scrypt) + сессия в HttpOnly-куке + CSRF-токен.
// Учётные записи хранятся в data-runtime/private/admins.json, пароли — только хэшем.

import { scrypt, randomBytes, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { paths, readJsonFile, writeJsonFile, audit } from './store.mjs';
import { token } from './http.mjs';

const scryptAsync = promisify(scrypt);
const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 часов — рабочий день
const SESSION_COOKIE = 'vd_session';

// ── пароли ──────────────────────────────────────────────────────────────────

export async function hashPassword(password) {
  const salt = randomBytes(16);
  const key = await scryptAsync(password.normalize('NFKC'), salt, 64);
  return `scrypt$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(password, stored) {
  try {
    const [scheme, saltB64, keyB64] = String(stored).split('$');
    if (scheme !== 'scrypt') return false;
    const salt = Buffer.from(saltB64, 'base64');
    const expected = Buffer.from(keyB64, 'base64');
    const actual = await scryptAsync(String(password).normalize('NFKC'), salt, expected.length);
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

// ── учётные записи ──────────────────────────────────────────────────────────

export async function listAdmins() {
  const data = await readJsonFile(paths.admins, { admins: [] });
  return data.admins;
}

export async function saveAdmins(admins) {
  await writeJsonFile(paths.admins, { admins }, 0o600);
}

export async function findAdmin(login) {
  const admins = await listAdmins();
  const norm = String(login || '').trim().toLowerCase();
  return admins.find((a) => a.login.toLowerCase() === norm) || null;
}

export async function createAdmin({ login, password, name, role = 'admin' }) {
  const admins = await listAdmins();
  if (admins.some((a) => a.login.toLowerCase() === login.toLowerCase())) {
    throw new Error(`Пользователь «${login}» уже существует`);
  }
  const admin = {
    id: token(8),
    login: login.trim(),
    name: name || login.trim(),
    role,
    passwordHash: await hashPassword(password),
    createdAt: new Date().toISOString(),
    mustChangePassword: false,
  };
  admins.push(admin);
  await saveAdmins(admins);
  return admin;
}

export async function setPassword(id, password) {
  const admins = await listAdmins();
  const admin = admins.find((a) => a.id === id);
  if (!admin) return false;
  admin.passwordHash = await hashPassword(password);
  admin.mustChangePassword = false;
  admin.passwordChangedAt = new Date().toISOString();
  await saveAdmins(admins);
  return true;
}

// ── сессии ──────────────────────────────────────────────────────────────────
// Держим в файле, чтобы вход переживал перезапуск сервера.

async function readSessions() {
  return readJsonFile(paths.sessions, {});
}

async function writeSessions(sessions) {
  await writeJsonFile(paths.sessions, sessions, 0o600);
}

export async function createSession(admin, meta = {}) {
  const sessions = await readSessions();
  const id = token(32);
  sessions[id] = {
    adminId: admin.id,
    login: admin.login,
    name: admin.name,
    role: admin.role,
    csrf: token(24),
    createdAt: Date.now(),
    expiresAt: Date.now() + SESSION_TTL_MS,
    ip: meta.ip || null,
  };
  await pruneSessions(sessions);
  await writeSessions(sessions);
  await audit('login', { login: admin.login, ip: meta.ip });
  return { id, ...sessions[id] };
}

export async function getSession(id) {
  if (!id) return null;
  const sessions = await readSessions();
  const s = sessions[id];
  if (!s) return null;
  if (Date.now() > s.expiresAt) {
    delete sessions[id];
    await writeSessions(sessions);
    return null;
  }
  return { id, ...s };
}

export async function destroySession(id) {
  const sessions = await readSessions();
  if (sessions[id]) {
    await audit('logout', { login: sessions[id].login });
    delete sessions[id];
    await writeSessions(sessions);
  }
}

async function pruneSessions(sessions) {
  const now = Date.now();
  for (const [k, v] of Object.entries(sessions)) if (now > v.expiresAt) delete sessions[k];
}

export { SESSION_COOKIE, SESSION_TTL_MS };

/** Сравнение CSRF-токенов в постоянное время. */
export function csrfValid(session, provided) {
  if (!session?.csrf || !provided) return false;
  const a = Buffer.from(session.csrf);
  const b = Buffer.from(String(provided));
  return a.length === b.length && timingSafeEqual(a, b);
}
