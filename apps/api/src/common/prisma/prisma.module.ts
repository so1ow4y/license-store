import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

/**
 * Глобальный: PrismaService нужен почти каждому модулю, и импортировать
 * PrismaModule в десяток мест — шум без пользы. Это одно из немногих
 * оправданных применений @Global — инфраструктурный сервис без состояния,
 * который не создаёт скрытых связей между доменными модулями.
 */
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
