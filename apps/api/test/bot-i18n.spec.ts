import { describe, expect, it } from 'vitest';

import { en } from '../src/modules/telegram-bot/i18n/en';
import { ru } from '../src/modules/telegram-bot/i18n/ru';
import { pickLocale, raw, t } from '../src/modules/telegram-bot/i18n';

/**
 * Словари бота.
 *
 * Ловит три класса ошибок, каждый из которых доезжает до пользователя молча:
 *
 *   1. Разошедшиеся наборы ключей. Забытый перевод показывает человеку голый
 *      идентификатор ключа вместо текста, и заметно это только на том языке,
 *      на котором разработчик не читает.
 *   2. Разошедшиеся плейсхолдеры. `{{expiresAt}}` в русском и `{{expires}}`
 *      в английском означают, что на одном языке дата не подставится вовсе,
 *      а строка «не передано значение» уйдёт в лог, а не на экран.
 *   3. Полный ключ лицензии в шаблоне. Единственное место, где он допустим,
 *      — экран показа ключа по явному запросу владельца (E-07). Везде ещё
 *      это нарушение решения 0.3 ТЗ, и заметить его глазами в трёхстах
 *      строках словаря нельзя.
 */

/** Единственный шаблон, которому полный ключ положен по замыслу. */
const KEY_REVEAL = 'screen.key.reveal';

/** Плейсхолдеры, означающие полное значение ключа. */
const FULL_KEY_PLACEHOLDERS = ['{{key}}', '{{licenseKey}}'];

function placeholders(template: string): string[] {
  return [...template.matchAll(/\{\{(\w+)\}\}/g)].map((match) => match[1] ?? '').sort();
}

describe('Словари бота — наборы ключей', () => {
  it('ru и en содержат ровно одни и те же ключи', () => {
    const enKeys = Object.keys(en).sort();
    const ruKeys = Object.keys(ru).sort();

    expect(ruKeys).toEqual(enKeys);
  });

  it('ни одна строка не пуста', () => {
    for (const [key, value] of Object.entries(en)) {
      expect(value.trim(), `пустая строка en: ${key}`).not.toBe('');
    }
    for (const [key, value] of Object.entries(ru)) {
      expect(value.trim(), `пустая строка ru: ${key}`).not.toBe('');
    }
  });

  it('наборы плейсхолдеров совпадают в обеих локалях', () => {
    for (const key of Object.keys(en) as Array<keyof typeof en>) {
      expect(placeholders(ru[key]), `расхождение плейсхолдеров в ${key}`).toEqual(
        placeholders(en[key]),
      );
    }
  });
});

describe('Словари бота — ключ лицензии', () => {
  it('полный ключ есть только в шаблоне показа ключа', () => {
    for (const [key, value] of Object.entries({ ...en })) {
      if (key === KEY_REVEAL) continue;
      for (const placeholder of FULL_KEY_PLACEHOLDERS) {
        expect(value.includes(placeholder), `${key} содержит ${placeholder}`).toBe(false);
      }
    }

    for (const [key, value] of Object.entries(ru)) {
      if (key === KEY_REVEAL) continue;
      for (const placeholder of FULL_KEY_PLACEHOLDERS) {
        expect(value.includes(placeholder), `${key} содержит ${placeholder}`).toBe(false);
      }
    }
  });

  it('экран показа ключа действительно подставляет ключ', () => {
    expect(en[KEY_REVEAL]).toContain('{{key}}');
    expect(ru[KEY_REVEAL]).toContain('{{key}}');
  });
});

describe('Подстановка значений', () => {
  it('экранирует пользовательские данные', () => {
    const rendered = t('ru', 'screen.link_success', {
      username: '<b>злоумышленник</b>',
      expiresAt: '01.01.2027',
    });

    expect(rendered).toContain('&lt;b&gt;злоумышленник&lt;/b&gt;');
    expect(rendered).not.toContain('<b>злоумышленник</b>');
  });

  it('raw() вставляется без экранирования', () => {
    const rendered = t('ru', 'screen.licenses.list', { items: raw('<code>FC26-****</code>') });
    expect(rendered).toContain('<code>FC26-****</code>');
  });

  it('null и undefined дают пустую строку, а не слово null', () => {
    const rendered = t('en', 'screen.root', {
      username: 'user',
      activeCount: 0,
      totalCount: 0,
      expirySuffix: null,
    });

    expect(rendered).not.toContain('null');
    expect(rendered).toContain('0 active of 0');
  });
});

describe('Выбор локали', () => {
  it('русскоязычная аудитория получает русский', () => {
    expect(pickLocale('ru')).toBe('ru');
    expect(pickLocale('ru-RU')).toBe('ru');
    expect(pickLocale('uk')).toBe('ru');
    expect(pickLocale('be')).toBe('ru');
    expect(pickLocale('kk')).toBe('ru');
  });

  it('всё остальное и пустое значение — английский', () => {
    expect(pickLocale('en-GB')).toBe('en');
    expect(pickLocale('de')).toBe('en');
    expect(pickLocale(null)).toBe('en');
    expect(pickLocale(undefined)).toBe('en');
    expect(pickLocale('')).toBe('en');
  });
});
