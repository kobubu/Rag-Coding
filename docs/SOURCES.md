# Первичные источники

Источники проверены при подготовке документов 13 октября 2026 года. Версии инструментов для реализации фиксируются отдельно в lock-файлах; ссылки на документацию не являются проверкой runtime проекта.

| Источник | Для какого решения используется |
|---|---|
| [Python 3.11 AST](https://docs.python.org/3.11/library/ast.html) | Синтаксические узлы и координаты Python; offsets столбцов относятся к UTF-8 |
| [Python 3.11 symtable](https://docs.python.org/3.11/library/symtable.html) | Области и классификация символов, включая free и nonlocal |
| [Tree-sitter](https://tree-sitter.github.io/tree-sitter/using-parsers/2-basic-parsing.html) | Синтаксическая структура для языковых адаптеров; semantic binding нужен отдельно |
| [SCIP](https://github.com/scip-code/scip) | Формат code intelligence для определений, употреблений и навигации |
| [TypeScript Compiler API](https://github.com/microsoft/TypeScript/wiki/Using-the-Compiler-API) | Возможный адаптер структуры и типов TS/TSX |
| [Roslyn semantic model](https://learn.microsoft.com/en-us/dotnet/csharp/roslyn-sdk/work-with-semantics) | Возможный адаптер символов и семантики C# |
| [pgvector: hybrid search](https://github.com/pgvector/pgvector#hybrid-search) | Сочетание векторного и полнотекстового поиска |
| [cAST](https://aclanthology.org/2025.findings-emnlp.430/) | Рекурсивное структурное дробление и объединение соседних узлов |
| [GraphCoder](https://arxiv.org/abs/2406.07003) | Поиск контекста с учётом потока и зависимостей statements |
| [GraphRAG: query overview](https://microsoft.github.io/graphrag/query/overview/) | Разделение локального запроса и обзора всего корпуса |
| [jsonschema validation](https://python-jsonschema.readthedocs.io/en/stable/validate/) | Проверка JSON-примеров публичных контрактов |

Результаты cAST и GraphCoder относятся к их экспериментам. Они мотивируют направление исследования, но не заменяют собственное измерение на целевых проектах.

Локальное изучение FlashMT описано в [research](../research/FLASHMT-ENRICHMENT.md), с revision, точными путями и сохранёнными метаданными. Сторонние исходники и private datasets сюда не копируются.
