#!/usr/bin/env node
// Одноразовый импорт стартовых данных со старого сайта на Tilda.
// Нужен, чтобы сайт был живым до подключения VK API. После первой успешной
// синхронизации из VK эти данные используются только как запасной вариант.
//
//   node scripts/import-tilda-seed.mjs
//
// Пишет: data/seed/animals.json, data/seed/pages.json, public/media/seed/*.jpg, public/media/sbp-qr.jpg

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { htmlToText, slugify, parseBirthYear } from './lib/text.mjs';

const BASE = 'https://priutbestfriend.tilda.ws';
const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const SEED_DIR = path.join(ROOT, 'data/seed');
const MEDIA_DIR = path.join(ROOT, 'public/media/seed');

// Ручные уточнения там, где по тексту вид/пол не определить надёжно.
const OVERRIDES = {
  'Бен': { kind: 'dog', sex: 'm' },
  'Сан Саныч': { kind: 'cat', sex: 'm' },
  'Моня и Боня': { kind: 'dog', sex: 'f', count: 2 },
  'Дыма': { kind: 'cat', sex: 'm' },
  'Лиза': { kind: 'dog', sex: 'f' },
  'Спартак': { kind: 'cat', sex: 'm' },
  'Балу': { kind: 'dog', sex: 'm' },
  'Изи': { kind: 'cat', sex: 'f' },
  'Лара': { kind: 'dog', sex: 'f' },
  'Суслик': { kind: 'cat', sex: 'm' },
  'Грег': { kind: 'dog', sex: 'm' },
  'Полосатик': { kind: 'cat', sex: 'f' },
  'Харви': { kind: 'dog', sex: 'm' },
  'Соня': { kind: 'cat', sex: 'f' },
  'Луна': { kind: 'dog', sex: 'f' },
  'Тиша': { kind: 'dog', sex: 'm' },
  'Семён': { kind: 'dog', sex: 'm' },
};

async function fetchText(url) {
  const res = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 (verniy-drug-site importer)' } });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.text();
}

function splitRecords(html) {
  return html.split(/(?=<div id="rec\d+")/).filter((r) => /^<div id="rec\d+"/.test(r));
}

function imagesOf(block) {
  const re = /(?:data-original|data-img-zoom-url|src|data-lazy-src)="(https?:\/\/static\.tildacdn[^"]+\.(?:jpe?g|png|webp))"/gi;
  const out = [];
  let m;
  while ((m = re.exec(block))) if (!m[1].includes('tildacopy') && !out.includes(m[1])) out.push(m[1]);
  return out;
}

function guessKind(text) {
  const t = text.toLowerCase();
  if (/кошк|котён|котен|\bкот\b|кота\b|котик|лоток|мурч|стерилизован/.test(t)) return 'cat';
  if (/поводк|кобел|собак|щенк|щенок|метис|кинолог|ошейник|лает|лают/.test(t)) return 'dog';
  return null;
}

function guessSex(text) {
  const t = text.toLowerCase();
  if (/девочк|девчушк|стерилизована|кастрирована|ласковая|осторожна\b|она\b|её\b/.test(t)) return 'f';
  if (/мальчик|парень|кастрирован\b|ласковый|он\b|его\b/.test(t)) return 'm';
  return null;
}

function traitsOf(text) {
  const t = text.toLowerCase();
  const traits = [];
  if (/(?<!не )(кастрирован|стерилизован)/.test(t)) traits.push('стерилизация');
  if (/вакцинирован/.test(t)) traits.push('вакцинация');
  if (/чипирован/.test(t)) traits.push('чип');
  if (/лоток|лотку/.test(t)) traits.push('лоток');
  if (/на поводке ходит(?! плохо)|с поводком знаком/.test(t)) traits.push('поводок');
  if (/ладит с (другими )?кот|с котами хорошо/.test(t)) traits.push('дружит с кошками');
  if (/с сородичами ладит|ладит с сородичами/.test(t)) traits.push('дружит с собаками');
  return traits;
}

async function downloadImage(url, dest, width = 1400) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const img = sharp(buf).rotate();
  const meta = await img.metadata();
  await img
    .resize({ width: Math.min(width, meta.width || width), withoutEnlargement: true })
    .jpeg({ quality: 82, mozjpeg: true })
    .toFile(dest);
  return { width: meta.width, height: meta.height };
}

async function importAnimals() {
  const html = await fetchText(`${BASE}/dog`);
  const animals = [];
  for (const block of splitRecords(html)) {
    const imgs = imagesOf(block);
    const album = /href="(https?:\/\/vk\.com\/album[^"]*)"/.exec(block)?.[1] || null;
    if (!album || imgs.length === 0) continue;
    const lines = htmlToText(block).split('\n').map((l) => l.trim()).filter(Boolean).filter((l) => l !== 'Альбом в ВК');
    const name = lines.shift();
    const description = lines.filter((l) => !/^возраст/i.test(l)).join('\n');
    const ageLine = lines.find((l) => /^возраст/i.test(l)) || '';
    const text = [name, ...lines].join('\n');
    const ov = OVERRIDES[name] || {};
    const slug = slugify(name);
    const photos = [];
    await fs.mkdir(MEDIA_DIR, { recursive: true });
    for (let i = 0; i < imgs.length; i++) {
      const file = `${slug}-${i + 1}.jpg`;
      const dest = path.join(MEDIA_DIR, file);
      try {
        const meta = await downloadImage(imgs[i], dest);
        const thumbFile = file.replace(/\.jpg$/, '-thumb.jpg');
        await sharp(dest).resize({ width: 640, withoutEnlargement: true }).jpeg({ quality: 78, mozjpeg: true }).toFile(path.join(MEDIA_DIR, thumbFile));
        photos.push({ src: `/media/seed/${file}`, thumb: `/media/seed/${thumbFile}`, w: Math.min(1400, meta.width || 1400), h: null });
      } catch (e) {
        console.warn('  ! фото не скачалось', imgs[i], e.message);
      }
    }
    animals.push({
      id: `seed-${slug}`,
      slug,
      name,
      kind: ov.kind || guessKind(text) || 'dog',
      sex: ov.sex || guessSex(text),
      count: ov.count || 1,
      birthYear: parseBirthYear(ageLine || text),
      ageText: ageLine.replace(/^возраст:\s*/i, '').trim() || null,
      description,
      traits: traitsOf(text),
      photos,
      vkAlbum: album,
      status: 'looking',
      source: 'tilda',
    });
    console.log(`  ✓ ${name} (${ov.kind || guessKind(text) || '?'}) — ${photos.length} фото`);
  }
  return animals;
}

async function importPage(pathname, title) {
  const html = await fetchText(`${BASE}/${pathname}`);
  const blocks = [];
  for (const block of splitRecords(html)) {
    const text = htmlToText(block);
    if (!text || /t-menuburger|This site was made on|Хотите взять питомца в семью/.test(text)) continue;
    if (/^(Главная\nО приюте|Ищут дом\nГлавная)/.test(text)) continue;
    blocks.push(text);
  }
  return { title, text: blocks.join('\n\n').trim() };
}

async function importQr() {
  const html = await fetchText(`${BASE}/help`);
  const imgs = imagesOf(html).filter((u) => !u.includes('/-/empty/'));
  if (!imgs.length) return null;
  const dest = path.join(ROOT, 'public/media/sbp-qr.jpg');
  await downloadImage(imgs[0], dest, 900);
  console.log('  ✓ QR-код реквизитов сохранён в public/media/sbp-qr.jpg');
  return '/media/sbp-qr.jpg';
}

async function main() {
  await fs.mkdir(SEED_DIR, { recursive: true });
  console.log('Животные…');
  const animals = await importAnimals();
  await fs.writeFile(path.join(SEED_DIR, 'animals.json'), JSON.stringify(animals, null, 2));

  console.log('Страницы…');
  const pages = {
    needs: await importPage('need', 'Нужды приюта'),
    collect: await importPage('collect', 'Пункты сбора'),
    guardianship: await importPage('guardianship', 'Опекунство'),
    place: await importPage('place', 'Как добраться'),
    about: await importPage('about', 'О приюте'),
    importedAt: new Date().toISOString(),
    source: BASE,
  };
  await fs.writeFile(path.join(SEED_DIR, 'pages.json'), JSON.stringify(pages, null, 2));

  console.log('QR…');
  await importQr();
  console.log(`Готово: ${animals.length} животных.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
