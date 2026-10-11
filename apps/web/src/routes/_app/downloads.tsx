import { createFileRoute } from '@tanstack/react-router'
import { LauncherDownloadPage } from '@/features/launcher/launcher-page'

/** Загрузчик в кабинете: скачать последнюю доступную версию, бету и прошлые. */
export const Route = createFileRoute('/_app/downloads')({
  component: LauncherDownloadPage,
})
