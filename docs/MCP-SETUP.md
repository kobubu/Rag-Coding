# CM через локальный MCP

В 0.5.0 работает stdio-сервер на официальном TypeScript SDK 1.32.1. Клиент запускает отдельный Node.js процесс, который читает один заранее выбранный проект и его существующие CM/vector projections. Индекс и веса embedding-модели остаются на компьютере. Выбранный код попадает в контекст облачной модели, если MCP-клиент использует облачный LLM.

## Подготовка

Рекомендуется [Windows-установщик CM0.8.0](INSTALL.md): он готовит совместимый Node.js, веса, индексы и настройки Codex/Claude Code. Ниже сохранён ручной вариант: Node.js 24 либо 22 от 22.19, `npm ci`, `npm run build`, source index и vectors по [VECTOR-SEARCH](VECTOR-SEARCH.md). Cloud login и лицензирование запланированы. Для первого скачивания embedding weights используется отдельная индексирующая команда с явным разрешением загрузки. MCP ищет только с уже локальными weights.

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

С 0.8.1 код доступен и в текстовом `content`, и в `structuredContent.source_context`; текст этих представлений совпадает. Структурированный ответ также сохраняет snapshot и до 64 references. Это необходимо клиентам, которые передают модели именно structuredContent: в 0.8.0 native Claude получал только метаданные без исходника. Полный сериализованный retrieve result, включая оба представления, ограничен 64000 UTF-8 bytes. При сокращении оба представления обновляются, возвращаются omissions и `partial`; это не обещание полной программы в одном ответе. `max_bytes` — бюджет исходного контекста, не точное число LLM tokens. Новое представление само по себе не доказывает экономию токенов; проверяются реальные native sessions.

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

Проверка 13 октября на Geo Dash охватывала официальный stdio client, installed Harness SDK v2 и полный Web profile: статус, learned CPU retrieval, native HNSW и dispatch ToolRuntime. Тогда native model sessions Codex/Claude ещё не измерялись; исходные результаты — [evidence](../research/evidence/local-cm-mcp-atlas-2026-10-13.json). Текущие [boundary tests](../tests/local_agent.test.ts) проверяют отмену, scope, UTF-8, ресурс и наличие того же исходника в text/structured результатах с общим wire cap. Отдельное [нативное модельное исследование](CLIENTS-AB.md) раскрывает фактическую доставку кода, использование CM, качество, время и токены.

## Живая CM в 0.6.0

Добавьте `--auto-update true --memory-dir /absolute/cm-cache/project` для saved source refresh и `--retrieval-policy adaptive` для named/discovery routing. `--embedding-cache` задаёт reusable cache; `--source-scope game` ограничивает дерево. `cm_retrieve_context` принимает optional `detail: focused | expanded`, source snapshot проверяется до выдачи.

Read-only означает отсутствие правки исходников через MCP. Производные local indexes при включённом live update записывает сам локальный процесс. На копии Geo Dash официальный stdio client проверил: добавленный файл доступен по новому query, старый snapshot отклоняется, удаление публикуется. Модельный API в этой проверке не вызывался. [Алгоритм и пределы](LIVE-CM.md).

Первичные инструкции: [MCP server development](https://modelcontextprotocol.io/docs/2026-07-28/develop/build-server), [официальный SDK](https://github.com/modelcontextprotocol/typescript-sdk).
