// Проверка и нормализация карточки животного. Одни и те же правила для формы
// админки и для API, чтобы в файл не попало ничего кривого.

import { slugify } from '../../scripts/lib/text.mjs';
import { token } from './http.mjs';

export const KINDS = ['dog', 'cat'];
export const SEXES = ['m', 'f'];
export const STATUSES = ['looking', 'adopted', 'hidden'];

export const TRAIT_OPTIONS = [
  'стерилизация',
  'вакцинация',
  'чип',
  'лоток',
  'поводок',
  'дружит с кошками',
  'дружит с собаками',
  'ладит с детьми',
  'нужен опыт',
  'пожилой',
];

const MAX = { name: 60, description: 4000, ageText: 40, patronName: 80, patronNote: 300 };

function str(v, max) {
  return String(v ?? '')
    .replace(/\r\n/g, '\n')
    .trim()
    .slice(0, max);
}

/**
 * Приводит данные формы к записи животного.
 * @param {object} input сырые поля формы
 * @param {object} existing прошлая версия (при редактировании)
 * @returns {{ok: true, animal: object} | {ok: false, errors: string[]}}
 */
export function normalizeAnimal(input, existing = null) {
  const errors = [];

  const name = str(input.name, MAX.name);
  if (!name) errors.push('Укажите кличку животного.');

  const kind = KINDS.includes(input.kind) ? input.kind : null;
  if (!kind) errors.push('Выберите, кто это — собака или кошка.');

  const sex = SEXES.includes(input.sex) ? input.sex : null;

  const status = STATUSES.includes(input.status) ? input.status : 'looking';

  let birthYear = null;
  if (String(input.birthYear || '').trim()) {
    const y = Number(input.birthYear);
    const now = new Date().getFullYear();
    if (!Number.isInteger(y) || y < 1990 || y > now) errors.push(`Год рождения должен быть числом от 1990 до ${now}.`);
    else birthYear = y;
  }

  let count = Number(input.count || 1);
  if (!Number.isInteger(count) || count < 1 || count > 10) count = 1;

  const traits = (Array.isArray(input.traits) ? input.traits : input.traits ? [input.traits] : [])
    .map((t) => str(t, 40))
    .filter(Boolean)
    .slice(0, 12);

  const photos = (Array.isArray(input.photos) ? input.photos : [])
    .map((p) => (typeof p === 'string' ? { src: p, thumb: p } : p))
    .filter((p) => p && typeof p.src === 'string' && p.src.startsWith('/media/'))
    .slice(0, 12);

  // Блок опекуна. Публикация имени и фото — только при явном согласии (ст. 10.1 152-ФЗ).
  let patron = null;
  const patronName = str(input.patronName, MAX.patronName);
  const patronPhoto = typeof input.patronPhoto === 'string' && input.patronPhoto.startsWith('/media/') ? input.patronPhoto : null;
  if (patronName || patronPhoto) {
    const publish = input.patronPublish === true || input.patronPublish === 'on' || input.patronPublish === '1';
    const consentRef = str(input.patronConsentRef, 120);
    if (publish && !consentRef) {
      errors.push(
        'Чтобы показать опекуна на сайте, нужно подтвердить согласие на распространение персональных данных: укажите, где оно получено (дата и способ) или снимите галочку публикации.',
      );
    }
    patron = {
      name: patronName || null,
      photo: patronPhoto,
      note: str(input.patronNote, MAX.patronNote) || null,
      publish,
      consentRef: consentRef || null,
      since: str(input.patronSince, 20) || existing?.patron?.since || new Date().toISOString().slice(0, 10),
    };
  }

  if (errors.length) return { ok: false, errors };

  const source = existing?.source || (input.source === 'override' ? 'override' : 'manual');
  const id = existing?.id || (source === 'override' ? str(input.id, 60) : `manual-${token(6)}`);
  const baseSlug = existing?.slug || slugify(name) || 'pitomets';

  return {
    ok: true,
    animal: {
      id,
      source,
      slug: baseSlug,
      name,
      kind,
      sex,
      count,
      birthYear,
      ageText: str(input.ageText, MAX.ageText) || null,
      description: str(input.description, MAX.description),
      traits,
      photos,
      patron,
      status,
      vkAlbum: str(input.vkAlbum, 200) || null,
      url: existing?.url || null,
    },
  };
}

/** Как карточка выглядит для публичного сайта: без служебных полей и без неопубликованного опекуна. */
export function toPublicAnimal(a) {
  const out = { ...a };
  if (a.patron) {
    out.patron = a.patron.publish
      ? { name: a.patron.name, photo: a.patron.photo, note: a.patron.note, since: a.patron.since }
      : // Факт наличия опекуна показать можно — это не персональные данные.
        { anonymous: true, since: a.patron.since };
  }
  return out;
}
