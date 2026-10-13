# Архитектурные решения и вопросы

Решения ниже определяют полный CM core. Уже реализованы local prototype и DeepSeek Harness plugin; PostgreSQL/vector service и более глубокие способности остаются планом. Вопросы с измеримым выбором закрываются соответствующим spike.

| ID | Решение | Обоснование и альтернативы | Когда пересмотреть |
|---|---|---|---|
| ADR-01 | Точные исходники и immutable snapshots | Индекс и модельные описания не заменяют версию кода; mutable database-only source теряет воспроизводимость | Только при сохранении эквивалентных гарантий версии и bytes |
| ADR-02 | Иерархические CodeUnit и отдельные context requirements | Вложенный фрагмент может требовать родителя; сравнить whole-function и fixed-window baselines | После retrieval evaluation; допустима выдача целой функции там, где она лучше |
| ADR-03 | Символ не равен нормализованному имени | Регистр, scope и overload имеют значение; lower-case text index остаётся поисковым дополнением | Схема identity уточняется по capabilities языка |
| ADR-04 | Структурный анализ до смыслового enrichment | Определения и связи языка имеют свои доказательства; модельные гипотезы сохраняют статус | При появлении более точного анализатора или верификации |
| ADR-05 | PostgreSQL ledger и начальный граф в таблицах | Меньше независимых хранилищ и проще согласованная публикация; отдельная graph DB возможна | Когда профиль обходов показывает недостаточность SQL |
| ADR-06 | pgvector как производная проекция | Поиск по смыслу можно менять и перестраивать; exact/text path работает отдельно | По измерениям recall, latency, cost и требований доступа |
| ADR-07 | Core на TypeScript + Node.js; первый корпус TypeScript, затем Python и C# | Общие типы и инструменты для API/workers/viewer; Compiler API для первого языка; исходный Python probe остаётся исследовательским | По требованиям реального корпуса и измерениям; смена core не меняет source/ledger гарантии |
| ADR-08 | Ledger jobs с lease и fingerprints | Нужны retries, version fencing и recovery; отдельный брокер пока не обоснован | По нагрузке и операционным требованиям |
| ADR-09 | Память решений отделена от памяти актуального кода | Историческое исправление имеет применимость и проверки, а не статус текущей реализации | Не объединять без сохранения происхождения |
| ADR-10 | Первый продукт локальный и provider-independent | Структуру и поиск можно проверять без внешнего аккаунта и оплаты | На этапе командного использования и конкретного deployment |
| ADR-11 | Fastify API, React + TS viewer, JSON Schema + Ajv2020 | Одни внешние контракты с обязательной runtime-проверкой; TS-типы проверяют разработку, а не произвольный JSON | После API/viewer spike с конкретными границами и стоимостью поддержки |
| ADR-12 | CM означает Code Memory; внешний DeepSeek Harness plugin | Пользователь выбрал термин и оболочку; independent core и четыре read-only tools подключаются без fork | Если реальная интеграция требует недоступной extension point |
| ADR-13 | Первый рабочий plugin использует bounded local JSON snapshot | Полный ContextService ещё отсутствует; ранний прототип позволяет проверять symbols/context/graph на живых исходниках | При реализации PostgreSQL ledger и общего ContextPackage API; local format имеет собственную версию |
| ADR-14 | Desktop CM хранит индекс локально; cloud account управляет подпиской | Предложен SQLite ledger/graph и LanceDB vector spike, MCP stdio и local map viewer; PostgreSQL остаётся вариантом team server | После реальной проверки vector packaging, retrieval, MCP-клиента и модели тарифа; эти компоненты пока не реализованы |

13 октября 2026 года ADR-07 заменил исходный выбор Python: перенесены документационные инструменты, CI и structural probe. Исторические материалы FlashMT сохранены с прежними source revision и Python-фактами. На следующем шаге реализован CM plugin по ADR-12/13; после подключения Harness API общий минимум Node.js 22.19.0, рекомендован Node.js 24 LTS.

## Открытые вопросы с владельцами по роли

| Вопрос | Ответственный этап | Как принять решение |
|---|---|---|
| TypeScript project configuration и стратегия обновления Program | Semantic adapter spike M05 | Проверить tsconfig paths, project references, imports/re-exports, closures, unavailable dependencies и incremental update; опубликовать capability matrix |
| Python semantic backend и способ подключения worker | Дополнительный адаптер M09 | Сравнить доступные индексаторы на Python-корпусе; не приписывать Tree-sitter разрешение типов и вызовов |
| Точный tokenizer и embedding-модель | Retrieval experiment | Заморозить варианты, одинаковый corpus и budget, измерить нужные источники и стоимость |
| Размер и семантические правила групп | Chunking experiment | Whole-function/fixed-window/AST сравнение и проверка контекста |
| SQL-доступ / ORM и интеграция выбранного Fastify | Первый API spike | Транзакции, JSON Schema validation, миграции и стоимость поддержки |
| Live model loop / automatic context / общий backend Harness plugin | Integration RC-033 | Local runtime tools уже проверены; следующий шаг — реальные provider turns, повтор после edit и сравнение retrieval на фиксированном corpus |
| Лицензия нового продукта | До распространения исполняемого продукта | Пользователь выбирает модель использования; текущая публичная документация не назначает лицензию автоматически |
| Размещение и командная модель доступа | После локального MVP | Конкретные пользователи, инфраструктура, данные и цена эксплуатации |

Датированные результаты spikes добавляются сюда с точной версией, измерениями и последствиями для backlog. Отклонённый вариант сохраняется, если он объясняет выбор.


ADR-015: local learned embeddings и LanceDB projection реализованы отдельно от primary JSON; compact auto context использует logged producer message и штатные FS observations. Root legacy protocol сохранён; новые holdout и полный usage проверили экономию. Изменения сравнивались вместе, без отдельного vector ablation; scope/latency gaps остаются открытыми.
