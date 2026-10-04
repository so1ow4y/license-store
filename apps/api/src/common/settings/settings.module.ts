import { Global, Module } from '@nestjs/common';

import { SettingsService } from './settings.service';

/**
 * Настройки платформы.
 *
 * CryptoModule здесь не импортируется — см. комментарий в crypto.module.ts:
 * оба модуля глобальные и подключаются в AppModule, чем и разрывается
 * взаимная зависимость.
 */
@Global()
@Module({
  providers: [SettingsService],
  exports: [SettingsService],
})
export class SettingsModule {}
