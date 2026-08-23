#!/usr/bin/env node
// Готовит значения для переменных окружения админки на Vercel.
//
//   node scripts/make-admin-hash.mjs "ваш-пароль"
//
// Выводит хэш пароля (scrypt) и случайный секрет для подписи сессий.
// Сам пароль никуда не сохраняется — только его хэш.

import { randomBytes } from 'node:crypto';
import { hashPassword } from '../server/lib/auth.mjs';

const password = process.argv[2];

if (!password) {
  console.error('Укажите пароль:  node scripts/make-admin-hash.mjs "несколько простых слов"');
  process.exit(1);
}
if (password.length < 10) {
  console.error(`Пароль слишком короткий (${password.length} символов). Нужно хотя бы 10 — лучше несколько несвязанных слов.`);
  process.exit(1);
}

const hash = await hashPassword(password);
const secret = randomBytes(32).toString('base64url');

console.log('\nДобавьте в Vercel → Settings → Environment Variables:\n');
console.log('ADMIN_LOGIN');
console.log('  (придумайте логин, например ksenia)\n');
console.log('ADMIN_PASSWORD_HASH');
console.log(`  ${hash}\n`);
console.log('SESSION_SECRET');
console.log(`  ${secret}\n`);
console.log('Ещё понадобятся GITHUB_REPO (владелец/репозиторий) и GITHUB_TOKEN');
console.log('(тонкий токен GitHub с правом Contents: Read and write на этот репозиторий).\n');
console.log('Пароль запомните или сохраните в менеджере паролей — восстановить его из хэша нельзя.');
