import { describe, expect, it } from 'vitest';

import { maskWebhookSecret } from '@common/logger/logger.module';
import { redactLicenseKeys } from '@common/utils/license-key';

/**
 * Условие выпуска §7.6 ТЗ бота: грep по суточным логам не находит ни одного
 * ключа лицензии и ни одного секрета вебхука. Проверяется здесь, потому что
 * проверять это глазами по логам можно только ПОСЛЕ утечки.
 */

describe('секрет вебхука не попадает в лог', () => {
  it('вырезается из пути запроса', () => {
    // Секрет — сегмент пути, а не заголовок: redact по req.params и
    // req.headers его не видит, а url сериализатор пишет на каждом апдейте.
    expect(maskWebhookSecret('/api/v1/telegram/webhook/s3cr3t-value_123')).toBe(
      '/api/v1/telegram/webhook/[REDACTED]',
    );
  });

  it('вырезается вместе с query-строкой, не трогая её саму', () => {
    expect(maskWebhookSecret('/api/v1/telegram/webhook/abc?x=1')).toBe(
      '/api/v1/telegram/webhook/[REDACTED]?x=1',
    );
  });

  it('вырезается из строки глобального фильтра исключений', () => {
    // Именно этот формат печатает all-exceptions.filter.ts, и именно он
    // срабатывает на КАЖДОМ апдейте, пока рубильник выключен: контроллер
    // отвечает 404, фильтр логирует строку с полным адресом.
    expect(
      maskWebhookSecret('POST /api/v1/telegram/webhook/s3cr3t → 404 NOT_FOUND [req-1]'),
    ).toBe('POST /api/v1/telegram/webhook/[REDACTED] → 404 NOT_FOUND [req-1]');
  });

  it('обычные пути не трогает', () => {
    expect(maskWebhookSecret('/api/v1/licenses/019fbacc')).toBe('/api/v1/licenses/019fbacc');
    expect(maskWebhookSecret(undefined)).toBeUndefined();
  });
});

describe('ключ лицензии не попадает в лог', () => {
  it('вырезается из середины произвольного текста', () => {
    const line = 'не удалось активировать FC26-ACDE-FGHJ-KMNP-QRTU для пользователя u1';
    expect(redactLicenseKeys(line)).toBe('не удалось активировать *** для пользователя u1');
  });

  it('ловит ключ продукта со слагом через дефис', () => {
    // Ровно тот случай, ради которого префикс регулярки не сужен до
    // [A-Z0-9]{2,6}: слаг продукта может содержать дефисы, и узкая
    // регулярка пропускала бы ключи нового продукта — там, где утечка
    // дороже всего.
    expect(redactLicenseKeys('ключ GTA-5-ACDE-FGHJ-KMNP-QRTU выдан')).toBe('ключ *** выдан');
  });

  it('вырезает несколько ключей в одной строке', () => {
    const line = 'FC26-ACDE-FGHJ-KMNP-QRTU и FC27-BCDE-FGHJ-KMNP-QRTV';
    expect(redactLicenseKeys(line)).toBe('*** и ***');
  });

  it('не портит обычный текст и uuid', () => {
    const uuid = '019fbacc-0000-7000-8000-000000000001';
    expect(redactLicenseKeys(uuid)).toBe(uuid);
    expect(redactLicenseKeys('обычное сообщение')).toBe('обычное сообщение');
  });
});
