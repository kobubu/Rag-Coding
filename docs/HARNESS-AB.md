# Сравнение Harness с CM и без CM

Сравниваются настоящие coding-agent sessions DeepSeek Harness, а не размеры файлов или синтетический ответ mock-модели. Текущий pilot использует GPT-6 Luna (`gpt-6-luna`), Responses API, reasoning low и установленный Harness 0.2.0-rc.2. [Официальная модель и цены](https://developers.openai.com/api/docs/models/gpt-6-luna), [Harness headless](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/bundle/headless/README.md).

## Что меняется между группами

| Параметр | A | B |
|---|---|---|
| Модель, reasoning, limits, задача | Одинаковые | Одинаковые |
| Исходные bytes и seeded regression | Одинаковые | Одинаковые |
| Обычные glob/grep/read/edit/write | Доступны | Доступны |
| CM tools | Отсутствуют | Зарегистрированы |
| Правило навигации | CM при наличии, иначе обычный поиск | То же правило |
| История | Свежая session | Свежая session |
| Проверка результата | Независимые behavioral checks | Те же checks |

Shell, web, subagents и автоматическая генерация заголовка отключены в обеих группах. Правка доступна через обычный sandboxed filesystem внутри экспериментальной копии. Исходный проект не является рабочим каталогом модели. CM остаётся read-only; он не расширяет права filesystem tools.

Начальный availability-only запуск показал, что агент может игнорировать новые инструменты. Поэтому общий prompt явно выбирает CM, если он доступен. Это сравнение двух заданных рабочих процессов. Оно не доказывает, что одно подключение плагина автоматически изменит поведение любой модели.

## Корпус и приёмка

Адаптер текущего CLI выбирает Git-tracked `game/**/*.js` из Geo Dash, копирует bytes и package.json, сохраняет revision, dirty status и manifest hashes. Assets, signing keys, account credentials и сторонние WIP не копируются. Оригинальные игровые файлы не правятся. Для другого устройства или проекта нужно определить свой reader/corpus; пути Geo Dash не зашиты в CM core.

Сначала независимые проверки проходят на исходном снимке. Для каждой задачи в отдельной копии вносится подтверждённая regression; проверки обязаны упасть до работы модели. После ответа той же модели evaluator выполняет checks в отдельном процессе. Модель не получает oracle и не оценивает себя. До основного запуска фиксируются prompts, oracle hash, метрики, число повторений и чередующийся порядок AB/BA.

Завершённый эксперимент: одна development-задача, семь отложенных regression tasks, по два повтора в обеих группах — 28 основных sessions. Development trace сохраняется отдельно и не входит в результат. Это pilot, не запланированный 40-задачный benchmark из [EVALUATION](EVALUATION.md). [Итог](AB-RESULTS.md) содержит все failures и ограничения; private source и raw traces остаются локально.

## Как считаются токены

`scripts/harness_meter.ts` наблюдает настоящий `llm/stream` и сохраняет финальные provider usage каждого вызова, включая retries. В Harness inputTokens означает uncached input. Cache read и cache write — отдельные счётчики; общий input равен сумме трёх. Output включает reported reasoning usage по правилам адаптера. Heuristic token-meter estimates не подменяют эти счётчики.

Публикуются total input, output, суммарные токены, cache read/write, calls, время, успешность внешних checks и фактические CM calls. Суммарный расход включает повторную отправку истории и tool schemas. Размер RAG context отдельно не равен расходу всей задачи. Unsuccessful sessions не удаляются; если provider usage отсутствует, сравнение токенов отмечается неполным.

Оценка USD использует ставки выбранной модели на дату эксперимента; это расчёт по reported tokens, не банковское списание или billing export. Кэш показывается отдельно, поскольку он влияет на цену даже при одинаковом количестве input tokens. Indexing CPU/time хранится отдельно от расходов модели. Небольшая выборка одного проекта не доказывает универсального выигрыша.

## Воспроизведение

Нужен Node.js 24 и installed Harness CLI. Ключ передаётся только через environment. На Windows можно взять его из буфера без вывода значения:

```powershell
$env:CM_AB_API_KEY = (Get-Clipboard -Raw).Trim()
npm.cmd run build
npm.cmd run harness:ab -- --project "D:/Geo Dash" `
  --output ".artifacts/new-ab-run" `
  --harness ".artifacts/dsh-stand/node_modules/@deepseek-ai/dsh/lib/bin.js" `
  --cases ".artifacts/geo-ab/holdout-cases.json" `
  --oracle ".artifacts/geo-ab/oracle.mjs"
```

Output directory должен быть новым. Raw prompts, project snapshots, patches и session logs остаются в `.artifacts/`; private исходники и ключи не публикуются автоматически. В Git можно сохранить reusable runner, протокол и агрегированные результаты. API key не записывается в profile patch, отчёт, stdout или Git; profile содержит только имя credential reference.

Основные артефакты: corpus-manifest.json, frozen-protocol.json, implementation-manifest.json, preparation-checks.json, results.json, progress.json и per-run meter/process-result/stdout. При переносе нужно явно передать свой trusted oracle; runner исполняет его как независимую проверку.

Пределы pilot: 12 model calls и 8192 output tokens на запрос, 180 секунд на session, остановка между sessions после достижения USD 5 по рассчитанным счётчикам. Этот предел не является банковским spending limit. После правки исходника старый CM snapshot отклоняется; автоматический reindex пока не входит в этот experiment protocol.
