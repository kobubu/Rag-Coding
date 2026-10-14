# CM — Code Memory: плагин DeepSeek Harness

Рабочий локальный prototype v0.6.1: компактный vector/context режим по умолчанию, optional legacy tools, graph/adaptive retrieval и live update. Он добавляет глоссарий, записи CM, структурные связи и сборку исходного контекста в DeepSeek Harness. Primary index создаётся на TypeScript Compiler API для TypeScript и JavaScript, vector projection — локальной embedding-моделью. Код индексируемого проекта не исполняется, внешний LLM API для индексирования не требуется. [Живая CM](LIVE-CM.md), [граф и экономия](GRAPH-BUDGET.md), [полный HNSW A/B](HNSW-MODEL-AB.md).

## Проверенная совместимость

- Node.js 24 LTS; поддерживаемый дополнительный runtime — Node.js 22 от 22.19.0.
- `@deepseek-ai/dsh-tools` 0.2.0-rc.2 и `@deepseek-ai/cordis` 4.0.4. Версии явно закреплены для проверенного runtime API.
- Локальный backend `code-memory-0.1`: неизменяемые source blobs внутри JSON snapshot. PostgreSQL/pgvector остаются запланированным storage backend.
- Проверки registry используют настоящие Cordis Context, SystemPrompt и Harness ToolRuntime: schemas, calls, canonical JSON, errors, cancellation и unload. Legacy CLI installation проверялась ранее; 0.4.2 извлечён из tarball в отдельный full Web profile с local dependency junctions, actual vector/context dispatch PASS. Это manual offline installation, не проверка one-command pnpm installer. Живая модель измерялась в предыдущих A/B. В 0.5.0 отдельно проверены MCP client полного Web profile и реальная Chrome навигация CM Atlas; новых paid model calls нет.

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

В PowerShell команда с передачей флагов: `npm.cmd run cm:index -- --project 'D:/project' --out 'D:/project/.code-memory/index.json'`. Ручной snapshot требует пересборки после изменения, удаления или добавления исходников. Для живой работы compact config включает `autoUpdate: true`: [поколения CM](LIVE-CM.md) создаёт локальный процесс. Индекс содержит выбранный TS/JS corpus; полнота относительно всех возможных файлов проекта не заявляется.

В corpus входят `.ts`, `.tsx`, `.mts`, `.cts`, `.js`, `.jsx`, `.mjs`, `.cjs`; исключены dependency/build/artifact directories, declaration files и symlinks. Максимум 500 файлов и 8 MiB исходных bytes; writer и reader принимают JSON index до 128 MiB. На Geo Dash 3,56 MB source дали 69,99 MB derived JSON, поэтому прежний лимит 16 MiB не позволял прочитать полный индекс. Некорректный UTF-8 отклоняется; syntax/semantic diagnostics доступны как признак частичного анализа. Один экземпляр plugin привязан к одному настроенному projectRoot; командная access model остаётся этапом плана.

## Подключение в Harness

Пакет называется `dsh-plugin-code-memory`, имеет manifest `dsh.bundle.patch = harness/bundle.yml` и экспортирует Cordis plugin `apply/inject`. Он собирается и устанавливается из локального tarball; публикация npm не требуется.

```bash
npm pack --pack-destination .artifacts
```

В Harness Plugin Manager установить полученный локальный `dsh-plugin-code-memory-0.6.1.tgz` как bundle и включить его в нужном профиле. Использовать Harness 0.2.0-rc.2. Bundle добавляет entry `code-memory` с compact vector mode и auto context; существующие model/file tools остаются в профиле. Для этого режима нужны подготовленные primary index, vectors и локальная модель; live builds могут подготовить новый source/vector snapshot при наличии локальной модели.

CLI-вариант после установки Harness:

```bash
dsh --profile code-memory --from-default-profile web --dump-config
dsh plugin --profile code-memory add /absolute/dsh-plugin-code-memory-0.6.1.tgz
dsh --profile code-memory --no-open
```

Для локальной разработки при изменении tarball использовать новый version/filename или обновление dependency: pnpm может сохранить прежнее содержимое при повторном `add` той же версии по тому же file path. Корректность подключения проверять по composed profile, а не только install exit code. Новый bundle использует `insert`, поскольку обычный patch по `id` меняет уже существующий entry.

В 0.4 compact mode допускает `chunking: unit | window | ast` (default `unit`). Projection policy должна совпадать с config; после обновления с 0.3 требуется rebuild vectors. [Варианты дробления и протокол качества](OPTIMIZATION-AB.md) объясняют размеры, scope enrichment и приёмку оптимизации. Это experimental choices; default не меняется по экономии tokens без behavioral/CPU evidence.

Настройки плагина:

| Поле | Значение |
|---|---|
| `projectRoot` | Абсолютный корень индексируемого проекта; по умолчанию `CM_PROJECT_ROOT` или cwd Harness |
| `indexPath` | Путь JSON index, абсолютный либо относительно projectRoot; по умолчанию `CM_INDEX_PATH` или `.code-memory/index.json` |
| `mode` | `compact` по умолчанию с 0.4.2; `legacy` явно включает прежние четыре lexical/graph tools |
| `autoContext` | true по умолчанию в bundle и source plugin; false отключает автоматическую подачу |
| `retrievalPolicy` | С 0.7.0 `adaptive` default: маленький самостоятельный named file читается прямо; прочие anchors используют graph, discovery — local vectors. `hybrid` / `graph` включаются явно |
| `autoUpdate` | true в bundle с 0.7.0; source API default false. Обновляет сохранённые TS/JS source, graph и vectors перед следующим обращением через атомарные поколения |
| `backgroundUpdate` | false в Harness по умолчанию; true включает прежний секундный watcher. Atlas/local-agent сохраняет собственный фоновый watcher |
| `memoryDirectory` / `embeddingCache` | Live generations и необязательный reusable embedding cache; default `.code-memory/live` |
| `sourceScope` | Необязательное относительное дерево live source, например `game`; пути вне projectRoot запрещены |
| `searchMode` | `exact` по умолчанию; `ann` требует HNSW projection и сохраняет source/model/policy fences |
| `vectorsPath` / `modelCache` | По умолчанию `.code-memory/vectors` / `.code-memory/models` относительно projectRoot |

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

## Legacy-инструменты

Эта таблица относится к `config.mode: legacy`; default vector tool — `cm_retrieve_context`, описанный ниже. [Векторный поиск и отдельный CLI](VECTOR-SEARCH.md) включены в актуальный пакет.

| Tool | Вход | Результат |
|---|---|---|
| `cm_symbol_search` | query, optional limit/snapshot_id | Symbols с qualified names, declarations, owner units и source spans |
| `cm_code_search` | query, optional limit/snapshot_id | Функции/методы с exact-name и lexical-source ranking; previews |
| `cm_context_get` | id, snapshot_id, optional max_bytes | Exact source, lexical parents, необходимые declarations, bytes_used и omissions |
| `cm_graph_expand` | id, snapshot_id, optional depth/max_nodes/predicate | Узлы и evidence edges: contains/references/calls/captures |

Обычный путь: искать функцию через `cm_code_search` → сохранить `snapshot_id` и `matches[].id` → получить context и раскрыть graph. Symbol ID также подходит для context/graph. Все ответы маркированы CM — Code Memory и содержат snapshot, capabilities и limits.

Пределы: 50 search results, context до 65536 UTF-8 bytes, graph depth 1–3, до 100 nodes / 200 edges. Source slices сохраняются целиком; слишком большой обязательный источник попадает в omissions. Parent/child context дедуплицируется. Это byte budget. Legacy tools используют lexical ranking; dense hybrid retrieval доступен в отдельном compact режиме ниже. `completeness=partial` отражает отсутствие полного dataflow анализа.

## Версии и отказы

Плагин проверяет schema, manifest fingerprint, hashes, диапазоны, identities, родителей и концы graph edges. Перед выдачей проверяются hashes известных исходных файлов и root tsconfig/package/lock inputs относительно projectRoot. Если source или известный analysis input изменился/удалён — `index_outdated`; другой snapshot — `snapshot_mismatch`; отсутствующий index — `index_not_ready`. После добавления новых файлов/inputs тоже нужно перестроить CM: corpus остаётся явно выбранным manifest. Нужно повторить поиск и использовать новый snapshot.

Reader повторно проверяет digest JSON и реальные source hashes при запросе. Неизменённый JSON использует уже валидированный frozen object, без повторного parse/validation; cache не отменяет проверку исходников. Отмена проходит через `exec.signal` в файловое чтение. Cordis disposal удаляет регистрации инструментов. Данные CM остаются в отдельном локальном файле; unload не уничтожает индекс. Плагин не регистрирует операций правки проекта, запуска shell или сетевых модельных вызовов.

## Проверка и следующие этапы

`npm test` проверяет реальные bindings/captures, cross-file calls, shadowed locals, UTF-8/BOM/CRLF, JS modules, frozen cache, бюджеты, повреждённые данные, outdated snapshots/config и runtime lifecycle. Harness `bundlePatchFiles/composeEntries` проверяют distribution entry через production consumer API. `npm run plugin:smoke` индексирует этот checkout и делает четыре dispatch calls через Harness ToolRuntime, затем проверяет unload. Проверены также CLI install/composition/boot и установленный bundle в полном Web-профиле. Для живого provider/tool loop добавлен [A/B protocol](HARNESS-AB.md): GPT-6 Luna управляет настоящим Harness headless на отдельных копиях Geo Dash.

Продолжение: 40-задачный corpus и оценка retrieval, полноценный recursive segmenter/dataflow, SQLite/PostgreSQL ledger, indexed FTS, общий ContextService, provenance/scope, latency и полноценное concept enrichment. MCP stdio и CM Atlas prototype уже доступны в 0.5.0; см. [MCP](MCP-SETUP.md) и [viewer](LOCAL-ATLAS.md). Live loop и auto context уже проверены в compact prototype. [Backlog](../plans/BACKLOG.md) различает завершённый prototype и эти запланированные этапы.

## Compact vector/context режим

С 0.4.2 это стандартный режим plugin и installable bundle. Старые four-tool клиенты указывают `mode: legacy` явно. Сначала создать primary CM, затем локальные vectors:

```powershell
npm.cmd run cm:index -- --project 'D:/project'
npm.cmd run cm:vectors -- 'D:/project' 'D:/CM-model-cache'
npm.cmd run cm:search -- --project 'D:/project' --model-cache 'D:/CM-model-cache' --query 'remaining daily reward allowance' --mode vector
```

Первая vector-команда скачивает pinned ONNX model/tokenizer; inference выполняется на CPU. Query работает с local files only. Индекс хранит model/config fingerprint и source snapshot. CLI входит в tarball как `cm-vector-index`. Vector cache/project data исключать из Git.

```yaml
- insert:
    - id: code-memory
      name: /absolute/Rag-Coding/dist/src/harness/plugin.js
      config:
        projectRoot: /absolute/project
        mode: compact
        autoContext: true
        modelCache: /absolute/CM-model-cache
        maxContextBytes: 6000
```

`vectorsPath` по умолчанию `.code-memory/vectors`; paths задаёт владелец профиля. `cm_retrieve_context(query, max_bytes?)` соединяет exact/lexical/dense retrieval, dependencies и dedupe. Auto context вводится в logged producer message до первого model call. Source reads передают штатные observations с CAS version; permissions обычного edit сохраняются. Изменённый primary snapshot/model даёт vectors_outdated и требует rebuild. Add/delete/branch и automatic watcher ещё не реализованы.

Для compact fiber объявлены tools/systemPrompt/fs dependencies; basic legacy runtime может работать без FS service. `diagnosticsPath` опционально сохраняет только события, paths и размеры без prompts/code/credentials. Число CM tool calls может быть нулевым при действующем auto context; A/B meter проверяет actual model-visible context отдельно.

Текущий stack: Transformers.js 4.3.1, LanceDB 0.40.0, pinned MiniLM q8, 384 dimensions. Exact cosine search остаётся default. С 0.5.0 optional [IVF_HNSW_SQ](HNSW.md) включается через `searchMode: ann` после построения ANN projection; PostgreSQL, SQLite и FTS ещё не реализованы в этом режиме. Root checkout фиксирует sharp override 0.35.5 для transitive optional image dependency LanceDB; при установке tarball dependency overrides не наследуются: consumer root также должен закрепить этот override. Native installer/updates проверяются отдельной поставкой.

[Второй A/B](HYBRID-RESULTS.md) сохраняет все 32 sessions и ограничения: −69,4% tokens, −56,9% расчётной цены; 12/16 против 9/16. Это эффект всей связки, не isolated vector ablation.
