# RAG Coding — Code Memory

**Code Memory (CM)** — локальная память кода для агентов. Перед первым шагом агента она кладёт в переписку нужный исходник: найденные функции, их зависимости, короткие файлы целиком и места вызова, сверенные с текущими файлами. Агент правит сразу, не тратя вызовы модели на `glob`, `grep` и `read`.

Внутри: исходники и версии файлов, глоссарий символов и граф вызовов из TypeScript compiler API, локальные векторы MiniLM в LanceDB. Индексируются JavaScript и TypeScript. Всё хранится на машине пользователя.

## Результат

DeepSeek Harness, GPT-6 Luna, шесть задач на проекте Geo Dash, три варианта по два повтора. Три серии по 36 сессий:

| | Без CM | Новый CM |
|---|---:|---:|
| Правильных правок | 35/36 | **36/36** |
| Токены | — | **−45…−66%** |
| Расчётная цена | — | **−30…−47%** |
| Время сессий | — | **−18…−37%** |
| Вызовы read / grep / glob | 34–37 на серию | **0** |

В Codex и Claude Code CM подключается хуком `UserPromptSubmit`: по одной серии из 36 сессий — −42% токенов в Codex (GPT-6 Luna) и −30% в Claude Code (Sonnet 5.5) при том же качестве ([подробно](docs/NATIVE-CLIENTS.md)). Один проект и шесть задач. Подробно: [замеры в Harness](docs/EFFICIENCY-AB.md).

## Документация

| Документ | О чём |
|---|---|
| [Как работает CM](docs/HOW-IT-WORKS.md) | Откуда экономия, путь запроса, маршруты, компоненты кода |
| [Замеры](docs/EFFICIENCY-AB.md) | Методика, все серии и неудачи, кеш провайдера, как повторить |
| [История попыток](docs/HISTORY.md) | Восемь подходов, что не сработало и почему |
| [Установка](docs/INSTALL.md) | Windows-установщик для Harness, Codex и Claude Code |
| [Plugin для Harness](docs/DEEPSEEK-PLUGIN.md) | Ручной запуск Harness с CM |
| [Codex и Claude Code](docs/NATIVE-CLIENTS.md) | Хук авто-контекста, настройка, замеры |
| [MCP](docs/MCP-SETUP.md) | MCP-сервер для Codex и Claude Code |
| [CM Atlas](docs/LOCAL-ATLAS.md) | Локальная карта модулей, символов и связей |

## Быстрый старт

Node.js 24 LTS или 22.19+. Зависимости закреплены в `package-lock.json`.

```bash
npm ci            # в облаке без доступа к nuget: ONNXRUNTIME_NODE_INSTALL=skip npm ci
npm run verify    # сборка, проверка документации, тесты, проба разбора
npm run cm:index  # индекс этого репозитория в .code-memory/index.json
npm run cm:vectors
npm run cm:search -- --query "how are embeddings reused between snapshots"
npm run plugin:smoke   # настоящий ToolRuntime Harness, без вызовов модели
```

В PowerShell для команд с флагами используйте `npm.cmd`. `.artifacts/`, `.code-memory/` и `dist/` игнорируются Git.

## Структура

| Путь | Что там |
|---|---|
| `src/code-memory/` | Индекс, хранилище, векторы, поиск и сборка контекста |
| `src/harness/` | Plugin DeepSeek Harness |
| `src/mcp/`, `src/hooks/` | MCP-сервер и хук авто-контекста для Codex и Claude Code |
| `src/setup/`, `scripts/install_cm.ps1` | Установщик |
| `src/local-agent/`, `apps/local-viewer/` | Локальная служба и карта CM Atlas |
| `scripts/efficiency_ab.ts` | Трёхвариантный A/B в Harness |
| `scripts/native_ab.ts` | A/B в Codex и Claude Code |
| `evaluation/native/` | Данные серий в Codex и Claude Code |
| `evaluation/efficiency/` | Данные всех серий текущего механизма |
| `contracts/cm-local.schema.json` | Схема локального индекса |

[Правила изменений](CONTRIBUTING.md).
