# Первый деплой tickets-app: Vercel + Neon

Проверено 10 сентября 2026 года. Эта инструкция и скрипт настройки не означают, что production уже опубликован.

## Что уже есть и что нужно сделать один раз

В репозитории есть `vercel.json`, Bun-сборка, серверный адаптер и `.github/workflows/deploy.yml`. Workflow требует успешный CI для точного коммита `main`, проверяет версии миграций и только после этого публикует приложение.

Подключённая Vercel-команда: `team_uZF73oVZtW9ADjSLBDsAy5DW`. При последней проверке проекта `tickets-app` в ней ещё не было. Прямой инструмент деплоя вернул ошибку контракта аргументов; переподключение GitHub эту ошибку не исправляет. Vercel CLI — независимый путь публикации.

Neon-проект: `autumn-brook-27632436`. Production-ветка: `br-sparkling-morning-b1bs7tl5`; development: `br-little-shape-b18w3vo1`. Не подключайте production-приложение к development и не запускайте на production демо-наполнение. Миграции и создание владельца ниже — явные операции записи, не часть обычной сборки.

## 1. Открыть репозиторий локально

Нужны Git, Bun 1.4.2 и GitHub CLI (`gh`). Установка GitHub CLI: https://cli.github.com/ . Команды ниже выполняются из корня репозитория. Для существующего checkout используйте свою обычную процедуру обновления, не перезаписывая незакоммиченные изменения.

```sh
git clone https://git.hyperide.ai/ultrabricks/tickets-app.git
cd tickets-app
bun install --frozen-lockfile
gh auth login
bun x --bun vercel@59.11.7 login
```

В браузерной авторизации выберите свои GitHub и Vercel аккаунты. Не передавайте токены в чат и не вставляйте их в команды как аргументы.

## 2. Создать и привязать Vercel-проект без деплоя

```sh
bun x --bun vercel@59.11.7 link
```

Выберите нужную команду, для нового проекта ответьте, что существующего проекта нет, назовите его `tickets-app`, укажите корень `./`. Если проект уже создан, привяжите именно его. Не выбирайте соседний проект. Конфигурация приложения: Vite, `bun run build`, каталог `dist`; она уже описана в `vercel.json`.

Команда создаёт локальную привязку `.vercel/project.json`. В ней `orgId` — это `VERCEL_ORG_ID`, а `projectId` — `VERCEL_PROJECT_ID`. Сам файл игнорируется Git. Команда `link` не является публикацией приложения.

Здесь используется GitHub Actions как единственный автоматический production-publisher. Не подключайте параллельно автоматический production-деплой через Vercel Git Integration: он создаст второй независимый путь публикации. Если проект уже импортирован через Git, сначала согласуйте один путь; отключение Git Integration не удаляет репозиторий.

## 3. Дать GitHub Actions доступ к Vercel

Откройте https://vercel.com/account/tokens . Создайте токен с понятным названием, например `tickets-app-deploy`, выберите ту же команду в Scope и ограниченный срок действия. Сохраните его в менеджере паролей; запланируйте замену до истечения срока.

В корне репозитория:

```sh
bun scripts/configure-deploy.mjs
bun scripts/configure-deploy.mjs --apply
```

Первая команда показывает только локальный план без сетевых запросов. Вторая проверяет GitHub CLI, читает существующие имена настроек, добавляет недостающие ID в **repository Variables** и вызывает скрытый интерактивный ввод `gh secret set` для `VERCEL_TOKEN`, если такого секрета ещё нет.

Скрипт не печатает токен и не передаёт его аргументом, не перезаписывает несовпадающие ID, не меняет существующий токен и останавливается, если секрет с ID может перекрыть новую переменную. Привязка сверяется с указанной выше командой и, когда присутствует, именем проекта; реальная валидность Vercel-токена проверится только при обращении workflow к Vercel. При частичном сбое выполните команду повторно после исправления доступа.

Ручной эквивалент в GitHub → repository **Settings → Secrets and variables → Actions**:

| Где | Имя | Откуда значение |
| --- | --- | --- |
| Secrets → New repository secret | `VERCEL_TOKEN` | Только что созданный Vercel token |
| Variables → New repository variable | `VERCEL_ORG_ID` | `orgId` из `.vercel/project.json` |
| Variables → New repository variable | `VERCEL_PROJECT_ID` | `projectId` из `.vercel/project.json` |

Эти три значения нужны workflow, не браузеру и не серверу приложения. Не кладите их в исходники или переменные `VITE_*`. `GITHUB_TOKEN` workflow получает автоматически — вручную создавать его для этого деплоя не нужно. Секреты именно repository-level: первый preflight-job не привязан к environment `production`.

## 4. Получить две строки подключения Neon

Откройте https://console.neon.tech/ , проект `autumn-brook-27632436`, кнопку **Connect**. Выберите ветку **production**, базу **tickets** и роль владельца этой базы для начальной настройки.

С включённым **Connection pooling** скопируйте строку в `DATABASE_URL`; с выключенным — в `DATABASE_URL_UNPOOLED` для миграций. Обе строки должны указывать на одну production-ветку и одну базу. Не выбирайте `neondb` по умолчанию, если приложение использует `tickets`. Сохраняйте параметры SSL и кодирование пароля из готовой строки; не отключайте TLS-проверку ради успешного соединения.

Строки подключения содержат пароль. Для дальнейшего ограничения прав можно отдельно завести runtime-роль; не меняйте существующую роль и пароль без проверки подключений.

## 5. Подготовить приватные настройки и владельца

Создайте новый локальный файл с секретом; команда откажется перезаписывать уже существующий файл:

```sh
bun -e 'import {writeFileSync} from "node:fs"; import {randomBytes} from "node:crypto"; writeFileSync(".env.production.local", "NODE_ENV=production\nAUTH_SECRET=" + randomBytes(32).toString("hex") + "\nAPP_URL=\nDATABASE_URL=\nDATABASE_URL_UNPOOLED=\nBOOTSTRAP_EMAIL=\nBOOTSTRAP_NAME=\nBOOTSTRAP_PASSWORD=\nWORKSPACE_NAME=My workspace\nWORKSPACE_SLUG=my-workspace\n", {flag:"wx",mode:0o600}); console.log("Created private .env.production.local; no secrets printed.")'
git check-ignore .env.production.local
```

Откройте файл в локальном редакторе. Вставьте обе строки Neon. Укажите собственные email, имя, новый пароль владельца (не менее 12 символов, предпочтительно сгенерированный менеджером паролей), название workspace и slug латиницей в нижнем регистре. Для значений с пробелами/спецсимволами используйте корректные кавычки dotenv.

`APP_URL` возьмите из **Vercel → tickets-app → Settings → Domains**: это фактический постоянный HTTPS-origin проекта, без пути и query-параметров. Не угадывайте, свободен ли `tickets-app.vercel.app`. Если домен ещё не назначен, настройте/подтвердите его перед публикацией.

В Vercel → tickets-app → **Settings → Environment Variables** добавьте для **Production**:

| Имя | Значение |
| --- | --- |
| `DATABASE_URL` | Pooled production-строка Neon |
| `AUTH_SECRET` | Сгенерированное значение из приватного файла |
| `APP_URL` | Тот же фактический HTTPS-origin |
| `NODE_ENV` | `production` |

Не загружайте файл целиком: `BOOTSTRAP_PASSWORD` и остальные `BOOTSTRAP_*` не должны попасть в Vercel runtime. Direct URL для миграций достаточно оставить локально; текущий deployment-workflow не выполняет миграции. Не копируйте production-секреты в Preview/Development.

Проверьте ветку/базу в строках ещё раз. Для непустой базы сначала проверьте миграции и возможность восстановления. Затем явно примените миграции и один раз создайте владельца:

```sh
bun --env-file=.env.production.local scripts/db.mjs migrate
bun --env-file=.env.production.local scripts/db.mjs bootstrap
```

Bootstrap отказывается работать, если владелец уже создан. При `ALREADY_INITIALIZED` не очищайте базу и не запускайте демо: используйте существующий аккаунт. Сохраните пароль в менеджере паролей и удалите `BOOTSTRAP_PASSWORD` из локального файла после успешной настройки.

## 6. Запустить публикацию

Убедитесь, что именно текущий push-коммит `main` имеет успешный CI. Ручной запуск workflow CI не заменяет это условие в существующем preflight. Если основной коммит изменился, дождитесь его проверок.

В GitHub → **Actions → Deploy to Vercel → Run workflow → main**, либо:

```sh
gh workflow run deploy.yml --ref main --repo alex-mextner/tickets-app
```

При настроенных protections для environment `production` подтвердите deployment в GitHub. Не снимайте protections ради обхода отказа. При обычных следующих push в main публикация запускается автоматически после успешного CI. Первый запуск без настроек мог завершиться ошибкой — после конфигурации нужен новый запуск.

Workflow не исправляет отсутствующие миграции сам: он остановится с указанием применить их. При успехе deployment URL появится в summary; затем выполняется health-check канонического `APP_URL`.

## 7. Проверить, что это приложение, а не просто успешная сборка

Откройте реальный домен, войдите своим владельцем, создайте тестовую задачу, перезагрузите страницу и убедитесь, что изменение сохранилось. `/api/health` должен отвечать `{"status":"ok",...}`. Проверьте отсутствие ошибок в Vercel runtime logs и отклонение неавторизованных запросов к приватному API. Успех health-check сам по себе не подтверждает авторизацию, хранение файлов или работу интеграций.

Приватные файлы — отдельная настройка. Для S3/R2 нужны `STORAGE_DRIVER=s3`, `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` из `.env.example`. На Vercel нельзя использовать `STORAGE_DRIVER=local` как долговременное хранилище. Пока bucket не настроен, проверяйте текстовые задачи и отключите Attachments в настройках workspace; не считайте загрузки готовыми. GitHub/Slack credentials самого приложения также не наследуются от ассистента или deployment-token.

## Публикация без GitHub при сбое сервиса

После локальной Vercel-авторизации, настройки Production env и базы, на проверенном исходном коммите можно выполнить:

```sh
bun run check
bun run typecheck:tsc
bun x --bun vercel@59.11.7 pull --yes --environment=production
bun x --bun vercel@59.11.7 build --prod
bun x --bun vercel@59.11.7 deploy --prebuilt --prod
```

Это явный ручной production-деплой через текущую CLI-авторизацию, без Git integration и GitHub secrets. Он не наследует CI-gate автоматически: до него должны быть проверены исходники, браузерные сценарии и схема базы. Не публикуйте непроверенные локальные правки. Проверьте логин/сохранение после публикации так же, как в основном пути.

## Границы автоматизации в этой итерации

`scripts/configure-deploy.mjs` и его 16 тестов проверены локально на Bun; внешние вызовы в тестах подставные. Реальная запись GitHub secrets/variables этим скриптом здесь не выполнялась. Скрипт не создаёт Vercel-проект, не читает/пишет runtime env, не мигрирует, не создаёт владельца, не вращает токены и не запускает деплой. Это намеренно отдельные, проверяемые действия. Токены, пользовательские пароли и реальные connection strings в репозиторий не добавлялись.

## Источники

- Vercel link: https://vercel.com/docs/cli/link
- Vercel CLI и авторизация: https://vercel.com/docs/cli
- Vercel REST API access tokens: https://vercel.com/docs/rest-api
- GitHub secret set (локальное шифрование/интерактивный ввод): https://cli.github.com/manual/gh_secret_set
- GitHub variables: https://cli.github.com/manual/gh_variable_set
- Neon Connect (официальная документация): https://neon.com/docs/guides/ferretdb
- Neon pooling: https://neon.com/blog/postgres-support-case-recap
- Репозиторий: `.github/workflows/deploy.yml`, `scripts/db.mjs`, `.env.example` и `vercel.json`.
