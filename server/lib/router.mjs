// Маршруты админки, вынесенные из сервера, чтобы один и тот же код работал
// в двух местах: на обычном сервере (файловое хранилище, папка data-runtime)
// и в бессерверной функции Vercel (хранилище в git, сессии в подписанной куке).
//
// Всё, что различается между средами, приходит параметрами: store, auth, features.

import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

import { normalizeAnimal, toPublicAnimal } from './animal.mjs';
import { readJson, readForm, readBody, parseCookies, setCookie, send, sendHtml, sendJson, redirect, token, createRateLimiter, clientIp, MAX_UPLOAD } from './http.mjs';
import { CONSENT_PROCESSING, CONSENT_DISSEMINATION, OPERATOR } from '../../shared/consent.mjs';
import * as views from '../views/pages.mjs';

/**
 * @param {object} deps
 * @param {object} deps.store   хранилище (файловое или git)
 * @param {object} deps.auth    работа с учётками и сессиями
 * @param {object} [deps.features] что доступно в этой среде:
 *        acceptsApplications — можно ли принимать заявки с персональными данными
 *        servesMedia — отдаёт ли сервер файлы фотографий сам
 */
export function createRouter({ store, auth, features = {} }) {
  const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || 'http://localhost:4321')
    .split(',')
    .map((s) => s.trim().replace(/\/$/, ''))
    .filter(Boolean);
  const COOKIE_SECURE = process.env.COOKIE_SECURE !== '0';
  const acceptsApplications = features.acceptsApplications !== false;
  // Можно ли вообще хранить персональные данные в этой среде (имя и фото опекуна).
  const personalData = features.personalData !== false;
  const servesMedia = features.servesMedia !== false;

  const loginLimiter = createRateLimiter({ windowMs: 15 * 60 * 1000, max: 10 });
  const formLimiter = createRateLimiter({ windowMs: 60 * 60 * 1000, max: 12 });

  // ── вспомогательное ─────────────────────────────────────────────────────────

  const MIME = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif' };

  async function requireSession(req, res) {
    const cookies = parseCookies(req);
    const session = await auth.getSession(cookies[auth.SESSION_COOKIE]);
    if (!session) {
      redirect(res, '/admin/login');
      return null;
    }
    return session;
  }

  function requireCsrf(session, provided, res) {
    if (!auth.csrfValid(session, provided)) {
      sendHtml(res, 403, views.errorPage('Форма устарела. Обновите страницу и попробуйте ещё раз.'));
      return false;
    }
    return true;
  }

  function corsHeaders(req) {
    const origin = (req.headers.origin || '').replace(/\/$/, '');
    if (!ALLOWED_ORIGINS.includes(origin)) return null;
    return {
      'access-control-allow-origin': origin,
      'access-control-allow-methods': 'POST, OPTIONS',
      'access-control-allow-headers': 'content-type',
      'access-control-max-age': '86400',
      vary: 'Origin',
    };
  }

  /** Уменьшает фотографию, если в окружении есть sharp; иначе сохраняет как есть. */
  async function processImage(buffer) {
    try {
      const { default: sharp } = await import('sharp');
      const img = sharp(buffer).rotate();
      const meta = await img.metadata();
      const full = await img.resize({ width: Math.min(1400, meta.width || 1400), withoutEnlargement: true }).jpeg({ quality: 82, mozjpeg: true }).toBuffer();
      const thumb = await sharp(buffer).rotate().resize({ width: 640, withoutEnlargement: true }).jpeg({ quality: 78, mozjpeg: true }).toBuffer();
      return { full, thumb, ext: 'jpg', width: meta.width || null, height: meta.height || null };
    } catch {
      return { full: buffer, thumb: null, ext: 'jpg', width: null, height: null };
    }
  }

  function detectImage(buffer) {
    if (buffer.length < 12) return null;
    if (buffer[0] === 0xff && buffer[1] === 0xd8) return 'jpg';
    if (buffer.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
    if (buffer.slice(0, 4).toString('ascii') === 'RIFF' && buffer.slice(8, 12).toString('ascii') === 'WEBP') return 'webp';
    return null;
  }

  const digest = (s) => createHash('sha256').update(s).digest('hex').slice(0, 16);

  /** Поля формы traits и photos приходят как JSON — в названиях признаков есть пробелы. */
  function parseJsonArray(value, fallback) {
    if (!value) return fallback;
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : fallback;
    } catch {
      return fallback;
    }
  }

  // ── маршруты ────────────────────────────────────────────────────────────────

  async function route(req, res, url) {
    const p = url.pathname.replace(/\/+$/, '') || '/';
    const method = req.method || 'GET';

    // --- служебное ---
    if (p === '/healthz') return sendJson(res, 200, { ok: true, time: new Date().toISOString() });

    // --- медиафайлы ---
    if (servesMedia && method === 'GET' && p.startsWith('/media/')) {
      const name = decodeURIComponent(p.slice('/media/'.length));
      try {
        const file = store.mediaPath(name);
        const data = await fs.readFile(file);
        return send(res, 200, data, {
          'content-type': MIME[path.extname(name).toLowerCase()] || 'application/octet-stream',
          'cache-control': 'public, max-age=31536000, immutable',
          'access-control-allow-origin': '*',
        });
      } catch {
        return send(res, 404, 'Файл не найден', { 'content-type': 'text/plain; charset=utf-8' });
      }
    }

    // --- публичное API для сайта ---

    // Данные для сборки сайта: только публичная часть, без персональных данных.
    if (method === 'GET' && p === '/api/public/animals.json') {
      const data = await store.getAnimals();
      return sendJson(
        res,
        200,
        { version: data.version, updatedAt: data.updatedAt, animals: data.animals.filter((a) => a.status !== 'hidden').map(toPublicAnimal) },
        { 'access-control-allow-origin': '*', 'cache-control': 'public, max-age=60' },
      );
    }

    // Приём заявки на опекунство с сайта.
    if (p === '/api/patronage') {
      const cors = corsHeaders(req);
      if (method === 'OPTIONS') {
        if (!cors) return send(res, 403, '');
        return send(res, 204, '', cors);
      }
      if (method !== 'POST') return sendJson(res, 405, { error: 'Метод не поддерживается' });
      if (!cors) return sendJson(res, 403, { error: 'Запрос с недопустимого домена' });
      // Приём персональных данных разрешён не везде: по ч. 5 ст. 18 152-ФЗ первичная
      // запись данных граждан РФ должна идти в базу на территории России.
      if (!acceptsApplications) {
        return sendJson(res, 503, { error: 'Приём заявок через сайт пока не подключён. Пожалуйста, позвоните нам или напишите в сообщения группы.' }, cors);
      }

      const ip = clientIp(req);
      const limit = formLimiter.check(ip);
      if (!limit.ok) {
        return sendJson(res, 429, { error: 'Слишком много заявок подряд. Попробуйте позже или позвоните нам.' }, cors);
      }

      let body;
      try {
        body = await readJson(req);
      } catch {
        return sendJson(res, 400, { error: 'Не удалось прочитать форму' }, cors);
      }

      // Ловушка для ботов: поле скрыто от людей, заполняется только автоматикой.
      if (body.website) return sendJson(res, 200, { ok: true }, cors);

      const name = String(body.name || '').trim().slice(0, 80);
      const contact = String(body.contact || '').trim().slice(0, 120);
      const message = String(body.message || '').trim().slice(0, 1000);
      const animalId = String(body.animalId || '').slice(0, 60);
      const animalName = String(body.animalName || '').slice(0, 60);

      const errors = [];
      if (name.length < 2) errors.push('Как к вам обращаться?');
      if (contact.length < 5) errors.push('Оставьте телефон или почту, иначе мы не сможем ответить.');
      // Каждое согласие — отдельная осознанная отметка (ч. 1 ст. 9 152-ФЗ в ред. 156-ФЗ).
      if (body.consentProcessing !== true) errors.push('Без согласия на обработку персональных данных мы не имеем права принять заявку.');
      if (body.ageConfirmed !== true) errors.push('Заявки принимаются только от совершеннолетних.');
      if (errors.length) return sendJson(res, 400, { error: errors.join(' ') }, cors);

      const now = new Date().toISOString();
      const id = token(10);
      const consentId = token(12);
      const userAgent = String(req.headers['user-agent'] || '').slice(0, 200);

      // Журнал согласий живёт отдельно от заявки: даже если заявку удалят,
      // приют должен уметь подтвердить, что согласие было получено (ч. 3 ст. 9 152-ФЗ).
      await store.logConsent({
        id: consentId,
        applicationId: id,
        kind: 'processing',
        at: now,
        subject: name,
        contactHash: digest(contact),
        purpose: 'Рассмотрение заявки на опекунство над животным приюта',
        documentVersion: CONSENT_PROCESSING.version,
        documentHash: CONSENT_PROCESSING.hash,
        ageConfirmed: true,
        ip,
        userAgent,
      });

      // Согласие на публикацию — добровольное и отдельное (ст. 10.1 152-ФЗ, ст. 152.1 ГК РФ).
      // Запреты, которые выбрал человек, обязательны для приюта: отказать в них нельзя.
      let disseminationConsentId = null;
      if (body.consentDissemination === true) {
        const allowed = new Set(CONSENT_DISSEMINATION.restrictions.map((r) => r.id));
        const restrictions = (Array.isArray(body.restrictions) ? body.restrictions : []).filter((r) => allowed.has(r));
        const customRestriction = String(body.restrictionNote || '').trim().slice(0, 300);
        disseminationConsentId = token(12);
        await store.logConsent({
          id: disseminationConsentId,
          applicationId: id,
          kind: 'dissemination',
          at: now,
          subject: name,
          contactHash: digest(contact),
          purpose: CONSENT_DISSEMINATION.title,
          resources: [OPERATOR.site, OPERATOR.vk],
          categories: restrictions.includes('no-photo') ? ['имя'] : ['имя', 'фотография'],
          restrictions,
          restrictionNote: customRestriction || null,
          documentVersion: CONSENT_DISSEMINATION.version,
          documentHash: CONSENT_DISSEMINATION.hash,
          ip,
          userAgent,
        });
      }

      await store.addApplication({
        id,
        createdAt: now,
        status: 'new',
        type: 'patronage',
        animalId: animalId || null,
        animalName: animalName || null,
        name,
        contact,
        message: message || null,
        consentId,
        consentVersion: CONSENT_PROCESSING.version,
        // Разрешил ли человек показать себя на сайте как опекуна и с какими ограничениями.
        disseminationConsentId,
        canPublish: Boolean(disseminationConsentId),
        ip,
        // Срок хранения по умолчанию — год с момента обращения (см. политику).
        retainUntil: new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString(),
      });

      return sendJson(res, 200, { ok: true, message: 'Заявка принята. Куратор приюта свяжется с вами.' }, cors);
    }

    // --- админка ---
    // Внимание: выше хвостовой слэш уже убран, поэтому «/admin/» приходит сюда как «/admin».
    if (p === '/') return redirect(res, '/admin/');

    if (!p.startsWith('/admin')) return send(res, 404, 'Не найдено', { 'content-type': 'text/plain; charset=utf-8' });

    const admins = await auth.listAdmins();

    // Первый запуск: создаём учётную запись руководителя.
    if (!admins.length && p !== '/admin/setup') return redirect(res, '/admin/setup');

    if (p === '/admin/setup') {
      if (admins.length) return redirect(res, '/admin/login');
      if (method === 'GET') return sendHtml(res, 200, views.setupPage());
      if (method === 'POST') {
        const form = await readForm(req);
        const login = String(form.login || '').trim();
        const password = String(form.password || '');
        const errs = [];
        if (login.length < 3) errs.push('Логин — минимум 3 символа.');
        if (password.length < 10) errs.push('Пароль — минимум 10 символов. Лучше несколько слов, которые легко вспомнить.');
        if (password !== form.password2) errs.push('Пароли не совпадают.');
        if (errs.length) return sendHtml(res, 400, views.setupPage({ error: errs.join(' '), login }));
        const admin = await auth.createAdmin({ login, password, name: String(form.name || '').trim() || login, role: 'owner' });
        const session = await auth.createSession(admin, { ip: clientIp(req) });
        setCookie(res, auth.SESSION_COOKIE, session.id, { maxAge: auth.SESSION_TTL_MS / 1000, secure: COOKIE_SECURE, sameSite: 'Lax' });
        await store.audit('admin_created', { login: admin.login, first: true });
        return redirect(res, '/admin/');
      }
    }

    if (p === '/admin/login') {
      if (method === 'GET') {
        const cookies = parseCookies(req);
        if (await auth.getSession(cookies[auth.SESSION_COOKIE])) return redirect(res, '/admin/');
        return sendHtml(res, 200, views.loginPage());
      }
      if (method === 'POST') {
        const ip = clientIp(req);
        const lim = loginLimiter.check(ip);
        if (!lim.ok) {
          await store.audit('login_ratelimited', { ip });
          return sendHtml(res, 429, views.loginPage({ error: `Слишком много попыток входа. Подождите ${Math.ceil((lim.retryAfter || 60) / 60)} мин.` }));
        }
        const form = await readForm(req);
        const admin = await auth.findAdmin(form.login);
        const ok = admin && (await auth.verifyPassword(form.password || '', admin.passwordHash));
        if (!ok) {
          await store.audit('login_failed', { login: String(form.login || '').slice(0, 40), ip });
          return sendHtml(res, 401, views.loginPage({ error: 'Неверный логин или пароль.', login: form.login }));
        }
        loginLimiter.reset(ip);
        const session = await auth.createSession(admin, { ip });
        setCookie(res, auth.SESSION_COOKIE, session.id, { maxAge: auth.SESSION_TTL_MS / 1000, secure: COOKIE_SECURE, sameSite: 'Lax' });
        return redirect(res, '/admin/');
      }
    }

    if (p === '/admin/logout' && method === 'POST') {
      const cookies = parseCookies(req);
      const session = await auth.getSession(cookies[auth.SESSION_COOKIE]);
      if (session) {
        const form = await readForm(req);
        if (!requireCsrf(session, form.csrf, res)) return;
        await auth.destroySession(session.id);
      }
      setCookie(res, auth.SESSION_COOKIE, '', { maxAge: 0, secure: COOKIE_SECURE });
      return redirect(res, '/admin/login');
    }

    // Дальше — только для вошедших.
    const session = await requireSession(req, res);
    if (!session) return;

    // Список животных.
    if (p === '/admin' && method === 'GET') {
      const data = await store.getAnimals();
      const apps = await store.listApplications();
      // Животные, которые уже на сайте (из ВКонтакте или со старого сайта) и которых
      // ещё никто не правил: показываем их тоже, чтобы карточку можно было открыть.
      const siteAnimals = (await store.listSiteAnimals?.()) || [];
      const known = new Set(data.animals.map((a) => a.id));
      const editable = siteAnimals.filter((a) => !known.has(a.id));
      return sendHtml(
        res,
        200,
        views.animalsPage({ session, data, siteAnimals: editable, newApplications: apps.filter((a) => a.status === 'new').length, flash: url.searchParams.get('ok') }),
      );
    }

    // Форма нового животного.
    if (p === '/admin/animal/new' && method === 'GET') {
      return sendHtml(res, 200, views.animalFormPage({ session, animal: null, personalData }));
    }

    // Форма редактирования.
    const editMatch = /^\/admin\/animal\/([\w.-]+)$/.exec(p);
    if (editMatch && method === 'GET') {
      const data = await store.getAnimals();
      let animal = data.animals.find((a) => a.id === editMatch[1]);
      if (!animal) {
        // Своей записи нет — возможно, это животное с сайта. Открываем его данные,
        // а при сохранении появится правка (source: 'override'), исходник не трогаем.
        const siteAnimals = (await store.listSiteAnimals?.()) || [];
        const base = siteAnimals.find((a) => a.id === editMatch[1]);
        if (!base) return sendHtml(res, 404, views.errorPage('Карточка не найдена.'));
        animal = { ...base, source: 'override' };
      }
      return sendHtml(res, 200, views.animalFormPage({ session, animal, personalData }));
    }

    // Сохранение.
    if (editMatch && method === 'POST') {
      const form = await readForm(req, 2 * 1024 * 1024);
      if (!requireCsrf(session, form.csrf, res)) return;
      const data = await store.getAnimals();
      let existing = data.animals.find((a) => a.id === editMatch[1]) || null;
      if (!existing && editMatch[1] !== 'new') {
        const siteAnimals = (await store.listSiteAnimals?.()) || [];
        const base = siteAnimals.find((a) => a.id === editMatch[1]);
        if (base) existing = { ...base, source: 'override' };
      }
      const input = {
        ...form,
        traits: parseJsonArray(form.traits, existing?.traits || []),
        photos: parseJsonArray(form.photosJson, existing?.photos || []),
        patronPublish: form.patronPublish === 'on',
      };
      const result = normalizeAnimal(input, existing);
      if (!result.ok) {
        return sendHtml(res, 400, views.animalFormPage({ session, animal: { ...(existing || {}), ...input, id: editMatch[1] }, errors: result.errors, personalData }));
      }
      // Там, где база вне России, вводить имя и фото опекуна нельзя: остаётся
      // только пометка, что опекун есть. Но если имя уже заведено там, где это
      // разрешено (на компьютере приюта), сохранение здесь его не стирает —
      // иначе правка клички молча уничтожала бы данные опекуна.
      let toSave = result.animal;
      if (!personalData) {
        const previous = existing?.patron || null;
        toSave = {
          ...result.animal,
          patron: !result.animal.patron
            ? null
            : previous && (previous.name || previous.photo)
              ? previous
              : { anonymous: true, since: result.animal.patron.since },
        };
      }
      await store.upsertAnimal(toSave);
      await store.audit('animal_saved', { by: session.login, id: toSave.id, name: toSave.name });
      return redirect(res, `/admin/?ok=${encodeURIComponent(`Карточка «${result.animal.name}» сохранена`)}`);
    }

    // Удаление.
    const delMatch = /^\/admin\/animal\/([\w.-]+)\/delete$/.exec(p);
    if (delMatch && method === 'POST') {
      const form = await readForm(req);
      if (!requireCsrf(session, form.csrf, res)) return;
      await store.deleteAnimal(delMatch[1]);
      await store.audit('animal_deleted', { by: session.login, id: delMatch[1] });
      return redirect(res, '/admin/?ok=' + encodeURIComponent('Карточка удалена'));
    }

    // Загрузка фотографии: тело запроса — сами байты файла.
    if (p === '/admin/api/upload' && method === 'POST') {
      if (!auth.csrfValid(session, req.headers['x-csrf-token'])) return sendJson(res, 403, { error: 'Обновите страницу и попробуйте ещё раз' });
      let buf;
      try {
        buf = await readBody(req, MAX_UPLOAD);
      } catch {
        return sendJson(res, 413, { error: 'Файл больше 12 МБ. Сфотографируйте с меньшим размером или обрежьте.' });
      }
      if (!detectImage(buf)) return sendJson(res, 400, { error: 'Это не похоже на фотографию (нужен JPEG, PNG или WebP).' });
      const processed = await processImage(buf);
      const saved = await store.saveMedia(processed.full, processed.ext);
      let thumbUrl = saved.url;
      if (processed.thumb) {
        const t = await store.saveMedia(processed.thumb, 'jpg');
        thumbUrl = t.url;
      }
      await store.audit('media_uploaded', { by: session.login, file: saved.name, bytes: saved.bytes });
      return sendJson(res, 200, { src: saved.url, thumb: thumbUrl, w: processed.width, h: processed.height });
    }

    // Заявки.
    if (p === '/admin/applications' && method === 'GET') {
      const apps = await store.listApplications();
      return sendHtml(res, 200, views.applicationsPage({ session, apps, flash: url.searchParams.get('ok') }));
    }

    const appMatch = /^\/admin\/applications\/([\w-]+)$/.exec(p);
    if (appMatch && method === 'POST') {
      const form = await readForm(req);
      if (!requireCsrf(session, form.csrf, res)) return;
      if (form.action === 'delete') {
        await store.deleteApplication(appMatch[1]);
        await store.audit('application_deleted', { by: session.login, id: appMatch[1], reason: form.reason || 'по решению оператора' });
        return redirect(res, '/admin/applications?ok=' + encodeURIComponent('Заявка и персональные данные удалены'));
      }
      const status = ['new', 'in_progress', 'accepted', 'declined'].includes(form.status) ? form.status : 'new';
      await store.updateApplication(appMatch[1], { status, adminNote: String(form.adminNote || '').slice(0, 1000) });
      await store.audit('application_updated', { by: session.login, id: appMatch[1], status });
      return redirect(res, '/admin/applications?ok=' + encodeURIComponent('Заявка обновлена'));
    }

    // Тексты согласий — чтобы приют мог их прочитать и переслать человеку,
    // если согласие берут не через сайт, а голосом или в переписке.
    if (p === '/admin/consent-text' && method === 'GET') {
      return sendHtml(res, 200, views.consentTextPage({ session }));
    }

    // Журнал полученных согласий (доказательство по ч. 3 ст. 9 152-ФЗ).
    if (p === '/admin/consents' && method === 'GET') {
      return sendHtml(res, 200, views.consentsPage({ session, consents: (await store.listConsents()).reverse() }));
    }

    // Публикация на сайт.
    if (p === '/admin/publish') {
      if (method === 'GET') {
        const data = await store.getAnimals();
        return sendHtml(
          res,
          200,
          views.publishPage({
            session,
            data,
            // Публиковать можно, если умеем класть карточки в репозиторий сайта,
            // либо если админка сама в нём живёт (Vercel).
            configured: Boolean(process.env.GITHUB_REPO && (process.env.PUBLISH_TOKEN || process.env.GITHUB_TOKEN)),
            selfPublishing: !personalData,
            flash: url.searchParams.get('ok'),
            error: url.searchParams.get('err'),
          }),
        );
      }
      if (method === 'POST') {
        const form = await readForm(req);
        if (!requireCsrf(session, form.csrf, res)) return;
        try {
          const data = await store.getAnimals();
          // В репозиторий уезжает только публичная часть: имя и фото опекуна
          // остаются на этом компьютере, наружу идёт лишь пометка, что опекун есть.
          const count = await store.publishAnimalsToRepo(data.animals.filter((a) => a.status !== 'hidden').map(toPublicAnimal));
          await store.audit('publish', { by: session.login, count });
          return redirect(res, '/admin/publish?ok=' + encodeURIComponent(`Опубликовано карточек: ${count}. Сайт обновится через 2–3 минуты.`));
        } catch (e) {
          await store.audit('publish_failed', { by: session.login, error: e.message });
          return redirect(res, '/admin/publish?err=' + encodeURIComponent(e.message));
        }
      }
    }

    // Профиль и смена пароля.
    if (p === '/admin/account') {
      if (method === 'GET') return sendHtml(res, 200, views.accountPage({ session, flash: url.searchParams.get('ok'), audit: await store.listAudit(40) }));
      if (method === 'POST') {
        const form = await readForm(req);
        if (!requireCsrf(session, form.csrf, res)) return;
        const admin = await auth.findAdmin(session.login);
        if (!admin || !(await auth.verifyPassword(form.current || '', admin.passwordHash))) {
          return sendHtml(res, 400, views.accountPage({ session, error: 'Текущий пароль указан неверно.', audit: await store.listAudit(40) }));
        }
        if (String(form.password || '').length < 10) {
          return sendHtml(res, 400, views.accountPage({ session, error: 'Новый пароль — минимум 10 символов.', audit: await store.listAudit(40) }));
        }
        if (form.password !== form.password2) {
          return sendHtml(res, 400, views.accountPage({ session, error: 'Новые пароли не совпадают.', audit: await store.listAudit(40) }));
        }
        await auth.setPassword(admin.id, form.password);
        await store.audit('password_changed', { by: session.login });
        return redirect(res, '/admin/account?ok=' + encodeURIComponent('Пароль изменён'));
      }
    }

    return sendHtml(res, 404, views.errorPage('Такой страницы в админке нет.'));
  }

  return route;
}
