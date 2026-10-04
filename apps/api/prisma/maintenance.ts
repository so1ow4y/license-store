/**
 * Обслуживание партиций журнальных таблиц.
 *
 * Создаёт партиции на N месяцев вперёд и удаляет старше ретенции.
 * Запуск:  npm run db:partitions
 *
 * В проде это же вызывается планировщиком приложения раз в сутки.
 * Отдельным скриптом — чтобы можно было дёрнуть руками, если крон
 * пропустил окно, не поднимая всё приложение.
 */
import { config as loadEnv } from 'dotenv';
import path from 'node:path';

// Скрипт запускается напрямую через tsx, минуя CLI Prisma, поэтому
// prisma.config.ts здесь не применяется и .env надо загрузить самим.
loadEnv({ path: path.resolve(__dirname, '../../../.env') });

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const MONTHS_AHEAD = Number(process.env.PARTITION_MONTHS_AHEAD ?? 3);
const AUDIT_RETENTION = Number(process.env.AUDIT_LOG_RETENTION_DAYS ?? 90);
const LOGIN_RETENTION = Number(process.env.LOGIN_HISTORY_RETENTION_DAYS ?? 90);

async function main() {
  const dryRun = process.argv.includes('--dry-run');

  console.log(`создание партиций на ${MONTHS_AHEAD} мес. вперёд...`);
  if (!dryRun) {
    // ::int обязателен — Prisma отправляет JS-число как bigint, а функция
    // объявлена с INT, и Postgres не находит подходящую сигнатуру.
    await prisma.$executeRawUnsafe(`SELECT create_monthly_partitions($1::int)`, MONTHS_AHEAD);
  }

  // Обе таблицы чистятся одной функцией, поэтому берём меньшую из ретенций —
  // иначе более длинная молча укоротила бы вторую таблицу.
  const retention = Math.min(AUDIT_RETENTION, LOGIN_RETENTION);
  if (AUDIT_RETENTION !== LOGIN_RETENTION) {
    console.warn(
      `ретенция различается (audit=${AUDIT_RETENTION}, login=${LOGIN_RETENTION}), ` +
        `используется минимальная: ${retention} дн.`,
    );
  }

  console.log(`удаление партиций старше ${retention} дн....`);
  if (!dryRun) {
    await prisma.$executeRawUnsafe(`SELECT drop_old_partitions($1::int)`, retention);
  }

  const partitions = await prisma.$queryRawUnsafe<
    Array<{ parent: string; partition: string; size: string }>
  >(`
    SELECT parent.relname AS parent,
           child.relname  AS partition,
           pg_size_pretty(pg_total_relation_size(child.oid)) AS size
    FROM pg_inherits i
    JOIN pg_class child  ON child.oid  = i.inhrelid
    JOIN pg_class parent ON parent.oid = i.inhparent
    WHERE child.relkind = 'r'
    ORDER BY 1, 2
  `);

  console.table(partitions);
  console.log(dryRun ? '\n(dry-run, изменений не внесено)' : '\n✓ готово');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
