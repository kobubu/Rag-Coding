# Локальный векторный поиск CM

Векторный backend реализован с 0.3: Transformers.js вычисляет learned MiniLM embeddings на CPU, LanceDB хранит vectors локально и выполняет cosine search. Первое [лексическое A/B](AB-RESULTS.md) этого backend не имело; [последующие серии](HYBRID-RESULTS.md) и [оптимизационный эксперимент](OPTIMIZATION-RESULTS.md) уже использовали его.

В **0.4.2** устранён разрыв подключения: installable Harness bundle включает `mode: compact` и `autoContext: true`; source plugin без явно указанного mode тоже использует compact. Прежние четыре lexical/graph tools доступны при `mode: legacy`. Vector ошибки не скрываются переходом к lexical-only.

## Подготовка своего проекта

Нужен Node 22.19+ или 24. Из checkout:

```powershell
npm.cmd ci
npm.cmd run build
npm.cmd run cm:index -- --project 'D:/project'
npm.cmd run cm:vectors -- 'D:/project' 'D:/project/.code-memory/models' unit
npm.cmd run cm:search -- --project 'D:/project' --query 'remaining daily reward allowance' --mode vector
```

Primary index — `.code-memory/index.json`; vectors — `.code-memory/vectors`. Первая подготовка модели может скачивать pinned model/tokenizer; query inference использует local files only. API-ключ для этих команд не требуется. Модель `Xenova/all-MiniLM-L6-v2`, revision `751bff37182d3f1213fa05d7196b954e230abad9`, q8, 384 dimensions. База использует flat cosine scan; ANN не заявляется.

`cm-search` входит в tarball как bin. `--mode vector` вызывает только dense ranking и выводит snapshot, path/name/span и cosine similarity. `--mode hybrid` (default) собирает exact/lexical/dense context с required declarations, signature/dedupe и source budget. `--limit 1..50` относится к vector results; `--max-bytes 1..32000` — к hybrid source. Query должен содержать 1..16000 characters.

Для внешних artifacts можно указать `--index`, `--vectors`, `--model-cache` абсолютными путями; относительные пути считаются от `--project`. `--chunking unit|window|ast` должен совпадать с projection. Source/model/policy mismatch требует rebuild; после edits/add/delete/branch change обновлять CM вручную. Watcher пока запланирован.

## Harness

После локальной сборки tarball подключить его в полный Web/headless профиль с filesystem и systemPrompt services; [установка](DEEPSEEK-PLUGIN.md) раскрывает команды и ограничения installer.

```yaml
- id: code-memory
  config:
    projectRoot: D:/project
    modelCache: D:/project/.code-memory/models
```

Bundle сам задаёт compact/autoContext; этот patch указывает проект. Агент получает `cm_retrieve_context(query, max_bytes?)`, а auto context подаётся до model call. Файлы читаются/проверяются через Harness filesystem и наблюдаются для guarded edits. Missing/outdated vectors дают явный отказ, а не скрытый лексический поиск.

## Проверка на Geo Dash

В локальном smoke 0.4.2 подготовлен выбранный corpus из **224 tracked game JS**, **7 503 vector rows**. Embeddings полностью переиспользованы из существующего cache, query заново вычислен настоящей локальной моделью. Исходная игра не изменялась; derived index/projection лежат под Rag Coding `.artifacts`.

Чистый vector query `remaining daily allowance for rewarded video advertisements` нашёл `dailyRewardStatus` в `game/src/core/reward-policy.js` на первом месте, cosine similarity ≈0,5055. Имя функции не входило в запрос. Другой query о слиянии rectangles нашёл `rectangleUnionCells` вторым; semantic ranking не гарантирует идеальную первую позицию.

Tarball 0.4.2 извлечён в отдельный local install с junctions к уже установленным dependencies и запущен в полном Harness Web profile. Actual ToolRuntime dispatch `cm_retrieve_context` вернул reward-policy context с learned embeddings; composed profile сохранил vector/auto settings. Это ручное offline подключение пакета, не подтверждение one-command pnpm installer или новой paid A/B серии. [Безопасные метаданные](../research/evidence/vector-default-smoke-2026-10-13.json) сохраняют факт проверки; ключ и полный Geo code не публикуются.

Векторный поиск уже участвует в последних экспериментах. Экономия зависит от отбора контекста, последующих действий и history; наличие vector database само по себе её не подтверждает. Новый платный A/B здесь не выполнялся.
