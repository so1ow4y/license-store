// ============================================================================
//  Вписывает закрытый ключ DKIM в .env.production одной строкой.
//
//  ЗАЧЕМ ОТДЕЛЬНЫЙ ФАЙЛ, А НЕ КОМАНДА В ОДНУ СТРОКУ. Ключ в формате PEM
//  многострочный, а .env многострочных значений не понимает: всё после
//  первого перевода строки становится отдельными строками файла и ломает
//  его целиком. Значит переводы надо заменить на «\n» — и вот тут попытка
//  сделать это командой `node -e '...'` разбивается о слои экранирования:
//  оболочка, JS-строка и regexp-замена по очереди съедают обратный слэш,
//  и в файл попадает настоящий перевод строки, а не escape.
//
//  Файл на диске от этого свободен: что написано, то и выполняется.
//
//  Запуск:  node scripts/set-dkim-env.mjs
// ============================================================================

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const ENV = join(ROOT, '.env.production');
const KEY = join(ROOT, '.secrets', 'dkim-private.pem');

if (!existsSync(KEY)) {
  console.log(`нет ключа: ${KEY}`);
  console.log('создать:  openssl genrsa -out .secrets/dkim-private.pem 2048');
  process.exit(1);
}

const pem = readFileSync(KEY, 'utf8').trim();
const oneLine = pem.split(/\r?\n/).join('\\n');

let env = readFileSync(ENV, 'utf8');

// Вычищаем прежнее значение целиком, включая случай, когда оно уже успело
// разъехаться на несколько строк: от строки с ключом до строки, содержащей
// конец PEM. Иначе повторный запуск оставит обломки прошлого.
env = env.replace(/^DKIM_PRIVATE_KEY=[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----\s*$/m, '');
env = env.replace(/^DKIM_PRIVATE_KEY=.*$/m, '');
env = env.replace(/\n{3,}/g, '\n\n').trimEnd();

env += `\n\n# Закрытый ключ подписи писем. Одной строкой: переводы строк как \\n,\n`;
env += `# разворачиваются в mail.service.ts. Открытая часть лежит в DNS\n`;
env += `# записью mail._domainkey.pxcheats.com\n`;
env += `DKIM_PRIVATE_KEY=${oneLine}\n`;

writeFileSync(ENV, env, 'utf8');

const written = env.match(/^DKIM_PRIVATE_KEY=(.*)$/m)?.[1] ?? '';
console.log(`  записано ${written.length} символов в одну строку`);
console.log(`  начало:  ${written.slice(0, 42)}…`);
console.log(`  конец:   …${written.slice(-30)}`);
console.log(`  переводов строк внутри значения: ${(written.match(/\n/g) ?? []).length}`);
