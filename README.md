# RAG Coding

База знаний для разработки: **сущности — в глоссарии, код — в CM (Code Memory), зависимости — в графе**. CM хранит точные версии исходников и записи функций/блоков. Поиск собирает контекст нужной детализации и привязывает его к snapshot проекта.

Состояние на 13 октября 2026 года: работают локальный TS/JS CM prototype и внешний **DeepSeek Harness plugin**; выполнен живой A/B на Geo Dash. CM прошёл 14/14 правок против 13/14 без CM, но потратил на 6,2% больше токенов и на 2,4% больше по расчётной цене. [Результаты и ограничения](docs/AB-RESULTS.md). Vector retrieval, MCP, карта концептов и подписка пока запланированы.

Основной язык — **TypeScript**, среда выполнения — **Node.js 24 LTS**. Индексируются TypeScript и JavaScript. Агентская оболочка — DeepSeek Harness с нашим plugin; CM core остаётся независимым. Prototype использует локальный JSON snapshot. Для desktop предлагаются SQLite ledger/graph и LanceDB vectors; PostgreSQL/pgvector остаются вариантом командного сервера. Подробнее — [архитектура](docs/ARCHITECTURE.md) и [локальный продукт](docs/LOCAL-PRODUCT.md).

## С чего читать

1. [Запуск CM plugin](docs/DEEPSEEK-PLUGIN.md) — индекс, пакет, подключение и четыре инструмента.
2. [Концепт продукта](CONCEPT.md) — назначение глоссария, CM и графа, пример из FlashMT.
3. [Подробный план](plans/ROADMAP.md) — этапы, зависимости и критерии перехода.
4. [Первая итерация](plans/FIRST-ITERATION.md) — развитие prototype и проверка качества.
5. [Полный backlog](plans/BACKLOG.md) — задачи и ожидаемые результаты; [JSON](plans/backlog.json) является источником этого представления.
6. [Навигация по документации](docs/README.md) — архитектура, контракты, алгоритмы и эксплуатация.
7. [Живое A/B сравнение](docs/HARNESS-AB.md) — настоящие модели, одинаковые задачи, provider tokens и независимые проверки.
8. [Локальный CM-продукт](docs/LOCAL-PRODUCT.md) — MCP, карта концептов и модель подписки.

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
