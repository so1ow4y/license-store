import { describe, expect, it } from 'vitest';
import { createHash, createHmac } from 'node:crypto';

import type { Env } from '../src/common/config/env.schema';
import {
  TelegramProvider,
  type TelegramAuthPayload,
} from '../src/modules/auth/oauth/telegram.provider';

/**
 * Подпись Telegram проверяется без доступа к настоящему боту: валидные
 * payload'ы считаются тем же алгоритмом, что и на стороне Telegram.
 * Это позволяет закрыть логику до того, как появится домен для виджета.
 */

const BOT_TOKEN = '123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw';

function makeProvider(): TelegramProvider {
  return new TelegramProvider({ TELEGRAM_BOT_TOKEN: BOT_TOKEN } as Env);
}

/**
 * Провайдер без токена. Отдельная функция, а не параметр со значением
 * по умолчанию: явно переданный undefined в JS активирует умолчание,
 * и проверка молча тестировала бы настроенный провайдер.
 */
function makeUnconfiguredProvider(): TelegramProvider {
  return new TelegramProvider({} as Env);
}

/** Подписывает данные ровно так, как это делает Telegram. */
function sign(fields: Record<string, string>, token = BOT_TOKEN): string {
  const checkString = Object.keys(fields)
    .sort()
    .map((k) => `${k}=${fields[k]}`)
    .join('\n');

  // Секрет — БИНАРНЫЙ sha256 от токена, не hex. Частая ошибка реализации.
  const secret = createHash('sha256').update(token, 'utf8').digest();
  return createHmac('sha256', secret).update(checkString, 'utf8').digest('hex');
}

function validPayload(overrides: Partial<TelegramAuthPayload> = {}): TelegramAuthPayload {
  const fields: Record<string, string> = {
    id: '987654321',
    first_name: 'Иван',
    username: 'ivan_player',
    auth_date: String(Math.floor(Date.now() / 1000)),
  };

  for (const [k, v] of Object.entries(overrides)) {
    if (k !== 'hash' && v !== undefined) fields[k] = String(v);
  }

  return { ...fields, hash: sign(fields), ...overrides } as TelegramAuthPayload;
}

describe('TelegramProvider', () => {
  it('принимает корректно подписанные данные', () => {
    const profile = makeProvider().verify(validPayload());

    expect(profile.id).toBe('987654321');
    expect(profile.username).toBe('ivan_player');
  });

  it('отвергает подпись от другого бота', () => {
    const fields = {
      id: '987654321',
      first_name: 'Иван',
      auth_date: String(Math.floor(Date.now() / 1000)),
    };
    const foreign = { ...fields, hash: sign(fields, '999:OTHER-BOT-TOKEN') } as TelegramAuthPayload;

    expect(() => makeProvider().verify(foreign)).toThrow(/подпись/i);
  });

  it('отвергает подменённые данные при валидной подписи от других полей', () => {
    // Классическая попытка: подписали свои данные, затем подставили чужой id.
    const payload = validPayload();
    expect(() => makeProvider().verify({ ...payload, id: '111111111' })).toThrow(/подпись/i);
  });

  it('отвергает устаревшие данные', () => {
    // Подпись бессрочна — единственное, что мешает переиграть перехваченный
    // payload через месяц, это проверка возраста.
    const old = String(Math.floor(Date.now() / 1000) - 3600);
    expect(() => makeProvider().verify(validPayload({ auth_date: old }))).toThrow(/устарел/i);
  });

  it('отвергает данные из будущего', () => {
    const future = String(Math.floor(Date.now() / 1000) + 3600);
    expect(() => makeProvider().verify(validPayload({ auth_date: future }))).toThrow(/устарел/i);
  });

  it('отвергает payload без hash', () => {
    const p = validPayload();
    expect(() => makeProvider().verify({ ...p, hash: '' })).toThrow(/некорректные/i);
  });

  it('собирает username, когда Telegram его не прислал', () => {
    // username в Telegram необязателен: без запасного варианта аккаунт
    // остался бы без логина.
    const fields: Record<string, string> = {
      id: '555',
      first_name: 'Пётр',
      last_name: 'Петров',
      auth_date: String(Math.floor(Date.now() / 1000)),
    };
    const payload = { ...fields, hash: sign(fields) } as TelegramAuthPayload;

    expect(makeProvider().verify(payload).username).toBe('Пётр_Петров');
  });

  it('сообщает, что вход не настроен, если токена нет', () => {
    expect(() => makeUnconfiguredProvider().verify(validPayload())).toThrow(/не настроен/i);
  });
});
