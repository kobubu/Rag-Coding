# Geo Dash optimization comparison

Безопасные метаданные завершённых 24 sessions; [интерпретация и ограничения](../../docs/OPTIMIZATION-RESULTS.md), [протокол и повтор](../../docs/OPTIMIZATION-AB.md). Полная geometry/source/prompts/patches/raw traces Geo Dash и credentials не включены.

`results.json` сохраняет primary frozen protocol, provider usage и independent target quality; `secondary_caller_qa` — более поздний замер вызывающего кода. `post_study_retrieval_cache` — отдельное before/after latency измерение 0.4.1 с совпадающими context hashes, без нового paid A/B.

Измеренная серия — 0.4.0; release сразу после неё — 0.4.1. Для восстановления ровно измеренного runtime сначала создать отдельную копию commit `13e2c028e7de2238825c858431141296d4eb11fd`, затем применить `git apply --unidiff-zero evaluation/geo-optimization/restore-measured-vector.patch`. Hash должен совпасть с frozen `protocol.implementations`; другие изменённые между серией и этим commit файлы относятся к CLI/export/docs/tests, не model runtime. Более новые commits меняют vector defaults/API и не подменяют measured version. Это воспроизведение измеренной медленной реализации; обычная установка использует текущую.

PNG/SVG/PDF показывают одинаковые данные. CPU ratios относятся к локальным workloads, не игровому FPS. Все failures/stops включены; original game files не менялись.
