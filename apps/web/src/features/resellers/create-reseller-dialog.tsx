import { useEffect, useRef, useState } from 'react'
import { useInfiniteQuery } from '@tanstack/react-query'
import { ChevronDown, Loader2, UserCheck } from 'lucide-react'
import { toast } from 'sonner'
import { apiFetch } from '@/lib/api/client'
import { useSession } from '@/lib/auth/session'
import { useT } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { AdminErrorText } from '@/features/admin/error-text'
import { FormProblems } from '@/features/admin/form-problems'
import { useCreateReseller, type Page, type ResellerCandidate } from './api'
import { TermsFields, termsInput, termsProblems, useTermsState } from './terms-fields'

/** Пауза в наборе, после которой раскрываются подсказки. */
const IDLE_MS = 450
const PAGE = 30

/**
 * Новый реселлер — существующий аккаунт. Логин подсказывается: стоит
 * остановиться в наборе (или просто встать в поле) — раскрывается список
 * аккаунтов, который подгружается при прокрутке. Уже реселлеры видны, но не
 * выбираются. Администратор может сделать реселлером и себя.
 */
export function CreateResellerDialog({
  open,
  onOpenChange,
  username: presetUsername,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Логин, подставленный заранее (например, из карточки пользователя). */
  username?: string
  onCreated?: (id: string) => void
}) {
  const t = useT()
  const { me } = useSession()
  const create = useCreateReseller()
  const terms = useTermsState()
  const [username, setUsername] = useState('')

  useEffect(() => {
    if (!open) return
    create.reset()
    terms.reset()
    setUsername(presetUsername ?? '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, presetUsername])

  const problems = [!username.trim() && t('resellers.problem.username'), ...termsProblems(terms, t)]
  const valid = problems.every((p) => !p)

  function onSubmit(event: React.FormEvent) {
    event.preventDefault()
    if (!valid) return
    create.mutate(
      { ...termsInput(terms), username: username.trim() },
      {
        onSuccess: (reseller) => {
          toast.success(t('admin.saved'))
          onOpenChange(false)
          onCreated?.(reseller.id)
        },
      }
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className='max-h-[90vh] overflow-y-auto sm:max-w-xl'
        // Esc при раскрытых подсказках закрывает список, а не весь диалог.
        onEscapeKeyDown={(e) => {
          if (document.getElementById('rs-user-list') || (e as KeyboardEvent & { comboHandled?: boolean }).comboHandled) {
            e.preventDefault()
          }
        }}
      >
        <form onSubmit={onSubmit} className='space-y-4'>
          <DialogHeader>
            <DialogTitle>{t('resellers.admin.create')}</DialogTitle>
            <DialogDescription>{t('resellers.admin.createHint')}</DialogDescription>
          </DialogHeader>

          <div className='space-y-2'>
            <Label htmlFor='rs-user'>{t('resellers.field.username')}</Label>
            <UsernameCombobox value={username} onChange={setUsername} selfId={me?.id} />
            <div className='flex flex-wrap items-center justify-between gap-2'>
              <p className='text-xs text-muted-foreground'>{t('resellers.field.usernameHint')}</p>
              {me && username !== me.username && (
                <Button
                  type='button'
                  size='sm'
                  variant='ghost'
                  className='h-7 text-xs'
                  onClick={() => {
                    setUsername(me.username)
                    if (!terms.displayName.trim()) terms.setDisplayName(me.username)
                  }}
                >
                  <UserCheck className='size-3.5' />
                  {t('resellers.admin.makeSelf')}
                </Button>
              )}
            </div>
          </div>

          <TermsFields state={terms} />

          <FormProblems problems={problems} />
          <AdminErrorText error={create.error} />
          <DialogFooter>
            <Button type='button' variant='outline' onClick={() => onOpenChange(false)}>
              {t('common.action.cancel')}
            </Button>
            <Button type='submit' disabled={!valid || create.isPending}>
              {t('common.action.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/**
 * Поле логина с подсказками: список раскрывается после паузы в наборе или
 * по стрелке, фильтруется по введённому и догружается при прокрутке вниз.
 * Стрелки и Enter выбирают, Esc закрывает.
 */
function UsernameCombobox({ value, onChange, selfId }: { value: string; onChange: (value: string) => void; selfId?: string }) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState(value)
  const [highlight, setHighlight] = useState(-1)
  const idle = useRef<number | undefined>(undefined)
  const listRef = useRef<HTMLUListElement>(null)
  const boxRef = useRef<HTMLDivElement>(null)

  const query = useInfiniteQuery({
    queryKey: ['admin', 'resellers', 'candidates', 'infinite', search.trim()],
    queryFn: ({ pageParam, signal }) => {
      const params = new URLSearchParams({ skip: String(pageParam), take: String(PAGE) })
      if (search.trim()) params.set('search', search.trim())
      return apiFetch<Page<ResellerCandidate>>(`/admin/resellers/candidates?${params}`, { signal })
    },
    initialPageParam: 0,
    getNextPageParam: (last) => (last.skip + last.take < last.total ? last.skip + last.take : undefined),
    enabled: open,
    staleTime: 30_000,
  })
  const items = query.data?.pages.flatMap((p) => p.items) ?? []
  const total = query.data?.pages[0]?.total ?? 0

  useEffect(() => () => window.clearTimeout(idle.current), [])

  // Клик вне поля и списка закрывает подсказки.
  useEffect(() => {
    if (!open) return
    const onDown = (event: PointerEvent) => {
      if (!boxRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', onDown)
    return () => document.removeEventListener('pointerdown', onDown)
  }, [open])

  /** Подсказки раскрываются, когда человек остановился, а не на каждую букву. */
  function waitThenOpen(next: string) {
    window.clearTimeout(idle.current)
    idle.current = window.setTimeout(() => {
      setSearch(next)
      setHighlight(-1)
      setOpen(true)
    }, IDLE_MS)
  }

  function pick(candidate: ResellerCandidate) {
    if (candidate.isReseller) return
    onChange(candidate.username)
    setSearch(candidate.username)
    setOpen(false)
  }

  function onScroll(event: React.UIEvent<HTMLUListElement>) {
    const el = event.currentTarget
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 48 && query.hasNextPage && !query.isFetchingNextPage) {
      void query.fetchNextPage()
    }
  }

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      if (!open) {
        setSearch(value)
        setOpen(true)
        return
      }
      setHighlight((h) => Math.min(items.length - 1, h + 1))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setHighlight((h) => Math.max(0, h - 1))
    } else if (event.key === 'Enter' && open && highlight >= 0 && items[highlight]) {
      event.preventDefault()
      pick(items[highlight]!)
    } else if (event.key === 'Escape' && open) {
      // Помечаем событие: диалог увидит, что Esc уже потрачен на список.
      ;(event.nativeEvent as KeyboardEvent & { comboHandled?: boolean }).comboHandled = true
      setOpen(false)
    }
  }

  useEffect(() => {
    if (highlight < 0) return
    listRef.current?.querySelector(`[data-index="${highlight}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [highlight])

  return (
    <div ref={boxRef} className='relative'>
      <div className='relative'>
        <Input
          id='rs-user'
          value={value}
          autoComplete='off'
          placeholder='partner42'
          role='combobox'
          aria-expanded={open}
          aria-controls='rs-user-list'
          className='pr-9'
          onFocus={() => waitThenOpen(value)}
          onChange={(e) => {
            onChange(e.target.value)
            setOpen(false)
            waitThenOpen(e.target.value)
          }}
          onKeyDown={onKeyDown}
        />
        <button
          type='button'
          tabIndex={-1}
          aria-label={t('resellers.candidates.show')}
          onClick={() => {
            setSearch(value)
            setOpen(!open)
          }}
          className='absolute inset-y-0 right-0 flex w-9 items-center justify-center text-muted-foreground hover:text-foreground'
        >
          <ChevronDown className={cn('size-4 transition-transform', open && 'rotate-180')} />
        </button>
      </div>

      {open && (
        <div className='absolute inset-x-0 top-full z-50 mt-1 overflow-hidden rounded-md border bg-popover shadow-lg animate-in fade-in-0 zoom-in-95'>
          <div className='flex items-center justify-between border-b px-3 py-1.5 text-[11px] text-muted-foreground'>
            <span>{search.trim() ? t('resellers.candidates.matching', { search: search.trim() }) : t('resellers.candidates.all')}</span>
            {query.data && <span>{t('resellers.candidates.count', { count: total })}</span>}
          </div>
          <ul id='rs-user-list' role='listbox' ref={listRef} onScroll={onScroll} className='max-h-64 overflow-y-auto py-1'>
            {query.isPending && (
              <li className='flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground'>
                <Loader2 className='size-4 animate-spin' />
                {t('common.state.loading')}
              </li>
            )}
            {query.isSuccess && items.length === 0 && (
              <li className='px-3 py-2 text-sm text-muted-foreground'>{t('resellers.candidates.none')}</li>
            )}
            {items.map((candidate, index) => (
              <li
                key={candidate.id}
                data-index={index}
                role='option'
                aria-selected={highlight === index}
                aria-disabled={candidate.isReseller}
                onPointerDown={(e) => e.preventDefault()}
                onClick={() => pick(candidate)}
                onMouseEnter={() => setHighlight(index)}
                className={cn(
                  'flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm',
                  highlight === index && 'bg-accent',
                  candidate.isReseller && 'cursor-not-allowed opacity-50'
                )}
              >
                <span className='min-w-0 flex-1'>
                  <span className='block truncate font-medium'>{candidate.username}</span>
                  {candidate.email && <span className='block truncate text-xs text-muted-foreground'>{candidate.email}</span>}
                </span>
                {candidate.id === selfId && <Badge variant='default'>{t('resellers.candidates.you')}</Badge>}
                {candidate.isReseller ? (
                  <Badge variant='secondary'>{t('resellers.candidates.already')}</Badge>
                ) : (
                  candidate.role && <Badge variant='outline'>{candidate.role}</Badge>
                )}
              </li>
            ))}
            {query.isFetchingNextPage && (
              <li className='flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground'>
                <Loader2 className='size-3.5 animate-spin' />
                {t('common.state.loading')}
              </li>
            )}
          </ul>
        </div>
      )}
    </div>
  )
}
