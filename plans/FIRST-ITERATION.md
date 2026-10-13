# Ближайшая итерация: provenance, latency и локальная поставка

## Отправная точка

RC-001/RC-002 и RC-043…RC-046 выполнены: документы, TS/JS CM core, настоящий Harness plugin, 224-file corpus и live model A/B. CM прошёл 14/14 правок против 13/14, но total tokens выросли на 6,2%, расчётная цена — на 2,4%. [Итог и ограничения](../docs/AB-RESULTS.md). Это исходный lexical pilot. После него RC-053…RC-055 реализовали local vectors/compact auto context и подтвердили −69,4% tokens, −56,9% цены, 12/16 против 9/16 на новом наборе; [итог](../docs/HYBRID-RESULTS.md).

Источник статусов — [backlog.json](backlog.json), представление — [BACKLOG](BACKLOG.md). Расширенный M01 corpus, общий ContextPackage и серверный backend не объявляются готовыми по результатам pilot.

## Порядок работы

| Шаг | Задачи | Конкретный результат | Проверка |
|---|---|---|---|
| 1 | RC-047 | SQLite ledger/FTS/graph и LanceDB vector spike, local embedding model | Чистая Windows установка; cold/warm CPU/RAM/disk; exact version и add/change/delete/branch refresh |
| 2 | RC-048 | Один retrieve_context: exact/FTS/vector → rerank → bounded dependencies → dedupe | Компактный source context с omissions; новый holdout A/B учитывает всю стоимость и качество |
| 3 | RC-049 | MCP stdio adapter того же core | Реальный desktop client, budgets, cancellation, roots и stale snapshot |
| 4 | RC-050 | React/TS concept world map | Concept → symbol → exact source; типы/evidence/status связей и stale/unresolved состояния |
| 5 | RC-051 | Local installer, update, rollback и export | User data сохраняются; native dependencies проходят поддерживаемые платформы |
| 6 | RC-052 | Account и signed local entitlement; тарифная гипотеза | Offline grace, отмена без удаления данных; BYOK/credits и отдельная проверка экономики |

Шаги 3/4 можно разрабатывать независимо после своих prerequisites; оба читают тот же versioned CM core. Документ не запускает hosted service, платежи или production release.

## Что измерить до решения о векторах

- Exact identifier search сохраняет definitions/scopes; semantic channel добавляет релевантные candidates на описательные queries.
- Unit embeddings имеют source/model/config fingerprint; similarity edge отличается от доказанного call/reference.
- Один context call возвращает достаточный минимальный набор; дополнительные parents не прикладываются автоматически.
- Поисковые/модельные turns, повторная history, output, cache и enrichment входят в общий task budget.
- Indexing и local retrieval resources измеряются отдельно от LLM usage; cold/warm cache состояния явные.

Отобрать новые задачи до просмотра результатов нового retrieval. Текущие семь типов уже изучены и не являются независимым holdout для настройки следующей версии. Oracle проходит на оригинале и падает на seeded regression. Не удалять failures и sessions с неполным usage.

## Fixtures и version boundaries

Сохранить Unicode/BOM/CRLF, surrogate boundary, nested captures, shadowed locals, interfile TS/JS и CommonJS, syntax diagnostics, oversized index и frozen-cache checks. Добавить по необходимости vector-specific cases: stale projection, model migration, rename/delete, branch switch, недоступные model weights и изоляция проектов.

RC-003…RC-007 остаются путём к более широкому reproducible corpus и общему ledger contract. Private source, prompts, patches и oracle хранятся локально; в Git публикуются reusable runners, безопасные aggregates и собственные fixtures.

## Evidence и приёмка

Сохранить source/model/config hashes, версии runtime/storage, команды, resources, реальные клиентские проверки и все task results. Vector database не считается готовностью RAG; MCP registration не считается проверкой клиента; карта не считается фактом языка без evidence. Установка: `npm ci`, проверки текущего plugin: `npm run verify`.


Приоритет после pilot: RC-056 исправляет selection vendor/параллельных модулей и проверяет latency на новых tasks. Local embedding/LanceDB части RC-047 уже доступны как prototype; SQLite ledger/FTS, watcher, installer и общая capability model ещё не закрыты. RC-048 сохраняет следующий независимый benchmark и общий ContextPackage. MCP/map остаются RC-049/RC-050.
