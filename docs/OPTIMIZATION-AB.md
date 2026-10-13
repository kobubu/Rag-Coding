# Качество оптимизации и варианты дробления CM

Оптимизация считается полезной, когда сохраняет поведение и снижает затраты CPU. Экономия provider tokens сама по себе этого не доказывает. В завершённом эксперименте использованы исправные исходники Geo Dash; seeded regressions не добавлялись. [Итоги](OPTIMIZATION-RESULTS.md) отдельно раскрывают target CPU и отсутствие существенного ускорения caller.

## Варианты

| Вариант | Записи для dense/lexical поиска | Восстановление окружения |
|---|---|---|
| `none` | Обычные инструменты Harness | Native read/edit |
| `unit` | Целая функция, метод или тип; совместимый prototype | Required declarations |
| `window` | UTF-8 окна до 768 bytes, перекрытие до 128, предпочтительно границы строк | Referenced declarations; сигнатура enclosing function при наличии |
| `ast` | Direct statement groups; целые небольшие функции; окна внутри oversized groups | Compiler-bound dependencies и сигнатура владельца |

Primary index/glossary/graph остаётся одним и тем же. Chunks — отдельная derived projection; идентичность включает policy и точный span. Изменение snapshot, модели, policy или records digest требует rebuild. Manifest `cm-vectors-2` несовместим со старым projection: после обновления 0.3 → 0.4 пересобрать vectors. Immutable source index пересобирать по его актуальности.

Каждый CM-вариант использует тот же MiniLM CPU, dense/lexical RRF, auto admission, filesystem observations и source budget 6 000 bytes. Перекрывающиеся ranges удаляются при сборке контекста; реальные model usage включают headers/schemas/history. Fragment context всегда partial. AST/window scope enrichment отличается от целой функции: это сравнение способов сборки CM, отдельный эффект одного размера не изолирован.

```powershell
npm.cmd run build
npm.cmd run cm:vectors -- 'D:\Geo Dash' 'D:\Rag Coding\.artifacts\cm-embedding-models' ast
```

В config `code-memory` указать `mode: compact`, `chunking: ast`, `autoContext: true` и тот же `modelCache`. CLI сохраняет active projection в `.code-memory/vectors`; для нескольких одновременных projections API `buildVectors` принимает разные `directory`, plugin — `vectorsPath`.

## Замер качества

Два реальных CPU targets: horizontal render/collision candidates и rectangle union для visual platform plan. По три повтора каждого задания в четырёх arms; выполнены все 24 sessions. Задачи/геометрия/source/model settings одинаковы; agent workspaces и history свежие, arm order ротируется. Private fixtures/corpus/patches/raw traces не публикуются. Frozen protocol и implementation hashes зафиксированы до платных candidate runs; измерен 0.4.0, buffer cache 0.4.1 добавлен после серии.

Во всех arms доступен один и тот же `project_checks`: фиксированная команда public smoke, без произвольного shell. Модель может проверить собственную правку. Final evaluator отдельно проверяет 15 городов, иной fuzz seed, edge cases, callers и protected-source hashes. CM artifacts не находятся в agent workspace; plugin читает внешнюю frozen projection и наблюдает source через штатный filesystem.

Behavior gate требует точного порядка/identity/дубликатов/границ и snapshot callback semantics для candidates. Union gate проверяет точные cells и порядок, holes/EPSILON, отсутствие изменения входа, независимые mutable results, изменения геометрии между calls и другие exported callers. Неверная правка получает failure; её низкий расход и быстрый CPU не считаются успехом.

Performance gate: минимум 15% снижения elapsed CPU на actual geometry, минимум 7/9 выигранных paired blocks; stress не медленнее baseline более чем на 10%. Для candidates construction допускает максимум четырёхкратный slowdown. Каждый timing block выполняет ABBA или BAAB и усредняет два исполнения каждого варианта. Прогрев и серийное исполнение снижают влияние JIT/GC; исходник без изменений никогда не считается оптимизацией. Это local target CPU, не FPS всей игры или телефона.

Отдельно сохраняются behavioral success, useful-optimization success, raw timings, scope violations, patch size, provider input/output/cache usage, model/tool calls и session latency. Все failures и budget stops входят в итог. Успех двух связанных задач одного проекта не подтверждает общее превосходство метода. Лучшие patches проходят дополнительную проверку физических traces/браузера; original Geo Dash сохраняется.

## Воспроизведение

`scripts/optimization_ab.ts` экспортирует `prepareOptimization` и `runOptimization`. Передать project/output/node/harness/model/modelCache/cases, repetitions/maxCalls/maxSeconds. Cases JSON: `{ id: horizontal | union, prompt: string }[]`. Подготовка не требует credential; runner получает `apiKey` только в памяти/environment. Для других проектов нужен соответствующий evaluator, собственные contracts и workloads.

CLI: `npm.cmd run harness:optimization -- --phase prepare --project <project> --out <new-directory> --node <node.exe> --harness <dsh-bin.js> --cases <private-cases.json> --model gpt-6-luna --model-cache <local-models>`. Для запуска повторить те же arguments с `--phase run` и `CM_AB_API_KEY` в environment. По умолчанию три повтора, 20 model calls и 300 сек. на session. Не помещать credential в cases, launch options или profile. `--embedding-cache` задаёт переиспользуемые локальные embeddings. Final summary: `node dist/scripts/summarize_optimization.js <output>`.

`scripts/optimization_checks.ts` — адаптер Geo Dash. `scripts/project_checks_plugin.ts` — одинаковая capability для обеих групп. Ставки для USD estimate сохраняют cache categories из [официальной документации Luna](https://developers.openai.com/api/docs/models/gpt-6-luna); это расчёт, а не billing export. Indexing/local CPU/разработка учитываются отдельно.
