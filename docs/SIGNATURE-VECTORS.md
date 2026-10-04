# Контрольные векторы подписи запросов

Сгенерировано из серверной реализации `SignatureService`.
Реализация на C++ обязана давать те же значения байт в байт.

**Секрет для всех примеров:**

```
test-signing-secret-do-not-use-in-production
```

Секрет тестовый. В бою `signingSecret` выдаётся сервером при входе.

---

## Подпись

### GET без тела

| Поле | Значение |
|---|---|
| METHOD | `GET` |
| PATH | `/api/v1/launcher/update` |
| TIMESTAMP | `1785500000` |
| NONCE | `00112233445566778899aabbccddeeff` |
| BODY | _пустое_ |
| SHA256(BODY) | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |

Строка для подписи (символы `\n` показаны явно):

```
GET\n
/api/v1/launcher/update\n
1785500000\n
00112233445566778899aabbccddeeff\n
e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
```

**Подпись:**

```
22316fc88739652bfd4382dfc3313cad7149e9cf5bc016b6156d8ee700eb8f7f
```

### POST с телом JSON

| Поле | Значение |
|---|---|
| METHOD | `POST` |
| PATH | `/api/v1/launcher/license/check` |
| TIMESTAMP | `1785500000` |
| NONCE | `9f86d081884c7d659a2feaa0c55ad015` |
| BODY | `{"productSlug":"fc26","hwid":"WD-WCC4N1234567","clientVersion":"1.4.2"}` |
| SHA256(BODY) | `6e3f9eeccc3cdaa48cb6d78725c3e6eefa733c4264ffeb238f41a667f495f839` |

Строка для подписи (символы `\n` показаны явно):

```
POST\n
/api/v1/launcher/license/check\n
1785500000\n
9f86d081884c7d659a2feaa0c55ad015\n
6e3f9eeccc3cdaa48cb6d78725c3e6eefa733c4264ffeb238f41a667f495f839
```

**Подпись:**

```
a927edc687a79855190435c030b49edf5efc01ee1f24eb78895cabf4ec63afea
```

### POST, метод в нижнем регистре — подпись та же, что для POST

| Поле | Значение |
|---|---|
| METHOD | `post` |
| PATH | `/api/v1/launcher/license/check` |
| TIMESTAMP | `1785500000` |
| NONCE | `9f86d081884c7d659a2feaa0c55ad015` |
| BODY | `{"productSlug":"fc26","hwid":"WD-WCC4N1234567","clientVersion":"1.4.2"}` |
| SHA256(BODY) | `6e3f9eeccc3cdaa48cb6d78725c3e6eefa733c4264ffeb238f41a667f495f839` |

Строка для подписи (символы `\n` показаны явно):

```
POST\n
/api/v1/launcher/license/check\n
1785500000\n
9f86d081884c7d659a2feaa0c55ad015\n
6e3f9eeccc3cdaa48cb6d78725c3e6eefa733c4264ffeb238f41a667f495f839
```

**Подпись:**

```
a927edc687a79855190435c030b49edf5efc01ee1f24eb78895cabf4ec63afea
```

### POST с кириллицей в теле (UTF-8)

| Поле | Значение |
|---|---|
| METHOD | `POST` |
| PATH | `/api/v1/launcher/logs` |
| TIMESTAMP | `1785500000` |
| NONCE | `ffeeddccbbaa99887766554433221100` |
| BODY | `{"kind":"error","summary":"не удалось прочитать Disk ID"}` |
| SHA256(BODY) | `d03a5fb8346030c7c46b8573200d445cecc4f80ed3aebe98cd5e43dd2f25b419` |

Строка для подписи (символы `\n` показаны явно):

```
POST\n
/api/v1/launcher/logs\n
1785500000\n
ffeeddccbbaa99887766554433221100\n
d03a5fb8346030c7c46b8573200d445cecc4f80ed3aebe98cd5e43dd2f25b419
```

**Подпись:**

```
1d0071c63a8fb6e8a773fbac3919ae22ed51d62d009e2c538362052f909aecf8
```

---

## Нормализация Disk ID

Клиент отправляет уже нормализованное значение. Хеш считает сервер,
но нормализация обязана совпадать — иначе одна машина даст разные хеши.

| Что прочитал загрузчик | После нормализации |
|---|---|
| `  wd-wcc4n 1234567 \t` | `WD-WCC4N1234567` |
| `WD-WCC4N1234567` | `WD-WCC4N1234567` |
| `wd-WCC4N1234567` | `WD-WCC4N1234567` |
| `S4EWNX0N123456A` | `S4EWNX0N123456A` |

Правила: убрать пробелы по краям, убрать **все** внутренние
пробельные символы, привести к верхнему регистру.

Первые три строки таблицы — один и тот же диск. Если реализация
даёт для них разные значения, пользователь после обновления драйвера
получит «устройство не совпадает».

---

## Хеш пустого тела

Часто реализуют неверно — подставляют пустую строку вместо её хеша.

```
e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
```