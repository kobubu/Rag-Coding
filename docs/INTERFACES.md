# Интерфейс и API

## Навигация разработчика

Главный экран содержит выбор repository/snapshot, строку поиска и фильтры вида сущности. Карточка результата показывает определение, код, область видимости, тип и происхождение описания. Одноимённые символы различаются по владельцу и файлу.

Карточка CodeUnit содержит breadcrumbs «файл → тип → функция → блок», exact source, required context и связанные проверки. Точная аннотация подсвечивает участок исходника; по клику на имя открывается сущность глоссария и её употребления.

Граф первоначально показывает локальное окружение выбранного узла. Направление, predicate и версия видны; candidate edges имеют собственное обозначение. У каждого ребра есть переход к доказательству. Большой граф раскрывается по запросу и остаётся ограниченным.

Панель контекста показывает состав пакета, причину выбора и недостающие dependencies. Для рабочего дерева отображаются base commit, overlay и состояние обновления. При устаревшей выдаче пользователь видит доступный snapshot и может открыть его source.

## Предлагаемые операции API v0.1

Пути ниже являются спецификацией будущего командного HTTP ContextService. В 0.5.0 отдельный локальный read-only API уже работает для [CM Atlas](LOCAL-ATLAS.md): `/api/status`, `/api/map`, `/api/search`, `/api/symbols`, `/api/source`, `/api/graph`, `/api/similar`. Он слушает loopback и читает один configured snapshot; это не реализация team auth или всех контрактов таблицы ниже.

Локальные adapter/API уже используют TypeScript + Node.js, viewer — React + TypeScript. Fastify и shared service остаются планом. Индексатор работает отдельно; MCP и viewer используют один `LocalCM` core с UTF-8 paging, snapshot checks и cancellation.

| Операция | Запрос | Ответ |
|---|---|---|
| POST /v1/snapshots | repo_id, Git ref или workspace manifest | snapshot_id, job_id, состояние |
| GET /v1/snapshots/{id} | ID снимка | Manifest, capabilities, готовность projections |
| GET /v1/entities/{id} | ID символа | Определения, область, type, occurrences |
| GET /v1/units/{id} | ID записи | CodeUnit, source и ContextRequirement |
| GET /v1/source | snapshot, path, byte range | Точный source, encoding и hash |
| POST /v1/search | snapshot, query, mode, filters, limits | Кандидаты с origins и reasons |
| POST /v1/context | snapshot, anchors, task, token budget | ContextPackage и omissions |
| POST /v1/graph/query | snapshot, anchors, predicate/direction/depth | Узлы, evidence edges, truncation |
| POST /v1/enrichment/jobs | units, fingerprint, provider/budget profile | Задание или уже существующий результат |
| POST /v1/knowledge/reviews | annotation/relation, решение, expected_revision | Review event или conflict |
| GET /v1/jobs/{id} | ID задания | Стадия, ошибки, попытки, доступные результаты |

У пагинации курсор привязан к snapshot, фильтрам и access scope. `request_id` связывает операции с диагностикой; произвольный путь клиента не даёт доступа к файлам вне зарегистрированного источника.

## Ошибки и частичные результаты

Стабильные error codes: `snapshot_not_ready`, `snapshot_mismatch`, `source_hash_mismatch`, `unsupported_language`, `partial_analysis`, `unknown_symbol`, `budget_insufficient`, `permission_denied`, `provider_unavailable`, `review_conflict`.

Отсутствие символа и неполный индекс — разные ответы. Ошибка vector projection не превращает точный поиск в пустую «успешную» выдачу. Частичный результат перечисляет доступные capabilities и ограничения. API не обещает полную проверку влияния.

## CLI и интеграция

Первый CLI поддерживает создание снимка, список статусов, поиск символа, чтение unit и ContextPackage. Это позволяет проверить ядро до создания богатого интерфейса.

Интеграция редактора передаёт repo identity, base commit, текущий файл, выделенный span и hash несохранённого буфера. Если source не совпадает, сервис создаёт новый overlay или возвращает conflict. Номера строк старого snapshot не применяются к текущему buffer.

Read-only [MCP adapter](MCP-SETUP.md) уже предоставляет `cm_retrieve_context`, `cm_project_status` и status resource. Full installed Harness MCP client реально запускает процесс и вызывает learned retrieval через ToolRuntime. Стандартный MCP не регистрирует CAS observations native Harness FS adapter; права правки остаются у клиента. Hosted service и commercial account остаются отдельными этапами.

Для агентской оболочки выбран DeepSeek Harness. Внешний CM plugin и bundle подключаются поверх tools API; fork не создаётся. Локальные cm_symbol_search/cm_code_search/cm_context_get/cm_graph_expand и настоящий registry dispatch проверяются в M00P. Текущие ответы используют byte budgets и отдельный local format; переход к полному ContextPackage API, live model loop и UI проверяется в RC-033. [Инструкция](DEEPSEEK-PLUGIN.md), [исследование](../research/DEEPSEEK-HARNESS.md).

## Приёмка интерфейса

Сквозные проверки: выбрать одноимённый символ → открыть правильное определение → перейти к nested block → раскрыть внешнюю привязку → открыть доказательство ребра → переключить snapshot → увидеть новую версию или явное ограничение. Для package viewer проверяется отображение omissions и сохранность источников при копировании контекста.
