#!/usr/bin/env python3
"""
Учебный клиент загрузчика: повторяет протокол настоящего загрузчика
(Griloder, Platform/Session.cpp + Payload.cpp) шаг в шаг.

  1. POST /launcher/license/check — сервер проверяет ключ лицензии и привязку
     к диску. ПЕРВЫЙ вызов привязывает лицензию к указанному Disk ID и
     запускает срок — берите тестовую лицензию.
  2. POST /launcher/payload — клиент придумывает случайный sessionKey,
     сервер ещё раз проверяет лицензию и диск и отдаёт сборку, зашифрованную
     AES-256-GCM ключом, выведенным из этого sessionKey (HKDF-SHA256).
     Ответ «лицензия не привязана» лечится одной проверкой лицензии и одним
     повтором — как у загрузчика.
  3. Клиент проверяет заголовки, выводит тот же ключ, расшифровывает
     и сверяет SHA-256.

Каждый запрос подписан ключом сборки (HMAC-SHA256). Сбой сети и 502/503/504
повторяются (1 с / 2 с / 4 с, каждый раз с новой подписью); «подпись
просрочена» один раз подводит часы по заголовку Date сервера.

Нужно:
  pip install cryptography

Ключ сборки (X-Api-Key + секрет подписи) выпускается один раз:
  python scripts/launcher-test-client.py create-key --admin admin
    → спросит пароль (и код 2FA, если включена), сохранит ключ в
      ~/.lp-launcher-test.json. Секрет сервер показывает только один раз.

Проверка:
  python scripts/launcher-test-client.py run --license-key FC26-XXXX-XXXX-XXXX-XXXX \\
      --product fc26 --hwid PY-TEST-DISK-0001 [--save out.dll] [--demo] [--skip-check]

  --skip-check  начать сразу с payload (как FetchPayload): у непривязанной
                лицензии сервер ответит LICENSE_NOT_BOUND, клиент сам сходит
                в license/check и повторит.
  --demo        показать отказы: без подписи, подделанное тело, чужой диск,
                неверный ключ лицензии.

Настоящий загрузчик читает Disk ID с железа; здесь он задаётся руками
(--hwid), потому что способ чтения живёт в другом модуле загрузчика.
Ключ лицензии — в админке (Лицензии → кнопка копирования) или в кабинете.
Переменные окружения вместо аргументов: LP_BASE, LP_API_KEY, LP_API_SECRET,
LP_LICENSE_KEY.
"""

from __future__ import annotations

import argparse
import email.utils
import getpass
import hashlib
import hmac
import json
import os
import secrets
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

try:
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
except ImportError:  # pragma: no cover - подсказка вместо трассировки
    sys.exit('Нужна библиотека cryptography:  pip install cryptography')

DEFAULT_BASE = 'http://localhost:3000/api/v1'
KEY_FILE = Path.home() / '.lp-launcher-test.json'
# Константа протокола: info для HKDF и первое поле AAD.
INFO = b'lp/payload/v1'
CLIENT_VERSION = '1.0.0'
# Как в Config.h загрузчика.
MAX_RETRIES = 3
BACKOFF_BASE_SEC = 1
MAX_PAYLOAD_BYTES = 8 * 1024 * 1024
TIMEOUT_SEC = 15

# Что значат коды отказа — коротко, по-русски.
EXPLAIN = {
    'SIGNATURE_MISSING': 'запрос без подписи — сервер не знает, что это наш загрузчик',
    'SIGNATURE_INVALID': 'подпись не сошлась: тело или путь изменены, либо неверный секрет ключа сборки',
    'SIGNATURE_EXPIRED': 'метка времени вне окна (обычно 5 минут) — проверьте часы',
    'REPLAY': 'этот запрос уже приходил (повтор перехваченного запроса)',
    'API_KEY_SCOPE': 'у ключа сборки нет права на этот запрос',
    'LICENSE_KEY_INVALID': 'такого ключа лицензии нет',
    'LICENSE_NOT_ASSIGNED': 'ключ не привязан ни к одному аккаунту',
    'LICENSE_EXPIRED': 'срок лицензии истёк',
    'LICENSE_BLOCKED': 'лицензия заблокирована',
    'LICENSE_REVOKED': 'лицензия отозвана',
    'LICENSE_NOT_BOUND': 'лицензия ещё не привязана к диску — сначала license/check',
    'LICENSE_NOT_ACTIVATED': 'лицензия ещё не активирована — сначала license/check',
    'HWID_MISMATCH': 'лицензия привязана к другому диску',
    'DEVICE_BLOCKED': 'устройство заблокировано',
    'PRODUCT_NOT_FOUND': 'нет товара с таким кодом',
    'PAYLOAD_NOT_READY': 'у товара нет опубликованной сборки',
    'SESSION_KEY_REUSED': 'sessionKey уже использовался — он обязан быть новым на каждый запрос',
    'RATE_LIMITED': 'слишком много выдач за час по этой лицензии',
    'UPDATE_REQUIRED': 'версия загрузчика ниже минимальной для этой сборки',
}


class Response:
    def __init__(self, status: int, headers: dict[str, str], body: bytes, failed: str | None = None):
        self.status = status
        self.headers = {k.lower(): v.strip() for k, v in headers.items()}
        self.body = body
        self.failed = failed  # сеть не ответила

    def json(self) -> dict:
        try:
            return json.loads(self.body.decode('utf-8'))
        except ValueError:
            return {}

    @property
    def code(self) -> str:
        return self.json().get('code', '')

    def describe_error(self) -> str:
        if self.failed:
            return f'сеть: {self.failed}'
        data = self.json()
        code = data.get('code', '?')
        hint = EXPLAIN.get(code, data.get('message', ''))
        return f'HTTP {self.status} {code} — {hint}'


def http(method: str, url: str, body: bytes | None, headers: dict[str, str], limit: int = 2 * 1024 * 1024) -> Response:
    request = urllib.request.Request(url, data=body, method=method, headers=headers)
    try:
        with urllib.request.urlopen(request, timeout=TIMEOUT_SEC) as resp:
            data = resp.read(limit + 1)
            if len(data) > limit:
                return Response(0, {}, b'', failed='ответ больше допустимого размера')
            return Response(resp.status, dict(resp.headers), data)
    except urllib.error.HTTPError as err:
        return Response(err.code, dict(err.headers), err.read(limit))
    except (urllib.error.URLError, TimeoutError, ConnectionError) as err:
        return Response(0, {}, b'', failed=str(getattr(err, 'reason', err)))


def normalize_license_key(raw: str) -> str:
    """Как NormalizeLicenseKey в Session.cpp: без пробелов, в верхнем регистре."""
    return ''.join(ch for ch in raw if ch not in ' \t\r\n').upper()


def normalize_hwid(raw: str) -> str:
    """Как сервер нормализует Disk ID: без пробелов, в верхнем регистре."""
    return ''.join(raw.split()).upper()


class Client:
    """Транспорт загрузчика (Platform/Http.cpp): подпись, повторы, подводка часов."""

    def __init__(self, base: str, api_key: str, secret: str):
        self.base = base
        self.api_key = api_key
        self.secret = secret
        self.skew = 0  # секунд: время сервера минус наше

    def path_of(self, endpoint: str) -> str:
        """Путь, который входит в подпись: '/api/v1/launcher/...' без хоста и query."""
        return urllib.parse.urlparse(self.base).path.rstrip('/') + endpoint.split('?')[0]

    def sign(self, method: str, endpoint: str, body: bytes) -> dict[str, str]:
        """
        строка = METHOD \\n PATH \\n TIMESTAMP \\n NONCE \\n sha256(тело)
        X-Signature = HMAC-SHA256(секрет ключа сборки, строка), hex
        """
        timestamp = str(int(time.time()) + self.skew)
        nonce = secrets.token_hex(16)
        canonical = '\n'.join([method, self.path_of(endpoint), timestamp, nonce, hashlib.sha256(body).hexdigest()])
        signature = hmac.new(self.secret.encode(), canonical.encode(), hashlib.sha256).hexdigest()
        return {'X-Api-Key': self.api_key, 'X-Timestamp': timestamp, 'X-Nonce': nonce, 'X-Signature': signature}

    def post(self, endpoint: str, payload: dict, *, limit: int = 2 * 1024 * 1024, accept: str | None = None,
             sign: bool = True, tamper_body: bool = False) -> Response:
        body = json.dumps(payload, separators=(',', ':'), ensure_ascii=False).encode('utf-8')
        synced = False
        attempt = 1
        while True:
            headers = {
                'Content-Type': 'application/json; charset=utf-8',
                'Accept-Language': 'ru',
                'X-Client-Version': CLIENT_VERSION,
            }
            if accept:
                headers['Accept'] = accept
            if sign:
                headers.update(self.sign('POST', endpoint, body))  # новая подпись на КАЖДУЮ попытку
            sent = body.replace(b'"hwid":"', b'"hwid":"X', 1) if tamper_body else body
            resp = http('POST', self.base + endpoint, sent, headers, limit)

            if resp.failed or resp.status in (502, 503, 504):
                if attempt < MAX_RETRIES:
                    time.sleep(BACKOFF_BASE_SEC * 2 ** (attempt - 1))
                    attempt += 1
                    continue
                return resp
            if resp.status == 403 and resp.code == 'SIGNATURE_EXPIRED' and not synced and 'date' in resp.headers:
                # Часы сервера — правда; повтор не тратит попытку.
                server = email.utils.parsedate_to_datetime(resp.headers['date']).timestamp()
                self.skew = int(server - time.time())
                synced = True
                print(f'    часы расходятся с сервером на {self.skew} с — подвёл и повторяю')
                continue
            return resp


def hkdf_sha256(ikm: bytes, salt: bytes, info: bytes) -> bytes:
    """HKDF (RFC 5869), длина 32 байта — ровно одна итерация Expand."""
    prk = hmac.new(salt, ikm, hashlib.sha256).digest()
    return hmac.new(prk, info + b'\x01', hashlib.sha256).digest()


def is_hex(value: str, length: int) -> bool:
    return len(value) == length and all(c in '0123456789abcdefABCDEF' for c in value)


def decode_payload(resp: Response, session_key: bytes, product: str) -> tuple[bytearray, dict[str, str]]:
    """Проверки и расшифровка как в Payload.cpp (DecodeResponse). Ошибка — ValueError."""
    h = resp.headers
    sha, size, nonce, tag, version = (h.get(f'x-payload-{n}', '') for n in ('sha256', 'size', 'nonce', 'tag', 'version'))

    # 1. Формат заголовков — до всякой расшифровки.
    if not is_hex(sha, 64) or not is_hex(nonce, 24) or not is_hex(tag, 32):
        raise ValueError('заголовки X-Payload-* не того формата')
    if not version or len(version) > 64 or any(not 0x21 <= ord(c) <= 0x7E for c in version):
        raise ValueError('X-Payload-Version непригоден для AAD')
    if not size.isdigit() or size.startswith('0') or len(size) > 20:
        raise ValueError('X-Payload-Size не каноничен')
    # 2. Объявленный размер против фактического: GCM не меняет длину.
    if int(size) > MAX_PAYLOAD_BYTES or int(size) != len(resp.body):
        raise ValueError(f'размер тела {len(resp.body)} не совпал с X-Payload-Size {size}')

    # 3. Ключ: HKDF(sessionKey, соль = nonce сервера, info), 4. AAD из пяти полей через \n.
    iv = bytes.fromhex(nonce)
    key = hkdf_sha256(session_key, iv, INFO)
    aad = b'\n'.join([INFO, product.encode(), sha.encode(), size.encode(), version.encode()])

    # 5. Расшифровка с проверкой тега, 6. вторая проверка — SHA-256 открытого текста.
    plain = bytearray(AESGCM(key).decrypt(iv, resp.body + bytes.fromhex(tag), aad))
    if hashlib.sha256(plain).hexdigest() != sha.lower():
        wipe(plain)
        raise ValueError('тег сошёлся, а SHA-256 — нет (сервер отдал не тот файл)')
    return plain, {'sha256': sha, 'size': size, 'version': version}


def wipe(buf: bytearray) -> None:
    """Затереть открытый текст. В Python это лучшее усилие, а не гарантия (копии делает сам интерпретатор)."""
    for i in range(len(buf)):
        buf[i] = 0


def mask(value: str) -> str:
    return value[:5] + '…' + value[-4:] if len(value) > 12 else '…'


# ----------------------------------------------------------------- шаги

def license_check(client: Client, product: str, hwid: str, license_key: str) -> Response:
    return client.post('/launcher/license/check',
                       {'productSlug': product, 'hwid': hwid, 'clientVersion': CLIENT_VERSION, 'licenseKey': license_key})


def request_payload(client: Client, product: str, hwid: str, license_key: str) -> tuple[Response, bytes]:
    session_key = secrets.token_bytes(32)  # новый на КАЖДЫЙ запрос
    resp = client.post('/launcher/payload',
                       {'productSlug': product, 'hwid': hwid, 'sessionKey': session_key.hex(), 'licenseKey': license_key},
                       limit=MAX_PAYLOAD_BYTES, accept='application/octet-stream, application/json')
    return resp, session_key


# ----------------------------------------------------------------- команды

def load_key(args) -> tuple[str, str]:
    api_key = args.api_key or os.environ.get('LP_API_KEY')
    secret = args.api_secret or os.environ.get('LP_API_SECRET')
    if (not api_key or not secret) and KEY_FILE.exists():
        saved = json.loads(KEY_FILE.read_text('utf-8'))
        api_key, secret = saved['prefix'], saved['signingSecret']
    if not api_key or not secret:
        sys.exit('Нет ключа сборки. Выпустите его:  python scripts/launcher-test-client.py create-key --admin admin')
    return api_key, secret


def cmd_create_key(args) -> None:
    base = args.base
    json_headers = {'Content-Type': 'application/json'}
    password = getpass.getpass(f'Пароль {args.admin}: ')
    login = http('POST', base + '/auth/login', json.dumps({'login': args.admin, 'password': password}).encode(), json_headers)
    if login.status != 200:
        sys.exit(f'Вход не удался: {login.describe_error()}')
    data = login.json()
    if data.get('challengeToken'):
        code = input('Код 2FA: ').strip()
        login = http('POST', base + '/auth/2fa/verify',
                     json.dumps({'challengeToken': data['challengeToken'], 'code': code}).encode(), json_headers)
        if login.status != 200:
            sys.exit(f'Код 2FA не принят: {login.describe_error()}')
        data = login.json()

    created = http('POST', base + '/auth/api-keys',
                   json.dumps({'name': f'python test client {time.strftime("%Y-%m-%d %H:%M")}'}).encode(),
                   {**json_headers, 'Authorization': f'Bearer {data["accessToken"]}'})
    if created.status != 201:
        if created.code == 'TWO_FACTOR_SETUP_REQUIRED':
            sys.exit('Для выпуска ключа у админа должна быть включена 2FA (Настройки → Безопасность).')
        sys.exit(f'Ключ не выпущен: {created.describe_error()}')
    key = created.json()
    KEY_FILE.write_text(json.dumps({'prefix': key['prefix'], 'signingSecret': key['signingSecret']}), 'utf-8')
    try:
        KEY_FILE.chmod(0o600)
    except OSError:
        pass
    print(f'Ключ сборки выпущен: X-Api-Key {key["prefix"]}. Секрет сохранён в {KEY_FILE} (повторно сервер его не покажет).')


def cmd_run(args) -> None:
    api_key, secret = load_key(args)
    client = Client(args.base, api_key, secret)
    license_key = normalize_license_key(args.license_key or os.environ.get('LP_LICENSE_KEY', ''))
    if not license_key:
        sys.exit('Укажите --license-key (или LP_LICENSE_KEY).')
    product, hwid = args.product, normalize_hwid(args.hwid)
    print(f'Сервер {args.base}, товар {product}, лицензия {mask(license_key)}, диск {hwid}, ключ сборки {api_key}')

    # --- 1. проверка лицензии (Session::Begin) -------------------------------
    if not args.skip_check:
        print('\n[1] license/check — ключ лицензии + Disk ID; первый вызов привязывает диск и запускает срок')
        check = license_check(client, product, hwid, license_key)
        if check.status != 200:
            sys.exit(f'    отказ: {check.describe_error()}')
        print(f'    OK: {json.dumps(check.json(), ensure_ascii=False)}')
    else:
        print('\n[1] license/check пропущен (--skip-check)')

    # --- 2. запрос сборки (Session::FetchPayload) ------------------------------
    print('\n[2] payload — свой sessionKey (32 случайных байта), ключ лицензии и Disk ID ещё раз')
    resp, session_key = request_payload(client, product, hwid, license_key)
    if resp.status == 403 and resp.code in ('LICENSE_NOT_BOUND', 'LICENSE_NOT_ACTIVATED'):
        # Как у загрузчика: одна проверка лицензии и ОДИН повтор.
        print(f'    сервер: {resp.describe_error()}')
        print('    → license/check и один повтор, как делает загрузчик')
        check = license_check(client, product, hwid, license_key)
        if check.status != 200:
            sys.exit(f'    отказ: {check.describe_error()}')
        resp, session_key = request_payload(client, product, hwid, license_key)
    if resp.status != 200:
        sys.exit(f'    отказ: {resp.describe_error()}')
    h = resp.headers
    print(f'    пришло {len(resp.body)} байт шифротекста, версия сборки {h.get("x-payload-version")}')
    print(f'    nonce {h.get("x-payload-nonce")}, tag {h.get("x-payload-tag")}')
    print(f'    ожидаемый SHA-256 открытого файла: {h.get("x-payload-sha256")}')

    # --- 3. проверки и расшифровка (DecodeResponse) -----------------------------
    print('\n[3] проверка заголовков → ключ = HKDF-SHA256(sessionKey, соль = nonce) → AES-256-GCM → SHA-256')
    try:
        plain, meta = decode_payload(resp, session_key, product)
    except ValueError as err:
        sys.exit(f'    отказ: {err}')
    except Exception as err:  # InvalidTag
        sys.exit(f'    не расшифровалось ({type(err).__name__}): данные или заголовки подменены')
    print(f'    расшифровано {len(plain)} байт, тег и SHA-256 совпали (версия {meta["version"]})')
    if plain[:2] == b'MZ':
        print('    первые байты MZ — это исполняемый файл Windows (DLL/EXE)')
    if args.save:
        Path(args.save).write_bytes(plain)
        print(f'    сохранено в {args.save} (настоящий загрузчик держит файл только в запертой памяти)')
    wipe(plain)

    if args.demo:
        demo(client, product, hwid, license_key)


def demo(client: Client, product: str, hwid: str, license_key: str) -> None:
    print('\n[демо] попытки, которые сервер обязан отклонить')

    def attempt(title: str, resp: Response) -> None:
        verdict = 'отклонено' if resp.status >= 400 else 'ПРОПУЩЕНО — так быть не должно'
        print(f'    {title}: {verdict} ({resp.describe_error() if resp.status >= 400 else resp.status})')

    def body(**extra) -> dict:
        return {'productSlug': product, 'hwid': hwid, 'sessionKey': secrets.token_hex(32), 'licenseKey': license_key, **extra}

    attempt('без подписи', client.post('/launcher/payload', body(), sign=False))
    attempt('тело изменено после подписи', client.post('/launcher/payload', body(), tamper_body=True))
    attempt('чужой диск', client.post('/launcher/payload', body(hwid='SOMEONE-ELSE-DISK')))
    attempt('неверный ключ лицензии', client.post('/launcher/payload', body(licenseKey=license_key[:-4] + 'AAAA')))


def main() -> None:
    parser = argparse.ArgumentParser(description='Учебный клиент загрузчика License Platform')
    parser.add_argument('--base', default=os.environ.get('LP_BASE', DEFAULT_BASE), help=f'адрес API (по умолчанию {DEFAULT_BASE})')
    sub = parser.add_subparsers(dest='command', required=True)

    key = sub.add_parser('create-key', help='выпустить ключ сборки (нужен вход админа)')
    key.add_argument('--admin', required=True, help='логин администратора')
    key.set_defaults(func=cmd_create_key)

    run = sub.add_parser('run', help='проверить лицензию и получить сборку')
    run.add_argument('--license-key', help='ключ лицензии (или LP_LICENSE_KEY)')
    run.add_argument('--product', default='fc26', help='код товара')
    run.add_argument('--hwid', default='PY-TEST-DISK-0001', help='Disk ID; первый license/check привяжет к нему лицензию')
    run.add_argument('--api-key', help='X-Api-Key (или LP_API_KEY, или ~/.lp-launcher-test.json)')
    run.add_argument('--api-secret', help='секрет подписи (или LP_API_SECRET)')
    run.add_argument('--save', help='сохранить расшифрованный файл')
    run.add_argument('--skip-check', action='store_true', help='начать с payload, как FetchPayload')
    run.add_argument('--demo', action='store_true', help='показать отказы на подделанных запросах')
    run.set_defaults(func=cmd_run)

    args = parser.parse_args()
    args.base = args.base.rstrip('/')
    args.func(args)


if __name__ == '__main__':
    main()
