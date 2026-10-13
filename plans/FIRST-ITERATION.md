# Первая итерация: от документов к воспроизводимому source core

## Цель

Подготовить фундамент, на котором можно честно сравнивать дробление: фиксированный source, диапазоны, Python capabilities и размеченные вопросы. Платный enrichment и богатый viewer не нужны для этой итерации.

Документационные RC-001 и RC-002 уже подготовлены. Продуктовая работа начинается с RC-003. Источник статусов — [backlog.json](backlog.json), удобное представление — [BACKLOG](BACKLOG.md).

## Порядок работы

| Шаг | Задачи | Конкретный результат | Проверка |
|---|---|---|---|
| 1 | RC-003 | Один repo, commit, file manifest, allowed paths | Повторное чтение даёт тот же manifest hash |
| 2 | RC-004 | 40 вопросов с spans/dependencies, split 10/30 | Близкие задачи и модули не утекли из holdout в настройку |
| 3 | RC-005 | Уточнённый v0.1 и capabilities Python | Примеры проходят schema, ограничения согласованы |
| 4 | RC-006 | Git/workspace reader | Dirty/add/delete и изменение во время чтения имеют правильный результат |
| 5 | RC-007 | Blobs и coordinate mapping | Exact roundtrip Unicode/BOM/CRLF; ошибка неподдерживаемой кодировки явная |
| 6 | Начало RC-010 | Python adapter поверх immutable file | Definitions/scopes/ranges точны, неполный parse виден |

Полная SQL-интеграция и recursive grouping остаются следующими задачами. Экспериментальный parser не объявляется готовым search API.

## Необходимые fixtures

Собственные примеры: nested closure с nonlocal; две функции с одноимёнными locals; decorator и docstring; if/else; try/finally; context manager; Unicode и CRLF; giant string; файл с syntax error; изменённый или удалённый файл overlay.

Каждая fixture имеет ожидаемые source hashes, spans и поддержанные semantic facts. Код fixture не должен выполняться при индексации. Отдельные runtime-тесты для проверки будущих правок запускаются только в своём тестовом сценарии.

## Первый сквозной результат

Из входного commit получить manifest → открыть конкретный file blob → разобрать функцию → получить вложенное определение и его captures → показать exact spans и diagnostics. Пользователь может проверить источники вручную, даже до реализации векторного поиска.

## Evidence пакета итерации

Сохранить corpus/config hashes, версии runtime и адаптера, команды, per-case результаты, список неподдержанных cases и source ranges. Доступные частные файлы не копировать в публичный репозиторий; публиковать собственные fixtures и безопасные metadata.

После этих результатов обновить фактические статусы RC-003…RC-007, решить Python semantic backend spike по плану и уточнить сложность следующей итерации. Не менять holdout после просмотра результатов кандидата.
