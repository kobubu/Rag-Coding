# CM в настоящих Codex и Claude Code: доставка кода и A/B

15 октября 2026. Три отдельные серии на копиях исходного Geo Dash: **48 стандартных сессий CM0.8.0 + 24 с явной CM-first процедурой + 24 после исправления доставки в CM0.8.1**. Используются реальные native CLI, инструменты и правки. Исходники оригинальной игры не меняются. Это bounded pilot по модулям одного репозитория, не игровой FPS benchmark.

По этому пилоту цель одновременного снижения времени и токенов при сохранении качества в native клиентах не достигнута. Доставка исходника исправлена; автоматическое применение CM и повторное использование полученного контекста требуют отдельной работы. Исходники игры сохранены, клиентские подключения обновлены для0.8.1.

## Стандартное подключение: 48 сессий

| Клиент | Группа | Правильные | Все токены | Время агента, с | List estimate, $ | CM вызовы |
|---|---|---:|---:|---:|---:|---:|
| codex | none | 11/12 | 1 704 300 | 776.0 | 0.0592 | 0 |
| codex | cm | 11/12 | 2 184 151 | 1005.2 | 0.0709 | 7 |
| claude | none | 12/12 | 799 504 | 318.5 | 0.8546 | 0 |
| claude | cm | 11/12 | 845 145 | 318.4 | 0.8659 | 0 |

codex: tokens +28.2%, agent time +29.5%, checked time +24.4%, list estimate +19.7%; успешные 11/12 → 11/12; CM использован в 7/12 sessions.

claude: tokens +5.7%, agent time -0.0%, checked time +1.5%, list estimate +1.3%; успешные 12/12 → 11/12; CM использован в 0/12 sessions.

CM подключён штатным MCP + installer skill, выбор инструмента свободный. В Claude все двенадцать CM sessions видели Connected server, оба tools и discovered skill; ноль retrieval calls означает отсутствие использования, а не поломку установки. Разница качества в таком случае не доказывает качество RAG: она включает обычную стохастику и влияние дополнительной инструкции/метаданных.

## Явная процедура: 24 сессии

В обеих группах одинаковое правило: если CM доступен, сначала один focused retrieve с бюджетом около 6000 source bytes; иначе обычные инструменты. Это follow-up после низкой самостоятельной adoption в Claude, зарегистрированный до завершения основной серии. Повторно используются те же задачи; это не новый held-out корпус. Первая серия не заменена.

| Клиент | Группа | Правильные | Все токены | Время агента, с | List estimate, $ | CM вызовы |
|---|---|---:|---:|---:|---:|---:|
| codex | none | 5/6 | 851 960 | 344.9 | 0.0287 | 0 |
| codex | cm | 6/6 | 919 430 | 377.8 | 0.0314 | 5 |
| claude | none | 6/6 | 393 298 | 134.8 | 0.4188 | 0 |
| claude | cm | 6/6 | 447 648 | 144.5 | 0.4292 | 6 |

codex: tokens +7.9%, agent time +9.5%, checked time +9.2%, list estimate +9.3%; успешные 5/6 → 6/6; CM использован в 4/6 sessions.

claude: tokens +13.8%, agent time +7.2%, checked time +8.8%, list estimate +2.5%; успешные 6/6 → 6/6; CM использован в 6/6 sessions.

## Исправление 0.8.1: 24 новые сессии

В 0.8.0 native Claude передавал модели structuredContent с метаданными, а исходник оставался в другой части MCP result. Например, результат называл 2887 source bytes, но model-visible tool_result содержал только 429-byte JSON без кода. Поэтому явный retrieve сопровождался Read того же файла. Старый SDK test намеренно запрещал source в structuredContent; реальная native session обнаружила несовместимость этого предположения.

В 0.8.1 добавлен structuredContent.source_context с тем же текстом, что в content. Snapshot/reference metadata сохранены, общий wire cap64000 bytes учитывает оба представления; алгоритм поиска, source budget, граф и task specs прежние. Новый unit test проверяет source в обоих каналах и одинаковое сокращение. До новых tasks native Claude действительно получил export function в model-visible tool_result; Codex тоже выполнил настоящий retrieve. [Доказательство](../evaluation/clients/fixed/source-delivery-proof.json).

Дополнительный контроль Codex: случайное неизвестное модели имя функции воспроизведено и на0.8.0, и на0.8.1 без обычных file tools. В forwarded Responses request это имя встретилось один раз в обеих версиях. Потеря кода подтверждена для Claude; этот контроль не обнаружил дублирования источника в контексте Codex. [До](../evaluation/clients/fixed/codex-canary-old.json), [после](../evaluation/clients/fixed/codex-canary-fixed.json).

Новые свежие balanced pairs используют то же условное правило, модели и исходники. Это post-diagnostic повтор на уже использованных задачах, не held-out обобщение; прежние отрицательные результаты не заменены. Оценка 0.8.0 в Claude описывает установленную версию с дефектом доставки, а не качество dense ranking полученного кодового контекста.

| Клиент | Группа | Правильные | Все токены | Время агента, с | List estimate, $ | CM вызовы |
|---|---|---:|---:|---:|---:|---:|
| codex | none | 6/6 | 743 732 | 348.6 | 0.0274 | 0 |
| codex | cm | 6/6 | 870 746 | 469.1 | 0.0289 | 2 |
| claude | none | 6/6 | 354 311 | 131.8 | 0.4094 | 0 |
| claude | cm | 5/6 | 327 786 | 128.3 | 0.3774 | 6 |

codex: tokens +17.1%, agent time +34.6%, checked time +29.7%, list estimate +5.7%; успешные 6/6 → 6/6; CM использован в 2/6 sessions.

claude: tokens -7.5%, agent time -2.7%, checked time +1.2%, list estimate -7.8%; успешные 6/6 → 5/6; CM использован в 6/6 sessions.

## Насколько устойчив результат

Основная серия, 12 пар / 6 задач на клиента:

- codex: 95% task-cluster bootstrap tokens [+7.4%; +52.7%], time [+6.9%; +65.0%]. Без первой пары: tokens +22.4%, time +23.6%. Ускорение в 3/12, экономия токенов в 3/12 пар.
- claude: 95% task-cluster bootstrap tokens [-8.7%; +23.6%], time [-15.3%; +14.4%]. Без первой пары: tokens +8.0%, time +3.5%. Ускорение в 8/12, экономия токенов в 3/12 пар.

Явная процедура, 6 пар / 6 задач на клиента:

- codex: 95% task-cluster bootstrap tokens [-26.5%; +66.5%], time [-20.7%; +64.2%]. Без первой пары: tokens -8.6%, time -4.0%. Ускорение в 4/6, экономия токенов в 3/6 пар.
- claude: 95% task-cluster bootstrap tokens [-5.7%; +49.4%], time [-6.0%; +22.8%]. Без первой пары: tokens +15.3%, time +9.5%. Ускорение в 2/6, экономия токенов в 3/6 пар.

Исправленная доставка, 6 пар / 6 задач на клиента:

- codex: 95% task-cluster bootstrap tokens [-6.9%; +52.6%], time [-0.2%; +78.3%]. Без первой пары: tokens +14.9%, time +30.7%. Ускорение в 1/6, экономия токенов в 2/6 пар.
- claude: 95% task-cluster bootstrap tokens [-27.6%; +18.5%], time [-15.0%; +10.8%]. Без первой пары: tokens -9.3%, time -1.9%. Ускорение в 2/6, экономия токенов в 2/6 пар.

Bootstrap описывает только эту небольшую выборку; модели и проект не дают основания обещать такие проценты везде. Модели различны: Codex — GPT-6 Luna / low, Claude Code — claude-sonnet-5-5 / low. Между клиентами нельзя приписывать разницу CM.

## Качество и все неудачи

Оценщик вне рабочей копии агента проверяет exports, порядок/NaN, не-мутирование, идемпотентность, валидные даты/квоты, аналитические sine extrema и interval snapshots; дополнительно 33 существующих регрессии и SHA scope audit. Для двух CPU-задач нужен ≥1,25×, построение compiled-input учитывается отдельно. Исходный вариант отклонён, отдельный reference прошёл для каждой задачи до основной серии. Ответ «готово» не считается доказательством.

- 0.8.0 стандартная, codex, quota-validation, repeat 2, none: Normalized counter and genuine grant slots; timeout=false, regressions=true, protected scope changes=0.
- 0.8.0 стандартная, codex, compiled-input, repeat 2, cm: Missing expected exception: Invalid variant; timeout=false, regressions=true, protected scope changes=0.
- 0.8.0 стандартная, claude, stats-linear, repeat 1, cm: Full statistics semantics; timeout=false, regressions=true, protected scope changes=0.
- 0.8.0 явная процедура, codex, compiled-input, repeat 1, none: Missing expected exception: Invalid variant; timeout=false, regressions=true, protected scope changes=0.
- 0.8.1 исправленная доставка, claude, stats-linear, repeat 1, cm: Full statistics semantics; timeout=false, regressions=true, protected scope changes=0.

Все неудачные валидные сессии включены в токены, цену и время. Semantic failures основной серии: Claude CM изменил поведение NaN в статистике без actual retrieve; Codex none во втором quota запуске искал ad grants по возвращаемому будущему дню вместо today и не учёл два сегодняшних слота при откате часов; Codex CM во втором compiled-input запуске не отклонил наследуемое имя варианта (в этом запуске retrieve также не вызывался). Все три прошли старые регрессии, но были отклонены независимым grader. Полные per-run результаты с CPU и adoption: [основная серия](../evaluation/clients/results.json), [явная процедура](../evaluation/clients/guided/results.json).

## По задачам

Основная:

| Клиент / задача | None → CM, успехи | None → CM, токены | None → CM, секунды |
|---|---:|---:|---:|
| codex / stats-linear | 2/2 → 2/2 | 369 149 → 426 143 | 208.7 → 211.0 |
| codex / wallet-deduplicate | 2/2 → 2/2 | 276 302 → 366 380 | 105.5 → 143.2 |
| codex / quota-validation | 1/2 → 2/2 | 312 420 → 545 562 | 127.6 → 264.6 |
| codex / motion-extrema | 2/2 → 2/2 | 182 200 → 278 327 | 103.9 → 132.3 |
| codex / own-city-grants | 2/2 → 2/2 | 254 168 → 285 347 | 85.8 → 105.1 |
| codex / compiled-input | 2/2 → 1/2 | 310 061 → 282 392 | 144.4 → 149.0 |
| claude / stats-linear | 2/2 → 1/2 | 110 303 → 97 378 | 45.1 → 33.2 |
| claude / wallet-deduplicate | 2/2 → 2/2 | 109 386 → 114 688 | 47.2 → 41.7 |
| claude / quota-validation | 2/2 → 2/2 | 246 350 → 252 313 | 73.3 → 93.7 |
| claude / motion-extrema | 2/2 → 2/2 | 110 564 → 148 612 | 58.4 → 61.1 |
| claude / own-city-grants | 2/2 → 2/2 | 111 685 → 148 556 | 46.2 → 38.9 |
| claude / compiled-input | 2/2 → 2/2 | 111 216 → 83 598 | 48.2 → 49.8 |


Явная процедура:

| Клиент / задача | None → CM, успехи | None → CM, токены | None → CM, секунды |
|---|---:|---:|---:|
| codex / stats-linear | 1/1 → 1/1 | 82 511 → 216 443 | 36.6 → 81.9 |
| codex / wallet-deduplicate | 1/1 → 1/1 | 106 246 → 176 908 | 31.7 → 66.0 |
| codex / quota-validation | 1/1 → 1/1 | 131 298 → 139 507 | 61.4 → 61.0 |
| codex / motion-extrema | 1/1 → 1/1 | 181 458 → 153 229 | 83.0 → 74.7 |
| codex / own-city-grants | 1/1 → 1/1 | 145 917 → 130 322 | 45.7 → 45.0 |
| codex / compiled-input | 0/1 → 1/1 | 204 530 → 103 021 | 86.5 → 49.2 |
| claude / stats-linear | 1/1 → 1/1 | 54 601 → 56 985 | 18.2 → 16.9 |
| claude / wallet-deduplicate | 1/1 → 1/1 | 55 405 → 55 142 | 16.5 → 22.0 |
| claude / quota-validation | 1/1 → 1/1 | 99 592 → 96 503 | 35.0 → 29.8 |
| claude / motion-extrema | 1/1 → 1/1 | 55 852 → 75 368 | 22.9 → 24.6 |
| claude / own-city-grants | 1/1 → 1/1 | 87 146 → 75 181 | 22.2 → 26.0 |
| claude / compiled-input | 1/1 → 1/1 | 40 702 → 88 469 | 20.1 → 25.2 |


Исправленная доставка:

| Клиент / задача | None → CM, успехи | None → CM, токены | None → CM, секунды |
|---|---:|---:|---:|
| codex / stats-linear | 1/1 → 1/1 | 80 159 → 108 384 | 35.5 → 59.8 |
| codex / wallet-deduplicate | 1/1 → 1/1 | 82 543 → 142 883 | 44.0 → 57.8 |
| codex / quota-validation | 1/1 → 1/1 | 193 796 → 168 750 | 70.7 → 113.6 |
| codex / motion-extrema | 1/1 → 1/1 | 149 304 → 116 368 | 94.1 → 69.9 |
| codex / own-city-grants | 1/1 → 1/1 | 143 571 → 177 529 | 45.5 → 101.1 |
| codex / compiled-input | 1/1 → 1/1 | 94 359 → 156 832 | 58.7 → 66.9 |
| claude / stats-linear | 1/1 → 0/1 | 41 769 → 44 375 | 17.5 → 16.1 |
| claude / wallet-deduplicate | 1/1 → 1/1 | 55 426 → 41 631 | 16.2 → 19.8 |
| claude / quota-validation | 1/1 → 1/1 | 104 925 → 62 013 | 35.5 → 26.9 |
| claude / motion-extrema | 1/1 → 1/1 | 55 817 → 61 280 | 20.8 → 22.2 |
| claude / own-city-grants | 1/1 → 1/1 | 55 629 → 59 528 | 18.2 → 19.1 |
| claude / compiled-input | 1/1 → 1/1 | 40 745 → 58 959 | 23.7 → 24.2 |


## Границы замера и настройки

Время агента — spawn→exit, включая MCP startup, retrieval, model/tool turns. Проверка результата и копирование считаются отдельно; checked time их включает. Каждый run — новый процесс; длинная интерактивная сессия с амортизацией startup отдельно не измерена. Лимиты: 240 с на session, 16 Responses calls на Codex run, Claude list-budget $0,75 на run. Готовый index/vector projection копируется; первичная индексация не измерена заново и не объявляется бесплатной. 502 текстовых файла, 226 индексируемых source files, без media/native build dependencies. Полный rebind после сохранённой правки остаётся отдельной затратой продукта.

Codex 0.162.1 запущен в MXC workspace-write с never approvals, отдельным CODEX_HOME и loopback Responses forwarding. Ключ только в памяти контроллеров; агенту доступен лишь локальный временный токен. Native usage сверяется с provider, cache read/write уже входят в input и повторно не складываются. Claude Code 2.1.288 использует native claude.ai auth, acceptEdits, strict MCP и ограниченные coding tools; uncached/read/write категории суммируются без повторов. Claude price — CLI list estimate, не денежное списание по подписке. Глобальный prompt cache не сбрасывается.

До правильной серии устранены read-only fallback встроенного Codex и зависание unelevated backend. Сохранены 5 недействительных диагностических сессий и 16 calibrations отдельно; известный setup расход 1 239 940 tokens / $0.2490 list estimate — нижняя граница из-за одного прерванного in-flight участка. Эта стоимость не смешана с валидными сессиями и не скрыта. [Диагностика](../evaluation/clients/setup-diagnostics.json).

Установленный CM 0.8.0 не менялся внутри первых двух серий; 0.8.1 установлен отдельно перед третьей, старый release сохранён. Обнаруженный file-snapshot expansion mismatch и фактические tool ошибки сохранены как ограничения; отсутствующие проверки whole-game/browser/device/других репозиториев не заменяются этими модульными тестами.

[Протокол и воспроизведение](../evaluation/clients/README.md) · [Основной протокол](../evaluation/clients/protocol.json) · [Протокол процедуры](../evaluation/clients/guided/protocol.json) · [Установка](INSTALL.md).
