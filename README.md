# Центр аналитики

Новый dashboard-шаблон на базе переиспользуемого ядра [In.Plan Dashboard](https://github.com/vasgrishin-a11y/inplan-dashboard), но без его предметных KPI, названий вкладок и модели данных. Проект — обычный статический HTML/ES modules без сборщика и тяжёлых chart-библиотек.

## Запуск

```bash
npm install
npm test
npm start
```
Откройте `http://localhost:8080`.

## Где настраивать продукт

- `src/config.js` — название (`title`), вкладки, KPI и фильтры.
- `src/data.js` — демо-схема, нормализация XLSX и применение фильтров.
- `src/app.js` — компоновка экранов и бизнес-логика конкретного шаблона.
- `src/charts.js` — лёгкий canvas-движок: `line`, `bar`, `donut`; сюда добавляются pareto, heatmap, waterfall и dumbbell по тому же паттерну.
- `assets/xlsx.full.min.js` — локальный SheetJS для загрузки XLSX; менять схему колонок нужно в `normalizeRows`.
- `src/clickhouse.js` — безопасная заготовка HTTP-коннектора. URL, SQL и преобразование результата подключаются здесь, когда появится новая схема ClickHouse.
- `src/storage.js` — изолированное хранение темы, фильтров, активной вкладки и положения меню.

## Что перенесено из ядра

Сохранены общие подходы исходного dashboard: самостоятельный canvas-рендеринг без тяжёлой зависимости (bar, line, donut и расширяемый реестр pareto, heatmap, waterfall, dumbbell), responsive canvas и доступные `role="img"`/`aria-label`, локальный XLSX, числовые/строковые utility-паттерны (`assets/dashboard-common.js`), фильтры с состоянием, тема, localStorage, адаптивный layout, KPI-карточки, таблицы, quality-блок и ClickHouse adapter.

Предметные сущности In.Plan намеренно не переносятся: новый проект использует нейтральные `period / category / region / actual / plan`. Дальнейшие KPI и SQL задаются отдельно от ядра.
