import type { APIRoute } from 'astro';
import config from '../../site.config.mjs';
import { animals, newsPosts } from '../lib/data';

export const GET: APIRoute = ({ site }) => {
  const base = (site?.toString() || config.siteUrl).replace(/\/$/, '');
  const now = new Date().toISOString();
  const urls: { loc: string; lastmod?: string; priority: string }[] = [
    { loc: '/', priority: '1.0' },
    { loc: '/help/', priority: '1.0' },
    { loc: '/animals/', priority: '0.9' },
    { loc: '/adopted/', priority: '0.6' },
    { loc: '/news/', priority: '0.7' },
    { loc: '/reports/', priority: '0.6' },
    { loc: '/about/', priority: '0.7' },
    ...animals.filter((a) => a.status === 'looking').map((a) => ({ loc: `/animals/${a.slug}/`, priority: '0.8' })),
    ...newsPosts.slice(0, 200).map((p) => ({ loc: `/news/${p.id}/`, lastmod: new Date(p.date * 1000).toISOString(), priority: '0.5' })),
  ];
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `<url><loc>${base}${u.loc}</loc><lastmod>${u.lastmod || now}</lastmod><priority>${u.priority}</priority></url>`).join('\n')}
</urlset>`;
  return new Response(xml, { headers: { 'Content-Type': 'application/xml; charset=utf-8' } });
};
