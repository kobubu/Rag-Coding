# Plugin CM для DeepSeek Harness

Пакет `dsh-plugin-code-memory` подключает CM к DeepSeek Harness 0.2.0-rc.2: перед первым шагом агента кладёт в переписку нужный исходник, регистрирует инструмент `cm_retrieve_context` и инструкцию в системном промпте. Как это устроено — [HOW-IT-WORKS.md](HOW-IT-WORKS.md). Для новой установки используйте [установщик](INSTALL.md); ниже — запуск из checkout.

## Быстрый запуск на подготовленном Windows-компьютере

В checkout `D:\Rag Coding` уже собраны CM, Harness 0.2.0-rc.2, Node.js 24 и модель эмбеддингов:

```powershell
# Сначала скопировать API-ключ в буфер; значение не попадает в команду.
$env:CM_AB_API_KEY = Get-Clipboard
powershell -NoProfile -ExecutionPolicy Bypass -File 'D:\Rag Coding\scripts\start_harness.ps1' -ProjectRoot 'D:\Geo Dash' -SourceScope game
```

Если уже задан `CM_AB_API_KEY` или `OPENAI_API_KEY`, первая строка не нужна. [Launcher](../scripts/start_harness.ps1) использует GPT-6 Luna, задаёт провайдеру `cacheRetention: "none"` (новые сессии берут общее начало промпта из кеша) и открывает браузер; открывать нужно **полную ссылку из строки `dsh web:`** вместе с её token. Остановить — `Ctrl+C`.

Launcher создаёт отдельный Harness home и каталог CM в `.artifacts/user-harness/` и `.artifacts/user-memory/`. API-ключ в patch не записывается — только имя переменной. `-SourceScope game` ограничивает CM кодом игры; `-NoOpen`, `-Port 61333`, `-PrepareOnly` меняют запуск. Для другого проекта первая индексация займёт несколько минут; дальше CM обновляет индекс после изменений исходников.

## Сборка и индекс

```bash
npm ci
npm run compile
npm run cm:index -- --project /absolute/project --out /absolute/project/.code-memory/index.json
npm run cm:vectors -- /absolute/project /absolute/CM-model-cache
npm run plugin:smoke
```

Первая векторная команда скачивает закреплённую модель MiniLM; дальше всё работает локально на CPU. В индекс входят `.ts`, `.tsx`, `.mts`, `.cts`, `.js`, `.jsx`, `.mjs`, `.cjs`, кроме каталогов зависимостей и сборки, declaration-файлов и symlinks; до 500 файлов и 8 MiB исходника, JSON-индекс до 128 MiB. Код проекта не исполняется.

## Подключение

### GitHub installation

Начиная с **0.9.1**, готовые `dist/src/` и `dist/viewer/` включены в Git. Установка закреплённого тега не требует локальной сборки или разрешения prepare для CM:

Apache Arrow для LanceDB объявлен явно: штатный профиль Harness отключает автоматическую установку peer-зависимостей. Не меняйте autoInstallPeers ради CM; необходимые обычные runtime-зависимости устанавливаются вместе с пакетом.

```bash
dsh plugin --profile web add github:kobubu/Rag-Coding#v0.9.2
```

Вариант с готовым архивом:

```bash
dsh plugin --profile web add https://github.com/kobubu/Rag-Coding/releases/download/v0.9.2/dsh-plugin-code-memory-0.9.2.tgz
```

Замените web именем своего профиля при необходимости. Bundle ещё не создаёт модель/индекс проекта. Подготовьте их для выбранного корня:

Если CM уже установлен Windows bootstrap, обновляйтесь новым ZIP с тем же `-InstallRoot`. Harness 0.2.0-rc.2 предпочитает доступную копию bundle рядом с собственной установкой перед копией профиля: Git-add в старой bootstrap-установке может оставить старый bundle/launcher. Новый bootstrap создаёт отдельный release и переключает управляемые project launchers. Для прямого GitHub-подключения проверяйте обычный Harness без другой installation-level копии CM.

```bash
dsh plugin --profile web exec cm-index --project /absolute/project --out /absolute/project/.code-memory/index.json
dsh plugin --profile web exec cm-vector-index /absolute/project /absolute/project/.code-memory/models
cd /absolute/project
dsh --profile web --no-open
```

Первая векторная подготовка скачивает pinned MiniLM. На Windows [установщик](INSTALL.md) сам подготавливает проект и launcher. Готовый runtime не требует blanket-разрешения install scripts для CM; нативные зависимости следуют обычной политике package manager.

Теги до 0.9.1 не содержат готового dist: используйте их release tarball или ручную сборку. В текущем checkout сборка называется `npm run compile`. Имя build и lifecycle prepare/prepack/install не используются: по правилам npm они включают подготовку Git-зависимости. Индексация не исполняет исходники проекта.

Как bundle: `npm pack --pack-destination .artifacts`, затем установить tarball в Harness Plugin Manager или командой

```bash
dsh plugin --profile code-memory add /absolute/dsh-plugin-code-memory-<версия>.tgz
dsh --profile code-memory --no-open
```

При повторной установке той же версии pnpm может оставить старое содержимое — меняйте версию или имя файла и проверяйте итоговую конфигурацию через `--dump-config`.

Из checkout — отдельным patch:

```yaml
- insert:
    - id: code-memory
      name: /absolute/Rag-Coding/dist/src/harness/plugin.js
      config:
        projectRoot: /absolute/project
        modelCache: /absolute/CM-model-cache
        autoUpdate: true
```

`dsh --profile web --patch /absolute/code-memory.patch.yml`. На Windows в YAML допустимы пути `D:/...`.

## Настройки

| Поле | По умолчанию | Что делает |
|---|---|---|
| `projectRoot` | `CM_PROJECT_ROOT` или cwd | Корень индексируемого проекта |
| `indexPath` | `.code-memory/index.json` | Путь к индексу |
| `vectorsPath` / `modelCache` | `.code-memory/vectors` / `.code-memory/models` | Векторы и модель |
| `mode` | `compact` | `legacy` включает старые четыре инструмента вместо `cm_retrieve_context` |
| `autoContext` | `true` | Контекст перед первым шагом агента |
| `maxContextBytes` | 6000 | Бюджет исходника в контексте |
| `retrievalPolicy` | `adaptive` | `graph` и `hybrid` — прежние политики |
| `searchMode` | `exact` | `ann` — HNSW, требует `npm run cm:ann` |
| `chunking` | `unit` | `window` и `ast` — экспериментальные, требуют пересборки векторов |
| `autoUpdate` | `true` в bundle | Пересобирает индекс перед запросом, если исходники изменились |
| `backgroundUpdate` | `false` | Фоновый наблюдатель вместо обновления по требованию |
| `memoryDirectory` / `embeddingCache` | `.code-memory/live` | Поколения живого индекса и кеш эмбеддингов |
| `sourceScope` | — | Ограничить индекс поддеревом проекта |
| `diagnosticsPath` | — | Журнал событий CM без кода и промптов |

## Версии и отказы

CM проверяет схему индекса, отпечаток snapshot, хеши, диапазоны, идентификаторы и концы связей. Перед выдачей сверяются хеши исходников и конфигурации анализа: изменённый файл даёт `index_outdated` (или пересборку при `autoUpdate`), другой snapshot — `snapshot_mismatch`, отсутствующий индекс — `index_not_ready`. Plugin не регистрирует правку файлов, запуск команд или сетевые вызовы моделей; при выгрузке Harness удаляет его регистрации, индекс остаётся на диске.

## Legacy-инструменты

При `mode: legacy` вместо `cm_retrieve_context` доступны `cm_symbol_search`, `cm_code_search`, `cm_context_get` и `cm_graph_expand` — без векторов и без авто-контекста. Этот режим экономии не дал ([HISTORY.md](HISTORY.md#1-лексический-поиск-и-четыре-инструмента)).
