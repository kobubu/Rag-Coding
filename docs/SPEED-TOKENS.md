# Скорость, токены и качество CM 0.7.0

Проверяется вся задача в DeepSeek Harness, а не только скорость vector query. Ранее граф снижал расход токенов, но полные сессии оставались медленнее: [0.6.0](GRAPH-BUDGET.md), [0.6.1](HNSW-MODEL-AB.md). В новом пилоте **0.7.0 быстрее и дешевле отсутствия CM при сохранении проверенного качества**.

## Результаты 36 запусков GPT-6 Luna

| Показатель | Без CM | Прежний graph/exact 0.6.1 | Новый adaptive 0.7.0 |
|---|---:|---:|---:|
| Independent successes | 11/12 | 12/12 | 12/12 |
| Все provider tokens | 521 316 | 262 501 | 270 753 |
| Расчётная цена с cache | $0.019081 | $0.012179 | $0.012382 |
| Model calls | 81 | 55 | 52 |
| Harness, всего | 293.08 s | 562.96 s | 233.34 s |
| Средняя Harness session | 24.42 s | 46.91 s | 19.44 s |
| Median Harness session | 23.08 s | 46.98 s | 21.46 s |
| Copy + Harness + independent verification, всего | 364.31 s | 588.26 s | 278.61 s |

Новый CM к none: **tokens -48.1%, estimate price -35.1%, Harness time -20.4%**, а с copy/final QA -23.5%. К прежнему CM latency -58.6%, но tokens **+3.1%** и price +1.7%: целые небольшие файлы иногда дороже короткого graph context. Среди 12 matched pairs новая версия победила по времени **7**, по tokens **10**, по цене **11**. Ни одна неудача не удалена.

Первый none запуск занял 45.33 s. Вторичный расчёт убирает **весь первый matched triple**, сохраняя все 36 в primary results: latency gain остаётся **9.7%**, tokens -48.8%, price -36.1%. Выигрыш неодинаковый: обе motion-envelope sessions стали медленнее none; quota во втором повторе тоже. Это пилот одного проекта, не универсальное или статистически доказанное ускорение.

Все шесть CPU optimization patches, включая none, прошли поведение и gate: full sequenceStats стал быстрее примерно 34–42x на 6 000 distinct values. CM-оптимизации: 35.97x и 42.25x. Это CPU одной функции, не FPS игры. Сравнение не доказывает превосходство CM по CPU качеству; полезность здесь — расход на получение правки и общая успешность.

[Все результаты](../evaluation/speed-tokens/results.json), [зафиксированный протокол](../evaluation/speed-tokens/protocol.json), [задачи](../evaluation/speed-tokens/cases.json). Все 188 calls сверены с provider usage. Corpus 224 tracked game JS, 3.56 MB, включая vendor. Оригинальный Geo Dash не изменён.

## Маршруты запроса

1. **Один точный путь к небольшому самостоятельному модулю.** До 6 000 UTF-8 bytes, без import, require, dynamic import и re-export. CM читает текущий сохранённый файл целиком, включая локальные определения. Индекс и embeddings не нужны. Добавленная/сохранённая правка доступна немедленно; версия `file:<sha256>` не выдаётся за snapshot всего проекта. Внешние зависимости не объявляются восстановленными.
2. **Остальные точные имена.** Adaptive использует named anchors и ограниченное замыкание compiler graph; vector inference пропускается. Большие декларации и отсутствующие зависимости отражаются в omissions.
3. **Поиск неизвестного места.** Local MiniLM vectors, lexical IDF и graph support ранжируют кандидатов; source context ограничен бюджетом. Exact cosine остаётся default; ANN выбирается явно.
4. **Запрос расширения.** `detail: expanded` идёт к актуальному индексу и compiler dependencies. Файловый shortcut не применяется.

Фрагменты проверяются по версии/хешу через настоящий Harness filesystem; `fs/observed` позволяет guarded edit без повторного чтения. Файловый маршрут отклоняет выход за корень через junction/symlink, несколько путей, слишком большие файлы и превышение source budget. Изменение файла во время чтения приводит к отказу. Это точный source context; полнота семантики не утверждается.

## Обновление

Bundle включает `autoUpdate: true`. В Harness полный source/graph/vector generation обновляется **перед следующим индексированным retrieval**, с прежними fences и атомарной публикацией. Watcher не запускает compiler rebuild одновременно с завершением короткой правки. `backgroundUpdate: true` возвращает прежнее поведение.

Atlas/local-agent сохраняет отдельный watcher. Файловый маршрут читает свежие байты независимо от возраста индекса. Следующий graph/vector запрос после изменения ждёт полную пересборку: стоимость не исчезает. Incremental compiler и worker остаются следующими задачами.

## Локальная модель

Cached inference использует официальный Tokenizers.js и ONNX Runtime Node непосредственно, pinned MiniLM q8/384d, те же CPU threads, BERT padding/truncation и masked mean/L2 pooling. SHA256 трёх модельных artifacts проверяется перед загрузкой. Explicit bootstrap сохраняет Transformers.js downloader. Learned vectors сохранены.

До платных запусков 17 embeddings в смешанных batches сверены с прежним pipeline: maximum absolute difference `5.96e-8`, cosine не ниже `0.9999999999999994`. Проверены пустая строка, English/Russian/CJK/emoji, accents, код, padding и 512-token truncation. В 12 новых Node processes/3 ABBA blocks медиана запуска уменьшилась с 1 112 до 627 ms, **1.77x**. OS cache прогрет между блоками; это не результат после перезагрузки компьютера и не время всей задачи.

API: [ONNX session](https://onnxruntime.ai/docs/api/js/interfaces/InferenceSessionFactory.html), [Tokenizers.js](https://github.com/huggingface/tokenizers.js).

## Метод модельной проверки

Шесть новых спецификаций: strict circle tangency, negative camera dt, legacy wallet idempotence, swept negative mover amplitude, duplicate receipts + daily ledger в двух модулях, реальная линейная оптимизация статистики. Три arms: none, сохранённый 0.6.1 graph/exact с watcher, новый adaptive/exact без watcher. Два повтора; equal-length opaque run/workspace IDs; rotate/reverse order; один model/reasoning/tools/лимиты.

Оригинальное поведение проходит проверку; пять seeded regressions и неоптимизированная статистика не проходят итоговый gate. Снаружи Harness проверяются behavior/fuzz с отдельным seed, identities, exports, остальные файлы и отсутствие новых файлов. CPU gate требует минимум 1.25x на полном `sequenceStats`, с ABBA timing на 6 000 distinct values и сохранением сложных ключей, first ties, entropy и остальных exports. Это один pure metrics workload, не whole-game FPS.

Полная стоимость включает provider tokens, cache read/write и output всех успешных и неуспешных запусков. Harness spawn-to-close считается отдельно от copy/final verification; оба времени сохраняются. Первичная постройка и последующие rebuild costs указываются отдельно: indexed routes требуют готового CM, current-file route - нет. Первые два кандидата сохранены как бесплатная подготовка без модельных запусков; перед платным A/B зафиксирован третий протокол и все исполняемые входы.

Подготовка одной indexed case в этом запуске заняла 13.58–23.40 s с cached embeddings; corpus index строился отдельно. Эти затраты не включены в Harness time: на одноразовой незнакомой задаче выигрыш может исчезнуть. Current-file маршрут не использует подготовленную projection. Полный changed-source rebuild в отдельном профиле занял 30.83 s, блокируя event loop на 21.78 s; on-demand переносит его к следующему indexed query, не отменяет.

После всех платных запусков исправлены Unicode path tokenization и junction escape за sourceScope внутри проекта. [Native proof](../research/evidence/speed-post-study-2026-10-14.json) раскрывает два изменённых source/compiled файла; все шесть initial context digests сохранены. Платная freeze сохраняется отдельно; эти проверки защищают release, но не называются новым модельным A/B.
