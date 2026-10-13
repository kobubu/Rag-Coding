# Первичные источники

Источники проверены при подготовке документов 13 октября 2026 года. Версии инструментов для реализации фиксируются отдельно в lock-файлах; ссылки на документацию не являются проверкой runtime проекта.

| Источник | Для какого решения используется |
|---|---|
| [Node.js releases](https://nodejs.org/en/about/previous-releases) | Node.js 24 LTS как целевая среда; Node.js 22 для совместимости документационных инструментов |
| [Node.js event loop](https://nodejs.org/en/learn/asynchronous-work/dont-block-the-event-loop) | CPU-intensive индексирование отделяется от HTTP обработчиков |
| [TypeScript NodeNext](https://www.typescriptlang.org/tsconfig/module.html) | ESM и разрешение модулей TS-инструментов |
| [Python 3.11 AST](https://docs.python.org/3.11/library/ast.html) | Синтаксические узлы и координаты Python; offsets столбцов относятся к UTF-8 |
| [Python 3.11 symtable](https://docs.python.org/3.11/library/symtable.html) | Области и классификация символов, включая free и nonlocal |
| [Tree-sitter](https://tree-sitter.github.io/tree-sitter/using-parsers/2-basic-parsing.html) | Синтаксическая структура для языковых адаптеров; semantic binding нужен отдельно |
| [SCIP](https://github.com/scip-code/scip) | Формат code intelligence для определений, употреблений и навигации |
| [TypeScript Compiler API](https://github.com/microsoft/TypeScript/wiki/Using-the-Compiler-API) | Первый адаптер структуры, символов и типов TS/TSX; текущий ограниченный probe |
| [Roslyn semantic model](https://learn.microsoft.com/en-us/dotnet/csharp/roslyn-sdk/work-with-semantics) | Возможный адаптер символов и семантики C# |
| [pgvector: hybrid search](https://github.com/pgvector/pgvector#hybrid-search) | Сочетание векторного и полнотекстового поиска |
| [cAST](https://aclanthology.org/2025.findings-emnlp.430/) | Рекурсивное структурное дробление и объединение соседних узлов |
| [GraphCoder](https://arxiv.org/abs/2406.07003) | Поиск контекста с учётом потока и зависимостей statements |
| [GraphRAG: query overview](https://microsoft.github.io/graphrag/query/overview/) | Разделение локального запроса и обзора всего корпуса |
| [RepoGraph](https://arxiv.org/abs/2410.14684) | Навигация по repository graph для поиска контекста при исправлении кода |
| [A2RAG v2](https://arxiv.org/abs/2601.21162) | Адаптивная достаточность evidence и адресное расширение; не собственное доказательство экономии CM |
| [GraphRAG DRIFT](https://microsoft.github.io/graphrag/query/drift_search/) | Альтернатива с дополнительными шагами; стоимость требует отдельного измерения |
| [Ajv JSON Schema](https://ajv.js.org/json-schema.html) | Ajv2020 для runtime-проверки draft 2020-12 контрактов |
| [Fastify](https://fastify.dev/docs/latest/) | Выбранная основа будущего Node.js API |
| [React with TypeScript](https://react.dev/learn/typescript) | Выбранная основа будущего viewer |

Результаты cAST и GraphCoder относятся к их экспериментам. Они мотивируют направление исследования, но не заменяют собственное измерение на целевых проектах.

Локальное изучение FlashMT описано в [research](../research/FLASHMT-ENRICHMENT.md), с revision, точными путями и сохранёнными метаданными. Сторонние исходники и private datasets сюда не копируются.
