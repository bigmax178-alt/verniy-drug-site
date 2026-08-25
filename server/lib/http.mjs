// Небольшие помощники поверх node:http — без фреймворков, как и весь проект.

import { randomBytes } from 'node:crypto';

export const MAX_BODY = 1024 * 1024; // 1 МБ для обычных запросов
export const MAX_UPLOAD = 12 * 1024 * 1024; // 12 МБ для фотографий

/** Читает тело запроса целиком с ограничением размера. */
export async function readBody(req, limit = MAX_BODY) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) {
      const err = new Error('Тело запроса слишком большое');
      err.statusCode = 413;
      throw err;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export async function readJson(req, limit = MAX_BODY) {
  const buf = await readBody(req, limit);
  if (!buf.length) return {};
  try {
    return JSON.parse(buf.toString('utf8'));
  } catch {
    const err = new Error('Ожидался корректный JSON');
    err.statusCode = 400;
    throw err;
  }
}

/**
 * Разбор формы. Повторяющиеся поля (например, несколько отмеченных галочек
 * с одним именем) складываются в массив, а не затирают друг друга.
 */
export async function readForm(req, limit = MAX_BODY) {
  const buf = await readBody(req, limit);
  const params = new URLSearchParams(buf.toString('utf8'));
  const out = {};
  for (const key of new Set(params.keys())) {
    const values = params.getAll(key);
    out[key] = values.length > 1 ? values : values[0];
  }
  return out;
}

export function parseCookies(req) {
  const header = req.headers.cookie || '';
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export function setCookie(res, name, value, { maxAge, secure = true, httpOnly = true, sameSite = 'Lax', path = '/' } = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`, `Path=${path}`, `SameSite=${sameSite}`];
  if (httpOnly) parts.push('HttpOnly');
  if (secure) parts.push('Secure');
  if (maxAge !== undefined) parts.push(`Max-Age=${maxAge}`);
  const prev = res.getHeader('Set-Cookie');
  const list = Array.isArray(prev) ? prev : prev ? [prev] : [];
  res.setHeader('Set-Cookie', [...list, parts.join('; ')]);
}

export function send(res, status, body, headers = {}) {
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(String(body), 'utf8');
  res.writeHead(status, {
    'content-length': buf.length,
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'strict-origin-when-cross-origin',
    ...headers,
  });
  res.end(buf);
}

export function sendHtml(res, status, html, headers = {}) {
  send(res, status, html, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
    // Админка не должна открываться во фрейме и не грузит внешние ресурсы.
    'content-security-policy': "default-src 'self'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; frame-ancestors 'none'; form-action 'self'",
    ...headers,
  });
}

export function sendJson(res, status, data, headers = {}) {
  send(res, status, JSON.stringify(data), { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers });
}

export function redirect(res, location, status = 303) {
  res.writeHead(status, { location, 'cache-control': 'no-store' });
  res.end();
}

export function token(bytes = 32) {
  return randomBytes(bytes).toString('base64url');
}

/** Простое ограничение частоты по ключу (память процесса). */
export function createRateLimiter({ windowMs, max }) {
  const hits = new Map();
  return {
    check(key) {
      const now = Date.now();
      const rec = hits.get(key);
      if (!rec || now > rec.reset) {
        hits.set(key, { count: 1, reset: now + windowMs });
        return { ok: true, remaining: max - 1 };
      }
      rec.count++;
      if (rec.count > max) return { ok: false, retryAfter: Math.ceil((rec.reset - now) / 1000) };
      return { ok: true, remaining: max - rec.count };
    },
    reset(key) {
      hits.delete(key);
    },
    sweep() {
      const now = Date.now();
      for (const [k, v] of hits) if (now > v.reset) hits.delete(k);
    },
  };
}

/** IP клиента с учётом обратного прокси (доверяем заголовку только если TRUST_PROXY=1). */
export function clientIp(req, trustProxy = process.env.TRUST_PROXY === '1') {
  if (trustProxy) {
    const fwd = req.headers['x-forwarded-for'];
    if (fwd) return String(fwd).split(',')[0].trim();
  }
  return req.socket.remoteAddress || 'unknown';
}
