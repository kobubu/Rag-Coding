# HNSW: локальное ускорение vector search

Вероятное название из предложения «LNSW / little navigable small world» — **HNSW, Hierarchical Navigable Small World**. Это индекс ближайших соседей: navigable graph позволяет рассматривать часть vectors вместо полного сканирования. Ускорение приближённого поиска может сопровождаться снижением recall; exact dense search остаётся default и эталоном. [Исходная работа HNSW](https://arxiv.org/abs/1603.09320).

## Выбранный вариант

В существующей LanceDB 0.40.0 используется `Index.hnswSq`: **IVF_HNSW_SQ**. HNSW находится внутри IVF partitions; SQ уменьшает объём индексных vectors, а refinement проверяет расширенный набор candidates по исходным vectors. Для первого небольшого local corpus выбрана одна partition, чтобы не терять candidates на этапе coarse partition selection. [Vector indexes LanceDB](https://docs.lancedb.com/indexing/vector-index/).

| Параметр | Значение |
|---|---|
| Metric | cosine |
| `numPartitions` | 1 |
| `m` | 16 |
| `efConstruction` | 200 |
| Query `ef` | минимум 128, не меньше `limit × refineFactor` |
| `refineFactor` | 4 |
| Query `nprobes` | Все partitions из manifest, сейчас 1 |

Структурный граф CM продолжает хранить compiler relations в source JSON; HNSW сохраняется как производный native index в локальной LanceDB. Neo4j для этого не требуется. HNSW neighbors не являются calls, references или product concepts.

## Создать и включить

Сначала построить source index и learned vectors по [VECTOR-SEARCH](VECTOR-SEARCH.md). Для ANN нужны не менее 256 записей; для маленького corpus достаточно exact search.

```powershell
npm.cmd run cm:ann -- --project 'D:/Geo Dash'
npm.cmd run cm:agent -- --project 'D:/Geo Dash' --search-mode ann
npm.cmd run cm:mcp -- --project 'D:/Geo Dash' --search-mode ann
```

`cm:ann` читает существующие vectors, строит index и атомарно дописывает ANN parameters в manifest. Повторного embedding, ключа API или платной модели не требуется. Внешние index/vector paths задаются `--index` и `--vectors`; chunking должен совпадать с projection. Для native Harness plugin задайте `searchMode: ann` в CM config с существующей ANN projection. CLI `cm-search` поддерживает `--search-mode exact|ann` отдельно от `--mode vector|hybrid`.

Exact режим явно вызывает `bypassVectorIndex`; ANN требует declaration в manifest и физический HNSW index. Ошибка не превращается в пустую успешную выдачу. Ручное `cm:vectors` сбрасывает declaration ANN: после него повторите `cm:ann` и перезапустите клиент. При [live update](LIVE-CM.md) в режиме `ann` новое поколение само строит HNSW до атомарной публикации.

## Измерение на Geo Dash

Отдельная копия projection сохранила оригинальные exact данные. Corpus: 224 tracked JS файла под `game/**/*.js`, включая bundled `game/fil/vendor/three.module.js`, 7503 embeddings размерности 384, pinned `Xenova/all-MiniLM-L6-v2`, q8 CPU. Это не только first-party source. Использованы 16 natural-language queries и 32 сохранённых vectors, k=24; пять ABBA/BAAB blocks с чередованием exact/ANN. В исходном native-only probe никаких model API calls.

| Метрика | Результат |
|---|---|
| ANN build | 1,238 сек. |
| Native index files | 4 082 064 bytes |
| Median exact query | 15,13 ms |
| Median ANN query | 4,84 ms |
| Ускорение native стадии | 3,12× |
| Strict recall@24, среднее 48 queries | 1,0 |
| Tie-aware recall@24 | 1,0 |
| Сравнение трёх hybrid context render hashes | Все совпали |

Повторный запуск опубликованного runner с независимым построением индекса и теми же 48 queries дал 15,49 ms exact / 4,60 ms ANN (3,37×), build 0,628 сек. Strict и tie-aware recall составили 0,99913194: один пропущенный сосед из 1152. Три context render hashes снова совпали. Оба запуска сохранены; параметры не подгонялись под пропущенный query.

Это measured recall на выбранных queries, **не гарантия 100% recall** и не оценка смысловой правильности. HNSW rebuild может изменить набор кандидатов. Query vectors готовились до native timing. Значения не включают embedding, чтение/проверку source hashes, merge и построение context. На полном retrieval отдельные single-pass probes показывали меньший выигрыш, а exact шёл раньше ANN: caches/order не изолированы, поэтому их нельзя считать строгим end-to-end benchmark.

HNSW обычно уменьшает CPU latency. Число prompt/output tokens, число model turns и качество patch определяет весь retrieval/model workflow. HNSW с тем же context не уменьшает автоматически токены или цену. В первоначальном 0.5.0 проходе LLM A/B не было. [Новая model series36 sessions](HNSW-MODEL-AB.md) отдельно проверила exact/ann/none: CM12/12 в обоих modes, none9/12; initial contexts совпали, native3,37× не перенёсся на session speedup. Отрицательный [optimization pilot](OPTIMIZATION-RESULTS.md) сохраняется без изменений.

[Результаты и параметры](../evaluation/hnsw/results.json) публикуются без private source и raw embeddings. Повторное решение о default требует независимых semantic queries, add/delete/branch refresh, разных размеров corpus и полного quality/cost A/B. Для очень малого corpus exact проще; IVF/PQ/DiskANN стоит сравнивать при других объёмах и ограничениях RAM, без замены библиотеки только ради названия алгоритма.

Повторить native protocol после сборки: `node scripts/measure_ann.mjs --project <root> --index <index.json> --vectors <directory> --model-cache <directory> --output <new-directory>`. Runner копирует projection в новый output, сохраняет 48 measurements и не пишет private source/raw vectors в `proof.json`; оригинальная projection сохраняется. Копия LanceDB в output сама содержит vectors и остаётся локальной. Natural queries рассчитаны на игру, другой корпус требует собственного semantic holdout.
