# CM Atlas: локальная карта кода

В 0.5.0 работает React/TypeScript viewer с локальным Node.js сервером. Это read-only prototype без облачного аккаунта. Он читает те же source snapshot, symbols, relations и learned embeddings, что MCP и native Harness plugin.

После `npm ci`, `npm run build` и [индексации](VECTOR-SEARCH.md):

```powershell
npm.cmd run cm:agent -- --project 'D:/Geo Dash'
```

Команда выводит JSON с `url` и `pid`. Откройте выданный `http://127.0.0.1:<port>`; `--port 0` выбирает свободный порт, `--port 61331` задаёт конкретный. Для данных вне проекта добавьте `--index`, `--vectors`, `--model-cache` по [MCP setup](MCP-SETUP.md). `--search-mode exact` — default; `ann` включается после [создания HNSW](HNSW.md). Остановка консольного процесса — Ctrl+C. Сервер не публикуется в интернете.

## Навигация и смысл карты

1. Выберите область или модуль на карте. Zoom, reset и перетаскивание помогают исследовать плотные группы.
2. Откройте глоссарий модуля, найдите symbol и перейдите к source span. Scoped names позволяют различать локальные переменные.
3. В «Связях» нажмите доказательство: viewer показывает конкретную строку, откуда установлен call/reference/capture.
4. «Похожий код» предлагает embedding candidates. Они ведут к коду, но не получают статус доказанного вызова.
5. Смысловой запрос возвращает компактный hybrid context с budget, snapshot и omissions; можно открыть найденный range.

Области — **предположения по именам и путям**, а не LLM enrichment или semantic clustering. Первый layout детерминирован: модули группируются в семь областей. Структурные рёбра агрегируют настоящие interfile compiler relations; в overview показывается до 1000 самых частых рёбер, остаток указан как `omitted_edges`. Карточка выбранного узла раскрывает до 30 отношений с provenance.

Similarity имеет отдельный статус `semantic-candidate`. Отображаемая cosine similarity не является вероятностью правильности. HNSW graph — внутренняя структура ускорения vector search, его случайные соседства не рисуются как зависимости исходников.

## Версии и ограничения

Source view ограничен 300 строками и 32000 bytes за страницу. `next_byte` продолжает длинную строку по корректной UTF-8 boundary; даже однострочный файл можно прочитать полностью последовательными запросами. Lookup допускается только по ID из выбранного snapshot, а изменившийся source возвращает stale error. Snapshot нельзя подменить произвольным путём.

HTTP слушает только `127.0.0.1`, проверяет Host, Origin и `Sec-Fetch-Site`, принимает только GET. Нет endpoints записи, native code проекта не выполняется. CSP запрещает внешние scripts/connects и embedding во фрейм. API и interface доступны локальным процессам пользователя; это не multi-user authentication или защита от вредоносного приложения на машине.

Watcher, автоматический add/delete/branch refresh, ручная редактура concepts, graph path overlay, полный unresolved UI, SQLite migration, installer/update и подписка остаются планом. Если исходники поменялись, пересоздайте source/vector projections и перезапустите агент. Не выдавайте эту ручную процедуру за автоматический sync.

На настоящем corpus Geo Dash: 224 модуля, 29186 symbols, 130775 relations, 7503 vectors. В Chrome проверены semantic search → code, glossary, compiler evidence, similarity navigation и zoom; layouts 1440×1000, 844×390, 390×844 без horizontal overflow и console errors. [Безопасные результаты](../research/evidence/local-cm-mcp-atlas-2026-10-13.json); screenshots с private source остаются локальными.
