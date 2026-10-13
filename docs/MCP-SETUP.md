# CM через локальный MCP

В 0.5.0 работает stdio-сервер на официальном TypeScript SDK 1.32.1. Клиент запускает отдельный Node.js процесс, который читает один заранее выбранный проект и его существующие CM/vector projections. Индекс и веса embedding-модели остаются на компьютере. Выбранный код попадает в контекст облачной модели, если MCP-клиент использует облачный LLM.

## Подготовка

Нужен Node.js 24 либо 22 от 22.19, `npm ci`, `npm run build`, source index и vectors по [VECTOR-SEARCH](VECTOR-SEARCH.md). Это ручная установка; installer, cloud login и лицензирование пока запланированы. Для первого скачивания embedding weights используется отдельная индексирующая команда с явным разрешением загрузки. MCP ищет только с уже локальными weights.

Пример настройки клиента, поддерживающего `mcpServers`. Пути следует заменить своими; разные клиенты имеют собственные формы конфигурации.

```json
{
  "mcpServers": {
    "cm": {
      "command": "C:/Program Files/nodejs/node.exe",
      "args": [
        "D:/Rag Coding/dist/src/mcp/cli.js",
        "--project", "D:/Geo Dash",
        "--index", "D:/Rag Coding/.artifacts/cm-vector-default/index.json",
        "--vectors", "D:/Rag Coding/.artifacts/cm-vector-default/vectors",
        "--model-cache", "D:/Rag Coding/.artifacts/cm-embedding-models",
        "--search-mode", "exact"
      ]
    }
  }
}
```

По умолчанию файлы находятся в `<project>/.code-memory/`: `index.json`, `vectors/`, `models/`. `--chunking unit|window|ast` должен совпадать с policy vector manifest. Точный dense search работает и при наличии HNSW; `--search-mode ann` требует заранее построенного [ANN index](HNSW.md). Этот пример предполагает существующие артефакты конкретного локального стенда, они не входят в Git.

## Инструменты и ответы

| Имя | Аргументы | Результат |
|---|---|---|
| `cm_retrieve_context` | `query`, `max_bytes` (по умолчанию 6000, максимум 32000), необязательный `snapshot_id` | Hybrid context: source ranges, версии, omissions и dependency bindings |
| `cm_project_status` | Нет | Snapshot, числа сущностей, модель и готовность vector projection |
| Resource `cm://project/status` | URI | То же состояние для resource-capable клиента |

Тело кода включено один раз в `content`; `structuredContent` содержит метаданные и до 64 references без дублирования тела. Полный сериализованный retrieve result ограничен 64000 UTF-8 bytes. При сокращении возвращаются omissions и `partial`; это не обещание полной программы в одном ответе. `max_bytes` — бюджет исходного контекста, не точное число LLM tokens.

Root задаёт владелец через CLI. Tool arguments не позволяют поменять его или прочитать произвольный путь. Неверный snapshot, изменённый исходник, отсутствующие weights и несовместимая projection возвращают ошибку. Cancellation проходит к core/embedding boundary; начатая native CPU операция завершается до следующей проверки сигнала. Stdout содержит только MCP JSON-RPC, диагностика идёт в stderr.

MCP-сервер читает код и не делает patch. Правами редактирования управляет клиент. CAS/наблюдения Harness FS, которые предоставляет наш native Harness adapter, не появляются автоматически у стороннего MCP-клиента. При подключении MCP вместо native CM adapter не включайте оба одновременно без проверки: одинаковый контекст может попасть в модель дважды.

## DeepSeek Harness 0.2.0-rc.2

Установленный Harness уже содержит `@deepseek-ai/dsh-mcp-client`. В дополнительном patch профиля подключается одна его instance:

```yaml
- insert:
    - id: cm-mcp-client
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        serverName: cm
        transport: stdio
        command: 'C:/Program Files/nodejs/node.exe'
        args:
          - 'D:/Rag Coding/dist/src/mcp/cli.js'
          - '--project'
          - 'D:/Geo Dash'
        failOnStartupError: true
        reconnect:
          enabled: false
```

Здесь используются default index/vectors/model paths внутри выбранного проекта. Для внешних projections добавьте те же `--index`, `--vectors`, `--model-cache`, что в JSON-примере. Запуск: `dsh --profile web --patch ./cm-mcp.yml --no-open`. Model-facing имена: `mcp__cm__cm_retrieve_context` и `mcp__cm__cm_project_status`.

На Geo Dash проверены официальный stdio client, installed Harness SDK v2 и полный Web profile: статус, learned CPU retrieval, native HNSW и dispatch ToolRuntime. Отмена, scope, UTF-8 bounds, resource и отсутствие повторного тела проверены официальным in-memory client в [boundary tests](../tests/local_agent.test.ts). Без платной модели; интерфейс конкретного стороннего desktop-клиента не проверялся. Безопасные результаты — [evidence](../research/evidence/local-cm-mcp-atlas-2026-10-13.json).

Первичные инструкции: [MCP server development](https://modelcontextprotocol.io/docs/2026-07-28/develop/build-server), [официальный SDK](https://github.com/modelcontextprotocol/typescript-sdk).
