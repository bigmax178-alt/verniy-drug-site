// Общие текстовые утилиты для скриптов синхронизации и импорта.

const TRANSLIT = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y',
  к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f',
  х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
};

export function slugify(str) {
  return String(str)
    .toLowerCase()
    .split('')
    .map((ch) => (TRANSLIT[ch] !== undefined ? TRANSLIT[ch] : ch))
    .join('')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'item';
}

export function decodeEntities(s) {
  return String(s)
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
}

export function htmlToText(html) {
  let t = String(html);
  t = t.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '');
  t = t.replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|li|h\d|tr)>/gi, '\n');
  t = t.replace(/<[^>]+>/g, '');
  t = decodeEntities(t);
  t = t.replace(/[ \t ]+/g, ' ');
  t = t.replace(/\n\s*\n+/g, '\n');
  return t.trim();
}

/** Достаёт хэштеги (#слово) из текста, в нижнем регистре, без «ё» → «е» нормализации. */
export function extractHashtags(text) {
  const tags = new Set();
  const re = /#([\p{L}\p{N}_]+)/gu;
  let m;
  while ((m = re.exec(text || ''))) tags.add(m[1].toLowerCase().replace(/ё/g, 'е'));
  return [...tags];
}

/** Первая осмысленная строка поста как заголовок. */
export function firstLine(text, max = 90) {
  const line = (text || '')
    .split('\n')
    .map((l) => l.replace(/#[\p{L}\p{N}_]+/gu, '').replace(/[☀-➿️\u{1F300}-\u{1FAFF}]/gu, '').trim())
    .find((l) => l.length > 3) || '';
  if (line.length <= max) return line;
  const cut = line.slice(0, max);
  return cut.slice(0, cut.lastIndexOf(' ') > 40 ? cut.lastIndexOf(' ') : max) + '…';
}

/** Год рождения из «Возраст: 2020 г. р.» / «май 2018 г.р.». */
export function parseBirthYear(text) {
  const m = /(?:возраст|г\.?\s*р\.?|род)[^\d]{0,20}((?:19|20)\d\d)/i.exec(text) || /((?:19|20)\d\d)\s*г\.?\s*р/i.exec(text);
  return m ? Number(m[1]) : null;
}

export function formatRub(n) {
  return new Intl.NumberFormat('ru-RU').format(Math.round(n)) + ' ₽';
}
