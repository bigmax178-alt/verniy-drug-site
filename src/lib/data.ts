// Единая точка доступа к данным. Приоритет: свежие данные из VK (src/data/vk/*.json),
// затем стартовые данные (data/seed/*.json), чтобы сайт всегда собирался.
import config from '../../site.config.mjs';

export type Photo = { src: string; thumb?: string; w?: number | null; h?: number | null; text?: string };

export type Animal = {
  id: string;
  slug: string;
  name: string;
  kind: 'dog' | 'cat';
  sex: 'm' | 'f' | null;
  count: number;
  birthYear: number | null;
  ageText: string | null;
  description: string;
  traits: string[];
  photos: (string | Photo)[];
  vkAlbum?: string;
  url?: string;
  status: 'looking' | 'adopted';
  source: string;
  date?: number | null;
};

export type Post = {
  id: number | string;
  url: string;
  date: number;
  isPinned: boolean;
  title: string;
  text: string;
  hashtags: string[];
  categories: string[];
  photos: Photo[];
  videos: { id?: number; title: string; duration?: number; thumb: string | null; url: string }[];
  links: { url: string; title: string; description?: string; image?: string | null }[];
  docs: { title: string; url: string; ext?: string; size?: number }[];
  albums?: { id: number; title: string; size: number; cover: string | null; url: string }[];
  repost?: { from: number; text: string; url: string; date: number } | null;
  fundraising?: { goal: number | null; raised: number | null; percent: number | null } | null;
  likes?: number;
  reposts?: number;
  views?: number;
  comments?: number;
  source?: string;
};

export type TopicComment = { id: number; fromId: number; isAdmin: boolean; date: number; text: string; photos: Photo[]; docs: Post['docs']; links: Post['links'] };
export type Topic = {
  id: number;
  title: string;
  url: string;
  created: number;
  updated: number;
  commentsCount: number;
  isClosed: boolean;
  isFixed?: boolean;
  firstComment: { text: string; photos?: Photo[]; docs?: Post['docs']; date?: number } | null;
  comments: TopicComment[];
};

type MarketData = { albums: any[]; animals: Animal[]; donationProducts: { id: number; title: string; description: string; price: string | null; photo: string | null; url: string }[] };
type GroupData = { name: string; description: string; membersCount: number | null; photo: string | null; cover: string | null; contacts: any[]; counters: Record<string, number> };
type SeedPages = Record<string, { title: string; text: string }> & { importedAt?: string };

const vkFiles = import.meta.glob('../data/vk/*.json', { eager: true, import: 'default' }) as Record<string, any>;
const seedFiles = import.meta.glob('../../data/seed/*.json', { eager: true, import: 'default' }) as Record<string, any>;

function vk<T>(name: string): T | null {
  const key = Object.keys(vkFiles).find((k) => k.endsWith(`/${name}.json`));
  return key ? (vkFiles[key] as T) : null;
}
function seed<T>(name: string): T | null {
  const key = Object.keys(seedFiles).find((k) => k.endsWith(`/${name}.json`));
  return key ? (seedFiles[key] as T) : null;
}

export const group = vk<GroupData>('group');
export const meta = vk<{ syncedAt: string; warnings: string[] }>('meta');
export const market = vk<MarketData>('market');
export const topics: Topic[] = vk<Topic[]>('topics') || [];
export const albums = vk<any[]>('albums') || [];
export const seedPages = seed<SeedPages>('pages');

const vkPosts = vk<Post[]>('posts');
const seedPosts = seed<Post[]>('posts') || [];
export const posts: Post[] = (vkPosts && vkPosts.length ? vkPosts : seedPosts).slice().sort((a, b) => b.date - a.date);
export const postsSource = vkPosts && vkPosts.length ? 'vk' : 'seed';

// ── Животные ────────────────────────────────────────────────────────────────
const seedAnimals = seed<Animal[]>('animals') || [];
const vkAnimals = market?.animals || [];
export const animalsSource = vkAnimals.length ? 'vk' : 'seed';
export const animals: Animal[] = (vkAnimals.length ? vkAnimals : seedAnimals).map((a) => ({
  ...a,
  photos: a.photos.map((p) => (typeof p === 'string' ? { src: p, thumb: p } : p)),
}));
export const lookingAnimals = animals.filter((a) => a.status === 'looking');
export const dogs = lookingAnimals.filter((a) => a.kind === 'dog');
export const cats = lookingAnimals.filter((a) => a.kind === 'cat');

export function animalBySlug(slug: string) {
  return animals.find((a) => a.slug === slug);
}
export function animalPhoto(a: Animal): Photo | null {
  const p = a.photos[0];
  return p ? (typeof p === 'string' ? { src: p, thumb: p } : p) : null;
}
export function ageOf(a: Animal, now = new Date().getFullYear()): string | null {
  if (a.birthYear) {
    const years = now - a.birthYear;
    if (years <= 0) return 'до года';
    return `${years} ${plural(years, 'год', 'года', 'лет')}`;
  }
  return a.ageText;
}

// ── Посты по разделам ───────────────────────────────────────────────────────
export const pinnedPost = posts.find((p) => p.isPinned) || null;
export const newsPosts = posts.filter((p) => !p.isPinned);
export const fundraisingPosts = posts.filter((p) => p.categories.includes('fundraising') && !p.isPinned);
export const reportPosts = posts.filter((p) => p.categories.includes('report'));
export const adoptedPosts = posts.filter((p) => p.categories.includes('adopted'));
export const lookingHomePosts = posts.filter((p) => p.categories.includes('lookingHome'));
export const activeCampaigns = fundraisingPosts.filter((p) => Date.now() / 1000 - p.date < 60 * 86400).slice(0, 6);

// ── Обсуждения по ключам ────────────────────────────────────────────────────
type TopicKey = keyof typeof config.vk.topics;
export function topicById(id: number) {
  return topics.find((t) => t.id === id) || null;
}
export function topicByKey(key: TopicKey): Topic | null {
  const id = (config.vk.topics as any)[key];
  if (Array.isArray(id)) return null;
  return topicById(id);
}
export const reportTopics: Topic[] = (config.vk.topics.reports as number[]).map(topicById).filter(Boolean) as Topic[];

/** Текст раздела: из обсуждения VK, иначе из seed-страницы. Возвращает {text, source, url}. */
export function sectionText(key: TopicKey, seedKey?: string, { comments = 1 } = {}) {
  const t = topicByKey(key);
  if (t && (t.comments.length || t.firstComment?.text)) {
    const parts = t.comments.length ? t.comments.slice(0, comments).map((c) => c.text) : [t.firstComment!.text];
    return { text: parts.filter(Boolean).join('\n\n'), source: 'vk' as const, url: t.url, updated: t.updated, topic: t };
  }
  const s = seedKey && seedPages ? seedPages[seedKey] : null;
  return { text: s?.text || '', source: 'seed' as const, url: `https://vk.com/topic-${config.vk.groupId}_${(config.vk.topics as any)[key]}`, updated: null, topic: null };
}

// ── Цифры ───────────────────────────────────────────────────────────────────
function countFromDescription(desc: string, re: RegExp): number | null {
  const m = re.exec(desc || '');
  return m ? Number(m[1]) : null;
}
const desc = group?.description || '';
export const stats = {
  dogs: countFromDescription(desc, /(\d+)\s*собак/i) ?? 69,
  cats: countFromDescription(desc, /(\d+)\s*(?:кот|кош)/i) ?? 67,
  adopted: countFromDescription(desc, /более\s*(\d+)\s*хвост/i) ?? 500,
  members: group?.membersCount ?? 10900,
  since: config.since,
};

export function plural(n: number, one: string, few: string, many: string) {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few;
  return many;
}
