# Backlog реализации

Представление автоматически собрано из [backlog.json](backlog.json). Изменять задачи следует в JSON и выполнять `python scripts/render_backlog.py`.

`done` у документационных задач не означает готовность RAG-сервиса. Размер S/M/L обозначает относительную сложность, не срок.

## M00: Документы и диагностический пример

Критерий этапа: Документы связаны, contracts и backlog проверяются, fixture воспроизводится.

### RC-001: Собрать документацию и проверяемый план

Статус: **done**. Приоритет: P0. Размер: M. Зависимости: нет.

Приёмка:

- Навигация, алгоритмы, контракты и backlog согласованы.
- Локальные документационные checks проходят.

Ожидаемые материалы: `README.md`, `docs/`, `plans/`, `contracts/`.

### RC-002: Сделать структурный probe переносимым

Статус: **done**. Приоритет: P0. Размер: S. Зависимости: RC-001.

Приёмка:

- Собственная fixture выполняется без FlashMT checkout.
- Проверяются exact bytes, closure и пределы сценария.

Ожидаемые материалы: `scripts/probe_flashmt_chunking.py`, `fixtures/batching.py`.

## M01: Зафиксированный корпус и контракты

Критерий этапа: Есть размеченные задачи, способности первого языка и корректные публичные форматы.

### RC-003: Зафиксировать целевой Python-корпус

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
- Матрица Python явно перечисляет unsupported и unresolved случаи.

Ожидаемые материалы: `contracts/`, `docs/capabilities-python.md`.

## M02: Снимок, исходники и ledger

Критерий этапа: Снимок стабилен, bytes и версии воспроизводятся, storage восстанавливается.

### RC-006: Реализовать Git и workspace reader

Статус: **planned**. Приоритет: P0. Размер: M. Зависимости: RC-005.

Приёмка:

- Чтение commit и dirty overlay формирует стабильный manifest.
- Concurrent change, delete и выход symlink за корень имеют явный результат.

Ожидаемые материалы: `src/rag_coding/repositories/`.

### RC-007: Сохранить blobs и точную карту координат

Статус: **planned**. Приоритет: P0. Размер: M. Зависимости: RC-006.

Приёмка:

- Roundtrip raw bytes сохраняет Unicode, BOM и CRLF.
- Неподдерживаемая кодировка не получает приблизительных offsets.

Ожидаемые материалы: `src/rag_coding/repositories/blobs.py`, `tests/source_ranges/`.

### RC-008: Создать SQL ledger и ограничения

Статус: **planned**. Приоритет: P0. Размер: M. Зависимости: RC-005, RC-007.

Приёмка:

- Миграция создаёт принадлежность snapshot и FK/range ограничения.
- Дубли identities и неверные ссылки отклоняются на реальной БД.

Ожидаемые материалы: `src/rag_coding/storage/`, `migrations/`.

### RC-009: Проверить restore и воспроизведение manifest

Статус: **planned**. Приоритет: P0. Размер: M. Зависимости: RC-008.

Приёмка:

- Исходники и обязательные records восстанавливаются из backup.
- Сравниваются manifest/hashes и точное чтение source.

Ожидаемые материалы: `tests/storage_restore/`, `docs/runbooks/restore.md`.

## M03: Глоссарий и иерархия ТМ

Критерий этапа: Символы и scopes различаются, разбивка exact, окружение вложенного блока установлено.

### RC-010: Реализовать Python syntax adapter

Статус: **planned**. Приоритет: P0. Размер: M. Зависимости: RC-005, RC-007.

Приёмка:

- Функции, классы, decorators и nested scopes имеют exact ranges.
- Syntax error и unsupported grammar показывают partial diagnostics.

Ожидаемые материалы: `src/rag_coding/adapters/python/`.

### RC-011: Создать сущности и употребления глоссария

Статус: **planned**. Приоритет: P0. Размер: M. Зависимости: RC-008, RC-010.

Приёмка:

- Одноимённые locals различаются по scope.
- Free/nonlocal/global bindings проверены; неизвестный target остаётся null.

Ожидаемые материалы: `src/rag_coding/analysis/symbols.py`, `tests/symbol_navigation/`.

### RC-012: Построить иерархию CodeUnit

Статус: **planned**. Приоритет: P0. Размер: M. Зависимости: RC-010, RC-011.

Приёмка:

- Контейнеры и callable units имеют родителей и identities.
- Комментарии, headers и decorators не теряются.

Ожидаемые материалы: `src/rag_coding/segmentation/hierarchy.py`.

### RC-013: Добавить recursive statement grouping и budgets

Статус: **planned**. Приоритет: P0. Размер: L. Зависимости: RC-012.

Приёмка:

- Первичная разбивка восстанавливает bytes без gaps/overlaps.
- Большие конструкции, literals и исключения бюджета имеют явные роли.

Ожидаемые материалы: `src/rag_coding/segmentation/partition.py`, `tests/chunking/`.

### RC-014: Построить обязательное окружение блоков

Статус: **planned**. Приоритет: P0. Размер: L. Зависимости: RC-011, RC-013.

Приёмка:

- Captures, type references, guards и lifecycle-owner связаны с конкретными ID.
- Object mutation не объявляется отсутствующей из-за отсутствия Name assignment.

Ожидаемые материалы: `src/rag_coding/analysis/context_requirements.py`.

## M04: Первый полезный поиск и контекст

Критерий этапа: CLI/API проходит путь snapshot → symbol → unit → required context на реальном корпусе.

### RC-015: Создать точный и текстовый поиск

Статус: **planned**. Приоритет: P0. Размер: M. Зависимости: RC-008, RC-013.

Приёмка:

- Символы/пути адресуются в выбранном snapshot.
- Camel/snake tokens дополняют exact identity; parent/child дубли контролируются.

Ожидаемые материалы: `src/rag_coding/storage/text_index.py`, `tests/search/`.

### RC-016: Собрать ContextPackage с бюджетом

Статус: **planned**. Приоритет: P0. Размер: L. Зависимости: RC-014, RC-015.

Приёмка:

- Обязательные dependencies включены или явно перечислены в omissions.
- Source spans проверяются, lifecycle не обрезается молча.

Ожидаемые материалы: `src/rag_coding/retrieval/context.py`.

### RC-017: Ввести минимальные CLI и read API

Статус: **planned**. Приоритет: P0. Размер: M. Зависимости: RC-016.

Приёмка:

- Сценарий snapshot → symbol → unit → context проходит через внешний интерфейс.
- Errors, pagination и snapshot mismatch имеют контрактные ответы.

Ожидаемые материалы: `src/rag_coding/interfaces/`, `tests/api_smoke/`.

### RC-018: Сравнить первые варианты дробления на корпусе

Статус: **planned**. Приоритет: P0. Размер: M. Зависимости: RC-004, RC-013, RC-017.

Приёмка:

- A/B/C запускаются на одинаковых задачах и budget.
- Есть per-case результаты, hashes и вывод о выбранном baseline.

Ожидаемые материалы: `evaluation/runs/`, `docs/evaluation-baseline.md`.

## M05: Проектная семантика и обновление

Критерий этапа: Разрешённые cross-file ссылки и обновления имеют capabilities и защиту версий.

### RC-019: Выбрать Python cross-file semantic backend

Статус: **planned**. Приоритет: P1. Размер: M. Зависимости: RC-018.

Приёмка:

- Spike проверяет imports, re-exports, missing dependencies и dynamic attributes.
- Выбор сопровождается capability matrix и ограничениями.

Ожидаемые материалы: `docs/semantic-spike.md`, `evaluation/semantic-fixtures/`.

### RC-020: Добавить межфайловые типизированные связи

Статус: **planned**. Приоритет: P1. Размер: L. Зависимости: RC-019.

Приёмка:

- References, calls и type links различаются по доказательству.
- Unresolved targets и неоднозначность видны в API.

Ожидаемые материалы: `src/rag_coding/analysis/project_links.py`.

### RC-021: Реализовать частичное обновление и инвалидацию

Статус: **planned**. Приоритет: P1. Размер: L. Зависимости: RC-020.

Приёмка:

- Rename/delete, внешние types и lock/config change инвалидируют нужные результаты.
- Выдача не смешивает предыдущий graph и новые source blobs.

Ожидаемые материалы: `src/rag_coding/analysis/invalidation.py`, `tests/snapshot_updates/`.

### RC-022: Добавить jobs, outbox, leases и recovery

Статус: **planned**. Приоритет: P1. Размер: L. Зависимости: RC-008, RC-021.

Приёмка:

- Duplicate jobs, expiry и retries проверены на границе worker/БД.
- Late result старого fingerprint не перезаписывает актуальный результат.

Ожидаемые материалы: `src/rag_coding/enrichment/jobs.py`, `tests/job_recovery/`.

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

Ожидаемые материалы: `src/rag_coding/storage/vector_index.py`, `src/rag_coding/retrieval/ranking.py`.

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

Ожидаемые материалы: `src/rag_coding/enrichment/envelope.py`.

### RC-027: Добавить провайдер и структурированные proposals

Статус: **planned**. Приоритет: P1. Размер: M. Зависимости: RC-023, RC-026.

Приёмка:

- Model/prompt версия и token cost сохраняются без секретов.
- Replay и живые вызовы имеют разные evidence статусы.

Ожидаемые материалы: `src/rag_coding/enrichment/providers.py`.

### RC-028: Реализовать admission и review trail

Статус: **planned**. Приоритет: P1. Размер: L. Зависимости: RC-020, RC-027.

Приёмка:

- Неизвестные IDs, stale evidence и несовместимый predicate отклоняются.
- Кандидат модели не перезаписывает derived binding или review молча.

Ожидаемые материалы: `src/rag_coding/enrichment/admission.py`, `tests/admission/`.

### RC-029: Оценить точечные объяснения и смысловые связи

Статус: **planned**. Приоритет: P1. Размер: M. Зависимости: RC-004, RC-025, RC-028.

Приёмка:

- Есть ручная rubric происхождения и правильности интерпретации.
- Сравнение фиксирует пользу и регрессии, включая отказы и стоимость.

Ожидаемые материалы: `evaluation/enrichment/`, `docs/evaluation-enrichment.md`.

## M08: Просмотрщик и интеграция

Критерий этапа: Пользователь проходит навигацию и пакет контекста; editor overlay проверен.

### RC-030: Сделать локальный source и glossary viewer

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

Ожидаемые материалы: `src/rag_coding/interfaces/editor/`, `tests/editor_overlay/`.

### RC-033: Создать read-only adapter для помощников

Статус: **planned**. Приоритет: P1. Размер: M. Зависимости: RC-017, RC-031, RC-032.

Приёмка:

- Поиск и чтение используют тот же ContextPackage API.
- Нет расширения прав на изменения проекта из retrieved content.

Ожидаемые материалы: `src/rag_coding/interfaces/assistant/`.

## M09: TypeScript, C# и contracts

Критерий этапа: Адаптеры публикуют реальные capabilities; связи слоёв доказуемы.

### RC-034: Реализовать TypeScript/TSX adapter

Статус: **planned**. Приоритет: P1. Размер: L. Зависимости: RC-013, RC-020.

Приёмка:

- Symbol identity, overload, callbacks и JSX имеют опубликованные capabilities.
- Fixtures и реальные tsconfig/dependencies проходят навигационный smoke.

Ожидаемые материалы: `src/rag_coding/adapters/typescript/`.

### RC-035: Реализовать C# adapter

Статус: **planned**. Приоритет: P1. Размер: L. Зависимости: RC-013, RC-020.

Приёмка:

- Partial, generics и overload различаются на уровне symbols.
- Compilation references и неизвестные типы отражаются в coverage.

Ожидаемые материалы: `src/rag_coding/adapters/csharp/`.

### RC-036: Связать API, события и поля contracts

Статус: **planned**. Приоритет: P1. Размер: L. Зависимости: RC-034, RC-035.

Приёмка:

- Mappings имеют evidence из схем, сериализации или registration.
- Сходство названий полей остаётся только candidate при отсутствии evidence.

Ожидаемые материалы: `src/rag_coding/analysis/contracts.py`.

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

Ожидаемые материалы: `src/rag_coding/domain/solution_cases.py`.

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

Ожидаемые материалы: `src/rag_coding/security/`, `tests/access_isolation/`.

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
