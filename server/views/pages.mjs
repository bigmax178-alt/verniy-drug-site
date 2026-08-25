// Страницы админки. Всё серверным рендерингом: открывается мгновенно и работает
// с телефона в приюте, где интернет слабый.

import { page, esc, notice } from './layout.mjs';
import { KINDS, SEXES, TRAIT_OPTIONS } from '../lib/animal.mjs';
import { CONSENT_PROCESSING, CONSENT_DISSEMINATION } from '../../shared/consent.mjs';

const KIND_LABEL = { dog: 'Собака', cat: 'Кошка' };
const SEX_LABEL = { m: 'Мальчик', f: 'Девочка' };
const STATUS_LABEL = { looking: 'Ищет дом', adopted: 'Нашёл дом', hidden: 'Скрыт с сайта' };
const APP_STATUS = { new: ['Новая', 'pill--amber'], in_progress: ['В работе', 'pill--green'], accepted: ['Принята', 'pill--green'], declined: ['Отклонена', 'pill--rose'] };

function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
}

// ── вход и первичная настройка ──────────────────────────────────────────────

export function setupPage({ error = '', login = '' } = {}) {
  return page({
    title: 'Первый вход',
    session: null,
    wide: false,
    body: `
      <h1 style="margin-bottom:8px">Создайте учётную запись</h1>
      <p class="muted">Это первый запуск админки приюта. Заведите логин и пароль для руководителя — потом с ними можно будет входить и вести карточки животных.</p>
      ${notice(error, 'error')}
      <form method="post" class="card" autocomplete="off">
        <label><span class="lbl">Ваше имя</span><input type="text" name="name" placeholder="Ксения" autocomplete="name"></label>
        <label><span class="lbl">Логин</span><input type="text" name="login" value="${esc(login)}" required minlength="3" autocapitalize="none" autocomplete="username"></label>
        <label><span class="lbl">Пароль</span><input type="password" name="password" required minlength="10" autocomplete="new-password">
          <span class="hint">Минимум 10 символов. Надёжнее всего — несколько несвязанных слов, которые легко запомнить.</span></label>
        <label><span class="lbl">Пароль ещё раз</span><input type="password" name="password2" required minlength="10" autocomplete="new-password"></label>
        <button class="btn btn--green" type="submit">Создать и войти</button>
      </form>`,
  });
}

export function loginPage({ error = '', login = '' } = {}) {
  return page({
    title: 'Вход',
    session: null,
    wide: false,
    body: `
      <h1 style="margin-bottom:8px">🐾 Админка приюта</h1>
      <p class="muted">Вход только для сотрудников приюта.</p>
      ${notice(error, 'error')}
      <form method="post" class="card">
        <label><span class="lbl">Логин</span><input type="text" name="login" value="${esc(login)}" required autocapitalize="none" autocomplete="username" autofocus></label>
        <label><span class="lbl">Пароль</span><input type="password" name="password" required autocomplete="current-password"></label>
        <button class="btn btn--green" type="submit">Войти</button>
      </form>`,
  });
}

export function errorPage(message) {
  return page({
    title: 'Ошибка',
    session: null,
    wide: false,
    body: `<div class="card"><h1 style="margin-bottom:10px">Не получилось</h1><p>${esc(message)}</p>
      <p style="margin-top:14px"><a class="btn btn--ghost" href="/admin/">Вернуться в админку</a></p></div>`,
  });
}

// ── список животных ─────────────────────────────────────────────────────────

export function animalsPage({ session, data, siteAnimals = [], allSiteAnimals = siteAnimals, newApplications = 0, flash = '', selfPublishing = false }) {
  const animals = [...data.animals].sort((a, b) => (a.status === b.status ? a.name.localeCompare(b.name, 'ru') : a.status === 'looking' ? -1 : 1));
  // Правка может не содержать своих фотографий — тогда показываем исходные,
  // чтобы плитка не выглядела так, будто фото потеряли.
  const baseById = new Map(allSiteAnimals.map((a) => [a.id, a]));
  const tile = (a, fromSite = false) => {
    const photo = a.photos?.[0] || baseById.get(a.id)?.photos?.[0];
    const patron = a.patron
      ? a.patron.publish
        ? `<span class="pill pill--green">Опекун: ${esc(a.patron.name || 'есть')}</span>`
        : '<span class="pill">Опекун есть</span>'
      : '';
    return `<a class="animal-tile" href="/admin/animal/${esc(a.id)}">
      ${photo ? `<img src="${esc(photo.thumb || photo.src)}" alt="">` : '<img alt="" src="data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22/%3E">'}
      <div class="body">
        <div class="name">${esc(a.name)}</div>
        <div class="small muted">${esc(KIND_LABEL[a.kind] || a.kind)}${a.sex ? ' · ' + esc(SEX_LABEL[a.sex]) : ''}${a.birthYear ? ' · ' + a.birthYear + ' г.' : ''}</div>
        <div style="margin-top:6px;display:flex;gap:4px;flex-wrap:wrap">
          <span class="pill ${a.status === 'looking' ? 'pill--green' : a.status === 'hidden' ? 'pill--rose' : ''}">${esc(STATUS_LABEL[a.status] || a.status)}</span>
          ${a.source === 'override' ? '<span class="pill pill--amber">с правками</span>' : ''}
          ${fromSite ? '<span class="pill">с сайта</span>' : ''}
          ${patron}
        </div>
      </div>
    </a>`;
  };
  const tiles = animals.map((a) => tile(a)).join('');
  const siteTiles = siteAnimals.map((a) => tile(a, true)).join('');

  return page({
    title: 'Животные',
    session,
    active: 'animals',
    body: `
      ${notice(flash)}
      <div class="row" style="justify-content:space-between;margin-bottom:16px">
        <div>
          <h1>Карточки животных</h1>
          <p class="muted small" style="margin:4px 0 0">Здесь то, что вы ведёте руками. Животные из «Товаров» ВКонтакте попадают на сайт сами — их можно не заводить.</p>
        </div>
        <div class="row">
          ${newApplications ? `<a class="btn btn--ghost" href="/admin/applications">Новые заявки <span class="pill pill--amber">${newApplications}</span></a>` : ''}
          <a class="btn btn--primary" href="/admin/animal/new">+ Добавить животное</a>
        </div>
      </div>
      ${
        animals.length
          ? `<h2 style="font-size:1.1rem;margin-bottom:10px">Заведены и отредактированы вами</h2>
             <div class="grid grid--cards">${tiles}</div>`
          : ''
      }
      ${
        siteAnimals.length
          ? `<h2 style="font-size:1.1rem;margin:${animals.length ? '28px' : '0'} 0 4px">Уже на сайте</h2>
             <p class="muted small" style="margin:0 0 12px">Пришли из ВКонтакте или со старого сайта. Нажмите, чтобы поправить — исходные данные останутся нетронутыми.</p>
             <div class="grid grid--cards">${siteTiles}</div>`
          : ''
      }
      ${
        !animals.length && !siteAnimals.length
          ? `<div class="card card--soft">
               <h3>Пока пусто</h3>
               <p class="small">Добавьте первое животное — или подключите ВКонтакте, и карточки появятся сами из раздела «Товары».</p>
               <a class="btn btn--primary" href="/admin/animal/new">Добавить животное</a>
             </div>`
          : selfPublishing
            ? `<p class="muted small" style="margin-top:18px">Сохранённые изменения попадают на сайт сами — он обновляется через 2–3 минуты.</p>`
            : `<p class="muted small" style="margin-top:18px">Чтобы изменения увидели посетители, нажмите «Опубликовать» на вкладке <a href="/admin/publish">Публикация</a>.</p>`
            }`,
  });
}

// ── форма животного ─────────────────────────────────────────────────────────

export function animalFormPage({ session, animal, errors = [], personalData = true }) {
  const a = animal || {};
  const isNew = !animal?.id;
  const photos = Array.isArray(a.photos) ? a.photos : [];
  const patron = a.patron || {};

  const traitBoxes = TRAIT_OPTIONS.map((t) => {
    const on = (a.traits || []).includes(t);
    return `<label class="checkbox" style="margin:0 14px 8px 0;display:inline-flex">
      <input type="checkbox" name="traits" value="${esc(t)}" ${on ? 'checked' : ''}><span>${esc(t)}</span></label>`;
  }).join('');

  return page({
    title: isNew ? 'Новое животное' : a.name || 'Животное',
    session,
    active: 'animals',
    body: `
      <p><a href="/admin/" class="muted small">← Все животные</a></p>
      <h1 style="margin-bottom:14px">${isNew ? 'Новое животное' : esc(a.name || '')}</h1>
      ${errors.length ? notice(errors.join(' '), 'error') : ''}

      <form method="post" action="/admin/animal/${esc(a.id || 'new')}" id="animalForm">
        <input type="hidden" name="csrf" value="${esc(session.csrf)}">
        <input type="hidden" name="source" value="${esc(a.source || 'manual')}">
        <input type="hidden" name="photosJson" id="photosField" value="${esc(JSON.stringify(photos))}">

        <div class="split">
          <div>
            <fieldset>
              <legend>О животном</legend>
              <label><span class="lbl">Кличка *</span><input type="text" name="name" value="${esc(a.name || '')}" required maxlength="60"></label>
              <div class="grid grid--2">
                <label><span class="lbl">Кто это? *</span>
                  <select name="kind" required>
                    <option value="">— выберите —</option>
                    ${KINDS.map((k) => `<option value="${k}" ${a.kind === k ? 'selected' : ''}>${KIND_LABEL[k]}</option>`).join('')}
                  </select></label>
                <label><span class="lbl">Пол</span>
                  <select name="sex">
                    <option value="">не указан</option>
                    ${SEXES.map((s) => `<option value="${s}" ${a.sex === s ? 'selected' : ''}>${SEX_LABEL[s]}</option>`).join('')}
                  </select></label>
                <label><span class="lbl">Год рождения</span>
                  <input type="number" name="birthYear" value="${esc(a.birthYear || '')}" min="1990" max="${new Date().getFullYear()}" placeholder="2020">
                  <span class="hint">Возраст сайт посчитает сам</span></label>
                <label><span class="lbl">Сколько животных в карточке</span>
                  <input type="number" name="count" value="${esc(a.count || 1)}" min="1" max="10">
                  <span class="hint">Больше одного — если пристраиваете вместе (как Моня и Боня)</span></label>
              </div>
              <label><span class="lbl">Если возраст точно неизвестен</span>
                <input type="text" name="ageText" value="${esc(a.ageText || '')}" maxlength="40" placeholder="примерно 5 лет"></label>
              <label><span class="lbl">Рассказ о характере</span>
                <textarea name="description" maxlength="4000" placeholder="Как попал в приют, какой характер, ладит ли с другими животными, что важно знать будущей семье">${esc(a.description || '')}</textarea>
                <span class="hint">Пишите как для друга — именно этот текст люди читают, решаясь забрать животное.</span></label>
            </fieldset>

            <fieldset>
              <legend>Фотографии</legend>
              <p class="small muted" style="margin-top:0">Первая фотография — главная, она видна в списке. Фото уменьшаются автоматически, можно грузить прямо с телефона.</p>
              <div class="thumbs" id="thumbs"></div>
              <p style="margin:12px 0 0">
                <input type="file" id="fileInput" accept="image/jpeg,image/png,image/webp" multiple hidden>
                <button class="btn btn--ghost" type="button" id="pickBtn">Загрузить фотографии</button>
                <span class="small muted" id="uploadStatus"></span>
              </p>
            </fieldset>
          </div>

          <div>
            <fieldset>
              <legend>Где показывать</legend>
              <label><span class="lbl">Статус</span>
                <select name="status">
                  ${Object.entries(STATUS_LABEL).map(([k, v]) => `<option value="${k}" ${(a.status || 'looking') === k ? 'selected' : ''}>${v}</option>`).join('')}
                </select>
                <span class="hint">«Нашёл дом» — карточка уходит из списка ищущих, но история остаётся.</span></label>
              <label><span class="lbl">Ссылка на альбом ВКонтакте</span>
                <input type="text" name="vkAlbum" value="${esc(a.vkAlbum || '')}" placeholder="https://vk.com/album-48859748_..." maxlength="200"></label>
            </fieldset>

            <fieldset>
              <legend>Особенности</legend>
              <p class="small muted" style="margin-top:0">Показываются метками на карточке и работают как фильтры.</p>
              <div>${traitBoxes}</div>
            </fieldset>

            <fieldset>
              <legend>Опекун</legend>
              ${
                personalData
                  ? '<p class="small muted" style="margin-top:0">Заполняйте, если у животного есть постоянный опекун. Имя и фото — персональные данные: публиковать их можно <strong>только</strong> с отдельного согласия человека.</p>'
                  : `<div class="notice notice--warn" style="margin:0 0 14px">
                       <strong>Имя и фото опекуна здесь сохранить нельзя.</strong>
                       <p class="small" style="margin:6px 0 0">Это персональные данные, а закон требует хранить их в базе на территории России (ч. 5 ст. 18 152-ФЗ). Сейчас админка работает на зарубежном сервере, поэтому доступна только пометка «у животного есть опекун» — она персональными данными не является. Имена и фотографии появятся, когда админку перенесут на российский сервер.</p>
                     </div>`
              }
${personalData ? `              <label><span class="lbl">Имя опекуна</span>
                <input type="text" name="patronName" value="${esc(patron.name || '')}" maxlength="80" placeholder="Вадим М.">
                <span class="hint">Как человек сам попросил себя назвать</span></label>
              <label><span class="lbl">Подпись от опекуна</span>
                <input type="text" name="patronNote" value="${esc(patron.note || '')}" maxlength="300" placeholder="Помогаю с 2021 года"></label>
              <label><span class="lbl">Опекает с</span>
                <input type="text" name="patronSince" value="${esc(patron.since || '')}" maxlength="20" placeholder="2024-05-01"></label>
              <input type="hidden" name="patronPhoto" id="patronPhotoField" value="${esc(patron.photo || '')}">
              <div class="thumbs" id="patronThumb"></div>
              <p style="margin:8px 0 14px">
                <input type="file" id="patronFile" accept="image/jpeg,image/png,image/webp" hidden>
                <button class="btn btn--ghost btn--sm" type="button" id="patronPick">Фото опекуна</button>
              </p>
              <div class="card card--warn" style="margin:0">
                <label class="checkbox" style="margin:0">
                  <input type="checkbox" name="patronPublish" ${patron.publish ? 'checked' : ''} id="patronPublish">
                  <span><strong>Показывать имя и фото опекуна на сайте</strong>
                    <span class="hint">Ставьте галочку, только если человек дал на это отдельное согласие (ст. 10.1 152-ФЗ). Без галочки на сайте будет написано просто «у животного есть опекун».</span></span>
                </label>
                <label style="margin:12px 0 0"><span class="lbl">Где и когда получено согласие *</span>
                  <input type="text" name="patronConsentRef" value="${esc(patron.consentRef || '')}" maxlength="120" placeholder="напр.: письменно 12.05.2026 / скрин переписки ВК от 12.05.2026">
                  <span class="hint">Обязательно при публикации: это ваше доказательство согласия. Текст согласия — <a href="/admin/consent-text" target="_blank">здесь</a>.</span></label>
              </div>` : `
              <label class="checkbox" style="margin:0">
                <input type="checkbox" name="patronName" value="есть" ${patron.name || patron.anonymous ? 'checked' : ''}>
                <span>У животного есть опекун <span class="hint">На сайте появится строка «у животного есть опекун», без имени.</span></span>
              </label>`}
            </fieldset>
          </div>
        </div>

        <div class="sticky-actions row" style="justify-content:space-between">
          <button class="btn btn--green" type="submit">Сохранить</button>
          <a class="btn btn--ghost" href="/admin/">Отмена</a>
        </div>
      </form>

      ${
        !isNew
          ? `<form method="post" action="/admin/animal/${esc(a.id)}/delete" class="card card--danger" style="margin-top:24px"
                onsubmit="return confirm('Удалить карточку «${esc(a.name || '')}» навсегда?')">
              <input type="hidden" name="csrf" value="${esc(session.csrf)}">
              <strong>Удалить карточку</strong>
              <p class="small" style="margin:6px 0 10px">Если животное нашло дом — лучше не удалять, а поставить статус «Нашёл дом»: история пристройства украшает приют.</p>
              <button class="btn btn--danger btn--sm" type="submit">Удалить навсегда</button>
            </form>`
          : ''
      }

<script>
(function(){
  var csrf = ${JSON.stringify(session.csrf)};
  var photos = JSON.parse(document.getElementById('photosField').value || '[]');
  var thumbs = document.getElementById('thumbs');
  var status = document.getElementById('uploadStatus');

  function renderPhotos(){
    thumbs.innerHTML = photos.map(function(p,i){
      return '<div class="thumb"><img src="'+(p.thumb||p.src)+'" alt=""><button type="button" data-i="'+i+'" title="Убрать">×</button></div>';
    }).join('');
    document.getElementById('photosField').value = JSON.stringify(photos);
  }
  thumbs.addEventListener('click', function(e){
    var b = e.target.closest('button[data-i]');
    if(!b) return;
    photos.splice(Number(b.dataset.i),1);
    renderPhotos();
  });

  async function upload(file){
    var r = await fetch('/admin/api/upload', {method:'POST', headers:{'x-csrf-token':csrf,'content-type':'application/octet-stream'}, body:file});
    var j = await r.json();
    if(!r.ok) throw new Error(j.error||'не удалось загрузить');
    return j;
  }

  document.getElementById('pickBtn').onclick = function(){ document.getElementById('fileInput').click(); };
  document.getElementById('fileInput').onchange = async function(e){
    var files = Array.from(e.target.files||[]);
    for (var i=0;i<files.length;i++){
      status.textContent = 'Загружаю ' + (i+1) + ' из ' + files.length + '…';
      try { photos.push(await upload(files[i])); renderPhotos(); }
      catch(err){ status.textContent = 'Ошибка: ' + err.message; return; }
    }
    status.textContent = 'Готово. Не забудьте сохранить.';
    e.target.value='';
  };

  // Фото опекуна есть только там, где разрешены персональные данные.
  // Без этих проверок скрипт падал и переставал сохранять признаки и фотографии.
  var patronThumb = document.getElementById('patronThumb');
  var patronField = document.getElementById('patronPhotoField');
  var patronPick = document.getElementById('patronPick');
  var patronFile = document.getElementById('patronFile');
  function renderPatron(){
    if(!patronThumb || !patronField) return;
    patronThumb.innerHTML = patronField.value
      ? '<div class="thumb"><img src="'+patronField.value+'" alt=""><button type="button" id="patronDel" title="Убрать">×</button></div>' : '';
    var d = document.getElementById('patronDel');
    if(d) d.onclick = function(){ patronField.value=''; renderPatron(); };
  }
  if(patronPick && patronFile){
    patronPick.onclick = function(){ patronFile.click(); };
    patronFile.onchange = async function(e){
      if(!e.target.files[0]) return;
      try { var j = await upload(e.target.files[0]); patronField.value = j.src; renderPatron(); }
      catch(err){ alert('Не удалось загрузить: '+err.message); }
      e.target.value='';
    };
  }

  renderPhotos();
  renderPatron();
})();
</script>`,
  });
}

// ── заявки ──────────────────────────────────────────────────────────────────

export function applicationsPage({ session, apps, flash = '' }) {
  const rows = apps
    .map((a) => {
      const [label, cls] = APP_STATUS[a.status] || ['—', ''];
      return `<tr>
        <td>
          <strong>${esc(a.name)}</strong><br>
          <a href="${a.contact.includes('@') ? 'mailto:' + esc(a.contact) : 'tel:' + esc(a.contact.replace(/[^\d+]/g, ''))}">${esc(a.contact)}</a>
          ${a.message ? `<div class="small muted" style="margin-top:6px;white-space:pre-wrap">${esc(a.message)}</div>` : ''}
        </td>
        <td>${a.animalName ? esc(a.animalName) : '<span class="muted">не указано</span>'}</td>
        <td class="small">${fmtDate(a.createdAt)}<div class="muted">хранить до ${a.retainUntil ? fmtDate(a.retainUntil) : '—'}</div></td>
        <td>
          <form method="post" action="/admin/applications/${esc(a.id)}" class="stack">
            <input type="hidden" name="csrf" value="${esc(session.csrf)}">
            <span class="pill ${cls}" style="margin-bottom:6px;display:inline-block">${label}</span>
            <select name="status" style="margin-bottom:6px">
              ${Object.entries(APP_STATUS).map(([k, v]) => `<option value="${k}" ${a.status === k ? 'selected' : ''}>${v[0]}</option>`).join('')}
            </select>
            <input type="text" name="adminNote" value="${esc(a.adminNote || '')}" placeholder="заметка для себя" style="margin-bottom:6px">
            <button class="btn btn--sm btn--ghost" type="submit">Сохранить</button>
          </form>
          <form method="post" action="/admin/applications/${esc(a.id)}" style="margin-top:8px"
                onsubmit="return confirm('Удалить заявку и все персональные данные этого человека?')">
            <input type="hidden" name="csrf" value="${esc(session.csrf)}">
            <input type="hidden" name="action" value="delete">
            <button class="btn btn--sm btn--danger" type="submit">Удалить ПДн</button>
          </form>
        </td>
      </tr>`;
    })
    .join('');

  return page({
    title: 'Заявки',
    session,
    active: 'applications',
    body: `
      ${notice(flash)}
      <h1>Заявки на опекунство</h1>
      <div class="card card--warn" style="margin-top:14px">
        <strong>Это персональные данные людей.</strong>
        <p class="small" style="margin:6px 0 0">Они хранятся только на этом сервере в России и не попадают на сайт. Удаляйте заявку кнопкой «Удалить ПДн», когда вопрос решён или если человек попросил отозвать согласие — закон требует прекратить обработку. Журнал полученных согласий при этом сохраняется отдельно, как доказательство.</p>
      </div>
      ${
        apps.length
          ? `<div class="card table-wrap"><table>
              <thead><tr><th>Кто</th><th>Животное</th><th>Когда</th><th style="width:220px">Статус</th></tr></thead>
              <tbody>${rows}</tbody></table></div>`
          : '<div class="card"><p class="muted">Заявок пока нет. Они появятся здесь, когда кто-то заполнит форму «Стать опекуном» на сайте.</p></div>'
      }`,
  });
}

// ── согласия ────────────────────────────────────────────────────────────────

export function consentTextPage({ session }) {
  const block = (c) => `
    <div class="card">
      <h2>${esc(c.title)}</h2>
      <p class="small muted">Редакция ${esc(c.version)} · отпечаток ${esc(c.hash)}</p>
      <textarea readonly style="min-height:320px;font-size:.9rem">${esc(c.text)}</textarea>
      <p class="small muted" style="margin-top:8px">Можно выделить и скопировать — например, чтобы отправить человеку в переписке.</p>
    </div>`;
  return page({
    title: 'Тексты согласий',
    session,
    body: `
      <h1>Тексты согласий</h1>
      <div class="card card--warn" style="margin-top:14px">
        <p class="small" style="margin:0">Эти тексты человек видит на сайте, когда оставляет заявку. Если вы берёте согласие вне сайта (по телефону или в переписке), сохраните подтверждение: скриншот, письмо или бумагу с подписью. Без такого подтверждения публиковать имя и фото опекуна нельзя.</p>
      </div>
      ${block(CONSENT_PROCESSING)}
      ${block(CONSENT_DISSEMINATION)}
      <div class="card card--soft">
        <h3>Что человек вправе запретить</h3>
        <p class="small">По закону опекун может ограничить публикацию, и приют не вправе ему отказать:</p>
        <ul class="small">${CONSENT_DISSEMINATION.restrictions.map((r) => `<li>${esc(r.label)}</li>`).join('')}</ul>
      </div>`,
  });
}

export function consentsPage({ session, consents }) {
  const rows = consents
    .map(
      (c) => `<tr>
        <td class="small">${fmtDate(c.at)}</td>
        <td>${esc(c.subject || '—')}</td>
        <td><span class="pill ${c.kind === 'dissemination' ? 'pill--amber' : 'pill--green'}">${c.kind === 'dissemination' ? 'публикация' : 'обработка'}</span></td>
        <td class="small">${esc(c.documentVersion || '')}<div class="muted">${esc(c.documentHash || '')}</div></td>
        <td class="small">${
          c.restrictions?.length || c.restrictionNote
            ? esc([...(c.restrictions || []).map((r) => CONSENT_DISSEMINATION.restrictions.find((x) => x.id === r)?.label || r), c.restrictionNote].filter(Boolean).join('; '))
            : '<span class="muted">без ограничений</span>'
        }</td>
      </tr>`,
    )
    .join('');
  return page({
    title: 'Журнал согласий',
    session,
    body: `
      <h1>Журнал согласий</h1>
      <p class="muted small">Подтверждение того, что согласие было получено: кто, когда и на какую редакцию текста согласился. Журнал сохраняется, даже если саму заявку удалить.</p>
      <div class="card table-wrap" style="margin-top:14px">
        <table><thead><tr><th>Когда</th><th>Кто</th><th>Вид</th><th>Редакция</th><th>Ограничения</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="5" class="muted">пока пусто</td></tr>'}</tbody></table>
      </div>`,
  });
}

// ── публикация ──────────────────────────────────────────────────────────────

export function publishPage({ session, data, configured, selfPublishing = false, flash = '', error = '' }) {
  const count = data.animals.filter((a) => a.status !== 'hidden').length;
  return page({
    title: 'Публикация',
    session,
    active: 'publish',
    wide: false,
    body: `
      ${notice(flash)}
      ${notice(error, 'error')}
      <h1>Публикация на сайт</h1>
      <div class="card" style="margin-top:14px">
        <p>Карточек к публикации: <strong>${count}</strong>.<br>
        Последнее изменение: <strong>${fmtDate(data.updatedAt)}</strong>.</p>
        ${
          selfPublishing
            ? `<div class="notice" style="margin:0">Здесь публиковать ничего не нужно: карточки сохраняются сразу в сайт, обновление занимает 2–3 минуты.</div>`
            : configured
              ? `<form method="post">
                   <input type="hidden" name="csrf" value="${esc(session.csrf)}">
                   <button class="btn btn--primary" type="submit">Опубликовать на сайт</button>
                 </form>
                 <p class="small muted" style="margin-top:10px">Карточки и фотографии уедут на сайт, он пересоберётся за 2–3 минуты.</p>
                 <p class="small muted">Про опекунов: если у карточки стоит галочка «показывать на сайте» — значит согласие получено, и имя с фотографией
                 публикуются, это и есть их цель. Если галочки нет, наружу уходит только пометка «у животного есть опекун», а имя
                 <strong>остаётся на этом компьютере</strong>. Заявки и контакты людей не публикуются никогда.</p>`
              : `<div class="notice notice--warn" style="margin:0">
                   <strong>Публикация не настроена.</strong>
                   <p class="small" style="margin:6px 0 0">Нужны GITHUB_REPO и PUBLISH_TOKEN в файле
                   <code>~/Library/Application Support/verniy-drug/env.sh</code>. Как их получить — в server/README.md.</p>
                 </div>`
        }
      </div>`,
  });
}

// ── профиль ─────────────────────────────────────────────────────────────────

export function accountPage({ session, flash = '', error = '', audit = [] }) {
  const log = audit
    .map((e) => `<tr><td class="small">${fmtDate(e.at)}</td><td class="small">${esc(e.action)}</td><td class="small muted">${esc(e.by || e.login || '')}</td></tr>`)
    .join('');
  return page({
    title: 'Профиль',
    session,
    active: 'account',
    wide: false,
    body: `
      ${notice(flash)}
      ${notice(error, 'error')}
      <h1>Профиль</h1>
      <div class="card" style="margin-top:14px">
        <p>Вы вошли как <strong>${esc(session.name || session.login)}</strong> (${esc(session.login)}).</p>
      </div>
      <form method="post" class="card">
        <h3 style="margin-bottom:12px">Сменить пароль</h3>
        <input type="hidden" name="csrf" value="${esc(session.csrf)}">
        <label><span class="lbl">Текущий пароль</span><input type="password" name="current" required autocomplete="current-password"></label>
        <label><span class="lbl">Новый пароль</span><input type="password" name="password" required minlength="10" autocomplete="new-password"></label>
        <label><span class="lbl">Новый пароль ещё раз</span><input type="password" name="password2" required minlength="10" autocomplete="new-password"></label>
        <button class="btn btn--green" type="submit">Сменить пароль</button>
      </form>
      <div class="card">
        <h3 style="margin-bottom:10px">Журнал действий</h3>
        <p class="small muted">Кто и что делал в админке. Полезно, если доступ есть у нескольких человек.</p>
        <div class="table-wrap"><table><tbody>${log || '<tr><td class="muted">пока пусто</td></tr>'}</tbody></table></div>
      </div>`,
  });
}
