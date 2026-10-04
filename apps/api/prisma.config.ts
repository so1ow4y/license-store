import { config as loadEnv } from 'dotenv';
import { defineConfig } from 'prisma/config';
import path from 'node:path';

// .env лежит в корне монорепы, а не рядом со схемой: одни и те же креды
// нужны и docker-compose, и API, и фронту. Дублировать их по папкам — способ
// однажды поймать расхождение между тем, что поднял Docker, и тем, куда
// подключается Prisma.
loadEnv({ path: path.resolve(__dirname, '../../.env') });

export default defineConfig({
  schema: path.join('prisma', 'schema.prisma'),
  migrations: {
    path: path.join('prisma', 'migrations'),
    seed: 'tsx prisma/seed.ts',
  },
});
