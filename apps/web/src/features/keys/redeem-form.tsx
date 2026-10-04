import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { CircleCheck, Info, LoaderCircle, TriangleAlert } from 'lucide-react'
import { ApiError } from '@/lib/api/client'
import { messageForCode } from '@/lib/api/error-codes'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { t, useT } from '@/lib/i18n'
import {
  LicenseKeyPanel,
  WhatHappensNext,
} from '@/features/activation/license-key-panel'
import {
  KEY_MAX_LENGTH,
  formatRegistrationKey,
  looksLikeRegistrationKey,
  redeemRegistrationKey,
  unexpectedKeyChars,
} from './api'

/**
 * Активация регистрационного ключа на существующем аккаунте.
 *
 * Ключ такой же оплаченный товар, как код покупки: его выдал администратор,
 * и человек рассчитывает получить доступ. Поэтому разбор
 * отказов здесь такой же подробный, как у Digiseller.
 */

type FailureView = {
  tone: 'error' | 'neutral'
  title: string
  body: string
  retry: boolean
}

/**
 * Коды и статусы — из `registration-key.service.ts`.
 *
 * Особенность: KEY_INVALID и KEY_EXPIRED сервер отдаёт со статусом 401
 * (UnauthorizedException, `:333` и `:341`), а не 400. Для UI это ничего
 * не меняет — ветвимся по `code`, — но объясняет, почему запрос может
 * занять заметно дольше обычного: слой `apiFetch` на 401 успевает обновить
 * токен и повторить запрос один раз.
 */
/**
 * Похоже ли введённое на НОМЕР ЛИЦЕНЗИИ, а не на ключ активации.
 *
 * Различие неочевидно снаружи: и то и другое — группы по четыре символа через
 * дефис. Но у номера лицензии впереди стоит код продукта (`FC26-…`, `GTA5-…`),
 * то есть групп пять, а у ключа активации — четыре.
 *
 * Проверять это приходится на клиенте: сервер видит только «такого ключа нет»
 * и честно так и отвечает. А человек в этот момент держит в руках номер своей
 * же лицензии, которая давно у него в кабинете, и универсальный совет
 * «сверьте символы» отправляет его искать опечатку там, где её нет.
 */
function looksLikeLicenseKey(value: string): boolean {
  return /^[A-Z][A-Z0-9]{2,7}(-[A-Z0-9]{4}){4}$/.test(value.trim().toUpperCase())
}

function describeFailure(error: unknown, entered: string): FailureView {
  // Проверяется РАНЬШЕ разбора кода ответа: сервер в обоих случаях отвечает
  // одинаково, и различить их может только тот, кто видел ввод.
  if (error instanceof ApiError && error.code === 'KEY_INVALID' && looksLikeLicenseKey(entered)) {
    return {
      tone: 'neutral',
      title: t('keys.redeem.error.licenseNumber.title'),
      body: t('keys.redeem.error.licenseNumber.body'),
      retry: false,
    }
  }

  if (!(error instanceof ApiError)) {
    return {
      tone: 'error',
      title: t('keys.redeem.error.unknown.title'),
      body: t('keys.redeem.error.unknown.body'),
      retry: true,
    }
  }

  switch (error.code) {
    case 'KEY_INVALID':
      return {
        tone: 'error',
        title: t('keys.redeem.error.invalid.title'),
        body: t('keys.redeem.error.invalid.body'),
        retry: false,
      }

    case 'KEY_EXPIRED':
      return {
        tone: 'error',
        title: t('keys.redeem.error.expired.title'),
        body: t('keys.redeem.error.expired.body'),
        retry: false,
      }

    case 'KEY_ALREADY_USED':
      return {
        tone: 'error',
        title: t('keys.redeem.error.alreadyUsed.title'),
        body: t('keys.redeem.error.alreadyUsed.body'),
        retry: false,
      }

    // Ключ БЕЗ продукта и тарифа. Важно: сервер отвечает так ДО погашения
    // (registration-key.service.ts:295-300) — ключ остаётся неиспользованным.
    // Поэтому «ключ активирован, но лицензии не содержит» было бы неправдой.
    case 'KEY_WITHOUT_LICENSE':
      return {
        tone: 'neutral',
        title: t('keys.redeem.error.withoutLicense.title'),
        body: t('keys.redeem.error.withoutLicense.body'),
        retry: false,
      }

    case 'BAD_REQUEST':
      return {
        tone: 'error',
        title: t('keys.redeem.error.badRequest.title'),
        // Сообщение валидатора приходит с сервера и остаётся русским: это
        // диагностика на случай, когда наш текст промахнулся мимо причины.
        body:
          error.validationMessages[0] ??
          t('keys.redeem.error.badRequest.body', { max: KEY_MAX_LENGTH }),
        retry: false,
      }

    case 'NETWORK_ERROR':
      return {
        tone: 'error',
        title: t('keys.redeem.error.network.title'),
        body: t('keys.redeem.error.network.body'),
        retry: true,
      }

    case 'RATE_LIMITED':
      return {
        tone: 'error',
        title: t('keys.redeem.error.rateLimited.title'),
        body: t('keys.redeem.error.rateLimited.body'),
        retry: true,
      }

    default:
      if (error.status >= 500) {
        return {
          tone: 'error',
          title: t('keys.redeem.error.serverError.title'),
          body: t('keys.redeem.error.serverError.body'),
          retry: true,
        }
      }
      // Код, который эта форма не разбирает поимённо, всё ещё может быть
      // в общем словаре кодов — спрашиваем его. Сообщение сервера уходит
      // туда же запасным вариантом: оно русское при любом языке интерфейса,
      // и показывать его стоит только когда словарь кода не знает.
      return {
        tone: 'error',
        title: t('keys.redeem.error.unknown.title'),
        body: messageForCode(error.code, error.message, error.details),
        retry: true,
      }
  }
}

export function RegistrationKeyRedeemForm() {
  const t = useT()
  const [input, setInput] = useState('')
  const queryClient = useQueryClient()

  const code = formatRegistrationKey(input)
  const wrongChars = unexpectedKeyChars(code)
  const shapeMatches = looksLikeRegistrationKey(code)

  const mutation = useMutation({
    mutationFn: (value: string) => redeemRegistrationKey(value),
    onSuccess: () => {
      // Появилась новая лицензия — список кабинета устарел. Ключ раздела
      // принадлежит куску K3, поэтому гасим по признаку, а не по угаданному
      // имени; сессию не трогаем, права от активации не меняются.
      void queryClient.invalidateQueries({
        predicate: (query) => query.queryKey[0] !== 'auth',
      })
    },
  })

  function onChange(value: string) {
    setInput(value)
    if (mutation.data || mutation.error) mutation.reset()
  }

  function onSubmit(event: React.FormEvent) {
    event.preventDefault()
    if (code.length === 0 || mutation.isPending) return
    mutation.mutate(code)
  }

  const failure = mutation.error ? describeFailure(mutation.error, code) : null

  if (mutation.data) {
    const { licenseKey } = mutation.data
    return (
      <div className='space-y-4'>
        <Alert>
          <CircleCheck className='size-4 text-emerald-600' />
          <AlertTitle>{t('keys.redeem.success.title')}</AlertTitle>
          <AlertDescription>
            {t('keys.redeem.success.description')}
          </AlertDescription>
        </Alert>
        {licenseKey ? (
          <LicenseKeyPanel licenseKey={licenseKey} />
        ) : (
          <p className='text-sm text-muted-foreground'>
            {t('keys.redeem.success.seeLicenses')}
          </p>
        )}
        {/* Письма при активации ключа на существующем аккаунте сервер
            не отправляет — в отличие от покупки. Обещать его нельзя. */}
        <WhatHappensNext emailed={false} />
      </div>
    )
  }

  return (
    <form onSubmit={onSubmit} className='space-y-4' noValidate>
      <div className='space-y-2'>
        <Label htmlFor='registration-key'>{t('keys.redeem.field.label')}</Label>
        <Input
          id='registration-key'
          value={code}
          onChange={(event) => onChange(event.target.value)}
          placeholder='ACDE-FGHJ-KMNP-QRTU'
          autoComplete='off'
          autoCapitalize='characters'
          autoCorrect='off'
          spellCheck={false}
          maxLength={KEY_MAX_LENGTH}
          className='font-mono tracking-wider uppercase'
          aria-describedby='registration-key-hint'
          disabled={mutation.isPending}
        />
        <p id='registration-key-hint' className='text-xs text-muted-foreground'>
          {t('keys.redeem.field.hint')}
        </p>

        {/* Подсказки, а не запреты. Отправку не блокируем: сервер принимает
            любую непустую строку до 64 символов, и заблокировать ключ
            нестандартного вида дороже, чем один лишний запрос. */}
        {wrongChars.length > 0 && (
          <p className='text-xs text-destructive'>
            {/* Число символов правит форму фразы, поэтому склейка «Символ» +
                «ы» уехала в словарь: в английском там меняется и глагол. */}
            {t('keys.redeem.field.wrongChars', {
              count: wrongChars.length,
              chars: wrongChars.join(', '),
            })}
          </p>
        )}
        {code.length > 0 && wrongChars.length === 0 && !shapeMatches && (
          <p className='text-xs text-muted-foreground'>
            {t('keys.redeem.field.shapeHint')}
          </p>
        )}
      </div>

      {failure && (
        <Alert variant={failure.tone === 'error' ? 'destructive' : 'default'}>
          {failure.tone === 'error' ? (
            <TriangleAlert className='size-4' />
          ) : (
            <Info className='size-4' />
          )}
          <AlertTitle>{failure.title}</AlertTitle>
          <AlertDescription>{failure.body}</AlertDescription>
        </Alert>
      )}

      <div className='flex flex-wrap items-center gap-2'>
        <Button
          type='submit'
          disabled={code.length === 0 || mutation.isPending}
        >
          {mutation.isPending && (
            <LoaderCircle className='size-4 animate-spin' />
          )}
          {t('keys.redeem.action.submit')}
        </Button>
        {failure?.retry && !mutation.isPending && (
          <Button
            type='button'
            variant='outline'
            onClick={() => mutation.mutate(code)}
          >
            {t('common.action.retry')}
          </Button>
        )}
      </div>
    </form>
  )
}
