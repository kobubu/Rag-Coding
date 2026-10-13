# HNSW: качество и стоимость полной задачи

Новый controlled pilot сравнивает `none`, `exact` и `ann` на одних исходниках Geo Dash. В двух CM arms закреплены `retrievalPolicy: graph`, unit chunks, learned MiniLM vectors, context budget 6000 UTF-8 bytes и live refresh. Оба используют одну физическую HNSW-bearing LanceDB table; exact явно вызывает `bypassVectorIndex()`. Изменён только native search mode.

Шесть repair типов из предыдущей [graph series](GRAPH-BUDGET.md) повторяются дважды: это search-mode ablation на ранее измеренных задачах, а не новый holdout качества модели или FPS-оптимизация игры. Порядок трёх arms вращается и разворачивается. Исходники проекта остаются read-only; агент изменяет отдельные copies. Baseline checks должны пройти, все семь seeded regressions — провалить final grader.

До model runs runner сохраняет cases/corpus/implementation/runtime/preparation hashes. Истинный search mode и hash первоначального model context проверяются после каждого run; ошибочная активация останавливает series с сохранением результата. Итоговый grader проверяет поведение, крайние случаи и allowed source scope. `project_checks` одинаков во всех arms, final fuzz seed отличается от публичного.

Полные provider input/output/cache counters учитывают все законченные вызовы, включая неудачные runs. [Официальная цена GPT-6 Luna](https://developers.openai.com/api/docs/models/gpt-6-luna) используется для short context: input $0.10, cache read $0.01, cache write $0.125, output $0.50 за миллион tokens. Это estimate по usage. Бюджет series $1 estimate, максимум 12 calls и 240 seconds на run. Local embeddings/ANN build/CPU и вся session latency измеряются отдельно.

Шестнадцать заранее выбранных новых semantic queries проверяют native recall@24 к exact neighbors. Это не semantic relevance labels и не гарантия полного retrieval. Пять ABBA/BAAB blocks измеряют native latency без embedding. Single-pass full context timings показываются только как диагностические данные; session wall time — самостоятельная метрика. Параметры [HNSW](HNSW.md) не подгоняются по результатам.

```powershell
npm.cmd run harness:ann -- --phase prepare --project 'D:/Geo Dash' --out 'D:/new-cm-trial' --node 'D:/node.exe' --harness 'D:/dsh/lib/bin.js' --cases 'D:/private-cases.json' --model-cache 'D:/models' --reuse-cache 'D:/embedding-cache.json' --repetitions 2
npm.cmd run harness:ann -- --phase run --project 'D:/Geo Dash' --out 'D:/new-cm-trial' --node 'D:/node.exe' --harness 'D:/dsh/lib/bin.js' --cases 'D:/private-cases.json' --model-cache 'D:/models' --reuse-cache 'D:/embedding-cache.json' --repetitions 2
```

Credential берётся из environment `CM_AB_API_KEY` или `OPENAI_API_KEY`; profile хранит только имя переменной, logs редактируются перед сохранением. Cases, private source и raw embeddings не публикуются. Нужны локальный установленный Harness, pinned cached embedding model и новый output directory. Завершённые runs не перезаписываются.

## Результат 36 model sessions

[Полные данные](../evaluation/hnsw-model/results.json) содержат все runs, provider cache categories, failures, matched comparisons, native preflight и frozen protocol. Реальный installed Harness 0.2.0-rc.2, Node24, GPT-6 Luna/low; source revision Geo Dash `17007329bd381384f494278f2206a70727f0e723`. Все224 original source hashes и измеряемая реализация после series совпали.

| Режим | Правильных /12 | Все tokens | Model calls | Расчётная цена | Время Harness sessions, с |
|---|---:|---:|---:|---:|---:|
| Без CM | 9 | 714084 | 92 | $0.023697520 | 265.51 |
| CM graph + exact | 12 | 327926 | 61 | $0.013052190 | 437.00 |
| CM graph + HNSW | 12 | 296321 | 65 | $0.011829350 | 448.94 |

Exact CM к none: −54,1% tokens, −44,9% estimate price; HNSW CM к none: −58,5% и −50,1%. Все12 HNSW runs дешевле своих none pairs; у exact11/12. Исключение exact — первая locale задача:91554 tokens против63831 у none, однако none оставил ошибку и изменил лишний legacy module. Его расход и scope violation включены в totals. Без CM оба depth runs исчерпали12-call budget и не различили changed destination; первый locale run не исправил Traditional Chinese aliases. Остальные none runs прошли.

Наблюдённый aggregate ANN к exact: −9,64% tokens и −9,37% estimate price при одинаковом observed quality12/12. Но выигрыши распределены6/12 matched pairs; **все12 первых rendered contexts совпали**. На locale первый repeat ann28777/exact91554 tokens, второй ann61567/exact46172; направления отличаются. Эти разные model trajectories/cache categories при двух repeats не доказывают причинной token экономии от HNSW. Все tool/schema/history tokens учтены.

Native preflight:22 queries — шестнадцать новых semantic queries и шесть прежних task prompts. Пять ABBA/BAAB blocks, k24, median exact15,306ms / ann4,548ms (**3,37×**). Strict и tie-aware recall99,62%: два пропущенных соседа из528, по одному в semantic-holdout-6 и discover-input-depth. Все22 graph-render contexts совпали. Это проверка approximate neighbors, не relevance labels. Параметры не подгонялись.

HNSW sessions суммарно на2,73% дольше exact; оба CM arms на64,6–69,1% дольше none. Native gain не ускорил observed model cycle. Время sessions включает startup, model/network, source checks и agent tools/live refresh; final independent grader и corpus preparation идут вне этой duration и показываются отдельно в protocol/preparation. Цена всех36 runs $0.048579060 estimate. Local CPU/embedding reuse/ANN rebuild не входят в API invoice.

Для похожих repair tasks рекомендуемый проверенный режим — `retrievalPolicy: graph`, `searchMode: exact`; HNSW остаётся доступным opt-in для native retrieval. Общий compatibility default `hybrid` не менялся. Exact vector default сохраняет полную neighbor выдачу этого небольшого corpus. Шесть ранее измеренных English repair prompts одного проекта, два repeats и новые neighbor queries не доказывают максимум качества, universal saving, статистическую noninferiority или FPS/CPU-оптимизацию игры. Старый отрицательный [optimization pilot](OPTIMIZATION-RESULTS.md) сохранён.
