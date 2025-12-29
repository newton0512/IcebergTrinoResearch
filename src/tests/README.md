# Unit Tests

Этот каталог содержит unit-тесты для основных компонентов проекта.

## Структура тестов

- **`utils.test.ts`** - Тесты для утилитных функций из `hybrid-writer/utils.ts`:
  - `hashObject()` - хэширование объектов
  - `generateRegistrarObject()` - генерация объектов регистратора
  - `bonus_registry_faker()` - генерация данных через faker

- **`saga-manager.test.ts`** - Тесты для `SagaManager` класса:
  - `beginSaga()` - начало саги
  - `addOperation()` - добавление операции
  - `addBatchOperations()` - добавление batch операций
  - `commitSaga()` - коммит саги
  - `rollbackSaga()` - откат саги
  - `getSagaId()` - получение ID саги
  - `getOperationsCount()` - получение количества операций

- **`hybrid-writer.test.ts`** - Тесты для `HybridWriter` класса:
  - `constructor()` - создание экземпляра
  - `connect()` - подключение к сервисам
  - `disconnect()` - отключение от сервисов
  - `write()` - запись данных
  - `writeAsync()` - асинхронная запись
  - `writeBatch()` - пакетная запись

## Запуск тестов

```bash
# Запустить все тесты
pnpm test

# Запустить тесты в watch режиме
pnpm test:watch

# Запустить только unit-тесты из src/tests
pnpm test src/tests
```

## Покрытие кода

Для просмотра покрытия кода:

```bash
pnpm test --coverage
```

## Примечания

- Тесты используют моки для внешних зависимостей (PostgreSQL, Trino, RabbitMQ)
- Тесты для `HybridWriter` проверяют базовую функциональность без реальных подключений
- Для полного тестирования интеграции с БД используйте интеграционные тесты

