import { defineConfig } from 'astro/config';
import config from './site.config.mjs';

// BASE_PATH нужен только для GitHub Pages без своего домена (https://user.github.io/repo/).
const base = process.env.BASE_PATH || '/';

export default defineConfig({
  site: config.siteUrl,
  base,
  output: 'static',
  trailingSlash: 'always',
  build: { format: 'directory', inlineStylesheets: 'auto' },
  compressHTML: true,
  image: {
    // Картинки животных и постов приходят с CDN ВКонтакте — не оптимизируем их на сборке,
    // просто отдаём с ленивой загрузкой и размерами.
    remotePatterns: [],
  },
  devToolbar: { enabled: false },
});
