# Подробный план разработки

Дата исходного плана: 13 октября 2026 года. Сейчас завершён документационный этап и доступен диагностический пример. Продуктовые этапы ниже запланированы. Этап закрывается результатом на указанной границе, а не количеством добавленных файлов.

## Последовательность и критерии перехода

| Этап | Что получается | Зависимости | Условие готовности |
|---|---|---|---|
| M00 | Документы, контракты, план, переносимый probe | Исходный концепт | Навигация и документационные checks проходят |
| M01 | Целевой TypeScript corpus и 40 размеченных задач | M00 | Hashes, ground truth, holdout и TypeScript capabilities зафиксированы |
| M02 | Reader, blobs, ledger и restore | M01 contracts | Source roundtrip, стабильный manifest и реальная SQL/restore проверка |
| M03 | Глоссарий, CodeUnit и required context | M02 | Scope identity, exact partition, captures и крайние случаи проходят |
| M04 | Exact/text retrieval, package, CLI/API | M03 | Сквозной реальный поиск с источниками; A/B/C baseline измерен |
| M05 | Cross-file семантика, инвалидация и jobs | M04 | Capabilities честны; version fencing, recovery и обновления проверены |
| M06 | Embeddings, hybrid ranking и graph contribution | M04/M05 | D/E оценены при фиксированном corpus и budget |
| M07 | Bounded enrichment, admission, review | M05/M06 | Evidence и статусы проверены; качество живой модели измерено отдельно |
| M08 | Viewer, editor overlay, read-only integration | M04–M07 по задачам | Навигация, graph evidence и ContextPackage проверены через интерфейс |
| M09 | Python, C# и межсервисные contracts | Общий TS core M03/M05 | Языковые и межрепозиторные сценарии проходят на реальных версиях |
| M10 | Память решений, команда и следующая поставка | M07–M09 по задачам | Restore, access isolation, реальные UC и release proof выполнены |

Минимальный полезный MVP заканчивается M04: один TypeScript-проект, точный и текстовый поиск, глоссарий, блоки и проверяемый пакет окружения. Core/CLI/API/workers пишутся на TypeScript + Node.js; API — Fastify, будущий viewer — React + TS. M05–M08 расширяют качество и удобство. Дополнительные языки и командный выпуск не задерживают первый локальный результат. Уже работающие npm-инструменты проверяют документы и ограниченную fixture; они не закрывают продуктовые этапы.

## Критический путь

```mermaid
flowchart LR
    M01[Corpus и contracts] --> M02[Снимок и ledger]
    M02 --> M03[Symbols и CodeUnit]
    M03 --> M04[Контекстный MVP]
    M04 --> M05[Семантика и обновление]
    M05 --> M06[Hybrid retrieval]
    M06 --> M07[Enrichment]
    M04 --> M08[Viewer]
    M07 --> M08
    M05 --> M09[Другие языки]
    M08 --> M10[Решения и поставка]
    M09 --> M10
```

Точные зависимости заданы в [backlog](BACKLOG.md). Схема показывает этапы, а не требование выполнять всё одним большим изменением.

## Разбиение на первые reviewable изменения

1. **Corpus и правила версии.** Выбрать одну реальную задачу проекта, сохранить manifest и expected sources; зафиксировать spans и capabilities. Проверка: повторить manifest и ground truth.
2. **Source reader и blobs.** Реализовать один воспроизводимый снимок без анализа. Проверка: прочитать Git/overlay и восстановить bytes, включая deletion и CRLF.
3. **Symbols и CodeUnit.** Добавить TypeScript scopes через Compiler API, hierarchy и partition. Проверка: точный source плюс nested captures, shadowed locals и UTF-16→byte mapping.
4. **Ledger и exact navigation.** Сохранить данные в PostgreSQL и читать их через CLI/API. Проверка: реальные миграции и переход к нужному source.
5. **ContextPackage.** Раскрыть required context с budget и omissions. Проверка: реальная задача с closure/guard и сравнение baseline.

Это рекомендуемые границы commits/PR, а не пять независимых серверов. Ближайшие точные действия перечислены в [первой итерации](FIRST-ITERATION.md).

## Правила закрытия задачи

- Есть воспроизводимый вход и точная source version.
- Результат проходит acceptance из backlog на ближайшей реальной границе.
- Опубликована capability или ограничение, если часть сценария не поддержана.
- Обновлены контракт, fixtures и затронутая документация.
- Новые ошибки и незавершённые результаты отражены явно.
- Состояния локальной проверки, commit, push, CI, provider и release различаются.

Green test не доказывает улучшения retrieval. Для такого утверждения требуется сравнение [EVALUATION](../docs/EVALUATION.md). Если вариант не улучшает метрику, он не принимается по обещанию будущей пользы.

## Роли и объём

Нужны роли core/backend, language analysis, retrieval/evaluation и interface. Один разработчик может выполнять их последовательно. Размеры S/M/L в backlog отражают относительную сложность, не обещают срок. Календарная оценка делается после M01 и spikes с учётом доступного состава и корпуса.

Первым внешним зависимым шагом станет выбор и разрешённый бюджет модельного провайдера; до него структура и точный поиск доступны локально. Hosted deployment, лицензия и командные настройки решаются на своих этапах.
