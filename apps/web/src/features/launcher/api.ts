import { queryOptions, useMutation } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api/client'
import { queryClient } from '@/lib/api/query-client'

/**
 * Клиент-загрузчик (`distribution.controller.ts`): публичные релизы для
 * главной, доступные пользователю версии в кабинете и управление релизами.
 * Скачивание — всегда через API: он проверяет доступ и выдаёт ссылку на
 * пять минут, постоянного адреса у файла нет.
 */

export type LauncherPlatform = 'WINDOWS' | 'LINUX' | 'MACOS'
export const LAUNCHER_PLATFORMS: LauncherPlatform[] = ['WINDOWS', 'LINUX', 'MACOS']
export type LauncherChannel = 'STABLE' | 'BETA'
export type LauncherAudience = 'PUBLIC' | 'USERS' | 'LICENSED' | 'ROLES'
export const LAUNCHER_AUDIENCES: LauncherAudience[] = ['PUBLIC', 'USERS', 'LICENSED', 'ROLES']

export type LauncherRelease = {
  id: string
  version: string
  platform: LauncherPlatform
  channel: LauncherChannel
  notes: string | null
  audience: LauncherAudience
  isMandatory: boolean
  publishedAt: string | null
  fileName: string | null
  sha256: string | null
  fileSize: number | string | null
}

export type LauncherPage = { requirements: string; steps: string }

export type AdminLauncherRelease = LauncherRelease & {
  roles: string[]
  isPublished: boolean
  downloads: number
  createdAt: string
  createdByUsername: string | null
}

export const publicLauncherQueryOptions = () =>
  queryOptions({
    queryKey: ['launcher', 'public'],
    queryFn: () => apiFetch<{ releases: LauncherRelease[]; page: LauncherPage }>('/downloads/launcher/public', { anonymous: true }),
    staleTime: 5 * 60_000,
  })

export const myLauncherQueryOptions = () =>
  queryOptions({
    queryKey: ['launcher', 'mine'],
    queryFn: () =>
      apiFetch<{ latest: LauncherRelease[]; history: LauncherRelease[]; page: LauncherPage; licensed: boolean }>('/downloads/launcher'),
  })

type DownloadLink = { url: string; fileName: string; sha256: string | null; size: number | string | null }

/**
 * Скачать: API выдаёт ссылку, браузер уходит по ней. Атрибут attachment
 * у ответа хранилища оставляет пользователя на странице.
 */
export function useDownloadLauncher() {
  return useMutation({
    mutationFn: ({ id, guest }: { id: string; guest?: boolean }) =>
      guest
        ? apiFetch<DownloadLink>(`/downloads/launcher/${encodeURIComponent(id)}/public`, { method: 'POST', anonymous: true })
        : apiFetch<DownloadLink>(`/downloads/launcher/${encodeURIComponent(id)}`, { method: 'POST' }),
    onSuccess: (link) => {
      window.location.assign(link.url)
      void queryClient.invalidateQueries({ queryKey: ['admin', 'launcher'] })
    },
  })
}

/** Платформа посетителя по User-Agent — чтобы первой предложить нужную сборку. */
export function detectPlatform(): LauncherPlatform {
  const ua = typeof navigator === 'undefined' ? '' : navigator.userAgent
  if (/Mac OS X|Macintosh/.test(ua) && !/iPhone|iPad/.test(ua)) return 'MACOS'
  if (/Linux/.test(ua) && !/Android/.test(ua)) return 'LINUX'
  return 'WINDOWS'
}

export function formatSize(value: number | string | null | undefined): string {
  const bytes = Number(value ?? 0)
  if (!bytes) return '—'
  const units = ['Б', 'КБ', 'МБ', 'ГБ']
  let size = bytes
  let unit = 0
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024
    unit++
  }
  return `${size.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`
}

// ---------------------------------------------------------------- админка

const ADMIN_KEY = ['admin', 'launcher'] as const

export const adminLauncherQueryOptions = () =>
  queryOptions({
    queryKey: ADMIN_KEY,
    queryFn: () => apiFetch<{ releases: AdminLauncherRelease[]; page: LauncherPage }>('/admin/launcher/releases'),
  })

function invalidateAdmin() {
  void queryClient.invalidateQueries({ queryKey: ADMIN_KEY })
  void queryClient.invalidateQueries({ queryKey: ['launcher'] })
}

export type ReleaseInput = {
  version: string
  platform: LauncherPlatform
  channel: LauncherChannel
  notes: string
  audience: LauncherAudience
  roles: string[]
  isMandatory: boolean
}

export function useSaveRelease() {
  return useMutation({
    mutationFn: ({ id, ...body }: Partial<ReleaseInput> & { id?: string }) =>
      id
        ? apiFetch<AdminLauncherRelease>(`/admin/launcher/releases/${encodeURIComponent(id)}`, { method: 'PATCH', body })
        : apiFetch<AdminLauncherRelease>('/admin/launcher/releases', { method: 'POST', body }),
    onSuccess: invalidateAdmin,
  })
}

export function usePublishRelease() {
  return useMutation({
    mutationFn: ({ id, publish }: { id: string; publish: boolean }) =>
      apiFetch<AdminLauncherRelease>(`/admin/launcher/releases/${encodeURIComponent(id)}/${publish ? 'publish' : 'unpublish'}`, { method: 'POST' }),
    onSuccess: invalidateAdmin,
  })
}

export function useDeleteRelease() {
  return useMutation({
    mutationFn: (id: string) => apiFetch<void>(`/admin/launcher/releases/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    onSuccess: invalidateAdmin,
  })
}

export function useUpdateLauncherPage() {
  return useMutation({
    mutationFn: (body: Partial<LauncherPage>) => apiFetch<LauncherPage>('/admin/launcher/page', { method: 'PATCH', body }),
    onSuccess: invalidateAdmin,
  })
}

/** PUT в хранилище через XHR: у fetch нет прогресса отправки. */
function putWithProgress(url: string, file: File, onProgress: (ratio: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('PUT', url)
    xhr.setRequestHeader('Content-Type', 'application/octet-stream')
    xhr.upload.onprogress = (event) => event.lengthComputable && onProgress(event.loaded / event.total)
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`upload failed: HTTP ${xhr.status}`)))
    xhr.onerror = () => reject(new Error('upload failed: network error'))
    xhr.send(file)
  })
}

/** Ссылка → PUT прямо в хранилище → подтверждение (SHA-256 считает сервер). */
export function useUploadRelease() {
  return useMutation({
    mutationFn: async ({ id, file, onProgress }: { id: string; file: File; onProgress: (ratio: number) => void }) => {
      const target = await apiFetch<{ uploadUrl: string; objectKey: string }>(`/admin/launcher/releases/${encodeURIComponent(id)}/upload-url`, {
        method: 'POST',
        body: { filename: file.name, contentType: 'application/octet-stream' },
      })
      await putWithProgress(target.uploadUrl, file, onProgress)
      return apiFetch<AdminLauncherRelease>(`/admin/launcher/releases/${encodeURIComponent(id)}/confirm-upload`, {
        method: 'POST',
        body: { objectKey: target.objectKey },
      })
    },
    onSuccess: invalidateAdmin,
  })
}
