import { LicenseStatus } from '@prisma/client';
import { describe, expect, it } from 'vitest';

import {
  durationText,
  expiryLine,
  formatMoney,
  hoursText,
  looksLikeLicenseKey,
  maskEmail,
  toLicenseView,
  validUntil,
} from '../src/modules/telegram-bot/bot-format';

/**
 * Форматирование значений для экранов бота.
 *
 * Главное, что здесь проверяется, — маска ключа. `toLicenseView` вызывается
 * на КАЖДОЙ отрисовке лицензии, и он последняя инстанция перед чужим
 * экраном: если он однажды пропустит полный ключ, это увидит не разработчик,
 * а получатель скриншота из переписки. Поэтому проверяются оба состояния
 * сервиса лицензий — и до правки C1 (приходит `key`), и после неё
 * (приходит `maskedKey`).
 */

const KEY = 'FC26-ACDE-FGHJ-KMNP-QRTU';

function row(extra: Partial<Parameters<typeof toLicenseView>[0]> = {}) {
  return {
    id: '0195f0a0-0000-7000-8000-000000000001',
    status: LicenseStatus.ACTIVE,
    expiresAt: new Date('2026-09-12T10:00:00.000Z'),
    product: { name: 'FC 26' },
    plan: { name: '30 дней', durationDays: 30 },
    ...extra,
  };
}

describe('toLicenseView — маска ключа', () => {
  it('маскирует полный ключ, пришедший из сервиса до правки C1', () => {
    const view = toLicenseView(row({ key: KEY }));

    expect(view.maskedKey).toBe('FC26-****-****-****-QRTU');
    expect(view.maskedKey).not.toContain('ACDE');
    expect(JSON.stringify(view)).not.toContain(KEY);
  });

  it('берёт готовую маску, если сервис уже её посчитал', () => {
    const view = toLicenseView(row({ maskedKey: 'FC26-****-****-****-QRTU' }));
    expect(view.maskedKey).toBe('FC26-****-****-****-QRTU');
  });

  it('без ключа вовсе не падает', () => {
    const view = toLicenseView(row());
    expect(view.maskedKey).toBe('');
  });

  it('подставляет прочерк вместо пропавшего продукта или тарифа', () => {
    const view = toLicenseView(row({ product: null, plan: null }));
    expect(view.productName).toBe('—');
    expect(view.planName).toBe('—');
    expect(view.durationDays).toBeNull();
  });
});

describe('Строка срока', () => {
  it('статус важнее даты: у заблокированной срок не показывается', () => {
    const view = toLicenseView(row({ status: LicenseStatus.BLOCKED }));
    expect(expiryLine('ru', view)).toBe('заблокирована');
  });

  it('бессрочная лицензия названа бессрочной, а не «до —»', () => {
    const view = toLicenseView(row({ expiresAt: null }));
    expect(expiryLine('ru', view)).toBe('бессрочная');
    expect(validUntil('en', view)).toBe('lifetime');
  });

  it('не активированная не обещает срока', () => {
    const view = toLicenseView(row({ status: LicenseStatus.PENDING }));
    expect(validUntil('ru', view)).toBe('не активирована');
  });

  it('дата показывается по Москве и с подписью пояса', () => {
    const view = toLicenseView(row({ expiresAt: new Date('2026-09-12T21:30:00.000Z') }));
    // 21:30 UTC = 00:30 следующих суток по Москве.
    expect(validUntil('ru', view)).toBe('13.09.2026 00:30 МСК');
  });
});

describe('Маска почты', () => {
  it('оставляет первую и последнюю букву и домен', () => {
    expect(maskEmail('grigorij@gmail.com')).toBe('g***j@gmail.com');
  });

  it('короткую локальную часть скрывает целиком', () => {
    expect(maskEmail('ab@mail.ru')).toBe('***@mail.ru');
  });

  it('пустое значение и мусор не роняют экран', () => {
    expect(maskEmail(null)).toBe('—');
    expect(maskEmail('не-почта')).toBe('***');
  });
});

describe('Похоже ли на ключ лицензии', () => {
  it('узнаёт ключ, введённый вместо кода Digiseller', () => {
    expect(looksLikeLicenseKey(KEY)).toBe(true);
    expect(looksLikeLicenseKey('  fc26-acde-fghj-kmnp-qrtu ')).toBe(true);
  });

  it('узнаёт ключ продукта со слагом из двух частей', () => {
    expect(looksLikeLicenseKey('GTA-5-ACDE-FGHJ-KMNP-QRTU')).toBe(true);
  });

  it('настоящий код площадки ключом не считает', () => {
    expect(looksLikeLicenseKey('A1B2C3D4E5F6G7H8')).toBe(false);
  });
});

describe('Числительные и деньги', () => {
  it('подбирает форму слова по числу', () => {
    expect(durationText('ru', 1)).toBe('1 день');
    expect(durationText('ru', 3)).toBe('3 дня');
    expect(durationText('ru', 30)).toBe('30 дней');
    expect(durationText('ru', 31)).toBe('31 день');
    expect(durationText('en', 1)).toBe('1 day');
    expect(durationText('en', 30)).toBe('30 days');
  });

  it('бессрочный тариф не превращается в «null дней»', () => {
    expect(durationText('ru', null)).toBe('бессрочно');
    expect(durationText('en', null)).toBe('lifetime');
  });

  it('часы кулдауна тоже согласованы', () => {
    expect(hoursText('ru', 24)).toBe('24 часа');
    expect(hoursText('ru', 1)).toBe('1 час');
    expect(hoursText('en', 24)).toBe('24 hours');
  });

  it('убирает копеечный хвост у целой суммы', () => {
    expect(formatMoney('1490.00')).toBe('1490');
    expect(formatMoney('1490.50')).toBe('1490.5');
    expect(formatMoney(null)).toBe('');
  });
});
