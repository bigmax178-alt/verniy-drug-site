#!/usr/bin/env node
// Забирает карточки животных из админки приюта и зеркалит их фотографии в сборку.
//
//   ADMIN_API_URL=https://admin.verniy-drug.ru node scripts/sync-admin.mjs
//
// Забирается только публичная часть: имена животных, описания, фото и — если человек
// дал отдельное согласие — имя опекуна. Заявки и контакты людей сюда не приходят
// вообще: они остаются на сервере в России (152-ФЗ).
//
// Без ADMIN_API_URL скрипт молча завершается: сайт соберётся из данных ВКонтакте.

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const OUT_FILE = path.join(ROOT, 'src/data/admin/animals.json');
const MEDIA_DIR = path.join(ROOT, 'public/media/admin');

const base = (process.env.ADMIN_API_URL || '').replace(/\/$/, '');
if (!base) {
  console.log('ADMIN_API_URL не задан — пропускаю синхронизацию с админкой.');
  process.exit(0);
}

async function fetchJson(url) {
  const res = await fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.json();
}

/** Скачивает фото в public/media/admin и возвращает локальный путь. */
async function mirror(url) {
  if (!url || !url.startsWith('/media/')) return url;
  const name = path.basename(url);
  if (!/^[a-zA-Z0-9._-]+$/.test(name)) return null;
  const dest = path.join(MEDIA_DIR, name);
  try {
    await fs.access(dest);
    return `/media/admin/${name}`;
  } catch {
    /* файла ещё нет — качаем */
  }
  const res = await fetch(base + url, { signal: AbortSignal.timeout(30000) });
  if (!res.ok) {
    console.warn(`  ! не скачалось ${url}: HTTP ${res.status}`);
    return null;
  }
  await fs.writeFile(dest, Buffer.from(await res.arrayBuffer()));
  return `/media/admin/${name}`;
}

async function main() {
  await fs.mkdir(path.dirname(OUT_FILE), { recursive: true });
  await fs.mkdir(MEDIA_DIR, { recursive: true });

  console.log(`Синхронизация с админкой ${base}…`);
  let data;
  try {
    data = await fetchJson(`${base}/api/public/animals.json`);
  } catch (e) {
    // Админка недоступна — это не повод ронять сборку: возьмём прошлые данные.
    console.warn(`  ! админка недоступна (${e.message}). Оставляю прошлые данные.`);
    process.exit(0);
  }

  const animals = [];
  for (const a of data.animals || []) {
    const photos = [];
    for (const p of a.photos || []) {
      const src = await mirror(p.src);
      const thumb = p.thumb && p.thumb !== p.src ? await mirror(p.thumb) : src;
      if (src) photos.push({ src, thumb: thumb || src, w: p.w ?? null, h: p.h ?? null });
    }
    let patron = a.patron || null;
    if (patron?.photo) patron = { ...patron, photo: await mirror(patron.photo) };
    animals.push({ ...a, photos, patron });
  }

  await fs.writeFile(OUT_FILE, JSON.stringify({ version: data.version, updatedAt: data.updatedAt, syncedAt: new Date().toISOString(), animals }, null, 1));
  console.log(`  готово: ${animals.length} карточек, фото зеркалированы в public/media/admin.`);
}

main().catch((e) => {
  console.error('Синхронизация с админкой не удалась:', e.message);
  // Не роняем сборку: сайт должен собраться даже если админка лежит.
  process.exit(0);
});
