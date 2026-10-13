# Граф, маршрутизация и бюджет контекста

В 0.6.0 доступны experimental `retrievalPolicy: graph | adaptive` рядом с прежним `hybrid`. Default `hybrid` сохранён: новый вариант принимается по расходу всей модельной задачи и независимому качеству, а не по длине первого контекста.

## Что меняется

Прежний retrieval всегда выполняет dense search и объединяет source units с lexical matches. Новая процедура использует compiler catalog: имена и пути, минимальных callable owners, term frequency и adjacency подтверждённых вызовов. Catalog кэшируется на неизменяемый index; новая версия получает новый catalog.

`graph` объединяет lexical IDF, dense candidates и поддержку непосредственных compiler neighbours. `adaptive` сначала ищет именованный якорь и ограничивает его путём из запроса. При найденном якоре dense query пропускается; discovery продолжает использовать vectors. Несколько одноимённых anchors допускаются и ограничиваются количеством roots: это не доказательство уникального intent.

Контекст сначала получает точную функцию, затем необходимые объявления. `focused` ограничен двумя roots и 12 посещёнными graph nodes; крупное объявление получает короткий UTF-8 source prefix и явный omission. `expanded` допускает четыре roots, 24 nodes и более глубокое замыкание. Общий source-byte budget проверяется; пересечения удаляются. Prefix не является достаточным доказательством значения переменной. Агенту доступна дополнительная детализация через тот же `cm_retrieve_context` и обычный guarded source read.

Экономия должна появляться из сокращения лишних чтений, определений и модельных шагов. Пропуск embedding сам по себе сокращает local CPU latency, а не число LLM tokens. Контекст, tool schemas и накопленная история повторяются в запросах; уменьшение одного фрагмента не гарантирует более дешёвую полную задачу. HNSW — отдельная настройка native поиска; [его ускорение](HNSW.md) не переносится автоматически на цену LLM.

## Исследовательская основа

[RepoGraph](https://arxiv.org/abs/2410.14684) использует graph navigation при repository-level repair. [A2RAG v2](https://arxiv.org/abs/2601.21162) изучает адаптивную проверку достаточности и адресное расширение RAG evidence. Это основания проверить навигацию и дозированное раскрытие; их результаты не доказывают экономию нашего plugin.

[Microsoft GraphRAG query modes](https://microsoft.github.io/graphrag/query/overview/) и [DRIFT](https://microsoft.github.io/graphrag/query/drift_search/) показывают более сложные процедуры. В этот эксперимент не включены paid concept enrichment, global summaries, map-reduce и отдельная LLM reranking/critic chain. Их собственный расход необходимо учитывать; дополнительный вызов не принимается только по слову «agentic».

## Протокол модельного сравнения

Используется тот же установленный DeepSeek Harness 0.2.0-rc.2, Node24 и GPT-6 Luna с `reasoning_effort: low`. Шесть новых repair типов выбраны до paid runs и preview нового retrieval: numeric percentile, raster cache LRU, counterfactual depth, mobile image variant, locale priority/alias в двух модулях, longest-run indices/ties. Вносятся семь однозначных изменений. Исходные проверки проходят; все seeded версии проваливают independent grader. Эти задачи не являются игровым CPU/FPS benchmark.

Четыре arms — `none`, `hybrid`, `graph`, `adaptive`; по два повтора каждого task: 48 sessions. Порядок arms вращается и разворачивается. У CM одинаковые learned model/unit projection/exact search, source budget 6000 bytes и live refresh. У всех arms один `project_checks` с публичным набором; final grader имеет отдельный fuzz seed. Защищённые файлы, новые файлы и сохранность исходного Geo Dash дополнительно проверяются.

До вызовов закреплены cases/corpus hashes, model, budgets, actual source+compiled implementations, grader/runner и schema. Первоначальный preparation protocol сохранён отдельно; перед моделью он однократно расширен до полного implementation freeze. Во время series измеряемый код не меняется. Все неудачи, ограничения шагов и accounted usages сохраняются.

Runner: `scripts/run_graph_ab.ts`, protocol/results в private `.artifacts/geo-graph-budget-v2/`, безопасные публикуемые измерения — `evaluation/graph-budget/`. Credential берётся только из environment и не записывается в файлы. Исходники пользовательского Geo Dash не публикуются. Чтобы повторить series, нужны локальный corpus, cases file, installed Harness и cached model; результаты нельзя переносить на другой snapshot без новой подготовки.

```bash
node dist/scripts/run_graph_ab.js --phase prepare --project /absolute/project --out /absolute/new-experiment --node /absolute/node --harness /absolute/dsh/bin.js --cases /absolute/private-cases.json --model-cache /absolute/models --repetitions 2
node dist/scripts/run_graph_ab.js --phase run --project /absolute/project --out /absolute/new-experiment --node /absolute/node --harness /absolute/dsh/bin.js --cases /absolute/private-cases.json --model-cache /absolute/models --repetitions 2
```

## Что измеряется

Pass означает правильное финальное поведение и допустимый scope, независимо от exit code модели. Проверяются крайние случаи, immutability, cache eviction/release и locale precedence. Все provider input/output/cache categories берутся из законченных вызовов; счётчик attempts и activation проверяются. Метрики request bytes/schema bytes/context occurrences помогают объяснить overhead, но не заменяют provider tokens.

Расчётная цена использует проверенную [официальную страницу GPT-6 Luna](https://developers.openai.com/api/docs/models/gpt-6-luna): за 1M tokens short context input $0.10, cache read $0.01, cache write $0.125, output $0.50. Это оценка по usage, не invoice; local CPU/time, embedding cache и cold-start показываются отдельно. Cap series — $5 estimate, максимум 12 model calls и 240 секунд на run.

Выбор режима требует одновременно снижения tokens/цены и сохранения качества. Два повтора на шести типах одного проекта дают pilot, не универсальную гарантию и не доказательство статистического noninferiority. Отрицательные результаты прежней [оптимизационной серии](OPTIMIZATION-RESULTS.md) остаются в документации.

## Результат 48 sessions

[Полные измерения](../evaluation/graph-budget/results.json) содержат все runs, cache categories, failures, per-task/paired metrics и frozen protocol. Все48 имеют законченный provider usage; source audit подтвердил сохранность224 исходных файлов и неизменность измеряемой реализации до окончания series.

| Режим | Правильных /12 | Полные tokens | Model calls | Расчётная цена | Время всех runs, с |
|---|---:|---:|---:|---:|---:|
| Без CM | 10 | 676565 | 94 | $0.021880485 | 264.75 |
| Hybrid | 12 | 409980 | 61 | $0.014860820 | 415.90 |
| Graph | 12 | 327127 | 65 | $0.012580695 | 433.69 |
| Adaptive | 12 | 365652 | 72 | $0.013235835 | 417.55 |

У `graph` −51,6% tokens и −42,5% расчётной цены к `none`; к существующему `hybrid` −20,2% и −15,3%. Каждый из12 matched runs всех CM arms потратил меньше tokens/цены своего baseline. Две baseline ошибки — counterfactual depth: по12 calls, model-call limit и final failure «Changed destination is consequential». Их расход включён. Protected source и added-file audits чистые во всех48.

Первый context у graph/adaptive по шести типам одинаков:398/1613/118/820/2464/1889 source bytes; у hybrid398/1613/2133/3762/3659/2063. Graph делает65 calls против61 у hybrid, но суммарные tokens ниже. На отдельных задачах hybrid лучше graph — например depth и mobile image. `adaptive` не обошёл graph по общей цене, хотя named route пропускает embedding. В discovery их первоначальный контекст одинаков: различие observed LLM расхода нельзя приписать пропуску dense query. Повтор статистической задачи в adaptive потребовал8 calls против3 у graph; stochastic variation здесь существенна.

Цена всех48 runs $0.062557835 estimate. Graph runs суммарно заняли на63,8% больше времени baseline; local model startup, проверки и rebuild не являются бесплатной latency. Подготовка embeddings и watcher/CPU время входят в описание local resources, но не оплачиваются модельному API. Оптимизация whole-game CPU в этой series не проверялась.

Лучший наблюдённый суммарный вариант — `graph`. Для похожих задач его можно включить `retrievalPolicy: graph`; `adaptive` остаётся выбором для экономии local embedding work при точных именах. Совместимый default `hybrid` сохранён до более широкого holdout: шесть repair типов не покрывают произвольные declarations, большие рефакторинги и оптимизацию игры. Нет доказательства максимума качества среди всех chunkers, embedding models или agent procedures.

После окончания paid series в release добавлена только передача optional native Harness `sourceScope` и исправлено старое описание storage в `index.limits`: vectors уже существуют отдельной проекцией. Во всех scored sessions scope option отсутствовал; retrieval modules не менялись. Повторный compiler build шести seeded inputs подтвердил одинаковые snapshots/source/symbols/units/relations, различался только текст `limits`. [Post-trial proof](../evaluation/graph-budget/results.json) отделяет frozen inputs от этих release правок.
