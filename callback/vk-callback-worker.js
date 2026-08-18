// Cloudflare Worker: принимает уведомления VK Callback API и запускает пересборку сайта.
//
// Зачем: по расписанию сайт обновляется раз в 30 минут; с этим воркером новый пост,
// товар или сообщение в обсуждении попадают на сайт через 1–2 минуты.
//
// Переменные окружения воркера (Settings → Variables, все как Secret):
//   VK_CONFIRMATION — строка подтверждения из настроек Callback API группы
//   VK_SECRET       — секретный ключ, который вы зададите там же (любая строка)
//   GITHUB_TOKEN    — fine-grained PAT с правом «Contents: read/write» на репозиторий сайта
//   GITHUB_REPO     — например: maksim/verniy-drug-site
//
// В VK: Управление группой → Работа с API → Callback API → адрес воркера,
// типы событий: «Запись на стене: добавление/редактирование/удаление», «Товары»,
// «Обсуждения: новое сообщение», «Фотографии: добавление».

const MIN_INTERVAL_MS = 90_000; // не чаще одной пересборки в полторы минуты
let lastDispatch = 0;

export default {
  async fetch(request, env) {
    if (request.method !== 'POST') return new Response('ok', { status: 200 });
    let body;
    try {
      body = await request.json();
    } catch {
      return new Response('bad json', { status: 400 });
    }
    if (body.type === 'confirmation') return new Response(env.VK_CONFIRMATION, { status: 200 });
    if (env.VK_SECRET && body.secret !== env.VK_SECRET) return new Response('forbidden', { status: 403 });

    const now = Date.now();
    if (now - lastDispatch > MIN_INTERVAL_MS) {
      lastDispatch = now;
      await fetch(`https://api.github.com/repos/${env.GITHUB_REPO}/dispatches`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${env.GITHUB_TOKEN}`,
          accept: 'application/vnd.github+json',
          'user-agent': 'vk-callback-worker',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ event_type: 'vk-update', client_payload: { vk_event: body.type, group_id: body.group_id } }),
      }).catch(() => {});
    }
    // VK ждёт ровно строку "ok", иначе будет повторять запрос.
    return new Response('ok', { status: 200 });
  },
};
