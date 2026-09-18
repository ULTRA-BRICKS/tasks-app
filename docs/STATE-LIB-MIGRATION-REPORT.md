# tasks-app × state-lib — отчёт, 18 сентября 2026

## Ветка и исходная база
Ветка для продолжения: **`feat/state-lib-HYP-1497`**, база **`1d3ac4d21d64e9ba77d4ccd05fdbe436e567f436`**. Исходная `pilot/state-lib-HYP-1464` и её незавершённый merge сохранены без изменений. При переносе проверено побайтовое совпадение **всех 349 tracked files**; затем в новой ветке отдельно исправлена персистентность и обновлены документы. Main и production не меняются.

Новая база убирает из diff уже принятые изменения main: собственный migration diff — около 90 КБ вместо 337 КБ. Это не сокращение проверяемого кода: полный staged index новой ветки проходит отдельный review gate. Доказательство первоначальной эквивалентности: `tasks-candidate-equivalence.json` в каталоге evidence.

## Реально мигрировано
На Runtime/state-lib работает UI preference-store: **view, theme, sidebarOpen, density**. `VITE_STATE_BACKEND=baseline` выбирает исходный Zustand; default — state-lib. Динамически инициализируется ровно одна реализация, а интерфейс компонентов одинаков. Baseline соответствует preference-store из зафиксированного main, включая auto/compact/comfortable density. Навигация/фильтры остаются в URL; TanStack Query продолжает владеть server cache.

## Исправлена потеря будущей версии настроек
Синтетический контрпример показал: version:9 игнорировалась при гидрации, но первый sidebar toggle записывал version:0 и удалял неизвестные поля. Два новых RED-теста воспроизвели проблему. Теперь неизвестная числовая версия **не перезаписывается**, изменения продолжают жить в памяти, а getStorageError сообщает UNSUPPORTED_STORAGE_VERSION. Изменения только transient sidebar больше не записывают неизменившуюся persisted projection. Это улучшение адаптера, не свойство ядра и не обещание общей производительности.

## Проверки на новой рабочей копии
- `bun install --frozen-lockfile`: exit 0. `bun run check`: **192 passed, 0 failed**, 30 unit-файлов; lint, FSD, type-aware checking и production build прошли.
- Preference suite: **9/9 PASS**, включая 1 500 последовательных сравнений с Zustand, совместимость storage, cold subscription, compile-time равенство полного state/action-контракта, ошибки storage, density и новые future-version/projection regressions.
- `bun run test:state-lib:ab`: **6/6 state-lib + 6/6 baseline**, Chromium/WebKit, отдельная synthetic in-memory DB: drafts при навигации, создание issue с properties, настройки, reload, мобильная навигация и одна гидрация store.

Дополнительные input-density browser-сценарии до последнего persistence-only исправления: **12/12 + 12/12**, узкий/широкий desktop, phone/tablet, resize/reload, touch selection. После исправления основной A/B-набор повторно прошёл. Vite предупреждает о крупных chunks; численного ускорения или полной визуальной приёмки всего продукта не заявляется.

## Что не готово
**Inline issue editor/draft-controller на state-lib не создан:** запись этой реализации была отклонена инструментом. Его девять контрактов хранятся только как pending specification: `docs/state-lib-pending/document-controller.contract.ts.txt`, не входят в suite и не считаются пройденными. Уведомление об ошибке persistence ещё не показано в UI; SSR request scopes, normalized entities, server-cache replacement и collaborative undo не реализованы. Версия не является полной миграцией приложения.

Пакет `@ultrabricks/state-lib@0.1.0-pilot.1` совпадает с boards-app по runtime-файлам; dist не редактировался. Provenance честно отмечает uncommitted source candidate. Npm/stable release не выполнялся. Большое review исходного merge также оставило замечания к унаследованному importer/OpenAPI/draft-journal коду main; это отдельные baseline findings, не регрессии нового state-lib diff и не автоматически исправленные задачи.

## Задачи и доказательства
В проекте **state-lib**: **HYP-1497** — закончить реальные app/domain-миграции (In Progress); **HYP-1498** — versioned persistence и storage errors (исправлена защитная часть адаптера, общий контракт и UI-индикация остаются открыты); обе связаны с **HYP-1464**. Четыре ранее отклонённые карточки не создавались повторно. Логи, RED/GREEN, browser results и provenance: `../state-app-migrations-20260918/`. Окончательные commit/push/review и PR фиксируются после фактического завершения.
