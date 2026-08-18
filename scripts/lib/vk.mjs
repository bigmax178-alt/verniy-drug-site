// Минимальный клиент VK API с ограничением частоты (≤3 запроса/с) и повторами.

const API = 'https://api.vk.com/method/';
const VERSION = process.env.VK_API_VERSION || '5.199';

export class VkClient {
  constructor(token, { lang = 'ru', minIntervalMs = 400, log = console } = {}) {
    if (!token) throw new Error('Нужен VK_TOKEN');
    this.token = token;
    this.lang = lang;
    this.minIntervalMs = minIntervalMs;
    this.lastCall = 0;
    this.log = log;
    this.calls = 0;
  }

  async call(method, params = {}, attempt = 0) {
    const wait = this.lastCall + this.minIntervalMs - Date.now();
    if (wait > 0) await sleep(wait);
    this.lastCall = Date.now();
    this.calls++;

    const body = new URLSearchParams({ v: VERSION, lang: this.lang, access_token: this.token });
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null) body.set(k, String(v));

    let json;
    try {
      const res = await fetch(API + method, { method: 'POST', body, headers: { 'content-type': 'application/x-www-form-urlencoded' } });
      json = await res.json();
    } catch (e) {
      if (attempt < 3) {
        await sleep(1000 * (attempt + 1));
        return this.call(method, params, attempt + 1);
      }
      throw e;
    }
    if (json.error) {
      const { error_code: code, error_msg: msg } = json.error;
      // 6 — слишком много запросов, 10 — внутренняя ошибка, 9 — flood
      if ([6, 9, 10].includes(code) && attempt < 5) {
        await sleep(1500 * (attempt + 1));
        return this.call(method, params, attempt + 1);
      }
      const err = new Error(`VK ${method}: [${code}] ${msg}`);
      err.code = code;
      throw err;
    }
    return json.response;
  }

  /** Постранично собирает items для методов с count/offset. */
  async paged(method, params, { max = 1000, pageSize = 100, itemsKey = 'items' } = {}) {
    const items = [];
    let offset = 0;
    let extra = null;
    while (items.length < max) {
      const count = Math.min(pageSize, max - items.length);
      const res = await this.call(method, { ...params, count, offset });
      if (!extra) extra = res;
      const chunk = res?.[itemsKey] || [];
      items.push(...chunk);
      if (chunk.length < count || items.length >= (res?.count ?? Infinity)) break;
      offset += chunk.length;
    }
    return { items, extra };
  }
}

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Лучший размер фото из VK-объекта: {src, w, h} — не больше maxWidth. */
export function pickPhoto(photo, maxWidth = 1280) {
  const list = [...(photo?.sizes || []), photo?.orig_photo].filter((s) => s?.url && s.width);
  if (!list.length) return null;
  const sorted = [...list].sort((a, b) => a.width - b.width);
  const fit = sorted.filter((s) => s.width <= maxWidth);
  const best = fit.length ? fit[fit.length - 1] : sorted[0];
  const thumb = sorted.find((s) => s.width >= 300) || sorted[sorted.length - 1];
  return { src: best.url, w: best.width, h: best.height, thumb: thumb.url };
}
