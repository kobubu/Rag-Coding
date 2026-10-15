# Проверка Windows-установщика CM 0.8.0

15 октября 2026 года. [Установка и запуск](INSTALL.md), [машинное доказательство](../evaluation/installer-proof.json). Это проверка реального подключения клиентов и получения контекста без модельных задач; новых результатов по качеству, токенам и цене здесь нет.

| Клиент | Проверенная граница | Результат |
|---|---|---|
| DeepSeek Harness 0.2.0-rc.2 | Установленный full Web runtime, standard-preset Agent, native `cm_retrieve_context`; смысловой запрос вернул ожидаемый символ, frontend HTTP 200 | PASS |
| Codex 0.130.0-alpha.5 | Настоящий app-server обнаружил project MCP tools и прочитал `cm://project/status`; trust задан в отдельной тестовой конфигурации клиента | PASS |
| Claude Code 2.1.288 | Настоящий `claude mcp get` показал `Connected` для native local server выбранного проекта | PASS |

CM установлен вне checkout. Node.js 24.21.0 скачан в отдельный runtime с проверкой официального SHA-256; 716 пакетов установлены обычным npm, без junction к зависимостям разработчика. Codex и Claude Code уже были установлены; установщик их не переустанавливает. Готовый ZIP включает bootstrap и CM tarball, но для первого получения runtime/dependencies/weights нужен интернет.

Geo Dash: 226 source files, 7 599 learned vectors, adaptive retrieval и exact search; background watcher выключен, saved-source проверяется перед indexed query. Готовое совместимое поколение Atlas скопировано и проверено отдельно от исходного Atlas. Полная первичная индексация Geo Dash здесь не измерялась. На маленьком отдельном Git-проекте с кириллицей проверена настоящая первичная индексация. Ещё одна проверка скачала pinned MiniLM в пустой кеш и выполнила локальную inference с проверкой хешей.

Повтор полного PowerShell bootstrap для Geo Dash переиспользовал dependencies. Изолированный lifecycle install/repeat/remove сохранил клиентские config bytes, посторонние настройки и source; после отключения сохранены шесть файлов поколения и модели. Изменённая вручную managed TOML section отклонена, Unicode/BOM сохранён; rollback при конфликте проверен unit test. Хеши 237 файлов исходного Geo Dash и его существующей рабочей правки совпали. В Geo Dash добавлены только клиентские `.codex/config.toml` и две project skills; его product changes не коммитились.

Build core/viewer, 51 тест, docs/contracts/backlog, portable fixture probe, native Harness registry smoke и разбор четырёх PowerShell scripts прошли. Все клиентские проверки выполнены без LLM API calls. Приватные исходники, embeddings, настройки других серверов, auth URL и ключи в публичное доказательство не включены.

## Почему exact остаётся по умолчанию

В [предыдущем HNSW model A/B](HNSW-MODEL-AB.md) ANN занял 448,94 s против 437,00 s у exact: **+2,73%**. Tokens: 296 321 против 327 926, **−9,64%**. Все 12 начальных contexts совпали; разница расхода относится к разным model trajectories и не доказывает причинную экономию от HNSW. Native vector search был быстрее, полная модельная задача — дольше. Новый installer этого сравнения не повторяет.

Для Codex/Claude пока проверено подключение MCP, а не полная задача с моделью и не перенос Harness auto-context lifecycle hooks. Windows-only bootstrap, полный release rollback/export, macOS/Linux, cloud account и подписка остаются отдельными задачами. [Backlog](../plans/BACKLOG.md): RC-069 завершена, RC-051 сохраняет оставшийся scope.
