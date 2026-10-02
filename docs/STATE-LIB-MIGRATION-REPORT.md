# tasks-app × state-lib — отчёт, 18 сентября 2026

## Ветка и сравнение
Изолированная ветка `pilot/state-lib-HYP-1464`. Начальный HEAD: `39e21e98b7fad75f66f382b0db6d4e1f31e35e30`; для этого прохода в неё вносится актуальный `origin/main` (`1d3ac4d`). Production и dirty worktree `~/xp/tasks-app` не изменяются.

Реально мигрирован UI preference-store: view, theme, sidebarOpen и теперь density. Default — state-lib; запуск с `VITE_STATE_BACKEND=baseline` выбирает Zustand. Динамически инициализируется ровно одна реализация. `baseline.ts` обновлён до точного содержимого `origin/main:src/features/preferences/index.ts`, поэтому сравнение учитывает свежую настройку плотности.

## Изменения и совместимость
Сохранены `tickets-ui`, envelope `{state:{view,theme,density},version:0}`, неперсистентный sidebar и default density `auto`. `compact`/`comfortable` сохраняются и восстанавливаются; неизвестное значение не принимается. Разрешён конфликт при переносе main без потери новой функциональности.

TanStack Query, URL filters, серверные API/авторизация и исходный inline editor не заменены. **Новый state-lib controller редактора не создан:** инструмент отклонил его запись. Девять подготовленных контрактов сохранены отдельно в `docs/state-lib-pending/document-controller.contract.ts.txt`; они НЕ входят в исполняемую suite и НЕ считаются пройденными.

## TDD и полные проверки
Новая проверка density сначала дала RED: ожидалось comfortable, получено undefined. После исправления **5 preference tests PASS**, в том числе **1 500 последовательных обновлений** против актуального Zustand-контракта и проверка storage failure/future version.

`bun run check`: **exit 0**. Полная unit-suite: **188 passed, 0 failed**, 30 файлов. Source lint, FSD, type-aware type checking и production build прошли. Предупреждение Vite о крупных chunks осталось; это не ошибка state-lib и не доказательство деградации/ускорения.

Одинаковый browser-набор выполнен при `VITE_STATE_BACKEND=state-lib` и `baseline`: **6/6 + 6/6 PASS**, Chromium и WebKit. Сценарии: непубличный draft переживает навигацию; создание issue сохраняет estimate/dates; view/theme, reload, одна hydration preference-store и мобильная навигация. Использованы отдельная синтетическая in-memory DB и локальные порты 6262/6263. Реальные пользовательские данные не использовались.

Дополнительно agent-browser открыл state-lib сервер: непустая форма входа, нет Vite overlay, screenshot сохранён. Отдельная попытка такой же дополнительной проверки baseline была отклонена; независимо уже запущенный Playwright baseline завершился успешно.

## Пакет, ограничения и задачи
Private `@ultrabricks/state-lib@0.1.0-pilot.1` остаётся одним и тем же vendored артефактом обоих пилотов. `PROVENANCE.json` отмечает `sourceIsUncommittedCandidate=true`: это не опубликованный npm/stable релиз. Vendor dist не редактировался.

В tasks-app создан проект `state-lib` (`57a446dc-14e2-4959-9a67-2000dc6d1d4b`) и **HYP-1497**, дочерняя к **HYP-1464**. Задача фиксирует незавершённые app/domain-интеграции. Попытка создать ещё четыре задачи была отклонена; они НЕ зарегистрированы. Рекомендуемые направления: normalized immutable store/structural sharing; patch history и remote-safe undo; React lifecycle scopes; воспроизводимая package provenance.

Это проверенная ограниченная версия приложения на state-lib, а не полная замена всех хранилищ или доказанное преимущество производительности. Финальные SHA/push/review записываются отдельным checkpoint после завершения соответствующих действий. Логи: `../state-app-migrations-20260918/`.

## Сравнение скриншотов и артефакта
После текущих browser-прогонов сравнены 4 пары tasks-app (board/mobile × Chromium/WebKit): **0 отличающихся пикселей** во всех парах. В boards-app ещё 4 пары дали тот же результат. Это локальная A/B-эквивалентность указанных сцен, не общая оценка дизайна или всего поведения. `screenshot-comparison.json` хранится в evidence directory.

`index.js`, `core.js`, `latest-task.js`, `external-store.js` побайтно совпадают в двух приложениях. HYP-1464 теперь тоже относится к новому проекту state-lib; его описание и статус сохранены.

## Исправления после предварительного ревью
Добавлены compile-time equality полного state/action-контракта через Zustand getState, regression холодной подписки и отсутствия записи при no-op, CSR-only комментарий и форматирование Oxfmt. Storage errors остаются диагностикой адаптера; отдельного UI-banner в этом пилоте нет, как и у baseline.

Новая команда `bun run test:state-lib:ab` запускает оба backend, каждый на собственной синтетической in-memory DB, принудительно с local APP_URL; порты по умолчанию 6362/6363. Runner обрабатывает сигналы только для своего дочернего процесса. Команда реально выполнена: **6/6 + 6/6 PASS**. Повторный полный `bun run check`: **190 passed, 0 failed**, lint/types/build exit 0. Это актуальные показатели, заменяющие первоначальные 188 тестов выше.

Предварительное review-cli завершено; подтверждённых функциональных ошибок в preference-store не найдено. Полный staged-index review выполняется отдельно для обычного commit gate; ручные markers/stamps не создаются.
