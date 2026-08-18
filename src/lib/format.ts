// Форматирование дат, денег и текста постов ВКонтакте для вывода в HTML.
import config from '../../site.config.mjs';

const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

// Названия дней недели (именительный) → короткое общепринятое сокращение и форма винительного падежа.
// Нужно для двух разных мест: ярлыки «пн/вт/…» и фразы вида «работает в пятницу, субботу».
const DAY_ABBR: Record<string, string> = {
  понедельник: 'пн',
  вторник: 'вт',
  среда: 'ср',
  четверг: 'чт',
  пятница: 'пт',
  суббота: 'сб',
  воскресенье: 'вс',
};
const DAY_ACCUSATIVE: Record<string, string> = {
  понедельник: 'понедельник',
  вторник: 'вторник',
  среда: 'среду',
  четверг: 'четверг',
  пятница: 'пятницу',
  суббота: 'субботу',
  воскресенье: 'воскресенье',
};

export function dayAbbr(day: string) {
  return DAY_ABBR[day] || day.slice(0, 2);
}

/** «понедельник, вторник, пятницу, субботу и воскресенье» — дни в винительном падеже с «и» перед последним. */
export function daysAccusativeList(days: string[]) {
  const forms = days.map((d) => DAY_ACCUSATIVE[d] || d);
  if (forms.length < 2) return forms.join('');
  return forms.slice(0, -1).join(', ') + ' и ' + forms[forms.length - 1];
}

export function formatDate(unix: number, { withYear = 'auto' }: { withYear?: boolean | 'auto' } = {}) {
  const d = new Date(unix * 1000);
  const now = new Date();
  const showYear = withYear === 'auto' ? d.getFullYear() !== now.getFullYear() : withYear;
  return `${d.getDate()} ${MONTHS[d.getMonth()]}${showYear ? ' ' + d.getFullYear() : ''}`;
}

export function isoDate(unix: number) {
  return new Date(unix * 1000).toISOString();
}

export function rub(n: number) {
  return new Intl.NumberFormat('ru-RU').format(Math.round(n)) + ' ₽';
}

export function escapeHtml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Текст поста VK → безопасный HTML: абзацы, ссылки, хэштеги, упоминания [id123|Имя],
 * телефоны. Ничего из исходного HTML не пропускаем.
 */
export function vkTextToHtml(text: string, { maxParagraphs }: { maxParagraphs?: number } = {}) {
  if (!text) return '';
  let paragraphs = text.replace(/\r/g, '').split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  if (maxParagraphs && paragraphs.length > maxParagraphs) paragraphs = paragraphs.slice(0, maxParagraphs);
  return paragraphs
    .map((p) => {
      let html = escapeHtml(p);
      // [id123|Имя] / [club123|Название]
      html = html.replace(/\[(id|club|public|event)(\d+)\|([^\]]+)\]/g, (_, kind, id, label) => `<a href="https://vk.com/${kind}${id}" rel="noopener">${label}</a>`);
      // ссылки
      html = html.replace(/(^|[\s(])((?:https?:\/\/|www\.)[^\s<)]+|(?:vk\.com|vk\.ru|murzikshop\.ru|t\.me)\/[^\s<)]+)/g, (_, pre, url) => {
        const href = /^https?:\/\//.test(url) ? url : 'https://' + url;
        const label = url.replace(/^https?:\/\//, '').replace(/\/$/, '');
        return `${pre}<a href="${href}" rel="noopener nofollow" target="_blank">${label.length > 48 ? label.slice(0, 45) + '…' : label}</a>`;
      });
      // хэштеги → ссылка на поиск в группе
      html = html.replace(/(^|\s)#([\p{L}\p{N}_@]+)/gu, (_, pre, tag) => `${pre}<a class="tag" href="https://vk.com/wall-${config.vk.groupId}?q=%23${encodeURIComponent(tag)}" rel="noopener" target="_blank">#${tag}</a>`);
      // телефоны
      html = html.replace(/(^|[\s(])((?:\+7|8)[\s(-]*\d{3}[\s)-]*\d{3}[\s-]*\d{2}[\s-]*\d{2})/g, (_, pre, phone) => `${pre}<a href="tel:${phone.replace(/[^\d+]/g, '').replace(/^8/, '+7')}">${phone}</a>`);
      return `<p>${html.replace(/\n/g, '<br>')}</p>`;
    })
    .join('');
}

export function excerpt(text: string, max = 180) {
  const clean = (text || '').replace(/\[(?:id|club|public|event)\d+\|([^\]]+)\]/g, '$1').replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  return cut.slice(0, Math.max(cut.lastIndexOf(' '), max - 30)) + '…';
}

export function telHref(phone: string) {
  return 'tel:' + phone.replace(/[^\d+]/g, '').replace(/^8/, '+7');
}

export function withBase(path: string) {
  const base = import.meta.env.BASE_URL || '/';
  if (/^https?:/.test(path)) return path;
  return (base.endsWith('/') ? base.slice(0, -1) : base) + (path.startsWith('/') ? path : '/' + path);
}
