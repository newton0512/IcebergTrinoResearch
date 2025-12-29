# Hybrid Writer Worker

Воркер для обработки сообщений из RabbitMQ и записи данных в Trino/Iceberg.

## Описание

Воркер получает сообщения из очереди RabbitMQ с данными:
- `registrar_type_id` - тип регистратора
- `registrar_id` - ID регистратора (UUID)
- `row` - номер строки
- `amount` - сумма

Для каждого сообщения:
1. Генерирует полный объект через `bonus_registry_faker()`
2. Дополняет его полями из сообщения
3. Записывает в таблицу Trino/Iceberg `bonus_registry`

## Установка зависимостей

```bash
pnpm install
```

## Запуск RabbitMQ

```bash
# Запуск только RabbitMQ
pnpm run compose:rabbitmq

# Или запуск всех сервисов
pnpm run compose:up
```

RabbitMQ будет доступен:
- AMQP порт: `localhost:5672`
- Management UI: `http://localhost:15672` (guest/guest)

## Запуск воркера

### Один экземпляр

```bash
pnpm run worker
```

### Несколько экземпляров

Можно запустить несколько экземпляров воркера для параллельной обработки:

```bash
# Терминал 1
pnpm run worker

# Терминал 2
pnpm run worker

# Терминал 3
pnpm run worker
```

RabbitMQ автоматически распределит сообщения между воркерами.

### С переменными окружения

```bash
RABBITMQ_HOST=localhost \
RABBITMQ_PORT=5672 \
RABBITMQ_USERNAME=guest \
RABBITMQ_PASSWORD=guest \
RABBITMQ_QUEUE=bonus_registry_queue \
TRINO_HOST=localhost \
TRINO_PORT=8080 \
TRINO_CATALOG=iceberg \
TRINO_SCHEMA=warehouse \
TRINO_USER=trino \
TRINO_TABLE=bonus_registry \
pnpm run worker
```

## Формат сообщения

Сообщения в очереди должны быть в формате JSON:

```json
{
  "registrar_type_id": "bsBonusDocument",
  "registrar_id": "550e8400-e29b-41d4-a716-446655440000",
  "row": 1,
  "amount": 1500
}
```

## Пример отправки сообщения

### Через Management UI

1. Откройте `http://localhost:15672`
2. Перейдите в раздел "Queues"
3. Выберите очередь `bonus_registry_queue`
4. Нажмите "Publish message"
5. Вставьте JSON сообщение

### Через amqplib (Node.js)

```typescript
import * as amqp from "amqplib";

async function sendMessage() {
  const connection = await amqp.connect("amqp://guest:guest@localhost:5672");
  const channel = await connection.createChannel();
  
  await channel.assertQueue("bonus_registry_queue", { durable: true });
  
  const message = {
    registrar_type_id: "bsBonusDocument",
    registrar_id: "550e8400-e29b-41d4-a716-446655440000",
    row: 1,
    amount: 1500,
  };
  
  channel.sendToQueue(
    "bonus_registry_queue",
    Buffer.from(JSON.stringify(message)),
    { persistent: true }
  );
  
  console.log("Message sent");
  await channel.close();
  await connection.close();
}

sendMessage();
```

## Graceful Shutdown

Воркер обрабатывает сигналы `SIGINT` и `SIGTERM` для корректного завершения:
- Завершает обработку текущих сообщений
- Закрывает соединения с RabbitMQ и Trino
- Не теряет сообщения (они остаются в очереди)

## Мониторинг

- Логи воркера выводятся в консоль с указанием PID процесса
- Успешная обработка: `✓ Message processed successfully`
- Ошибки: `✗ Error processing message`

## Производительность

- Prefetch: 10 сообщений одновременно на воркер
- Можно запускать несколько экземпляров для масштабирования
- Сообщения распределяются между воркерами автоматически

