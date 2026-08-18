import type { APIRoute } from 'astro';
import config from '../../site.config.mjs';
import { newsPosts } from '../lib/data';
import { escapeHtml, excerpt } from '../lib/format';

export const GET: APIRoute = ({ site }) => {
  const base = (site?.toString() || config.siteUrl).replace(/\/$/, '');
  const items = newsPosts.slice(0, 40).map((p) => {
    const link = `${base}/news/${p.id}/`;
    const title = escapeHtml(p.title || `Запись от ${new Date(p.date * 1000).toLocaleDateString('ru-RU')}`);
    const desc = escapeHtml(excerpt(p.text || p.repost?.text || '', 400));
    const img = p.photos[0]?.src ? `<enclosure url="${escapeHtml(p.photos[0].src)}" type="image/jpeg" length="0"/>` : '';
    return `<item><title>${title}</title><link>${link}</link><guid isPermaLink="true">${link}</guid><pubDate>${new Date(p.date * 1000).toUTCString()}</pubDate><description>${desc}</description>${img}</item>`;
  });
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
<title>Приют «${config.name}» — новости</title>
<link>${base}/news/</link>
<description>${escapeHtml(config.tagline)}</description>
<language>ru</language>
${items.join('\n')}
</channel></rss>`;
  return new Response(xml, { headers: { 'Content-Type': 'application/rss+xml; charset=utf-8' } });
};
