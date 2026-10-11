import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { CircleCheck, Clock, Info, LoaderCircle, TriangleAlert } from 'lucide-react'
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
  DIGISELLER_CODE_LENGTH,
  DIGISELLER_CODE_RE,
  normalizeDigisellerCode,
  redeemDigisellerCode,
} from './api'

/**
 * Форма погашения кода покупки Digiseller.
 *
 * Экран стоит на единственном денежном пути платформы, поэтому здесь нет
 * «что-то пошло не так»: каждый исход сервера разобран отдельно и говорит,
 * что человеку делать дальше. Особенно важны два исхода, которые выглядят
 * как ошибка, но ею не являются — ALREADY_YOURS и PRODUCT_NOT_MAPPED.
 */

type FailureTone = 'error' | 'neutral'

type FailureView = {
  tone: FailureTone
  title: string
  body: string
  /** Имеет ли смысл повторить тот же код той же кнопкой. */
  retry: boolean
}

/**
 * Разбор отказа сервера. Ветвление строго по `code`: тексты сервера меняются,
 * коды — часть контракта.
 *
 * Коды и статусы взяты из `digiseller.service.ts`, а не из плана.
 */
function describeFailure(error: unknown): FailureView {
  if (!(error instanceof ApiError)) {
    return {
      tone: 'error',
      title: t('billing.code.error.unknown.title'),
      body: t('billing.code.error.unknown.body'),
      retry: true,
    }
  }

  switch (error.code) {
    case 'CODE_MALFORMED':
      return {
        tone: 'error',
        title: t('billing.code.error.malformed.title'),
        body: t('billing.code.error.malformed.body', {
          length: DIGISELLER_CODE_LENGTH,
        }),
        retry: false,
      }

    // Площадка не подтвердила код. Терминальным этот ответ НЕ является:
    // у метода проверки задокументирован ровно один retval, и сервер
    // сознательно не говорит «такого кода нет» (digiseller.service.ts:129-141).
    // Значит и мы не имеем права объявлять покупку несуществующей.
    case 'CODE_NOT_ACCEPTED':
      return {
        tone: 'error',
        title: t('billing.code.error.notAccepted.title'),
        body: t('billing.code.error.notAccepted.body'),
        retry: true,
      }

    // Счётчик попыток: лимит по умолчанию 30 в час на пользователя
    // (digiseller.service.ts:547, окно ATTEMPT_WINDOW_SEC = 3600).
    case 'TOO_MANY_ATTEMPTS':
      return {
        tone: 'error',
        title: t('billing.code.error.tooManyAttempts.title'),
        body: t('billing.code.error.tooManyAttempts.body'),
        retry: false,
      }

    case 'CODE_ALREADY_USED':
      return {
        tone: 'error',
        title: t('billing.code.error.alreadyUsed.title'),
        body: t('billing.code.error.alreadyUsed.body'),
        retry: false,
      }

    // Деньги у площадки, покупка подтверждена, а тариф под товар ещё не заведён.
    // Сервер уже записал сделку и показал её администратору
    // (digiseller.service.ts:152-161). Это ошибка владельца платформы,
    // а не покупателя, — красный цвет и слово «ошибка» здесь запрещены.
    case 'PRODUCT_NOT_MAPPED':
      return {
        tone: 'neutral',
        title: t('billing.code.error.notMapped.title'),
        body: t('billing.code.error.notMapped.body'),
        retry: false,
      }

    case 'PROVIDER_UNAVAILABLE':
      return {
        tone: 'error',
        title: t('billing.code.error.providerUnavailable.title'),
        body: t('billing.code.error.providerUnavailable.body'),
        retry: true,
      }

    // Валидация DTO: ValidationPipe отдаёт details[] и код BAD_REQUEST —
    // собственного кода у неё нет (all-exceptions.filter.ts:105).
    case 'BAD_REQUEST':
      return {
        tone: 'error',
        title: t('billing.code.error.badRequest.title'),
        // Сообщение валидатора приходит с сервера и остаётся русским: это
        // диагностика на случай, когда наш текст промахнулся мимо причины.
        body:
          error.validationMessages[0] ??
          t('billing.code.error.badRequest.body', {
            length: DIGISELLER_CODE_LENGTH,
          }),
        retry: false,
      }

    case 'NETWORK_ERROR':
      return {
        tone: 'error',
        title: t('billing.code.error.network.title'),
        body: t('billing.code.error.network.body'),
        retry: true,
      }

    // 429 приходит с кодом RATE_LIMITED (all-exceptions.filter.ts:204).
    case 'RATE_LIMITED':
      return {
        tone: 'error',
        title: t('billing.code.error.rateLimited.title'),
        body: t('billing.code.error.rateLimited.body'),
        retry: true,
      }

    default:
      if (error.status >= 500) {
        return {
          tone: 'error',
          title: t('billing.code.error.serverError.title'),
          body: t('billing.code.error.serverError.body'),
          retry: true,
        }
      }
      // Код, который эта форма не разбирает поимённо, всё ещё может быть
      // в общем словаре кодов — спрашиваем его. Сообщение сервера уходит
      // туда же запасным вариантом: оно русское при любом языке интерфейса,
      // и показывать его стоит только когда словарь кода не знает.
      return {
        tone: 'error',
        title: t('billing.code.error.unknown.title'),
        body: messageForCode(error.code, error.message, error.details),
        retry: true,
      }
  }
}

export function DigisellerRedeemForm() {
  const t = useT()
  const [input, setInput] = useState('')
  const queryClient = useQueryClient()

  const code = normalizeDigisellerCode(input)
  const isComplete = DIGISELLER_CODE_RE.test(code)

  const mutation = useMutation({
    mutationFn: (value: string) => redeemDigisellerCode(value),
    onSuccess: () => {
      // Список лицензий устарел: появилась новая. Ключ раздела принадлежит
      // куску K3, поэтому не зашиваем его строкой — угаданный ключ дал бы
      // молчаливо устаревший список. Гасим всё, кроме сессии: перечитывать
      // /auth/me незачем, права от покупки не меняются.
      void queryClient.invalidateQueries({
        predicate: (query) => query.queryKey[0] !== 'auth',
      })
    },
  })

  function onChange(value: string) {
    setInput(value)
    // Прошлый результат относится к прошлому коду. Оставить его под новым
    // вводом — прямой способ заставить человека дважды заплатить: он увидит
    // старое «уже активировано» и решит, что ввод не нужен.
    if (mutation.data || mutation.error) mutation.reset()
  }

  function onSubmit(event: React.FormEvent) {
    event.preventDefault()
    if (!isComplete || mutation.isPending) return
    mutation.mutate(code)
  }

  const result = mutation.data
  const failure = mutation.error ? describeFailure(mutation.error) : null

  // Успех — терминальное состояние: поле убираем, чтобы человек не отправил
  // код повторно, гадая, прошло ли.
  if (result?.status === 'ISSUED') {
    return (
      <div className='space-y-4'>
        <Alert>
          <CircleCheck className='size-4 text-emerald-600' />
          <AlertTitle>{t('billing.code.issued.title')}</AlertTitle>
          <AlertDescription>
            {t('billing.code.issued.description', {
              order: result.orderNumber,
            })}
          </AlertDescription>
        </Alert>
        <LicenseKeyPanel licenseKey={result.licenseKey} />
        <WhatHappensNext />
      </div>
    )
  }

  // Повторная отправка того же кода тем же человеком. Сервер отвечает так
  // намеренно (идемпотентность), ключа лицензии в ответе нет — ведём в список.
  if (result?.status === 'ALREADY_YOURS') {
    return (
      <div className='space-y-4'>
        <Alert>
          <Info className='size-4' />
          <AlertTitle>{t('billing.code.alreadyYours.title')}</AlertTitle>
          <AlertDescription>
            {t('billing.code.alreadyYours.description')}
          </AlertDescription>
        </Alert>
        <Button asChild variant='outline'>
          <Link to='/licenses'>{t('billing.code.alreadyYours.action')}</Link>
        </Button>
      </div>
    )
  }

  const tooLong = code.length > DIGISELLER_CODE_LENGTH

  return (
    <form onSubmit={onSubmit} className='space-y-4' noValidate>
      <div className='space-y-2'>
        <Label htmlFor='digiseller-code'>{t('billing.code.field.label')}</Label>
        <Input
          id='digiseller-code'
          value={input}
          onChange={(event) => onChange(event.target.value)}
          placeholder='A1B2C3D4E5F6G7H8'
          autoComplete='off'
          autoCapitalize='off'
          autoCorrect='off'
          spellCheck={false}
          // Регистр не меняем: сервер ищет код точным сравнением, а шаблон
          // допускает и строчные буквы.
          className='font-mono tracking-wider'
          aria-describedby='digiseller-code-hint'
          disabled={mutation.isPending}
        />
        <p
          id='digiseller-code-hint'
          className='text-xs text-muted-foreground'
        >
          {t('billing.code.field.hint', { length: DIGISELLER_CODE_LENGTH })}
          {code.length > 0 && (
            <span className={tooLong ? ' text-destructive' : ''}>
              {' '}
              {t('billing.code.field.entered', {
                entered: code.length,
                length: DIGISELLER_CODE_LENGTH,
              })}
            </span>
          )}
        </p>
        {tooLong && (
          <p className='text-xs text-destructive'>
            {t('billing.code.field.tooLong')}
          </p>
        )}
      </div>

      {failure && (
        <Alert variant={failure.tone === 'error' ? 'destructive' : 'default'}>
          {failure.tone === 'error' ? (
            <TriangleAlert className='size-4' />
          ) : (
            <Clock className='size-4' />
          )}
          <AlertTitle>{failure.title}</AlertTitle>
          <AlertDescription>{failure.body}</AlertDescription>
        </Alert>
      )}

      <div className='flex flex-wrap items-center gap-2'>
        <Button type='submit' disabled={!isComplete || mutation.isPending}>
          {mutation.isPending && (
            <LoaderCircle className='size-4 animate-spin' />
          )}
          {t('billing.code.action.submit')}
        </Button>
        {/* Повтор показываем только там, где он осмыслен: при «код уже занят»
            или исчерпанном лимите кнопка лишь провоцирует новые попытки. */}
        {failure?.retry && !mutation.isPending && (
          <Button
            type='button'
            variant='outline'
            onClick={() => mutation.mutate(code)}
            disabled={!isComplete}
          >
            {t('common.action.retry')}
          </Button>
        )}
      </div>
    </form>
  )
}
