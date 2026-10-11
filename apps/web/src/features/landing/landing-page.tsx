import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import {
  ArrowRight,
  Check,
  Cpu,
  Download,
  Fingerprint,
  Headphones,
  Loader2,
  LockKeyhole,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Zap,
} from 'lucide-react'
import { hasStoredSession } from '@/lib/auth/token-store'
import { useT } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import { LocaleSwitcher } from '@/components/locale-switcher'
import { catalogQueryOptions, formatDuration, formatPrice, type CatalogPlan, type CatalogProduct } from '@/features/catalog/api'
import { AdminErrorText } from '@/features/admin/error-text'
import {
  detectPlatform,
  formatSize,
  publicLauncherQueryOptions,
  useDownloadLauncher,
  type LauncherPage,
  type LauncherRelease,
} from '@/features/launcher/api'
import { PLATFORM_ICON } from '@/features/launcher/launcher-page'

/**
 * Главная страница платформы — витрина в духе презентаций новых устройств:
 * крупная типографика, тёмная сцена со свечением, товары и тарифы из
 * публичного каталога, загрузчик с главной (если администратор открыл его
 * всем). Вход — отдельной страницей /login, кабинет — /licenses.
 *
 * Всё содержимое живое: новый товар или тариф в админке появляется здесь
 * без правок страницы, публичный релиз загрузчика — тоже.
 */
/** Название платформы: из окружения сборки или словаря. */
function useBrand(): string {
  const t = useT()
  return import.meta.env.VITE_BRAND_NAME?.trim() || t('landing.brand')
}

export function LandingPage() {
  const t = useT()
  const brand = useBrand()
  // Корневой layout ставит вкладке «Личный кабинет» своим эффектом, а эффекты
  // родителя срабатывают ПОСЛЕ эффектов детей. Микрозадача выполняется уже
  // за ним — у витрины во вкладке имя платформы.
  useEffect(() => {
    queueMicrotask(() => {
      document.title = brand
    })
  }, [brand])
  const catalog = useQuery(catalogQueryOptions())
  const launcher = useQuery(publicLauncherQueryOptions())
  const signedIn = hasStoredSession()
  const products = catalog.data ?? []

  return (
    <div className='min-h-svh overflow-x-clip bg-background text-foreground'>
      <LandingNav signedIn={signedIn} />
      <Hero products={products} release={pickRelease(launcher.data?.releases)} signedIn={signedIn} />
      <Stats products={products} />
      {products.length > 0 && <Showcase products={products} signedIn={signedIn} />}
      {products.some((p) => p.plans.length > 0) && <Pricing products={products} signedIn={signedIn} />}
      <Features />
      <LauncherSection releases={launcher.data?.releases ?? []} page={launcher.data?.page} signedIn={signedIn} />
      <FinalCta signedIn={signedIn} />
      <footer className='border-t border-border/60 px-4 py-10 text-sm text-muted-foreground sm:px-8'>
        <div className='mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4'>
          <span>
            © {new Date().getFullYear()} {brand}
          </span>
          <nav className='flex flex-wrap gap-5'>
            <a href='#products' className='hover:text-foreground'>
              {t('landing.nav.products')}
            </a>
            <a href='#pricing' className='hover:text-foreground'>
              {t('landing.nav.pricing')}
            </a>
            <a href='#launcher' className='hover:text-foreground'>
              {t('landing.nav.launcher')}
            </a>
            <Link to='/login' className='hover:text-foreground'>
              {t('landing.nav.login')}
            </Link>
          </nav>
        </div>
      </footer>
    </div>
  )
}

function pickRelease(releases: LauncherRelease[] | undefined): LauncherRelease | undefined {
  if (!releases?.length) return undefined
  const platform = detectPlatform()
  return releases.find((r) => r.platform === platform) ?? releases[0]
}

// ------------------------------------------------------------ общие детали

/** Появление при прокрутке: один раз, без повторов, с учётом reduced motion. */
function Reveal({ children, className, delay = 0 }: { children: ReactNode; className?: string; delay?: number }) {
  const ref = useRef<HTMLDivElement>(null)
  const [shown, setShown] = useState(false)
  useEffect(() => {
    const node = ref.current
    if (!node) return
    if (typeof IntersectionObserver === 'undefined') {
      setShown(true)
      return
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setShown(true)
          observer.disconnect()
        }
      },
      { rootMargin: '0px 0px -10% 0px' }
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [])
  return (
    <div
      ref={ref}
      style={{ transitionDelay: `${delay}ms` }}
      className={cn(
        'transition-all duration-700 ease-out motion-reduce:transition-none',
        shown ? 'translate-y-0 opacity-100' : 'translate-y-6 opacity-0 motion-reduce:translate-y-0 motion-reduce:opacity-100',
        className
      )}
    >
      {children}
    </div>
  )
}

/** Цвет товара из названия: у каждого своя «обложка» без загрузки картинок. */
function hueOf(text: string): number {
  let hash = 0
  for (const char of text) hash = (hash * 31 + char.charCodeAt(0)) % 360
  return hash
}

const PILL = {
  solid: 'bg-primary text-primary-foreground shadow-[0_0_30px_-6px_var(--primary)] hover:brightness-110',
  ghost: 'border border-border bg-background/40 text-foreground backdrop-blur hover:bg-accent',
}

function pillClass(variant: keyof typeof PILL): string {
  return cn('inline-flex h-11 items-center justify-center gap-2 rounded-full px-6 text-sm font-semibold transition-all', PILL[variant])
}

/** Якорь на этой же странице. */
function PillAnchor({ href, children, variant = 'solid' }: { href: string; children: ReactNode; variant?: keyof typeof PILL }) {
  return (
    <a href={href} className={pillClass(variant)}>
      {children}
    </a>
  )
}

type CabinetPath = '/licenses' | '/catalog' | '/downloads' | '/register'

/**
 * Ссылка в кабинет: вошедшего — сразу на страницу, гостя — через вход с
 * возвратом туда же. Регистрация открыта всем.
 */
function CabinetLink({
  to,
  signedIn,
  className,
  children,
}: {
  to: CabinetPath
  signedIn: boolean
  className?: string
  children: ReactNode
}) {
  if (signedIn || to === '/register') {
    return (
      <Link to={to} className={className}>
        {children}
      </Link>
    )
  }
  return (
    <Link to='/login' search={{ redirect: to }} className={className}>
      {children}
    </Link>
  )
}

// ------------------------------------------------------------ шапка

function LandingNav({ signedIn }: { signedIn: boolean }) {
  const t = useT()
  const brand = useBrand()
  const [scrolled, setScrolled] = useState(false)
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  return (
    <header
      className={cn(
        'fixed inset-x-0 top-0 z-50 transition-colors',
        scrolled ? 'border-b border-border/60 bg-background/70 backdrop-blur-xl' : 'bg-transparent'
      )}
    >
      <div className='mx-auto flex h-16 max-w-6xl items-center gap-6 px-4 sm:px-8'>
        <a href='#top' className='flex items-center gap-2 font-semibold tracking-tight'>
          <span className='flex size-7 items-center justify-center rounded-lg bg-primary text-primary-foreground'>
            <Zap className='size-4' />
          </span>
          {brand}
        </a>
        <nav className='hidden items-center gap-6 text-sm text-muted-foreground md:flex'>
          <a href='#products' className='hover:text-foreground'>
            {t('landing.nav.products')}
          </a>
          <a href='#pricing' className='hover:text-foreground'>
            {t('landing.nav.pricing')}
          </a>
          <a href='#security' className='hover:text-foreground'>
            {t('landing.nav.security')}
          </a>
          <a href='#launcher' className='hover:text-foreground'>
            {t('landing.nav.launcher')}
          </a>
        </nav>
        <div className='ms-auto flex items-center gap-2'>
          <LocaleSwitcher className='hidden sm:flex' />
          {signedIn ? (
            <Link
              to='/licenses'
              className='inline-flex h-9 items-center gap-1.5 rounded-full bg-primary px-4 text-sm font-semibold text-primary-foreground hover:brightness-110'
            >
              {t('landing.nav.cabinet')}
              <ArrowRight className='size-4' />
            </Link>
          ) : (
            <>
              <Link to='/login' className='inline-flex h-9 items-center rounded-full px-4 text-sm font-medium hover:bg-accent'>
                {t('landing.nav.login')}
              </Link>
              <Link
                to='/register'
                className='hidden h-9 items-center rounded-full bg-primary px-4 text-sm font-semibold text-primary-foreground hover:brightness-110 sm:inline-flex'
              >
                {t('landing.nav.register')}
              </Link>
            </>
          )}
        </div>
      </div>
    </header>
  )
}

// ------------------------------------------------------------ первый экран

function Hero({ products, release, signedIn }: { products: CatalogProduct[]; release?: LauncherRelease; signedIn: boolean }) {
  const t = useT()
  const download = useDownloadLauncher()

  return (
    <section id='top' className='relative isolate flex min-h-[92svh] items-center px-4 pt-24 pb-16 sm:px-8'>
      {/* Сцена: сетка, свечение акцентного цвета и мягкий вторичный блик. */}
      <div aria-hidden className='pointer-events-none absolute inset-0 -z-10'>
        <div className='absolute inset-0 bg-[linear-gradient(to_right,var(--border)_1px,transparent_1px),linear-gradient(to_bottom,var(--border)_1px,transparent_1px)] [mask-image:radial-gradient(ellipse_at_center,black_20%,transparent_70%)] bg-[size:56px_56px] opacity-40' />
        <div className='absolute top-1/4 left-1/2 size-[42rem] -translate-x-1/2 rounded-full bg-primary/20 blur-[140px]' />
        <div className='absolute right-[-10%] bottom-[-10%] size-[28rem] rounded-full bg-chart-3/20 blur-[120px]' />
      </div>

      <div className='mx-auto grid w-full max-w-6xl items-center gap-14 lg:grid-cols-[1.15fr_1fr]'>
        <div className='space-y-7 text-center lg:text-start'>
          <Reveal>
            <span className='inline-flex items-center gap-2 rounded-full border border-border bg-background/50 px-3 py-1 text-xs font-medium text-muted-foreground backdrop-blur'>
              <Sparkles className='size-3.5 text-primary' />
              {t('landing.hero.eyebrow')}
            </span>
          </Reveal>
          <Reveal delay={80}>
            <h1 className='text-5xl leading-[1.02] font-semibold tracking-tight text-balance sm:text-6xl lg:text-7xl'>
              {t('landing.hero.title1')}{' '}
              <span className='bg-gradient-to-r from-primary via-chart-2 to-chart-3 bg-clip-text text-transparent'>{t('landing.hero.title2')}</span>
            </h1>
          </Reveal>
          <Reveal delay={160}>
            <p className='mx-auto max-w-xl text-lg text-muted-foreground lg:mx-0'>{t('landing.hero.subtitle')}</p>
          </Reveal>
          <Reveal delay={240}>
            <div className='flex flex-wrap justify-center gap-3 lg:justify-start'>
              {release ? (
                <button
                  type='button'
                  disabled={download.isPending}
                  onClick={() => download.mutate({ id: release.id, guest: true })}
                  className='inline-flex h-11 items-center justify-center gap-2 rounded-full bg-primary px-6 text-sm font-semibold text-primary-foreground shadow-[0_0_30px_-6px_var(--primary)] transition-all hover:brightness-110 disabled:opacity-70'
                >
                  {download.isPending ? <Loader2 className='size-4 animate-spin' /> : <Download className='size-4' />}
                  {t('landing.hero.download', { platform: t(`launcher.platform.${release.platform}`) })}
                </button>
              ) : (
                <CabinetLink to='/downloads' signedIn={signedIn} className={pillClass('solid')}>
                  <Download className='size-4' />
                  {t('landing.hero.getLauncher')}
                </CabinetLink>
              )}
              <PillAnchor href='#pricing' variant='ghost'>
                {t('landing.hero.pricing')}
                <ArrowRight className='size-4' />
              </PillAnchor>
            </div>
            {release && (
              <p className='mt-3 text-xs text-muted-foreground'>
                {t('landing.hero.releaseMeta', { version: release.version, size: formatSize(release.fileSize) })}
              </p>
            )}
            <AdminErrorText error={download.error} />
          </Reveal>
        </div>

        <Reveal delay={200}>
          <LauncherMock products={products} />
        </Reveal>
      </div>
    </section>
  )
}

/** «Окно загрузчика»: витрина того, как выглядит запуск, на живых названиях товаров. */
function LauncherMock({ products }: { products: CatalogProduct[] }) {
  const t = useT()
  const names = products.length ? products.slice(0, 3).map((p) => p.name) : [t('landing.mock.product1'), t('landing.mock.product2')]
  return (
    <div className='relative mx-auto w-full max-w-md'>
      <div aria-hidden className='absolute -inset-6 -z-10 rounded-[2rem] bg-gradient-to-br from-primary/30 via-transparent to-chart-3/30 blur-2xl' />
      <div className='overflow-hidden rounded-2xl border border-border bg-card/80 shadow-2xl backdrop-blur-xl'>
        <div className='flex items-center gap-1.5 border-b border-border px-4 py-3'>
          <span className='size-2.5 rounded-full bg-destructive/80' />
          <span className='size-2.5 rounded-full bg-chart-5/80' />
          <span className='size-2.5 rounded-full bg-primary/80' />
          <span className='ms-3 text-xs text-muted-foreground'>{t('landing.mock.title')}</span>
        </div>
        <div className='space-y-3 p-4'>
          {names.map((name, index) => (
            <div key={name} className='flex items-center gap-3 rounded-xl border border-border/70 bg-background/60 p-3'>
              <span
                className='flex size-10 shrink-0 items-center justify-center rounded-lg text-sm font-bold text-white'
                style={{ background: `linear-gradient(135deg, hsl(${hueOf(name)} 85% 55%), hsl(${(hueOf(name) + 50) % 360} 85% 40%))` }}
              >
                {name.slice(0, 2).toUpperCase()}
              </span>
              <span className='min-w-0 flex-1'>
                <span className='block truncate text-sm font-medium'>{name}</span>
                <span className='mt-1.5 block h-1.5 overflow-hidden rounded-full bg-muted'>
                  <span
                    className='block h-full animate-[landing-load_2.8s_ease-in-out_infinite] rounded-full bg-primary motion-reduce:animate-none'
                    style={{ width: `${index === 0 ? 100 : 62 - index * 14}%`, animationDelay: `${index * 0.4}s` }}
                  />
                </span>
              </span>
              <span className={cn('text-xs font-medium', index === 0 ? 'text-primary' : 'text-muted-foreground')}>
                {index === 0 ? t('landing.mock.ready') : t('landing.mock.updating')}
              </span>
            </div>
          ))}
          <div className='flex items-center justify-between rounded-xl bg-primary/10 px-3 py-2.5 text-xs'>
            <span className='flex items-center gap-1.5 font-medium text-primary'>
              <ShieldCheck className='size-4' />
              {t('landing.mock.protected')}
            </span>
            <span className='font-mono text-muted-foreground'>HWID · AES-256-GCM</span>
          </div>
        </div>
      </div>
      <style>{'@keyframes landing-load{0%{transform:translateX(-30%);opacity:.6}50%{transform:translateX(0);opacity:1}100%{transform:translateX(-30%);opacity:.6}}'}</style>
    </div>
  )
}

// ------------------------------------------------------------ цифры

function Stats({ products }: { products: CatalogProduct[] }) {
  const t = useT()
  const cheapest = products
    .flatMap((p) => p.plans)
    .reduce<CatalogPlan | null>((min, plan) => (!min || Number(plan.price) < Number(min.price) ? plan : min), null)
  const items = [
    { value: products.length ? String(products.length) : '—', label: t('landing.stats.products') },
    { value: cheapest ? formatPrice(cheapest.price, cheapest.currency) : '—', label: t('landing.stats.from') },
    { value: '256-bit', label: t('landing.stats.encryption') },
    { value: '24/7', label: t('landing.stats.support') },
  ]
  return (
    <section className='border-y border-border/60 bg-card/30 px-4 py-10 sm:px-8'>
      <div className='mx-auto grid max-w-6xl grid-cols-2 gap-6 md:grid-cols-4'>
        {items.map((item, index) => (
          <Reveal key={item.label} delay={index * 80} className='text-center'>
            <p className='text-3xl font-semibold tracking-tight sm:text-4xl'>{item.value}</p>
            <p className='mt-1 text-sm text-muted-foreground'>{item.label}</p>
          </Reveal>
        ))}
      </div>
    </section>
  )
}

// ------------------------------------------------------------ товары

function Showcase({ products, signedIn }: { products: CatalogProduct[]; signedIn: boolean }) {
  const t = useT()
  return (
    <section id='products' className='scroll-mt-20 px-4 py-24 sm:px-8'>
      <div className='mx-auto max-w-6xl space-y-6'>
        <Reveal className='mx-auto max-w-2xl space-y-3 text-center'>
          <p className='text-sm font-semibold tracking-widest text-primary uppercase'>{t('landing.products.eyebrow')}</p>
          <h2 className='text-4xl font-semibold tracking-tight text-balance sm:text-5xl'>{t('landing.products.title')}</h2>
          <p className='text-muted-foreground'>{t('landing.products.subtitle')}</p>
        </Reveal>
        <div className='space-y-6 pt-8'>
          {products.map((product, index) => (
            <ProductFeature key={product.id} product={product} flipped={index % 2 === 1} signedIn={signedIn} />
          ))}
        </div>
      </div>
    </section>
  )
}

function ProductFeature({ product, flipped, signedIn }: { product: CatalogProduct; flipped: boolean; signedIn: boolean }) {
  const t = useT()
  const hue = hueOf(product.name)
  const cheapest = [...product.plans].sort((a, b) => Number(a.price) - Number(b.price))[0]
  return (
    <Reveal>
      <article className='grid overflow-hidden rounded-3xl border border-border bg-card/50 md:grid-cols-2'>
        <div
          className={cn('relative flex min-h-64 items-center justify-center overflow-hidden p-10', flipped && 'md:order-2')}
          style={{ background: `radial-gradient(circle at 30% 20%, hsl(${hue} 90% 55% / .55), transparent 60%), radial-gradient(circle at 80% 90%, hsl(${(hue + 60) % 360} 90% 50% / .45), transparent 55%), var(--card)` }}
        >
          <span className='text-[7rem] leading-none font-black tracking-tighter text-white/90 mix-blend-overlay select-none sm:text-[9rem]'>
            {product.name.slice(0, 2).toUpperCase()}
          </span>
          <span className='absolute bottom-5 left-5 inline-flex items-center gap-1.5 rounded-full bg-black/40 px-3 py-1 text-xs font-medium text-white backdrop-blur'>
            <Cpu className='size-3.5' />
            {t('landing.products.plans', { n: product.plans.length })}
          </span>
        </div>
        <div className='flex flex-col justify-center gap-5 p-8 sm:p-12'>
          <h3 className='text-3xl font-semibold tracking-tight'>{product.name}</h3>
          {product.description && <p className='text-muted-foreground'>{product.description}</p>}
          <ul className='grid gap-2 text-sm'>
            {(['landing.products.point1', 'landing.products.point2', 'landing.products.point3'] as const).map((key) => (
              <li key={key} className='flex gap-2'>
                <Check className='mt-0.5 size-4 shrink-0 text-primary' />
                {t(key)}
              </li>
            ))}
          </ul>
          <div className='flex flex-wrap items-center gap-4'>
            {cheapest && (
              <span className='text-lg'>
                <span className='text-muted-foreground'>{t('landing.products.from')} </span>
                <span className='font-semibold'>{formatPrice(cheapest.price, cheapest.currency)}</span>
              </span>
            )}
            <CabinetLink to='/catalog' signedIn={signedIn} className='inline-flex items-center gap-1.5 text-sm font-semibold text-primary hover:underline'>
              {t('landing.products.buy')}
              <ArrowRight className='size-4' />
            </CabinetLink>
          </div>
        </div>
      </article>
    </Reveal>
  )
}

// ------------------------------------------------------------ тарифы

function Pricing({ products, signedIn }: { products: CatalogProduct[]; signedIn: boolean }) {
  const t = useT()
  const withPlans = products.filter((p) => p.plans.length > 0)
  const [selected, setSelected] = useState(withPlans[0]?.id)
  const product = withPlans.find((p) => p.id === selected) ?? withPlans[0]
  // «Выгоднее всего» — самый дешёвый день; вечный тариф сравнивать не с чем.
  const best = useMemo(() => {
    const timed = (product?.plans ?? []).filter((p) => p.durationDays > 0)
    return timed.reduce<CatalogPlan | null>((min, plan) => (!min || Number(plan.price) / plan.durationDays < Number(min.price) / min.durationDays ? plan : min), null)?.id
  }, [product])
  if (!product) return null

  return (
    <section id='pricing' className='relative scroll-mt-20 px-4 py-24 sm:px-8'>
      <div aria-hidden className='pointer-events-none absolute inset-x-0 top-1/3 -z-10 mx-auto h-72 max-w-4xl rounded-full bg-primary/10 blur-[120px]' />
      <div className='mx-auto max-w-6xl space-y-10'>
        <Reveal className='mx-auto max-w-2xl space-y-3 text-center'>
          <p className='text-sm font-semibold tracking-widest text-primary uppercase'>{t('landing.pricing.eyebrow')}</p>
          <h2 className='text-4xl font-semibold tracking-tight text-balance sm:text-5xl'>{t('landing.pricing.title')}</h2>
          <p className='text-muted-foreground'>{t('landing.pricing.subtitle')}</p>
        </Reveal>
        {withPlans.length > 1 && (
          <div className='flex flex-wrap justify-center gap-2'>
            {withPlans.map((p) => (
              <button
                key={p.id}
                type='button'
                onClick={() => setSelected(p.id)}
                className={cn(
                  'rounded-full border px-4 py-1.5 text-sm font-medium transition-colors',
                  p.id === product.id ? 'border-primary bg-primary text-primary-foreground' : 'border-border hover:bg-accent'
                )}
              >
                {p.name}
              </button>
            ))}
          </div>
        )}
        <div className='grid gap-4 sm:grid-cols-2 lg:grid-cols-4'>
          {product.plans.map((plan, index) => {
            const highlight = plan.id === best
            const perDay = plan.durationDays > 0 ? Number(plan.price) / plan.durationDays : null
            return (
              <Reveal key={plan.id} delay={index * 70}>
                <div
                  className={cn(
                    'relative flex h-full flex-col gap-5 rounded-2xl border bg-card/60 p-6 backdrop-blur',
                    highlight ? 'border-primary shadow-[0_0_40px_-12px_var(--primary)]' : 'border-border'
                  )}
                >
                  {highlight && (
                    <span className='absolute -top-3 left-6 rounded-full bg-primary px-3 py-0.5 text-xs font-semibold text-primary-foreground'>
                      {t('landing.pricing.best')}
                    </span>
                  )}
                  <div>
                    <p className='text-sm text-muted-foreground'>{plan.name}</p>
                    <p className='mt-1 text-lg font-medium'>{formatDuration(plan.durationDays)}</p>
                  </div>
                  <p className='text-4xl font-semibold tracking-tight'>{formatPrice(plan.price, plan.currency)}</p>
                  {perDay !== null && (
                    <p className='-mt-3 text-xs text-muted-foreground'>
                      {t('landing.pricing.perDay', { price: formatPrice(perDay.toFixed(2), plan.currency) })}
                    </p>
                  )}
                  <CabinetLink
                    to='/catalog'
                    signedIn={signedIn}
                    className={cn(
                      'mt-auto inline-flex h-10 items-center justify-center rounded-full text-sm font-semibold transition-all',
                      highlight ? 'bg-primary text-primary-foreground hover:brightness-110' : 'border border-border hover:bg-accent'
                    )}
                  >
                    {t('landing.pricing.choose')}
                  </CabinetLink>
                </div>
              </Reveal>
            )
          })}
        </div>
      </div>
    </section>
  )
}

// ------------------------------------------------------------ почему мы

const FEATURES = [
  { icon: Fingerprint, key: 'hwid' },
  { icon: LockKeyhole, key: 'crypto' },
  { icon: Zap, key: 'instant' },
  { icon: RefreshCw, key: 'updates' },
  { icon: ShieldCheck, key: 'ddos' },
  { icon: Headphones, key: 'support' },
] as const

function Features() {
  const t = useT()
  return (
    <section id='security' className='scroll-mt-20 border-y border-border/60 bg-card/30 px-4 py-24 sm:px-8'>
      <div className='mx-auto max-w-6xl space-y-12'>
        <Reveal className='mx-auto max-w-2xl space-y-3 text-center'>
          <p className='text-sm font-semibold tracking-widest text-primary uppercase'>{t('landing.features.eyebrow')}</p>
          <h2 className='text-4xl font-semibold tracking-tight text-balance sm:text-5xl'>{t('landing.features.title')}</h2>
        </Reveal>
        <div className='grid gap-4 sm:grid-cols-2 lg:grid-cols-3'>
          {FEATURES.map(({ icon: Icon, key }, index) => (
            <Reveal key={key} delay={index * 60}>
              <div className='group h-full rounded-2xl border border-border bg-background/60 p-6 transition-colors hover:border-primary/60'>
                <span className='flex size-11 items-center justify-center rounded-xl bg-primary/10 text-primary transition-transform group-hover:scale-110'>
                  <Icon className='size-5' />
                </span>
                <h3 className='mt-4 text-lg font-semibold'>{t(`landing.features.${key}.title`)}</h3>
                <p className='mt-1.5 text-sm text-muted-foreground'>{t(`landing.features.${key}.text`)}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  )
}

// ------------------------------------------------------------ загрузчик

function LauncherSection({ releases, page, signedIn }: { releases: LauncherRelease[]; page?: LauncherPage; signedIn: boolean }) {
  const t = useT()
  const download = useDownloadLauncher()
  const requirements = (page?.requirements ?? '').split('\n').map((s) => s.trim()).filter(Boolean)
  const steps = (page?.steps ?? '').split('\n').map((s) => s.trim()).filter(Boolean)

  return (
    <section id='launcher' className='scroll-mt-20 px-4 py-24 sm:px-8'>
      <div className='mx-auto max-w-6xl'>
        <Reveal>
          <div className='relative overflow-hidden rounded-3xl border border-border bg-card/60 p-8 sm:p-12'>
            <div aria-hidden className='pointer-events-none absolute -top-32 -right-24 size-96 rounded-full bg-primary/15 blur-[100px]' />
            <div className='relative grid gap-10 lg:grid-cols-[1.2fr_1fr]'>
              <div className='space-y-5'>
                <p className='text-sm font-semibold tracking-widest text-primary uppercase'>{t('landing.launcher.eyebrow')}</p>
                <h2 className='text-4xl font-semibold tracking-tight text-balance'>{t('landing.launcher.title')}</h2>
                <p className='text-muted-foreground'>{t('landing.launcher.subtitle')}</p>
                {releases.length > 0 ? (
                  <div className='flex flex-wrap gap-3'>
                    {releases.map((release) => {
                      const Icon = PLATFORM_ICON[release.platform]
                      return (
                        <button
                          key={release.id}
                          type='button'
                          disabled={download.isPending}
                          onClick={() => download.mutate({ id: release.id, guest: true })}
                          className='inline-flex items-center gap-3 rounded-2xl border border-border bg-background/70 px-5 py-3 text-start transition-colors hover:border-primary disabled:opacity-70'
                        >
                          <Icon className='size-6 text-primary' />
                          <span>
                            <span className='block text-sm font-semibold'>{t('landing.launcher.for', { platform: t(`launcher.platform.${release.platform}`) })}</span>
                            <span className='block text-xs text-muted-foreground'>
                              {release.version} · {formatSize(release.fileSize)}
                            </span>
                          </span>
                          <Download className='ms-2 size-4 text-muted-foreground' />
                        </button>
                      )
                    })}
                  </div>
                ) : (
                  <CabinetLink to='/downloads' signedIn={signedIn} className={pillClass('solid')}>
                    <Download className='size-4' />
                    {signedIn ? t('landing.launcher.inCabinet') : t('landing.launcher.loginToDownload')}
                  </CabinetLink>
                )}
                <AdminErrorText error={download.error} />
                {releases[0]?.sha256 && (
                  <p className='font-mono text-[11px] break-all text-muted-foreground'>SHA-256 {releases[0].sha256}</p>
                )}
              </div>
              <div className='grid gap-6 sm:grid-cols-2 lg:grid-cols-1'>
                {requirements.length > 0 && (
                  <div>
                    <p className='mb-2 text-sm font-semibold'>{t('launcher.requirements')}</p>
                    <ul className='space-y-1.5 text-sm text-muted-foreground'>
                      {requirements.map((line) => (
                        <li key={line} className='flex gap-2'>
                          <Check className='mt-0.5 size-4 shrink-0 text-primary' />
                          {line}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {steps.length > 0 && (
                  <div>
                    <p className='mb-2 text-sm font-semibold'>{t('launcher.steps')}</p>
                    <ol className='space-y-1.5 text-sm text-muted-foreground'>
                      {steps.map((line, index) => (
                        <li key={line} className='flex gap-2'>
                          <span className='w-4 shrink-0 font-semibold text-primary'>{index + 1}.</span>
                          {line}
                        </li>
                      ))}
                    </ol>
                  </div>
                )}
              </div>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  )
}

// ------------------------------------------------------------ финал

function FinalCta({ signedIn }: { signedIn: boolean }) {
  const t = useT()
  return (
    <section className='relative isolate overflow-hidden px-4 py-28 text-center sm:px-8'>
      <div aria-hidden className='pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_center,var(--primary)_0%,transparent_60%)] opacity-15' />
      <Reveal className='mx-auto max-w-3xl space-y-6'>
        <h2 className='text-4xl font-semibold tracking-tight text-balance sm:text-6xl'>{t('landing.final.title')}</h2>
        <p className='text-lg text-muted-foreground'>{t('landing.final.subtitle')}</p>
        <div className='flex flex-wrap justify-center gap-3'>
          <CabinetLink to={signedIn ? '/licenses' : '/register'} signedIn={signedIn} className={pillClass('solid')}>
            {signedIn ? t('landing.nav.cabinet') : t('landing.final.start')}
            <ArrowRight className='size-4' />
          </CabinetLink>
          <PillAnchor href='#pricing' variant='ghost'>
            {t('landing.hero.pricing')}
          </PillAnchor>
        </div>
      </Reveal>
    </section>
  )
}
