# RAG Coding

База знаний для разработки: **сущности — в глоссарии, код — в CM (Code Memory), зависимости — в графе**. CM хранит точные версии исходников и записи функций/блоков. Поиск собирает контекст нужной детализации и привязывает его к snapshot проекта.

Состояние на 14 октября 2026 года: работают TS/JS CM, локальные learned embeddings/LanceDB, **DeepSeek Harness plugin**, **MCP stdio** и **CM Atlas** — локальная карта модулей, символов и связей. В 0.6.0 добавлены opt-in [живое обновление CM](docs/LIVE-CM.md) и [graph/adaptive context routing](docs/GRAPH-BUDGET.md). На Geo Dash copy saved edit/add/rename/delete, реальные MCP/Chrome и incremental embedding reuse проверены; полный compiler rebind пока остаётся. В 0.5.0 optional [HNSW](docs/HNSW.md) ускорил native vector stage на 7503 rows в 3,12–3,37× при recall@24 100% и 99,91% в двух построениях48queries; exact остаётся default. Installer, cloud account и подписка запланированы.

[Pilot на исправлениях](docs/HYBRID-RESULTS.md), 32 sessions: −69,4% tokens, −56,9% расчётной цены, 12/16 правильных правок против 9/16; latency выросла, failures сохранены. [Pilot оптимизации](docs/OPTIMIZATION-RESULTS.md), 24 sessions: экономия и прирост числа полезных решений не подтвердились; actual caller почти не ускорился. Эти разные результаты сохранены без обещания универсальной экономии.

Основной язык — **TypeScript**, среда выполнения — **Node.js 24 LTS**. Индексируются TypeScript и JavaScript. Агентская оболочка — DeepSeek Harness с нашим plugin; CM core остаётся независимым. Source/graph пока хранятся в JSON, vectors — в локальной LanceDB. SQLite ledger/graph и PostgreSQL/pgvector team server запланированы. Подробнее — [архитектура](docs/ARCHITECTURE.md) и [локальный продукт](docs/LOCAL-PRODUCT.md).

С 0.4.2 [локальный векторный поиск](docs/VECTOR-SEARCH.md) включён по умолчанию в Harness bundle; `cm-search --mode vector` позволяет отдельно проверить dense ranking без lexical. Новая [0.6.0 series](docs/GRAPH-BUDGET.md), 48 sessions: graph12/12 против baseline10/12, −51,6% tokens и −42,5% расчётной цены; к существующему hybrid −20,2% и −15,3%. Все failures сохранены; graph latency выросла. Это шесть repair типов одного проекта, не whole-game performance benchmark. Default hybrid сохранён, graph/adaptive включаются явно.

В0.6.1 [HNSW model A/B](docs/HNSW-MODEL-AB.md),36 sessions на прежних repair tasks: graph+exact12/12 и graph+ann12/12, none9/12. К none exact−54,1% tokens/−44,9% estimate price, ann−58,5%/−50,1%. Все12 initial contexts exact/ann совпали; их расход различался из-за разных model trajectories, причинная ANN token экономия не доказана. Новые22 neighbor queries: native3,37×/recall99,62%, два misses; ann sessions на2,73% дольше exact. Exact остаётся vector default; compatibility default retrieval policy — hybrid.

## С чего читать

1. [Запуск CM plugin](docs/DEEPSEEK-PLUGIN.md) — индекс, пакет, подключение и четыре инструмента.
2. [Концепт продукта](CONCEPT.md) — назначение глоссария, CM и графа, пример из FlashMT.
3. [Подробный план](plans/ROADMAP.md) — этапы, зависимости и критерии перехода.
4. [Первая итерация](plans/FIRST-ITERATION.md) — развитие prototype и проверка качества.
5. [Полный backlog](plans/BACKLOG.md) — задачи и ожидаемые результаты; [JSON](plans/backlog.json) является источником этого представления.
6. [Навигация по документации](docs/README.md) — архитектура, контракты, алгоритмы и эксплуатация.
7. [Живое A/B сравнение](docs/HARNESS-AB.md) — настоящие модели, одинаковые задачи, provider tokens и независимые проверки.
8. [Локальный CM-продукт](docs/LOCAL-PRODUCT.md) — MCP, карта концептов и модель подписки.
9. [Второй A/B: local vectors и compact CM](docs/HYBRID-RESULTS.md) — подтверждённая в pilot экономия и все failures.
10. [Качество оптимизации и варианты дробления](docs/OPTIMIZATION-AB.md) — независимые behavioral/CPU проверки и unit/window/AST projections.
11. [Итог оптимизационного сравнения](docs/OPTIMIZATION-RESULTS.md) — все 24 runs, токены, target/caller CPU и причины дополнительного расхода.
12. [Векторный поиск: запуск и проверка](docs/VECTOR-SEARCH.md) — локальная модель, база, CLI и стандартное подключение Harness.
13. [MCP: подключение](docs/MCP-SETUP.md) — stdio, tools, snapshot и budgets; фактическая проверка в Harness.
14. [CM Atlas](docs/LOCAL-ATLAS.md) — запуск карты, glossary, source и evidence navigation.
15. [HNSW](docs/HNSW.md) — параметры, exact/ANN comparison и ограничения измерения.
16. [Как CM пополняется и обновляется](docs/LIVE-CM.md) — source manifests, compiler facts, embedding reuse, публикация и свежий поиск.
17. [Граф и бюджет контекста](docs/GRAPH-BUDGET.md) — routing, дозированное раскрытие и полный модельный эксперимент.
18. [HNSW на полной модельной задаче](docs/HNSW-MODEL-AB.md) — exact/ANN/none, независимый patch grader, полный расход и время sessions.

## Основная схема

```mermaid
flowchart LR
    R[Снимок репозитория] --> S[Структура и символы]
    S --> T[Иерархические записи CM]
    S --> G[Глоссарий]
    T --> E[Enrichment с доказательствами]
    G --> E
    E --> L[Граф связей]
    T --> Q[Поиск и сбор контекста]
    L --> Q
    Q --> U[Разработчик или ИИ-помощник]
```

Запись CM может быть функцией или небольшим блоком. Для понимания вложенного блока поиск получает определения внешних переменных, условия и нужные родительские конструкции. Исходный текст, описания модели и подтверждённые инженерные решения имеют разное происхождение.

## Что можно проверить сейчас

Рекомендуется Node.js 24 LTS; поддерживается Node.js 22 от 22.19.0 для совместимости с выбранным Harness API. Зависимости закреплены в `package-lock.json`. Python для основных проверок и плагина не требуется.

```bash
npm ci
npm run verify
npm run cm:index
npm run plugin:smoke
```

`verify` выполняет сборку, документационные и структурные проверки, регрессии CM и diagnostic CLI. `cm:index` создаёт `.code-memory/index.json` для этого checkout. `plugin:smoke` делает четыре настоящих dispatch calls через Harness ToolRuntime и проверяет unload; внешняя модель не вызывается. `.artifacts/`, `.code-memory/` и `dist/` игнорируются Git. Установка bundle и конфигурация — в [инструкции плагина](docs/DEEPSEEK-PLUGIN.md).

Отдельные команды после `npm run build`: `npm run check`, `npm test`, `npm run probe -- --fixture --output .artifacts/probe.json`. Обновление представления backlog: `npm run backlog`; проверка актуальности: `npm run backlog -- --check`.

В PowerShell для команд с передачей флагов использовать `npm.cmd`, например `npm.cmd run backlog -- --check` и `npm.cmd run probe -- --fixture --output .artifacts/probe.json`. Это сохраняет аргументы подкоманды при использовании Windows npm shim. Основная команда `npm run verify` флагов не требует; CI выполняет команды в Bash на обеих ОС.

Для повторения исследования Python-исходников FlashMT сохранён необязательный отдельный инструмент. Только ему нужны Python 3.11 и локальный checkout:

```powershell
py -3.11 scripts/probe_flashmt_chunking.py --source-root 'D:\models\Portal Services'
```

Он требует указанный checkout и только читает три файла. [Исследование FlashMT](research/FLASHMT-ENRICHMENT.md) описывает точную исходную версию, ограничения и [сохранённые метаданные проверки](research/evidence/flashmt-chunking-probe-2026-10-13.json). Исходный код FlashMT в этот репозиторий не включён.

[Правила изменения материалов](CONTRIBUTING.md) и [источники технических решений](docs/SOURCES.md).
