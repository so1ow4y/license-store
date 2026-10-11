/**
 * Русский словарь.
 *
 * Типизирован `Messages` — типом, выведенным из английского словаря. Это и есть
 * защита от полупереведённого интерфейса: пропущенный ключ или строка там, где
 * нужны формы числа, валят типизацию, а не всплывают у пользователя.
 *
 * Порядок разделов повторяет `en.ts` — чтобы два файла читались рядом.
 */
import type { Messages } from './en'

export const ru: Messages = {
  /* ---------------------------------------------------------------- */
  /* Сквозные элементы                                                 */
  /* ---------------------------------------------------------------- */
  'common.action.retry': 'Повторить',
  'common.action.search': 'Найти',
  'common.action.cancel': 'Отмена',
  'common.action.close': 'Закрыть',
  'common.action.refresh': 'Обновить',
  'common.action.resetFilters': 'Сбросить фильтры',
  'common.action.showMore': 'Показать ещё ({loaded} из {total})',
  'common.action.back': 'Назад',
  'common.action.toAccount': 'В кабинет',
  'common.action.prevPage': 'Назад',
  'common.action.nextPage': 'Далее',
  'common.state.loading': 'Загружаем…',
  'common.password.show': 'Показать пароль',
  'common.password.hide': 'Скрыть пароль',

  /* Кнопка «копировать» */
  'common.copy.action': 'Скопировать',
  'common.copy.value': 'Значение',
  'common.copy.aria': 'Скопировать: {label}',
  'common.copy.done': 'Скопировано',
  'common.copy.toast.success': '{label} — скопировано',
  'common.copy.toast.failed':
    'Браузер не дал доступ к буферу обмена. Выделите значение и скопируйте вручную.',

  /* Сроки и обратный отсчёт */
  'common.duration.hoursMinutes': '{hours} ч {minutes} мин',
  'common.duration.minutesSeconds': '{minutes} мин {seconds} с',
  'common.duration.seconds': '{seconds} с',
  'common.duration.minutes': {
    one: '{count} минуту',
    few: '{count} минуты',
    many: '{count} минут',
    other: '{count} минуты',
  },
  'common.duration.hours': {
    one: '{count} час',
    few: '{count} часа',
    many: '{count} часов',
    other: '{count} часа',
  },
  'common.duration.days': {
    one: '{count} день',
    few: '{count} дня',
    many: '{count} дней',
    other: '{count} дня',
  },

  /* ---------------------------------------------------------------- */
  /* Переключатель языка                                               */
  /* ---------------------------------------------------------------- */
  'locale.switcher.label': 'Язык',
  'locale.switcher.option': 'Переключить интерфейс на {language}',

  /* ---------------------------------------------------------------- */
  /* Каркас приложения                                                 */
  /* ---------------------------------------------------------------- */
  'shell.brand': 'Личный кабинет',
  'shell.action.signOut': 'Выйти',
  'dock.label': 'Навигация',
  'dock.expand': 'Развернуть панель',
  'dock.collapse': 'Свернуть панель',
  'dock.hide': 'Спрятать панель',
  'dock.show': 'Показать панель',
  'nav.settings': 'Настройки',
  'nav.admin.security': 'Безопасность',
  'nav.group.workspace': 'Кабинет',
  'nav.group.account': 'Аккаунт',
  'nav.group.admin': 'Администрирование',
  'nav.licenses': 'Мои лицензии',
  'nav.catalog': 'Каталог',
  'nav.activate': 'Активация',
  'nav.reseller': 'Мои продажи',
  'nav.reseller.overview': 'Обзор',
  'nav.reseller.keys': 'Ключи',
  'nav.reseller.clients': 'Клиенты',
  'nav.reseller.balance': 'Баланс и пополнение',
  'nav.admin.resellers': 'Реселлеры',
  'nav.admin.resellerTopups': 'Заявки на пополнение',
  'nav.branch.cabinet': 'Кабинет',
  'nav.branch.users': 'Пользователи',
  'nav.branch.resellers': 'Реселлеры',
  'nav.branch.catalog': 'Каталог',
  'nav.branch.sales': 'Продажи',
  'nav.branch.system': 'Система',
  'nav.security': 'Безопасность',
  'nav.security.password': 'Пароль',
  'nav.security.twoFactor': 'Двухфакторная',
  'nav.security.logins': 'Способы входа',
  'nav.telegram': 'Telegram-бот',
  'nav.appearance': 'Внешний вид',
  'nav.admin.pendingDeals': 'Зависшие сделки',
  'nav.admin.licenses': 'Все лицензии',

  /* Внешний вид */
  'appearance.title': 'Внешний вид',
  'appearance.description': 'Настройки сохраняются в этом браузере.',
  'appearance.dock.title': 'Панель навигации',
  'appearance.dock.description': 'У какого края экрана стоит панель.',
  'appearance.dock.left': 'Слева',
  'appearance.dock.right': 'Справа',
  'appearance.dock.top': 'Сверху',
  'appearance.dock.bottom': 'Снизу',
  'appearance.dock.expanded': 'Развёрнутая панель с подписями',
  'appearance.dock.expandedHint': 'То же делает кнопка в конце панели.',
  'appearance.theme.title': 'Цветовая схема',
  'appearance.theme.description': 'Меняет цвета всего приложения.',
  'appearance.theme.lime': 'Лайм',
  'appearance.theme.lime.hint': 'Тёмная с кислотно-лаймовым акцентом. По умолчанию.',
  'appearance.theme.lavender': 'Лаванда',
  'appearance.theme.lavender.hint': 'Тёмная с мягким фиолетовым акцентом.',
  'appearance.dock.autoHide': 'Показывать панель только при наведении',
  'appearance.dock.autoHideHint': 'Панель прячется за край экрана и выезжает, когда к нему подводишь мышь, — как панель задач в Windows.',
  'appearance.dock.hidden': 'Спрятать панель, оставить только букву',
  'appearance.dock.hiddenHint': 'То же, что клик по букве в панели. Повторный клик возвращает панель.',

  /* Окно настроек */
  'settings.title': 'Настройки',
  'settings.search': 'Найти настройку',
  'settings.nothingFound': 'Ничего не найдено.',
  'settings.group.profile': 'Профиль',
  'settings.group.security': 'Безопасность',
  'settings.group.interface': 'Интерфейс',
  'settings.group.integrations': 'Интеграции',
  'settings.group.access': 'Доступ',
  'settings.nav.profile': 'Логин и почта',
  'settings.nav.access': 'Моя роль',

  /* Профиль */
  'profile.needPassword': 'Сначала задайте пароль: смена логина и почты подтверждается им.',
  'profile.currentPassword': 'Текущий пароль',
  'profile.username.title': 'Логин',
  'profile.username.current': 'Сейчас: {username}',
  'profile.username.new': 'Новый логин',
  'profile.username.rules': '3–32 символа: латиница, цифры, дефис и подчёркивание.',
  'profile.username.action': 'Сменить логин',
  'profile.username.done': 'Логин изменён. Теперь входите с новым.',
  'profile.email.title': 'Почта',
  'profile.email.verified': 'подтверждена',
  'profile.email.unverified': 'не подтверждена',
  'profile.email.none': 'Почта не указана.',
  'profile.email.pending': 'На {email} отправлена ссылка. Почта сменится после перехода по ней.',
  'profile.email.new': 'Новая почта',
  'profile.email.hint': 'Пришлём ссылку на новый адрес, на текущий придёт уведомление.',
  'profile.email.action': 'Сменить почту',

  /* Моя роль */
  'access.roles.title': 'Моя роль',
  'access.roles.description': 'Роли вашего аккаунта. Поменять их может только администратор старше вас.',
  'access.permissions.title': 'Что вам доступно',
  'access.permissions.count': {
    one: '{count} право',
    few: '{count} права',
    many: '{count} прав',
    other: '{count} права',
  },

  /* Подтверждение новой почты */
  'emailChange.noToken.title': 'Ссылка неполная',
  'emailChange.noToken.description': 'Откройте ссылку из письма целиком или запросите смену заново в профиле.',
  'emailChange.pending.title': 'Подтверждаем новый адрес…',
  'emailChange.pending.description': 'Это займёт секунду.',
  'emailChange.done.title': 'Почта изменена',
  'emailChange.done.description': 'Теперь у аккаунта новый адрес.',
  'emailChange.failed.title': 'Ссылка не работает',
  'emailChange.failed.description': 'Она устарела или уже использована. Запросите смену заново в профиле.',
  'emailChange.toProfile': 'В профиль',

  /* Безопасность: мини-SIEM */
  'security.title': 'Безопасность',
  'security.description': 'Журналы событий и входов с поиском по полям, блокировка адресов и аккаунтов.',
  'security.tab.events': 'События',
  'security.tab.logins': 'Входы',
  'security.tab.blocks': 'Блокировки',
  'siem.placeholder.audit': 'action:user.* -actor:system ip:10.0.0.0/8 текст',
  'siem.placeholder.logins': 'result:fail ip:203.0.113.* user:bob',
  'timeRange.quickTitle': 'Быстрый выбор',
  'timeRange.quick.15m': 'Последние 15 минут',
  'timeRange.quick.1h': 'Последний час',
  'timeRange.quick.4h': 'Последние 4 часа',
  'timeRange.quick.24h': 'Последние 24 часа',
  'timeRange.quick.7d': 'Последние 7 дней',
  'timeRange.quick.30d': 'Последние 30 дней',
  'timeRange.quick.90d': 'Последние 90 дней',
  'timeRange.quick.today': 'Сегодня',
  'timeRange.quick.yesterday': 'Вчера',
  'timeRange.quick.all': 'За всё время',
  'timeRange.lastTitle': 'Последние…',
  'timeRange.last': 'Последние {value}',
  'timeRange.unit.m': '{n} мин',
  'timeRange.unit.h': '{n} ч',
  'timeRange.unit.d': '{n} дн',
  'timeRange.unitName.m': 'минут',
  'timeRange.unitName.h': 'часов',
  'timeRange.unitName.d': 'дней',
  'timeRange.absoluteTitle': 'Свой период',
  'timeRange.from': 'С',
  'timeRange.to': 'По',
  'timeRange.toHint': 'Пустое «По» — до текущего момента.',
  'timeRange.now': 'сейчас',
  'timeRange.apply': 'Применить',
  'timeRange.invalid': 'Начало должно быть раньше конца.',
  'timeRange.autoTitle': 'Автообновление',
  'timeRange.auto.off': 'Выкл',
  'timeRange.auto.10s': '10 с',
  'timeRange.auto.30s': '30 с',
  'timeRange.auto.1m': '1 мин',
  'timeRange.auto.5m': '5 мин',
  'timeRange.earlier': 'Предыдущий период',
  'timeRange.later': 'Следующий период',
  'timeRange.zoomOut': 'Отдалить ×2',
  'timeRange.refresh': 'Обновить',
  'timeRange.brushHint': 'Протяните мышью по гистограмме, чтобы приблизить участок; клик по столбику — только этот шаг.',
  'siem.histogram.hover': '{time}: {n}',
  'siem.histogram.selection': 'Отпустите, чтобы показать {from} — {to}',

  'nav.branch.security': 'Безопасность',
  'nav.sec.dashboards': 'Дашборды',
  'nav.sec.events': 'События',
  'nav.sec.logins': 'Входы',
  'nav.sec.hits': 'Сработки',
  'nav.sec.rules': 'Правила корреляции',
  'nav.sec.blocks': 'Блокировки',
  'nav.sec.traffic': 'Приоритет трафика',

  'sec.page.dashboards': 'Дашборды безопасности',
  'sec.page.dashboards.hint': 'Соберите свои экраны из виджетов: счётчики, гистограммы, топы, последние события, сработки и нагрузка. Период общий для всех виджетов; протяните мышью по гистограмме, чтобы приблизить.',
  'sec.page.events': 'События',
  'sec.page.events.hint': 'Журнал действий с поиском по полям, периодом «с — по», гистограммой и топом значений. Клик по строке открывает событие с контекстом адреса.',
  'sec.page.logins': 'Входы',
  'sec.page.logins.hint': 'Все попытки входа: кто, откуда, с каким итогом. Неудачные — красным на гистограмме.',
  'sec.page.blocks': 'Блокировки',
  'sec.page.blocks.hint': 'Адреса и подсети, заблокированные на уровне приложения, nginx или фаервола хоста, и аккаунты, заблокированные по логину.',
  'sec.page.hits': 'Сработки',
  'sec.page.hits.hint': 'Срабатывания правил корреляции: что нашлось, что сделала система, очередь разбора.',
  'sec.page.rules': 'Правила корреляции',
  'sec.page.rules.hint': 'Правила как в WAF: N событий (или N разных значений) с одного ключа за окно → сработка и действие: блок адреса на выбранном уровне и портах или блок пользователя.',
  'sec.page.traffic': 'Приоритет трафика',
  'sec.page.traffic.hint': 'При перегрузке и DDoS падает сайт для анонимов, а не панель: доверенные адреса, пользователи и роли обслуживаются первыми.',

  'sec.severity.LOW': 'Низкая',
  'sec.severity.MEDIUM': 'Средняя',
  'sec.severity.HIGH': 'Высокая',
  'sec.severity.CRITICAL': 'Критичная',

  'sec.level.APP': 'Приложение',
  'sec.level.EDGE': 'nginx',
  'sec.level.FIREWALL': 'Фаервол',
  'sec.level.APP.hint': 'L7: запрос доходит до API и отклоняется первым guard’ом. Работает всегда, агенты не нужны.',
  'sec.level.EDGE.hint': 'L7 на краю: nginx отвечает 403, запрос не доходит ни до API, ни до статики.',
  'sec.level.FIREWALL.hint': 'L3/L4 на хосте: nftables отбрасывает пакеты до TCP-рукопожатия. Можно ограничить портами.',
  'sec.level.where': 'Уровень',
  'sec.level.column': 'Уровень',
  'sec.level.ports': 'Порты',
  'sec.level.portsHint': 'Через запятую, пусто — все порты. Только 22 закроет SSH, а сайт оставит доступным.',
  'sec.level.portsPlaceholder': 'порты: 22, 443 (пусто — все)',

  'sec.hitStatus.NEW': 'Новая',
  'sec.hitStatus.ACKNOWLEDGED': 'В работе',
  'sec.hitStatus.RESOLVED': 'Решена',
  'sec.hitStatus.FALSE_POSITIVE': 'Ложная',

  'sec.outcome.alerted': 'Только сработка',
  'sec.outcome.blocked': 'Заблокировано',
  'sec.outcome.skipped_protected': 'Пропущено: защищён',
  'sec.outcome.skipped_existing': 'Уже заблокирован',
  'sec.outcome.failed': 'Ошибка: {code}',

  'sec.ua.title': 'Клиент',
  'sec.ua.desktop': 'компьютер',
  'sec.ua.mobile': 'телефон',
  'sec.ua.bot': 'бот',
  'sec.ua.tool': 'скрипт',
  'sec.ua.launcher': 'загрузчик',

  'sec.cond.events': '≥ {n} событий за {window} по полю {field}',
  'sec.cond.distinct': '≥ {n} разных «{distinct}» за {window} по полю {field}',
  'sec.action.ALERT': 'Только сработка',
  'sec.action.BLOCK_IP': 'Блок адреса',
  'sec.action.BLOCK_USER': 'Блок пользователя',
  'sec.actionText.blockIp': 'Блок: {level}{ports}, {duration}',
  'sec.duration.forever': 'бессрочно',
  'sec.source.LOGINS': 'Входы',
  'sec.source.AUDIT': 'События',

  'sec.ip.title': 'Контекст адреса',
  'sec.ip.scope.public': 'Публичный',
  'sec.ip.scope.private': 'Частная сеть',
  'sec.ip.scope.loopback': 'Петля',
  'sec.ip.scope.cgnat': 'NAT оператора',
  'sec.ip.scope.link-local': 'Локальный канал',
  'sec.ip.scope.documentation': 'Диапазон для документации',
  'sec.ip.scope.multicast': 'Мультикаст',
  'sec.ip.trusted': 'Доверенный · вес {weight}',
  'sec.ip.reverse': 'Обратная зона DNS',
  'sec.ip.failed24h': 'Неудачных входов за сутки',
  'sec.ip.success24h': 'успешных: {n}',
  'sec.ip.logins90d': 'Входов за 90 дней',
  'sec.ip.loginsTotal': '{total}, неудачных {failed}',
  'sec.ip.accounts': 'Каких учёток касались',
  'sec.ip.countries': 'Страны',
  'sec.ip.seen': 'Впервые и последний раз',
  'sec.ip.audit24h': 'Событий журнала за сутки',
  'sec.ip.users': 'Кто входил с этого адреса',
  'sec.ip.staff': 'Сотрудник',
  'sec.ip.blocked': 'заблокирован',
  'sec.ip.hits': 'обращений: {n}',
  'sec.ip.hitsTitle': 'Сработки по этому адресу',

  'sec.blocks.byRule': 'правилом',
  'sec.levels.title': 'Уровни блокировки',
  'sec.levels.hint': 'Путь пакета слева направо: чем раньше срабатывает блок, тем дешевле атака для сервера. Блок фаервола действует и в nginx, и в приложении.',
  'sec.levels.appAlways': 'работает всегда',
  'sec.levels.noToken': 'не задан EDGE_AGENT_TOKEN',
  'sec.levels.online': 'агент на связи · {when}',
  'sec.levels.stale': 'агент молчит с {when}',
  'sec.levels.nginxOff': 'агент nginx не подключался',
  'sec.levels.firewallOff': 'агент не запущен (профиль compose firewall)',
  'sec.levels.osi.APP': 'L7',
  'sec.levels.osi.EDGE': 'L7',
  'sec.levels.osi.FIREWALL': 'L3/L4',
  'sec.levels.count': 'активных: {n}',

  'sec.hits.updated': 'Обновлено: {n}',
  'sec.hits.toRules': 'Правила',
  'sec.hits.open': 'Ждут разбора',
  'sec.hits.critical': 'Критичных, новых',
  'sec.hits.day': 'Сработок за сутки',
  'sec.hits.all': 'Все',
  'sec.hits.anySeverity': 'Любая важность',
  'sec.hits.anyRule': 'Все правила',
  'sec.hits.search': 'Ключ: адрес, логин…',
  'sec.hits.do.ACKNOWLEDGED': 'Взять в работу',
  'sec.hits.do.RESOLVED': 'Решено',
  'sec.hits.do.FALSE_POSITIVE': 'Ложная',
  'sec.hits.column.severity': 'Важность',
  'sec.hits.column.when': 'Когда',
  'sec.hits.column.rule': 'Правило',
  'sec.hits.column.key': 'Ключ',
  'sec.hits.column.count': 'Сколько',
  'sec.hits.column.outcome': 'Действие',
  'sec.hits.column.status': 'Статус',
  'sec.hits.emptyNew': 'Новых сработок нет. Очередь пуста.',
  'sec.hits.reopen': 'Вернуть в новые',
  'sec.hits.events': 'События сработки',
  'sec.hits.rule': 'Правило',
  'sec.hits.block': 'Блокировки',
  'sec.hits.what': 'Что произошло',
  'sec.hits.countDistinct': '{n} событий, разных «{field}»: {d}',
  'sec.hits.window': 'Окно',
  'sec.hits.span': 'Первое и последнее событие',
  'sec.hits.handled': 'Кто разбирал',
  'sec.hits.inside': 'Внутри сработки',
  'sec.hits.note': 'Заметка',
  'sec.hits.notePlaceholder': 'Что выяснили, что сделали',

  'sec.rules.new': 'Новое правило',
  'sec.rules.on': 'Вкл.',
  'sec.rules.name': 'Название',
  'sec.rules.description': 'Описание',
  'sec.rules.condition': 'Условие',
  'sec.rules.action': 'Действие',
  'sec.rules.hits24h': 'За сутки',
  'sec.rules.lastHit': 'Последняя сработка',
  'sec.rules.empty': 'Правил пока нет. Создайте первое — или запустите сид, чтобы получить примеры.',
  'sec.rules.enabled': 'Правило включено',
  'sec.rules.disabled': 'Правило выключено',
  'sec.rules.open': 'новых: {n}',
  'sec.rules.safety': 'Правила никогда не блокируют доверенные адреса (приоритет трафика), адреса, с которых входят сотрудники, и учётки сотрудников — это только руками.',
  'sec.rules.saved': 'Правило сохранено',
  'sec.rules.created': 'Создано {when}',
  'sec.rules.active': 'Включено',
  'sec.rules.off': 'Выключено',
  'sec.rules.sentence.if': 'Если',
  'sec.rules.sentence.in': 'в журнале «{source}»',
  'sec.rules.section.about': 'О правиле',
  'sec.rules.section.count': 'Что считать',
  'sec.rules.section.do': 'Что делать',
  'sec.rules.source': 'Журнал',
  'sec.rules.query': 'Фильтр',
  'sec.rules.queryHint': 'Тот же язык, что в обозревателе журнала. Поля:',
  'sec.rules.groupBy': 'С одного',
  'sec.rules.groupByHint': 'События считаются отдельно для каждого значения этого поля.',
  'sec.rules.measure': 'Считать',
  'sec.rules.measure.events': 'события',
  'sec.rules.measure.distinct': 'разные {field}',
  'sec.rules.threshold': 'Порог',
  'sec.rules.window': 'Окно, минут',
  'sec.rules.windowPreset': 'Быстрый выбор',
  'sec.rules.severity': 'Важность',
  'sec.rules.actionHint': 'Блок адреса — только при группировке по ip; блок пользователя — только по {field}.',
  'sec.rules.blockFor': 'Срок блокировки',
  'sec.rules.cooldown': 'Пауза между сработками, минут',
  'sec.rules.cooldownHint': 'Тот же ключ не вызовет правило повторно раньше этого срока.',
  'sec.rules.enabledLabel': 'Правило включено (проверяется каждые 30 секунд)',
  'sec.rules.preview': 'Проверить на данных',
  'sec.rules.ran': 'Готово: сработок {hits}, групп за порогом {groups}',
  'sec.rules.runNow': 'Запустить сейчас',
  'sec.rules.deleteConfirm': 'Удалить правило вместе со сработками?',
  'sec.rules.deleted': 'Правило удалено',
  'sec.rules.delete': 'Удалить',
  'sec.rules.previewTitle': 'Сработало бы сейчас: {n}',
  'sec.rules.previewEmpty': 'В окне ничего не перешло порог (с {window}).',
  'sec.rules.protected': 'защищён',

  'sec.traffic.attackOn': 'Режим атаки включён',
  'sec.traffic.attackOff': 'Режим атаки выключен',
  'sec.traffic.attackOnHint': 'Запросы с весом ниже {n} сразу получают 503. Доверенные адреса, пользователи и роли сотрудников продолжают работать.',
  'sec.traffic.attackOffHint': 'Включите при DDoS: анонимы и обычные пользователи получат 503, а панель администратора продолжит работать.',
  'sec.traffic.disabledWarn': 'Приоритизация запросов выключена в настройках ниже.',
  'sec.traffic.attackMinWeight': 'Минимальный вес',
  'sec.traffic.attackStopped': 'Режим атаки выключен',
  'sec.traffic.attackStarted': 'Режим атаки включён',
  'sec.traffic.attackDisable': 'Выключить',
  'sec.traffic.attackEnable': 'Включить режим атаки',
  'sec.traffic.youWouldBe': 'Ваш вес: {n}',
  'sec.traffic.you': 'Ваш вес: {n}',
  'sec.traffic.youSafe': 'Вы выше порога режима атаки — панель останется вам доступна.',
  'sec.traffic.youUnsafe': 'Вы ниже порога режима атаки. Добавьте свой адрес или учётку в доверенные.',
  'sec.traffic.yourIp': 'Ваш адрес:',
  'sec.traffic.myIpNote': 'адрес администратора',
  'sec.traffic.trustedAdded': 'Добавлено в доверенные',
  'sec.traffic.trustMyIp': 'Доверять моему адресу',
  'sec.traffic.inFlight': 'В работе / лимит',
  'sec.traffic.queued': 'В очереди',
  'sec.traffic.lag': 'Задержка цикла',
  'sec.traffic.ms': '{n} мс',
  'sec.traffic.trustedCount': 'Доверенные',
  'sec.traffic.trustedValue': '{ips} адр. · {users} польз.',
  'sec.traffic.chart': 'Последние 10 минут',
  'sec.traffic.part.bypass': 'Приоритетные',
  'sec.traffic.part.admitted': 'Сразу',
  'sec.traffic.part.queued': 'Через очередь',
  'sec.traffic.part.shed': 'Отказ (503)',
  'sec.traffic.talkers': 'Топ адресов по запросам',
  'sec.traffic.talkersHint': 'Кто сейчас шлёт в API больше всех. Клик — контекст адреса; можно заблокировать или добавить в доверенные.',
  'sec.traffic.talkersEmpty': 'Запросов пока нет.',
  'sec.traffic.perMinute': 'в мин',
  'sec.traffic.weight': 'Вес',
  'sec.traffic.trust': 'Доверять',
  'sec.traffic.block': 'Заблокировать',
  'sec.traffic.blockReason': 'Приоритет трафика: {n} запросов в минуту',
  'sec.traffic.priorities': 'Доверенные адреса и пользователи',
  'sec.traffic.prioritiesHint': 'Их запросы обслуживаются первыми и проходят режим атаки. Доверенные адреса ещё и не попадают под лимиты nginx и никогда не блокируются правилами.',
  'sec.traffic.kind.IP': 'Адрес',
  'sec.traffic.kind.USER': 'Пользователь',
  'sec.traffic.loginPlaceholder': 'логин',
  'sec.traffic.note': 'Заметка',
  'sec.traffic.add': 'Добавить',
  'sec.traffic.prioritiesEmpty': 'Доверенных пока нет. Начните со своего адреса.',
  'sec.traffic.remove': 'Убрать',
  'sec.traffic.settings': 'Очередь и веса',
  'sec.traffic.settingsHint': 'Каждый запрос к API получает вес от 0 до 100 — максимум из веса адреса, пользователя, роли и пропуска приоритета. Когда лимит занят, первыми обслуживаются более тяжёлые.',
  'sec.traffic.enabled': 'Приоритизировать запросы (очередь по весам)',
  'sec.traffic.field.maxConcurrent': 'Одновременных запросов',
  'sec.traffic.field.maxConcurrent.hint': 'При задержке цикла событий урезается вдвое.',
  'sec.traffic.field.queueMax': 'Длина очереди',
  'sec.traffic.field.queueMax.hint': 'При переполнении выбывает самый лёгкий.',
  'sec.traffic.field.queueTimeoutMs': 'Ожидание, мс',
  'sec.traffic.field.queueTimeoutMs.hint': 'Дольше — 503 с Retry-After.',
  'sec.traffic.field.lagThresholdMs': 'Порог задержки, мс',
  'sec.traffic.field.lagThresholdMs.hint': 'p99 задержки цикла событий.',
  'sec.traffic.field.bypassWeight': 'Вес «мимо очереди»',
  'sec.traffic.field.bypassWeight.hint': 'С этого веса запрос не ждёт в очереди.',
  'sec.traffic.field.anonymousWeight': 'Вес анонима',
  'sec.traffic.field.anonymousWeight.hint': 'Посетители без сессии.',
  'sec.traffic.field.authenticatedWeight': 'Вес вошедшего',
  'sec.traffic.field.authenticatedWeight.hint': 'Любой пользователь с действующим токеном.',
  'sec.traffic.roleWeights': 'Веса ролей',
  'sec.traffic.roleWeightsHint': 'Пусто — вес вошедшего. Сотрудники после входа получают пропуск приоритета и смогут войти снова даже во время атаки.',
  'sec.traffic.saved': 'Настройки сохранены',
  'sec.traffic.reset': 'Сбросить изменения',

  'sec.dash.newName': 'Новый дашборд',
  'sec.dash.done': 'Готово',
  'sec.dash.edit': 'Настроить',
  'sec.dash.new': 'Новый дашборд',
  'sec.dash.shared': 'Общий',
  'sec.dash.deleteConfirm': 'Удалить дашборд «{name}»?',
  'sec.dash.deleted': 'Дашборд удалён',
  'sec.dash.empty': 'На этом дашборде пока нет виджетов.',
  'sec.dash.addWidget': 'Добавить виджет',
  'sec.dash.name': 'Название дашборда',
  'sec.dash.shareLabel': 'Виден коллегам',
  'sec.dash.delete': 'Удалить дашборд',
  'sec.dash.moveLeft': 'Сдвинуть назад',
  'sec.dash.moveRight': 'Сдвинуть вперёд',
  'sec.dash.resize': 'Размер: {size}',
  'sec.dash.editWidget': 'Изменить виджет',
  'sec.dash.removeWidget': 'Убрать виджет',
  'sec.widget.type.counter': 'Счётчик',
  'sec.widget.type.counter.hint': 'Сколько событий по фильтру за период, с трендом.',
  'sec.widget.type.histogram': 'Гистограмма',
  'sec.widget.type.histogram.hint': 'События во времени; выделение приближает весь дашборд.',
  'sec.widget.type.top': 'Топ значений',
  'sec.widget.type.top.hint': 'Самые частые адреса, пользователи, действия или причины.',
  'sec.widget.type.events': 'Последние события',
  'sec.widget.type.events.hint': 'Живая лента журнала по фильтру.',
  'sec.widget.type.hits': 'Сработки',
  'sec.widget.type.hits.hint': 'Новые срабатывания правил корреляции.',
  'sec.widget.type.traffic': 'Нагрузка',
  'sec.widget.type.traffic.hint': 'Запросы в работе, очередь, отказы, режим атаки.',
  'sec.widget.type.blocks': 'Блокировки',
  'sec.widget.type.blocks.hint': 'Действующие блоки по уровням.',
  'sec.widget.size.s': 'S',
  'sec.widget.size.m': 'M',
  'sec.widget.size.l': 'L',
  'sec.widget.size.full': 'Во всю ширину',
  'sec.widget.openAll': 'Открыть все ({n})',
  'sec.widget.typeTitle': 'Тип виджета',
  'sec.widget.settings': 'Настройки',
  'sec.widget.title': 'Заголовок',
  'sec.widget.queryHint': 'Тот же язык фильтра, что в обозревателе журнала; пусто — все события.',
  'sec.widget.field': 'Поле',
  'sec.widget.size': 'Размер',

  'nav.downloads': 'Загрузчик',
  'nav.admin.launcher': 'Загрузчик',

  'launcher.badge': 'Подписанные релизы · проверенная контрольная сумма',
  'launcher.title': 'Загрузчик',
  'launcher.subtitle': 'Одно приложение для всех ваших продуктов: входит в аккаунт, скачивает и обновляет сборки и проверяет их целостность перед каждым запуском.',
  'launcher.platform.WINDOWS': 'Windows',
  'launcher.platform.LINUX': 'Linux',
  'launcher.platform.MACOS': 'macOS',
  'launcher.none': 'Доступных версий пока нет',
  'launcher.noneHint': 'Администратор ещё не опубликовал загрузчик для вас. Загляните позже.',
  'launcher.noneLicense': 'Загрузчик станет доступен, когда у вас появится действующая лицензия.',
  'launcher.toCatalog': 'Выбрать тариф',
  'launcher.beta': 'Бета-канал',
  'launcher.history': 'Прошлые версии',
  'launcher.version': 'Версия {version}',
  'launcher.channel.STABLE': 'Стабильная',
  'launcher.channel.BETA': 'Бета',
  'launcher.mandatory': 'обязательное обновление',
  'launcher.download': 'Скачать для {platform}',
  'launcher.downloadShort': 'Скачать',
  'launcher.copied': 'Контрольная сумма скопирована',
  'launcher.sha256Hint': 'Сверьте со скачанным файлом: Get-FileHash .\\file.exe',
  'launcher.notes': 'Что нового',
  'launcher.requirements': 'Системные требования',
  'launcher.steps': 'Как установить',

  'launcherAdmin.title': 'Загрузчик',
  'launcherAdmin.description': 'Релизы клиента-загрузчика: версии по платформам и каналам, файл с хешем от сервера и кому его можно скачать — всем с главной, вошедшим, владельцам лицензий или выбранным ролям.',
  'launcherAdmin.new': 'Новый релиз',
  'launcherAdmin.stat.published': 'Опубликовано',
  'launcherAdmin.stat.drafts': 'Черновиков',
  'launcherAdmin.stat.downloads': 'Скачиваний',
  'launcherAdmin.column.version': 'Версия',
  'launcherAdmin.column.audience': 'Кому доступен',
  'launcherAdmin.column.file': 'Файл',
  'launcherAdmin.column.status': 'Статус',
  'launcherAdmin.column.downloads': 'Скачиваний',
  'launcherAdmin.empty': 'Релизов пока нет. Создайте первый и загрузите установщик.',
  'launcherAdmin.audience.PUBLIC': 'Всем',
  'launcherAdmin.audience.PUBLIC.hint': 'Кнопка «Скачать» есть и на главной, вход не нужен.',
  'launcherAdmin.audience.USERS': 'Вошедшим',
  'launcherAdmin.audience.USERS.hint': 'Любому пользователю в кабинете.',
  'launcherAdmin.audience.LICENSED': 'Владельцам лицензий',
  'launcherAdmin.audience.LICENSED.hint': 'Только тем, у кого есть действующая лицензия.',
  'launcherAdmin.audience.ROLES': 'Выбранным ролям',
  'launcherAdmin.audience.ROLES.hint': 'Бета-тестеры, сотрудники — у кого есть одна из ролей ниже.',
  'launcherAdmin.noFile': 'нет файла',
  'launcherAdmin.published': 'Опубликован {date}',
  'launcherAdmin.publishedShort': 'Опубликован',
  'launcherAdmin.draft': 'Черновик',
  'launcherAdmin.saved': 'Сохранено',
  'launcherAdmin.uploaded': 'Файл загружен, хеш посчитан',
  'launcherAdmin.section.release': 'Релиз',
  'launcherAdmin.section.file': 'Файл установщика',
  'launcherAdmin.section.publish': 'Публикация',
  'launcherAdmin.field.version': 'Версия',
  'launcherAdmin.field.channel': 'Канал',
  'launcherAdmin.field.platform': 'Платформа',
  'launcherAdmin.field.notes': 'Что нового',
  'launcherAdmin.field.notesHint': 'Показывается пользователям рядом с кнопкой скачивания. По изменению в строке.',
  'launcherAdmin.field.audience': 'Кому доступен',
  'launcherAdmin.field.roles': 'Роли',
  'launcherAdmin.field.mandatory': 'Обязательное обновление: старые версии загрузчика обязаны обновиться до этой',
  'launcherAdmin.lockedHint': 'Версию, платформу и канал опубликованного релиза не меняют — выпустите новый.',
  'launcherAdmin.create': 'Создать черновик',
  'launcherAdmin.size': 'Размер',
  'launcherAdmin.uploading': 'Загрузка… {n}%',
  'launcherAdmin.replace': 'Перетащите файл сюда, чтобы заменить',
  'launcherAdmin.drop': 'Перетащите установщик сюда или нажмите, чтобы выбрать',
  'launcherAdmin.createdBy': 'Создан',
  'launcherAdmin.publish': 'Опубликовать',
  'launcherAdmin.unpublish': 'Снять с публикации',
  'launcherAdmin.publishedToast': 'Релиз опубликован',
  'launcherAdmin.unpublished': 'Релиз снят с публикации — скачать его больше нельзя',
  'launcherAdmin.deleteConfirm': 'Удалить этот черновик?',
  'launcherAdmin.delete': 'Удалить',
  'launcherAdmin.needFile': 'Чтобы опубликовать релиз, загрузите файл.',
  'launcherAdmin.page.title': 'Страница загрузки',
  'launcherAdmin.page.hint': 'Показывается в кабинете и на главной рядом с кнопками скачивания.',
  'launcherAdmin.page.lines': 'По пункту в строке.',

  'landing.brand': 'License Platform',
  'landing.backHome': 'На главную',
  'landing.nav.products': 'Продукты',
  'landing.nav.pricing': 'Тарифы',
  'landing.nav.security': 'Безопасность',
  'landing.nav.launcher': 'Загрузчик',
  'landing.nav.login': 'Войти',
  'landing.nav.register': 'Начать',
  'landing.nav.cabinet': 'В кабинет',
  'landing.hero.eyebrow': 'Новое поколение защищённого софта',
  'landing.hero.title1': 'Мощность, которая',
  'landing.hero.title2': 'остаётся вашей.',
  'landing.hero.subtitle': 'Премиальные продукты с привязкой к устройству, зашифрованной доставкой и мгновенной активацией. Один загрузчик, все обновления, никакой возни.',
  'landing.hero.download': 'Скачать для {platform}',
  'landing.hero.getLauncher': 'Получить загрузчик',
  'landing.hero.pricing': 'Смотреть тарифы',
  'landing.hero.releaseMeta': 'Версия {version} · {size} · бесплатно',
  'landing.mock.product1': 'Ваш продукт',
  'landing.mock.product2': 'Следующий релиз',
  'landing.mock.title': 'Загрузчик',
  'landing.mock.ready': 'Готово',
  'landing.mock.updating': 'Обновление',
  'landing.mock.protected': 'Сессия защищена',
  'landing.stats.products': 'продуктов',
  'landing.stats.from': 'стартовая цена',
  'landing.stats.encryption': 'шифрование доставки',
  'landing.stats.support': 'поддержка',
  'landing.products.eyebrow': 'Продукты',
  'landing.products.title': 'Создано для результата. Защищено by design.',
  'landing.products.subtitle': 'Каждый продукт приходит через загрузчик: подписанные сборки, автоматические обновления, проверка лицензии на каждом запуске.',
  'landing.products.plans': 'Тарифов: {n}',
  'landing.products.point1': 'Привязка к устройству — ключ работает только у вас',
  'landing.products.point2': 'Обновления приходят сами через загрузчик',
  'landing.products.point3': 'Мгновенная активация сразу после оплаты',
  'landing.products.from': 'от',
  'landing.products.buy': 'Купить',
  'landing.pricing.eyebrow': 'Тарифы',
  'landing.pricing.title': 'Выберите свой темп.',
  'landing.pricing.subtitle': 'Платите за нужный срок. Чем длиннее тариф, тем дешевле день.',
  'landing.pricing.best': 'Выгоднее всего',
  'landing.pricing.perDay': '{price} в день',
  'landing.pricing.choose': 'Выбрать',
  'landing.features.eyebrow': 'Почему мы',
  'landing.features.title': 'Безопасность, о которой не нужно думать.',
  'landing.features.hwid.title': 'Привязка к устройству',
  'landing.features.hwid.text': 'Лицензия закреплена за вашим железом. Утёкший ключ бесполезен на чужом ПК.',
  'landing.features.crypto.title': 'Шифрованная доставка',
  'landing.features.crypto.text': 'Сборки передаются под AES-256-GCM и не лежат на диске в открытом виде.',
  'landing.features.instant.title': 'Мгновенная активация',
  'landing.features.instant.text': 'Оплатили — лицензия уже в кабинете. Без ожидания менеджера.',
  'landing.features.updates.title': 'Всегда актуально',
  'landing.features.updates.text': 'Загрузчик сам скачивает новые версии и сверяет контрольную сумму каждого файла.',
  'landing.features.ddos.title': 'Устойчивая платформа',
  'landing.features.ddos.text': 'Блокировки на уровне фаервола, правила корреляции и приоритет трафика держат сервис на связи.',
  'landing.features.support.title': 'Живая поддержка',
  'landing.features.support.text': 'На вопросы об активации и устройствах отвечают люди, а не бот.',
  'landing.launcher.eyebrow': 'Загрузчик',
  'landing.launcher.title': 'Одно приложение. Все продукты.',
  'landing.launcher.subtitle': 'Войдите один раз — загрузчик держит ваши продукты установленными, обновлёнными и проверенными.',
  'landing.launcher.for': 'Для {platform}',
  'landing.launcher.inCabinet': 'Открыть в кабинете',
  'landing.launcher.loginToDownload': 'Войти и скачать',
  'landing.final.title': 'Всё готово. Дело за вами.',
  'landing.final.subtitle': 'Создайте аккаунт за минуту и выберите подходящий тариф.',
  'landing.final.start': 'Создать аккаунт',
  'siem.fields': 'Поля:',
  'siem.syntax': '· * — подстановка · пробел или AND — оба условия · OR или | — любое · NOT или - — исключить · ( ) — группировка · "фраза"',
  'siem.empty': 'Ничего не найдено.',
  'siem.total': 'Найдено: {total}',
  'siem.histogram': 'События во времени',
  'siem.interval': 'шаг {interval}',
  'siem.failed': 'неудачно',
  'siem.success': 'успешно',
  'siem.top': 'Топ: {field}',
  'siem.include': 'Фильтровать по значению',
  'siem.exclude': 'Исключить значение',
  'siem.column.time': 'Время',
  'siem.column.actor': 'Кто',
  'siem.column.action': 'Действие',
  'siem.column.entity': 'Объект',
  'siem.column.ip': 'IP',
  'siem.column.user': 'Пользователь',
  'siem.column.result': 'Итог',
  'siem.column.reason': 'Причина',
  'siem.column.method': 'Способ',
  'security.blocks.ipTitle': 'Заблокированные адреса',
  'security.blocks.ipHint': 'Запросы с этих адресов и подсетей отклоняются ещё до входа. Свой адрес заблокировать нельзя.',
  'security.blocks.ipDone': 'Адрес заблокирован',
  'security.blocks.ipEmpty': 'Заблокированных адресов нет.',
  'security.blocks.reason': 'Причина',
  'security.blocks.duration.1': 'На час',
  'security.blocks.duration.24': 'На сутки',
  'security.blocks.duration.168': 'На неделю',
  'security.blocks.duration.720': 'На месяц',
  'security.blocks.duration.0': 'Навсегда',
  'security.blocks.block': 'Заблокировать',
  'security.blocks.unblock': 'Снять блокировку',
  'security.blocks.removed': 'Блокировка снята',
  'security.blocks.column.cidr': 'Адрес / подсеть',
  'security.blocks.column.by': 'Кто',
  'security.blocks.column.until': 'До',
  'security.blocks.expired': 'истекла',
  'security.blocks.forever': 'навсегда',
  'security.blocks.userTitle': 'Блокировка по логину',
  'security.blocks.userHint': 'Аккаунт блокируется, все его сессии сразу завершаются.',
  'security.blocks.username': 'Логин',
  'security.blocks.userDone': '{username} заблокирован',

  /* Реквизиты оплаты */
  'admin.payments.channels.title': 'Каналы оплаты',
  'admin.payments.channels.description': 'Глобальные выключатели и названия на витрине. Товар принимает способ, только если его канал включён.',
  'admin.profiles.title': 'Шаблоны реквизитов',
  'admin.profiles.description': 'Магазин ЮKassa или набор крипто-кошельков. Настраивается один раз и привязывается к любым товарам.',
  'admin.profiles.create.YOOKASSA': 'Шаблон ЮKassa',
  'admin.profiles.create.CRYPTO': 'Шаблон крипты',
  'admin.profiles.empty': 'Шаблонов пока нет.',
  'admin.profiles.inUse': 'Привязан к товарам — сначала отвяжите',
  'admin.profiles.delete': 'Удалить для всех',
  'admin.profiles.deleted': 'Реквизиты удалены и сняты со всех товаров',
  'admin.profiles.ready': 'готов',
  'admin.profiles.notReady': 'не готов',
  'admin.profiles.usedBy': {
    one: 'Используется в {count} товаре',
    few: 'Используется в {count} товарах',
    many: 'Используется в {count} товарах',
    other: 'Используется в {count} товарах',
  },
  'admin.profiles.field.name': 'Название',
  'admin.profiles.field.namePlaceholder': 'Основной магазин',
  'admin.productPayments.title': 'Оплата',
  'admin.productPayments.description':
    'Куда идут деньги за товар. На каждый способ можно привязать сколько угодно реквизитов — шаблонов или своих; они перечислены ниже.',
  'admin.productPayments.channelOff': 'канал выключен',
  'admin.productPayments.accept': 'Принимать',
  'admin.productPayments.none': 'Не принимать',
  'admin.productPayments.templates': 'Шаблоны',
  'admin.productPayments.personal': 'Свои реквизиты товара',
  'admin.productPayments.createPersonal': 'Свои реквизиты',
  'admin.productPayments.editPersonal': 'Изменить реквизиты',
  'admin.productPayments.notAccepted': 'Этим способом товар не продаётся.',
  'admin.productPayments.usesTemplate': 'Оплата идёт на шаблон «{name}».',
  'admin.productPayments.usesPersonal': 'Оплата идёт на свои реквизиты товара.',
  'admin.productPayments.enableChannel': 'Включить канал',
  'admin.productPayments.hiddenFromBuyers': 'Покупатели не увидят этот способ оплаты:',
  'admin.productPayments.reasonDisabled': 'Для товара выключено «Принимать оплату».',
  'admin.productPayments.reasonChannelOff': 'Канал оплаты выключен для всей платформы.',
  'admin.productPayments.reasonNoLive': 'Среди привязанных реквизитов нет одновременно включённых и готовых.',
  'admin.productPayments.liveCount': {
    one: 'принимают: {count}',
    few: 'принимают: {count}',
    many: 'принимают: {count}',
    other: 'принимают: {count}',
  },
  'admin.productPayments.off': 'выключены',
  'admin.productPayments.detach': 'Отвязать от товара (реквизиты останутся в реестре)',
  'admin.productPayments.templateShared': {
    one: 'Шаблон привязан к {count} товару — изменения применятся ко всем.',
    few: 'Шаблон привязан к {count} товарам — изменения применятся ко всем.',
    many: 'Шаблон привязан к {count} товарам — изменения применятся ко всем.',
    other: 'Шаблон привязан к {count} товарам — изменения применятся ко всем.',
  },
  'admin.productPayments.attachExisting': 'Привязать существующие реквизиты…',
  'admin.productPayments.addWallet': 'Новый кошелёк',
  'admin.productPayments.buyerChooses': 'Если реквизитов несколько, покупатель сам выбирает, куда платить.',
  'admin.profiles.problem.name': 'Укажите название — по нему реквизиты ищутся в реестре.',
  'admin.profiles.noWallets': 'нет кошельков',
  'admin.profiles.shopConnected': 'ключи магазина заданы',
  'admin.profiles.shopNotConnected': 'ключи магазина не заданы',
  'admin.profiles.kind.TEMPLATE': 'Шаблон',
  'admin.profiles.kind.PERSONAL': 'Личные товара',
  'admin.profiles.registry.title': 'Реквизиты',
  'admin.profiles.registry.description':
    'Все реквизиты в системе: шаблоны и личные реквизиты товаров. Кто создал, когда и к каким товарам привязаны. Удаление снимает реквизиты сразу со всех товаров.',
  'admin.profiles.registry.queryPlaceholder': 'kind:personal (creator:test OR product:fc26) NOT wallet:T9*',
  'admin.profiles.registry.anyProvider': 'Любой способ',
  'admin.profiles.registry.anyKind': 'Любой вид',
  'admin.profiles.registry.bulkDelete': 'Удалить для всех',
  'admin.profiles.registry.empty': 'Под фильтр не попали ни одни реквизиты.',
  'admin.profiles.registry.column.name': 'Реквизиты',
  'admin.profiles.registry.column.contents': 'Кошельки / магазин',
  'admin.profiles.registry.column.products': 'Товары',
  'admin.profiles.registry.column.state': 'Состояние',
  'admin.profiles.registry.column.creator': 'Создал',
  'admin.profiles.registry.column.created': 'Создано',
  'admin.profiles.registry.unattached': 'не привязаны',
  'admin.profiles.registry.deleteTitle': 'Удалить «{name}»?',
  'admin.profiles.registry.deleteAttached': 'Реквизиты привязаны к: {products}. Они будут сняты с этих товаров, и покупатели больше не смогут на них платить.',
  'admin.profiles.registry.deleteHint': 'Реквизиты исчезнут из реестра и со всех товаров. Уже выставленные платежи по-прежнему можно проверить.',
  'admin.profiles.registry.bulkDeleteTitle': 'Удалить выбранные реквизиты для всех',

  /* Пользователи: поиск и адреса */
  'admin.users.queryPlaceholder': 'username:bob role:support status:BLOCKED',
  'admin.users.queryPlaceholderIp': 'ip:203.0.113.0/24 role:user status:ACTIVE',
  'admin.users.column.ips': 'Адреса',
  'admin.users.searchByIp': 'Найти всех с этим адресом',
  'admin.users.section.ips': 'Адреса',
  'admin.users.ipsHint': 'Все IP, с которых работал пользователь. Общие адреса часто означают второй аккаунт.',
  'admin.users.noIps': 'Адресов пока нет.',
  'admin.users.ip.lastSeen': 'Последний раз',
  'admin.users.ip.firstSeen': 'Впервые',
  'admin.users.ip.hits': 'Раз',
  'admin.users.ip.shared': 'Другие аккаунты',
  'admin.users.ip.blocked': 'заблокирован',
  'admin.users.ip.sharedLink': {
    one: '{count} аккаунт',
    few: '{count} аккаунта',
    many: '{count} аккаунтов',
    other: '{count} аккаунта',
  },
  'admin.users.ip.blockReason': 'Адрес пользователя {username}',

  /* Баннер «пароль не задан» */
  'shell.passwordRequired.title': 'Задайте пароль.',
  'shell.passwordRequired.body':
    'Без пароля лицензия не выдаётся и загрузчик не запускается.',
  'shell.passwordRequired.action': 'Задать пароль',

  /* ---------------------------------------------------------------- */
  /* Мои лицензии — список                                             */
  /* ---------------------------------------------------------------- */
  'licenses.list.title': 'Мои лицензии',
  'licenses.list.count': {
    one: '{count} лицензия',
    few: '{count} лицензии',
    many: '{count} лицензий',
    other: '{count} лицензии',
  },
  'licenses.list.loading': 'Загружаем список…',
  'licenses.list.search.placeholder': 'Поиск по ключу',
  'licenses.list.search.aria': 'Поиск по ключу лицензии',
  'licenses.list.status.aria': 'Статус лицензии',
  'licenses.list.status.all': 'Все статусы',

  'licenses.empty.title': 'Лицензий пока нет',
  'licenses.empty.description':
    'Купите доступ в каталоге, а код из магазина активируйте здесь — лицензия появится сразу после активации.',
  'licenses.empty.action.catalog': 'Выбрать тариф',
  'licenses.empty.action.activate': 'У меня есть код',

  'licenses.emptyFiltered.title': 'Ничего не нашлось',
  'licenses.emptyFiltered.description':
    'Под выбранные фильтры не подходит ни одна лицензия.',

  'licenses.error.load': 'Не удалось загрузить лицензии.',
  'licenses.error.forbidden.title': 'Раздел недоступен',
  'licenses.error.forbidden.description':
    'У вашей учётной записи нет права просматривать лицензии. Если это ошибка, обратитесь в поддержку.',

  /* ---------------------------------------------------------------- */
  /* Лицензия: статусы и подсказки «что делать дальше»                 */
  /* ---------------------------------------------------------------- */
  'licenses.status.PENDING.label': 'Ожидает запуска',
  'licenses.status.ACTIVE.label': 'Активна',
  'licenses.status.EXPIRED.label': 'Срок истёк',
  'licenses.status.BLOCKED.label': 'Заблокирована',
  'licenses.status.REVOKED.label': 'Отозвана',

  'licenses.status.PENDING.hint':
    'Срок начнёт идти с первого запуска лаунчера — до этого момента оплаченные дни не расходуются.',
  'licenses.status.ACTIVE.hint':
    'Лицензия работает. Запускайте продукт через лаунчер.',
  'licenses.status.EXPIRED.hint':
    'Чтобы продолжить пользоваться продуктом, продлите лицензию.',
  'licenses.status.BLOCKED.hint':
    'Доступ приостановлен администратором. Причина указана ниже.',
  'licenses.status.REVOKED.hint':
    'Лицензия отозвана — например, после возврата средств. Восстановить её нельзя.',

  /* ---------------------------------------------------------------- */
  /* Тариф: срок действия                                              */
  /* ---------------------------------------------------------------- */
  'licenses.plan.lifetime': 'бессрочно',
  'licenses.plan.years': {
    one: '{count} год',
    few: '{count} года',
    many: '{count} лет',
    other: '{count} года',
  },
  'licenses.plan.months': {
    one: '{count} месяц',
    few: '{count} месяца',
    many: '{count} месяцев',
    other: '{count} месяца',
  },
  'licenses.plan.days': {
    one: '{count} день',
    few: '{count} дня',
    many: '{count} дней',
    other: '{count} дня',
  },

  /* ---------------------------------------------------------------- */
  /* Подписи полей лицензии: одни и те же в списке и в карточке        */
  /* ---------------------------------------------------------------- */
  'licenses.key.label': 'Ключ лицензии',
  'licenses.field.product': 'Продукт',
  'licenses.field.plan': 'Тариф',
  'licenses.field.issued': 'Выдана',
  'licenses.field.activated': 'Активирована',
  'licenses.field.expires': 'Действует до',
  'licenses.field.term': 'Срок',
  'licenses.field.remaining': 'Осталось',

  /* ---------------------------------------------------------------- */
  /* Карточка лицензии в списке                                        */
  /* ---------------------------------------------------------------- */
  'licenses.card.term.notStarted': 'ещё не начат',
  'licenses.card.remaining': {
    one: 'осталось {count} день',
    few: 'осталось {count} дня',
    many: 'осталось {count} дней',
    other: 'осталось {count} дня',
  },
  'licenses.card.blockedReason': 'Причина блокировки: {reason}',
  'licenses.card.revokedReason': 'Причина отзыва: {reason}',
  'licenses.card.device.bound': 'Привязана к устройству',
  'licenses.card.device.unbound': 'Устройство ещё не привязано',
  'licenses.card.action.details': 'Подробности и привязка',

  /* ---------------------------------------------------------------- */
  /* Карточка лицензии — отдельный экран                               */
  /* ---------------------------------------------------------------- */
  'licenses.detail.back': 'Все лицензии',
  'licenses.detail.credentials.title': 'Реквизиты',
  'licenses.detail.key.hint':
    'Ключ подтверждает право доступа: не публикуйте его и не пересылайте никому, кроме поддержки.',
  'licenses.detail.activated.never': 'ещё не активирована',
  'licenses.detail.expires.notStarted': 'отсчёт не начат',
  'licenses.detail.remaining.fullTerm': 'весь оплаченный срок',
  'licenses.detail.remaining.days': {
    one: '{count} день',
    few: '{count} дня',
    many: '{count} дней',
    other: '{count} дня',
  },
  'licenses.detail.remaining.ended': 'срок закончился',
  'licenses.detail.remaining.unlimited': 'без ограничения',
  'licenses.detail.blocked.title': 'Лицензия заблокирована',
  'licenses.detail.revoked.title': 'Лицензия отозвана',
  'licenses.detail.device.title': 'Устройство',
  'licenses.detail.device.description':
    'Лицензия работает на одном устройстве — том, с которого её запустили первым.',
  'licenses.detail.tab.binding': 'Привязка',
  'licenses.detail.tab.history': 'История',
  'licenses.detail.history.limited': 'Показаны последние 20 событий.',
  'licenses.detail.history.error': 'Не удалось загрузить историю привязок.',
  'licenses.detail.error.missing.title': 'Лицензия не найдена',
  'licenses.detail.error.missing.description':
    'Такой лицензии нет среди ваших. Возможно, вы вошли другим аккаунтом или ссылка устарела.',
  'licenses.detail.error.missing.action': 'К списку лицензий',
  'licenses.detail.error.load': 'Не удалось загрузить лицензию.',

  /* ---------------------------------------------------------------- */
  /* Привязка к устройству                                             */
  /* ---------------------------------------------------------------- */
  'hwid.resetsLeft': {
    one: 'остался {count} сброс',
    few: 'осталось {count} сброса',
    many: 'осталось {count} сбросов',
    other: 'осталось {count} сброса',
  },

  'hwid.summary.bound.title': 'Лицензия привязана к устройству',
  'hwid.summary.bound.description':
    'Запуск на другом компьютере продукт не пропустит: сервер сверяет устройство при каждой проверке лицензии. Чтобы переехать, сбросьте привязку.',
  'hwid.summary.unbound.title': 'Устройство ещё не привязано',
  'hwid.summary.unbound.description':
    'Привязка появится автоматически при первом запуске лаунчера — и вместе с ней начнётся отсчёт оплаченного срока.',
  'hwid.summary.hidden':
    'Идентификатор устройства не отображается: он хранится только на сервере в необратимом виде и не показывается даже владельцу лицензии.',

  'hwid.field.boundAt': 'Привязано',
  'hwid.field.lastSeen': 'Последняя проверка',
  'hwid.field.resetsUsed': 'Сбросов использовано',
  'hwid.field.resetsUsed.value': '{used} из {total}',
  'hwid.field.resetsLeft': 'Осталось сбросов',
  'hwid.field.lastReset': 'Последний сброс',
  'hwid.field.lastReset.never': 'не было',
  'hwid.field.nextReset': 'Следующий сброс',
  'hwid.field.nextReset.now': 'доступен сейчас',

  'hwid.change.title': 'Сменить устройство',
  'hwid.change.description':
    'Сброс нужен только при переезде на другое железо: после него первое же устройство, с которого запустят лаунчер, станет новым основным.',
  'hwid.change.sharedLimit':
    'Счётчик сбросов общий: сброс, сделанный поддержкой или продавцом, расходует тот же лимит, что и ваш собственный.',

  'hwid.reset.action': 'Сбросить привязку',
  'hwid.reset.notBound':
    'Привязки нет — сбрасывать нечего. Устройство закрепится автоматически при первом запуске лаунчера.',
  'hwid.reset.notAllowed':
    'Самостоятельный сброс для этой учётной записи недоступен. Снять привязку может поддержка — напишите ей, указав ключ лицензии.',
  'hwid.reset.limitReached':
    'Лимит сбросов исчерпан: использовано {used} из {total}. Обратитесь в поддержку — она сможет привязать новое устройство вручную.',
  'hwid.reset.cooldown':
    'Следующий сброс через {time} — {date}. Между сбросами должно пройти 24 часа.',
  'hwid.reset.left':
    'Осталось сбросов: {left}. Лимит выдаётся на всё время жизни лицензии и не восстанавливается.',

  'hwid.reset.confirm.title': 'Снять привязку к устройству?',
  'hwid.reset.confirm.body':
    'После сброса лицензия закрепится за тем устройством, с которого следующим запустят лаунчер. Запускать нужно именно на нужном железе.',
  'hwid.reset.confirm.cost':
    'Это израсходует один сброс из оставшихся {left}, а следующий станет доступен только через 24 часа.',
  'hwid.reset.confirm.submit': 'Сбросить',
  'hwid.reset.confirm.submitting': 'Сбрасываем…',

  'hwid.reset.toast.success':
    'Привязка снята. Следующий запуск лаунчера привяжет лицензию к тому устройству, с которого его запустят.',
  'hwid.reset.toast.cooldown':
    'Сброс будет доступен {date} — между сбросами должно пройти 24 часа.',
  'hwid.reset.toast.notBound': 'Привязки уже нет — сбрасывать нечего.',
  'hwid.reset.toast.limit':
    'Лимит сбросов исчерпан. Дальше привязку меняет только поддержка.',
  'hwid.reset.toast.error': 'Не удалось сбросить привязку.',

  'hwid.error.revoked.title': 'Лицензия отозвана',
  'hwid.error.revoked.description':
    'Привязка к устройству снята вместе с отзывом. Если отзыв кажется ошибкой, обратитесь в поддержку и укажите ключ лицензии.',
  'hwid.error.unavailable.title': 'Данные о привязке недоступны',
  'hwid.error.unavailable.description':
    'Лицензия не найдена среди ваших. Проверьте, тем ли аккаунтом вы вошли.',
  'hwid.error.load': 'Не удалось получить состояние привязки.',

  'hwid.history.empty':
    'Записей пока нет: привязка ни разу не менялась. Первая появится, когда лицензию запустят на устройстве.',
  'hwid.history.column.when': 'Когда',
  'hwid.history.column.event': 'Событие',
  'hwid.history.column.who': 'Кто',
  'hwid.history.column.comment': 'Комментарий',
  'hwid.history.reason.FIRST_BIND': 'Первая привязка',
  'hwid.history.reason.USER_RESET': 'Сброс из кабинета',
  'hwid.history.reason.ADMIN_RESET': 'Сброс поддержкой',
  'hwid.history.reason.ADMIN_MANUAL_SET': 'Устройство задано вручную',
  'hwid.history.reason.SYSTEM_REVOKE': 'Привязка снята системой',
  'hwid.history.actor.USER': 'Владелец лицензии',
  'hwid.history.actor.ADMIN': 'Администратор',
  'hwid.history.actor.SYSTEM': 'Система',
  'hwid.history.actor.API_KEY': 'Интеграция',
  'hwid.history.actor.launcher': 'Лаунчер на устройстве',
  'hwid.history.actor.unknown': 'Неизвестно',

  /* ---------------------------------------------------------------- */
  /* Вход                                                              */
  /* ---------------------------------------------------------------- */
  'login.title': 'Вход',
  'login.field.login.label': 'Логин или почта',
  'login.field.password.label': 'Пароль',
  'login.action.forgotPassword': 'Забыли пароль?',
  'login.action.submit': 'Войти',
  'login.action.register': 'Создать аккаунт',
  'login.action.registerWithKey': 'У меня есть ключ',
  'login.reason.fallback': 'Сессия завершена. Войдите заново.',

  'login.error.emailNotVerified.title': 'Адрес почты не подтверждён',
  'login.error.emailNotVerified.body':
    'Мы отправляли письмо со ссылкой при регистрации. Проверьте папку «Спам» — ссылка действует сутки.',
  'login.error.emailNotVerified.resend':
    'Письмо потерялось? Отправить его повторно нельзя, но восстановление пароля подтверждает адрес точно так же.',
  'login.error.emailNotVerified.action': 'Восстановить доступ',
  'login.error.accountBlocked.title': 'Аккаунт заблокирован',
  'login.error.accountBlocked.body':
    'Снять блокировку может только поддержка — самостоятельно это сделать нельзя.',
  'login.error.rateLimited.title': 'Слишком много попыток',
  'login.error.rateLimited.body':
    'Ограничение — 10 запросов в минуту. Подождите минуту и повторите; пароль при этом не заблокирован.',

  /* ---------------------------------------------------------------- */
  /* Вход, шаг 2 — второй фактор                                       */
  /* ---------------------------------------------------------------- */
  'login.twoFactor.title': 'Подтверждение входа',
  'login.twoFactor.description':
    'Пароль принят. Введите код из приложения-аутентификатора.',
  'login.twoFactor.field.app.label': 'Код из приложения',
  'login.twoFactor.field.recovery.label': 'Код восстановления',
  'login.twoFactor.hint':
    'Осталось попыток: {left} из {max}. Время на ввод: {time}.',
  'login.twoFactor.invalidHint':
    'Код меняется каждые 30 секунд, и уже использованный второй раз не подойдёт. Если приложение показывает верное время — дождитесь следующего кода.',
  'login.twoFactor.action.submit': 'Подтвердить',
  'login.twoFactor.action.useRecovery': 'Ввести код восстановления',
  'login.twoFactor.action.useApp': 'Ввести код из приложения',
  'login.twoFactor.action.backToPassword':
    'Отменить и ввести пароль заново',
  'login.twoFactor.notice.attemptsExceeded':
    'Попытки ввода кода исчерпаны. Введите пароль заново — счётчик обнулится.',
  'login.twoFactor.notice.challengeExpired':
    'Время подтверждения истекло. Введите пароль заново, чтобы получить новый запрос кода.',
  'login.twoFactor.notice.expired':
    'Время подтверждения истекло. Введите пароль заново.',
  'login.twoFactor.notice.cancelled': 'Вход отменён. Введите пароль заново.',

  /* ---------------------------------------------------------------- */
  /* Безопасность: пароль аккаунта                                     */
  /* ---------------------------------------------------------------- */
  'security.password.field.current.label': 'Текущий пароль',
  'security.password.field.new.label': 'Новый пароль',
  'security.password.field.confirmNew.label': 'Повторите новый пароль',
  'security.password.field.password.label': 'Пароль',
  'security.password.field.confirm.label': 'Повторите пароль',
  'security.password.field.length.hint': 'От {min} до {max} символов.',

  'security.password.validation.tooShort': 'Пароль короче {min} символов',
  'security.password.validation.tooLong': 'Пароль длиннее {max} символов',
  'security.password.validation.currentRequired': 'Введите текущий пароль',
  'security.password.validation.confirmRequired': 'Повторите новый пароль',
  'security.password.validation.repeatRequired': 'Повторите пароль',
  'security.password.validation.mismatch': 'Пароли не совпадают',
  'security.password.validation.unchanged':
    'Новый пароль совпадает с текущим',
  'security.password.error.currentInvalid': 'Текущий пароль неверен',

  'security.password.change.title': 'Смена пароля',
  'security.password.change.description':
    'Понадобится текущий пароль — это защищает аккаунт, если чужой человек добрался до уже открытой вкладки.',
  'security.password.change.notice.title': 'Остальные сессии будут завершены',
  'security.password.change.notice.description':
    'После смены пароля на других устройствах и в лаунчере придётся войти заново. Текущая вкладка продолжит работать.',
  'security.password.change.done.title': 'Пароль изменён',
  // Число стоит после двоеточия и не склоняет фразу — русскому здесь хватает
  // одной формы, английскому нужны две (см. en.ts).
  'security.password.change.done.revoked': {
    other:
      'Завершено других сессий: {count}. Если среди них была не ваша — доступ у неё уже отобран.',
  },
  'security.password.change.done.none':
    'Других активных входов не было — завершать было нечего.',
  'security.password.change.action.submit': 'Сменить пароль',
  'security.password.change.action.pending': 'Меняем…',

  'security.password.set.title': 'Задайте пароль',
  'security.password.set.description':
    'Вход выполнен через внешний сервис, и собственного пароля у аккаунта пока нет.',
  'security.password.set.why.title': 'Зачем нужен пароль',
  'security.password.set.why.license':
    'Без пароля лицензия не выдаётся и лаунчер не запускается — это требование сервера, обойти его нельзя.',
  'security.password.set.why.other':
    'Пароль также нужен, чтобы отвязать Discord или Telegram и чтобы включить двухфакторную аутентификацию: её отключение подтверждается паролем.',
  'security.password.set.alreadySet.title': 'Пароль уже задан',
  'security.password.set.alreadySet.description':
    'Похоже, его задали в другой вкладке. Данные обновлены — используйте форму смены пароля.',
  'security.password.set.action.submit': 'Задать пароль',
  'security.password.set.action.pending': 'Сохраняем…',

  /* ---------------------------------------------------------------- */
  /* Безопасность: второй фактор                                       */
  /* ---------------------------------------------------------------- */
  'security.twoFactor.title': 'Двухфакторная аутентификация',
  'security.twoFactor.state.on': 'Включена',
  'security.twoFactor.state.off': 'Выключена',

  'security.twoFactor.setup.description':
    'Сейчас выключена. При входе будет запрашиваться шестизначный код из приложения — украденного пароля станет недостаточно.',
  'security.twoFactor.setup.requirements.title': 'Что понадобится',
  'security.twoFactor.setup.requirements.app':
    'Приложение-аутентификатор на телефоне или компьютере: Google Authenticator, Aegis, 1Password, Bitwarden — подойдёт любое, поддерживающее TOTP.',
  'security.twoFactor.setup.requirements.codes':
    'Место, где вы сохраните коды восстановления: они показываются один раз и выручают, если телефон потерян.',
  'security.twoFactor.setup.needPassword.title': 'Сначала задайте пароль',
  'security.twoFactor.setup.needPassword.description':
    'Отключение второго фактора подтверждается паролем. Без пароля выключить его будет нечем — останется только поддержка.',
  'security.twoFactor.setup.action.start': 'Начать настройку',
  'security.twoFactor.setup.action.pending': 'Готовим…',

  'security.twoFactor.confirm.title': 'Шаг 2: подтвердите код',
  'security.twoFactor.confirm.description':
    'Отсканируйте QR-код приложением, затем введите шесть цифр, которые оно покажет. Пока код не подтверждён, второй фактор не включён и вход работает по-старому.',
  'security.twoFactor.confirm.manual.title': 'Если камера не читает код',
  'security.twoFactor.confirm.manual.description':
    'Добавьте аккаунт вручную и введите этот секрет:',
  'security.twoFactor.confirm.code.label': 'Код из приложения',
  'security.twoFactor.confirm.code.hint':
    'Код меняется каждые 30 секунд. Успевайте ввести текущий.',
  'security.twoFactor.confirm.error.invalid':
    'Код не подошёл. Введите тот, который показан в приложении прямо сейчас, и проверьте, что время на телефоне выставлено автоматически: расхождение часов — самая частая причина отказа.',
  'security.twoFactor.confirm.action.submit': 'Включить',
  'security.twoFactor.confirm.action.pending': 'Включаем…',
  'security.twoFactor.confirm.action.newQr': 'Показать другой QR-код',
  'security.twoFactor.confirm.action.newQr.hint':
    'Будет создан новый секрет, старый QR перестанет работать',

  'security.twoFactor.secret.copy': 'Скопировать секрет',
  'security.twoFactor.secret.copyFailed':
    'Браузер не дал доступ к буферу обмена — выделите секрет и скопируйте вручную.',

  'security.twoFactor.qr.alt': 'QR-код для приложения-аутентификатора',
  'security.twoFactor.qr.failed':
    'Не удалось нарисовать QR-код. Введите секрет в приложение вручную — он показан ниже.',

  'security.twoFactor.field.code.label': 'Код подтверждения',
  'security.twoFactor.field.code.hint':
    'Шесть цифр из приложения или один из кодов восстановления.',
  'security.twoFactor.validation.passwordRequired': 'Введите пароль',
  'security.twoFactor.validation.codeTooShort': 'Код короче {min} символов',
  'security.twoFactor.validation.codeTooLong': 'Код длиннее {max} символов',
  'security.twoFactor.error.passwordInvalid': 'Пароль неверен',
  'security.twoFactor.error.codeInvalid':
    'Код не подошёл. Каждый код срабатывает один раз — если этот уже использовался, дождитесь следующего или введите код восстановления.',

  'security.twoFactor.disable.description':
    'При входе запрашивается код из приложения. Коды восстановления, выданные при подключении, продолжают действовать — каждый по разу.',
  'security.twoFactor.disable.notice.title': 'Отключение завершит все сессии',
  'security.twoFactor.disable.notice.sessions':
    'Будут завершены все входы, включая текущий: сразу после отключения потребуется войти заново — на этом устройстве, на остальных и в лаунчере.',
  'security.twoFactor.disable.notice.codes':
    'Коды восстановления будут стёрты. Если позже включить второй фактор снова, выдадутся новые.',
  'security.twoFactor.disable.action.submit': 'Отключить',
  'security.twoFactor.disable.action.pending': 'Отключаем…',

  'security.twoFactor.disabled.title':
    'Двухфакторная аутентификация отключена',
  'security.twoFactor.disabled.description':
    'Все сессии завершены, включая текущую. Это не сбой — так задумано: после снятия второго фактора не должно остаться ни одного входа, открытого до него.',
  // «с» — сокращение секунд, оно не склоняется; английскому нужны две формы.
  'security.twoFactor.disabled.countdown': {
    other:
      'Войдите заново — теперь достаточно логина и пароля. Переход на страницу входа произойдёт автоматически через {count} с.',
  },
  'security.twoFactor.disabled.action.signIn': 'Войти заново',

  /* ---------------------------------------------------------------- */
  /* Безопасность: коды восстановления                                 */
  /* ---------------------------------------------------------------- */
  'security.recoveryCodes.title': 'Сохраните коды восстановления',
  'security.recoveryCodes.description':
    'Двухфакторная аутентификация включена. Эти коды показываются один раз — после закрытия окна получить их снова будет нельзя.',
  'security.recoveryCodes.why.title': 'Зачем они нужны',
  'security.recoveryCodes.why.description':
    'Каждый код срабатывает один раз и заменяет шестизначный код из приложения. Без них потерянный телефон означает потерю доступа к аккаунту.',
  'security.recoveryCodes.action.copy': 'Скопировать',
  'security.recoveryCodes.action.copied': 'Скопировано',
  'security.recoveryCodes.action.download': 'Скачать файлом',
  'security.recoveryCodes.action.done': 'Готово',
  'security.recoveryCodes.copyFailed':
    'Браузер не дал доступ к буферу обмена. Скачайте файл или выделите коды мышью и скопируйте вручную.',
  'security.recoveryCodes.saved.label': 'Я сохранил коды в надёжном месте',
  'security.recoveryCodes.file.title': 'Коды восстановления доступа',
  'security.recoveryCodes.file.intro':
    'Каждый код срабатывает один раз и заменяет шестизначный код из приложения.',
  'security.recoveryCodes.file.storage':
    'Держите файл там же, где храните пароли, и не пересылайте его в мессенджерах.',

  /* ---------------------------------------------------------------- */
  /* Безопасность: способы входа                                       */
  /* ---------------------------------------------------------------- */
  'security.logins.title': 'Способы входа',
  'security.logins.description':
    'Чем можно попасть в этот аккаунт. Последний оставшийся способ убрать нельзя — иначе войти будет нечем.',
  'security.logins.password.title': 'Пароль',
  'security.logins.password.description.set':
    'Вход по логину или почте вместе с паролем.',
  'security.logins.password.description.unset':
    'Пароль не задан. Без него лицензия не выдаётся и лаунчер не запускается.',
  'security.logins.password.badge.set': 'Настроен',
  'security.logins.password.badge.unset': 'Не задан',
  'security.logins.password.action.change': 'Сменить',

  'security.logins.provider.description':
    'Вход одной кнопкой через внешний сервис.',
  'security.logins.provider.badge.linked': 'Привязан',
  'security.logins.provider.action.unlink': 'Отвязать',
  'security.logins.provider.action.unlink.blocked':
    'Это единственный способ входа — сначала задайте пароль',
  'security.logins.provider.empty':
    'Внешние сервисы к аккаунту не привязаны.',

  'security.logins.lastMethod.title': 'Это единственный способ входа',
  'security.logins.lastMethod.description':
    'Отвязать его сейчас — значит потерять доступ к аккаунту. Сначала задайте пароль, после этого отвязка станет доступна.',
  'security.logins.backup.title':
    'Задайте пароль, чтобы иметь запасной вход',
  'security.logins.backup.description':
    'Пока способ входа один, потеря доступа к нему означает потерю аккаунта.',

  'security.logins.twoFactor.description.on':
    'При входе дополнительно запрашивается код из приложения.',
  'security.logins.twoFactor.description.off':
    'Пароля достаточно для входа. Код из приложения не запрашивается.',
  'security.logins.twoFactor.action.manage': 'Настроить',
  'security.logins.twoFactor.action.enable': 'Включить',

  'security.logins.linking.title': 'Привязать новый сервис пока нельзя',
  'security.logins.linking.description':
    'Discord и Telegram привязываются только при входе через них. Отдельной кнопки привязки из кабинета сервер пока не поддерживает.',

  'security.logins.unlink.title': 'Отвязать {provider}?',
  'security.logins.unlink.description':
    'Вход через этот сервис перестанет работать. Привязать его обратно из кабинета не получится — только войдя через него заново.',
  'security.logins.unlink.action.pending': 'Отвязываем…',

  /* ---------------------------------------------------------------- */
  /* Telegram-бот                                                      */
  /* ---------------------------------------------------------------- */
  'telegram.title': 'Telegram-бот',
  'telegram.description':
    'Смотреть лицензии, сбрасывать привязку к компьютеру и получать напоминания об истечении срока прямо в чате.',

  'telegram.state.error.title': 'Не удалось узнать состояние подключения',

  'telegram.status.linked.title': 'Бот подключён',
  'telegram.status.linked.description':
    'Чат ниже связан с этим аккаунтом. Связь одна: подключение другого чата отключает этот.',
  'telegram.status.notLinked.title': 'Бот не подключён',
  'telegram.status.notLinked.description':
    'Подключение идёт только в одну сторону: вы берёте одноразовую ссылку здесь и открываете её в Telegram. Так никто не сможет привязать ваш аккаунт к чужому чату.',
  'telegram.status.scope.admin': 'Админский доступ',
  'telegram.status.chat': 'Аккаунт Telegram',
  'telegram.status.chat.unnamed': 'без @username',
  'telegram.status.linkedAt': 'Подключён',
  'telegram.status.expiresAt': 'Действует до',
  'telegram.status.blocked.title': 'Сообщения не доходят',
  'telegram.status.blocked.description':
    'Вы заблокировали бота в Telegram. Связь цела — напишите боту что угодно, и доставка возобновится.',

  'telegram.connect.action': 'Подключить бота',
  'telegram.connect.action.pending': 'Выпускаем ссылку…',

  'telegram.renew.action': 'Продлить подключение',
  'telegram.renew.description':
    'Само оно не продлевается: второй канал доступа не должен тихо жить вечно после того, как о нём забыли. Продление выпускает новую ссылку и начинает срок заново.',

  'telegram.totp.title': 'Подтвердите вторым фактором',
  'telegram.totp.description':
    'Код нужен прямо сейчас, а не «когда-то при входе»: иначе перехваченная сессия привязала бы свой чат одним запросом и сохранила доступ даже после смены пароля.',
  'telegram.totp.submit': 'Подтвердить и выпустить ссылку',

  'telegram.code.title': 'Одноразовая ссылка готова',
  'telegram.code.description':
    'Откройте её в Telegram и нажмите Start. Действует до {expiresAt} и срабатывает один раз.',
  'telegram.code.open': 'Открыть в Telegram',
  'telegram.code.copy': 'Ссылка подключения',
  'telegram.code.check': 'Я нажал Start',
  'telegram.code.hint.title': 'Сообщение со ссылкой бот удалит',
  'telegram.code.hint.description':
    'Он убирает его из чата сразу после подключения: токен одноразовый, но в переписке он остался бы навсегда и на всех ваших устройствах.',

  'telegram.scope.title': 'Что бот умеет и чего не умеет',
  'telegram.scope.description':
    'Показывает лицензии, маскирует ключи, сбрасывает привязку к компьютеру и активирует покупки. Не принимает пароли и коды двухфакторной защиты, не меняет настройки аккаунта и не восстанавливает доступ — всё это только на сайте.',

  'telegram.unlink.action': 'Отключить',
  'telegram.unlink.action.pending': 'Отключаем…',
  'telegram.unlink.confirm.title': 'Отключить бота?',
  'telegram.unlink.confirm.description':
    'Чат перестанет получать уведомления, команды бота работать не будут. Вход через Telegram это не затрагивает. Подключить заново можно здесь же в любой момент.',

  /* ---------------------------------------------------------------- */
  /* Витрина                                                           */
  /* ---------------------------------------------------------------- */
  'catalog.title': 'Каталог',
  'catalog.description':
    'Выберите тариф и способ оплаты. Заказы и их статус — в разделе «Мои заказы».',

  'catalog.error.title': 'Каталог не загрузился',

  'catalog.empty.title': 'Пока ничего не продаётся',
  'catalog.empty.description':
    'Ни один продукт не опубликован. Загляните позже.',

  'catalog.activate.title': 'Уже оплатили?',
  'catalog.activate.description':
    'Код покупки активируется в отдельном разделе.',
  'catalog.activate.action': 'Активировать покупку',

  'catalog.plan.buy': 'Купить',
  'catalog.plan.soon': 'Скоро',
  'catalog.plan.lifetime': 'Навсегда',
  'catalog.plan.days': {
    one: '{count} день',
    few: '{count} дня',
    many: '{count} дней',
    other: '{count} дня',
  },

  /* ---------------------------------------------------------------- */
  /* Активация покупки — экран с тремя вкладками                       */
  /* ---------------------------------------------------------------- */
  'activate.title': 'Активация',
  'activate.description':
    'Здесь оплаченная покупка превращается в лицензию. Выберите то, что у вас на руках.',

  'activate.tab.code': 'Код покупки',
  'activate.tab.order': 'Номер заказа',
  'activate.tab.key': 'Ключ',

  'activate.code.title': 'Код покупки Digiseller',
  'activate.code.description':
    '16 символов, которые площадка выдала после оплаты — на странице заказа и в письме от Digiseller.',

  'activate.order.title': 'Номер заказа Digiseller',
  'activate.order.description':
    'Если площадка не выдала код: у товара может быть отключена выдача уникальных кодов, и тогда после оплаты приходит обычный текст продавца. Номер заказа есть всегда — в письме о покупке и на странице заказа.',

  'activate.key.title': 'Регистрационный ключ',
  'activate.key.description':
    'Код вида ACDE-FGHJ-KMNP-QRTU, выданный продавцом или администратором. Активируется на текущий аккаунт.',

  'activate.note':
    'Ни код покупки, ни ключ не тратятся на неудачной попытке. Если списание прошло, а лицензии нет, — напишите в поддержку и приложите номер заказа площадки: оплата остаётся у неё и не теряется.',

  /* ---------------------------------------------------------------- */
  /* Активация по коду покупки Digiseller                              */
  /* ---------------------------------------------------------------- */
  'billing.code.field.label': 'Код покупки',
  'billing.code.field.hint':
    '{length} латинских букв и цифр — код со страницы заказа Digiseller. Пробелы и дефисы при вставке уберём сами.',
  'billing.code.field.entered': 'Введено: {entered} из {length}.',
  'billing.code.field.tooLong':
    'Символов больше, чем в коде покупки. Похоже, скопировалось лишнее — проверьте, что взяли только сам код.',
  'billing.code.action.submit': 'Активировать',

  'billing.code.issued.title': 'Лицензия выдана',
  'billing.code.issued.description':
    'Заказ № {order}. Сохраните номер — по нему поддержка найдёт покупку.',
  'billing.code.alreadyYours.title': 'Этот код уже активирован вами',
  'billing.code.alreadyYours.description':
    'Лицензия по нему выдана раньше и лежит в разделе «Мои лицензии». Повторно платить не нужно.',
  'billing.code.alreadyYours.action': 'Перейти к лицензиям',

  'billing.code.error.unknown.title': 'Не удалось активировать код',
  'billing.code.error.unknown.body':
    'Обновите страницу и попробуйте ещё раз. Код при этом не тратится.',
  'billing.code.error.malformed.title': 'Код набран не полностью',
  'billing.code.error.malformed.body':
    'Код покупки — ровно {length} латинских букв и цифр, без пробелов и дефисов. Скопируйте его целиком со страницы заказа Digiseller или из письма площадки.',
  'billing.code.error.notAccepted.title': 'Площадка не подтвердила код',
  'billing.code.error.notAccepted.body':
    'Чаще всего это опечатка в одном символе — сверьте код со страницей заказа Digiseller и повторите. Если код совпадает точно, напишите в поддержку и приложите номер заказа площадки: оплата никуда не делась.',
  'billing.code.error.tooManyAttempts.title': 'Слишком много попыток',
  'billing.code.error.tooManyAttempts.body':
    'Активация кодов временно приостановлена для вашего аккаунта — она снова заработает в течение часа. Код не потрачен, оплата в силе. Если ждать нельзя, напишите в поддержку.',
  'billing.code.error.alreadyUsed.title':
    'Код уже активирован на другом аккаунте',
  'billing.code.error.alreadyUsed.body':
    'Если у вас несколько аккаунтов — войдите в тот, где активировали код, лицензия там. Если вы этого не делали, напишите в поддержку и укажите номер заказа Digiseller: код предъявительский, и разобраться можно только по покупке.',
  'billing.code.error.notMapped.title':
    'Оплата принята, лицензию выдадим вручную',
  'billing.code.error.notMapped.body':
    'Покупка подтверждена площадкой, но этот товар ещё не настроен на нашей стороне. Заявка уже у администратора, лицензия появится в разделе «Мои лицензии». Повторно платить и вводить код не нужно.',
  'billing.code.error.providerUnavailable.title':
    'Площадка сейчас не отвечает',
  'billing.code.error.providerUnavailable.body':
    'Мы не смогли связаться с Digiseller, чтобы проверить код. Ничего не потрачено и не записано — повторите через минуту.',
  'billing.code.error.badRequest.title': 'Код не принят',
  'billing.code.error.badRequest.body':
    'Проверьте код: {length} латинских букв и цифр.',
  'billing.code.error.network.title': 'Нет связи с сервером',
  'billing.code.error.network.body':
    'Проверьте подключение к сети и повторите. Код не потрачен.',
  'billing.code.error.rateLimited.title': 'Слишком часто',
  'billing.code.error.rateLimited.body':
    'Подождите минуту и повторите — запросы временно ограничены.',
  'billing.code.error.serverError.title': 'Сервис временно недоступен',
  'billing.code.error.serverError.body':
    'Повторите через минуту. Если код уже был принят, повторная отправка ничего не испортит — сервер вернёт тот же результат.',

  /* ---------------------------------------------------------------- */
  /* Активация по номеру заказа Digiseller                             */
  /* ---------------------------------------------------------------- */
  'billing.order.field.number.label': 'Номер заказа',
  'billing.order.field.number.hint':
    'Из письма Digiseller о покупке или со страницы заказа. Только цифры — решётку и пробелы уберём сами.',
  'billing.order.field.email.label': 'Почта покупателя',
  'billing.order.field.email.placeholder': 'адрес, указанный при оплате',
  'billing.order.field.email.hint':
    'Именно тот адрес, на который оформлялась покупка на площадке, — он может отличаться от адреса аккаунта.',
  'billing.order.action.pending': 'Проверяем у площадки…',
  'billing.order.action.submit': 'Активировать покупку',
  'billing.order.note':
    'Заказ не тратится на неудачной попытке. Если оплата прошла, а лицензии нет — напишите в поддержку и приложите номер заказа.',

  'billing.order.issued.title': 'Лицензия выдана',
  'billing.order.issued.description':
    'Лицензия появилась в разделе «Мои лицензии». Срок начнёт идти с первого запуска загрузчика.',
  'billing.order.alreadyYours.title': 'Эта покупка уже активирована',
  'billing.order.alreadyYours.description':
    'Она уже на вашем аккаунте — активировать повторно не нужно.',

  /* ---------------------------------------------------------------- */
  /* Активация регистрационного ключа                                  */
  /* ---------------------------------------------------------------- */
  'keys.redeem.field.label': 'Регистрационный ключ',
  'keys.redeem.field.hint':
    'Ключ вида ACDE-FGHJ-KMNP-QRTU. Регистр и дефисы расставим сами — вставьте как есть.',
  'keys.redeem.field.wrongChars': {
    one: 'Символ {chars} в ключах не встречаются — там нет B, I, L, O, S и цифр 0, 1, 5. Проверьте, не спутаны ли они с похожими.',
    few: 'Символы {chars} в ключах не встречаются — там нет B, I, L, O, S и цифр 0, 1, 5. Проверьте, не спутаны ли они с похожими.',
    many: 'Символы {chars} в ключах не встречаются — там нет B, I, L, O, S и цифр 0, 1, 5. Проверьте, не спутаны ли они с похожими.',
    other:
      'Символы {chars} в ключах не встречаются — там нет B, I, L, O, S и цифр 0, 1, 5. Проверьте, не спутаны ли они с похожими.',
  },
  'keys.redeem.field.shapeHint':
    'Обычно ключ состоит из четырёх групп по четыре символа. Проверьте, всё ли скопировалось — отправить можно и так.',
  'keys.redeem.action.submit': 'Активировать ключ',

  'keys.redeem.success.title': 'Ключ активирован',
  'keys.redeem.success.description': 'Лицензия добавлена к вашему аккаунту.',
  'keys.redeem.success.seeLicenses':
    'Ключ лицензии смотрите в разделе «Мои лицензии».',

  'keys.redeem.error.licenseNumber.title':
    'Это номер лицензии, а не ключ активации',
  'keys.redeem.error.licenseNumber.body':
    'Номер начинается с кода продукта и нужен только для обращения в поддержку — вводить его никуда не надо. Если лицензия уже выдана, она в разделе «Мои лицензии», и активировать её не требуется: достаточно запустить загрузчик.',
  'keys.redeem.error.unknown.title': 'Не удалось активировать ключ',
  'keys.redeem.error.unknown.body':
    'Обновите страницу и попробуйте ещё раз. Ключ при этом не тратится.',
  'keys.redeem.error.invalid.title': 'Такого ключа нет',
  'keys.redeem.error.invalid.body':
    'Сверьте символы: в ключах не используются буквы B, I, L, O, S и цифры 0, 1, 5 — их легко спутать с похожими. Если ключ переписан верно, обратитесь к тому, кто его выдал.',
  'keys.redeem.error.expired.title': 'Срок действия ключа истёк',
  'keys.redeem.error.expired.body':
    'Ключ выпускался с ограниченным сроком, и он вышел. Активировать его уже нельзя — обратитесь к продавцу или администратору, выдавшему ключ, за новым.',
  'keys.redeem.error.alreadyUsed.title': 'Ключ уже активирован',
  'keys.redeem.error.alreadyUsed.body':
    'Один ключ работает ровно один раз. Если активировали его вы — лицензия уже в разделе «Мои лицензии». Если нет — сообщите тому, кто выдал ключ: им воспользовались раньше вас.',
  'keys.redeem.error.withoutLicense.title':
    'Этот ключ — только для регистрации нового аккаунта',
  'keys.redeem.error.withoutLicense.body':
    'Он не содержит продукта и тарифа, поэтому добавить по нему лицензию к уже существующему аккаунту нельзя. Ключ не потрачен: по нему можно создать новый аккаунт на странице регистрации по ключу.',
  'keys.redeem.error.badRequest.title': 'Ключ не принят',
  'keys.redeem.error.badRequest.body':
    'Проверьте ключ: непустая строка не длиннее {max} символов.',
  'keys.redeem.error.network.title': 'Нет связи с сервером',
  'keys.redeem.error.network.body':
    'Проверьте подключение к сети и повторите. Ключ не потрачен.',
  'keys.redeem.error.rateLimited.title': 'Слишком часто',
  'keys.redeem.error.rateLimited.body':
    'Подождите минуту и повторите — запросы временно ограничены.',
  'keys.redeem.error.serverError.title': 'Сервис временно недоступен',
  'keys.redeem.error.serverError.body':
    'Повторите через минуту. Погашение ключа происходит одной транзакцией: если она не завершилась, ключ остался неиспользованным.',

  /* ---------------------------------------------------------------- */
  /* Выданная лицензия: ключ и что будет дальше                        */
  /* ---------------------------------------------------------------- */
  'activation.licenseKey.title': 'Ключ лицензии',
  'activation.next.termStarts':
    'Срок действия начнёт идти с первого запуска лаунчера, а не с момента покупки — до этого лицензия ждёт вас без потерь.',
  'activation.next.emailed': 'Копию ключа мы отправили на почту аккаунта.',
  'activation.next.inLicenses': 'Лицензия уже в разделе',
  'activation.next.inLicenses.link': '«Мои лицензии»',

  /* ---------------------------------------------------------------- */
  /* Экраны ошибок: 401, 403, 404, 500, 503                            */
  /* ---------------------------------------------------------------- */
  'errors.unauthorized.title': 'Требуется вход',
  'errors.unauthorized.description':
    'Сессия завершена. Войдите в аккаунт, чтобы продолжить.',
  'errors.forbidden.title': 'Недостаточно прав',
  'errors.forbidden.description':
    'У вашей учётной записи нет доступа к этому разделу.',
  'errors.notFound.title': 'Страница не найдена',
  'errors.notFound.description':
    'Похоже, такой страницы не существует или она была удалена.',
  'errors.general.title': 'Что-то пошло не так',
  'errors.general.description':
    'Приносим извинения. Попробуйте обновить страницу или вернуться позже.',
  'errors.maintenance.title': 'Сервис временно недоступен',
  'errors.maintenance.description':
    'Идут технические работы. Повторите попытку через несколько минут.',

  /* ---------------------------------------------------------------- */
  /* Администрирование: общее для обоих экранов                        */
  /* ---------------------------------------------------------------- */
  'admin.nav.pendingDeals': 'Зависшие сделки',
  'admin.nav.licenses': 'Лицензии',
  'admin.copy.licenseKey': 'Ключ лицензии',

  'admin.twoFactor.title': 'Нужен второй фактор',
  'admin.twoFactor.description':
    'Права на этот раздел у вас есть, но административные действия сервер выполняет только с включённой двухфакторной аутентификацией. Открываем мастер настройки — после включения раздел заработает без повторного входа.',
  'admin.twoFactor.action': 'Перейти к настройке',

  /* Коды ошибок глазами администратора */
  'admin.error.PRODUCT_NOT_MAPPED':
    'Товар площадки не привязан ни к одному тарифу. Заведите тариф с этим номером товара и повторите выдачу.',
  'admin.error.ALREADY_REDEEMED':
    'Лицензия по этой сделке уже выдана — строка убрана из списка.',
  'admin.error.NO_CLAIMANT':
    'Выдавать некому: код никто не предъявлял. Строка закроется сама, когда покупатель введёт код в личном кабинете.',
  'admin.error.NOT_FOUND': 'Сделка не найдена. Обновите список.',
  'admin.error.NOT_BLOCKED':
    'Лицензия уже не заблокирована — кто-то снял блокировку раньше вас.',
  'admin.error.PLAN_MISMATCH': 'Тариф не принадлежит указанному продукту.',
  'admin.error.ALREADY_EXISTS': 'Такой код или номер версии уже занят. Выберите другой.',

  /* ---------------------------------------------------------------- */
  /* Зависшие сделки                                                   */
  /* ---------------------------------------------------------------- */
  'admin.pending.title': 'Зависшие сделки',
  'admin.pending.description':
    'Покупки, подтверждённые площадкой, но не выданные. Единственная причина попасть сюда — товар площадки не привязан ни к одному тарифу: деньги у площадки, а у покупателя ничего. Пока строка здесь, кто-то ждёт оплаченный товар.',

  'admin.pending.summary.empty': 'Ни одна оплаченная покупка не ждёт выдачи.',
  'admin.pending.summary.count': 'Ждут выдачи: {count}',

  'admin.pending.empty.title': 'Зависших сделок нет',
  'admin.pending.empty.description':
    'Сюда попадают покупки, подтверждённые площадкой, но не выданные — это происходит, когда товар площадки не привязан ни к одному тарифу. Пустой список означает, что все оплаченные покупки доставлены.',

  'admin.pending.column.waiting': 'Ждёт',
  'admin.pending.column.code': 'Код покупки',
  'admin.pending.column.invoice': 'Счёт площадки',
  'admin.pending.column.product': 'Товар площадки',
  'admin.pending.column.amount': 'Сумма',
  'admin.pending.column.buyer': 'Почта покупателя',
  'admin.pending.column.paidAt': 'Оплачена',
  'admin.pending.column.action': 'Действие',

  'admin.pending.copy.code': 'Код покупки',
  'admin.pending.action.issue': 'Выдать лицензию',
  'admin.pending.action.issuing': 'Выдаём…',
  'admin.pending.toast.issued': 'Лицензия выдана, заказ {order}',

  'admin.pending.failure.productNotMapped':
    'Заведите тариф с номером товара площадки {product} (поле digisellerProductId тарифа), после чего вернитесь и нажмите «Выдать лицензию» ещё раз. Код у площадки повторно не запрашивается — подтверждение уже сохранено.',
  'admin.pending.failure.noClaimant':
    'Покупка оплачена, но код {code} ещё никто не вводил в личном кабинете, поэтому владелец лицензии неизвестен. Сделать здесь нечего: сообщите покупателю код или дождитесь, пока он активирует его сам.',

  'admin.pending.issued.title': 'Выдано в этом сеансе',
  'admin.pending.issued.description':
    'Покупателю уже ушло письмо о выдаче. Ключ ниже — на случай, если его нужно продиктовать в переписке.',
  'admin.pending.issued.order': 'заказ {order}',

  /* ---------------------------------------------------------------- */
  /* Все лицензии: список, блокировка, разблокировка                   */
  /* ---------------------------------------------------------------- */
  'admin.licenses.title': 'Лицензии',
  'admin.licenses.description':
    'Блокировка отключает продукт у владельца до снятия и требует причины — она уходит в журнал действий. Разблокировка возвращает лицензию в состояние по сроку: истёкшая станет «Истекла», а не «Активна».',

  'admin.licenses.search.label': 'Ключ лицензии или логин владельца',
  'admin.licenses.search.placeholder': 'FC26-…  или  ivan',
  'admin.licenses.status.label': 'Статус',
  'admin.licenses.status.any': 'Любой',

  'admin.licenses.empty.title': 'Ничего не найдено',
  'admin.licenses.empty.filtered':
    'Под фильтры не попала ни одна лицензия. Снимите фильтры или измените запрос.',
  'admin.licenses.empty.none': 'Выданных лицензий пока нет.',

  'admin.licenses.column.key': 'Ключ',
  'admin.licenses.column.product': 'Продукт',
  'admin.licenses.column.plan': 'Тариф',
  'admin.licenses.column.owner': 'Владелец',
  'admin.licenses.column.status': 'Статус',
  'admin.licenses.column.activated': 'Активирована',
  'admin.licenses.column.expires': 'Действует до',
  'admin.licenses.column.action': 'Действие',

  'admin.licenses.owner.unassigned': 'не назначен',
  'admin.licenses.activated.never': 'не запускалась',
  'admin.licenses.reason.none': 'причина не указана',
  'admin.licenses.blocked.at': 'Заблокирована {date}:',
  'admin.licenses.revoked.at': 'Отозвана {date}:',
  'admin.licenses.range': '{from}–{to} из {total}',

  'admin.licenses.action.block': 'Заблокировать',
  'admin.licenses.action.unblock': 'Разблокировать',
  'admin.licenses.action.unblocking': 'Снимаем…',
  'admin.licenses.action.blockRevoked':
    'Лицензия отозвана при возврате средств — блокировать нечего',
  'admin.licenses.toast.unblocked': 'Блокировка снята, статус: {status}',
  'admin.licenses.column.source': 'Продал / выдал',
  'admin.licenses.column.activatedBy': 'Активировал',
  'admin.licenses.origin.reseller': 'реселлер',
  'admin.licenses.origin.admin': 'выдал админ',
  'admin.licenses.origin.key': 'ключ регистрации от админа',
  'admin.licenses.origin.channel.WEBSITE': 'заказ на сайте',
  'admin.licenses.origin.channel.DIGISELLER': 'заказ Digiseller',
  'admin.licenses.origin.channel.MANUAL': 'ручной заказ',
  'admin.licenses.origin.channel.REGISTRATION_KEY': 'заказ по ключу',
  'admin.licenses.origin.notActivated': 'не активирована',
  'admin.licenses.queryPlaceholder': 'product:fc26 (status:ACTIVE OR status:EXPIRED) NOT user:test',
  'admin.licenses.column.build': 'Сборка',
  'admin.licenses.column.issued': 'Выдана',
  'admin.licenses.activatedAt': 'запуск {date}',
  'admin.licenses.build.byPlan': 'по тарифу',
  'admin.licenses.build.saved': 'Сборка лицензии сохранена',

  /* Диалог блокировки */
  'admin.block.title': 'Заблокировать лицензию',
  'admin.block.description':
    'Продукт перестанет запускаться у владельца сразу. Блокировка обратима: снять её можно кнопкой «Разблокировать».',
  'admin.block.summary': 'Продукт: {product} · тариф {plan}',
  'admin.block.owner': 'Владелец: {owner}',
  'admin.block.reason.label': 'Причина',
  'admin.block.reason.placeholder': 'Например: передача доступа третьим лицам',
  'admin.block.reason.hint':
    'Причина попадёт в журнал действий и будет видна в карточке лицензии. Осталось символов: {left}',
  'admin.block.action.submit': 'Заблокировать',
  'admin.block.action.pending': 'Блокируем…',
  'admin.block.toast.done': 'Лицензия заблокирована',

  /* ---------------------------------------------------------------- */
  /* Авторизация: элементы, повторяющиеся на нескольких её экранах      */
  /* ---------------------------------------------------------------- */
  'auth.field.username.label': 'Логин',
  'auth.field.email.label': 'Почта',
  'auth.field.password.label': 'Пароль',
  'auth.field.password.hint': 'Не короче {min} символов.',
  'auth.field.passwordConfirm.label': 'Повторите пароль',
  'auth.action.signIn': 'Войти',
  'auth.action.backToLogin': 'Вернуться ко входу',
  'auth.action.haveAccount': 'У меня уже есть аккаунт',

  /* ---------------------------------------------------------------- */
  /* Авторизация: проверка полей на клиенте (schemas.ts)                */
  /* ---------------------------------------------------------------- */
  'auth.validation.login.required': 'Введите логин или адрес почты',
  'auth.validation.login.tooLong': 'Слишком длинное значение',
  'auth.validation.email.required': 'Введите адрес электронной почты',
  'auth.validation.email.tooLong': 'Адрес не длиннее {max} символов',
  'auth.validation.email.invalid': 'Некорректный адрес электронной почты',
  'auth.validation.username.tooShort': 'Логин не короче {min} символов',
  'auth.validation.username.tooLong': 'Логин не длиннее {max} символов',
  'auth.validation.username.pattern':
    'Только латинские буквы, цифры, дефис и подчёркивание. Кириллица недопустима.',
  'auth.validation.password.required': 'Введите пароль',
  'auth.validation.password.tooShort': 'Пароль не короче {min} символов',
  'auth.validation.password.tooLong': 'Пароль не длиннее {max} символов',
  'auth.validation.passwordConfirm.mismatch': 'Пароли не совпадают',
  'auth.validation.twoFactorCode.tooShort': 'Код не короче {min} символов',
  'auth.validation.twoFactorCode.tooLong': 'Код не длиннее {max} символов',
  'auth.validation.key.required': 'Введите ключ',
  'auth.validation.key.tooLong': 'Ключ не длиннее {max} символов',

  /* ---------------------------------------------------------------- */
  /* Регистрация по логину и паролю                                    */
  /* ---------------------------------------------------------------- */
  'register.title': 'Регистрация',
  'register.description':
    'На указанный адрес придёт письмо со ссылкой подтверждения.',
  'register.field.username.hint':
    'От {min} до {max} символов: латиница, цифры, дефис, подчёркивание. Кириллица не допускается — русские и латинские буквы визуально неразличимы, и на этом строится подмена аккаунта.',
  'register.field.email.hint':
    'Единственный способ восстановить доступ — указывайте рабочий адрес.',
  'register.action.submit': 'Создать аккаунт',
  'register.action.withKey': 'Регистрация по ключу',
  'register.error.alreadyExists.title': 'Логин или почта уже заняты',
  'register.error.alreadyExists.body':
    'Сервер намеренно не уточняет, что именно занято. Попробуйте другой логин — или войдите, если аккаунт уже ваш.',
  'register.error.alreadyExists.action.reset': 'Восстановить пароль',
  'register.error.rateLimited.title': 'Слишком много попыток',
  'register.error.rateLimited.body':
    'Ограничение — 10 запросов в минуту с одного адреса. Подождите минуту и повторите.',

  /* ---------------------------------------------------------------- */
  /* Регистрация: терминальный экран «письмо отправлено»                */
  /* ---------------------------------------------------------------- */
  'register.checkEmail.title': 'Письмо отправлено',
  'register.checkEmail.description':
    'Аккаунт создан. Осталось подтвердить адрес почты.',
  'register.checkEmail.body':
    'Откройте письмо и перейдите по ссылке. До подтверждения вход в аккаунт не работает.',
  'register.checkEmail.note.expiry': 'Ссылка действует сутки.',
  'register.checkEmail.note.delay': 'Письмо может идти несколько минут.',
  'register.checkEmail.note.spam': 'Если его нет — проверьте папку «Спам».',
  'register.checkEmail.action.login': 'Перейти ко входу',

  /* ---------------------------------------------------------------- */
  /* Регистрация: повторная отправка письма подтверждения               */
  /* ---------------------------------------------------------------- */
  'register.resend.label': 'Письмо не пришло?',
  'register.resend.placeholder': 'Адрес, на который регистрировались',
  'register.resend.action.submit': 'Отправить письмо ещё раз',
  'register.resend.action.pending': 'Отправляем…',
  'register.resend.success':
    'Если адрес зарегистрирован и ещё не подтверждён, письмо отправлено. Между повторными письмами выдерживается минута — если ничего не пришло, подождите и попробуйте снова.',

  /* ---------------------------------------------------------------- */
  /* Регистрация по ключу                                              */
  /* ---------------------------------------------------------------- */
  'registerKey.title': 'Регистрация по ключу',
  'registerKey.description':
    'Подтверждать почту не нужно — вход выполнится сразу.',
  'registerKey.field.code.label': 'Ключ',
  'registerKey.field.code.hint':
    'Ключ одноразовый: он погасится в тот же момент, когда создастся аккаунт.',
  'registerKey.field.username.hint':
    'От {min} до {max} символов: латиница, цифры, дефис, подчёркивание.',
  'registerKey.field.email.optional': '— необязательно',
  'registerKey.field.email.hint':
    'Без адреса восстановить пароль будет невозможно: другого канала связи у платформы нет.',
  'registerKey.action.submit': 'Создать аккаунт',
  'registerKey.action.regular': 'Обычная регистрация',
  'registerKey.error.keyInvalid.title': 'Такого ключа нет',
  'registerKey.error.keyInvalid.body':
    'Проверьте раскладку и дефисы. Ключ состоит из латинских букв и цифр — в нём не бывает символов O, I, 0 и 1, их легко спутать.',
  'registerKey.error.keyUsed.title': 'Ключ уже использован',
  'registerKey.error.keyUsed.body':
    'Аккаунт по нему создан ранее. Если это были вы — войдите; если нет — обратитесь к продавцу ключа.',
  'registerKey.error.keyExpired.title': 'Срок действия ключа истёк',
  'registerKey.error.keyExpired.body':
    'Ключ выпускается на ограниченный срок. Обратитесь к тому, кто его выдал, за новым.',
  'registerKey.error.alreadyExists.title': 'Логин или почта уже заняты',
  'registerKey.error.alreadyExists.body':
    'Ключ не потрачен — измените логин (или уберите почту, она необязательна) и повторите.',

  /* ---------------------------------------------------------------- */
  /* Восстановление доступа: запрос ссылки                             */
  /* ---------------------------------------------------------------- */
  'forgotPassword.title': 'Восстановление доступа',
  'forgotPassword.description':
    'Укажите адрес, на который зарегистрирован аккаунт.',
  'forgotPassword.action.submit': 'Отправить ссылку',
  'forgotPassword.error.rateLimited.title': 'Слишком много попыток',
  'forgotPassword.error.rateLimited.body':
    'Ограничение — 10 запросов в минуту с одного адреса. Подождите минуту: письмо по предыдущему запросу, если оно ушло, уже в пути.',
  'forgotPassword.sent.title': 'Проверьте почту',
  'forgotPassword.sent.description':
    'Если такой адрес зарегистрирован, письмо со ссылкой уже отправлено.',
  'forgotPassword.sent.note.expiry':
    'Ссылка действует один час и срабатывает один раз.',
  'forgotPassword.sent.note.delay':
    'Письмо может идти несколько минут — проверьте «Спам».',
  'forgotPassword.sent.note.twoFactor':
    'Если у аккаунта включён второй фактор, на странице смены пароля дополнительно спросят код.',
  'forgotPassword.sent.privacy':
    'Подтверждение «адрес зарегистрирован» мы не показываем намеренно — иначе по этой форме можно было бы проверять чужие адреса.',
  'forgotPassword.sent.action.another': 'Отправить на другой адрес',

  /* ---------------------------------------------------------------- */
  /* Восстановление доступа: новый пароль по ссылке из письма          */
  /* ---------------------------------------------------------------- */
  'resetPassword.title': 'Новый пароль',
  'resetPassword.description':
    'После смены все текущие сессии будут завершены.',
  'resetPassword.field.newPassword.label': 'Новый пароль',
  'resetPassword.field.twoFactorCode.label': 'Код из приложения',
  'resetPassword.field.twoFactorCode.hint':
    'Подойдёт и код восстановления, если приложения под рукой нет.',
  'resetPassword.action.submit': 'Сохранить пароль',
  'resetPassword.action.requestNewLink': 'Запросить новую ссылку',
  'resetPassword.twoFactor.title': 'Нужен код подтверждения',
  'resetPassword.twoFactor.description':
    'У аккаунта включена двухфакторная аутентификация. Без кода доступ к почте обходил бы её целиком.',
  'resetPassword.error.twoFactorInvalid':
    'Неверный код. Если код уже использовался — дождитесь следующего в приложении.',
  'resetPassword.noToken.title': 'Ссылка неполная',
  'resetPassword.noToken.description': 'В адресе нет кода восстановления.',
  'resetPassword.noToken.body':
    'Почтовые программы иногда переносят длинную ссылку на вторую строку. Скопируйте адрес из письма целиком — он должен заканчиваться на',
  'resetPassword.done.title': 'Пароль изменён',
  'resetPassword.done.description':
    'Все прежние сессии завершены — это защита на случай, если доступ к аккаунту был у кого-то ещё.',
  'resetPassword.done.action': 'Войти с новым паролем',
  'resetPassword.linkDead.title': 'Ссылка недействительна',
  'resetPassword.linkDead.description': 'Она истекла или ею уже воспользовались.',
  'resetPassword.linkDead.body':
    'Ссылка сброса действует один час и срабатывает один раз. Запросите новую — старая после этого перестанет работать окончательно.',

  /* ---------------------------------------------------------------- */
  /* Подтверждение почты по ссылке из письма                           */
  /* ---------------------------------------------------------------- */
  'verifyEmail.noToken.title': 'Ссылка неполная',
  'verifyEmail.noToken.description': 'В адресе нет кода подтверждения.',
  'verifyEmail.noToken.body':
    'Так бывает, когда почтовая программа переносит длинную ссылку на вторую строку. Откройте письмо и скопируйте адрес целиком — он должен заканчиваться на',
  'verifyEmail.pending.title': 'Подтверждаем адрес',
  'verifyEmail.pending.description': 'Это займёт пару секунд.',
  'verifyEmail.done.title': 'Почта подтверждена',
  'verifyEmail.done.description': 'Аккаунт активен — можно входить.',
  'verifyEmail.linkDead.title': 'Ссылка недействительна',
  'verifyEmail.linkDead.description': 'Она устарела или ею уже воспользовались.',
  'verifyEmail.linkDead.body':
    'Если вы уже переходили по этой ссылке, адрес подтверждён — просто войдите. Ссылка действует сутки с момента регистрации.',
  'verifyEmail.error.title': 'Не удалось подтвердить',
  'verifyEmail.error.recoverable':
    'Ссылка не потрачена — по ней можно перейти ещё раз, когда сервис ответит.',
  'verifyEmail.backup.body':
    'Новое письмо подтверждения запросить нельзя, но восстановление пароля подтверждает адрес точно так же.',
  'verifyEmail.backup.action.recover': 'Восстановить доступ',

  /* Покупка на сайте и заказы */
  'common.action.save': 'Сохранить',
  'common.action.create': 'Создать',
  'common.action.edit': 'Изменить',
  'nav.orders': 'Мои заказы',
  'nav.admin.products': 'Товары',
  'nav.admin.orders': 'Заказы',
  'nav.admin.payments': 'Способы оплаты',
  'nav.admin.users': 'Пользователи',
  'nav.admin.settings': 'Настройки системы',
  'nav.admin.audit': 'Журнал',

  'buy.title': 'Покупка: {product}',
  'buy.summary': '{plan} — {price}. Выберите способ оплаты.',
  'buy.none': 'Для этого товара пока нет доступных способов оплаты. Напишите в поддержку или загляните позже.',
  'buy.pending': 'Создаём заказ…',
  'buy.yookassa.action': 'Оплатить картой или СБП',
  'buy.crypto.action': 'Оплатить криптовалютой',
  'buy.crypto.pickWallet': 'Выберите кошелёк для оплаты:',
  'buy.digiseller.action': 'Перейти в магазин',
  'buy.digiseller.hint':
    'После оплаты на Digiseller вы получите код покупки — активируйте его в разделе «Активация».',

  'orders.title': 'Мои заказы',
  'orders.description': 'Покупки на сайте и статус их оплаты.',
  'orders.empty.title': 'Заказов пока нет',
  'orders.empty.action': 'Перейти в каталог',
  'orders.back': 'Все заказы',
  'orders.column.number': 'Заказ',
  'orders.column.product': 'Товар',
  'orders.column.amount': 'Сумма',
  'orders.column.method': 'Оплата',
  'orders.column.status': 'Статус',
  'orders.column.created': 'Создан',
  'orders.field.method': 'Способ оплаты',
  'orders.field.created': 'Создан',
  'orders.field.paid': 'Оплачен',
  'orders.field.cancelled': 'Отменён',
  'orders.status.PENDING': 'Ожидает оплаты',
  'orders.status.AWAITING_REVIEW': 'Оплата проверяется',
  'orders.status.PAID': 'Оплачен',
  'orders.status.DELIVERED': 'Выполнен',
  'orders.status.CANCELLED': 'Отменён',
  'orders.status.REFUNDED': 'Возврат',
  'orders.status.FAILED': 'Ошибка',
  'orders.provider.DIGISELLER': 'Digiseller',
  'orders.provider.MANUAL': 'Вручную',
  'orders.provider.YOOKASSA': 'Карта / СБП',
  'orders.provider.CRYPTO': 'Криптовалюта',
  'orders.delivered.title': 'Лицензия выдана',
  'orders.delivered.description': 'Ключ — в письме и на странице лицензии. Срок пойдёт с первого запуска.',
  'orders.delivered.action': 'Открыть лицензию',
  'orders.cancelled.title': 'Заказ отменён',
  'orders.cancelled.noReason': 'Причина не указана.',
  'orders.yookassa.title': 'Ждём оплату',
  'orders.yookassa.description':
    'Если вы уже оплатили, статус обновится в течение минуты. Если страница оплаты закрылась — откройте её снова.',
  'orders.yookassa.pay': 'Перейти к оплате',
  'orders.yookassa.check': 'Проверить оплату',
  'orders.crypto.title': 'Переведите точную сумму',
  'orders.crypto.description': 'Отправьте сумму на этот адрес до {expires}, затем укажите хеш транзакции.',
  'orders.crypto.awaiting.title': 'Оплата проверяется',
  'orders.crypto.awaiting.description':
    'Хеш транзакции получен. Лицензия будет выдана, как только администратор подтвердит перевод.',
  'orders.crypto.qrAlt': 'QR-код адреса кошелька',
  'orders.crypto.amount': 'Сумма',
  'orders.crypto.network': 'Сеть',
  'orders.crypto.address': 'Адрес',
  'orders.crypto.warning':
    'Отправляйте только {currency} в сети {network}. Перевод в другой сети или другой монетой будет потерян.',
  'orders.crypto.tx.label': 'Хеш транзакции (TXID)',
  'orders.crypto.tx.placeholder': 'Вставьте хеш из кошелька',
  'orders.crypto.tx.submit': 'Я оплатил',
  'orders.crypto.tx.update': 'Обновить хеш',
  'orders.crypto.tx.hint': 'Его можно найти в истории кошелька или в обозревателе сети.',
  'orders.crypto.tx.explorer': 'Посмотреть транзакцию в обозревателе',
  'orders.crypto.submitted': 'Спасибо! Оплата отправлена на проверку.',
  'orders.crypto.cancel': 'Отменить заказ',

  /* Админка */
  'admin.saved': 'Сохранено',

  'resellers.admin.title': 'Реселлеры',
  'resellers.admin.description':
    'Оптовые продавцы. Реселлер платит вам вперёд, вы пополняете его баланс, а он выпускает с баланса ключи активации по цене тарифа минус свою скидку и продаёт их своим покупателям по своей цене.',
  'resellers.admin.create': 'Сделать реселлером',
  'resellers.admin.createHint': 'Выберите существующий аккаунт по логину: он получит роль «Реселлер» и панель «Мои продажи».',
  'resellers.admin.edit': 'Условия реселлера',
  'resellers.admin.editHint': 'Скидка и кредит действуют на следующие покупки; уже выпущенные ключи сохраняют свою цену.',
  'resellers.admin.searchPlaceholder': 'Название, логин или почта',
  'resellers.admin.nothingFound': 'Под фильтр не попал ни один реселлер.',
  'resellers.admin.empty': 'Реселлеров пока нет. Сделайте реселлером существующий аккаунт.',
  'resellers.admin.column.reseller': 'Реселлер',
  'resellers.admin.column.status': 'Статус',
  'resellers.admin.column.balance': 'Баланс',
  'resellers.admin.column.discount': 'Скидка',
  'resellers.admin.column.credit': 'Кредит',
  'resellers.admin.column.sales30d': 'Потратил за 30 дней',
  'resellers.admin.column.clients': 'Клиенты',
  'resellers.admin.column.licenses': 'Лицензии',
  'resellers.admin.column.keys': 'Ключи',
  'resellers.admin.topup': 'Баланс',
  'resellers.admin.balanceTitle': 'Баланс «{name}»',
  'resellers.admin.balanceNow': 'Сейчас: {balance}',
  'resellers.admin.balanceDone': 'Готово, баланс: {balance}',
  'resellers.admin.apply': 'Применить',
  'resellers.status.any': 'Любой статус',
  'resellers.status.ACTIVE': 'Активен',
  'resellers.status.SUSPENDED': 'Приостановлен',
  'resellers.status.CLOSED': 'Закрыт',
  'resellers.statusHint.ACTIVE': 'Продаёт ключи, продлевает лицензии и сбрасывает привязку клиентам.',
  'resellers.statusHint.SUSPENDED': 'Новые продажи и продления закрыты; клиенты и проданные ключи работают, сбросы привязки разрешены.',
  'resellers.statusHint.CLOSED': 'Сотрудничество закончено: панель только для просмотра.',
  'resellers.history': 'История баланса',
  'resellers.historyOf': 'История баланса «{name}»',
  'resellers.historyHint': 'Все пополнения, покупки ключей, продления и возвраты — сначала новые.',
  'resellers.field.username': 'Логин аккаунта',
  'resellers.field.usernameHint': 'Человек сначала регистрируется на сайте, потом вы делаете его реселлером здесь.',
  'resellers.field.displayName': 'Название в панели',
  'resellers.field.discount': 'Скидка, %',
  'resellers.field.discountHint': 'Реселлер платит цену тарифа минус эту скидку.',
  'resellers.field.credit': 'Кредитный лимит',
  'resellers.field.creditHint': 'Насколько баланс может уйти в минус. 0 — только по предоплате.',
  'resellers.field.resets': 'Сбросов привязки в сутки',
  'resellers.field.status': 'Статус',
  'resellers.field.products': 'Разрешённые товары',
  'resellers.field.productsHint': 'Ничего не отмечено — можно продавать все товары.',
  'resellers.field.notes': 'Заметки (видят только администраторы)',
  'resellers.field.txType': 'Операция',
  'resellers.field.amount': 'Сумма, {currency}',
  'resellers.field.comment': 'Комментарий',
  'resellers.field.commentPlaceholder': 'например, оплата по счёту №15',
  'resellers.problem.username': 'Укажите логин аккаунта.',
  'resellers.problem.displayName': 'Укажите название.',
  'resellers.problem.discount': 'Скидка: от 0 до 100.',
  'resellers.problem.credit': 'Кредитный лимит: 0 или больше.',
  'resellers.problem.resets': 'Сбросов в сутки: целое число от 0 до 1000.',
  'resellers.problem.amount': 'Укажите ненулевую сумму; пополнение и бонус — только положительные.',
  'resellers.problem.plan': 'Выберите тариф.',
  'resellers.problem.count': 'Количество ключей: от 1 до 100.',
  'resellers.problem.days': 'Срок ключа: от 1 до 3650 дней или оставьте пустым.',
  'resellers.problem.balance': 'Не хватает денег: доступно {available} (баланс плюс кредит).',
  'resellers.tx.TOPUP': 'Пополнение',
  'resellers.tx.SALE': 'Покупка',
  'resellers.tx.REFUND': 'Возврат',
  'resellers.tx.ADJUSTMENT': 'Корректировка',
  'resellers.tx.COMMISSION': 'Бонус',
  'resellers.tx.empty': 'Операций пока нет.',
  'resellers.tx.column.date': 'Дата',
  'resellers.tx.column.type': 'Операция',
  'resellers.tx.column.amount': 'Сумма',
  'resellers.tx.column.balanceAfter': 'Баланс после',
  'resellers.tx.column.what': 'За что',
  'resellers.txHint.TOPUP': 'Реселлер заплатил вам — деньги зачисляются на его баланс.',
  'resellers.txHint.COMMISSION': 'Бонус или комиссия сверх оплат.',
  'resellers.txHint.ADJUSTMENT': 'Ручная правка; отрицательная сумма списывает деньги.',
  'resellers.panel.subtitle': 'Выпускайте ключи активации со своего баланса, продавайте по своей цене, обслуживайте своих клиентов.',
  'resellers.panel.balance': 'Баланс',
  'resellers.panel.terms': 'ваша скидка {discount}% · кредит {credit}',
  'resellers.panel.statusNotice.ACTIVE': 'Продажи открыты.',
  'resellers.panel.statusNotice.SUSPENDED': 'Продажи приостановлены администратором: новые ключи и продления закрыты, ваши клиенты продолжают работать.',
  'resellers.panel.statusNotice.CLOSED': 'Сотрудничество закрыто: панель только для просмотра.',
  'resellers.panel.stat.unused': 'Неиспользованных ключей',
  'resellers.panel.stat.used': 'Активированных ключей',
  'resellers.panel.stat.active': 'Активных лицензий',
  'resellers.panel.stat.clients': 'Клиентов',
  'resellers.panel.stat.spent30d': 'Потрачено за 30 дней',
  'resellers.panel.tab.keys': 'Ключи',
  'resellers.panel.tab.licenses': 'Клиенты и лицензии',
  'resellers.panel.tab.transactions': 'История баланса',
  'resellers.panel.tab.balance': 'Баланс',

  /* Пополнение баланса реселлером */
  'resellers.topup.title': 'Пополнить баланс',
  'resellers.topup.hint':
    'Как покупка на сайте: создайте заявку, отправьте точную сумму в монетах на адрес и вставьте хеш транзакции. Деньги поступят на баланс после подтверждения администратором.',
  'resellers.topup.noWallets': 'Пополнение криптой ещё не настроено. Свяжитесь с администратором.',
  'resellers.topup.amount': 'Сумма, {currency}',
  'resellers.topup.wallet': 'Монета и сеть',
  'resellers.topup.walletPlaceholder': 'Выберите кошелёк',
  'resellers.topup.note': 'Комментарий для администратора',
  'resellers.topup.submit': 'Получить реквизиты',
  'resellers.topup.created': 'Заявка создана: отправьте перевод и вставьте хеш',
  'resellers.topup.problem.amount': 'Сумма — не меньше 1.',
  'resellers.topup.problem.wallet': 'Выберите монету и сеть.',
  'resellers.topup.requests': 'Заявки на пополнение',
  'resellers.topup.none': 'Заявок пока нет.',
  'resellers.topup.send': 'Отправьте',
  'resellers.topup.coinAmount': 'Сумма в монетах',
  'resellers.topup.address': 'Адрес',
  'resellers.topup.until': 'Действует до',
  'resellers.topup.txHash': 'Хеш транзакции (TXID)',
  'resellers.topup.paid': 'Я оплатил',
  'resellers.topup.fixHash': 'Обновить хеш',
  'resellers.topup.cancel': 'Отменить заявку',
  'resellers.topup.sent': 'Отправлено на проверку',
  'resellers.topup.waiting': 'Ждём, пока администратор проверит перевод.',
  'resellers.topup.credited': 'Зачислено: {amount}',
  'resellers.topup.rejected': 'Отклонено: {reason}',
  'resellers.topup.status.PENDING': 'Ждёт оплаты',
  'resellers.topup.status.SUBMITTED': 'На проверке',
  'resellers.topup.status.CONFIRMED': 'Зачислено',
  'resellers.topup.status.REJECTED': 'Отклонено',
  'resellers.topup.status.CANCELLED': 'Отменено',
  'resellers.topup.status.EXPIRED': 'Срок истёк',

  /* Заявки на пополнение в админке */
  'resellers.admin.tab.resellers': 'Реселлеры',
  'resellers.admin.tab.topups': 'Заявки на пополнение',
  'resellers.topups.hint':
    'Пока оплату проверяет человек: откройте транзакцию по хешу в обозревателе, убедитесь, что монеты пришли на адрес, и подтвердите — сумма уйдёт на баланс реселлера. Автоматическая проверка появится позже.',
  'resellers.topups.filter.SUBMITTED': 'К проверке',
  'resellers.topups.filter.OPEN': 'Открытые',
  'resellers.topups.filter.CONFIRMED': 'Зачисленные',
  'resellers.topups.filter.REJECTED': 'Отклонённые',
  'resellers.topups.filter.CANCELLED': 'Отменённые',
  'resellers.topups.filter.ALL': 'Все',
  'resellers.topups.empty': 'Заявок с таким статусом нет.',
  'resellers.topups.column.created': 'Создана',
  'resellers.topups.column.reseller': 'Реселлер',
  'resellers.topups.column.amount': 'Сумма',
  'resellers.topups.column.payment': 'Перевод',
  'resellers.topups.column.tx': 'Хеш',
  'resellers.topups.column.status': 'Статус',
  'resellers.topups.submittedAt': 'оплачена {date}',
  'resellers.topups.creditedAs': 'зачислено {amount}',
  'resellers.topups.explorer': 'Открыть в обозревателе',
  'resellers.topups.confirm': 'Подтвердить',
  'resellers.topups.reject': 'Отклонить',
  'resellers.topups.confirmTitle': 'Подтвердить пополнение «{name}»',
  'resellers.topups.confirmHint':
    'Ожидаемый перевод: {coins} ({network}). Если пришло другое количество, поправьте сумму к зачислению.',
  'resellers.topups.noTx': 'Реселлер ещё не вставил хеш транзакции. Подтверждайте, только если сами нашли перевод.',
  'resellers.topups.confirmSubmit': 'Зачислить {amount}',
  'resellers.topups.confirmed': 'Зачислено, баланс: {balance}',
  'resellers.topups.rejectTitle': 'Отклонить заявку «{name}»',
  'resellers.topups.rejectHint': 'Реселлер увидит причину. Ничего не зачисляется.',
  'resellers.topups.reason': 'Причина',
  'resellers.topups.rejectedDone': 'Заявка отклонена',

  'resellers.panel.issue.title': 'Выпустить ключи',
  'resellers.panel.issue.hint':
    'Ключ оплачивается с вашего баланса по вашей цене. Передайте его покупателю: он активирует ключ на сайте («Активация») или регистрируется по нему и получает лицензию. Неиспользованный ключ можно отменить — деньги вернутся.',
  'resellers.panel.issue.plan': 'Тариф',
  'resellers.panel.issue.planPlaceholder': 'Выберите тариф',
  'resellers.panel.issue.count': 'Сколько ключей',
  'resellers.panel.issue.days': 'Ключ действует, дней',
  'resellers.panel.issue.daysPlaceholder': 'без срока',
  'resellers.panel.issue.note': 'Заметка для себя',
  'resellers.panel.issue.notePlaceholder': 'например, заказ из Telegram',
  'resellers.panel.issue.total': '{price} × {count} = {total}',
  'resellers.panel.issue.submit': 'Выпустить и оплатить',
  'resellers.panel.issued.title': {
    one: 'Выпущен {count} ключ',
    few: 'Выпущено {count} ключа',
    many: 'Выпущено {count} ключей',
    other: 'Выпущено {count} ключа',
  },
  'resellers.panel.issued.hint': '{what}. Скопируйте ключи сейчас; неиспользованные ключи остаются и во вкладке «Ключи».',
  'resellers.panel.issued.copyLabel': 'Ключи',
  'resellers.panel.issued.done': 'Готово',
  'resellers.keyState.all': 'Все',
  'resellers.keyState.unused': 'Не использован',
  'resellers.keyState.used': 'Активирован',
  'resellers.keyState.expired': 'Истёк',
  'resellers.keyState.cancelled': 'Отменён',
  'resellers.panel.keys.empty': 'Здесь ключей нет.',
  'resellers.panel.keys.copyLabel': 'Ключ',
  'resellers.panel.keys.until': 'до {date}',
  'resellers.panel.keys.cancel': 'Отменить ключ и вернуть деньги',
  'resellers.panel.keys.cancelConfirm': 'Отменить ключ? {price} вернётся на баланс, а ключ перестанет работать.',
  'resellers.panel.keys.cancelled': 'Ключ отменён, баланс: {balance}',
  'resellers.panel.keys.column.code': 'Ключ',
  'resellers.panel.keys.column.what': 'Товар · тариф',
  'resellers.panel.keys.column.state': 'Состояние',
  'resellers.panel.keys.column.price': 'Оплачено',
  'resellers.panel.keys.column.client': 'Кто активировал',
  'resellers.panel.keys.column.created': 'Выпущен',
  'resellers.panel.licenses.search': 'Логин клиента, ключ, товар или тариф',
  'resellers.panel.licenses.resets': 'Сбросов привязки сегодня: {used} из {limit}',
  'resellers.panel.licenses.nothingFound': 'Ничего не найдено.',
  'resellers.panel.licenses.empty': 'Проданных лицензий пока нет — они появятся, когда покупатели активируют ваши ключи.',
  'resellers.panel.licenses.notStarted': 'ещё не запускалась',
  'resellers.panel.licenses.bound': 'привязана',
  'resellers.panel.licenses.unbound': 'не привязана',
  'resellers.panel.licenses.resetCount': {
    one: '{count} сброс',
    few: '{count} сброса',
    many: '{count} сбросов',
    other: '{count} сброса',
  },
  'resellers.panel.licenses.extend': 'Продлить',
  'resellers.panel.licenses.reset': 'Сбросить привязку',
  'resellers.panel.licenses.resetConfirm': 'Сбросить привязку у {client}? Следующий запуск привяжет новый компьютер.',
  'resellers.panel.licenses.resetDone': 'Привязка сброшена. Сегодня: {used} из {limit}',
  'resellers.panel.licenses.column.client': 'Клиент',
  'resellers.panel.licenses.column.license': 'Лицензия',
  'resellers.panel.licenses.column.status': 'Статус',
  'resellers.panel.licenses.column.expires': 'Действует до',
  'resellers.panel.licenses.column.device': 'Устройство',
  'resellers.panel.extend.title': 'Продлить лицензию {client}',
  'resellers.panel.extend.hint': 'Срок добавится к текущему; цена спишется с вашего баланса.',
  'resellers.panel.extend.noPlans': 'Тарифов этого товара вам не доступно.',
  'resellers.panel.extend.pending': 'Лицензия ещё не запускалась: до первого запуска можно применить только бессрочный тариф.',
  'resellers.panel.extend.done': 'Продлено, списано {price}',
  'resellers.panel.extend.submit': 'Продлить за {price}',

  'admin.dates.all': 'За всё время',
  'admin.dates.24h': 'За 24 часа',
  'admin.dates.7d': 'За 7 дней',
  'admin.dates.30d': 'За 30 дней',
  'admin.dates.90d': 'За 90 дней',
  'admin.dates.custom': 'Выбрать даты…',
  'admin.dates.from': 'С',
  'admin.dates.to': 'По',

  'admin.form.nameRequired': 'Укажите название — оно не может быть пустым.',
  'admin.form.slugRequired': 'Укажите код.',

  'admin.inline.edit': 'Нажмите, чтобы изменить',
  'admin.inline.required': 'Не может быть пустым',
  'admin.inline.number': 'Введите целое число',

  'admin.bulk.selectPage': 'Выбрать всю страницу',
  'admin.bulk.selectRow': 'Выбрать строку',
  'admin.bulk.selected': { one: 'Выбрана {count}', few: 'Выбрано {count}', many: 'Выбрано {count}', other: 'Выбрано {count}' },
  'admin.bulk.clear': 'Снять выбор',
  'admin.bulk.done': {
    one: 'Готово: {count} элемент',
    few: 'Готово: {count} элемента',
    many: 'Готово: {count} элементов',
    other: 'Готово: {count} элемента',
  },
  'admin.bulk.partial': 'Выполнено: {ok}, не удалось: {failed}',
  'admin.bulk.affects': {
    one: 'Затронет {count} элемент.',
    few: 'Затронет {count} элемента.',
    many: 'Затронет {count} элементов.',
    other: 'Затронет {count} элемента.',
  },
  'admin.bulk.reason': 'Причина',
  'admin.bulk.optional': 'необязательно',
  'admin.bulk.hours': 'Срок, часов',
  'admin.bulk.forever': 'пусто — бессрочно',
  'admin.bulk.apply': 'Применить',
  'admin.bulk.ipsHint': 'Будут заблокированы все адреса, с которых входили эти пользователи (ваш собственный адрес пропускается).',
  'admin.bulk.blockLicenses': 'Заблокировать лицензии',
  'admin.bulk.unblockLicenses': 'Разблокировать лицензии',
  'admin.bulk.blockOwners': 'Заблокировать владельцев',
  'admin.bulk.blockOwnerIps': 'Заблокировать IP владельцев',
  'admin.bulk.blockUsers': 'Заблокировать пользователей',
  'admin.bulk.unblockUsers': 'Разблокировать пользователей',
  'admin.bulk.blockUserIps': 'Заблокировать их IP',
  'admin.bulk.blockIps': 'Заблокировать IP',
  'admin.bulk.blockActors': 'Заблокировать исполнителей',
  'admin.bulk.title.block': 'Заблокировать выбранные лицензии',
  'admin.bulk.title.unblock': 'Разблокировать выбранные лицензии',
  'admin.bulk.title.blockOwners': 'Заблокировать владельцев выбранных лицензий',
  'admin.bulk.title.blockOwnerIps': 'Заблокировать IP-адреса владельцев',
  'admin.bulk.title.blockUsers': 'Заблокировать выбранных пользователей',
  'admin.bulk.title.unblockUsers': 'Разблокировать выбранных пользователей',
  'admin.bulk.title.blockUserIps': 'Заблокировать IP-адреса выбранных пользователей',
  'admin.bulk.title.blockIps': 'Заблокировать IP-адреса из выбранных строк',
  'admin.bulk.title.blockActors': 'Заблокировать пользователей из выбранных строк',

  'admin.products.title': 'Товары',
  'admin.products.description':
    'Товары, их тарифы и сборки payload. Новый товар скрыт с витрины, пока вы не поставите статус «Активен».',
  'admin.products.create': 'Новый товар',
  'admin.products.createHint': 'Код попадает в ключи лицензий, поменять его потом нельзя.',
  'admin.products.empty': 'Товаров пока нет. Создайте первый.',
  'admin.products.back': 'Все товары',
  'admin.products.section.main': 'Основное',
  'admin.products.column.name': 'Название',
  'admin.products.column.slug': 'Код',
  'admin.products.column.status': 'Статус',
  'admin.products.column.plans': 'Тарифы (в продаже / всего)',
  'admin.products.column.licenses': 'Лицензий',
  'admin.products.status.ACTIVE': 'Активен',
  'admin.products.status.HIDDEN': 'Скрыт',
  'admin.products.status.ARCHIVED': 'В архиве',
  'admin.products.field.name': 'Название',
  'admin.products.field.slug': 'Код',
  'admin.products.field.slugHint': '3–32 символа: строчная латиница, цифры и дефис.',
  'admin.products.field.description': 'Описание',
  'admin.products.field.status': 'Статус',
  'admin.products.field.statusHint': 'Скрытые и архивные товары на витрине не показываются.',
  'admin.products.field.maxResets': 'Сбросов привязки на лицензию',
  'admin.products.field.cooldown': 'Часов между сбросами',
  'admin.products.field.fromSettings': 'Из настроек',
  'admin.products.field.sortOrder': 'Порядок',
  'admin.products.open': 'Открыть',
  'admin.products.field.slugPurpose':
    'Код — техническое имя товара: это начало ключей лицензий (FC26-…), по нему загрузчик запрашивает товар, он же виден в ссылках. 3–32 символа: строчная латиница, цифры, дефис. Смена кода ломает уже выпущенные загрузчики.',
  'admin.products.slugChangeConfirm':
    'Код товара зашит в загрузчики и ключи лицензий. Загрузчики, выпущенные со старым кодом, перестанут находить товар. Всё равно сменить?',

  'admin.plans.title': 'Тарифы',
  'admin.plans.description': 'То, что покупатель выбирает на витрине. Тариф с лицензиями не удаляется — его выключают.',
  'admin.plans.create': 'Новый тариф',
  'admin.plans.edit': 'Изменить тариф',
  'admin.plans.dialogHint': 'Код и срок после создания не меняются — для этого заведите новый тариф.',
  'admin.plans.empty': 'Тарифов пока нет.',
  'admin.plans.column.name': 'Тариф',
  'admin.plans.column.duration': 'Срок',
  'admin.plans.column.price': 'Цена',
  'admin.plans.column.digiseller': 'ID Digiseller',
  'admin.plans.column.state': 'Состояние',
  'admin.plans.active': 'В продаже',
  'admin.plans.inactive': 'Выключен',
  'admin.plans.field.name': 'Название',
  'admin.plans.field.namePlaceholder': '30 дней',
  'admin.plans.field.slug': 'Код',
  'admin.plans.field.days': 'Срок, дней',
  'admin.plans.field.lifetime': 'Бессрочный',
  'admin.plans.field.price': 'Цена',
  'admin.plans.field.currency': 'Валюта',
  'admin.plans.field.digiseller': 'ID товара на Digiseller',
  'admin.plans.field.digisellerHint': 'Нужен, только если тариф продаётся через Digiseller.',
  'admin.plans.field.active': 'В продаже',
  'admin.plans.column.builds': 'Сборки',
  'admin.plans.field.slugPurpose': 'Техническое имя тарифа: для связки с Digiseller, статистики и ссылок. Строчная латиница, цифры, дефис.',
  'admin.plans.builds.noneMeansLatest': 'Ничего не отмечено — тариф получает самую новую опубликованную сборку товара.',
  'admin.plans.builds.pickedCount': {
    one: 'Отмечена {count} сборка',
    few: 'Отмечено {count} сборки',
    many: 'Отмечено {count} сборок',
    other: 'Отмечено {count} сборки',
  },
  'admin.plans.problem.price': 'Укажите цену целым числом (0 или больше).',
  'admin.plans.problem.slug': 'Код: строчная латиница, цифры и дефис, начинается с буквы или цифры.',
  'admin.plans.problem.days': 'Укажите срок в днях (не меньше 1) или отметьте «Бессрочно».',
  'admin.plans.builds.edit': 'Выбрать сборки',
  'admin.plans.builds.latest': 'последняя опубликованная',
  'admin.plans.builds.title': 'Сборки тарифа «{plan}»',
  'admin.plans.builds.hint':
    'Загрузчик получит самую новую опубликованную из отмеченных. Ничего не отмечено — самую новую опубликованную сборку товара. Лицензия с закреплённой сборкой получает именно её.',
  'admin.plans.builds.filter': 'Фильтр по названию или версии',
  'admin.plans.builds.unpublishedWarning': 'Часть отмеченных сборок не опубликована — загрузчик пропускает их, пока их не опубликуют.',
  'admin.plans.builds.uploadTitle': 'Загрузить свою exe для этого тарифа',
  'admin.plans.builds.namePlaceholder': 'название (пусто — {version})',
  'admin.plans.builds.uploadButton': 'Выбрать файл и опубликовать',
  'admin.plans.builds.uploaded': 'Сборка {name} загружена и опубликована — не забудьте сохранить',

  'admin.builds.title': 'Хранилище сборок',
  'admin.builds.description':
    'Файлы, которые загрузчик получает после проверки лицензии. Создайте черновик, загрузите файл, опубликуйте. Тарифы берут сборки отсюда, лицензия может закрепить свою. Файл опубликованной сборки менять нельзя, название — можно.',
  'admin.builds.name': 'Название',
  'admin.builds.nameHint':
    'Название: латинские буквы и цифры, части через точку, в конце буква или цифра — например 1.4.2, beta.2, stable. Пусто — как версия.',
  'admin.builds.queryPlaceholder': 'name:beta* status:published OR plan:30d',
  'admin.builds.nothingFound': 'Под фильтр не попала ни одна сборка.',
  'admin.builds.plans': 'Тарифы',
  'admin.builds.pinned': 'Закреплена за лицензиями',
  'admin.builds.status.all': 'Все',
  'admin.builds.status.draft': 'Черновик',
  'admin.builds.status.ready': 'Готова',
  'admin.builds.status.published': 'Опубликована',
  'admin.builds.status.unpublished': 'Снята с публикации',
  'admin.builds.version': 'Версия',
  'admin.builds.create': 'Новая сборка',
  'admin.builds.empty': 'Сборок пока нет.',
  'admin.builds.state': 'Состояние',
  'admin.builds.size': 'Размер',
  'admin.builds.created': 'Создана',
  'admin.builds.draft': 'Черновик',
  'admin.builds.ready': 'Готова к публикации',
  'admin.builds.published': 'Опубликована',
  'admin.builds.upload': 'Загрузить файл',
  'admin.builds.reupload': 'Заменить файл',
  'admin.builds.uploading': 'Загрузка…',
  'admin.builds.uploaded': 'Файл загружен, сервер посчитал SHA-256',
  'admin.builds.publish': 'Опубликовать',
  'admin.builds.unpublish': 'Снять с публикации',

  'admin.payments.title': 'Способы оплаты',
  'admin.payments.description':
    'Включение и настройка способов оплаты. Ключи API хранятся зашифрованными и после сохранения не показываются.',
  'admin.payments.provider.DIGISELLER': 'Digiseller',
  'admin.payments.provider.YOOKASSA': 'ЮKassa (карты, СБП)',
  'admin.payments.provider.CRYPTO': 'Криптовалюта на кошелёк',
  'admin.payments.hint.DIGISELLER': 'Покупатель платит на Digiseller и активирует код покупки у нас.',
  'admin.payments.hint.YOOKASSA': 'Оплата на странице ЮKassa, лицензия выдаётся автоматически.',
  'admin.payments.hint.CRYPTO': 'Покупатель переводит на ваш кошелёк, заказ вы подтверждаете вручную.',
  'admin.payments.enabled': 'Включён',
  'admin.payments.disabled': 'Выключен',
  'admin.payments.enable': 'Включить',
  'admin.payments.field.title': 'Название на витрине',
  'admin.payments.field.description': 'Подсказка покупателю',
  'admin.payments.secret.sellerId': 'ID продавца',
  'admin.payments.secret.apiKey': 'API-ключ',
  'admin.payments.secret.shopId': 'shopId',
  'admin.payments.secret.secretKey': 'Секретный ключ',
  'admin.payments.secret.set': 'Задан — введите новый, чтобы заменить',
  'admin.payments.secret.empty': 'Не задан',
  'admin.payments.secret.clear': 'Очистить',
  'admin.payments.digiseller.minRatio': 'Минимальная доля цены тарифа',
  'admin.payments.digiseller.minRatioHint': 'Сделка, оплаченная ниже этой доли, уходит на ручной разбор.',
  'admin.payments.digiseller.pollWindow': 'Следить за возвратами, часов',
  'admin.payments.yookassa.webhook': 'Адрес для уведомлений',
  'admin.payments.yookassa.webhookHint':
    'В личном кабинете ЮKassa: Интеграция → HTTP-уведомления. Включите события payment.succeeded и payment.canceled.',
  'admin.payments.yookassa.receipt': 'Отправлять чек (54-ФЗ)',
  'admin.payments.yookassa.vatCode': 'Код ставки НДС',
  'admin.payments.crypto.wallets': 'Кошельки',
  'admin.payments.crypto.addWallet': 'Добавить кошелёк',
  'admin.payments.crypto.noWallets': 'Кошельков пока нет — нажмите «Добавить кошелёк» и вставьте адрес.',
  'admin.payments.crypto.noWalletsWarning': 'Без кошелька реквизиты не готовы, и покупатели не увидят оплату криптовалютой.',
  'admin.payments.crypto.addressRequired': 'Заполните адрес каждого кошелька (не короче 10 символов) и курс больше нуля или удалите пустую строку.',
  'admin.payments.crypto.addressPlaceholder': 'Адрес кошелька, например T…',
  'admin.payments.crypto.currency': 'Монета',
  'admin.payments.crypto.network': 'Сеть',
  'admin.payments.crypto.address': 'Адрес',
  'admin.payments.crypto.rate': 'Курс',
  'admin.payments.crypto.decimals': 'Знаков',
  'admin.payments.crypto.explorer': 'Ссылка в обозреватель ({tx} — хеш)',
  'admin.payments.crypto.removeWallet': 'Удалить кошелёк',
  'admin.payments.crypto.rateHint':
    'Курс — сколько единиц валюты тарифа стоит одна монета (для USDT и рублей — курс доллара). Сумма к оплате округляется вверх.',
  'admin.payments.crypto.instructions': 'Инструкция для покупателя',
  'admin.payments.crypto.expireHours': 'Отменять неоплаченные через, часов',

  'admin.orders.title': 'Заказы',
  'admin.orders.description': 'Все покупки. Оплату криптовалютой подтверждают здесь вручную.',
  'admin.orders.tab.awaiting': 'Ждут подтверждения',
  'admin.orders.tab.all': 'Все заказы',
  'admin.orders.search': 'Номер заказа или логин',
  'admin.orders.anyStatus': 'Любой статус',
  'admin.orders.anyProvider': 'Любой способ',
  'admin.orders.empty.awaiting': 'Сейчас нечего проверять.',
  'admin.orders.empty.all': 'Под фильтр не попал ни один заказ.',
  'admin.orders.column.buyer': 'Покупатель',
  'admin.orders.column.payment': 'Оплата',
  'admin.orders.explorer': 'Открыть в обозревателе',
  'admin.orders.noTx': 'Покупатель ещё не прислал хеш транзакции',
  'admin.orders.confirm': 'Подтвердить',
  'admin.orders.reject': 'Отклонить',
  'admin.orders.confirmTitle': 'Подтвердить оплату {number}',
  'admin.orders.confirmHint':
    'Проверьте, что перевод пришёл в нужной сети и на нужную сумму. Лицензия выдаётся сразу после подтверждения.',
  'admin.orders.note': 'Комментарий (необязательно)',
  'admin.orders.confirmed': 'Оплата подтверждена, лицензия выдана',
  'admin.orders.rejectTitle': 'Отклонить оплату {number}',
  'admin.orders.rejectHint': 'Заказ будет отменён, покупатель получит письмо с причиной.',
  'admin.orders.reason': 'Причина',
  'admin.orders.rejected': 'Заказ отклонён',

  'admin.users.title': 'Пользователи',
  'admin.users.description': 'Поиск, блокировка, роли и ручная выдача лицензий.',
  'admin.users.search': 'Логин или почта',
  'admin.users.anyStatus': 'Любой статус',
  'admin.users.anyRole': 'Любая роль',
  'admin.users.empty': 'Под фильтр не попал ни один пользователь.',
  'admin.users.total': 'Всего: {total}',
  'admin.users.back': 'Все пользователи',
  'admin.users.column.user': 'Пользователь',
  'admin.users.column.roles': 'Роли',
  'admin.users.column.status': 'Статус',
  'admin.users.column.licenses': 'Лицензий',
  'admin.users.column.orders': 'Заказов',
  'admin.users.column.lastLogin': 'Последний вход',
  'admin.users.status.ACTIVE': 'Активен',
  'admin.users.status.PENDING_VERIFICATION': 'Почта не подтверждена',
  'admin.users.status.BLOCKED': 'Заблокирован',
  'admin.users.status.DELETED': 'Удалён',
  'admin.users.section.profile': 'Профиль',
  'admin.users.section.access': 'Доступ',
  'admin.users.section.roles': 'Роли',
  'admin.users.section.licenses': 'Лицензии',
  'admin.users.section.orders': 'Заказы',
  'admin.users.meta': 'Зарегистрирован {created} · последний вход {login}',
  'admin.users.twoFactorOn': '2FA включена',
  'admin.users.twoFactorOff': '2FA выключена',
  'admin.users.field.username': 'Логин',
  'admin.users.field.email': 'Почта',
  'admin.users.field.emailVerified': 'Почта подтверждена',
  'admin.users.blockHint': 'Блокировка сразу завершает все сессии пользователя.',
  'admin.users.blockedAt': 'Заблокирован {date}: {reason}',
  'admin.users.blockReason': 'Причина — сохранится в журнале',
  'admin.users.block': 'Заблокировать',
  'admin.users.unblock': 'Разблокировать',
  'admin.users.rolesHint': 'Выдавать и снимать можно только роли ниже вашей.',
  'admin.users.noLicenses': 'Лицензий нет.',
  'admin.users.noOrders': 'Заказов нет.',
  'admin.users.issue.title': 'Выдать лицензию',
  'admin.users.issue.product': 'Товар',
  'admin.users.issue.plan': 'Тариф',
  'admin.users.issue.action': 'Выдать',
  'admin.users.issue.done': 'Лицензия выдана',
  'admin.users.issue.hint': 'Бесплатно. Срок пойдёт с первого запуска.',

  'admin.settings.title': 'Настройки',
  'admin.settings.description': 'Параметры платформы. Изменения применяются без перезапуска.',

  'admin.audit.title': 'Журнал',
  'admin.audit.description': 'Кто, что и когда сделал, плюс события антифрода.',
  'admin.audit.tab.audit': 'Действия',
  'admin.audit.tab.antifraud': 'Антифрод',
  'admin.audit.filter': 'Начало действия, например order. или user.',
  'admin.audit.empty': 'Записей нет.',
  'admin.audit.antifraudEmpty': 'Событий антифрода нет.',
  'admin.audit.column.time': 'Время',
  'admin.audit.column.actor': 'Кто',
  'admin.audit.column.action': 'Действие',
  'admin.audit.column.entity': 'Объект',
  'admin.audit.column.details': 'Подробности',
  'admin.audit.column.type': 'Тип',
  'admin.audit.column.severity': 'Уровень',

  /* ---------------------------------------------------------------- */
  /* Панель справа (как в SIEM)                                         */
  /* ---------------------------------------------------------------- */
  'panel.close': 'Закрыть панель',
  'panel.resize': 'Потяните, чтобы изменить ширину панели',
  'panel.openPage': 'Открыть страницей',

  /* Док: подветка */
  'appearance.sub.title': 'Подпункты веток',
  'appearance.sub.description': 'Как раскрываются квадратики ветки в свёрнутой панели. Клик по ветке только раскрывает или сворачивает её, страница не меняется.',
  'appearance.sub.side': 'Колонкой сбоку',
  'appearance.sub.side.hint': 'Отдельная колонка квадратиков рядом с панелью, вниз от значка ветки.',
  'appearance.sub.inline': 'Внутри панели',
  'appearance.sub.inline.hint': 'Квадратики раскрываются прямо под значком ветки, как раскрывающаяся панель. Удобно на маленьком экране.',
  'settings.nav.roles': 'Роли и права',

  /* Карточка пользователя */
  'admin.users.selfHint': 'Это ваш аккаунт: здесь он только для просмотра, меняется в настройках профиля. Сделать себя реселлером можно.',
  'admin.users.section.reseller': 'Реселлер',
  'admin.users.reseller.is': 'Аккаунт продаёт оптом как «{name}».',
  'admin.users.reseller.not': 'Аккаунт не реселлер. Сделайте его реселлером — он сможет выпускать ключи со своего баланса.',
  'admin.users.reseller.open': 'Открыть реселлера',
  'admin.users.reseller.make': 'Сделать реселлером',

  /* Реселлеры: форма, подсказки логина, панель */
  'resellers.field.noProducts': 'Товаров пока нет — реселлер сможет продавать всё, что появится.',
  'resellers.admin.makeSelf': 'Реселлером буду я сам',
  'resellers.candidates.show': 'Показать аккаунты',
  'resellers.candidates.matching': 'Аккаунты по «{search}»',
  'resellers.candidates.all': 'Все аккаунты, по алфавиту',
  'resellers.candidates.count': { one: '{count} аккаунт', few: '{count} аккаунта', many: '{count} аккаунтов', other: '{count} аккаунта' },
  'resellers.candidates.none': 'Таких аккаунтов нет. Человек сначала регистрируется на сайте.',
  'resellers.candidates.you': 'вы',
  'resellers.candidates.already': 'уже реселлер',
  'resellers.adminPanel.tab.terms': 'Условия',
  'resellers.adminPanel.tab.balance': 'Баланс',
  'resellers.adminPanel.tab.requisites': 'Реквизиты',
  'resellers.adminPanel.tab.topups': 'Пополнения',
  'resellers.panel.since': 'Реселлер с',
  'resellers.panel.balanceTitle': 'Изменить баланс',
  'resellers.requisites.none': 'Реквизиты не выданы (или все выключены / не готовы) — реселлер не сможет пополнить баланс. Привяжите реквизиты ниже.',
  'resellers.requisites.own': 'Реселлер пополняет баланс только включёнными реквизитами из списка ниже.',
  'resellers.requisites.enabled': 'Принимать пополнения на эти реквизиты',
  'resellers.requisites.detach': 'Отвязать',
  'resellers.requisites.noneLeft': 'Привязывать больше нечего',
  'resellers.requisites.pick': 'Выберите реквизиты',
  'resellers.requisites.attach': 'Привязать',
  'resellers.requisites.hint': 'В списке только реквизиты раздела «Для реселлеров».',
  'resellers.requisites.manage': 'Перейти к разделу',
  'resellers.topups.panelSubtitle': '{name} · {date}',
  'resellers.topups.section.payment': 'Перевод',
  'resellers.topups.field.coins': 'К оплате',
  'resellers.topups.field.network': 'Сеть',
  'resellers.topups.field.address': 'Адрес',
  'resellers.topups.field.expires': 'Действует до',
  'resellers.topups.field.submitted': 'Хеш прислан',
  'resellers.topups.field.reviewed': 'Рассмотрена',
  'resellers.topups.field.credited': 'Зачислено',
  'resellers.topups.openReseller': 'Открыть реселлера',

  /* Журналы безопасности: панель события */
  'siem.panel.fields': 'Поля',
  'siem.panel.changes': 'Что изменилось',
  'siem.panel.sameIp': 'Тот же адрес',
  'siem.panel.sameUser': 'Тот же пользователь',
  'siem.panel.openUser': 'Открыть пользователя',
  'siem.panel.blockIp': 'Заблокировать адрес',
  'siem.panel.blockReason': 'Из журнала безопасности: {what}',
  'security.blocks.active': 'действует',
  'security.blocks.findUsers': 'Пользователи с этого адреса',
  'security.blocks.created': 'Создана',

  /* Способы оплаты: разделы и перенос */
  'admin.payments.section.PRODUCTS': 'Для товаров',
  'admin.payments.section.RESELLERS': 'Для реселлеров',
  'admin.payments.section.CHANNELS': 'Каналы',
  'admin.profiles.scope.PRODUCTS.title': 'Реквизиты для товаров',
  'admin.profiles.scope.PRODUCTS.description': 'Куда покупатели платят за товары: шаблоны для любых товаров и личные реквизиты одного товара.',
  'admin.profiles.scope.PRODUCTS.empty': 'Реквизитов для товаров пока нет.',
  'admin.profiles.scope.RESELLERS.title': 'Реквизиты для реселлеров',
  'admin.profiles.scope.RESELLERS.description': 'Кошельки, которыми реселлеры пополняют баланс. Новые реквизиты не доступны никому: доступ выдаётся в самих реквизитах или в карточке реселлера.',
  'admin.profiles.scope.RESELLERS.empty': 'Реквизитов для реселлеров пока нет — создайте их или перенесите из раздела товаров.',
  'admin.profiles.registry.column.resellers': 'Реселлеры',
  'admin.profiles.registry.nobody': 'не доступны никому',
  'admin.profiles.access.title': 'Доступ реселлеров',
  'admin.profiles.access.hint': 'Кошельки видят при пополнении только эти реселлеры. Тот же доступ настраивается в карточке реселлера.',
  'admin.profiles.access.nobody': 'Пока не доступны никому — выдайте доступ реселлерам, которые должны пополнять баланс этими реквизитами.',
  'admin.profiles.access.revoke': 'Забрать доступ',
  'admin.profiles.access.pick': 'Выберите реселлера',
  'admin.profiles.access.noneLeft': 'Доступ уже есть у всех',
  'admin.profiles.access.grant': 'Выдать',
  'admin.profiles.access.grantAll': 'Выдать всем',
  'admin.profiles.access.grantedAll': 'Доступ выдан всем реселлерам',

  /* Панель справа, док и горячие клавиши */
  'panel.hint.move': 'предыдущая / следующая',
  'panel.hint.close': 'закрыть',
  'appearance.reset': 'Сбросить всё',
  'appearance.resetDone': 'Настройки интерфейса возвращены по умолчанию',
  'appearance.yes': 'да',
  'appearance.no': 'нет',
  'appearance.dock.push': 'Освобождать место на странице под панель',
  'appearance.dock.push.none': 'Не сдвигать',
  'appearance.dock.push.dock': 'Под панель',
  'appearance.dock.push.all': 'Под панель и подпункты',
  'appearance.dock.push.none.hint': 'Панель лежит поверх страницы, страница не ужимается.',
  'appearance.dock.push.dock.hint': 'Страница отодвигается на ширину панели.',
  'appearance.dock.push.all.hint': 'Страница отодвигается ещё и под открытую колонку подпунктов.',
  'appearance.grow.title': 'Куда растёт панель, когда внутри раскрывается ветка',
  'appearance.grow.down': 'Только вниз',
  'appearance.grow.up': 'Только вверх',
  'appearance.grow.both': 'В обе стороны',
  'appearance.grow.down.hint': 'Верх стоит на месте, пункт под мышью не уезжает. Что не влезло — прокручивается внутри панели (у горизонтальной — вправо).',
  'appearance.grow.up.hint': 'Низ стоит на месте, панель растёт вверх и прокручивается внутри, если не влезает (у горизонтальной — влево).',
  'appearance.grow.both.hint': 'Панель остаётся по центру и растёт в обе стороны.',
  'appearance.size.title': 'Длина панели',
  'appearance.size.auto': 'По содержимому',
  'appearance.size.fixed': 'Своя',
  'appearance.size.auto.hint': 'Такой длины, сколько пунктов, но не больше экрана.',
  'appearance.size.fixed.hint': 'Всегда выбранной длины, лишние пункты прокручиваются внутри. Панель меняется сразу.',
  'appearance.size.length': 'Длина',
  'appearance.width.title': 'Ширина панели',
  'appearance.width.value': 'Ширина',
  'appearance.width.auto.hint': 'По ширине значков. Раскрытая внутри ветка её не меняет.',
  'appearance.width.fixed.hint': 'Всегда выбранной ширины (у горизонтальной — высоты), значки по центру.',
  'appearance.panel.title': 'Панель справа',
  'appearance.panel.description': 'Карточка записи, которая открывается справа по клику на строку списка.',
  'appearance.panel.push': 'Ужимать страницу, когда открыта панель',
  'appearance.panel.pushHint': 'Список сдвигается и остаётся виден целиком (на широком экране). Выключено — панель открывается поверх списка, как в части SIEM.',
  'appearance.panel.resizable': 'Менять ширину мышью',
  'appearance.panel.resizableHint': 'Потяните левый край панели — ширина запомнится. Выключено — всегда ширина, заданная ниже.',
  'appearance.panel.width': 'Ширина панели',
  'appearance.panel.showPreview': 'Показать панель',
  'appearance.panel.hidePreview': 'Скрыть панель',
  'appearance.panel.previewTitle': 'Предпросмотр панели',
  'appearance.panel.previewSubtitle': 'Такой ширины будут карточки записей: {width} px',
  'appearance.panel.previewSection': 'Текущие настройки',
  'appearance.panel.previewHint': 'Двигайте ползунок ширины — панель меняется вместе с ним. Закрыть — крестиком, Esc или клавишей закрытия.',
  'appearance.hotkeys.title': 'Горячие клавиши',
  'appearance.hotkeys.enabled': 'Горячие клавиши включены',
  'appearance.hotkeys.hint': 'На действие можно повесить сколько угодно клавиш. Не срабатывают, пока вы печатаете в поле. Учитывается физическая клавиша — раскладка не важна.',
  'appearance.hotkeys.group.lists': 'Списки с панелью справа',
  'appearance.hotkeys.group.menu': 'Панель навигации',
  'appearance.hotkeys.down': 'Следующая строка',
  'appearance.hotkeys.up': 'Предыдущая строка',
  'appearance.hotkeys.open': 'Открыть в панели',
  'appearance.hotkeys.close': 'Закрыть панель',
  'appearance.hotkeys.menuUp': 'Меню: пункт выше',
  'appearance.hotkeys.menuDown': 'Меню: пункт ниже',
  'appearance.hotkeys.menuActivate': 'Меню: открыть пункт',
  'appearance.hotkeys.down.hint': 'Если панель открыта — она переключается на эту строку.',
  'appearance.hotkeys.up.hint': 'Если панель открыта — она переключается на эту строку.',
  'appearance.hotkeys.open.hint': 'Открывает справа строку под курсором.',
  'appearance.hotkeys.close.hint': 'Esc тоже закрывает.',
  'appearance.hotkeys.menuUp.hint': 'Ходит по пунктам панели, включая раскрытую ветку.',
  'appearance.hotkeys.menuDown.hint': 'Ходит по пунктам панели, включая раскрытую ветку.',
  'appearance.hotkeys.menuActivate.hint': 'Открывает страницу, у ветки — раскрывает или сворачивает её. Мышью пункт открывается сразу.',
  'appearance.hotkeys.none': 'клавиш нет',
  'appearance.hotkeys.add': 'Добавить клавишу',
  'appearance.hotkeys.remove': 'Убрать клавишу',
  'appearance.hotkeys.moved': 'Клавиша {key} перенесена с «{from}»',
  'appearance.hotkeys.press': 'нажмите клавишу…',
  'appearance.hotkeys.reset': 'Клавиши по умолчанию',
  'admin.profiles.move.to.PRODUCTS': 'Перенести в товары',
  'admin.profiles.move.to.RESELLERS': 'Перенести в реселлеры',
  'admin.profiles.move.cryptoOnly': 'Реселлеры пополняют баланс только криптой — ЮKassa к ним не переносится.',
  'admin.profiles.move.detach.PRODUCTS': {
    one: 'Реквизиты снимутся с {count} товара и станут общим шаблоном для реселлеров.',
    few: 'Реквизиты снимутся с {count} товаров и станут общим шаблоном для реселлеров.',
    many: 'Реквизиты снимутся с {count} товаров и станут общим шаблоном для реселлеров.',
    other: 'Реквизиты снимутся с {count} товара и станут общим шаблоном для реселлеров.',
  },
  'admin.profiles.move.detach.RESELLERS': {
    one: 'Реквизиты снимутся с {count} реселлера.',
    few: 'Реквизиты снимутся с {count} реселлеров.',
    many: 'Реквизиты снимутся с {count} реселлеров.',
    other: 'Реквизиты снимутся с {count} реселлера.',
  },
  'admin.profiles.move.hint': 'К реквизитам пока ничего не привязано — они просто сменят раздел.',
  'admin.profiles.move.done': 'Реквизиты перенесены',
  'admin.profiles.panel.summary': 'Сводка',
  'admin.profiles.panel.updated': 'Изменены',
  'admin.profiles.panel.edit': 'Правка',

  /* Роли и права */
  'roles.title': 'Роли и права',
  'roles.description': 'Право — готовое действие системы, роль — набор таких действий. Собирайте свои роли из прав, которые есть у вас; системные роли можно взять за основу.',
  'roles.create': 'Создать роль',
  'roles.list.title': 'Роли',
  'roles.list.description': 'Нажмите на роль, чтобы увидеть её права. Уровень решает, кто может выдать роль: только тот, чей уровень выше.',
  'roles.column.role': 'Роль',
  'roles.column.priority': 'Уровень',
  'roles.column.permissions': 'Прав',
  'roles.column.users': 'Пользователей',
  'roles.system': 'системная',
  'roles.custom': 'своя',
  'roles.basedOn': 'На основе «{name}»',
  'roles.copy': 'Создать на основе',
  'roles.copyName': '{name} (копия)',
  'roles.systemHint': 'Системные роли сид пересобирает при каждом деплое, поэтому здесь они только для просмотра. Создайте свою роль на основе этой.',
  'roles.field.name': 'Название',
  'roles.field.slug': 'Код',
  'roles.field.priority': 'Уровень',
  'roles.field.description': 'Описание',
  'roles.priorityHint.staff': 'Права сотрудника: уровень от {min} и ниже вашего. Для такой роли обязательна 2FA.',
  'roles.priorityHint.user': 'Только права пользователя: уровень от 11 и ниже вашего.',
  'roles.permissions.title': { one: 'Права: {count}', few: 'Права: {count}', many: 'Права: {count}', other: 'Права: {count}' },
  'roles.permissions.hint': 'Добавить можно только права, которые есть у вас.',
  'roles.permissions.search': 'Найти право',
  'roles.permissions.all': 'Выбрать все',
  'roles.permissions.none': 'Снять все',
  'roles.permissions.notOwned': 'У вас самого нет этого права',
  'roles.problem.name': 'Укажите название роли',
  'roles.problem.slug': 'Код: 3–64 символа, строчная латиница, цифры и _',
  'roles.problem.permissions': 'Выберите хотя бы одно право',
  'roles.problem.priority': 'Уровень: от {min} до 99 и ниже вашего',
  'roles.delete': 'Удалить роль',
  'roles.deleteTitle': 'Удалить роль «{name}»?',
  'roles.deleteUsers': {
    one: 'Эта роль есть у {count} пользователя. Если она у него единственная, он получит роль пользователя.',
    few: 'Эта роль есть у {count} пользователей. Оставшиеся без ролей получат роль пользователя.',
    many: 'Эта роль есть у {count} пользователей. Оставшиеся без ролей получат роль пользователя.',
    other: 'Эта роль есть у {count} пользователя. Оставшиеся без ролей получат роль пользователя.',
  },
  'roles.deleteHint': 'Этой роли нет ни у кого.',
  'roles.deleted': 'Роль удалена',

  /* Заказы: панель */
  'admin.orders.panel.order': 'Заказ',
  'admin.orders.panel.paid': 'Оплачен',
  'admin.orders.panel.delivered': 'Выдан',
  'admin.orders.panel.cancelled': 'Отменён',
  'admin.orders.panel.provider': 'Способ',
  'admin.orders.panel.coins': 'К оплате',
  'admin.orders.panel.address': 'Адрес',
  'admin.orders.panel.submitted': 'Хеш прислан',
  'admin.orders.panel.confirmed': 'Подтверждён',
  'admin.orders.panel.error': 'Ошибка',
  'admin.orders.panel.licenses': 'Лицензии',
  'admin.orders.panel.openLicenses': {
    one: 'Открыть {count} лицензию',
    few: 'Открыть {count} лицензии',
    many: 'Открыть {count} лицензий',
    other: 'Открыть {count} лицензии',
  },
}
