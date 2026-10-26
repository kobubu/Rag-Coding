# Установщик CM для Harness, Codex и Claude Code

CM 0.9.2 устанавливается без прав администратора в выбранный каталог. Готовый ZIP доступен в [публичном релизе](https://github.com/kobubu/Rag-Coding/releases/tag/v0.9.2), установка без checkout описана в [английской инструкции](INSTALL-WINDOWS.md). Windows PowerShell 5.1 bootstrap получает совместимый private Node.js при необходимости, проверяет SHA-256 официального архива, использует готовый пакет из ZIP или собирает локальный пакет из checkout и устанавливает runtime dependencies через npm. Нативные зависимости устанавливаются обычно, без junction к checkout. Код проекта не исполняется.

## Одна команда из checkout

Для существующего Harness 0.2.0-rc.2 доступна [установка из GitHub-тега](DEEPSEEK-PLUGIN.md#github-installation). Начиная с 0.9.2 готовый runtime включён в Git, сборка при установке не нужна. Ниже — полный Windows bootstrap с установкой Harness и настройками проекта.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File 'D:\Rag Coding\scripts\install_cm.ps1' -ProjectRoot 'D:\Geo Dash' -SourceScope game -InstallRoot 'D:\CodeMemory' -HarnessModel gpt-6-luna
```

По умолчанию выбраны `harness,codex,claude`; `-Clients codex,claude` устанавливает только MCP-вариант. Codex и Claude Code должны быть установлены отдельно. Harness 0.2.0-rc.2 скачивается вместе с CM. Если `-HarnessModel` не указан, сохраняются обычные default model настройки Harness. Для GPT-6 Luna используется ссылка на `OPENAI_API_KEY`; значение ключа установщик не запрашивает и не записывает. Модельные обращения выполняет клиент, не индексатор CM.

На подготовленном компьютере переиспользуются pinned embedding weights и подходящее поколение Atlas из checkout; они копируются в InstallRoot. Для нового компьютера веса скачиваются один раз. Перед повторным использованием CM проверяет root, snapshot и source manifest. Первичная индексация может занять минуты. `-SkipIndex` оставляет её до первого indexed query. `-PackageTarball` использует готовый локальный архив без сборки исходников; `-ModelCacheSource` и `-SeedDirectory` задают существующие локальные данные явно.

## Что появляется

- `InstallRoot/releases/<package-hash>/`: установленный пакет и зависимости. Проверяемый npm lock сохраняется рядом.
- `InstallRoot/models/`: pinned MiniLM q8/384d. Поиск работает локально.
- `InstallRoot/projects/<root-id>/`: настройки проекта, source/vector cache, отдельный Harness profile и `start-harness.ps1`, `start-codex.ps1`, `start-claude.ps1`.
- В проекте `.codex/config.toml`: именованная MCP section внутри markers Code Memory; остальные настройки сохраняются.
- Для Claude Code официальный `claude mcp add-json --scope local` регистрирует CM в личных настройках только этого проекта. Другие записи сохраняются. `-ClaudeScope project` вместо этого создаёт `.mcp.json` для совместной конфигурации; такой сервер требует стандартного подтверждения в Claude Code.
- В проекте `.agents/skills/code-memory/SKILL.md` и `.claude/skills/code-memory/SKILL.md`: инструкции по короткому контексту, расширению и свежести.

Идентификатор сервера привязан к корню проекта. Выбор другого проекта создаёт отдельные настройки. Для Claude local выбрать корень Git-репозитория: сам клиент связывает личную MCP configuration с этим корнем. Для вложенной части используется SourceScope. Он ограничивает corpus CM; обычные файловые права клиента сохраняются. Для новых project configs клиент может запросить стандартное доверие к проекту/MCP. Установщик не меняет trust или approvals. После установки перезапустить клиентов в выбранной папке.

## Запуск и проверка

Выход install содержит `directory` с точными путями. Запустить соответствующий `start-*.ps1`. Команды для установленного CLI:

```powershell
# Подставить node.exe и cm-setup из вывода установщика.
& 'D:/CodeMemory/runtime/node-v24.21.0-win-x64/node.exe' 'D:/CodeMemory/releases/HASH/node_modules/dsh-plugin-code-memory/dist/src/setup/cli.js' doctor --root 'D:/CodeMemory' --project 'D:/Geo Dash'
```

`doctor` устанавливает настоящий stdio MCP connection и вызывает project status. Это проверка сервера; отдельная проверка конкретного клиента требуется дополнительно. Harness использует native adapter из установленного пакета и auto context; отдельный profile импортирует dist entry по file URI. Codex/Claude используют MCP tools и project skill; автоматическая injection через lifecycle hooks этим установщиком не добавляется. Для MCP выбран adaptive/exact, live update перед indexed query и `backgroundUpdate: false`. Для маленького самостоятельного named file доступен быстрый путь без index/embedding.

`cm-setup remove --root ... --project ...` отключает project MCP connections и созданные неизменённые skills. Пакеты, модели и знания сохраняются; исходники проекта не удаляются. Конфликт с чужой/изменённой настройкой даёт ошибку, транзакция возвращает уже записанные config files. Это Windows installer; Node CLI и config generators переносимы, а bootstrap/launch scripts предназначены для Windows.

В0.8.1 `structuredContent.source_context` сохраняет исходник для клиента, выбирающего структурированный MCP-ответ. Реальный random-marker test подтвердил исправление native Claude; в контрольном запросе Codex маркер передан модели один раз и до, и после изменения. Отдельный [96-session A/B](HISTORY.md#7-codex-и-claude-code-через-mcp) измеряет полезность: исправленная доставка не означает автоматически меньше токенов, быстрее решение или более высокое качество. Открытые клиенты после обновления надо перезапустить.

Повтор той же команды переиспользует установленный release и данные. Новый package hash создаёт соседний release и переключает только управляемые настройки. Полный менеджер обновлений, автоматический rollback release и macOS/Linux bootstrap ещё не реализованы. Для переключения Claude с local на project сначала отключить существующее подключение. Генерируемые `.ps1` сохраняются с UTF-8 BOM для кириллицы в Windows PowerShell 5.1.

HNSW не выбран по умолчанию: в [прошлом модельном сравнении](HISTORY.md#5-hnsw) ANN sessions заняли на 2,73% больше времени, использовав на 9,64% меньше токенов, чем exact. Первые контексты всех пар совпали, поэтому это различие модельных траекторий, а не доказанная экономия от алгоритма индекса. Новый installer не заменяет этот эксперимент: подключение без модельных вызовов проверяет работоспособность, не скорость решения задач каждым клиентом.

Источники: [Codex MCP](https://learn.chatgpt.com/docs/extend/mcp), [Codex app-server](https://learn.chatgpt.com/docs/app-server), [Claude Code MCP](https://code.claude.com/docs/en/mcp).
