# HNSW model A/B

[results.json](results.json) — безопасная публикация36 реальных Harness sessions: `none`, `graph + exact`, `graph + ann`, шесть ранее измеренных repairs × два repeats. [Протокол, выводы и воспроизведение](../../docs/HNSW-MODEL-AB.md).

Все provider usage categories, неудачи, scope audits, mode/context gates и per-pair comparisons сохранены. Native preflight содержит22 query labels/recall/timing/context hashes; source code, private cases, raw embeddings и credential отсутствуют. Cases/corpus/source+compiled/runtime hashes закреплены до paid runs. New semantic queries проверяют точных соседей; это не model holdout или смысловая relevance разметка.

CM exact12/12 и ann12/12; none9/12. Observed savings к none54,1%/58,5% tokens и44,9%/50,1% estimate price. Все12 первых CM contexts совпали, поэтому aggregate ANN/exact difference не является доказательством причинной token экономии от HNSW. Native lookup быстрее3,37×, но все Harness sessions с ann заняли на2,73% больше exact. Approximate recall99,62% и два misses опубликованы; exact остаётся default.

Результаты ограничены этим frozen corpus, English repair prompts, моделью и двумя stochastic repeats. Failures прежних серий не удалены; [историческое сравнение chunking/оптимизации](../../docs/OPTIMIZATION-RESULTS.md) сохраняется отдельно.
