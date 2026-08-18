#!/usr/bin/env node
// Синхронизация из ВКонтакте → src/data/vk/*.json
//
//   VK_TOKEN=... node scripts/sync-vk.mjs
//
// Без VK_TOKEN скрипт ничего не ломает: оставляет прошлые данные (или сайт живёт на seed-данных).
// Токен: сервисный ключ доступа standalone-приложения (vk.com/apps?act=manage) или
// пользовательский токен администратора группы (нужен, если обсуждения недоступны сервисному ключу).

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import config from '../site.config.mjs';
import { VkClient, pickPhoto } from './lib/vk.mjs';
import { extractHashtags, firstLine, slugify, parseBirthYear } from './lib/text.mjs';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const OUT_DIR = path.join(ROOT, 'src/data/vk');
const GID = config.vk.groupId;
const OWNER = -GID;

const token = process.env.VK_TOKEN;
if (!token) {
  console.log('VK_TOKEN не задан — синхронизация пропущена, сайт соберётся из имеющихся данных.');
  console.log('Как получить токен: см. README.md → «Подключение ВКонтакте».');
  process.exit(0);
}

const vk = new VkClient(token);
const warnings = [];
const warn = (m) => {
  warnings.push(m);
  console.warn('  ! ' + m);
};

// ── helpers ────────────────────────────────────────────────────────────────

const norm = (s) => (s || '').toLowerCase().replace(/ё/g, 'е');
const H = Object.fromEntries(Object.entries(config.vk.hashtags).map(([k, v]) => [k, new Set(v.map(norm))]));

function classify(text, hashtags, { isPinned } = {}) {
  const cats = new Set();
  for (const [cat, set] of Object.entries(H)) if (hashtags.some((h) => set.has(h))) cats.add(cat);
  const t = norm(text);
  // Приют почти не пользуется хэштегами, поэтому есть аккуратные текстовые эвристики.
  if (/(объявля|открыва|поддержите|помогите|срочн)[^.\n]{0,60}сбор|сбор средств|сбор на |нужна помощь|срочно нужн/.test(t)) cats.add('fundraising');
  if (/фин(ансовый)?\s*отч[её]т|отч[её]т (о|по|за)|чек (о|прилаг)|прилагаем чек|спасибо каждому|благодарим всех|спасибо всем, кто/.test(t)) cats.add('report');
  if (/наш[её]л дом|нашла дом|нашли дом|уехал[аи]? домой|уехал[аи]? в (новую )?семью|забрали домой|обрел[аи]? (дом|семью)|в новой семье|в новом доме|пристроен[аы]?\b|выпускник/.test(t)) cats.add('adopted');
  if (/ищет дом|ищут дом|ищет семью|ищет хозя|в добрые руки|отда[её]тся в|отдадим в/.test(t)) cats.add('lookingHome');
  if (/нужды приюта|очень нужен|очень нужны|нам нужн[ыа]|закончил(ся|ись|ась)/.test(t)) cats.add('needs');
  if (/нужны волонт[её]р|ищем волонт[её]р|нужны руки|нужна машина|автоволонт[её]р/.test(t)) cats.add('volunteers');
  if (isPinned) cats.add('pinned');
  return [...cats];
}

function parseMoney(str) {
  if (!str) return null;
  let s = str.replace(/\s| /g, '').replace(',', '.');
  let mult = 1;
  if (/тыс|т\.?р|к$/i.test(str)) mult = 1000;
  const n = parseFloat(s.replace(/[^\d.]/g, ''));
  return Number.isFinite(n) ? Math.round(n * mult) : null;
}

function parseFundraising(text) {
  const goal = /(цель|нужно собрать|необходимо собрать|сумма сбора|надо собрать|требуется)[^\d]{0,25}([\d][\d\s.,]{1,12}\s*(?:тыс\.?|т\.?р\.?|₽|руб|р\.)?)/i.exec(text);
  const raised = /(собрано|собрали|уже есть|на данный момент)[^\d]{0,25}([\d][\d\s.,]{1,12}\s*(?:тыс\.?|т\.?р\.?|₽|руб|р\.)?)/i.exec(text);
  const g = goal ? parseMoney(goal[2]) : null;
  const r = raised ? parseMoney(raised[2]) : null;
  if (!g && !r) return null;
  return { goal: g, raised: r, percent: g && r ? Math.min(100, Math.round((r / g) * 100)) : null };
}

function attachmentsOf(atts = []) {
  const photos = [];
  const videos = [];
  const links = [];
  const docs = [];
  const albums = [];
  for (const a of atts) {
    if (a.type === 'photo') {
      const p = pickPhoto(a.photo);
      if (p) photos.push({ ...p, id: a.photo.id, text: a.photo.text || '' });
    } else if (a.type === 'video') {
      const v = a.video;
      const img = (v.image || []).sort((x, y) => x.width - y.width).filter((x) => x.width <= 800).pop() || (v.image || [])[0];
      videos.push({ id: v.id, title: v.title, duration: v.duration, thumb: img?.url || null, url: `https://vk.com/video${v.owner_id}_${v.id}` });
    } else if (a.type === 'link') {
      const l = a.link;
      const img = l.photo ? pickPhoto(l.photo, 800) : null;
      links.push({ url: l.url, title: l.title || l.caption || l.url, description: l.description || '', image: img?.src || null });
    } else if (a.type === 'doc') {
      docs.push({ title: a.doc.title, url: a.doc.url, ext: a.doc.ext, size: a.doc.size });
    } else if (a.type === 'album') {
      const cover = a.album.thumb ? pickPhoto(a.album.thumb, 800) : null;
      albums.push({ id: a.album.id, title: a.album.title, size: a.album.size, cover: cover?.src || null, url: `https://vk.com/album${a.album.owner_id}_${a.album.id}` });
    }
  }
  return { photos, videos, links, docs, albums };
}

function normalizePost(p) {
  const text = (p.text || '').trim();
  const repost = p.copy_history?.[0];
  const repostText = repost ? (repost.text || '').trim() : '';
  const fullText = text || repostText;
  const hashtags = extractHashtags(text + ' ' + repostText);
  const own = attachmentsOf(p.attachments);
  const rep = repost ? attachmentsOf(repost.attachments) : null;
  const photos = own.photos.length ? own.photos : rep?.photos || [];
  const categories = classify(fullText, hashtags, { isPinned: !!p.is_pinned });
  const post = {
    id: p.id,
    url: `https://vk.com/wall${OWNER}_${p.id}`,
    date: p.date,
    isPinned: !!p.is_pinned,
    title: firstLine(fullText),
    text,
    hashtags,
    categories,
    photos,
    videos: own.videos.length ? own.videos : rep?.videos || [],
    links: own.links.length ? own.links : rep?.links || [],
    docs: own.docs.length ? own.docs : rep?.docs || [],
    albums: own.albums,
    repost: repost
      ? { from: repost.owner_id, text: repostText, url: `https://vk.com/wall${repost.owner_id}_${repost.id}`, date: repost.date }
      : null,
    likes: p.likes?.count ?? 0,
    reposts: p.reposts?.count ?? 0,
    views: p.views?.count ?? 0,
    comments: p.comments?.count ?? 0,
  };
  if (categories.includes('fundraising')) post.fundraising = parseFundraising(fullText);
  return post;
}

// ── fetchers ───────────────────────────────────────────────────────────────

async function fetchGroup() {
  const res = await vk.call('groups.getById', {
    group_id: GID,
    fields: 'description,contacts,addresses,members_count,cover,site,status,links,activity,counters,photo_100,photo_200,wall,market,city,place,main_section',
  });
  const g = Array.isArray(res) ? res[0] : res.groups?.[0] || res;
  const cover = (g.cover?.images || []).sort((a, b) => a.width - b.width).pop();
  return {
    id: g.id,
    name: g.name,
    screenName: g.screen_name,
    description: g.description || '',
    status: g.status || '',
    membersCount: g.members_count ?? null,
    site: g.site || '',
    photo: g.photo_200 || g.photo_100 || null,
    cover: cover?.url || null,
    contacts: (g.contacts || []).map((c) => ({ userId: c.user_id, desc: c.desc, phone: c.phone, email: c.email })),
    links: (g.links || []).map((l) => ({ url: l.url, name: l.name, desc: l.desc })),
    counters: g.counters || {},
    activity: g.activity || '',
  };
}

async function fetchPosts() {
  const { items } = await vk.paged('wall.get', { owner_id: OWNER, filter: 'owner', extended: 0 }, { max: config.vk.maxPosts, pageSize: 100 });
  const posts = items.filter((p) => !p.marked_as_ads).map(normalizePost);
  return posts.sort((a, b) => b.date - a.date);
}

async function fetchTopics() {
  const res = await vk.call('board.getTopics', { group_id: GID, count: 100, order: 1, preview: 1, preview_length: 0 });
  const topics = res.items || [];
  const wanted = new Set(Object.values(config.vk.topics).flat());
  const out = [];
  for (const t of topics) {
    const rec = {
      id: t.id,
      title: t.title,
      url: `https://vk.com/topic${OWNER}_${t.id}`,
      created: t.created,
      updated: t.updated,
      commentsCount: t.comments,
      isClosed: !!t.is_closed,
      isFixed: !!t.is_fixed,
      firstComment: t.first_comment ? { text: t.first_comment } : null,
      comments: [],
    };
    if (wanted.has(t.id)) {
      // Тяжёлые темы (пожертвования, нужды, вопросы) — берём только начало; остальные — до 300 сообщений.
      const light = [config.vk.topics.donations, config.vk.topics.needs, config.vk.topics.faq].includes(t.id);
      const max = light ? 5 : 300;
      try {
        const { items } = await vk.paged('board.getComments', { group_id: GID, topic_id: t.id, extended: 0, sort: 'asc' }, { max, pageSize: 100 });
        rec.comments = items.map((c) => {
          const at = attachmentsOf(c.attachments);
          return {
            id: c.id,
            fromId: c.from_id,
            isAdmin: c.from_id === OWNER || c.from_id < 0,
            date: c.date,
            text: (c.text || '').trim(),
            photos: at.photos,
            docs: at.docs,
            links: at.links,
          };
        });
        if (rec.comments[0]) rec.firstComment = { text: rec.comments[0].text, photos: rec.comments[0].photos, docs: rec.comments[0].docs, date: rec.comments[0].date };
      } catch (e) {
        warn(`комментарии темы «${t.title}»: ${e.message}`);
      }
    }
    out.push(rec);
  }
  return out;
}

function animalFromItem(item, albumTitle) {
  const rawTitle = (item.title || '').trim();
  const name = rawTitle.replace(/\s*(ищет|ищут|ищем|ждёт|ждет|ждут)\s+(дом|семью|хозя\S*|друга)\s*!?/i, '').replace(/[!.]+$/, '').trim() || rawTitle;
  const desc = (item.description || '').trim();
  const t = norm(albumTitle + ' ' + rawTitle + ' ' + desc);
  let kind = null;
  if (/кот|кошк|котен|котён/.test(norm(albumTitle))) kind = 'cat';
  else if (/собак|пес|пёс|щен/.test(norm(albumTitle))) kind = 'dog';
  if (!kind) kind = /кошк|котен|котён|\bкот\b|мурч|лоток/.test(t) ? 'cat' : 'dog';
  let sex = null;
  if (/девочк|девчушк|стерилизована|кастрирована|ласковая|она\b|её\b|красавица|умница/.test(t)) sex = 'f';
  else if (/мальчик|парень|кастрирован\b|ласковый|он\b|его\b|красавец|умница/.test(t)) sex = 'm';
  const count = /\bи\b/.test(name) && /ищут|девочки|мальчики|братья|сёстры|сестры/.test(t) ? 2 : 1;
  const photos = (item.photos || []).map((p) => pickPhoto(p)).filter(Boolean);
  if (!photos.length && item.thumb_photo) photos.push({ src: item.thumb_photo, thumb: item.thumb_photo, w: null, h: null });
  const traits = [];
  if (/(?<!не )(кастрирован|стерилизован)/.test(t)) traits.push('стерилизация');
  if (/вакцинирован|привит/.test(t)) traits.push('вакцинация');
  if (/чипирован/.test(t)) traits.push('чип');
  if (/лоток|лотку/.test(t)) traits.push('лоток');
  if (/на поводке ходит(?! плохо)|с поводком знаком|гуляет на поводке/.test(t)) traits.push('поводок');
  if (/ладит с (другими )?кот|с котами хорошо|с кошками ладит|дружит с кошк/.test(t)) traits.push('дружит с кошками');
  if (/с сородичами ладит|ладит с сородичами|с собаками ладит|дружит с собак/.test(t)) traits.push('дружит с собаками');
  if (/с детьми/.test(t) && !/не (ладит|дружит) с детьми/.test(t)) traits.push('ладит с детьми');
  return {
    id: `vk-${item.id}`,
    vkItemId: item.id,
    slug: slugify(name) + '-' + item.id,
    name,
    kind,
    sex,
    count,
    birthYear: parseBirthYear(desc),
    ageText: (/возраст[:\s]*([^\n]+)/i.exec(desc)?.[1] || '').trim() || null,
    description: desc,
    traits,
    photos,
    url: `https://vk.com/market${OWNER}?w=product${OWNER}_${item.id}`,
    // availability: 0 — доступен, 1 — удалён, 2 — недоступен
    status: item.availability === 0 ? 'looking' : 'adopted',
    album: albumTitle,
    date: item.date || null,
    source: 'vk-market',
  };
}

async function fetchMarket() {
  let albums = [];
  try {
    const res = await vk.call('market.getAlbums', { owner_id: OWNER, count: 100 });
    albums = res.items || [];
  } catch (e) {
    warn(`market.getAlbums: ${e.message}`);
  }
  const animalAlbumIds = new Map();
  for (const a of albums) if (config.vk.marketAnimalAlbums.some((re) => re.test(a.title))) animalAlbumIds.set(a.id, a.title);

  const animals = [];
  const donationProducts = [];
  const seen = new Set();
  const handle = (item, albumTitle) => {
    if (seen.has(item.id)) return;
    seen.add(item.id);
    if (config.vk.marketDonationTitles.some((re) => re.test(item.title))) {
      donationProducts.push({
        id: item.id,
        title: item.title,
        description: item.description || '',
        price: item.price?.text || null,
        photo: item.thumb_photo || null,
        url: `https://vk.com/market${OWNER}?w=product${OWNER}_${item.id}`,
      });
      return;
    }
    animals.push(animalFromItem(item, albumTitle));
  };
  for (const [albumId, title] of animalAlbumIds) {
    try {
      const { items } = await vk.paged('market.get', { owner_id: OWNER, album_id: albumId, extended: 1 }, { max: 500, pageSize: 200 });
      items.forEach((it) => handle(it, title));
    } catch (e) {
      warn(`market.get album ${albumId}: ${e.message}`);
    }
  }
  try {
    const { items } = await vk.paged('market.get', { owner_id: OWNER, extended: 1 }, { max: 500, pageSize: 200 });
    items.forEach((it) => handle(it, ''));
  } catch (e) {
    warn(`market.get: ${e.message}`);
  }
  return {
    albums: albums.map((a) => ({ id: a.id, title: a.title, count: a.count, isAnimals: animalAlbumIds.has(a.id) })),
    animals,
    donationProducts,
  };
}

async function fetchAlbums() {
  const res = await vk.call('photos.getAlbums', { owner_id: OWNER, need_covers: 1, need_system: 0 });
  const albums = (res.items || []).map((a) => ({
    id: a.id,
    title: a.title,
    description: a.description || '',
    size: a.size,
    cover: a.thumb_src || null,
    updated: a.updated,
    url: `https://vk.com/album${OWNER}_${a.id}`,
  }));
  return albums.sort((a, b) => (b.updated || 0) - (a.updated || 0));
}

// ── main ───────────────────────────────────────────────────────────────────

async function writeJson(name, data) {
  await fs.mkdir(OUT_DIR, { recursive: true });
  await fs.writeFile(path.join(OUT_DIR, name), JSON.stringify(data, null, 1));
}

async function main() {
  console.log(`Синхронизация группы -${GID}…`);
  const started = Date.now();

  const group = await fetchGroup();
  console.log(`  группа: ${group.name}, подписчиков: ${group.membersCount}`);
  await writeJson('group.json', group);

  const posts = await fetchPosts();
  console.log(`  постов: ${posts.length}`);
  await writeJson('posts.json', posts);

  let topics = [];
  try {
    topics = await fetchTopics();
    console.log(`  обсуждений: ${topics.length}`);
    await writeJson('topics.json', topics);
  } catch (e) {
    warn(`board.getTopics: ${e.message} — обсуждения не обновлены (нужен пользовательский токен админа?)`);
  }

  const market = await fetchMarket();
  console.log(`  животных в товарах: ${market.animals.length}, донат-товаров: ${market.donationProducts.length}`);
  await writeJson('market.json', market);

  try {
    const albums = await fetchAlbums();
    console.log(`  фотоальбомов: ${albums.length}`);
    await writeJson('albums.json', albums);
  } catch (e) {
    warn(`photos.getAlbums: ${e.message}`);
  }

  await writeJson('meta.json', {
    syncedAt: new Date().toISOString(),
    apiCalls: vk.calls,
    durationMs: Date.now() - started,
    warnings,
  });
  console.log(`Готово за ${Math.round((Date.now() - started) / 1000)} с, запросов к API: ${vk.calls}${warnings.length ? `, предупреждений: ${warnings.length}` : ''}.`);
}

main().catch((e) => {
  console.error('Синхронизация не удалась:', e.message);
  process.exit(1);
});
