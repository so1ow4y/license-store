import { createFileRoute, Outlet } from '@tanstack/react-router'
import { useT } from '@/lib/i18n'
import { SettingsNav } from '@/features/settings/settings-nav'

/** Окно настроек: дерево разделов слева (сверху на телефоне), раздел справа. */
export const Route = createFileRoute('/_app/settings')({
  component: SettingsLayout,
})

function SettingsLayout() {
  const t = useT()
  return (
    <div className='mx-auto w-full max-w-6xl space-y-6'>
      <h1 className='text-2xl font-semibold'>{t('settings.title')}</h1>
      <div className='flex flex-col gap-6 lg:flex-row lg:items-start'>
        <SettingsNav className='lg:sticky lg:top-6 lg:w-64 lg:shrink-0' />
        <div className='min-w-0 flex-1'>
          <Outlet />
        </div>
      </div>
    </div>
  )
}
