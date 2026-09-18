# state-lib: текущий статус интеграции

Исторический loader/preferences-only пилот расширен. Актуальная архитектура, измерения и ограничения: [STATE-LIB-EVALUATION.md](./STATE-LIB-EVALUATION.md). Сводка — [STATE-LIB-EVALUATION.json](./STATE-LIB-EVALUATION.json); реальные созданные задачи — [STATE-LIB-EVALUATION-TASKS.json](./STATE-LIB-EVALUATION-TASKS.json).

Boards подключает document-store к редактированию, переносу, истории и смене workspace. Tasks подключает Runtime controller к inline issue editor и typed persistence status к Settings/cross-tab events. Сохраняются исходные реализации для A/B-сравнения. TanStack Query, серверные API/auth/CAS и локальные UI-состояния вне описанного контура не заменяются.

Это не normalized physical store, не distributed Undo, не Wasm/worker implementation и не стабильный npm-релиз. В последней Tasks unit-suite остаётся HYP-1499:210 pass/1 fail, поэтому полная приёмка не пройдена. Нельзя отключать красный test или автоматически вливать/deploy эту ветку.

Подробная история прежних этапов сохранена в Git. Новые исследования HYP-1500/1501/1502 основаны на фактическом замедлении controller edit, отсутствии UI speedup и росте app glue; HYP-1499 — конкретное незакрытое исправление, не исследовательское обещание.
