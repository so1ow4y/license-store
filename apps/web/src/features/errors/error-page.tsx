import { useNavigate, useRouter } from '@tanstack/react-router'
import { useT } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'

type ErrorPageProps = {
  code?: string
  title: string
  description: React.ReactNode
  /** Компактный вид — когда экран рисуется внутри карточки, а не на всю страницу. */
  minimal?: boolean
  className?: string
  actions?: React.ReactNode
}

/** Общая рамка для всех экранов ошибок: один вид, разные тексты. */
export function ErrorPage({
  code,
  title,
  description,
  minimal = false,
  className,
  actions,
}: ErrorPageProps) {
  const navigate = useNavigate()
  const { history } = useRouter()
  const t = useT()

  return (
    <div className={cn(minimal ? 'w-full py-10' : 'h-svh w-full', className)}>
      <div className='m-auto flex h-full w-full flex-col items-center justify-center gap-2 px-4'>
        {code && !minimal && (
          <h1 className='text-[7rem] leading-tight font-bold text-primary'>
            {code}
          </h1>
        )}
        <span className='text-center font-medium'>{title}</span>
        <div className='max-w-md text-center text-sm text-muted-foreground'>
          {description}
        </div>
        <div className='mt-6 flex flex-wrap justify-center gap-3'>
          {actions ?? (
            <>
              <Button variant='outline' onClick={() => history.go(-1)}>
                {t('common.action.back')}
              </Button>
              <Button onClick={() => navigate({ to: '/' })}>
                {t('common.action.toAccount')}
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
