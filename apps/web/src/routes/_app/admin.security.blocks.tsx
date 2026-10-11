import { createFileRoute, redirect } from '@tanstack/react-router'
import { hasAny, PERMISSIONS } from '@/lib/auth/permissions'
import { useT } from '@/lib/i18n'
import { AdminPageHeader } from '@/features/admin/page-header'
import { BlocksPanel } from '@/features/admin-security/blocks-panel'

/** Блокировки адресов по уровням (фаервол, nginx, приложение) и аккаунтов по логину. */
export const Route = createFileRoute('/_app/admin/security/blocks')({
  beforeLoad: ({ context }) => {
    if (!hasAny(context.me.permissions, [PERMISSIONS.SECURITY_IP_BLOCK, PERMISSIONS.USERS_BLOCK])) throw redirect({ to: '/403' })
  },
  component: BlocksPage,
})

function BlocksPage() {
  const t = useT()
  return (
    <div className='space-y-6'>
      <AdminPageHeader title={t('sec.page.blocks')} description={t('sec.page.blocks.hint')} />
      <BlocksPanel />
    </div>
  )
}
