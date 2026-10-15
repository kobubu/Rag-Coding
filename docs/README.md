# Документация RAG Coding

[Экономичность CM в агентской сессии](EFFICIENCY-AB.md): почему агент тратит токены, изменения после 0.8.1 (очистка запроса, целые файлы, места вызова, без повторной отправки файла) и трёхвариантные серии none / 0.8.1 / новая сборка; запуск в облачной сессии.

[Живая CM](LIVE-CM.md): пополнение из сохранённых файлов, атомарные поколения, переиспользование эмбеддингов, поиск и практические ограничения.

[Граф и бюджет контекста](GRAPH-BUDGET.md): named/discovery routing, compiler dependency closure, focused/expanded и четырёхвариантный модельный эксперимент.

[HNSW model A/B](HNSW-MODEL-AB.md):36 sessions, exact/ann12/12 и none9/12; весь provider расход, одинаковые initial contexts, native recall и отсутствие session speedup.

[Harness A/B pilot](HARNESS-AB.md) описывает запуск живой модели, token accounting, независимые проверки и ограничения сравнения.

[Нативные Codex / Claude Code](CLIENTS-AB.md): 96 реальных сессий, качество/CPU/токены/время, adoption и исправление structured source в0.8.1. Подключение сервера и реальная экономия рассматриваются отдельно; цель native speed/token savings без потери качества пока не подтверждена.

[Первый pilot](AB-RESULTS.md): CM 14/14 против 13/14; экономия не подтвердилась.

[Второй pilot с local vectors/compact context](HYBRID-RESULTS.md): −69,4% tokens, −56,9% расчётной цены, 12/16 против 9/16; latency и failures раскрыты.

[Качество оптимизации и дробление](OPTIMIZATION-AB.md): behavioral/CPU gates, public checks для агента и unit/window/AST projections.

[Итог оптимизационной серии](OPTIMIZATION-RESULTS.md): 24 runs; дополнительный расход всех CM arms, одинаковый target success и отсутствие существенного caller speedup.

[Локальный продукт](LOCAL-PRODUCT.md): index на компьютере пользователя, MCP, подписка и карта концептов.

С0.5.0 доступны [MCP stdio](MCP-SETUP.md), [CM Atlas](LOCAL-ATLAS.md) и optional [HNSW](HNSW.md); с0.6.0 opt-in saved-source refresh работает. В0.8.0 добавлен [Windows-установщик](INSTALL.md) для Harness, Codex и Claude Code. Account, billing и полный cross-platform update/restore остаются планом. Native ANN timing и model-quality/cost A/B измеряются отдельно.

Главная точка входа — [README](../README.md). Полный CM/RAG backend описан как план; уже работающий local prototype и Harness plugin выделены в отдельную инструкцию.

[Векторный поиск](VECTOR-SEARCH.md): learned local embeddings, vector-only CLI и compact/auto default в bundle 0.4.2; historical lexical pilot отделён от последующих vector experiments.

| Документ | Что он определяет |
|---|---|
| [Установка CM](INSTALL.md) | Windows bootstrap, три клиента, doctor, повторная установка и отключение |
| [Нативный A/B](CLIENTS-AB.md) | Три сохранённые серии, реальные CLI, независимые проверки и source-delivery fix0.8.1 |
| [CM plugin: запуск](DEEPSEEK-PLUGIN.md) | Установка, четыре tools, local index, версии и фактические пределы |
| [Требования](PRODUCT.md) | Задачи пользователя, границы MVP и обязательное поведение |
| [Архитектура](ARCHITECTURE.md) | Компоненты, поток данных и адаптеры языков |
| [Модель данных](DATA-MODEL.md) | Сущности, диапазоны, идентичность и версии |
| [Дробление кода](CHUNKING.md) | Границы записей CM, иерархия и восстановление исходника |
| [Enrichment и связи](ENRICHMENT.md) | Проходы анализа, доказательства и допуск результатов |
| [Поиск и контекст](RETRIEVAL.md) | Точные и смысловые запросы, граф и пакет для ИИ |
| [Интерфейс и API](INTERFACES.md) | Навигация разработчика и контракты интеграции |
| [Проверка качества](EVALUATION.md) | Корпус задач, сравнительные эксперименты и критерии готовности |
| [Обновление и эксплуатация](OPERATIONS.md) | Снимки, очередь, сбои, доступ и диагностика |
| [Решения и открытые вопросы](DECISIONS.md) | Выбранные основы, альтернативы и условия пересмотра |
| [Источники](SOURCES.md) | Первичные документы и исследовательские работы |
| [Скорость и токены 0.7.0](SPEED-TOKENS.md) | Current-file/graph/vector маршруты и полный модельный эксперимент |

Исполняемые примеры формата находятся в [contracts](../contracts/README.md). Последовательность разработки — в [roadmap](../plans/ROADMAP.md), детализация первой итерации — в [FIRST-ITERATION](../plans/FIRST-ITERATION.md).

Исследование существующего продукта находится в [FlashMT enrichment](../research/FLASHMT-ENRICHMENT.md). Оно объясняет происхождение идей, но не является спецификацией нового сервиса.

Выбор агентской оболочки обоснован в [DeepSeek Harness: plugin или fork](../research/DEEPSEEK-HARNESS.md). Внешнее расширение реализовано на закреплённом runtime API; model loop и compact auto context проверены pilot. Полноценный ContextService остаётся планом.
