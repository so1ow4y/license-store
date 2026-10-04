import { Global, Module } from '@nestjs/common';

import { ENV, getValidatedEnv } from './env.schema';

/**
 * Отдаёт провалидированное окружение как типизированный провайдер.
 *
 * Подключается в AppModule СТРОГО после ConfigModule.forRoot: фабрика
 * читает результат валидации, которую выполняет ConfigModule. Если порядок
 * нарушить, приложение упадёт при старте с внятным сообщением, а не будет
 * молча работать с пустой конфигурацией.
 */
@Global()
@Module({
  providers: [{ provide: ENV, useFactory: getValidatedEnv }],
  exports: [ENV],
})
export class EnvModule {}
