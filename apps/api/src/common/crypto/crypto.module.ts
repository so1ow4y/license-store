import { Global, Module } from '@nestjs/common';

import { CryptoService } from './crypto.service';
import { PasswordService } from './password.service';
import { SignatureService } from './signature.service';

/**
 * Криптографический фундамент.
 *
 * SettingsModule здесь НЕ импортируется намеренно, хотя PasswordService
 * и SignatureService зависят от SettingsService. Зависимость взаимная:
 * сервису настроек нужен CryptoService для расшифровки секретных значений.
 * Импорт в обе стороны дал бы цикл на уровне файлов, который в Nest
 * лечится forwardRef — а это лишняя косвенность там, где её можно
 * не создавать.
 *
 * Оба модуля объявлены глобальными и подключаются в AppModule напрямую,
 * поэтому DI разрешает зависимости без взаимных импортов.
 */
@Global()
@Module({
  providers: [CryptoService, PasswordService, SignatureService],
  exports: [CryptoService, PasswordService, SignatureService],
})
export class CryptoModule {}
