/**
 * Английский словарь — ИСТОЧНИК ИСТИНЫ.
 *
 * Набор ключей задаётся здесь и только здесь: из него выводится тип `Messages`,
 * которым типизирован русский словарь. Забыть ключ в переводе нельзя —
 * `npx tsc --noEmit` покажет пропуск поимённо ещё до запуска.
 *
 * Правила именования ключей: `<область>.<блок>.<элемент>[.<роль>]`.
 * - область   — папка фичи (`licenses`, `login`, `hwid`, `billing`, `admin`)
 *               либо `common` / `nav` / `shell` / `locale` для сквозных вещей;
 * - блок      — экран или узел внутри области (`list`, `empty`, `twoFactor`);
 * - элемент   — что именно за текст (`title`, `description`, `submit`);
 * - роль      — уточнение вида `.label`, `.placeholder`, `.aria`, `.hint`.
 *
 * Ключи ОСМЫСЛЕННЫЕ ПО МЕСТУ, а не порядковые. `licenses.empty.title` при
 * переносе блока переезжает вместе с ним и остаётся правдой; `licenses.text17`
 * после первой же вставки текста посередине начинает врать.
 *
 * Файл — точка синхронизации нескольких веток: правится ДОБАВЛЕНИЕМ ключей
 * в свой раздел. Разделы не переставлять, чужие ключи не трогать.
 */
import type { Message } from '../types'

export const en = {
  /* ---------------------------------------------------------------- */
  /* Сквозные элементы: кнопки и состояния, повторяющиеся на экранах    */
  /* ---------------------------------------------------------------- */
  'common.action.retry': 'Try again',
  'common.action.search': 'Search',
  'common.action.cancel': 'Cancel',
  'common.action.close': 'Close',
  'common.action.refresh': 'Refresh',
  'common.action.resetFilters': 'Clear filters',
  'common.action.showMore': 'Show more ({loaded} of {total})',
  'common.action.back': 'Back',
  'common.action.toAccount': 'Go to my account',
  'common.action.prevPage': 'Previous',
  'common.action.nextPage': 'Next',
  'common.state.loading': 'Loading…',
  'common.password.show': 'Show password',
  'common.password.hide': 'Hide password',

  /* Кнопка «копировать»: подпись по умолчанию, подтверждение и отказ. */
  'common.copy.action': 'Copy',
  'common.copy.value': 'Value',
  'common.copy.aria': 'Copy: {label}',
  'common.copy.done': 'Copied',
  'common.copy.toast.success': '{label} — copied',
  'common.copy.toast.failed':
    'Your browser refused access to the clipboard. Select the value and copy it by hand.',

  /* Сроки и обратный отсчёт — их собирает `lib/format/date.ts`.
     Сокращения (h/min/s) для тикающего таймера, полные формы с числом —
     для колонки «сколько ждёт» на экране зависших сделок. */
  'common.duration.hoursMinutes': '{hours} h {minutes} min',
  'common.duration.minutesSeconds': '{minutes} min {seconds} s',
  'common.duration.seconds': '{seconds} s',
  'common.duration.minutes': {
    one: '{count} minute',
    other: '{count} minutes',
  },
  'common.duration.hours': {
    one: '{count} hour',
    other: '{count} hours',
  },
  'common.duration.days': {
    one: '{count} day',
    other: '{count} days',
  },

  /* ---------------------------------------------------------------- */
  /* Переключатель языка                                               */
  /* ---------------------------------------------------------------- */
  'locale.switcher.label': 'Language',
  'locale.switcher.option': 'Switch the interface to {language}',

  /* ---------------------------------------------------------------- */
  /* Каркас приложения: док навигации                                  */
  /* ---------------------------------------------------------------- */
  'shell.brand': 'Your account',
  'shell.action.signOut': 'Sign out',
  'dock.label': 'Navigation',
  'dock.expand': 'Expand panel',
  'dock.collapse': 'Collapse panel',
  'dock.hide': 'Hide the panel',
  'dock.show': 'Show the panel',
  'nav.settings': 'Settings',
  'nav.admin.security': 'Security',
  'nav.group.workspace': 'Workspace',
  'nav.group.account': 'Account',
  'nav.group.admin': 'Administration',
  'nav.licenses': 'My licences',
  'nav.catalog': 'Catalogue',
  'nav.activate': 'Activation',
  'nav.reseller': 'My sales',
  'nav.reseller.overview': 'Overview',
  'nav.reseller.keys': 'Keys',
  'nav.reseller.clients': 'Clients',
  'nav.reseller.balance': 'Balance and top-up',
  'nav.admin.resellers': 'Resellers',
  'nav.admin.resellerTopups': 'Top-up requests',
  'nav.branch.cabinet': 'My account',
  'nav.branch.users': 'Users',
  'nav.branch.resellers': 'Resellers',
  'nav.branch.catalog': 'Catalogue',
  'nav.branch.sales': 'Sales',
  'nav.branch.system': 'System',
  'nav.security': 'Security',
  'nav.security.password': 'Password',
  'nav.security.twoFactor': 'Two-factor',
  'nav.security.logins': 'Sign-in methods',
  'nav.telegram': 'Telegram bot',
  'nav.appearance': 'Appearance',
  'nav.admin.pendingDeals': 'Stuck deals',
  'nav.admin.licenses': 'All licences',

  /* Внешний вид */
  'appearance.title': 'Appearance',
  'appearance.description': 'These settings are saved in this browser.',
  'appearance.dock.title': 'Navigation panel',
  'appearance.dock.description': 'Which edge of the screen the panel sits on.',
  'appearance.dock.left': 'Left',
  'appearance.dock.right': 'Right',
  'appearance.dock.top': 'Top',
  'appearance.dock.bottom': 'Bottom',
  'appearance.dock.expanded': 'Expanded panel with labels',
  'appearance.dock.expandedHint': 'The button at the end of the panel does the same.',
  'appearance.theme.title': 'Colour scheme',
  'appearance.theme.description': 'Changes the colours of the whole app.',
  'appearance.theme.lime': 'Lime',
  'appearance.theme.lime.hint': 'Dark with an acid-lime accent. Default.',
  'appearance.theme.lavender': 'Lavender',
  'appearance.theme.lavender.hint': 'Dark with a soft violet accent.',
  'appearance.dock.autoHide': 'Show the panel only on hover',
  'appearance.dock.autoHideHint': 'The panel hides behind the screen edge and slides out when the pointer reaches it, like the Windows taskbar.',
  'appearance.dock.hidden': 'Hide the panel, keep only the letter',
  'appearance.dock.hiddenHint': 'Same as clicking the letter in the panel. Click it again to bring the panel back.',

  /* Окно настроек */
  'settings.title': 'Settings',
  'settings.search': 'Find a setting',
  'settings.nothingFound': 'Nothing found.',
  'settings.group.profile': 'Profile',
  'settings.group.security': 'Security',
  'settings.group.interface': 'Interface',
  'settings.group.integrations': 'Integrations',
  'settings.group.access': 'Access',
  'settings.nav.profile': 'Username and email',
  'settings.nav.access': 'My role',

  /* Профиль */
  'profile.needPassword': 'Set a password first: changing your username or email is confirmed with it.',
  'profile.currentPassword': 'Current password',
  'profile.username.title': 'Username',
  'profile.username.current': 'Current: {username}',
  'profile.username.new': 'New username',
  'profile.username.rules': '3–32 characters: Latin letters, digits, hyphen and underscore.',
  'profile.username.action': 'Change username',
  'profile.username.done': 'Username changed. Sign in with the new one from now on.',
  'profile.email.title': 'Email',
  'profile.email.verified': 'verified',
  'profile.email.unverified': 'not verified',
  'profile.email.none': 'No email yet.',
  'profile.email.pending': 'A confirmation link was sent to {email}. The address changes after you open it.',
  'profile.email.new': 'New email',
  'profile.email.hint': 'We will send a link to the new address; your current address gets a notice.',
  'profile.email.action': 'Change email',

  /* Моя роль */
  'access.roles.title': 'My role',
  'access.roles.description': 'Roles assigned to your account. Only an administrator above you can change them.',
  'access.permissions.title': 'What you can do',
  'access.permissions.count': {
    one: '{count} permission',
    other: '{count} permissions',
  },

  /* Подтверждение новой почты */
  'emailChange.noToken.title': 'The link is incomplete',
  'emailChange.noToken.description': 'Open the link from the email in full, or request the change again in your profile.',
  'emailChange.pending.title': 'Confirming the new address…',
  'emailChange.pending.description': 'This takes a second.',
  'emailChange.done.title': 'Email changed',
  'emailChange.done.description': 'The new address is now used for your account.',
  'emailChange.failed.title': 'The link does not work',
  'emailChange.failed.description': 'It has expired or was already used. Request the change again in your profile.',
  'emailChange.toProfile': 'Go to profile',

  /* Безопасность: мини-SIEM */
  'security.title': 'Security',
  'security.description': 'Event and sign-in logs with field search, address and account blocking.',
  'security.tab.events': 'Events',
  'security.tab.logins': 'Sign-ins',
  'security.tab.blocks': 'Blocks',
  'siem.placeholder.audit': 'action:user.* -actor:system ip:10.0.0.0/8 text',
  'siem.placeholder.logins': 'result:fail ip:203.0.113.* user:bob',
  'timeRange.quickTitle': 'Quick ranges',
  'timeRange.quick.15m': 'Last 15 minutes',
  'timeRange.quick.1h': 'Last hour',
  'timeRange.quick.4h': 'Last 4 hours',
  'timeRange.quick.24h': 'Last 24 hours',
  'timeRange.quick.7d': 'Last 7 days',
  'timeRange.quick.30d': 'Last 30 days',
  'timeRange.quick.90d': 'Last 90 days',
  'timeRange.quick.today': 'Today',
  'timeRange.quick.yesterday': 'Yesterday',
  'timeRange.quick.all': 'All time',
  'timeRange.lastTitle': 'Last…',
  'timeRange.last': 'Last {value}',
  'timeRange.unit.m': '{n} min',
  'timeRange.unit.h': '{n} h',
  'timeRange.unit.d': '{n} d',
  'timeRange.unitName.m': 'minutes',
  'timeRange.unitName.h': 'hours',
  'timeRange.unitName.d': 'days',
  'timeRange.absoluteTitle': 'Custom range',
  'timeRange.from': 'From',
  'timeRange.to': 'To',
  'timeRange.toHint': 'Leave "To" empty to include everything up to now.',
  'timeRange.now': 'now',
  'timeRange.apply': 'Apply',
  'timeRange.invalid': 'The start must be earlier than the end.',
  'timeRange.autoTitle': 'Auto refresh',
  'timeRange.auto.off': 'Off',
  'timeRange.auto.10s': '10 s',
  'timeRange.auto.30s': '30 s',
  'timeRange.auto.1m': '1 min',
  'timeRange.auto.5m': '5 min',
  'timeRange.earlier': 'Previous period',
  'timeRange.later': 'Next period',
  'timeRange.zoomOut': 'Zoom out ×2',
  'timeRange.refresh': 'Refresh',
  'timeRange.brushHint': 'Drag across the histogram to zoom into a period; click a bar to show just that step.',
  'siem.histogram.hover': '{time}: {n}',
  'siem.histogram.selection': 'Release to show {from} — {to}',

  'nav.branch.security': 'Security',
  'nav.sec.dashboards': 'Dashboards',
  'nav.sec.events': 'Events',
  'nav.sec.logins': 'Sign-ins',
  'nav.sec.hits': 'Detections',
  'nav.sec.rules': 'Correlation rules',
  'nav.sec.blocks': 'Blocks',
  'nav.sec.traffic': 'Traffic priority',

  'sec.page.dashboards': 'Security dashboards',
  'sec.page.dashboards.hint': 'Build your own screens from widgets: counters, histograms, tops, latest events, detections and load. The period applies to every widget; drag across a histogram to zoom in.',
  'sec.page.events': 'Events',
  'sec.page.events.hint': 'Audit log with field search, time range, histogram and top values. Click a row to open the event with address context.',
  'sec.page.logins': 'Sign-ins',
  'sec.page.logins.hint': 'Every sign-in attempt: who, from where, with what result. Failures are shown in red on the histogram.',
  'sec.page.blocks': 'Blocks',
  'sec.page.blocks.hint': 'Addresses and subnets blocked at the application, nginx or host firewall level, and accounts blocked by login.',
  'sec.page.hits': 'Detections',
  'sec.page.hits.hint': 'Correlation rule triggers: what was found, what the system did, and the triage queue.',
  'sec.page.rules': 'Correlation rules',
  'sec.page.rules.hint': 'WAF-style rules: N events (or N distinct values) per key within a window → a detection and an action: block the address at the chosen level and ports, or block the user.',
  'sec.page.traffic': 'Traffic priority',
  'sec.page.traffic.hint': 'Under overload and DDoS the site fails for anonymous visitors, not for the admin panel: trusted addresses, users and roles are served first.',

  'sec.severity.LOW': 'Low',
  'sec.severity.MEDIUM': 'Medium',
  'sec.severity.HIGH': 'High',
  'sec.severity.CRITICAL': 'Critical',

  'sec.level.APP': 'Application',
  'sec.level.EDGE': 'nginx',
  'sec.level.FIREWALL': 'Firewall',
  'sec.level.APP.hint': 'L7: the request reaches the API and is rejected by the first guard. Works always, no agents needed.',
  'sec.level.EDGE.hint': 'L7 at the edge: nginx answers 403, the request never reaches the API or the static files.',
  'sec.level.FIREWALL.hint': 'L3/L4 on the host: nftables drops packets before the TCP handshake. Can be limited to ports.',
  'sec.level.where': 'Level',
  'sec.level.column': 'Level',
  'sec.level.ports': 'Ports',
  'sec.level.portsHint': 'Comma separated, empty means all ports. Only 22 closes SSH but leaves the site working.',
  'sec.level.portsPlaceholder': 'ports: 22, 443 (empty — all)',

  'sec.hitStatus.NEW': 'New',
  'sec.hitStatus.ACKNOWLEDGED': 'In progress',
  'sec.hitStatus.RESOLVED': 'Resolved',
  'sec.hitStatus.FALSE_POSITIVE': 'False positive',

  'sec.outcome.alerted': 'Detection only',
  'sec.outcome.blocked': 'Blocked',
  'sec.outcome.skipped_protected': 'Skipped: protected',
  'sec.outcome.skipped_existing': 'Already blocked',
  'sec.outcome.failed': 'Failed: {code}',

  'sec.ua.title': 'Client',
  'sec.ua.desktop': 'desktop',
  'sec.ua.mobile': 'mobile',
  'sec.ua.bot': 'bot',
  'sec.ua.tool': 'script',
  'sec.ua.launcher': 'launcher',

  'sec.cond.events': '≥ {n} events in {window} per {field}',
  'sec.cond.distinct': '≥ {n} distinct {distinct} in {window} per {field}',
  'sec.action.ALERT': 'Detection only',
  'sec.action.BLOCK_IP': 'Block address',
  'sec.action.BLOCK_USER': 'Block user',
  'sec.actionText.blockIp': 'Block at {level}{ports}, {duration}',
  'sec.duration.forever': 'forever',
  'sec.source.LOGINS': 'Sign-ins',
  'sec.source.AUDIT': 'Events',

  'sec.ip.title': 'Address context',
  'sec.ip.scope.public': 'Public',
  'sec.ip.scope.private': 'Private network',
  'sec.ip.scope.loopback': 'Loopback',
  'sec.ip.scope.cgnat': 'Carrier NAT',
  'sec.ip.scope.link-local': 'Link-local',
  'sec.ip.scope.documentation': 'Documentation range',
  'sec.ip.scope.multicast': 'Multicast',
  'sec.ip.trusted': 'Trusted · weight {weight}',
  'sec.ip.reverse': 'Reverse DNS',
  'sec.ip.failed24h': 'Failed sign-ins, 24 h',
  'sec.ip.success24h': 'successful: {n}',
  'sec.ip.logins90d': 'Sign-ins, 90 days',
  'sec.ip.loginsTotal': '{total}, failed {failed}',
  'sec.ip.accounts': 'Accounts tried',
  'sec.ip.countries': 'Countries',
  'sec.ip.seen': 'First and last seen',
  'sec.ip.audit24h': 'Log events, 24 h',
  'sec.ip.users': 'Users who signed in from here',
  'sec.ip.staff': 'Staff member',
  'sec.ip.blocked': 'blocked',
  'sec.ip.hits': 'requests: {n}',
  'sec.ip.hitsTitle': 'Detections for this address',

  'sec.blocks.byRule': 'by rule',
  'sec.levels.title': 'Blocking levels',
  'sec.levels.hint': 'The path of a packet from left to right: the earlier a block works, the cheaper an attack is for the server. A firewall block also works in nginx and in the application.',
  'sec.levels.appAlways': 'always on',
  'sec.levels.noToken': 'EDGE_AGENT_TOKEN is not set',
  'sec.levels.online': 'agent online · {when}',
  'sec.levels.stale': 'agent silent since {when}',
  'sec.levels.nginxOff': 'nginx agent has not connected',
  'sec.levels.firewallOff': 'agent not running (compose profile firewall)',
  'sec.levels.osi.APP': 'L7',
  'sec.levels.osi.EDGE': 'L7',
  'sec.levels.osi.FIREWALL': 'L3/L4',
  'sec.levels.count': 'active: {n}',

  'sec.hits.updated': 'Updated: {n}',
  'sec.hits.toRules': 'Rules',
  'sec.hits.open': 'Awaiting triage',
  'sec.hits.critical': 'Critical, new',
  'sec.hits.day': 'Detections in 24 h',
  'sec.hits.all': 'All',
  'sec.hits.anySeverity': 'Any severity',
  'sec.hits.anyRule': 'All rules',
  'sec.hits.search': 'Key: address, login…',
  'sec.hits.do.ACKNOWLEDGED': 'Take',
  'sec.hits.do.RESOLVED': 'Resolved',
  'sec.hits.do.FALSE_POSITIVE': 'False positive',
  'sec.hits.column.severity': 'Severity',
  'sec.hits.column.when': 'When',
  'sec.hits.column.rule': 'Rule',
  'sec.hits.column.key': 'Key',
  'sec.hits.column.count': 'Count',
  'sec.hits.column.outcome': 'Action',
  'sec.hits.column.status': 'Status',
  'sec.hits.emptyNew': 'No new detections. The queue is clear.',
  'sec.hits.reopen': 'Back to new',
  'sec.hits.events': 'Events of this detection',
  'sec.hits.rule': 'Rule',
  'sec.hits.block': 'Blocks',
  'sec.hits.what': 'What happened',
  'sec.hits.countDistinct': '{n} events, {d} distinct {field}',
  'sec.hits.window': 'Window',
  'sec.hits.span': 'First and last event',
  'sec.hits.handled': 'Handled by',
  'sec.hits.inside': 'Inside the detection',
  'sec.hits.note': 'Note',
  'sec.hits.notePlaceholder': 'What was found, what was done',

  'sec.rules.new': 'New rule',
  'sec.rules.on': 'On',
  'sec.rules.name': 'Name',
  'sec.rules.description': 'Description',
  'sec.rules.condition': 'Condition',
  'sec.rules.action': 'Action',
  'sec.rules.hits24h': '24 h',
  'sec.rules.lastHit': 'Last detection',
  'sec.rules.empty': 'No rules yet. Create the first one — or run the seed to get examples.',
  'sec.rules.enabled': 'Rule enabled',
  'sec.rules.disabled': 'Rule disabled',
  'sec.rules.open': 'new: {n}',
  'sec.rules.safety': 'Rules never block trusted addresses (traffic priority), addresses staff sign in from, or staff accounts — only by hand.',
  'sec.rules.saved': 'Rule saved',
  'sec.rules.created': 'Created {when}',
  'sec.rules.active': 'Enabled',
  'sec.rules.off': 'Disabled',
  'sec.rules.sentence.if': 'If',
  'sec.rules.sentence.in': 'in {source}',
  'sec.rules.section.about': 'About',
  'sec.rules.section.count': 'What to count',
  'sec.rules.section.do': 'What to do',
  'sec.rules.source': 'Log',
  'sec.rules.query': 'Filter',
  'sec.rules.queryHint': 'Same language as in the log explorer. Fields:',
  'sec.rules.groupBy': 'Per key',
  'sec.rules.groupByHint': 'Events are counted separately for each value of this field.',
  'sec.rules.measure': 'Count',
  'sec.rules.measure.events': 'events',
  'sec.rules.measure.distinct': 'distinct {field}',
  'sec.rules.threshold': 'Threshold',
  'sec.rules.window': 'Window, minutes',
  'sec.rules.windowPreset': 'Preset',
  'sec.rules.severity': 'Severity',
  'sec.rules.actionHint': 'Block address — only when grouped by ip; block user — only when grouped by {field}.',
  'sec.rules.blockFor': 'Block for',
  'sec.rules.cooldown': 'Pause between detections, minutes',
  'sec.rules.cooldownHint': 'The same key will not trigger the rule again sooner than this.',
  'sec.rules.enabledLabel': 'Rule is enabled (evaluated every 30 seconds)',
  'sec.rules.preview': 'Test on data',
  'sec.rules.ran': 'Done: detections {hits}, groups over the threshold {groups}',
  'sec.rules.runNow': 'Run now',
  'sec.rules.deleteConfirm': 'Delete the rule together with its detections?',
  'sec.rules.deleted': 'Rule deleted',
  'sec.rules.delete': 'Delete',
  'sec.rules.previewTitle': 'Would trigger now: {n}',
  'sec.rules.previewEmpty': 'Nothing over the threshold in the window (since {window}).',
  'sec.rules.protected': 'protected',

  'sec.traffic.attackOn': 'Attack mode is ON',
  'sec.traffic.attackOff': 'Attack mode is off',
  'sec.traffic.attackOnHint': 'Requests with weight below {n} get 503 immediately. Trusted addresses, users and staff roles keep working.',
  'sec.traffic.attackOffHint': 'Turn it on during a DDoS: anonymous visitors and regular users get 503, the admin panel keeps working.',
  'sec.traffic.disabledWarn': 'Request prioritisation is turned off in the settings below.',
  'sec.traffic.attackMinWeight': 'Minimum weight',
  'sec.traffic.attackStopped': 'Attack mode turned off',
  'sec.traffic.attackStarted': 'Attack mode turned on',
  'sec.traffic.attackDisable': 'Turn off',
  'sec.traffic.attackEnable': 'Turn on attack mode',
  'sec.traffic.youWouldBe': 'Your weight: {n}',
  'sec.traffic.you': 'Your weight: {n}',
  'sec.traffic.youSafe': 'You are above the attack mode threshold — the panel stays available to you.',
  'sec.traffic.youUnsafe': 'You are below the attack mode threshold. Add your address or account to trusted ones.',
  'sec.traffic.yourIp': 'Your address:',
  'sec.traffic.myIpNote': 'administrator address',
  'sec.traffic.trustedAdded': 'Added to trusted',
  'sec.traffic.trustMyIp': 'Trust my address',
  'sec.traffic.inFlight': 'In progress / limit',
  'sec.traffic.queued': 'In queue',
  'sec.traffic.lag': 'Event loop lag',
  'sec.traffic.ms': '{n} ms',
  'sec.traffic.trustedCount': 'Trusted',
  'sec.traffic.trustedValue': '{ips} addr. · {users} users',
  'sec.traffic.chart': 'Last 10 minutes',
  'sec.traffic.part.bypass': 'Priority',
  'sec.traffic.part.admitted': 'Immediately',
  'sec.traffic.part.queued': 'Via queue',
  'sec.traffic.part.shed': 'Rejected (503)',
  'sec.traffic.talkers': 'Top addresses by requests',
  'sec.traffic.talkersHint': 'Who sends the most requests to the API right now. Click to see the context, block or trust.',
  'sec.traffic.talkersEmpty': 'No requests yet.',
  'sec.traffic.perMinute': 'per min',
  'sec.traffic.weight': 'Weight',
  'sec.traffic.trust': 'Trust',
  'sec.traffic.block': 'Block',
  'sec.traffic.blockReason': 'Traffic priority: {n} requests per minute',
  'sec.traffic.priorities': 'Trusted addresses and users',
  'sec.traffic.prioritiesHint': 'Their requests are served first and pass attack mode. Trusted addresses also bypass nginx rate limits and are never blocked by rules.',
  'sec.traffic.kind.IP': 'Address',
  'sec.traffic.kind.USER': 'User',
  'sec.traffic.loginPlaceholder': 'login',
  'sec.traffic.note': 'Note',
  'sec.traffic.add': 'Add',
  'sec.traffic.prioritiesEmpty': 'No trusted entries yet. Start with your own address.',
  'sec.traffic.remove': 'Remove',
  'sec.traffic.settings': 'Queue and weights',
  'sec.traffic.settingsHint': 'Every API request gets a weight from 0 to 100: the maximum of its address, user, role and priority pass. When the limit is reached, heavier requests are served first.',
  'sec.traffic.enabled': 'Prioritise requests (queue by weight)',
  'sec.traffic.field.maxConcurrent': 'Concurrent requests',
  'sec.traffic.field.maxConcurrent.hint': 'Halved automatically when the event loop lags.',
  'sec.traffic.field.queueMax': 'Queue length',
  'sec.traffic.field.queueMax.hint': 'When full, the lightest request is dropped.',
  'sec.traffic.field.queueTimeoutMs': 'Max wait, ms',
  'sec.traffic.field.queueTimeoutMs.hint': 'Longer — 503 with Retry-After.',
  'sec.traffic.field.lagThresholdMs': 'Lag threshold, ms',
  'sec.traffic.field.lagThresholdMs.hint': 'p99 of the event loop delay.',
  'sec.traffic.field.bypassWeight': 'Bypass weight',
  'sec.traffic.field.bypassWeight.hint': 'From this weight the request skips the queue.',
  'sec.traffic.field.anonymousWeight': 'Anonymous weight',
  'sec.traffic.field.anonymousWeight.hint': 'Visitors without a session.',
  'sec.traffic.field.authenticatedWeight': 'Signed-in weight',
  'sec.traffic.field.authenticatedWeight.hint': 'Any user with a valid token.',
  'sec.traffic.roleWeights': 'Role weights',
  'sec.traffic.roleWeightsHint': 'Empty — the signed-in weight. Staff get a priority pass after signing in, so they can sign in again during an attack.',
  'sec.traffic.saved': 'Settings saved',
  'sec.traffic.reset': 'Reset changes',

  'sec.dash.newName': 'New dashboard',
  'sec.dash.done': 'Done',
  'sec.dash.edit': 'Customise',
  'sec.dash.new': 'New dashboard',
  'sec.dash.shared': 'Shared',
  'sec.dash.deleteConfirm': 'Delete dashboard «{name}»?',
  'sec.dash.deleted': 'Dashboard deleted',
  'sec.dash.empty': 'No widgets on this dashboard yet.',
  'sec.dash.addWidget': 'Add widget',
  'sec.dash.name': 'Dashboard name',
  'sec.dash.shareLabel': 'Visible to colleagues',
  'sec.dash.delete': 'Delete dashboard',
  'sec.dash.moveLeft': 'Move back',
  'sec.dash.moveRight': 'Move forward',
  'sec.dash.resize': 'Size: {size}',
  'sec.dash.editWidget': 'Edit widget',
  'sec.dash.removeWidget': 'Remove widget',
  'sec.widget.type.counter': 'Counter',
  'sec.widget.type.counter.hint': 'How many events match the filter for the period, with a trend.',
  'sec.widget.type.histogram': 'Histogram',
  'sec.widget.type.histogram.hint': 'Events over time; drag to zoom the whole dashboard.',
  'sec.widget.type.top': 'Top values',
  'sec.widget.type.top.hint': 'Most frequent addresses, users, actions or reasons.',
  'sec.widget.type.events': 'Latest events',
  'sec.widget.type.events.hint': 'Live feed of the log by the filter.',
  'sec.widget.type.hits': 'Detections',
  'sec.widget.type.hits.hint': 'New correlation rule triggers.',
  'sec.widget.type.traffic': 'Load',
  'sec.widget.type.traffic.hint': 'Requests in progress, queue, rejections, attack mode.',
  'sec.widget.type.blocks': 'Blocks',
  'sec.widget.type.blocks.hint': 'Active blocks by level.',
  'sec.widget.size.s': 'S',
  'sec.widget.size.m': 'M',
  'sec.widget.size.l': 'L',
  'sec.widget.size.full': 'Full width',
  'sec.widget.openAll': 'Open all ({n})',
  'sec.widget.typeTitle': 'Widget type',
  'sec.widget.settings': 'Settings',
  'sec.widget.title': 'Title',
  'sec.widget.queryHint': 'Same filter language as in the log explorer; empty — all events.',
  'sec.widget.field': 'Field',
  'sec.widget.size': 'Size',

  'nav.downloads': 'Launcher',
  'nav.admin.launcher': 'Launcher',

  'launcher.badge': 'Signed releases · verified checksum',
  'launcher.title': 'Launcher',
  'launcher.subtitle': 'One app for all your products: it signs you in, downloads and updates builds and checks their integrity before every launch.',
  'launcher.platform.WINDOWS': 'Windows',
  'launcher.platform.LINUX': 'Linux',
  'launcher.platform.MACOS': 'macOS',
  'launcher.none': 'No versions available yet',
  'launcher.noneHint': 'The administrator has not published a launcher for you yet. Check back later.',
  'launcher.noneLicense': 'The launcher becomes available once you have an active licence.',
  'launcher.toCatalog': 'Choose a plan',
  'launcher.beta': 'Beta channel',
  'launcher.history': 'Previous versions',
  'launcher.version': 'Version {version}',
  'launcher.channel.STABLE': 'Stable',
  'launcher.channel.BETA': 'Beta',
  'launcher.mandatory': 'required update',
  'launcher.download': 'Download for {platform}',
  'launcher.downloadShort': 'Download',
  'launcher.copied': 'Checksum copied',
  'launcher.sha256Hint': 'Compare it with the downloaded file: Get-FileHash .\\file.exe',
  'launcher.notes': 'What’s new',
  'launcher.requirements': 'System requirements',
  'launcher.steps': 'How to install',

  'launcherAdmin.title': 'Launcher',
  'launcherAdmin.description': 'Releases of the client launcher: versions per platform and channel, the file with a server-side checksum, and who can download it — everyone from the home page, signed-in users, licence owners or chosen roles.',
  'launcherAdmin.new': 'New release',
  'launcherAdmin.stat.published': 'Published',
  'launcherAdmin.stat.drafts': 'Drafts',
  'launcherAdmin.stat.downloads': 'Downloads',
  'launcherAdmin.column.version': 'Version',
  'launcherAdmin.column.audience': 'Who can download',
  'launcherAdmin.column.file': 'File',
  'launcherAdmin.column.status': 'Status',
  'launcherAdmin.column.downloads': 'Downloads',
  'launcherAdmin.empty': 'No releases yet. Create the first one and upload the installer.',
  'launcherAdmin.audience.PUBLIC': 'Everyone',
  'launcherAdmin.audience.PUBLIC.hint': 'Download button on the home page too, no sign-in needed.',
  'launcherAdmin.audience.USERS': 'Signed-in users',
  'launcherAdmin.audience.USERS.hint': 'Any user in their cabinet.',
  'launcherAdmin.audience.LICENSED': 'Licence owners',
  'launcherAdmin.audience.LICENSED.hint': 'Only users with an active licence.',
  'launcherAdmin.audience.ROLES': 'Chosen roles',
  'launcherAdmin.audience.ROLES.hint': 'Beta testers, staff — whoever has one of the roles below.',
  'launcherAdmin.noFile': 'no file',
  'launcherAdmin.published': 'Published {date}',
  'launcherAdmin.publishedShort': 'Published',
  'launcherAdmin.draft': 'Draft',
  'launcherAdmin.saved': 'Saved',
  'launcherAdmin.uploaded': 'File uploaded, checksum computed',
  'launcherAdmin.section.release': 'Release',
  'launcherAdmin.section.file': 'Installer file',
  'launcherAdmin.section.publish': 'Publication',
  'launcherAdmin.field.version': 'Version',
  'launcherAdmin.field.channel': 'Channel',
  'launcherAdmin.field.platform': 'Platform',
  'launcherAdmin.field.notes': 'What’s new',
  'launcherAdmin.field.notesHint': 'Shown to users next to the download button. One change per line.',
  'launcherAdmin.field.audience': 'Who can download',
  'launcherAdmin.field.roles': 'Roles',
  'launcherAdmin.field.mandatory': 'Required update: older launchers must update to this version',
  'launcherAdmin.lockedHint': 'Version, platform and channel of a published release do not change — release a new one.',
  'launcherAdmin.create': 'Create draft',
  'launcherAdmin.size': 'Size',
  'launcherAdmin.uploading': 'Uploading… {n}%',
  'launcherAdmin.replace': 'Drop a file here to replace it',
  'launcherAdmin.drop': 'Drop the installer here or click to choose',
  'launcherAdmin.createdBy': 'Created',
  'launcherAdmin.publish': 'Publish',
  'launcherAdmin.unpublish': 'Unpublish',
  'launcherAdmin.publishedToast': 'Release published',
  'launcherAdmin.unpublished': 'Release unpublished — it can no longer be downloaded',
  'launcherAdmin.deleteConfirm': 'Delete this draft?',
  'launcherAdmin.delete': 'Delete',
  'launcherAdmin.needFile': 'Upload the file to publish the release.',
  'launcherAdmin.page.title': 'Download page',
  'launcherAdmin.page.hint': 'Shown in the cabinet and on the home page next to the download buttons.',
  'launcherAdmin.page.lines': 'One item per line.',

  'landing.brand': 'License Platform',
  'landing.backHome': 'Home',
  'landing.nav.products': 'Products',
  'landing.nav.pricing': 'Pricing',
  'landing.nav.security': 'Security',
  'landing.nav.launcher': 'Launcher',
  'landing.nav.login': 'Sign in',
  'landing.nav.register': 'Get started',
  'landing.nav.cabinet': 'My cabinet',
  'landing.hero.eyebrow': 'New generation of protected software',
  'landing.hero.title1': 'Power that',
  'landing.hero.title2': 'stays yours.',
  'landing.hero.subtitle': 'Premium products with device binding, encrypted delivery and instant activation. One launcher, every update, zero hassle.',
  'landing.hero.download': 'Download for {platform}',
  'landing.hero.getLauncher': 'Get the launcher',
  'landing.hero.pricing': 'See pricing',
  'landing.hero.releaseMeta': 'Version {version} · {size} · free',
  'landing.mock.product1': 'Your product',
  'landing.mock.product2': 'Next release',
  'landing.mock.title': 'Launcher',
  'landing.mock.ready': 'Ready',
  'landing.mock.updating': 'Updating',
  'landing.mock.protected': 'Session protected',
  'landing.stats.products': 'products',
  'landing.stats.from': 'starting price',
  'landing.stats.encryption': 'payload encryption',
  'landing.stats.support': 'support',
  'landing.products.eyebrow': 'Products',
  'landing.products.title': 'Built to perform. Protected by design.',
  'landing.products.subtitle': 'Every product ships through the launcher: signed builds, automatic updates, licence check on every start.',
  'landing.products.plans': 'Plans: {n}',
  'landing.products.point1': 'Bound to your device — the key works only for you',
  'landing.products.point2': 'Updates arrive automatically through the launcher',
  'landing.products.point3': 'Instant activation right after payment',
  'landing.products.from': 'from',
  'landing.products.buy': 'Buy',
  'landing.pricing.eyebrow': 'Pricing',
  'landing.pricing.title': 'Pick your pace.',
  'landing.pricing.subtitle': 'Pay for the period you need. The longer the plan, the cheaper the day.',
  'landing.pricing.best': 'Best value',
  'landing.pricing.perDay': '{price} per day',
  'landing.pricing.choose': 'Choose',
  'landing.features.eyebrow': 'Why us',
  'landing.features.title': 'Security you don’t have to think about.',
  'landing.features.hwid.title': 'Device binding',
  'landing.features.hwid.text': 'A licence is tied to your hardware. A leaked key is useless on someone else’s PC.',
  'landing.features.crypto.title': 'Encrypted delivery',
  'landing.features.crypto.text': 'Builds travel AES-256-GCM encrypted and are never stored on disk in clear form.',
  'landing.features.instant.title': 'Instant activation',
  'landing.features.instant.text': 'Pay — and the licence is already in your cabinet. No waiting for a manager.',
  'landing.features.updates.title': 'Always up to date',
  'landing.features.updates.text': 'The launcher downloads new versions itself and verifies every file’s checksum.',
  'landing.features.ddos.title': 'Resilient platform',
  'landing.features.ddos.text': 'Firewall-level blocking, correlation rules and traffic prioritisation keep the service online.',
  'landing.features.support.title': 'Real support',
  'landing.features.support.text': 'Questions about activation or devices are answered by people, not a bot.',
  'landing.launcher.eyebrow': 'Launcher',
  'landing.launcher.title': 'One app. Every product.',
  'landing.launcher.subtitle': 'Sign in once — the launcher keeps your products installed, updated and verified.',
  'landing.launcher.for': 'For {platform}',
  'landing.launcher.inCabinet': 'Open in cabinet',
  'landing.launcher.loginToDownload': 'Sign in to download',
  'landing.final.title': 'Ready when you are.',
  'landing.final.subtitle': 'Create an account in a minute and pick the plan that fits.',
  'landing.final.start': 'Create account',
  'siem.fields': 'Fields:',
  'siem.syntax': '· * — wildcard · space or AND — both · OR or | — either · NOT or - — exclude · ( ) — grouping · "phrase"',
  'siem.empty': 'Nothing matches.',
  'siem.total': 'Found: {total}',
  'siem.histogram': 'Events over time',
  'siem.interval': 'step {interval}',
  'siem.failed': 'failed',
  'siem.success': 'success',
  'siem.top': 'Top: {field}',
  'siem.include': 'Filter by value',
  'siem.exclude': 'Exclude value',
  'siem.column.time': 'Time',
  'siem.column.actor': 'Actor',
  'siem.column.action': 'Action',
  'siem.column.entity': 'Object',
  'siem.column.ip': 'IP',
  'siem.column.user': 'User',
  'siem.column.result': 'Result',
  'siem.column.reason': 'Reason',
  'siem.column.method': 'Method',
  'security.blocks.ipTitle': 'Blocked addresses',
  'security.blocks.ipHint': 'Requests from these addresses and subnets are rejected before sign-in. Your own address cannot be blocked.',
  'security.blocks.ipDone': 'Address blocked',
  'security.blocks.ipEmpty': 'No blocked addresses.',
  'security.blocks.reason': 'Reason',
  'security.blocks.duration.1': 'For an hour',
  'security.blocks.duration.24': 'For a day',
  'security.blocks.duration.168': 'For a week',
  'security.blocks.duration.720': 'For a month',
  'security.blocks.duration.0': 'Forever',
  'security.blocks.block': 'Block',
  'security.blocks.unblock': 'Unblock',
  'security.blocks.removed': 'Block removed',
  'security.blocks.column.cidr': 'Address / subnet',
  'security.blocks.column.by': 'Who',
  'security.blocks.column.until': 'Until',
  'security.blocks.expired': 'expired',
  'security.blocks.forever': 'forever',
  'security.blocks.userTitle': 'Block by username',
  'security.blocks.userHint': 'The account is blocked and all its sessions end right away.',
  'security.blocks.username': 'Username',
  'security.blocks.userDone': '{username} is blocked',

  /* Реквизиты оплаты */
  'admin.payments.channels.title': 'Payment channels',
  'admin.payments.channels.description': 'Global switches and storefront names. A product accepts a method only if its channel is on.',
  'admin.profiles.title': 'Payment detail templates',
  'admin.profiles.description': 'A YooKassa shop or a set of crypto wallets. Set up once, then attach to any products.',
  'admin.profiles.create.YOOKASSA': 'YooKassa template',
  'admin.profiles.create.CRYPTO': 'Crypto template',
  'admin.profiles.empty': 'No templates yet.',
  'admin.profiles.inUse': 'Attached to products — detach it first',
  'admin.profiles.delete': 'Delete for everyone',
  'admin.profiles.deleted': 'Payment details deleted and removed from all products',
  'admin.profiles.ready': 'ready',
  'admin.profiles.notReady': 'not ready',
  'admin.profiles.usedBy': {
    one: 'Used by {count} product',
    other: 'Used by {count} products',
  },
  'admin.profiles.field.name': 'Name',
  'admin.profiles.field.namePlaceholder': 'Main shop',
  'admin.productPayments.title': 'Payment',
  'admin.productPayments.description':
    'Where money for this product goes. Attach as many details per method as you like — templates or the product’s own; they are listed below.',
  'admin.productPayments.channelOff': 'channel is off',
  'admin.productPayments.accept': 'Accept',
  'admin.productPayments.none': 'Do not accept',
  'admin.productPayments.templates': 'Templates',
  'admin.productPayments.personal': 'Own details of this product',
  'admin.productPayments.createPersonal': 'Own details',
  'admin.productPayments.editPersonal': 'Edit details',
  'admin.productPayments.notAccepted': 'This method is not offered for the product.',
  'admin.productPayments.usesTemplate': 'Payments go to the template «{name}».',
  'admin.productPayments.usesPersonal': 'Payments go to the product’s own details.',
  'admin.productPayments.enableChannel': 'Turn the channel on',
  'admin.productPayments.hiddenFromBuyers': 'Buyers will not see this payment method:',
  'admin.productPayments.reasonDisabled': '“Accept payments” is switched off for this product.',
  'admin.productPayments.reasonChannelOff': 'The payment channel is switched off for the whole platform.',
  'admin.productPayments.reasonNoLive': 'None of the attached details is both switched on and ready.',
  'admin.productPayments.liveCount': { one: '{count} accepting', other: '{count} accepting' },
  'admin.productPayments.off': 'off',
  'admin.productPayments.detach': 'Detach from this product (the details stay in the registry)',
  'admin.productPayments.templateShared': {
    one: 'This template is attached to {count} product — the change applies to all of them.',
    other: 'This template is attached to {count} products — the change applies to all of them.',
  },
  'admin.productPayments.attachExisting': 'Attach existing details…',
  'admin.productPayments.addWallet': 'New wallet',
  'admin.productPayments.buyerChooses': 'With several details attached, the buyer chooses where to pay.',
  'admin.profiles.problem.name': 'Enter a name — it is how you find these details in the registry.',
  'admin.profiles.noWallets': 'no wallets',
  'admin.profiles.shopConnected': 'shop keys are set',
  'admin.profiles.shopNotConnected': 'shop keys are not set',
  'admin.profiles.kind.TEMPLATE': 'Template',
  'admin.profiles.kind.PERSONAL': 'Product’s own',
  'admin.profiles.registry.title': 'Payment details',
  'admin.profiles.registry.description':
    'All payment details in the system: templates and products’ own details. Who created them, when, and which products they are attached to. Deleting removes them from every product at once.',
  'admin.profiles.registry.queryPlaceholder': 'kind:personal (creator:test OR product:fc26) NOT wallet:T9*',
  'admin.profiles.registry.anyProvider': 'Any method',
  'admin.profiles.registry.anyKind': 'Any kind',
  'admin.profiles.registry.bulkDelete': 'Delete for everyone',
  'admin.profiles.registry.empty': 'No payment details match the filter.',
  'admin.profiles.registry.column.name': 'Details',
  'admin.profiles.registry.column.contents': 'Wallets / shop',
  'admin.profiles.registry.column.products': 'Products',
  'admin.profiles.registry.column.state': 'State',
  'admin.profiles.registry.column.creator': 'Created by',
  'admin.profiles.registry.column.created': 'Created',
  'admin.profiles.registry.unattached': 'not attached',
  'admin.profiles.registry.deleteTitle': 'Delete “{name}”?',
  'admin.profiles.registry.deleteAttached': 'They are attached to: {products}. They will be removed from these products, and buyers will no longer be able to pay to them.',
  'admin.profiles.registry.deleteHint': 'The details disappear from the registry and from every product. Already issued payments can still be checked.',
  'admin.profiles.registry.bulkDeleteTitle': 'Delete selected details for everyone',

  /* Пользователи: поиск и адреса */
  'admin.users.queryPlaceholder': 'username:bob role:support status:BLOCKED',
  'admin.users.queryPlaceholderIp': 'ip:203.0.113.0/24 role:user status:ACTIVE',
  'admin.users.column.ips': 'Addresses',
  'admin.users.searchByIp': 'Find everyone with this address',
  'admin.users.section.ips': 'Addresses',
  'admin.users.ipsHint': 'Every IP this user worked from. Shared addresses often mean a second account.',
  'admin.users.noIps': 'No addresses recorded yet.',
  'admin.users.ip.lastSeen': 'Last seen',
  'admin.users.ip.firstSeen': 'First seen',
  'admin.users.ip.hits': 'Times',
  'admin.users.ip.shared': 'Other accounts',
  'admin.users.ip.blocked': 'blocked',
  'admin.users.ip.sharedLink': {
    one: '{count} account',
    other: '{count} accounts',
  },
  'admin.users.ip.blockReason': 'Address of user {username}',

  /* Баннер «пароль не задан» */
  'shell.passwordRequired.title': 'Set a password.',
  'shell.passwordRequired.body':
    "Until you do, no licence is issued and the launcher won't start.",
  'shell.passwordRequired.action': 'Set a password',

  /* ---------------------------------------------------------------- */
  /* Мои лицензии — список                                             */
  /* ---------------------------------------------------------------- */
  'licenses.list.title': 'My licences',
  'licenses.list.count': {
    one: '{count} licence',
    other: '{count} licences',
  },
  'licenses.list.loading': 'Loading the list…',
  'licenses.list.search.placeholder': 'Search by key',
  'licenses.list.search.aria': 'Search licences by key',
  'licenses.list.status.aria': 'Licence status',
  'licenses.list.status.all': 'All statuses',

  'licenses.empty.title': 'No licences yet',
  'licenses.empty.description':
    'Buy access in the catalogue, or activate a store code here — the licence appears the moment it goes through.',
  'licenses.empty.action.catalog': 'Choose a plan',
  'licenses.empty.action.activate': 'I have a code',

  'licenses.emptyFiltered.title': 'Nothing matched',
  'licenses.emptyFiltered.description':
    'No licence fits the filters you picked.',

  'licenses.error.load': "We couldn't load your licences.",
  'licenses.error.forbidden.title': 'Section unavailable',
  'licenses.error.forbidden.description':
    "Your account can't view licences. If that looks wrong, contact support.",

  /* ---------------------------------------------------------------- */
  /* Лицензия: статусы и подсказки «что делать дальше»                 */
  /* ---------------------------------------------------------------- */
  'licenses.status.PENDING.label': 'Waiting for first launch',
  'licenses.status.ACTIVE.label': 'Active',
  'licenses.status.EXPIRED.label': 'Expired',
  'licenses.status.BLOCKED.label': 'Blocked',
  'licenses.status.REVOKED.label': 'Revoked',

  'licenses.status.PENDING.hint':
    'The term starts at the first launch of the launcher — until then none of the days you paid for are used up.',
  'licenses.status.ACTIVE.hint':
    'The licence works. Start the product through the launcher.',
  'licenses.status.EXPIRED.hint':
    'Renew the licence to keep using the product.',
  'licenses.status.BLOCKED.hint':
    'An administrator suspended access. The reason is below.',
  'licenses.status.REVOKED.hint':
    "The licence was revoked — after a refund, for example. It can't be restored.",

  /* ---------------------------------------------------------------- */
  /* Тариф: срок действия                                              */
  /* ---------------------------------------------------------------- */
  'licenses.plan.lifetime': 'lifetime',
  'licenses.plan.years': { one: '{count} year', other: '{count} years' },
  'licenses.plan.months': { one: '{count} month', other: '{count} months' },
  'licenses.plan.days': { one: '{count} day', other: '{count} days' },

  /* ---------------------------------------------------------------- */
  /* Подписи полей лицензии: одни и те же в списке и в карточке        */
  /* ---------------------------------------------------------------- */
  'licenses.key.label': 'Licence key',
  'licenses.field.product': 'Product',
  'licenses.field.plan': 'Plan',
  'licenses.field.issued': 'Issued',
  'licenses.field.activated': 'Activated',
  'licenses.field.expires': 'Valid until',
  'licenses.field.term': 'Term',
  'licenses.field.remaining': 'Left',

  /* ---------------------------------------------------------------- */
  /* Карточка лицензии в списке                                        */
  /* ---------------------------------------------------------------- */
  'licenses.card.term.notStarted': 'not started yet',
  'licenses.card.remaining': {
    one: '{count} day left',
    other: '{count} days left',
  },
  'licenses.card.blockedReason': 'Reason for the block: {reason}',
  'licenses.card.revokedReason': 'Reason for the revocation: {reason}',
  'licenses.card.device.bound': 'Bound to a device',
  'licenses.card.device.unbound': 'No device bound yet',
  'licenses.card.action.details': 'Details and device',

  /* ---------------------------------------------------------------- */
  /* Карточка лицензии — отдельный экран                               */
  /* ---------------------------------------------------------------- */
  'licenses.detail.back': 'All licences',
  'licenses.detail.credentials.title': 'Details',
  'licenses.detail.key.hint':
    "The key is your proof of access: don't publish it, and don't pass it to anyone except support.",
  'licenses.detail.activated.never': 'not activated yet',
  'licenses.detail.expires.notStarted': "the countdown hasn't started",
  'licenses.detail.remaining.fullTerm': 'the whole paid term',
  'licenses.detail.remaining.days': {
    one: '{count} day',
    other: '{count} days',
  },
  'licenses.detail.remaining.ended': 'the term has ended',
  'licenses.detail.remaining.unlimited': 'no limit',
  'licenses.detail.blocked.title': 'Licence blocked',
  'licenses.detail.revoked.title': 'Licence revoked',
  'licenses.detail.device.title': 'Device',
  'licenses.detail.device.description':
    'A licence runs on one device — the one it was first launched from.',
  'licenses.detail.tab.binding': 'Binding',
  'licenses.detail.tab.history': 'History',
  'licenses.detail.history.limited': 'Showing the last 20 events.',
  'licenses.detail.history.error': "We couldn't load the binding history.",
  'licenses.detail.error.missing.title': 'Licence not found',
  'licenses.detail.error.missing.description':
    "This licence isn't among yours. You may be signed in with another account, or the link is out of date.",
  'licenses.detail.error.missing.action': 'Back to my licences',
  'licenses.detail.error.load': "We couldn't load the licence.",

  /* ---------------------------------------------------------------- */
  /* Привязка к устройству                                             */
  /* ---------------------------------------------------------------- */
  'hwid.resetsLeft': {
    one: '{count} reset left',
    other: '{count} resets left',
  },

  'hwid.summary.bound.title': 'The licence is bound to a device',
  'hwid.summary.bound.description':
    "It won't start on another computer: the server checks the device every time it checks the licence. To move, reset the binding.",
  'hwid.summary.unbound.title': 'No device bound yet',
  'hwid.summary.unbound.description':
    'The binding appears by itself at the first launch of the launcher — and the paid term starts running from that moment.',
  'hwid.summary.hidden':
    "The device identifier isn't shown: the server keeps it in a form that can't be reversed, and reveals it to nobody, the licence owner included.",

  'hwid.field.boundAt': 'Bound',
  'hwid.field.lastSeen': 'Last check',
  'hwid.field.resetsUsed': 'Resets used',
  'hwid.field.resetsUsed.value': '{used} of {total}',
  'hwid.field.resetsLeft': 'Resets left',
  'hwid.field.lastReset': 'Last reset',
  'hwid.field.lastReset.never': 'never',
  'hwid.field.nextReset': 'Next reset',
  'hwid.field.nextReset.now': 'available now',

  'hwid.change.title': 'Move to another device',
  'hwid.change.description':
    'You only need a reset when you move to different hardware: after it, the first device that starts the launcher becomes the main one.',
  'hwid.change.sharedLimit':
    'The reset counter is shared: a reset made by support or by the seller spends the same limit as your own.',

  'hwid.reset.action': 'Reset the binding',
  'hwid.reset.notBound':
    'There is no binding to reset. The device is fixed automatically at the first launch of the launcher.',
  'hwid.reset.notAllowed':
    "This account can't reset the binding on its own. Support can unbind the device — write to them and give the licence key.",
  'hwid.reset.limitReached':
    'You have used every reset: {used} of {total}. Contact support — they can bind a new device by hand.',
  'hwid.reset.cooldown':
    'Next reset in {time} — {date}. Twenty-four hours have to pass between resets.',
  'hwid.reset.left':
    'Resets left: {left}. The limit is granted for the whole life of the licence and never refills.',

  'hwid.reset.confirm.title': 'Unbind the device?',
  'hwid.reset.confirm.body':
    'After the reset, the licence attaches to whichever device starts the launcher next. Start it on the hardware you actually want.',
  'hwid.reset.confirm.cost':
    'This spends one of your {left} remaining resets, and the next one becomes available only 24 hours later.',
  'hwid.reset.confirm.submit': 'Reset',
  'hwid.reset.confirm.submitting': 'Resetting…',

  'hwid.reset.toast.success':
    'The binding is gone. The next launch of the launcher binds the licence to whichever device it starts on.',
  'hwid.reset.toast.cooldown':
    'The next reset becomes available on {date} — 24 hours have to pass between resets.',
  'hwid.reset.toast.notBound': 'There is no binding left — nothing to reset.',
  'hwid.reset.toast.limit':
    'You are out of resets. From here on, only support can change the binding.',
  'hwid.reset.toast.error': "We couldn't reset the binding.",

  'hwid.error.revoked.title': 'Licence revoked',
  'hwid.error.revoked.description':
    'The device binding went away with the revocation. If the revocation looks wrong, contact support and give the licence key.',
  'hwid.error.unavailable.title': 'Binding details unavailable',
  'hwid.error.unavailable.description':
    "This licence isn't among yours. Check which account you are signed in with.",
  'hwid.error.load': "We couldn't read the state of the binding.",

  'hwid.history.empty':
    'Nothing here yet: the binding has never changed. The first record appears once the licence starts on a device.',
  'hwid.history.column.when': 'When',
  'hwid.history.column.event': 'Event',
  'hwid.history.column.who': 'Who',
  'hwid.history.column.comment': 'Comment',
  'hwid.history.reason.FIRST_BIND': 'First binding',
  'hwid.history.reason.USER_RESET': 'Reset from the account',
  'hwid.history.reason.ADMIN_RESET': 'Reset by support',
  'hwid.history.reason.ADMIN_MANUAL_SET': 'Device set by hand',
  'hwid.history.reason.SYSTEM_REVOKE': 'Binding removed by the system',
  'hwid.history.actor.USER': 'Licence owner',
  'hwid.history.actor.ADMIN': 'Administrator',
  'hwid.history.actor.SYSTEM': 'System',
  'hwid.history.actor.API_KEY': 'Integration',
  'hwid.history.actor.launcher': 'Launcher on the device',
  'hwid.history.actor.unknown': 'Unknown',

  /* ---------------------------------------------------------------- */
  /* Вход                                                              */
  /* ---------------------------------------------------------------- */
  'login.title': 'Sign in',
  'login.field.login.label': 'Login or email',
  'login.field.password.label': 'Password',
  'login.action.forgotPassword': 'Forgot your password?',
  'login.action.submit': 'Sign in',
  'login.action.register': 'Create an account',
  'login.action.registerWithKey': 'I have a key',
  'login.reason.fallback': 'The session ended. Sign in again.',

  'login.error.emailNotVerified.title': 'Email address not confirmed',
  'login.error.emailNotVerified.body':
    'We sent a link when you registered. Check your spam folder — the link lasts 24 hours.',
  'login.error.emailNotVerified.resend':
    "Lost the email? We can't send it again, but a password reset confirms your address just as well.",
  'login.error.emailNotVerified.action': 'Recover access',
  'login.error.accountBlocked.title': 'Account blocked',
  'login.error.accountBlocked.body':
    'Only support can lift a block — there is no way to do it yourself.',
  'login.error.rateLimited.title': 'Too many attempts',
  'login.error.rateLimited.body':
    "The limit is 10 requests a minute. Wait a minute and try again — your password isn't locked.",

  /* ---------------------------------------------------------------- */
  /* Вход, шаг 2 — второй фактор                                       */
  /* ---------------------------------------------------------------- */
  'login.twoFactor.title': 'Confirm sign-in',
  'login.twoFactor.description':
    'Password accepted. Enter the code from your authenticator app.',
  'login.twoFactor.field.app.label': 'Code from the app',
  'login.twoFactor.field.recovery.label': 'Recovery code',
  'login.twoFactor.hint':
    'Attempts left: {left} of {max}. Time to enter it: {time}.',
  'login.twoFactor.invalidHint':
    "The code changes every 30 seconds, and one that has been used won't work twice. If your app shows the right time, wait for the next code.",
  'login.twoFactor.action.submit': 'Confirm',
  'login.twoFactor.action.useRecovery': 'Use a recovery code',
  'login.twoFactor.action.useApp': 'Use the code from the app',
  'login.twoFactor.action.backToPassword': 'Cancel and enter the password again',
  'login.twoFactor.notice.attemptsExceeded':
    'You are out of code attempts. Enter your password again — the counter resets.',
  'login.twoFactor.notice.challengeExpired':
    'The confirmation window closed. Enter your password again to get a new code prompt.',
  'login.twoFactor.notice.expired':
    'The confirmation window closed. Enter your password again.',
  'login.twoFactor.notice.cancelled':
    'Sign-in cancelled. Enter your password again.',

  /* ---------------------------------------------------------------- */
  /* Безопасность: пароль аккаунта                                     */
  /* ---------------------------------------------------------------- */
  'security.password.field.current.label': 'Current password',
  'security.password.field.new.label': 'New password',
  'security.password.field.confirmNew.label': 'Repeat the new password',
  'security.password.field.password.label': 'Password',
  'security.password.field.confirm.label': 'Repeat the password',
  'security.password.field.length.hint': 'Between {min} and {max} characters.',

  'security.password.validation.tooShort': 'Use at least {min} characters',
  'security.password.validation.tooLong': 'Use no more than {max} characters',
  'security.password.validation.currentRequired': 'Enter your current password',
  'security.password.validation.confirmRequired': 'Repeat the new password',
  'security.password.validation.repeatRequired': 'Repeat the password',
  'security.password.validation.mismatch': "The passwords don't match",
  'security.password.validation.unchanged':
    'The new password is the same as the current one',
  'security.password.error.currentInvalid':
    "That isn't your current password",

  'security.password.change.title': 'Change password',
  'security.password.change.description':
    'You will need your current password — that keeps the account safe if someone else reaches a tab you left open.',
  'security.password.change.notice.title': 'Your other sessions will end',
  'security.password.change.notice.description':
    'After the change you will have to sign in again on your other devices and in the launcher. This tab keeps working.',
  'security.password.change.done.title': 'Password changed',
  'security.password.change.done.revoked': {
    one: "{count} other session ended. If it wasn't yours, it has already lost access.",
    other:
      "{count} other sessions ended. If any of them wasn't yours, it has already lost access.",
  },
  'security.password.change.done.none':
    'There were no other active sign-ins to end.',
  'security.password.change.action.submit': 'Change password',
  'security.password.change.action.pending': 'Changing…',

  'security.password.set.title': 'Set a password',
  'security.password.set.description':
    'You signed in through an external service, so the account has no password of its own yet.',
  'security.password.set.why.title': 'Why you need a password',
  'security.password.set.why.license':
    "Without a password no licence is issued and the launcher won't start — the server requires it, and there is no way around that.",
  'security.password.set.why.other':
    'You also need it to unlink Discord or Telegram, and to turn on two-factor authentication: switching it off is confirmed with the password.',
  'security.password.set.alreadySet.title': 'A password is already set',
  'security.password.set.alreadySet.description':
    'It looks like it was set in another tab. The page is up to date now — use the change form instead.',
  'security.password.set.action.submit': 'Set a password',
  'security.password.set.action.pending': 'Saving…',

  /* ---------------------------------------------------------------- */
  /* Безопасность: второй фактор                                       */
  /* ---------------------------------------------------------------- */
  'security.twoFactor.title': 'Two-factor authentication',
  'security.twoFactor.state.on': 'On',
  'security.twoFactor.state.off': 'Off',

  'security.twoFactor.setup.description':
    'Off at the moment. Once it is on, signing in asks for a six-digit code from your app — a stolen password stops being enough.',
  'security.twoFactor.setup.requirements.title': 'What you will need',
  'security.twoFactor.setup.requirements.app':
    'An authenticator app on your phone or computer: Google Authenticator, Aegis, 1Password, Bitwarden — anything that supports TOTP will do.',
  'security.twoFactor.setup.requirements.codes':
    'Somewhere to keep your recovery codes: we show them once, and they are what saves you if the phone is lost.',
  'security.twoFactor.setup.needPassword.title': 'Set a password first',
  'security.twoFactor.setup.needPassword.description':
    'Turning the second factor off is confirmed with your password. Without one you would have nothing to turn it off with, and only support could help.',
  'security.twoFactor.setup.action.start': 'Start setup',
  'security.twoFactor.setup.action.pending': 'Preparing…',

  'security.twoFactor.confirm.title': 'Step 2: confirm the code',
  'security.twoFactor.confirm.description':
    'Scan the QR code with your app, then enter the six digits it shows. Until the code is confirmed the second factor stays off and signing in works as before.',
  'security.twoFactor.confirm.manual.title':
    "If the camera won't read the code",
  'security.twoFactor.confirm.manual.description':
    'Add the account by hand and enter this secret:',
  'security.twoFactor.confirm.code.label': 'Code from the app',
  'security.twoFactor.confirm.code.hint':
    'The code changes every 30 seconds. Enter the current one.',
  'security.twoFactor.confirm.error.invalid':
    "That code didn't work. Enter the one your app shows right now, and check that your phone keeps time automatically: a clock that has drifted is the most common reason.",
  'security.twoFactor.confirm.action.submit': 'Turn on',
  'security.twoFactor.confirm.action.pending': 'Turning on…',
  'security.twoFactor.confirm.action.newQr': 'Show a different QR code',
  'security.twoFactor.confirm.action.newQr.hint':
    'A new secret will be created and the old QR code will stop working',

  'security.twoFactor.secret.copy': 'Copy the secret',
  'security.twoFactor.secret.copyFailed':
    'The browser blocked access to the clipboard — select the secret and copy it by hand.',

  'security.twoFactor.qr.alt': 'QR code for your authenticator app',
  'security.twoFactor.qr.failed':
    "We couldn't draw the QR code. Enter the secret in your app by hand — it is shown below.",

  'security.twoFactor.field.code.label': 'Confirmation code',
  'security.twoFactor.field.code.hint':
    'Six digits from the app, or one of your recovery codes.',
  'security.twoFactor.validation.passwordRequired': 'Enter your password',
  'security.twoFactor.validation.codeTooShort':
    'The code is shorter than {min} characters',
  'security.twoFactor.validation.codeTooLong':
    'The code is longer than {max} characters',
  'security.twoFactor.error.passwordInvalid': "That password isn't right",
  'security.twoFactor.error.codeInvalid':
    "That code didn't work. Each code works once — if this one has been used, wait for the next or enter a recovery code.",

  'security.twoFactor.disable.description':
    'Signing in asks for the code from your app. The recovery codes issued when you turned it on still work — each of them once.',
  'security.twoFactor.disable.notice.title':
    'Turning it off ends every session',
  'security.twoFactor.disable.notice.sessions':
    'Every sign-in ends, this one included: right after you turn it off you will need to sign in again — here, on your other devices and in the launcher.',
  'security.twoFactor.disable.notice.codes':
    'Your recovery codes will be erased. If you turn the second factor on again later, you will get new ones.',
  'security.twoFactor.disable.action.submit': 'Turn off',
  'security.twoFactor.disable.action.pending': 'Turning off…',

  'security.twoFactor.disabled.title': 'Two-factor authentication is off',
  'security.twoFactor.disabled.description':
    'Every session has ended, this one included. Nothing broke — it is meant to work this way: once the second factor is removed, no sign-in that predates it should survive.',
  'security.twoFactor.disabled.countdown': {
    one: 'Sign in again — your login and password are enough now. We will take you to the sign-in page in {count} second.',
    other:
      'Sign in again — your login and password are enough now. We will take you to the sign-in page in {count} seconds.',
  },
  'security.twoFactor.disabled.action.signIn': 'Sign in again',

  /* ---------------------------------------------------------------- */
  /* Безопасность: коды восстановления                                 */
  /* ---------------------------------------------------------------- */
  'security.recoveryCodes.title': 'Save your recovery codes',
  'security.recoveryCodes.description':
    'Two-factor authentication is on. These codes are shown once — after this window closes there is no way to see them again.',
  'security.recoveryCodes.why.title': 'What they are for',
  'security.recoveryCodes.why.description':
    'Each code works once and stands in for the six-digit code from your app. Without them a lost phone means a lost account.',
  'security.recoveryCodes.action.copy': 'Copy',
  'security.recoveryCodes.action.copied': 'Copied',
  'security.recoveryCodes.action.download': 'Download as a file',
  'security.recoveryCodes.action.done': 'Done',
  'security.recoveryCodes.copyFailed':
    'The browser blocked access to the clipboard. Download the file, or select the codes and copy them by hand.',
  'security.recoveryCodes.saved.label':
    'I have saved the codes somewhere safe',
  'security.recoveryCodes.file.title': 'Account recovery codes',
  'security.recoveryCodes.file.intro':
    'Each code works once and stands in for the six-digit code from your app.',
  'security.recoveryCodes.file.storage':
    "Keep this file where you keep your passwords, and don't send it over messengers.",

  /* ---------------------------------------------------------------- */
  /* Безопасность: способы входа                                       */
  /* ---------------------------------------------------------------- */
  'security.logins.title': 'Sign-in methods',
  'security.logins.description':
    "What can get you into this account. The last remaining method can't be removed — you would have nothing left to sign in with.",
  'security.logins.password.title': 'Password',
  'security.logins.password.description.set':
    'Sign in with your login or email address together with the password.',
  'security.logins.password.description.unset':
    "No password set. Without one no licence is issued and the launcher won't start.",
  'security.logins.password.badge.set': 'Set up',
  'security.logins.password.badge.unset': 'Not set',
  'security.logins.password.action.change': 'Change',

  'security.logins.provider.description':
    'One-click sign-in through an external service.',
  'security.logins.provider.badge.linked': 'Linked',
  'security.logins.provider.action.unlink': 'Unlink',
  'security.logins.provider.action.unlink.blocked':
    'This is your only way in — set a password first',
  'security.logins.provider.empty':
    'No external services are linked to the account.',

  'security.logins.lastMethod.title': 'This is your only way in',
  'security.logins.lastMethod.description':
    'Unlinking it now means losing access to the account. Set a password first and unlinking becomes available.',
  'security.logins.backup.title': 'Set a password so you have a spare way in',
  'security.logins.backup.description':
    'While there is only one way in, losing access to it means losing the account.',

  'security.logins.twoFactor.description.on':
    'Signing in also asks for a code from your app.',
  'security.logins.twoFactor.description.off':
    'A password is enough to sign in. No code from an app is asked for.',
  'security.logins.twoFactor.action.manage': 'Manage',
  'security.logins.twoFactor.action.enable': 'Turn on',

  'security.logins.linking.title':
    "Linking a new service isn't possible yet",
  'security.logins.linking.description':
    'Discord and Telegram are linked only when you sign in through them. The server has no separate linking action from your account page yet.',

  'security.logins.unlink.title': 'Unlink {provider}?',
  'security.logins.unlink.description':
    "Signing in through this service will stop working. You won't be able to link it back from your account page — only by signing in through it again.",
  'security.logins.unlink.action.pending': 'Unlinking…',

  /* ---------------------------------------------------------------- */
  /* Telegram-бот                                                      */
  /* ---------------------------------------------------------------- */
  'telegram.title': 'Telegram bot',
  'telegram.description':
    'Check your licences, reset a device binding and get expiry reminders straight in a chat.',

  'telegram.state.error.title': "We couldn't load the connection state",

  'telegram.status.linked.title': 'Bot connected',
  'telegram.status.linked.description':
    'The chat below is linked to this account. Only one chat at a time — connecting another one drops this link.',
  'telegram.status.notLinked.title': 'Bot not connected',
  'telegram.status.notLinked.description':
    'Connecting works in one direction only: you take a one-time link here and open it in Telegram. That way nobody can attach your account to somebody else’s chat.',
  'telegram.status.scope.admin': 'Admin access',
  'telegram.status.chat': 'Telegram account',
  'telegram.status.chat.unnamed': 'no @username',
  'telegram.status.linkedAt': 'Connected on',
  'telegram.status.expiresAt': 'Valid until',
  'telegram.status.blocked.title': 'Messages are not getting through',
  'telegram.status.blocked.description':
    'You have blocked the bot in Telegram. The link is intact — send the bot any message and delivery resumes.',

  'telegram.connect.action': 'Connect the bot',
  'telegram.connect.action.pending': 'Issuing a link…',

  'telegram.renew.action': 'Extend the connection',
  'telegram.renew.description':
    'The link is never renewed silently: a second access channel must not outlive the moment everybody forgot about it. Extending issues a fresh link and resets the clock.',

  'telegram.totp.title': 'Confirm with your second factor',
  'telegram.totp.description':
    'The code is needed right now, not "at some point when you signed in": otherwise a stolen session would attach its own chat in a single request and keep access even after you change your password.',
  'telegram.totp.submit': 'Confirm and issue the link',

  'telegram.code.title': 'One-time link ready',
  'telegram.code.description':
    'Open it in Telegram and press Start. Valid until {expiresAt}, and it works once.',
  'telegram.code.open': 'Open in Telegram',
  'telegram.code.copy': 'Connection link',
  'telegram.code.check': "I've pressed Start",
  'telegram.code.hint.title': 'The bot deletes the message with the link',
  'telegram.code.hint.description':
    'It removes it from the chat right after connecting — the token is single-use, but in a chat it would stay forever and on every device of yours.',

  'telegram.scope.title': 'What the bot can and cannot do',
  'telegram.scope.description':
    'It shows licences, masks keys, resets device bindings and activates purchases. It never accepts passwords or two-factor codes, never changes account settings and never restores access — all of that lives on the website only.',

  'telegram.unlink.action': 'Disconnect',
  'telegram.unlink.action.pending': 'Disconnecting…',
  'telegram.unlink.confirm.title': 'Disconnect the bot?',
  'telegram.unlink.confirm.description':
    'The chat stops receiving notifications and bot commands stop working. Signing in through Telegram is not affected. You can connect again from this page at any time.',

  /* ---------------------------------------------------------------- */
  /* Витрина                                                           */
  /* ---------------------------------------------------------------- */
  'catalog.title': 'Catalogue',
  'catalog.description':
    'Choose a plan and a payment method. Your orders and their status are under “My orders”.',

  'catalog.error.title': "The catalogue didn't load",

  'catalog.empty.title': 'Nothing is on sale yet',
  'catalog.empty.description':
    'No product has been published. Look in again later.',

  'catalog.activate.title': 'Already paid?',
  'catalog.activate.description':
    'A purchase code is redeemed in a section of its own.',
  'catalog.activate.action': 'Activate a purchase',

  'catalog.plan.buy': 'Buy',
  'catalog.plan.soon': 'Soon',
  'catalog.plan.lifetime': 'Forever',
  'catalog.plan.days': { one: '{count} day', other: '{count} days' },

  /* ---------------------------------------------------------------- */
  /* Активация покупки — экран с тремя вкладками                       */
  /* ---------------------------------------------------------------- */
  'activate.title': 'Activation',
  'activate.description':
    'This is where a paid purchase becomes a licence. Pick whichever one you have to hand.',

  'activate.tab.code': 'Purchase code',
  'activate.tab.order': 'Order number',
  'activate.tab.key': 'Key',

  'activate.code.title': 'Digiseller purchase code',
  'activate.code.description':
    '16 characters the platform gave you after payment — on the order page and in the email from Digiseller.',

  'activate.order.title': 'Digiseller order number',
  'activate.order.description':
    'For when the platform gave you no code: a product can have unique codes switched off, and then payment brings plain text from the seller instead. An order number always exists — in the purchase email and on the order page.',

  'activate.key.title': 'Registration key',
  'activate.key.description':
    'A code shaped like ACDE-FGHJ-KMNP-QRTU, issued by a seller or an administrator. It activates on the account you are signed in to.',

  'activate.note':
    "Neither a purchase code nor a key is spent on a failed attempt. If the money left your account and no licence appeared, write to support and include the platform order number: the payment stays with them and isn't lost.",

  /* ---------------------------------------------------------------- */
  /* Активация по коду покупки Digiseller                              */
  /* ---------------------------------------------------------------- */
  'billing.code.field.label': 'Purchase code',
  'billing.code.field.hint':
    '{length} Latin letters and digits — the code from your Digiseller order page. We strip spaces and hyphens out of a paste for you.',
  'billing.code.field.entered': 'Entered: {entered} of {length}.',
  'billing.code.field.tooLong':
    'That is more characters than a purchase code holds. Something extra came along with it — check that you took the code alone.',
  'billing.code.action.submit': 'Activate',

  'billing.code.issued.title': 'Licence issued',
  'billing.code.issued.description':
    'Order no. {order}. Keep the number — support finds the purchase by it.',
  'billing.code.alreadyYours.title': 'You have already activated this code',
  'billing.code.alreadyYours.description':
    'The licence went out earlier and is sitting under My licences. There is nothing more to pay.',
  'billing.code.alreadyYours.action': 'Go to my licences',

  'billing.code.error.unknown.title': "We couldn't activate the code",
  'billing.code.error.unknown.body':
    "Reload the page and try once more. The code isn't spent by this.",
  'billing.code.error.malformed.title': "The code isn't complete",
  'billing.code.error.malformed.body':
    'A purchase code is exactly {length} Latin letters and digits, no spaces and no hyphens. Copy the whole of it from your Digiseller order page or from the email the platform sent.',
  'billing.code.error.notAccepted.title':
    "The platform didn't confirm the code",
  'billing.code.error.notAccepted.body':
    "Most often this is one mistyped character — check the code against your Digiseller order page and try again. If it matches exactly, write to support and include the platform order number: your payment hasn't gone anywhere.",
  'billing.code.error.tooManyAttempts.title': 'Too many attempts',
  'billing.code.error.tooManyAttempts.body':
    "Code activation is paused for your account for now — it works again within the hour. The code isn't spent and the payment stands. If waiting isn't an option, write to support.",
  'billing.code.error.alreadyUsed.title':
    'The code is already activated on another account',
  'billing.code.error.alreadyUsed.body':
    'If you have more than one account, sign in to the one you activated the code on — the licence is there. If you never did that, write to support with your Digiseller order number: the code belongs to whoever holds it, and only the purchase can settle this.',
  'billing.code.error.notMapped.title':
    'Payment accepted, we will issue the licence by hand',
  'billing.code.error.notMapped.body':
    "The platform confirmed the purchase, but this product isn't set up on our side yet. The request is already with an administrator, and the licence will appear under My licences. There is no need to pay or enter the code again.",
  'billing.code.error.providerUnavailable.title':
    "The platform isn't answering right now",
  'billing.code.error.providerUnavailable.body':
    "We couldn't reach Digiseller to check the code. Nothing was spent and nothing was recorded — try again in a minute.",
  'billing.code.error.badRequest.title': "The code wasn't accepted",
  'billing.code.error.badRequest.body':
    'Check the code: {length} Latin letters and digits.',
  'billing.code.error.network.title': 'No connection to the server',
  'billing.code.error.network.body':
    "Check your network connection and try again. The code isn't spent.",
  'billing.code.error.rateLimited.title': 'Too often',
  'billing.code.error.rateLimited.body':
    'Wait a minute and try again — requests are limited for the moment.',
  'billing.code.error.serverError.title':
    'The service is temporarily unavailable',
  'billing.code.error.serverError.body':
    'Try again in a minute. If the code already went through, sending it again spoils nothing — the server returns the same result.',

  /* ---------------------------------------------------------------- */
  /* Активация по номеру заказа Digiseller                             */
  /* ---------------------------------------------------------------- */
  'billing.order.field.number.label': 'Order number',
  'billing.order.field.number.hint':
    'From the Digiseller purchase email or from the order page. Digits only — we drop the hash sign and the spaces for you.',
  'billing.order.field.email.label': 'Buyer email',
  'billing.order.field.email.placeholder': 'the address used to pay',
  'billing.order.field.email.hint':
    'The exact address the purchase was made under on the platform — it may differ from the one on your account.',
  'billing.order.action.pending': 'Checking with the platform…',
  'billing.order.action.submit': 'Activate the purchase',
  'billing.order.note':
    "The order isn't spent on a failed attempt. If the payment went through and no licence appeared, write to support and include the order number.",

  'billing.order.issued.title': 'Licence issued',
  'billing.order.issued.description':
    'The licence is now under My licences. Its term starts at the first launch of the launcher.',
  'billing.order.alreadyYours.title': 'This purchase is already activated',
  'billing.order.alreadyYours.description':
    'It is on your account already — there is no need to activate it twice.',

  /* ---------------------------------------------------------------- */
  /* Активация регистрационного ключа                                  */
  /* ---------------------------------------------------------------- */
  'keys.redeem.field.label': 'Registration key',
  'keys.redeem.field.hint':
    'A key shaped like ACDE-FGHJ-KMNP-QRTU. Case and hyphens are on us — paste it as it is.',
  'keys.redeem.field.wrongChars': {
    one: "The character {chars} doesn't occur in keys — they hold no B, I, L, O, S and no digits 0, 1, 5. Check whether it has been mistaken for a lookalike.",
    other:
      "The characters {chars} don't occur in keys — they hold no B, I, L, O, S and no digits 0, 1, 5. Check whether they have been mistaken for lookalikes.",
  },
  'keys.redeem.field.shapeHint':
    'A key is usually four groups of four characters. Check that all of it came across — you can send it either way.',
  'keys.redeem.action.submit': 'Activate the key',

  'keys.redeem.success.title': 'Key activated',
  'keys.redeem.success.description':
    'The licence has been added to your account.',
  'keys.redeem.success.seeLicenses':
    'You will find the licence key under My licences.',

  'keys.redeem.error.licenseNumber.title':
    'That is a licence number, not an activation key',
  'keys.redeem.error.licenseNumber.body':
    'A licence number starts with the product code and matters only when you write to support — there is nowhere to enter it. If the licence has been issued, it is under My licences and needs no activation: just start the launcher.',
  'keys.redeem.error.unknown.title': "We couldn't activate the key",
  'keys.redeem.error.unknown.body':
    "Reload the page and try once more. The key isn't spent by this.",
  'keys.redeem.error.invalid.title': "We don't recognise that key",
  'keys.redeem.error.invalid.body':
    'Check the characters: keys never use the letters B, I, L, O, S or the digits 0, 1, 5 — those are easy to confuse with lookalikes. If the key is written out correctly, go back to whoever issued it.',
  'keys.redeem.error.expired.title': 'The key has expired',
  'keys.redeem.error.expired.body':
    'The key was issued for a limited time and that time has run out. It can no longer be activated — ask the seller or the administrator who issued it for a new one.',
  'keys.redeem.error.alreadyUsed.title': 'The key is already activated',
  'keys.redeem.error.alreadyUsed.body':
    "One key works exactly once. If you were the one who activated it, the licence is already under My licences. If you weren't, tell whoever issued the key: somebody used it before you.",
  'keys.redeem.error.withoutLicense.title':
    'This key only registers a new account',
  'keys.redeem.error.withoutLicense.body':
    "It carries no product and no plan, so it can't add a licence to an account that already exists. The key isn't spent: it will still create a new account on the key registration page.",
  'keys.redeem.error.badRequest.title': "The key wasn't accepted",
  'keys.redeem.error.badRequest.body':
    'Check the key: a non-empty string no longer than {max} characters.',
  'keys.redeem.error.network.title': 'No connection to the server',
  'keys.redeem.error.network.body':
    "Check your network connection and try again. The key isn't spent.",
  'keys.redeem.error.rateLimited.title': 'Too often',
  'keys.redeem.error.rateLimited.body':
    'Wait a minute and try again — requests are limited for the moment.',
  'keys.redeem.error.serverError.title':
    'The service is temporarily unavailable',
  'keys.redeem.error.serverError.body':
    "Try again in a minute. Redeeming a key happens in a single transaction: if it didn't finish, the key stayed unused.",

  /* ---------------------------------------------------------------- */
  /* Выданная лицензия: ключ и что будет дальше                        */
  /* ---------------------------------------------------------------- */
  'activation.licenseKey.title': 'Licence key',
  'activation.next.termStarts':
    'The term starts at the first launch of the launcher, not at the moment of purchase — until then the licence waits for you and nothing is lost.',
  'activation.next.emailed':
    'We have sent a copy of the key to the email on your account.',
  'activation.next.inLicenses': 'The licence is already under',
  'activation.next.inLicenses.link': 'My licences',

  /* ---------------------------------------------------------------- */
  /* Экраны ошибок: 401, 403, 404, 500, 503                            */
  /* ---------------------------------------------------------------- */
  'errors.unauthorized.title': 'Sign-in required',
  'errors.unauthorized.description':
    'The session has ended. Sign in again to carry on.',
  'errors.forbidden.title': 'Not enough rights',
  'errors.forbidden.description': 'Your account has no access to this section.',
  'errors.notFound.title': 'Page not found',
  'errors.notFound.description':
    'There seems to be no such page — it may never have existed, or it may have been removed.',
  'errors.general.title': 'Something went wrong',
  'errors.general.description':
    'Sorry about that. Try reloading the page, or come back a little later.',
  'errors.maintenance.title': 'The service is temporarily unavailable',
  'errors.maintenance.description':
    'Maintenance is under way. Try again in a few minutes.',

  /* ---------------------------------------------------------------- */
  /* Администрирование: общее для обоих экранов                        */
  /* ---------------------------------------------------------------- */
  'admin.nav.pendingDeals': 'Stuck deals',
  'admin.nav.licenses': 'Licences',
  'admin.copy.licenseKey': 'Licence key',

  'admin.twoFactor.title': 'Two-factor needed',
  'admin.twoFactor.description':
    'You do have the rights for this section, but the server only carries out administrative actions when two-factor authentication is on. We are opening the setup — once it is on, the section works without signing in again.',
  'admin.twoFactor.action': 'Go to the setup',

  /* Коды ошибок глазами администратора: тот же код значит для него не то,
     что для покупателя. */
  'admin.error.PRODUCT_NOT_MAPPED':
    'The store item is linked to no plan. Create a plan with this item number and issue the licence again.',
  'admin.error.ALREADY_REDEEMED':
    'A licence for this deal has already been issued — the row is gone from the list.',
  'admin.error.NO_CLAIMANT':
    'There is nobody to issue to: no one has presented the code. The row closes itself once the buyer enters the code in their account.',
  'admin.error.NOT_FOUND': "The deal wasn't found. Refresh the list.",
  'admin.error.NOT_BLOCKED':
    'The licence is no longer blocked — somebody lifted the block before you.',
  'admin.error.PLAN_MISMATCH': "The plan doesn't belong to that product.",
  'admin.error.ALREADY_EXISTS': 'This code or version number is already taken. Pick another one.',

  /* ---------------------------------------------------------------- */
  /* Зависшие сделки                                                   */
  /* ---------------------------------------------------------------- */
  'admin.pending.title': 'Stuck deals',
  'admin.pending.description':
    'Purchases the store confirmed but never delivered. The only way in here is a store item linked to no plan: the store has the money and the buyer has nothing. While a row sits here, somebody is waiting for what they paid for.',

  'admin.pending.summary.empty': 'No paid purchase is waiting to be issued.',
  'admin.pending.summary.count': 'Waiting to be issued: {count}',

  'admin.pending.empty.title': 'No stuck deals',
  'admin.pending.empty.description':
    'This list collects purchases the store confirmed but never delivered — that happens when a store item is linked to no plan. An empty list means every paid purchase has arrived.',

  'admin.pending.column.waiting': 'Waiting',
  'admin.pending.column.code': 'Purchase code',
  'admin.pending.column.invoice': 'Store invoice',
  'admin.pending.column.product': 'Store item',
  'admin.pending.column.amount': 'Amount',
  'admin.pending.column.buyer': 'Buyer email',
  'admin.pending.column.paidAt': 'Paid',
  'admin.pending.column.action': 'Action',

  'admin.pending.copy.code': 'Purchase code',
  'admin.pending.action.issue': 'Issue licence',
  'admin.pending.action.issuing': 'Issuing…',
  'admin.pending.toast.issued': 'Licence issued, order {order}',

  'admin.pending.failure.productNotMapped':
    "Create a plan with store item number {product} (the digisellerProductId field of the plan), then come back and press “Issue licence” again. The store isn't asked for the code a second time — the confirmation is already saved.",
  'admin.pending.failure.noClaimant':
    'The purchase is paid for, but nobody has entered code {code} in their account yet, so the licence has no owner. There is nothing to do here: pass the code to the buyer, or wait until they activate it themselves.',

  'admin.pending.issued.title': 'Issued in this session',
  'admin.pending.issued.description':
    'The buyer already has the email about it. The key below is here in case you need to read it out in a conversation.',
  'admin.pending.issued.order': 'order {order}',

  /* ---------------------------------------------------------------- */
  /* Все лицензии: список, блокировка, разблокировка                   */
  /* ---------------------------------------------------------------- */
  'admin.licenses.title': 'Licences',
  'admin.licenses.description':
    'A block switches the product off for its owner until it is lifted, and it needs a reason — the reason goes into the action log. Unblocking returns the licence to whatever its dates say: an expired one comes back expired, not active.',

  'admin.licenses.search.label': 'Licence key or owner login',
  'admin.licenses.search.placeholder': 'FC26-…  or  ivan',
  'admin.licenses.status.label': 'Status',
  'admin.licenses.status.any': 'Any',

  'admin.licenses.empty.title': 'Nothing found',
  'admin.licenses.empty.filtered':
    'No licence fits the filters. Clear them, or change what you searched for.',
  'admin.licenses.empty.none': 'No licences have been issued yet.',

  'admin.licenses.column.key': 'Key',
  'admin.licenses.column.product': 'Product',
  'admin.licenses.column.plan': 'Plan',
  'admin.licenses.column.owner': 'Owner',
  'admin.licenses.column.status': 'Status',
  'admin.licenses.column.activated': 'Activated',
  'admin.licenses.column.expires': 'Valid until',
  'admin.licenses.column.action': 'Action',

  'admin.licenses.owner.unassigned': 'not assigned',
  'admin.licenses.activated.never': 'never launched',
  'admin.licenses.reason.none': 'no reason given',
  'admin.licenses.blocked.at': 'Blocked {date}:',
  'admin.licenses.revoked.at': 'Revoked {date}:',
  'admin.licenses.range': '{from}–{to} of {total}',

  'admin.licenses.action.block': 'Block',
  'admin.licenses.action.unblock': 'Unblock',
  'admin.licenses.action.unblocking': 'Lifting…',
  'admin.licenses.action.blockRevoked':
    'The licence was revoked on a refund — there is nothing left to block',
  'admin.licenses.toast.unblocked': 'Block lifted, status: {status}',
  'admin.licenses.column.source': 'Sold / issued by',
  'admin.licenses.column.activatedBy': 'Activated by',
  'admin.licenses.origin.reseller': 'reseller',
  'admin.licenses.origin.admin': 'issued by admin',
  'admin.licenses.origin.key': 'admin registration key',
  'admin.licenses.origin.channel.WEBSITE': 'website order',
  'admin.licenses.origin.channel.DIGISELLER': 'Digiseller order',
  'admin.licenses.origin.channel.MANUAL': 'manual order',
  'admin.licenses.origin.channel.REGISTRATION_KEY': 'order by key',
  'admin.licenses.origin.notActivated': 'not activated',
  'admin.licenses.queryPlaceholder': 'product:fc26 (status:ACTIVE OR status:EXPIRED) NOT user:test',
  'admin.licenses.column.build': 'Build',
  'admin.licenses.column.issued': 'Issued',
  'admin.licenses.activatedAt': 'launched {date}',
  'admin.licenses.build.byPlan': 'by plan',
  'admin.licenses.build.saved': 'Build for the licence saved',

  /* Диалог блокировки */
  'admin.block.title': 'Block the licence',
  'admin.block.description':
    'The product stops launching for its owner straight away. A block is reversible: the “Unblock” button lifts it.',
  'admin.block.summary': 'Product: {product} · plan {plan}',
  'admin.block.owner': 'Owner: {owner}',
  'admin.block.reason.label': 'Reason',
  'admin.block.reason.placeholder': 'For example: access shared with others',
  'admin.block.reason.hint':
    'The reason goes into the action log and shows on the licence card. Characters left: {left}',
  'admin.block.action.submit': 'Block',
  'admin.block.action.pending': 'Blocking…',
  'admin.block.toast.done': 'Licence blocked',

  /* ---------------------------------------------------------------- */
  /* Авторизация: элементы, повторяющиеся на нескольких её экранах      */
  /* ---------------------------------------------------------------- */
  'auth.field.username.label': 'Login',
  'auth.field.email.label': 'Email',
  'auth.field.password.label': 'Password',
  'auth.field.password.hint': 'At least {min} characters.',
  'auth.field.passwordConfirm.label': 'Repeat the password',
  'auth.action.signIn': 'Sign in',
  'auth.action.backToLogin': 'Back to sign-in',
  'auth.action.haveAccount': 'I already have an account',

  /* ---------------------------------------------------------------- */
  /* Авторизация: проверка полей на клиенте (schemas.ts)                */
  /* ---------------------------------------------------------------- */
  'auth.validation.login.required': 'Enter your login or email address',
  'auth.validation.login.tooLong': 'That value is too long',
  'auth.validation.email.required': 'Enter your email address',
  'auth.validation.email.tooLong':
    'The address has to be {max} characters or shorter',
  'auth.validation.email.invalid': "That doesn't look like an email address",
  'auth.validation.username.tooShort':
    'The login has to be at least {min} characters',
  'auth.validation.username.tooLong':
    'The login has to be {max} characters or shorter',
  'auth.validation.username.pattern':
    "Latin letters, digits, hyphen and underscore only. Cyrillic isn't allowed.",
  'auth.validation.password.required': 'Enter your password',
  'auth.validation.password.tooShort':
    'The password has to be at least {min} characters',
  'auth.validation.password.tooLong':
    'The password has to be {max} characters or shorter',
  'auth.validation.passwordConfirm.mismatch': "The passwords don't match",
  'auth.validation.twoFactorCode.tooShort':
    'The code has to be at least {min} characters',
  'auth.validation.twoFactorCode.tooLong':
    'The code has to be {max} characters or shorter',
  'auth.validation.key.required': 'Enter the key',
  'auth.validation.key.tooLong': 'The key has to be {max} characters or shorter',

  /* ---------------------------------------------------------------- */
  /* Регистрация по логину и паролю                                    */
  /* ---------------------------------------------------------------- */
  'register.title': 'Create an account',
  'register.description':
    'We will send a confirmation link to the address you give us.',
  'register.field.username.hint':
    "From {min} to {max} characters: Latin letters, digits, hyphen, underscore. Cyrillic isn't allowed — Russian and Latin letters look identical on screen, and that is exactly how accounts get impersonated.",
  'register.field.email.hint':
    'It is the only way back into your account, so use an address you actually read.',
  'register.action.submit': 'Create account',
  'register.action.withKey': 'Register with a key',
  'register.error.alreadyExists.title': 'That login or email is taken',
  'register.error.alreadyExists.body':
    "The server won't say which of the two — that is deliberate. Try another login, or sign in if the account is already yours.",
  'register.error.alreadyExists.action.reset': 'Reset your password',
  'register.error.rateLimited.title': 'Too many attempts',
  'register.error.rateLimited.body':
    'The limit is 10 requests a minute from one address. Wait a minute and try again.',

  /* ---------------------------------------------------------------- */
  /* Регистрация: терминальный экран «письмо отправлено»                */
  /* ---------------------------------------------------------------- */
  'register.checkEmail.title': 'The email is on its way',
  'register.checkEmail.description':
    'The account is created. One step left — confirm your email address.',
  'register.checkEmail.body':
    "Open the email and follow the link. Signing in won't work until you do.",
  'register.checkEmail.note.expiry': 'The link lasts 24 hours.',
  'register.checkEmail.note.delay':
    'The email can take a few minutes to arrive.',
  'register.checkEmail.note.spam': "If it isn't there, check your spam folder.",
  'register.checkEmail.action.login': 'Go to sign-in',

  /* ---------------------------------------------------------------- */
  /* Регистрация: повторная отправка письма подтверждения               */
  /* ---------------------------------------------------------------- */
  'register.resend.label': "Email didn't arrive?",
  'register.resend.placeholder': 'The address you registered with',
  'register.resend.action.submit': 'Send the email again',
  'register.resend.action.pending': 'Sending…',
  'register.resend.success':
    'If the address is registered and still unconfirmed, the email has been sent. We keep a minute between repeat emails — if nothing arrives, wait and try again.',

  /* ---------------------------------------------------------------- */
  /* Регистрация по ключу                                              */
  /* ---------------------------------------------------------------- */
  'registerKey.title': 'Register with a key',
  'registerKey.description':
    'No email confirmation needed — you will be signed in straight away.',
  'registerKey.field.code.label': 'Key',
  'registerKey.field.code.hint':
    'The key works once: it is spent the moment the account is created.',
  'registerKey.field.username.hint':
    'From {min} to {max} characters: Latin letters, digits, hyphen, underscore.',
  'registerKey.field.email.optional': '— optional',
  'registerKey.field.email.hint':
    'Without an address there is no way to reset your password — the platform has no other way to reach you.',
  'registerKey.action.submit': 'Create account',
  'registerKey.action.regular': 'Ordinary registration',
  'registerKey.error.keyInvalid.title': "We don't recognise that key",
  'registerKey.error.keyInvalid.body':
    'Check your keyboard layout and the hyphens. Keys are made of Latin letters and digits, and never contain O, I, 0 or 1 — those are too easy to confuse.',
  'registerKey.error.keyUsed.title': 'The key has already been used',
  'registerKey.error.keyUsed.body':
    "An account was created with it earlier. If that was you, sign in; if it wasn't, go back to whoever sold you the key.",
  'registerKey.error.keyExpired.title': 'The key has expired',
  'registerKey.error.keyExpired.body':
    'A key is issued for a limited time. Ask whoever gave you this one for a new key.',
  'registerKey.error.alreadyExists.title': 'That login or email is taken',
  'registerKey.error.alreadyExists.body':
    "The key isn't spent — change the login (or drop the email, it is optional) and try again.",

  /* ---------------------------------------------------------------- */
  /* Восстановление доступа: запрос ссылки                             */
  /* ---------------------------------------------------------------- */
  'forgotPassword.title': 'Recover access',
  'forgotPassword.description':
    'Give us the address the account is registered to.',
  'forgotPassword.action.submit': 'Send the link',
  'forgotPassword.error.rateLimited.title': 'Too many attempts',
  'forgotPassword.error.rateLimited.body':
    'The limit is 10 requests a minute from one address. Wait a minute: the email from the previous request, if it went out, is already on its way.',
  'forgotPassword.sent.title': 'Check your inbox',
  'forgotPassword.sent.description':
    'If that address is registered, the email with the link has already gone out.',
  'forgotPassword.sent.note.expiry': 'The link lasts one hour and works once.',
  'forgotPassword.sent.note.delay':
    'The email can take a few minutes — check your spam folder.',
  'forgotPassword.sent.note.twoFactor':
    'If the account has two-factor turned on, the password page will ask for a code as well.',
  'forgotPassword.sent.privacy':
    'We deliberately never confirm that an address is registered — otherwise this form would be a way to check whether someone else has an account here.',
  'forgotPassword.sent.action.another': 'Send to a different address',

  /* ---------------------------------------------------------------- */
  /* Восстановление доступа: новый пароль по ссылке из письма          */
  /* ---------------------------------------------------------------- */
  'resetPassword.title': 'New password',
  'resetPassword.description': 'Changing it ends every current session.',
  'resetPassword.field.newPassword.label': 'New password',
  'resetPassword.field.twoFactorCode.label': 'Code from the app',
  'resetPassword.field.twoFactorCode.hint':
    "A recovery code works too, if the app isn't to hand.",
  'resetPassword.action.submit': 'Save the password',
  'resetPassword.action.requestNewLink': 'Request a new link',
  'resetPassword.twoFactor.title': 'We need a confirmation code',
  'resetPassword.twoFactor.description':
    'This account has two-factor authentication on. Without a code, access to the mailbox alone would bypass it completely.',
  'resetPassword.error.twoFactorInvalid':
    "That code didn't work. If it has already been used, wait for the next one in the app.",
  'resetPassword.noToken.title': 'The link is incomplete',
  'resetPassword.noToken.description':
    'There is no recovery code in the address.',
  'resetPassword.noToken.body':
    'Mail apps sometimes wrap a long link onto a second line. Copy the whole address from the email — it has to end with',
  'resetPassword.done.title': 'Password changed',
  'resetPassword.done.description':
    'Every earlier session has been ended — protection in case someone else had access to the account.',
  'resetPassword.done.action': 'Sign in with the new password',
  'resetPassword.linkDead.title': 'The link no longer works',
  'resetPassword.linkDead.description':
    'It has expired, or it has already been used.',
  'resetPassword.linkDead.body':
    'A reset link lasts one hour and works once. Request a new one — the old link stops working for good after that.',

  /* ---------------------------------------------------------------- */
  /* Подтверждение почты по ссылке из письма                           */
  /* ---------------------------------------------------------------- */
  'verifyEmail.noToken.title': 'The link is incomplete',
  'verifyEmail.noToken.description':
    'There is no confirmation code in the address.',
  'verifyEmail.noToken.body':
    'That happens when a mail app wraps a long link onto a second line. Open the email and copy the whole address — it has to end with',
  'verifyEmail.pending.title': 'Confirming your address',
  'verifyEmail.pending.description': 'This takes a couple of seconds.',
  'verifyEmail.done.title': 'Email confirmed',
  'verifyEmail.done.description': 'The account is active — you can sign in.',
  'verifyEmail.linkDead.title': 'The link no longer works',
  'verifyEmail.linkDead.description':
    'It is out of date, or it has already been used.',
  'verifyEmail.linkDead.body':
    'If you have followed this link before, your address is confirmed — just sign in. The link lasts 24 hours from the moment you registered.',
  'verifyEmail.error.title': "We couldn't confirm the address",
  'verifyEmail.error.recoverable':
    "The link isn't spent — you can follow it again once the service responds.",
  'verifyEmail.backup.body':
    "A new confirmation email can't be requested, but a password reset confirms the address just as well.",
  'verifyEmail.backup.action.recover': 'Recover access',

  /* ---------------------------------------------------------------- */
  /* Покупка на сайте и заказы                                          */
  /* ---------------------------------------------------------------- */
  'common.action.save': 'Save',
  'common.action.create': 'Create',
  'common.action.edit': 'Edit',
  'nav.orders': 'My orders',
  'nav.admin.products': 'Products',
  'nav.admin.orders': 'Orders',
  'nav.admin.payments': 'Payment methods',
  'nav.admin.users': 'Users',
  'nav.admin.settings': 'System settings',
  'nav.admin.audit': 'Audit log',

  'buy.title': 'Buy {product}',
  'buy.summary': '{plan} — {price}. Choose how to pay.',
  'buy.none': 'There are no payment methods for this product yet. Contact support or check back later.',
  'buy.pending': 'Creating the order…',
  'buy.yookassa.action': 'Pay by card or SBP',
  'buy.crypto.action': 'Pay with crypto',
  'buy.crypto.pickWallet': 'Choose the wallet to pay to:',
  'buy.digiseller.action': 'Go to the store',
  'buy.digiseller.hint':
    'After paying on Digiseller you get a purchase code — activate it in the “Activation” section.',

  'orders.title': 'My orders',
  'orders.description': 'Purchases made on the site and their payment status.',
  'orders.empty.title': 'No orders yet',
  'orders.empty.action': 'Go to the catalogue',
  'orders.back': 'All orders',
  'orders.column.number': 'Order',
  'orders.column.product': 'Product',
  'orders.column.amount': 'Amount',
  'orders.column.method': 'Payment',
  'orders.column.status': 'Status',
  'orders.column.created': 'Created',
  'orders.field.method': 'Payment method',
  'orders.field.created': 'Created',
  'orders.field.paid': 'Paid',
  'orders.field.cancelled': 'Cancelled',
  'orders.status.PENDING': 'Awaiting payment',
  'orders.status.AWAITING_REVIEW': 'Payment being checked',
  'orders.status.PAID': 'Paid',
  'orders.status.DELIVERED': 'Completed',
  'orders.status.CANCELLED': 'Cancelled',
  'orders.status.REFUNDED': 'Refunded',
  'orders.status.FAILED': 'Failed',
  'orders.provider.DIGISELLER': 'Digiseller',
  'orders.provider.MANUAL': 'Manual',
  'orders.provider.YOOKASSA': 'Card / SBP',
  'orders.provider.CRYPTO': 'Crypto',
  'orders.delivered.title': 'The licence has been issued',
  'orders.delivered.description': 'The key is in the email and on the licence page. The term starts at the first launch.',
  'orders.delivered.action': 'Open the licence',
  'orders.cancelled.title': 'The order is cancelled',
  'orders.cancelled.noReason': 'No reason given.',
  'orders.yookassa.title': 'Waiting for the payment',
  'orders.yookassa.description':
    'If you have already paid, the status updates within a minute. If the payment page was closed, open it again.',
  'orders.yookassa.pay': 'Go to payment',
  'orders.yookassa.check': 'Check payment',
  'orders.crypto.title': 'Transfer the exact amount',
  'orders.crypto.description': 'Send the amount below to this address before {expires}, then enter the transaction hash.',
  'orders.crypto.awaiting.title': 'Payment is being checked',
  'orders.crypto.awaiting.description':
    'We received the transaction hash. The licence is issued as soon as an administrator confirms the transfer.',
  'orders.crypto.qrAlt': 'QR code of the wallet address',
  'orders.crypto.amount': 'Amount',
  'orders.crypto.network': 'Network',
  'orders.crypto.address': 'Address',
  'orders.crypto.warning':
    'Send only {currency} in the {network} network. A transfer in another network or coin will be lost.',
  'orders.crypto.tx.label': 'Transaction hash (TXID)',
  'orders.crypto.tx.placeholder': 'Paste the hash from your wallet',
  'orders.crypto.tx.submit': 'I have paid',
  'orders.crypto.tx.update': 'Update hash',
  'orders.crypto.tx.hint': 'You will find it in the wallet history or in the network explorer.',
  'orders.crypto.tx.explorer': 'View the transaction in the explorer',
  'orders.crypto.submitted': 'Thank you! The payment has been sent for checking.',
  'orders.crypto.cancel': 'Cancel the order',

  /* ---------------------------------------------------------------- */
  /* Админка: товары, оплата, заказы, пользователи, настройки, журнал    */
  /* ---------------------------------------------------------------- */
  'admin.saved': 'Saved',

  'resellers.admin.title': 'Resellers',
  'resellers.admin.description':
    'Wholesale sellers. A reseller pays you in advance, you top up their balance, and they issue activation keys from it at the plan price minus their discount and sell them to their own customers at their own price.',
  'resellers.admin.create': 'Make a reseller',
  'resellers.admin.createHint': 'Pick an existing account by login: it gets the “Reseller” role and the “My sales” panel.',
  'resellers.admin.edit': 'Reseller terms',
  'resellers.admin.editHint': 'Discount and credit apply to the next purchases; keys already issued keep their price.',
  'resellers.admin.searchPlaceholder': 'Name, login or email',
  'resellers.admin.nothingFound': 'No resellers match the filter.',
  'resellers.admin.empty': 'No resellers yet. Make one from an existing account.',
  'resellers.admin.column.reseller': 'Reseller',
  'resellers.admin.column.status': 'Status',
  'resellers.admin.column.balance': 'Balance',
  'resellers.admin.column.discount': 'Discount',
  'resellers.admin.column.credit': 'Credit',
  'resellers.admin.column.sales30d': 'Spent in 30 days',
  'resellers.admin.column.clients': 'Clients',
  'resellers.admin.column.licenses': 'Licences',
  'resellers.admin.column.keys': 'Keys',
  'resellers.admin.topup': 'Balance',
  'resellers.admin.balanceTitle': 'Balance of “{name}”',
  'resellers.admin.balanceNow': 'Now: {balance}',
  'resellers.admin.balanceDone': 'Done, balance: {balance}',
  'resellers.admin.apply': 'Apply',
  'resellers.status.any': 'Any status',
  'resellers.status.ACTIVE': 'Active',
  'resellers.status.SUSPENDED': 'Suspended',
  'resellers.status.CLOSED': 'Closed',
  'resellers.statusHint.ACTIVE': 'Sells keys, extends licences and resets devices.',
  'resellers.statusHint.SUSPENDED': 'No new sales or extensions; clients and already sold keys keep working, device resets are allowed.',
  'resellers.statusHint.CLOSED': 'Cooperation is over: the panel is read-only.',
  'resellers.history': 'Balance history',
  'resellers.historyOf': 'Balance history of “{name}”',
  'resellers.historyHint': 'Every top-up, purchase of keys, extension and refund — newest first.',
  'resellers.field.username': 'Account login',
  'resellers.field.usernameHint': 'The person registers on the site first; then you make them a reseller here.',
  'resellers.field.displayName': 'Name shown in the panel',
  'resellers.field.discount': 'Discount, %',
  'resellers.field.discountHint': 'The reseller pays the plan price minus this discount.',
  'resellers.field.credit': 'Credit limit',
  'resellers.field.creditHint': 'How far the balance may go below zero. 0 — prepaid only.',
  'resellers.field.resets': 'Device resets per day',
  'resellers.field.status': 'Status',
  'resellers.field.products': 'Allowed products',
  'resellers.field.productsHint': 'Nothing ticked — all products may be sold.',
  'resellers.field.notes': 'Notes (only admins see them)',
  'resellers.field.txType': 'Operation',
  'resellers.field.amount': 'Amount, {currency}',
  'resellers.field.comment': 'Comment',
  'resellers.field.commentPlaceholder': 'e.g. payment by invoice #15',
  'resellers.problem.username': 'Enter the login of the account.',
  'resellers.problem.displayName': 'Enter a name.',
  'resellers.problem.discount': 'Discount: from 0 to 100.',
  'resellers.problem.credit': 'Credit limit: 0 or more.',
  'resellers.problem.resets': 'Resets per day: a whole number from 0 to 1000.',
  'resellers.problem.amount': 'Enter a non-zero amount; top-up and bonus must be positive.',
  'resellers.problem.plan': 'Choose a plan.',
  'resellers.problem.count': 'Number of keys: from 1 to 100.',
  'resellers.problem.days': 'Key validity: from 1 to 3650 days, or leave empty.',
  'resellers.problem.balance': 'Not enough money: available {available} (balance plus credit).',
  'resellers.tx.TOPUP': 'Top-up',
  'resellers.tx.SALE': 'Purchase',
  'resellers.tx.REFUND': 'Refund',
  'resellers.tx.ADJUSTMENT': 'Adjustment',
  'resellers.tx.COMMISSION': 'Bonus',
  'resellers.tx.empty': 'No operations yet.',
  'resellers.tx.column.date': 'Date',
  'resellers.tx.column.type': 'Operation',
  'resellers.tx.column.amount': 'Amount',
  'resellers.tx.column.balanceAfter': 'Balance after',
  'resellers.tx.column.what': 'What for',
  'resellers.txHint.TOPUP': 'The reseller paid you — the money goes to their balance.',
  'resellers.txHint.COMMISSION': 'A bonus or commission on top of payments.',
  'resellers.txHint.ADJUSTMENT': 'A manual correction; a negative amount takes money off.',
  'resellers.panel.subtitle': 'Issue activation keys from your balance, sell them at your price, look after your clients.',
  'resellers.panel.balance': 'Balance',
  'resellers.panel.terms': 'your discount {discount}% · credit {credit}',
  'resellers.panel.statusNotice.ACTIVE': 'Sales are open.',
  'resellers.panel.statusNotice.SUSPENDED': 'Sales are suspended by the administrator: new keys and extensions are closed, your clients keep working.',
  'resellers.panel.statusNotice.CLOSED': 'Cooperation is closed: the panel is read-only.',
  'resellers.panel.stat.unused': 'Unused keys',
  'resellers.panel.stat.used': 'Activated keys',
  'resellers.panel.stat.active': 'Active licences',
  'resellers.panel.stat.clients': 'Clients',
  'resellers.panel.stat.spent30d': 'Spent in 30 days',
  'resellers.panel.tab.keys': 'Keys',
  'resellers.panel.tab.licenses': 'Clients and licences',
  'resellers.panel.tab.transactions': 'Balance history',
  'resellers.panel.tab.balance': 'Balance',

  /* Пополнение баланса реселлером */
  'resellers.topup.title': 'Top up the balance',
  'resellers.topup.hint':
    'Like a purchase on the site: create a request, send the exact coin amount to the address, paste the transaction hash. The money lands on the balance after the administrator confirms it.',
  'resellers.topup.noWallets': 'Crypto top-up is not configured yet. Contact the administrator.',
  'resellers.topup.amount': 'Amount, {currency}',
  'resellers.topup.wallet': 'Coin and network',
  'resellers.topup.walletPlaceholder': 'Choose a wallet',
  'resellers.topup.note': 'Comment for the administrator',
  'resellers.topup.submit': 'Get payment details',
  'resellers.topup.created': 'Request created: send the transfer and paste the hash',
  'resellers.topup.problem.amount': 'The amount must be at least 1.',
  'resellers.topup.problem.wallet': 'Choose the coin and network.',
  'resellers.topup.requests': 'Top-up requests',
  'resellers.topup.none': 'No requests yet.',
  'resellers.topup.send': 'Send',
  'resellers.topup.coinAmount': 'Coin amount',
  'resellers.topup.address': 'Address',
  'resellers.topup.until': 'Valid until',
  'resellers.topup.txHash': 'Transaction hash (TXID)',
  'resellers.topup.paid': 'I have paid',
  'resellers.topup.fixHash': 'Update hash',
  'resellers.topup.cancel': 'Cancel request',
  'resellers.topup.sent': 'Sent for checking',
  'resellers.topup.waiting': 'Waiting for the administrator to check the transfer.',
  'resellers.topup.credited': 'Credited: {amount}',
  'resellers.topup.rejected': 'Rejected: {reason}',
  'resellers.topup.status.PENDING': 'Awaiting payment',
  'resellers.topup.status.SUBMITTED': 'Being checked',
  'resellers.topup.status.CONFIRMED': 'Credited',
  'resellers.topup.status.REJECTED': 'Rejected',
  'resellers.topup.status.CANCELLED': 'Cancelled',
  'resellers.topup.status.EXPIRED': 'Expired',

  /* Заявки на пополнение в админке */
  'resellers.admin.tab.resellers': 'Resellers',
  'resellers.admin.tab.topups': 'Top-up requests',
  'resellers.topups.hint':
    'For now payment is checked by a person: open the transaction by its hash in the explorer, make sure the coins arrived at the address, and confirm — the amount goes to the reseller’s balance. Automatic checking will come later.',
  'resellers.topups.filter.SUBMITTED': 'To check',
  'resellers.topups.filter.OPEN': 'Open',
  'resellers.topups.filter.CONFIRMED': 'Credited',
  'resellers.topups.filter.REJECTED': 'Rejected',
  'resellers.topups.filter.CANCELLED': 'Cancelled',
  'resellers.topups.filter.ALL': 'All',
  'resellers.topups.empty': 'No requests with this status.',
  'resellers.topups.column.created': 'Created',
  'resellers.topups.column.reseller': 'Reseller',
  'resellers.topups.column.amount': 'Amount',
  'resellers.topups.column.payment': 'Transfer',
  'resellers.topups.column.tx': 'Hash',
  'resellers.topups.column.status': 'Status',
  'resellers.topups.submittedAt': 'paid {date}',
  'resellers.topups.creditedAs': 'credited {amount}',
  'resellers.topups.explorer': 'Open in the explorer',
  'resellers.topups.confirm': 'Confirm',
  'resellers.topups.reject': 'Reject',
  'resellers.topups.confirmTitle': 'Confirm the top-up of “{name}”',
  'resellers.topups.confirmHint':
    'Expected transfer: {coins} ({network}). If a different amount arrived, change the amount to credit.',
  'resellers.topups.noTx': 'The reseller has not pasted a transaction hash yet. Confirm only if you found the transfer yourself.',
  'resellers.topups.confirmSubmit': 'Credit {amount}',
  'resellers.topups.confirmed': 'Credited, balance: {balance}',
  'resellers.topups.rejectTitle': 'Reject the request of “{name}”',
  'resellers.topups.rejectHint': 'The reseller will see the reason. Nothing is credited.',
  'resellers.topups.reason': 'Reason',
  'resellers.topups.rejectedDone': 'Request rejected',

  'resellers.panel.issue.title': 'Issue keys',
  'resellers.panel.issue.hint':
    'A key is paid from your balance at your price. Give it to the buyer: they activate it on the site (Activation) or register with it and get a licence. Unused keys can be cancelled — the money comes back.',
  'resellers.panel.issue.plan': 'Plan',
  'resellers.panel.issue.planPlaceholder': 'Choose a plan',
  'resellers.panel.issue.count': 'How many keys',
  'resellers.panel.issue.days': 'Key valid, days',
  'resellers.panel.issue.daysPlaceholder': 'no limit',
  'resellers.panel.issue.note': 'Note for yourself',
  'resellers.panel.issue.notePlaceholder': 'e.g. order from Telegram',
  'resellers.panel.issue.total': '{price} × {count} = {total}',
  'resellers.panel.issue.submit': 'Issue and pay',
  'resellers.panel.issued.title': { one: '{count} key issued', other: '{count} keys issued' },
  'resellers.panel.issued.hint': '{what}. Copy the keys now; unused keys also stay in the “Keys” tab.',
  'resellers.panel.issued.copyLabel': 'Keys',
  'resellers.panel.issued.done': 'Done',
  'resellers.keyState.all': 'All',
  'resellers.keyState.unused': 'Unused',
  'resellers.keyState.used': 'Activated',
  'resellers.keyState.expired': 'Expired',
  'resellers.keyState.cancelled': 'Cancelled',
  'resellers.panel.keys.empty': 'No keys here.',
  'resellers.panel.keys.copyLabel': 'Key',
  'resellers.panel.keys.until': 'until {date}',
  'resellers.panel.keys.cancel': 'Cancel the key and get the money back',
  'resellers.panel.keys.cancelConfirm': 'Cancel this key? {price} will return to your balance, and the key will stop working.',
  'resellers.panel.keys.cancelled': 'Key cancelled, balance: {balance}',
  'resellers.panel.keys.column.code': 'Key',
  'resellers.panel.keys.column.what': 'Product · plan',
  'resellers.panel.keys.column.state': 'State',
  'resellers.panel.keys.column.price': 'Paid',
  'resellers.panel.keys.column.client': 'Activated by',
  'resellers.panel.keys.column.created': 'Issued',
  'resellers.panel.licenses.search': 'Client login, key, product or plan',
  'resellers.panel.licenses.resets': 'Device resets today: {used} of {limit}',
  'resellers.panel.licenses.nothingFound': 'Nothing found.',
  'resellers.panel.licenses.empty': 'No sold licences yet — they appear once buyers activate your keys.',
  'resellers.panel.licenses.notStarted': 'not launched yet',
  'resellers.panel.licenses.bound': 'bound',
  'resellers.panel.licenses.unbound': 'not bound',
  'resellers.panel.licenses.resetCount': { one: '{count} reset', other: '{count} resets' },
  'resellers.panel.licenses.extend': 'Extend',
  'resellers.panel.licenses.reset': 'Reset the device',
  'resellers.panel.licenses.resetConfirm': 'Reset the device binding of {client}? The next launch binds the new computer.',
  'resellers.panel.licenses.resetDone': 'Binding reset. Today: {used} of {limit}',
  'resellers.panel.licenses.column.client': 'Client',
  'resellers.panel.licenses.column.license': 'Licence',
  'resellers.panel.licenses.column.status': 'Status',
  'resellers.panel.licenses.column.expires': 'Valid until',
  'resellers.panel.licenses.column.device': 'Device',
  'resellers.panel.extend.title': 'Extend the licence of {client}',
  'resellers.panel.extend.hint': 'The term is added to the current one; the price is charged from your balance.',
  'resellers.panel.extend.noPlans': 'No plans of this product are available to you.',
  'resellers.panel.extend.pending': 'The licence has not been launched yet: only a lifetime plan can be applied before the first launch.',
  'resellers.panel.extend.done': 'Extended, charged {price}',
  'resellers.panel.extend.submit': 'Extend for {price}',

  'admin.dates.all': 'All time',
  'admin.dates.24h': 'Last 24 hours',
  'admin.dates.7d': 'Last 7 days',
  'admin.dates.30d': 'Last 30 days',
  'admin.dates.90d': 'Last 90 days',
  'admin.dates.custom': 'Pick dates…',
  'admin.dates.from': 'From',
  'admin.dates.to': 'To',

  'admin.form.nameRequired': 'Enter a name — it cannot be empty.',
  'admin.form.slugRequired': 'Enter a code.',

  'admin.inline.edit': 'Click to edit',
  'admin.inline.required': 'Cannot be empty',
  'admin.inline.number': 'Enter a whole number',

  'admin.bulk.selectPage': 'Select the whole page',
  'admin.bulk.selectRow': 'Select row',
  'admin.bulk.selected': { one: '{count} selected', other: '{count} selected' },
  'admin.bulk.clear': 'Clear selection',
  'admin.bulk.done': { one: 'Done: {count} item', other: 'Done: {count} items' },
  'admin.bulk.partial': 'Done: {ok}, failed: {failed}',
  'admin.bulk.affects': { one: 'Applies to {count} item.', other: 'Applies to {count} items.' },
  'admin.bulk.reason': 'Reason',
  'admin.bulk.optional': 'optional',
  'admin.bulk.hours': 'Duration, hours',
  'admin.bulk.forever': 'empty — forever',
  'admin.bulk.apply': 'Apply',
  'admin.bulk.ipsHint': 'Every address these users signed in from will be blocked (your own address is skipped).',
  'admin.bulk.blockLicenses': 'Block licences',
  'admin.bulk.unblockLicenses': 'Unblock licences',
  'admin.bulk.blockOwners': 'Block owners',
  'admin.bulk.blockOwnerIps': 'Block owners’ IPs',
  'admin.bulk.blockUsers': 'Block users',
  'admin.bulk.unblockUsers': 'Unblock users',
  'admin.bulk.blockUserIps': 'Block their IPs',
  'admin.bulk.blockIps': 'Block IPs',
  'admin.bulk.blockActors': 'Block actors',
  'admin.bulk.title.block': 'Block selected licences',
  'admin.bulk.title.unblock': 'Unblock selected licences',
  'admin.bulk.title.blockOwners': 'Block owners of selected licences',
  'admin.bulk.title.blockOwnerIps': 'Block IP addresses of the owners',
  'admin.bulk.title.blockUsers': 'Block selected users',
  'admin.bulk.title.unblockUsers': 'Unblock selected users',
  'admin.bulk.title.blockUserIps': 'Block IP addresses of selected users',
  'admin.bulk.title.blockIps': 'Block IP addresses from selected rows',
  'admin.bulk.title.blockActors': 'Block users from selected rows',

  'admin.products.title': 'Products',
  'admin.products.description':
    'Products, their plans and payload builds. A new product is hidden until you set the status to “Active”.',
  'admin.products.create': 'New product',
  'admin.products.createHint': 'The code goes into licence keys and cannot be changed later.',
  'admin.products.empty': 'No products yet. Create the first one.',
  'admin.products.back': 'All products',
  'admin.products.section.main': 'Main',
  'admin.products.column.name': 'Name',
  'admin.products.column.slug': 'Code',
  'admin.products.column.status': 'Status',
  'admin.products.column.plans': 'Plans (active / all)',
  'admin.products.column.licenses': 'Licences',
  'admin.products.status.ACTIVE': 'Active',
  'admin.products.status.HIDDEN': 'Hidden',
  'admin.products.status.ARCHIVED': 'Archived',
  'admin.products.field.name': 'Name',
  'admin.products.field.slug': 'Code',
  'admin.products.field.slugHint': '3–32 characters: lowercase Latin letters, digits and hyphens.',
  'admin.products.field.description': 'Description',
  'admin.products.field.status': 'Status',
  'admin.products.field.statusHint': 'Hidden and archived products are not shown in the catalogue.',
  'admin.products.field.maxResets': 'Device resets per licence',
  'admin.products.field.cooldown': 'Hours between resets',
  'admin.products.field.fromSettings': 'From settings',
  'admin.products.field.sortOrder': 'Sort order',
  'admin.products.open': 'Open',
  'admin.products.field.slugPurpose':
    'The code is the product’s technical name: it is the prefix of licence keys (FC26-…), launchers use it to request the product, and it shows in links. 3–32 characters: lowercase Latin letters, digits, hyphen. Changing it breaks launchers already released.',
  'admin.products.slugChangeConfirm':
    'The product code is built into launchers and licence keys. Launchers released with the old code will stop finding the product. Change it anyway?',

  'admin.plans.title': 'Plans',
  'admin.plans.description': 'What buyers choose in the catalogue. A plan with licences cannot be deleted — switch it off.',
  'admin.plans.create': 'New plan',
  'admin.plans.edit': 'Edit plan',
  'admin.plans.dialogHint': 'The code and the term cannot be changed after creation — create a new plan instead.',
  'admin.plans.empty': 'No plans yet.',
  'admin.plans.column.name': 'Plan',
  'admin.plans.column.duration': 'Term',
  'admin.plans.column.price': 'Price',
  'admin.plans.column.digiseller': 'Digiseller ID',
  'admin.plans.column.state': 'State',
  'admin.plans.active': 'On sale',
  'admin.plans.inactive': 'Off',
  'admin.plans.field.name': 'Name',
  'admin.plans.field.namePlaceholder': '30 days',
  'admin.plans.field.slug': 'Code',
  'admin.plans.field.days': 'Term, days',
  'admin.plans.field.lifetime': 'Lifetime',
  'admin.plans.field.price': 'Price',
  'admin.plans.field.currency': 'Currency',
  'admin.plans.field.digiseller': 'Digiseller product ID',
  'admin.plans.field.digisellerHint': 'Needed only to sell this plan on Digiseller.',
  'admin.plans.field.active': 'On sale',
  'admin.plans.column.builds': 'Builds',
  'admin.plans.field.slugPurpose': 'Technical name of the plan for Digiseller mapping, statistics and links. Lowercase Latin letters, digits, hyphen.',
  'admin.plans.builds.noneMeansLatest': 'Nothing ticked — the plan gets the newest published build of the product.',
  'admin.plans.builds.pickedCount': { one: '{count} build ticked', other: '{count} builds ticked' },
  'admin.plans.problem.price': 'Enter the price as a whole number (0 or more).',
  'admin.plans.problem.slug': 'Code: lowercase Latin letters, digits and hyphens, starting with a letter or digit.',
  'admin.plans.problem.days': 'Enter the term in days (at least 1) or tick “Lifetime”.',
  'admin.plans.builds.edit': 'Choose builds',
  'admin.plans.builds.latest': 'latest published',
  'admin.plans.builds.title': 'Builds of “{plan}”',
  'admin.plans.builds.hint':
    'The launcher gets the newest published build among the ticked ones. Nothing ticked — the newest published build of the product. A licence with a pinned build gets exactly that one.',
  'admin.plans.builds.filter': 'Filter by name or version',
  'admin.plans.builds.unpublishedWarning': 'Some ticked builds are not published — the launcher skips them until they are.',
  'admin.plans.builds.uploadTitle': 'Upload your own exe for this plan',
  'admin.plans.builds.namePlaceholder': 'name (empty — {version})',
  'admin.plans.builds.uploadButton': 'Choose file and publish',
  'admin.plans.builds.uploaded': 'Build {name} uploaded and published — don’t forget to save',

  'admin.builds.title': 'Build storage',
  'admin.builds.description':
    'Files the launcher receives after the licence check. Create a draft, upload the file, publish. Plans pick builds from here, a licence can pin its own. A published build’s file cannot be changed, but its name can.',
  'admin.builds.name': 'Name',
  'admin.builds.nameHint':
    'Name: Latin letters and digits, segments separated by dots, ending with a letter or digit — e.g. 1.4.2, beta.2, stable. Empty — same as the version.',
  'admin.builds.queryPlaceholder': 'name:beta* status:published OR plan:30d',
  'admin.builds.nothingFound': 'No builds match the filter.',
  'admin.builds.plans': 'Plans',
  'admin.builds.pinned': 'Pinned to licences',
  'admin.builds.status.all': 'All',
  'admin.builds.status.draft': 'Draft',
  'admin.builds.status.ready': 'Ready',
  'admin.builds.status.published': 'Published',
  'admin.builds.status.unpublished': 'Unpublished',
  'admin.builds.version': 'Version',
  'admin.builds.create': 'New build',
  'admin.builds.empty': 'No builds yet.',
  'admin.builds.state': 'State',
  'admin.builds.size': 'Size',
  'admin.builds.created': 'Created',
  'admin.builds.draft': 'Draft',
  'admin.builds.ready': 'Ready to publish',
  'admin.builds.published': 'Published',
  'admin.builds.upload': 'Upload file',
  'admin.builds.reupload': 'Replace file',
  'admin.builds.uploading': 'Uploading…',
  'admin.builds.uploaded': 'The file is uploaded; the server calculated its SHA-256',
  'admin.builds.publish': 'Publish',
  'admin.builds.unpublish': 'Unpublish',

  'admin.payments.title': 'Payment methods',
  'admin.payments.description':
    'Turn payment methods on and configure them. API keys are stored encrypted and are never shown again.',
  'admin.payments.provider.DIGISELLER': 'Digiseller',
  'admin.payments.provider.YOOKASSA': 'YooKassa (cards, SBP)',
  'admin.payments.provider.CRYPTO': 'Crypto to a wallet',
  'admin.payments.hint.DIGISELLER': 'The buyer pays on Digiseller and activates the purchase code here.',
  'admin.payments.hint.YOOKASSA': 'Payment on the YooKassa page; the licence is issued automatically.',
  'admin.payments.hint.CRYPTO': 'The buyer transfers to your wallet; you confirm the order by hand.',
  'admin.payments.enabled': 'On',
  'admin.payments.disabled': 'Off',
  'admin.payments.enable': 'Enabled',
  'admin.payments.field.title': 'Name in the catalogue',
  'admin.payments.field.description': 'Hint for the buyer',
  'admin.payments.secret.sellerId': 'Seller ID',
  'admin.payments.secret.apiKey': 'API key',
  'admin.payments.secret.shopId': 'shopId',
  'admin.payments.secret.secretKey': 'Secret key',
  'admin.payments.secret.set': 'Set — enter a new value to replace',
  'admin.payments.secret.empty': 'Not set',
  'admin.payments.secret.clear': 'Clear',
  'admin.payments.digiseller.minRatio': 'Minimum share of the plan price',
  'admin.payments.digiseller.minRatioHint': 'A deal paid below this share goes to manual review.',
  'admin.payments.digiseller.pollWindow': 'Watch for refunds, hours',
  'admin.payments.yookassa.webhook': 'Notification URL',
  'admin.payments.yookassa.webhookHint':
    'In the YooKassa dashboard: Integration → HTTP notifications. Enable payment.succeeded and payment.canceled.',
  'admin.payments.yookassa.receipt': 'Send a receipt (54-FZ)',
  'admin.payments.yookassa.vatCode': 'VAT code',
  'admin.payments.crypto.wallets': 'Wallets',
  'admin.payments.crypto.addWallet': 'Add wallet',
  'admin.payments.crypto.noWallets': 'No wallets yet — press “Add wallet” and paste the address.',
  'admin.payments.crypto.noWalletsWarning': 'Without a wallet these payment details are not ready and buyers will not see crypto payment.',
  'admin.payments.crypto.addressRequired': 'Fill in the address of every wallet (at least 10 characters) and a rate above zero, or remove the empty row.',
  'admin.payments.crypto.addressPlaceholder': 'Wallet address, e.g. T…',
  'admin.payments.crypto.currency': 'Coin',
  'admin.payments.crypto.network': 'Network',
  'admin.payments.crypto.address': 'Address',
  'admin.payments.crypto.rate': 'Rate',
  'admin.payments.crypto.decimals': 'Decimals',
  'admin.payments.crypto.explorer': 'Explorer link ({tx} = hash)',
  'admin.payments.crypto.removeWallet': 'Remove wallet',
  'admin.payments.crypto.rateHint':
    'Rate = how many units of the plan currency one coin costs (for USDT and roubles — the dollar rate). The amount is rounded up.',
  'admin.payments.crypto.instructions': 'Instructions for the buyer',
  'admin.payments.crypto.expireHours': 'Cancel unpaid after, hours',

  'admin.orders.title': 'Orders',
  'admin.orders.description': 'All purchases. Crypto payments are confirmed here by hand.',
  'admin.orders.tab.awaiting': 'Awaiting confirmation',
  'admin.orders.tab.all': 'All orders',
  'admin.orders.search': 'Order number or login',
  'admin.orders.anyStatus': 'Any status',
  'admin.orders.anyProvider': 'Any method',
  'admin.orders.empty.awaiting': 'No payments to check right now.',
  'admin.orders.empty.all': 'No orders match the filter.',
  'admin.orders.column.buyer': 'Buyer',
  'admin.orders.column.payment': 'Payment',
  'admin.orders.explorer': 'Open in explorer',
  'admin.orders.noTx': 'The buyer has not sent a transaction hash yet',
  'admin.orders.confirm': 'Confirm',
  'admin.orders.reject': 'Reject',
  'admin.orders.confirmTitle': 'Confirm payment for {number}',
  'admin.orders.confirmHint':
    'Check that the transfer has arrived in the right network and amount. A licence is issued immediately after confirmation.',
  'admin.orders.note': 'Comment (optional)',
  'admin.orders.confirmed': 'Payment confirmed, licence issued',
  'admin.orders.rejectTitle': 'Reject payment for {number}',
  'admin.orders.rejectHint': 'The order is cancelled and the buyer gets an email with the reason.',
  'admin.orders.reason': 'Reason',
  'admin.orders.rejected': 'The order is rejected',

  'admin.users.title': 'Users',
  'admin.users.description': 'Search, blocking, roles and manual licence issue.',
  'admin.users.search': 'Login or email',
  'admin.users.anyStatus': 'Any status',
  'admin.users.anyRole': 'Any role',
  'admin.users.empty': 'No users match the filter.',
  'admin.users.total': 'Total: {total}',
  'admin.users.back': 'All users',
  'admin.users.column.user': 'User',
  'admin.users.column.roles': 'Roles',
  'admin.users.column.status': 'Status',
  'admin.users.column.licenses': 'Licences',
  'admin.users.column.orders': 'Orders',
  'admin.users.column.lastLogin': 'Last sign-in',
  'admin.users.status.ACTIVE': 'Active',
  'admin.users.status.PENDING_VERIFICATION': 'Email not confirmed',
  'admin.users.status.BLOCKED': 'Blocked',
  'admin.users.status.DELETED': 'Deleted',
  'admin.users.section.profile': 'Profile',
  'admin.users.section.access': 'Access',
  'admin.users.section.roles': 'Roles',
  'admin.users.section.licenses': 'Licences',
  'admin.users.section.orders': 'Orders',
  'admin.users.meta': 'Registered {created} · last sign-in {login}',
  'admin.users.twoFactorOn': '2FA on',
  'admin.users.twoFactorOff': '2FA off',
  'admin.users.field.username': 'Login',
  'admin.users.field.email': 'Email',
  'admin.users.field.emailVerified': 'Email confirmed',
  'admin.users.blockHint': 'Blocking ends all sessions of the user immediately.',
  'admin.users.blockedAt': 'Blocked {date}: {reason}',
  'admin.users.blockReason': 'Reason — it is saved in the audit log',
  'admin.users.block': 'Block',
  'admin.users.unblock': 'Unblock',
  'admin.users.rolesHint': 'You can only grant and remove roles lower than your own.',
  'admin.users.noLicenses': 'No licences.',
  'admin.users.noOrders': 'No orders.',
  'admin.users.issue.title': 'Issue a licence',
  'admin.users.issue.product': 'Product',
  'admin.users.issue.plan': 'Plan',
  'admin.users.issue.action': 'Issue',
  'admin.users.issue.done': 'The licence is issued',
  'admin.users.issue.hint': 'Free of charge. The term starts at the first launch.',

  'admin.settings.title': 'Settings',
  'admin.settings.description': 'Platform parameters. Changes apply without a restart.',

  'admin.audit.title': 'Audit log',
  'admin.audit.description': 'Who did what and when, plus anti-fraud events.',
  'admin.audit.tab.audit': 'Actions',
  'admin.audit.tab.antifraud': 'Anti-fraud',
  'admin.audit.filter': 'Action prefix, e.g. order. or user.',
  'admin.audit.empty': 'No entries.',
  'admin.audit.antifraudEmpty': 'No anti-fraud events.',
  'admin.audit.column.time': 'Time',
  'admin.audit.column.actor': 'Who',
  'admin.audit.column.action': 'Action',
  'admin.audit.column.entity': 'Object',
  'admin.audit.column.details': 'Details',
  'admin.audit.column.type': 'Type',
  'admin.audit.column.severity': 'Severity',

  /* ---------------------------------------------------------------- */
  /* Панель справа (как в SIEM)                                         */
  /* ---------------------------------------------------------------- */
  'panel.close': 'Close panel',
  'panel.resize': 'Drag to resize the panel',
  'panel.openPage': 'Open as a page',

  /* Док: подветка */
  'appearance.sub.title': 'Branch sub-items',
  'appearance.sub.description': 'How the squares of a branch open in the collapsed panel. A click on a branch only opens or closes it; the page does not change.',
  'appearance.sub.side': 'Side column',
  'appearance.sub.side.hint': 'A separate column of squares next to the panel, going down from the branch icon.',
  'appearance.sub.inline': 'Inside the panel',
  'appearance.sub.inline.hint': 'Squares expand right under the branch icon, like an expand panel. Handy on small screens.',
  'settings.nav.roles': 'Roles and permissions',

  /* Карточка пользователя */
  'admin.users.selfHint': 'This is your account: here it is view-only. Change it in your profile settings. You can still make yourself a reseller.',
  'admin.users.section.reseller': 'Reseller',
  'admin.users.reseller.is': 'The account sells wholesale as “{name}”.',
  'admin.users.reseller.not': 'The account is not a reseller. Make it one to let it issue keys from its balance.',
  'admin.users.reseller.open': 'Open reseller',
  'admin.users.reseller.make': 'Make a reseller',

  /* Реселлеры: форма, подсказки логина, панель */
  'resellers.field.noProducts': 'No products yet — the reseller will be able to sell everything that appears.',
  'resellers.admin.makeSelf': 'I will be the reseller myself',
  'resellers.candidates.show': 'Show accounts',
  'resellers.candidates.matching': 'Accounts matching “{search}”',
  'resellers.candidates.all': 'All accounts, A to Z',
  'resellers.candidates.count': { one: '{count} account', other: '{count} accounts' },
  'resellers.candidates.none': 'No such accounts. The person has to register on the site first.',
  'resellers.candidates.you': 'you',
  'resellers.candidates.already': 'already a reseller',
  'resellers.adminPanel.tab.terms': 'Terms',
  'resellers.adminPanel.tab.balance': 'Balance',
  'resellers.adminPanel.tab.requisites': 'Payment details',
  'resellers.adminPanel.tab.topups': 'Top-ups',
  'resellers.panel.since': 'Reseller since',
  'resellers.panel.balanceTitle': 'Change the balance',
  'resellers.requisites.none': 'No payment details are granted (or all are off / not ready) — the reseller cannot top up the balance. Attach some below.',
  'resellers.requisites.own': 'The reseller tops up only with the enabled payment details below.',
  'resellers.requisites.enabled': 'Accept top-ups with these details',
  'resellers.requisites.detach': 'Detach',
  'resellers.requisites.noneLeft': 'Nothing left to attach',
  'resellers.requisites.pick': 'Choose payment details',
  'resellers.requisites.attach': 'Attach',
  'resellers.requisites.hint': 'Only payment details from the “For resellers” section are listed.',
  'resellers.requisites.manage': 'Manage the section',
  'resellers.topups.panelSubtitle': '{name} · {date}',
  'resellers.topups.section.payment': 'Transfer',
  'resellers.topups.field.coins': 'To pay',
  'resellers.topups.field.network': 'Network',
  'resellers.topups.field.address': 'Address',
  'resellers.topups.field.expires': 'Valid until',
  'resellers.topups.field.submitted': 'Hash sent',
  'resellers.topups.field.reviewed': 'Reviewed',
  'resellers.topups.field.credited': 'Credited',
  'resellers.topups.openReseller': 'Open reseller',

  /* Журналы безопасности: панель события */
  'siem.panel.fields': 'Fields',
  'siem.panel.changes': 'What changed',
  'siem.panel.sameIp': 'Same address',
  'siem.panel.sameUser': 'Same user',
  'siem.panel.openUser': 'Open user',
  'siem.panel.blockIp': 'Block address',
  'siem.panel.blockReason': 'From the security log: {what}',
  'security.blocks.active': 'active',
  'security.blocks.findUsers': 'Users from this address',
  'security.blocks.created': 'Created',

  /* Способы оплаты: разделы и перенос */
  'admin.payments.section.PRODUCTS': 'For products',
  'admin.payments.section.RESELLERS': 'For resellers',
  'admin.payments.section.CHANNELS': 'Channels',
  'admin.profiles.scope.PRODUCTS.title': 'Payment details for products',
  'admin.profiles.scope.PRODUCTS.description': 'Where buyers pay for products: templates for any product and personal details of a single product.',
  'admin.profiles.scope.PRODUCTS.empty': 'No payment details for products yet.',
  'admin.profiles.scope.RESELLERS.title': 'Payment details for resellers',
  'admin.profiles.scope.RESELLERS.description': 'Wallets resellers top up their balance with. New details are available to nobody: grant access in the details or in the reseller card.',
  'admin.profiles.scope.RESELLERS.empty': 'No payment details for resellers yet — create them or move some from the products section.',
  'admin.profiles.registry.column.resellers': 'Resellers',
  'admin.profiles.registry.nobody': 'available to nobody',
  'admin.profiles.access.title': 'Reseller access',
  'admin.profiles.access.hint': 'Only these resellers see the wallets when topping up. The same access is set in the reseller card.',
  'admin.profiles.access.nobody': 'Available to nobody yet — grant access to the resellers who should top up with these details.',
  'admin.profiles.access.revoke': 'Revoke access',
  'admin.profiles.access.pick': 'Choose a reseller',
  'admin.profiles.access.noneLeft': 'Everyone already has access',
  'admin.profiles.access.grant': 'Grant',
  'admin.profiles.access.grantAll': 'Grant to all',
  'admin.profiles.access.grantedAll': 'Access granted to all resellers',

  /* Панель справа, док и горячие клавиши */
  'panel.hint.move': 'previous / next',
  'panel.hint.close': 'close',
  'appearance.reset': 'Reset everything',
  'appearance.resetDone': 'Interface settings are back to defaults',
  'appearance.yes': 'yes',
  'appearance.no': 'no',
  'appearance.dock.push': 'Make room on the page for the panel',
  'appearance.dock.push.none': 'Do not shift',
  'appearance.dock.push.dock': 'For the panel',
  'appearance.dock.push.all': 'For the panel and sub-items',
  'appearance.dock.push.none.hint': 'The panel floats over the page; the page keeps its full width.',
  'appearance.dock.push.dock.hint': 'The page moves aside by the width of the panel.',
  'appearance.dock.push.all.hint': 'The page also moves aside for the open column of sub-items.',
  'appearance.grow.title': 'Where the panel grows when a branch opens inside it',
  'appearance.grow.down': 'Down only',
  'appearance.grow.up': 'Up only',
  'appearance.grow.both': 'Both ways',
  'appearance.grow.down.hint': 'The top stays in place and the item you clicked does not move. What does not fit is scrolled inside the panel (for a horizontal panel — to the right).',
  'appearance.grow.up.hint': 'The bottom stays in place; the panel grows upwards and scrolls inside when it does not fit (for a horizontal panel — to the left).',
  'appearance.grow.both.hint': 'The panel stays centred and grows both ways.',
  'appearance.size.title': 'Panel length',
  'appearance.size.auto': 'By content',
  'appearance.size.fixed': 'Custom',
  'appearance.size.auto.hint': 'As long as its items, up to the screen size.',
  'appearance.size.fixed.hint': 'Always the chosen length; extra items are scrolled inside. The panel changes right away.',
  'appearance.size.length': 'Length',
  'appearance.width.title': 'Panel width',
  'appearance.width.value': 'Width',
  'appearance.width.auto.hint': 'As wide as its items. Opening a branch inside does not change it.',
  'appearance.width.fixed.hint': 'Always the chosen width (for a horizontal panel — height); icons stay centred.',
  'appearance.panel.title': 'Side panel on the right',
  'appearance.panel.description': 'The record card that opens on the right when you click a row in a list.',
  'appearance.panel.push': 'Shrink the page when the panel is open',
  'appearance.panel.pushHint': 'The list moves aside and stays fully visible (on wide screens). Off — the panel opens over the list, like in some SIEMs.',
  'appearance.panel.resizable': 'Resize with the mouse',
  'appearance.panel.resizableHint': 'Drag the left edge of the panel; the width is remembered. Off — always the width set below.',
  'appearance.panel.width': 'Panel width',
  'appearance.panel.showPreview': 'Show the panel',
  'appearance.panel.hidePreview': 'Hide the panel',
  'appearance.panel.previewTitle': 'Panel preview',
  'appearance.panel.previewSubtitle': 'This is how wide record cards will be: {width} px',
  'appearance.panel.previewSection': 'Current settings',
  'appearance.panel.previewHint': 'Move the width slider — the panel follows it. Close it with the cross, Esc or the close key.',
  'appearance.hotkeys.title': 'Keyboard shortcuts',
  'appearance.hotkeys.enabled': 'Keyboard shortcuts are on',
  'appearance.hotkeys.hint': 'Any number of keys per action. They do not fire while you type in a field. The physical key counts, so the keyboard layout does not matter.',
  'appearance.hotkeys.group.lists': 'Lists with the side panel',
  'appearance.hotkeys.group.menu': 'Navigation panel',
  'appearance.hotkeys.down': 'Next row',
  'appearance.hotkeys.up': 'Previous row',
  'appearance.hotkeys.open': 'Open in the panel',
  'appearance.hotkeys.close': 'Close the panel',
  'appearance.hotkeys.menuUp': 'Menu: item above',
  'appearance.hotkeys.menuDown': 'Menu: item below',
  'appearance.hotkeys.menuActivate': 'Menu: open the item',
  'appearance.hotkeys.down.hint': 'If the panel is open, it switches to that row.',
  'appearance.hotkeys.up.hint': 'If the panel is open, it switches to that row.',
  'appearance.hotkeys.open.hint': 'Opens the highlighted row on the right.',
  'appearance.hotkeys.close.hint': 'Esc closes it too.',
  'appearance.hotkeys.menuUp.hint': 'Moves through the panel items, including an open branch.',
  'appearance.hotkeys.menuDown.hint': 'Moves through the panel items, including an open branch.',
  'appearance.hotkeys.menuActivate.hint': 'Opens the page; on a branch — expands or collapses it. A mouse click opens right away.',
  'appearance.hotkeys.none': 'no keys',
  'appearance.hotkeys.add': 'Add a key',
  'appearance.hotkeys.remove': 'Remove the key',
  'appearance.hotkeys.moved': 'Key {key} was moved from “{from}”',
  'appearance.hotkeys.press': 'press a key…',
  'appearance.hotkeys.reset': 'Default keys',
  'admin.profiles.move.to.PRODUCTS': 'Move to products',
  'admin.profiles.move.to.RESELLERS': 'Move to resellers',
  'admin.profiles.move.cryptoOnly': 'Resellers top up only with crypto — YooKassa cannot be moved to them.',
  'admin.profiles.move.detach.PRODUCTS': {
    one: 'The details will be detached from {count} product and become a common reseller template.',
    other: 'The details will be detached from {count} products and become a common reseller template.',
  },
  'admin.profiles.move.detach.RESELLERS': {
    one: 'The details will be detached from {count} reseller.',
    other: 'The details will be detached from {count} resellers.',
  },
  'admin.profiles.move.hint': 'Nothing is attached to these details yet — they simply change section.',
  'admin.profiles.move.done': 'Payment details moved',
  'admin.profiles.panel.summary': 'Summary',
  'admin.profiles.panel.updated': 'Updated',
  'admin.profiles.panel.edit': 'Edit',

  /* Роли и права */
  'roles.title': 'Roles and permissions',
  'roles.description': 'A permission is a ready action of the system, a role is a set of them. Build your own roles from the permissions you have; system roles can be used as a base.',
  'roles.create': 'Create a role',
  'roles.list.title': 'Roles',
  'roles.list.description': 'Click a role to see its permissions. The level decides who can grant the role: only someone with a higher level.',
  'roles.column.role': 'Role',
  'roles.column.priority': 'Level',
  'roles.column.permissions': 'Permissions',
  'roles.column.users': 'Users',
  'roles.system': 'system',
  'roles.custom': 'custom',
  'roles.basedOn': 'Based on “{name}”',
  'roles.copy': 'Create based on it',
  'roles.copyName': '{name} (copy)',
  'roles.systemHint': 'System roles are rebuilt by the seed on every deploy, so they are read-only here. Create your own role based on this one.',
  'roles.field.name': 'Name',
  'roles.field.slug': 'Code',
  'roles.field.priority': 'Level',
  'roles.field.description': 'Description',
  'roles.priorityHint.staff': 'Staff permissions: level from {min} up to (but below) yours. 2FA is mandatory for such a role.',
  'roles.priorityHint.user': 'User-level permissions only: level from 11 up to (but below) yours.',
  'roles.permissions.title': { one: 'Permissions: {count}', other: 'Permissions: {count}' },
  'roles.permissions.hint': 'Only permissions you have yourself can be added.',
  'roles.permissions.search': 'Find a permission',
  'roles.permissions.all': 'Select all',
  'roles.permissions.none': 'Clear',
  'roles.permissions.notOwned': 'You do not have this permission yourself',
  'roles.problem.name': 'Enter a role name',
  'roles.problem.slug': 'Code: 3–64 characters, lowercase Latin letters, digits and _',
  'roles.problem.permissions': 'Choose at least one permission',
  'roles.problem.priority': 'Level: from {min} to 99 and below yours',
  'roles.delete': 'Delete role',
  'roles.deleteTitle': 'Delete role “{name}”?',
  'roles.deleteUsers': {
    one: '{count} user has this role. If it is their only role, they get the user role.',
    other: '{count} users have this role. Those left without roles get the user role.',
  },
  'roles.deleteHint': 'Nobody has this role.',
  'roles.deleted': 'Role deleted',

  /* Заказы: панель */
  'admin.orders.panel.order': 'Order',
  'admin.orders.panel.paid': 'Paid',
  'admin.orders.panel.delivered': 'Delivered',
  'admin.orders.panel.cancelled': 'Cancelled',
  'admin.orders.panel.provider': 'Method',
  'admin.orders.panel.coins': 'To pay',
  'admin.orders.panel.address': 'Address',
  'admin.orders.panel.submitted': 'Hash sent',
  'admin.orders.panel.confirmed': 'Confirmed',
  'admin.orders.panel.error': 'Error',
  'admin.orders.panel.licenses': 'Licences',
  'admin.orders.panel.openLicenses': { one: 'Open {count} licence', other: 'Open {count} licences' },
} satisfies Record<string, Message>

/** Все существующие ключи. Опечатка в `t('licens.list.title')` — ошибка сборки. */
export type MessageKey = keyof typeof en

/**
 * Форма любого другого словаря: те же ключи, та же природа значения.
 * Строковый ключ обязан остаться строкой, числовой — остаться набором форм.
 */
export type Messages = {
  [K in MessageKey]: (typeof en)[K] extends string ? string : import('../types').PluralForms
}

/** Ключи обычных текстов: `count` для них не нужен. */
export type PlainKey = {
  [K in MessageKey]: (typeof en)[K] extends string ? K : never
}[MessageKey]

/** Ключи, зависящие от числа: `count` для них ОБЯЗАТЕЛЕН. */
export type CountKey = Exclude<MessageKey, PlainKey>
