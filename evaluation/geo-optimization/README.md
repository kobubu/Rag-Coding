# Geo Dash optimization comparison

Безопасные метаданные завершённых 24 sessions; [интерпретация и ограничения](../../docs/OPTIMIZATION-RESULTS.md), [протокол и повтор](../../docs/OPTIMIZATION-AB.md). Полная geometry/source/prompts/patches/raw traces Geo Dash и credentials не включены.

`results.json` сохраняет primary frozen protocol, provider usage и independent target quality; `secondary_caller_qa` — более поздний замер вызывающего кода. `post_study_retrieval_cache` — отдельное before/after latency измерение 0.4.1 с совпадающими context hashes, без нового paid A/B.

Измеренная серия — 0.4.0; текущий source — 0.4.1. Для восстановления ровно измеренного `src/code-memory/vector.ts` в отдельной копии применить `git apply --unidiff-zero evaluation/geo-optimization/restore-measured-vector.patch`. Hash должен совпасть с frozen `protocol.implementations`; другие изменённые после серии файлы относятся к CLI/export/docs/tests, не model runtime. Это воспроизведение измеренной медленной реализации; обычная установка использует текущую.

PNG/SVG/PDF показывают одинаковые данные. CPU ratios относятся к локальным workloads, не игровому FPS. Все failures/stops включены; original game files не менялись.
