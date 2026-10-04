import path from 'node:path'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { tanstackRouter } from '@tanstack/router-plugin/vite'

export default defineConfig(({ mode }) => {
  // Куда dev-сервер проксирует бэкенд.
  //
  // Значение берётся из .env-файлов Vite, а не из переменной окружения:
  // на Windows задать её перед командой нечем без отдельной зависимости,
  // а .env.development.local в репозиторий не попадает — у каждого свой.
  const env = loadEnv(mode, import.meta.dirname, '')
  const target = env.LP_PROXY_TARGET || 'http://localhost:3000'

  return {
    plugins: [
      // Роутинг файловый: дерево маршрутов генерируется из src/routes,
      // поэтому параллельные куски работы (K1..K6) не дерутся за общий конфиг.
      tanstackRouter({ target: 'react', autoCodeSplitting: true }),
      react(),
      tailwindcss(),
    ],
    resolve: {
      alias: { '@': path.resolve(import.meta.dirname, './src') },
    },
    server: {
      // Порт зафиксирован: локальный сервер разрешает CORS строго для
      // http://localhost:5173, на другом порту браузер отрезал бы запросы.
      port: 5173,
      strictPort: true,

      // Прокси на бэкенд. Браузер обращается к своему же адресу
      // (localhost:5173/api/...), поэтому запрос не становится межсайтовым
      // и CORS не участвует ВООБЩЕ.
      //
      // Зачем, если CORS и так настроен на localhost:5173: настроен он только
      // у локального сервера. У боевого разрешённый источник — его собственный
      // адрес, и фронт с localhost туда не достучался бы. Прокси убирает выбор
      // «или локальный бэкенд, или правка CORS в бою».
      //
      //   .env.development.local → LP_PROXY_TARGET=http://77.221.154.85
      //
      // В бою прокси не участвует: фронт раздаётся тем же nginx, что и API,
      // источник и так один — поэтому VITE_API_URL везде относительный.
      proxy: {
        '/api': { target, changeOrigin: true },
        '/health': { target, changeOrigin: true },
      },
    },
  }
})
