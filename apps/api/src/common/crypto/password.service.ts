import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Algorithm, hash, verify } from '@node-rs/argon2';

import { SettingsService } from '../settings/settings.service';

/**
 * Хеширование паролей Argon2id.
 *
 * Главный потребитель CPU во всей системе: при m=64 МБ и t=3 один хеш
 * занимает около 70 мс процессорного времени. Именно от этого числа
 * считается требуемое количество ядер на сервере, поэтому параметры
 * вынесены в настройки и меняются без передеплоя (ТЗ п.8).
 */

/**
 * Верхняя граница длины пароля.
 *
 * Argon2 честно посчитает хеш и от мегабайтной строки, заняв ядро
 * на секунды — это готовый способ положить сервер несколькими запросами.
 * 128 символов с запасом покрывают любую разумную парольную фразу.
 */
const MAX_PASSWORD_LENGTH = 128;

/** Пароль короче этого не имеет смысла хешировать — отсекаем раньше. */
const MIN_PASSWORD_LENGTH = 8;

interface Argon2Params {
  memoryCost: number;
  timeCost: number;
  parallelism: number;
}

@Injectable()
export class PasswordService implements OnModuleInit {
  private readonly logger = new Logger(PasswordService.name);

  /**
   * Заранее посчитанный хеш для выравнивания времени ответа при
   * несуществующем пользователе. Считается один раз при старте.
   */
  private dummyHash = '';

  constructor(private readonly settings: SettingsService) {}

  async onModuleInit(): Promise<void> {
    const params = await this.currentParams();
    this.dummyHash = await hash('timing-equalization-placeholder', {
      ...params,
      algorithm: Algorithm.Argon2id,
    });
    this.logger.log(
      `Argon2id: m=${params.memoryCost} KiB, t=${params.timeCost}, p=${params.parallelism}`,
    );
  }

  async hashPassword(plain: string): Promise<{ hash: string; version: number }> {
    this.assertLength(plain);
    const params = await this.currentParams();

    return {
      hash: await hash(plain, { ...params, algorithm: Algorithm.Argon2id }),
      // Версия параметров хранится в users.password_version и позволяет
      // выбирать записи для фонового перехеширования запросом, не разбирая
      // строки хешей.
      version: await this.settings.getNumber('security.argon2.params_version', 1),
    };
  }

  /**
   * Проверка пароля.
   *
   * @param storedHash хеш из БД, либо null если пользователь не найден
   *                   или зарегистрирован только через OAuth
   */
  async verifyPassword(plain: string, storedHash: string | null): Promise<boolean> {
    // Слишком длинный пароль до Argon2 не доводим: проверка всё равно
    // не пройдёт, а ядро займётся на секунды.
    if (plain.length > MAX_PASSWORD_LENGTH) {
      await this.burnTime();
      return false;
    }

    if (!storedHash) {
      // Пользователя нет либо у него нет пароля. Отвечать сразу нельзя:
      // разница во времени ответа выдаёт, существует логин или нет,
      // и превращает форму входа в перечислитель пользователей.
      await this.burnTime();
      return false;
    }

    try {
      return await verify(storedHash, plain);
    } catch {
      // Повреждённый или неизвестного формата хеш. Считаем непройденной
      // проверкой, а не ошибкой сервера: иначе битая запись даёт 500
      // и подсказывает атакующему, что с этим аккаунтом что-то не так.
      return false;
    }
  }

  /**
   * Нужно ли пересчитать хеш текущими параметрами.
   *
   * Вызывается после УСПЕШНОЙ проверки: в этот момент открытый пароль
   * есть в руках, и можно пересчитать хеш усиленными параметрами, ничего
   * не спрашивая у пользователя.
   */
  async needsRehash(storedHash: string): Promise<boolean> {
    const embedded = this.parseParams(storedHash);
    if (!embedded) return true;

    const current = await this.currentParams();

    return (
      embedded.memoryCost !== current.memoryCost ||
      embedded.timeCost !== current.timeCost ||
      embedded.parallelism !== current.parallelism
    );
  }

  /** Пароль соответствует минимальным требованиям. */
  assertLength(plain: string): void {
    if (plain.length < MIN_PASSWORD_LENGTH) {
      throw new Error(`пароль короче ${MIN_PASSWORD_LENGTH} символов`);
    }
    if (plain.length > MAX_PASSWORD_LENGTH) {
      throw new Error(`пароль длиннее ${MAX_PASSWORD_LENGTH} символов`);
    }
  }

  /**
   * Разбор параметров из закодированного хеша.
   * Формат: $argon2id$v=19$m=65536,t=3,p=1$<соль>$<хеш>
   */
  private parseParams(encoded: string): Argon2Params | null {
    const match = /\$argon2id\$v=\d+\$m=(\d+),t=(\d+),p=(\d+)\$/.exec(encoded);
    if (!match) return null;

    return {
      memoryCost: Number(match[1]),
      timeCost: Number(match[2]),
      parallelism: Number(match[3]),
    };
  }

  private async currentParams(): Promise<Argon2Params> {
    return {
      memoryCost: await this.settings.getNumber('security.argon2.memory_kib', 65536),
      timeCost: await this.settings.getNumber('security.argon2.time_cost', 3),
      parallelism: await this.settings.getNumber('security.argon2.parallelism', 1),
    };
  }

  /**
   * Тратит примерно столько же времени, сколько настоящая проверка.
   *
   * Именно проверка заранее посчитанного хеша, а не sleep: sleep даёт
   * ровное время, отличимое от разброса реальной проверки, и по дисперсии
   * ответов эти два случая всё равно различаются.
   */
  private async burnTime(): Promise<void> {
    if (!this.dummyHash) return;
    try {
      await verify(this.dummyHash, 'wrong-password');
    } catch {
      // Результат не важен — важно потраченное время.
    }
  }
}
