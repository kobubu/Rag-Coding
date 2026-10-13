# Backlog реализации

Представление автоматически собрано из [backlog.json](backlog.json). Изменять задачи следует в JSON и выполнять `npm run backlog` после сборки.

`done` у документационных задач не означает готовность RAG-сервиса. Размер S/M/L обозначает относительную сложность, не срок.

## M00: Документы и диагностический пример

Критерий этапа: Документы связаны, contracts и backlog проверяются, fixture воспроизводится.

### RC-001: Собрать документацию и проверяемый план

Статус: **done**. Приоритет: P0. Размер: M. Зависимости: нет.

Приёмка:

- Навигация, алгоритмы, контракты и backlog согласованы.
- Локальные документационные checks проходят.

Ожидаемые материалы: `README.md`, `docs/`, `plans/`, `contracts/`.

### RC-002: Сделать TypeScript structural probe переносимым

Статус: **done**. Приоритет: P0. Размер: S. Зависимости: RC-001.

Приёмка:

- Собственная TS-fixture анализируется через npm без Python и FlashMT checkout.
- Проверяются exact bytes LF/CRLF/BOM, Unicode mapping, compiler-symbol captures и пределы сценария.

Ожидаемые материалы: `scripts/probe_chunking.ts`, `fixtures/batching.ts`, `tests/tooling.test.ts`.

## M00P: Локальная Code Memory и DeepSeek Harness plugin

Критерий этапа: TS/JS snapshot, четыре инструмента, runtime/packaging и живой A/B pilot проверены; границы prototype опубликованы.

### RC-043: Сделать локальный индекс и bounded retrieval CM

Статус: **done**. Приоритет: P0. Размер: M. Зависимости: RC-002.

Приёмка:

- TS Compiler API строит symbols, function/block units и structural edges без исполнения источника.
- Exact UTF-8 spans, snapshot fingerprints, stale sources, byte budget и graph limits проверены на fixtures и реальном репозитории.
- Local JSON backend явно отделён от будущего PostgreSQL, pgvector и полноценного ContextPackage API.

Ожидаемые материалы: `src/code-memory/`, `contracts/cm-local.schema.json`, `tests/code_memory.test.ts`.

### RC-044: Подключить CM как внешний DeepSeek Harness plugin

Статус: **done**. Приоритет: P0. Размер: M. Зависимости: RC-043.

Приёмка:

- cm_symbol_search, cm_code_search, cm_context_get и cm_graph_expand зарегистрированы через реальный Harness ToolRuntime.
- Dispatch, schema rejection, snapshot mismatch, cancellation и unload проходят на закреплённом API.
- Plugin имеет installable package/bundle, инструкции; runtime proof отделён от последующих live model evals.

Ожидаемые материалы: `src/harness/plugin.ts`, `harness/bundle.yml`, `scripts/smoke_plugin.ts`, `docs/DEEPSEEK-PLUGIN.md`.

### RC-045: Добавить JavaScript и убрать узкие места реального корпуса

Статус: **done**. Приоритет: P0. Размер: M. Зависимости: RC-043.

Приёмка:

- TS/JS interfile scopes и точные UTF-8 spans проверены без исполнения исходников.
- 224-файловый Geo Dash corpus индексируется; результаты до/после оптимизации семантически совпадают.
- Общий writer/reader size limit, immutable cache и проверка текущих source hashes сохраняют границы snapshot.

Ожидаемые материалы: `src/code-memory/`, `tests/code_memory.test.ts`, `docs/AB-RESULTS.md`.

### RC-046: Запустить настоящий Harness A/B и опубликовать полный итог pilot

Статус: **done**. Приоритет: P0. Размер: M. Зависимости: RC-044, RC-045.

Приёмка:

- Одна модель выполняет 28 независимых sessions на семи seeded regressions, по два повтора A/B с фиксированным oracle.
- Provider usage, cache, цена, calls и все failures сохранены; успешность проверяется вне модели.
- Публичный итог не содержит private source и явно указывает отсутствие vector retrieval и неподтверждённую экономию.

Ожидаемые материалы: `scripts/harness_ab.ts`, `scripts/harness_meter.ts`, `docs/HARNESS-AB.md`, `evaluation/geo-dash-pilot/results.json`.

## M00V: Local vector/compact CM и подтверждённый pilot

Критерий этапа: Learned local embeddings, vector storage, compact auto context, CAS observations и новый полный A/B проверены; ограничения опубликованы.

### RC-053: Реализовать local learned embeddings и LanceDB projection

Статус: **done**. Приоритет: P0. Размер: M. Зависимости: RC-045.

Приёмка:

- Pinned MiniLM q8 реально выполняется на CPU; vector queries используют local files only.
- LanceDB хранит 384-dimensional vectors; snapshot/model fencing и embedding reuse проверены.
- Это prototype projection: primary JSON сохранён, SQLite/FTS/ANN не объявлены готовыми.

Ожидаемые материалы: `src/code-memory/vector.ts`, `src/code-memory/vector_cli.ts`, `tests/vector.test.ts`.

### RC-054: Свести CM в compact context с auto admission и FS observations

Статус: **done**. Приоритет: P0. Размер: M. Зависимости: RC-044, RC-053.

Приёмка:

- Один tool объединяет lexical/dense ranking, required declarations, budgets и dedupe.
- Logged source context доходит до первого model call; штатный CAS edit работает после CM observation.
- Dependency activation, disposal и paid-call guard проверены на реальном Harness.

Ожидаемые материалы: `src/code-memory/retrieve.ts`, `src/harness/plugin.ts`, `scripts/harness_meter.ts`.

### RC-055: Подтвердить экономию и качество на новом полном A/B

Статус: **done**. Приоритет: P0. Размер: M. Зависимости: RC-046, RC-054.

Приёмка:

- 32 sessions на восьми заранее выбранных типах задач сохраняют все failures и полный settled provider usage.
- Total tokens и cache-aware price меньше baseline, independent-check success не ниже; время и sampling limits раскрыты.
- Raw private corpus/trace не публикуется; JSON, plot, protocol/source hashes и фактические проверки доступны.

Ожидаемые материалы: `docs/HYBRID-RESULTS.md`, `evaluation/geo-hybrid-pilot/`, `scripts/summarize_hybrid.ts`.

### RC-061: Включить vector default и проверить semantic CLI/установленный Harness bundle

Статус: **done**. Приоритет: P0. Размер: S. Зависимости: RC-054, RC-055.

Приёмка:

- Default plugin/bundle используют compact learned vector search; legacy явно задаётся и исторический benchmark воспроизводится.
- Vector-only cm-search без lexical ranking на реальном corpus и actual installed-profile context dispatch проверены без provider API.
- Query/limit bounds и snapshot/model/policy fences сохранены; manual install и отсутствие нового paid A/B раскрыты.

Ожидаемые материалы: `src/code-memory/search_cli.ts`, `src/harness/plugin.ts`, `harness/bundle.yml`, `docs/VECTOR-SEARCH.md`, `research/evidence/vector-default-smoke-2026-10-13.json`.

## M00Q: Качество оптимизации и дробление CM

Критерий этапа: Полный comparison unit/window/AST/none на реальной оптимизации; behavior/CPU/scopes/usage измерены отдельно, все failures сохранены.

### RC-057: Реализовать policy-fenced unit/window/AST projections

Статус: **done**. Приоритет: P0. Размер: M. Зависимости: RC-054.

Приёмка:

- UTF-8/CRLF windows покрывают source, overlap дедуплицирован без потери тела после signature.
- AST statement groups и compiler-bound declarations/signatures сохраняют scopes; отсутствие полного dataflow раскрыто.
- Snapshot/model/policy/records fencing и default unit compatibility проверены.

Ожидаемые материалы: `src/code-memory/chunks.ts`, `src/code-memory/vector.ts`, `src/code-memory/retrieve.ts`, `tests/chunks.test.ts`.

### RC-058: Добавить behavioral и CPU grader для задач оптимизации

Статус: **done**. Приоритет: P0. Размер: M. Зависимости: RC-055.

Приёмка:

- Одинаковый project_checks позволяет всем agents проверить patch; final geometry/fuzz/callers отдельно.
- Неверная быстрая правка и неизменный source не считаются оптимизацией; loaded module следует current content hash.
- ABBA/BAAB, реальные workloads, stress/build cost, protected scopes и полная usage фиксируются отдельно.

Ожидаемые материалы: `scripts/optimization_checks.ts`, `scripts/project_checks_plugin.ts`, `tests/optimization.test.ts`, `docs/OPTIMIZATION-AB.md`.

### RC-059: Измерить качество и стоимость дробления на реальной оптимизации Geo Dash

Статус: **done**. Приоритет: P0. Размер: M. Зависимости: RC-057, RC-058.

Приёмка:

- 24/24 живых sessions с frozen source, полным usage и независимой behavior/CPU оценкой; все stops и failures учтены.
- Unit/window/AST сравнение, actual caller QA и локальные physics/browser проверки опубликованы; ускорение FPS не заявляется.
- Отрицательная экономия раскрыта; post-study cache fix 0.4.1 не выдан за новый paid A/B. Original Geo JS сохранены.

Ожидаемые материалы: `scripts/optimization_ab.ts`, `docs/OPTIMIZATION-AB.md`, `evaluation/geo-optimization/`, `docs/OPTIMIZATION-RESULTS.md`.

## M01: Зафиксированный корпус и контракты

Критерий этапа: Есть размеченные задачи, способности первого языка и корректные публичные форматы.

### RC-003: Зафиксировать целевой TypeScript-корпус

Статус: **planned**. Приоритет: P0. Размер: S. Зависимости: RC-001.

Приёмка:

- Зафиксированы repo/revision и manifest hashes.
- Список разрешённых источников и coverage воспроизводим.

Ожидаемые материалы: `evaluation/corpus-manifest.json`.

### RC-004: Разметить 40 задач и разделить настройки/holdout

Статус: **planned**. Приоритет: P0. Размер: M. Зависимости: RC-003.

Приёмка:

- 10 задач настройки и 30 отложенных сгруппированы без близких дублей.
- Для задач определены нужные spans, dependencies и rubric.

Ожидаемые материалы: `evaluation/tasks.jsonl`, `evaluation/README.md`.

### RC-005: Заморозить v0.1 контракты и capabilities

Статус: **planned**. Приоритет: P0. Размер: S. Зависимости: RC-003.

Приёмка:

- Snapshot, spans, units, relations и package имеют версии.
- Матрица TypeScript/JS/TSX явно перечисляет unsupported и unresolved случаи.

Ожидаемые материалы: `contracts/`, `docs/capabilities-typescript.md`.

## M02: Снимок, исходники и ledger

Критерий этапа: Снимок стабилен, bytes и версии воспроизводятся, storage восстанавливается.

### RC-006: Реализовать Git и workspace reader

Статус: **planned**. Приоритет: P0. Размер: M. Зависимости: RC-005.

Приёмка:

- Чтение commit и dirty overlay формирует стабильный manifest.
- Concurrent change, delete и выход symlink за корень имеют явный результат.

Ожидаемые материалы: `src/repositories/`.

### RC-007: Сохранить blobs и точную карту координат

Статус: **planned**. Приоритет: P0. Размер: M. Зависимости: RC-006.

Приёмка:

- Roundtrip raw bytes сохраняет Unicode, BOM и CRLF.
- Неподдерживаемая кодировка не получает приблизительных offsets.

Ожидаемые материалы: `src/repositories/blobs.ts`, `tests/source_ranges/`.

### RC-008: Создать SQL ledger и ограничения

Статус: **planned**. Приоритет: P0. Размер: M. Зависимости: RC-005, RC-007.

Приёмка:

- Миграция создаёт принадлежность snapshot и FK/range ограничения.
- Дубли identities и неверные ссылки отклоняются на реальной БД.

Ожидаемые материалы: `src/storage/`, `migrations/`.

### RC-009: Проверить restore и воспроизведение manifest

Статус: **planned**. Приоритет: P0. Размер: M. Зависимости: RC-008.

Приёмка:

- Исходники и обязательные records восстанавливаются из backup.
- Сравниваются manifest/hashes и точное чтение source.

Ожидаемые материалы: `tests/storage_restore/`, `docs/runbooks/restore.md`.

## M03: Глоссарий и иерархия CM

Критерий этапа: Символы и scopes различаются, разбивка exact, окружение вложенного блока установлено.

### RC-010: Реализовать TypeScript/TSX syntax adapter

Статус: **planned**. Приоритет: P0. Размер: M. Зависимости: RC-005, RC-007.

Приёмка:

- Функции, классы, callbacks, decorators и nested scopes имеют exact byte ranges через UTF-16 mapping.
- Syntax error, JS/TSX и unsupported grammar показывают явные capabilities и partial diagnostics.

Ожидаемые материалы: `src/adapters/typescript/`.

### RC-011: Создать сущности и употребления глоссария

Статус: **planned**. Приоритет: P0. Размер: M. Зависимости: RC-008, RC-010.

Приёмка:

- Одноимённые locals различаются по scope.
- Lexical captures, shadowing и import bindings проверены; неизвестный target остаётся null.

Ожидаемые материалы: `src/analysis/symbols.ts`, `tests/symbol_navigation/`.

### RC-012: Построить иерархию CodeUnit

Статус: **planned**. Приоритет: P0. Размер: M. Зависимости: RC-010, RC-011.

Приёмка:

- Контейнеры и callable units имеют родителей и identities.
- Комментарии, headers и decorators не теряются.

Ожидаемые материалы: `src/segmentation/hierarchy.ts`.

### RC-013: Добавить recursive statement grouping и budgets

Статус: **planned**. Приоритет: P0. Размер: L. Зависимости: RC-012.

Приёмка:

- Первичная разбивка восстанавливает bytes без gaps/overlaps.
- Большие конструкции, literals и исключения бюджета имеют явные роли.

Ожидаемые материалы: `src/segmentation/partition.ts`, `tests/chunking/`.

### RC-014: Построить обязательное окружение блоков

Статус: **planned**. Приоритет: P0. Размер: L. Зависимости: RC-011, RC-013.

Приёмка:

- Captures, type references, guards и lifecycle-owner связаны с конкретными ID.
- Object mutation не объявляется отсутствующей из-за отсутствия присваивания переменной.

Ожидаемые материалы: `src/analysis/contextRequirements.ts`.

## M04: Первый полезный поиск и контекст

Критерий этапа: CLI/API проходит путь snapshot → symbol → unit → required context на реальном корпусе.

### RC-015: Создать точный и текстовый поиск

Статус: **planned**. Приоритет: P0. Размер: M. Зависимости: RC-008, RC-013.

Приёмка:

- Символы/пути адресуются в выбранном snapshot.
- Camel/snake tokens дополняют exact identity; parent/child дубли контролируются.

Ожидаемые материалы: `src/storage/textIndex.ts`, `tests/search/`.

### RC-016: Собрать ContextPackage с бюджетом

Статус: **planned**. Приоритет: P0. Размер: L. Зависимости: RC-014, RC-015.

Приёмка:

- Обязательные dependencies включены или явно перечислены в omissions.
- Source spans проверяются, lifecycle не обрезается молча.

Ожидаемые материалы: `src/retrieval/context.ts`.

### RC-017: Ввести TypeScript CLI и Fastify read API

Статус: **planned**. Приоритет: P0. Размер: M. Зависимости: RC-016.

Приёмка:

- Сценарий snapshot → symbol → unit → context проходит через внешний интерфейс.
- Errors, pagination и snapshot mismatch имеют контрактные ответы.
- Внешние JSON payload валидируются runtime-схемой; тяжёлый анализ вынесен из HTTP event loop.

Ожидаемые материалы: `src/interfaces/`, `tests/api_smoke/`.

### RC-018: Сравнить первые варианты дробления на корпусе

Статус: **planned**. Приоритет: P0. Размер: M. Зависимости: RC-004, RC-013, RC-017.

Приёмка:

- A/B/C запускаются на одинаковых задачах и budget.
- Есть per-case результаты, hashes и вывод о выбранном baseline.

Ожидаемые материалы: `evaluation/runs/`, `docs/evaluation-baseline.md`.

## M05: Проектная семантика и обновление

Критерий этапа: Разрешённые cross-file ссылки и обновления имеют capabilities и защиту версий.

### RC-019: Зафиксировать TypeScript project semantic configuration

Статус: **planned**. Приоритет: P1. Размер: M. Зависимости: RC-018.

Приёмка:

- Program/TypeChecker spike проверяет tsconfig paths, project references, imports/re-exports и missing dependencies.
- Стратегия incremental update сопровождается capability matrix и ограничениями.

Ожидаемые материалы: `docs/semantic-spike.md`, `evaluation/semantic-fixtures/`.

### RC-020: Добавить межфайловые типизированные связи

Статус: **planned**. Приоритет: P1. Размер: L. Зависимости: RC-019.

Приёмка:

- References, calls и type links различаются по доказательству.
- Unresolved targets и неоднозначность видны в API.

Ожидаемые материалы: `src/analysis/projectLinks.ts`.

### RC-021: Реализовать частичное обновление и инвалидацию

Статус: **planned**. Приоритет: P1. Размер: L. Зависимости: RC-020.

Приёмка:

- Rename/delete, внешние types и lock/config change инвалидируют нужные результаты.
- Выдача не смешивает предыдущий graph и новые source blobs.

Ожидаемые материалы: `src/analysis/invalidation.ts`, `tests/snapshot_updates/`.

### RC-022: Добавить jobs, outbox, leases и recovery

Статус: **planned**. Приоритет: P1. Размер: L. Зависимости: RC-008, RC-021.

Приёмка:

- Duplicate jobs, expiry и retries проверены на границе worker/БД.
- Late result старого fingerprint не перезаписывает актуальный результат.

Ожидаемые материалы: `src/enrichment/jobs.ts`, `tests/job_recovery/`.

## M06: Гибридный retrieval

Критерий этапа: Измерен вклад embeddings и графа при одинаковом корпусе и бюджете.

### RC-023: Зафиксировать tokenizer и embedding provider

Статус: **planned**. Приоритет: P1. Размер: M. Зависимости: RC-018.

Приёмка:

- Выбранные варианты и бюджет согласованы с целевыми задачами.
- Отдельно проверены model change, no-provider и privacy profile.

Ожидаемые материалы: `docs/embedding-spike.md`, `evaluation/embedding-config.json`.

### RC-024: Создать векторную projection и hybrid ranking

Статус: **planned**. Приоритет: P1. Размер: L. Зависимости: RC-015, RC-022, RC-023.

Приёмка:

- Проекция привязана к generation и source hash.
- Точный snapshot/access filtering и approximate recall проверены.

Ожидаемые материалы: `src/storage/vectorIndex.ts`, `src/retrieval/ranking.ts`.

### RC-025: Измерить вклад context closure и hybrid retrieval

Статус: **planned**. Приоритет: P1. Размер: M. Зависимости: RC-004, RC-020, RC-024.

Приёмка:

- D/E сравниваются с замороженным baseline при одинаковом budget.
- Публикуются dependency recall, task outcome, latency и costs.

Ожидаемые материалы: `evaluation/runs/`, `docs/evaluation-hybrid.md`.

## M07: Enrichment с проверкой

Критерий этапа: Предложения имеют evidence, проходят admission и не перезаписывают другую версию.

### RC-026: Создать bounded enrichment envelope

Статус: **planned**. Приоритет: P1. Размер: M. Зависимости: RC-014, RC-022.

Приёмка:

- Окно содержит известные ID, source spans, guards и только нужное окружение.
- Контракт сообщает insufficient_context и fingerprint.

Ожидаемые материалы: `src/enrichment/envelope.ts`.

### RC-027: Добавить провайдер и структурированные proposals

Статус: **planned**. Приоритет: P1. Размер: M. Зависимости: RC-023, RC-026.

Приёмка:

- Model/prompt версия и token cost сохраняются без секретов.
- Replay и живые вызовы имеют разные evidence статусы.

Ожидаемые материалы: `src/enrichment/providers.ts`.

### RC-028: Реализовать admission и review trail

Статус: **planned**. Приоритет: P1. Размер: L. Зависимости: RC-020, RC-027.

Приёмка:

- Неизвестные IDs, stale evidence и несовместимый predicate отклоняются.
- Кандидат модели не перезаписывает derived binding или review молча.

Ожидаемые материалы: `src/enrichment/admission.ts`, `tests/admission/`.

### RC-029: Оценить точечные объяснения и смысловые связи

Статус: **planned**. Приоритет: P1. Размер: M. Зависимости: RC-004, RC-025, RC-028.

Приёмка:

- Есть ручная rubric происхождения и правильности интерпретации.
- Сравнение фиксирует пользу и регрессии, включая отказы и стоимость.

Ожидаемые материалы: `evaluation/enrichment/`, `docs/evaluation-enrichment.md`.

## M08: Просмотрщик и интеграция

Критерий этапа: Пользователь проходит навигацию и пакет контекста; editor overlay проверен.

### RC-030: Сделать локальный React + TypeScript source и glossary viewer

Статус: **planned**. Приоритет: P1. Размер: L. Зависимости: RC-017.

Приёмка:

- Карточка открывает правильный snapshot, scope и usage.
- Breadcrumbs и exact highlight согласованы с bytes.

Ожидаемые материалы: `viewer/`, `tests/viewer_smoke/`.

### RC-031: Добавить ограниченный graph и context viewer

Статус: **planned**. Приоритет: P1. Размер: L. Зависимости: RC-020, RC-025, RC-030.

Приёмка:

- Каждое ребро открывает evidence, candidate status виден.
- Пакет показывает reasons, omissions и ограничения coverage.

Ожидаемые материалы: `viewer/graph/`, `viewer/context/`.

### RC-032: Поддержать editor buffer и overlay navigation

Статус: **planned**. Приоритет: P1. Размер: M. Зависимости: RC-021, RC-030.

Приёмка:

- Несохранённый buffer проверяется по hash.
- Старые coordinates не применяются к новому тексту, conflict виден.

Ожидаемые материалы: `src/interfaces/editor/`, `tests/editor_overlay/`.

### RC-033: Подключить CM plugin к основному ContextService и assistant adapters

Статус: **planned**. Приоритет: P1. Размер: M. Зависимости: RC-017, RC-031, RC-032, RC-044.

Приёмка:

- Поиск и чтение используют тот же ContextPackage API.
- Нет расширения прав на изменения проекта из retrieved content.
- Локальный JSON backend сменяется общим ContextService без изменения прав и snapshot гарантий.
- Живой model/tool loop и автоматический context hook измерены отдельно от registry smoke.

Ожидаемые материалы: `src/interfaces/assistant/`, `src/harness/`.

## M09: Python, C# и contracts

Критерий этапа: Адаптеры публикуют реальные capabilities; связи слоёв доказуемы.

### RC-034: Реализовать дополнительный Python adapter

Статус: **planned**. Приоритет: P1. Размер: L. Зависимости: RC-013, RC-020.

Приёмка:

- Syntax, scopes, closures и доступная cross-file семантика Python имеют опубликованные capabilities.
- Tree-sitter, native ast/symtable worker или индексатор выбраны по spike; unresolved imports/dynamic attributes остаются явными.

Ожидаемые материалы: `src/adapters/python/`, `docs/capabilities-python.md`.

### RC-035: Реализовать C# adapter

Статус: **planned**. Приоритет: P1. Размер: L. Зависимости: RC-013, RC-020.

Приёмка:

- Partial, generics и overload различаются на уровне symbols.
- Compilation references и неизвестные типы отражаются в coverage.

Ожидаемые материалы: `src/adapters/csharp/`.

### RC-036: Связать API, события и поля contracts

Статус: **planned**. Приоритет: P1. Размер: L. Зависимости: RC-034, RC-035.

Приёмка:

- Mappings имеют evidence из схем, сериализации или registration.
- Сходство названий полей остаётся только candidate при отсутствии evidence.

Ожидаемые материалы: `src/analysis/contracts.ts`.

### RC-037: Оценить многоязычный и составной snapshot

Статус: **planned**. Приоритет: P1. Размер: M. Зависимости: RC-036.

Приёмка:

- Manifest нескольких repo фиксирует конкретные версии.
- Языковые capabilities и contract mismatch проверены на сквозных задачах.

Ожидаемые материалы: `evaluation/multirepo/`, `docs/evaluation-multilanguage.md`.

## M10: Память решений и поставка

Критерий этапа: История решений, ограничения доступа, backup и сквозная приёмка документированы.

### RC-038: Сохранить память принятых решений

Статус: **planned**. Приоритет: P1. Размер: M. Зависимости: RC-028, RC-031.

Приёмка:

- SolutionCase имеет before/after, applicability и проверки точной версии.
- Исторический пример не выдаётся как текущая реализация.

Ожидаемые материалы: `src/domain/solutionCases.ts`.

### RC-039: Оценить повторное использование решений

Статус: **planned**. Приоритет: P1. Размер: M. Зависимости: RC-038.

Приёмка:

- Повторная задача возвращает совместимый принятый пример.
- Несовместимая библиотека или контракт показывает ограничение применения.

Ожидаемые материалы: `evaluation/solution_cases/`.

### RC-040: Ввести командный access scope и cache isolation

Статус: **planned**. Приоритет: P1. Размер: L. Зависимости: RC-022, RC-031.

Приёмка:

- Source, graph, summaries и cache проверяются до выдачи.
- Тесты двух областей доступа исключают перенос частного контекста.

Ожидаемые материалы: `src/security/`, `tests/access_isolation/`.

### RC-041: Подготовить локальную поставку и runbooks

Статус: **planned**. Приоритет: P1. Размер: M. Зависимости: RC-009, RC-031, RC-039.

Приёмка:

- Воспроизводимы install, migration, index, restore и bounded smoke.
- Опубликованы coverage, ограничения и фактические результаты.

Ожидаемые материалы: `docs/runbooks/`, `packaging/`.

### RC-042: Провести сквозную приёмку следующей поставки

Статус: **planned**. Приоритет: P1. Размер: L. Зависимости: RC-029, RC-037, RC-040, RC-041.

Приёмка:

- Реальные сценарии UC-01…UC-08 проверены на точном release SHA.
- Локальные, CI, provider, deployment и acceptance статусы разделены.

Ожидаемые материалы: `evaluation/release-proof.json`, `docs/release-notes.md`.

## M11: Локальный продукт: векторы, MCP и карта концептов

Критерий этапа: Local hybrid retrieval измерен, MCP проверен реальным клиентом, карта ведёт к версиям исходников; installer и entitlement проверены отдельно.

### RC-047: Проверить local SQLite/LanceDB и локальные embeddings

Статус: **planned**. Приоритет: P0. Размер: L. Зависимости: RC-045.

Приёмка:

- Кандидат native storage/embedding stack работает локально на Windows; веса, indexes и source остаются в user data directory.
- Versioned vector projection и add/change/delete/branch refresh проверены; измерены CPU, RAM, disk и cold/warm время.
- Exact/FTS канал и ledger сохраняются; full rebuild не скрывает stale или missing sources.

Ожидаемые материалы: `src/local-storage/`, `src/embeddings/`, `evaluation/local-vector-spike.json`.

### RC-048: Сделать один компактный hybrid retrieve_context и повторить A/B

Статус: **planned**. Приоритет: P0. Размер: L. Зависимости: RC-046, RC-047.

Приёмка:

- Один вызов внутри выполняет exact/FTS/vector merge, rerank, bounded dependencies и dedupe с source references и omissions.
- Новые holdout tasks проверяют итог всей задачи при одинаковых budgets, включая retrieval/enrichment расходы и cache.
- Снижение tokens/cost не заявляется без измерения; качество и cold/warm indexing сообщаются отдельно.

Ожидаемые материалы: `src/retrieval/`, `src/harness/`, `evaluation/hybrid-pilot/`, `docs/AB-RESULTS.md`.

### RC-049: Дать локальному CM настоящий MCP stdio adapter

Статус: **done**. Приоритет: P0. Размер: M. Зависимости: RC-061.

Приёмка:

- Official stdio MCP client и installed Harness 0.2.0-rc.2 Web profile запускают процесс и вызывают тот же learned retrieve core; сторонний desktop UI не заявляется проверенным.
- Output budget, cancellation, snapshot mismatch и один configured project root проверены boundary tests; код не дублируется в structuredContent.
- Remote/localhost bridge требует отдельной конфигурации; cloud login сам по себе не предоставляет доступ к файлам.

Ожидаемые материалы: `src/mcp/`, `docs/MCP-SETUP.md`, `tests/local_agent.test.ts`, `research/evidence/local-cm-mcp-atlas-2026-10-13.json`.

### RC-050: Довести Atlas prototype до карты подтверждённых concepts и unresolved states

Статус: **planned**. Приоритет: P1. Размер: L. Зависимости: RC-047.

Приёмка:

- React/TypeScript viewer раскрывает concepts → functions/classes → exact source spans и glossary.
- Structural facts, similarity и inferred concepts имеют разные types/evidence/status; stale и unresolved состояния видимы.
- Zoom, фильтр связей и поиск проходят реальную интерфейсную проверку на indexed project.

Ожидаемые материалы: `apps/local-viewer/`, `docs/LOCAL-ATLAS.md`, `docs/LOCAL-PRODUCT.md`, `research/evidence/local-cm-mcp-atlas-2026-10-13.json`.

### RC-051: Упаковать локальный агент и проверить update/restore

Статус: **planned**. Приоритет: P1. Размер: L. Зависимости: RC-049, RC-050.

Приёмка:

- Чистая установка Windows, native dependencies и запуск MCP/map проходят на поддерживаемом runtime.
- Update, rollback и export сохраняют source, user indexes и настройки; macOS/Linux проверены перед заявлением поддержки.

Ожидаемые материалы: `packaging/local-agent/`, `docs/runbooks/`, `evaluation/installer-proof.json`.

### RC-052: Проверить cloud account, entitlement и гипотезу подписки $10

Статус: **planned**. Приоритет: P1. Размер: L. Зависимости: RC-051.

Приёмка:

- Login выдаёт signed entitlement; offline grace и отмена подписки не удаляют пользовательские данные и export.
- BYOK или явно ограниченные credits отделены от цены продукта; финансовая модель включает поддержку и выбранные services.
- Hosted deployment и подключение платежей выполняются только в отдельно разрешённой поставке.

Ожидаемые материалы: `apps/account-service/`, `docs/LOCAL-PRODUCT.md`, `evaluation/subscription-pilot.json`.

### RC-056: Улучшить provenance/scope и latency без потери нужных источников

Статус: **planned**. Приоритет: P0. Размер: L. Зависимости: RC-055.

Приёмка:

- First-party, vendor и параллельные модули различаются с явными scopes; known failures не объявляются новым holdout.
- На новых tasks измерены recall/precision и latency; full provider/retrieval costs и failures сохраняются.
- Контекст не расширяет actor permissions; exact/library navigation и snapshot boundaries остаются проверяемыми.

Ожидаемые материалы: `src/retrieval/`, `evaluation/scope-latency-pilot/`, `docs/HYBRID-RESULTS.md`.

### RC-060: Проверить adaptive whole-function retrieval на новом корпусе с caller performance

Статус: **planned**. Приоритет: P0. Размер: M. Зависимости: RC-057, RC-059.

Приёмка:

- Exact path/name и небольшие owners получают whole-function context; большие fragments сохраняют neighbors/scopes и budget.
- Новые holdout задачи используют штатный caller workload; correctness, CPU и цена полезного решения измеряются отдельно.
- Все arms используют один final version, полный provider usage и preserved failures; результат не выбирается по изученным задачам.

Ожидаемые материалы: `docs/OPTIMIZATION-RESULTS.md`, `docs/OPTIMIZATION-AB.md`.

### RC-062: Проверить локальный CM Atlas: modules, glossary и source/evidence navigation

Статус: **done**. Приоритет: P0. Размер: M. Зависимости: RC-061.

Приёмка:

- React/TypeScript viewer через loopback раскрывает inferred topics → module → symbol → current UTF-8 source; read-only scope и stale errors проверены.
- Compiler facts/evidence и semantic candidates различаются; zoom/search/filter/glossary проходят реальную Chrome проверку 1440×1000, 844×390, 390×844.
- Names/path inference, overview edge cap, manual refresh и отсутствие аккаунта/installer раскрыты; UI assets входят в tarball.

Ожидаемые материалы: `src/local-agent/`, `apps/local-viewer/`, `docs/LOCAL-ATLAS.md`, `tests/local_agent.test.ts`, `research/evidence/local-cm-mcp-atlas-2026-10-13.json`.

### RC-063: Добавить opt-in HNSW и сравнить с exact на локальной projection

Статус: **done**. Приоритет: P1. Размер: M. Зависимости: RC-057, RC-061.

Приёмка:

- LanceDB IVF_HNSW_SQ строится из существующих learned vectors без API; declaration/fences/physical index проверены; exact default сохранён.
- 48 queries, k24, пять ABBA/BAAB blocks фиксируют recall и native latency; исходная projection сохранена; безопасные measurements опубликованы.
- Native query gain отделён от embedding/source/context и качества/стоимости LLM; измеренный recall не объявлен универсальной гарантией.

Ожидаемые материалы: `src/code-memory/ann_cli.ts`, `src/code-memory/vector.ts`, `scripts/measure_ann.mjs`, `docs/HNSW.md`, `evaluation/hnsw/results.json`.

### RC-064: Проверить graph/adaptive context routing по всей стоимости и независимому качеству

Статус: **done**. Приоритет: P0. Размер: M. Зависимости: RC-054, RC-055, RC-061.

Приёмка:

- Compiler catalog/routing/dependency closure сохраняют exact source, snapshot, UTF-8 boundaries, omissions и budgets.
- Четыре arms, новые задачи и два повтора; все provider tokens/cache categories, scopes и failures сохранены.
- Default выбирается по качеству и полной цене; отрицательные результаты и ограниченность pilot раскрыты.

Ожидаемые материалы: `src/code-memory/knowledge.ts`, `src/code-memory/graph_retrieve.ts`, `scripts/graph_ab.ts`, `scripts/graph_checks.ts`, `docs/GRAPH-BUDGET.md`, `evaluation/graph-budget/`.

### RC-065: Добавить живое пополнение CM и атомарную публикацию source/graph/vectors

Статус: **done**. Приоритет: P0. Размер: M. Зависимости: RC-054, RC-061, RC-062.

Приёмка:

- Сохранённые edit/add/rename/delete/config/branch определяют новый snapshot; graph/compiler scope и vector fingerprints проверены.
- Watcher, source churn, syntax/embed failure, single-flight cancellation, dead writer recovery и stale snapshots имеют meaningful native regressions.
- На Geo Dash copy learned CPU embeddings, реальный MCP и Chrome подтверждают новые исходники и очистку старого source; local CPU/full rebind/retention limits раскрыты.

Ожидаемые материалы: `src/code-memory/live.ts`, `tests/live_memory.test.ts`, `docs/LIVE-CM.md`, `research/evidence/live-cm-2026-10-14.json`.
