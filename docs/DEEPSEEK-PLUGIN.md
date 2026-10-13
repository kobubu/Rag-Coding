# CM — Code Memory: плагин DeepSeek Harness

Рабочий локальный prototype v0.2. Он добавляет глоссарий, записи CM, структурные связи и сборку исходного контекста в DeepSeek Harness. Индекс создаётся отдельной CLI-командой на TypeScript Compiler API для TypeScript и JavaScript; код индексируемого проекта не исполняется. Никаких модельных вызовов для индексации не требуется.

## Проверенная совместимость

- Node.js 24 LTS; поддерживаемый дополнительный runtime — Node.js 22 от 22.19.0.
- `@deepseek-ai/dsh-tools` 0.2.0-rc.2 и `@deepseek-ai/cordis` 4.0.4. Версии явно закреплены: `latest` пакета tools сейчас указывает на более старую несовместимую линию.
- Локальный backend `code-memory-0.1`: неизменяемые source blobs внутри JSON snapshot. PostgreSQL/pgvector остаются запланированным storage backend.
- Проверки registry используют настоящие Cordis Context, SystemPrompt и Harness ToolRuntime: schemas, calls, canonical JSON, errors, cancellation и unload. Дополнительно tarball установлен CLI Harness в отдельный профиль: проверены boot Web-профиля и четыре dispatch calls из его реального runtime. Живая модель и пользовательские взаимодействия Web UI проверяются отдельно.

## Сборка и создание CM

Из корня checkout:

```bash
npm ci
npm run build
npm run cm:index
npm run plugin:smoke
```

`cm:index` сохраняет `.code-memory/index.json`, выводит snapshot и размеры индекса. Для другого проекта:

```bash
npm run cm:index -- --project /absolute/project --out /absolute/project/.code-memory/index.json
```

В PowerShell команда с передачей флагов: `npm.cmd run cm:index -- --project 'D:/project' --out 'D:/project/.code-memory/index.json'`. Требуется пересборка CM после изменения, удаления или добавления исходников. Индекс содержит выбранный TS/JS corpus; полнота относительно всех возможных файлов проекта не заявляется.

В corpus входят `.ts`, `.tsx`, `.mts`, `.cts`, `.js`, `.jsx`, `.mjs`, `.cjs`; исключены dependency/build/artifact directories, declaration files и symlinks. Максимум 500 файлов и 8 MiB исходных bytes; writer и reader принимают JSON index до 128 MiB. На Geo Dash 3,56 MB source дали 69,99 MB derived JSON, поэтому прежний лимит 16 MiB не позволял прочитать полный индекс. Некорректный UTF-8 отклоняется; syntax/semantic diagnostics доступны как признак частичного анализа. Один экземпляр plugin привязан к одному настроенному projectRoot; командная access model остаётся этапом плана.

## Подключение в Harness

Пакет называется `dsh-plugin-code-memory`, имеет manifest `dsh.bundle.patch = harness/bundle.yml` и экспортирует Cordis plugin `apply/inject`. Он собирается и устанавливается из локального tarball; публикация npm не требуется.

```bash
npm pack --pack-destination .artifacts
```

В Harness Plugin Manager установить полученный локальный `dsh-plugin-code-memory-0.2.0.tgz` как bundle и включить его в нужном профиле. Использовать Harness 0.2.0-rc.2. Bundle добавляет entry `code-memory`; существующие model/file tools остаются в профиле.

CLI-вариант после установки Harness:

```bash
dsh --profile code-memory --from-default-profile web --dump-config
dsh plugin --profile code-memory add /absolute/dsh-plugin-code-memory-0.2.0.tgz
dsh --profile code-memory --no-open
```

Для локальной разработки при изменении tarball использовать новый version/filename или обновление dependency: pnpm может сохранить прежнее содержимое при повторном `add` той же версии по тому же file path. Корректность подключения проверять по composed profile, а не только install exit code. Новый bundle использует `insert`, поскольку обычный patch по `id` меняет уже существующий entry.

Настройки плагина:

| Поле | Значение |
|---|---|
| `projectRoot` | Абсолютный корень индексируемого проекта; по умолчанию `CM_PROJECT_ROOT` или cwd Harness |
| `indexPath` | Путь JSON index, абсолютный либо относительно projectRoot; по умолчанию `CM_INDEX_PATH` или `.code-memory/index.json` |

Для source checkout можно подключить собранный entry отдельным patch, задав абсолютный путь к `dist/src/harness/plugin.js`:

```yaml
- insert:
    - id: code-memory
      name: /absolute/Rag-Coding/dist/src/harness/plugin.js
      config:
        projectRoot: /absolute/project
        indexPath: .code-memory/index.json
```

Patch используется стандартным `dsh --profile web --patch /absolute/code-memory.patch.yml`. На Windows в YAML допустимы пути `D:/...`; проектные пути задаёт пользователь в конфигурации, модель не выбирает произвольный root/indexPath.

## Инструменты

| Tool | Вход | Результат |
|---|---|---|
| `cm_symbol_search` | query, optional limit/snapshot_id | Symbols с qualified names, declarations, owner units и source spans |
| `cm_code_search` | query, optional limit/snapshot_id | Функции/методы с exact-name и lexical-source ranking; previews |
| `cm_context_get` | id, snapshot_id, optional max_bytes | Exact source, lexical parents, необходимые declarations, bytes_used и omissions |
| `cm_graph_expand` | id, snapshot_id, optional depth/max_nodes/predicate | Узлы и evidence edges: contains/references/calls/captures |

Обычный путь: искать функцию через `cm_code_search` → сохранить `snapshot_id` и `matches[].id` → получить context и раскрыть graph. Symbol ID также подходит для context/graph. Все ответы маркированы CM — Code Memory и содержат snapshot, capabilities и limits.

Пределы: 50 search results, context до 65536 UTF-8 bytes, graph depth 1–3, до 100 nodes / 200 edges. Source slices сохраняются целиком; слишком большой обязательный источник попадает в omissions. Parent/child context дедуплицируется. Это byte budget; токенизация и vector ranking ещё не реализованы. `completeness=partial` отражает отсутствие полного dataflow анализа.

## Версии и отказы

Плагин проверяет schema, manifest fingerprint, hashes, диапазоны, identities, родителей и концы graph edges. Перед выдачей проверяются hashes известных исходных файлов и root tsconfig/package/lock inputs относительно projectRoot. Если source или известный analysis input изменился/удалён — `index_outdated`; другой snapshot — `snapshot_mismatch`; отсутствующий index — `index_not_ready`. После добавления новых файлов/inputs тоже нужно перестроить CM: corpus остаётся явно выбранным manifest. Нужно повторить поиск и использовать новый snapshot.

Reader повторно проверяет digest JSON и реальные source hashes при запросе. Неизменённый JSON использует уже валидированный frozen object, без повторного parse/validation; cache не отменяет проверку исходников. Отмена проходит через `exec.signal` в файловое чтение. Cordis disposal удаляет регистрации инструментов. Данные CM остаются в отдельном локальном файле; unload не уничтожает индекс. Плагин не регистрирует операций правки проекта, запуска shell или сетевых модельных вызовов.

## Проверка и следующие этапы

`npm test` проверяет реальные bindings/captures, cross-file calls, shadowed locals, UTF-8/BOM/CRLF, JS modules, frozen cache, бюджеты, повреждённые данные, outdated snapshots/config и runtime lifecycle. Harness `bundlePatchFiles/composeEntries` проверяют distribution entry через production consumer API. `npm run plugin:smoke` индексирует этот checkout и делает четыре dispatch calls через Harness ToolRuntime, затем проверяет unload. Проверены также CLI install/composition/boot и установленный bundle в полном Web-профиле. Для живого provider/tool loop добавлен [A/B protocol](HARNESS-AB.md): GPT-6 Luna управляет настоящим Harness headless на отдельных копиях Geo Dash.

Продолжение: 40-задачный corpus и оценка retrieval, полноценный recursive segmenter/dataflow, PostgreSQL ledger и pgvector, подключение к ContextService, live model loop, автоматический context hook и специализированные UI cards. [Backlog](../plans/BACKLOG.md) различает завершённый prototype и эти запланированные этапы.
