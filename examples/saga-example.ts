/**
 * Примеры использования модуля управления Saga
 *
 * Демонстрирует:
 * 1. Одиночную операцию (успешный сценарий)
 * 2. Batch операций (успешный сценарий)
 * 3. Сценарий с ошибкой и откатом
 */

import postgres from "postgres";
import { SagaManager, type SagaOperation } from "../src/saga/index.js";

// Подключение к PostgreSQL
const sql = postgres({
  host: "localhost",
  port: 5432,
  database: "appdb",
  username: "postgres",
  password: "postgres",
});

// Вспомогательная функция для создания таблицы пользователей (для примера)
async function setupExampleTable(): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      email VARCHAR(255) NOT NULL UNIQUE,
      balance DECIMAL(10, 2) DEFAULT 0
    )
  `;
  console.log("✓ Table 'users' ready");
}

// Вспомогательная функция для очистки таблицы
async function cleanupExampleTable(): Promise<void> {
  await sql`DROP TABLE IF EXISTS users CASCADE`;
  console.log("✓ Table 'users' cleaned up");
}

/**
 * Пример 1: Одиночная операция (успешный сценарий)
 */
async function exampleSingleOperation(): Promise<void> {
  console.log("\n=== Пример 1: Одиночная операция (успешный сценарий) ===");

  const sagaManager = new SagaManager(sql);

  try {
    // Начинаем сагу
    const sagaId = await sagaManager.beginSaga({
      description: "Create user operation",
    });
    console.log(`✓ Saga started: ${sagaId}`);

    // Определяем операцию создания пользователя
    let userId: number | null = null;

    const createUserOperation: SagaOperation<number> = {
      id: "create-user",
      execute: async () => {
        const result = await sql`
          INSERT INTO users (name, email, balance)
          VALUES ('John Doe', 'john@example.com', 100.00)
          RETURNING id
        `;
        userId = result[0].id;
        console.log(`✓ User created with ID: ${userId}`);
        return userId;
      },
      compensate: async (data) => {
        if (data) {
          await sql`DELETE FROM users WHERE id = ${data}`;
          console.log(`✓ User ${data} deleted (compensation)`);
        }
      },
    };

    // Добавляем операцию в сагу
    sagaManager.addOperation(createUserOperation);

    // Завершаем сагу (выполняет операцию и коммитит)
    const result = await sagaManager.commitSaga();
    console.log(`✓ Saga committed: ${JSON.stringify(result)}`);
  } catch (error) {
    console.error("✗ Error:", error);
  }
}

/**
 * Пример 2: Batch операций (успешный сценарий)
 */
async function exampleBatchOperations(): Promise<void> {
  console.log("\n=== Пример 2: Batch операций (успешный сценарий) ===");

  const sagaManager = new SagaManager(sql);

  try {
    // Начинаем сагу
    const sagaId = await sagaManager.beginSaga({
      description: "Create multiple users batch operation",
    });
    console.log(`✓ Saga started: ${sagaId}`);

    // Создаём массив операций
    const users = [
      { name: "Alice", email: "alice@example.com", balance: 200.0 },
      { name: "Bob", email: "bob@example.com", balance: 150.0 },
      { name: "Charlie", email: "charlie@example.com", balance: 300.0 },
    ];

    const operations: SagaOperation<number>[] = users.map((user, index) => {
      let userId: number | null = null;

      return {
        id: `create-user-${index}`,
        execute: async () => {
          const result = await sql`
            INSERT INTO users (name, email, balance)
            VALUES (${user.name}, ${user.email}, ${user.balance})
            RETURNING id
          `;
          userId = result[0].id;
          console.log(`✓ User ${user.name} created with ID: ${userId}`);
          return userId;
        },
        compensate: async (data) => {
          if (data) {
            await sql`DELETE FROM users WHERE id = ${data}`;
            console.log(`✓ User ${data} deleted (compensation)`);
          }
        },
      };
    });

    // Добавляем batch операций
    sagaManager.addBatchOperations(operations);

    // Завершаем сагу
    const result = await sagaManager.commitSaga();
    console.log(`✓ Saga committed: ${JSON.stringify(result)}`);
    console.log(`✓ Created ${result.operationsCount} users`);
  } catch (error) {
    console.error("✗ Error:", error);
  }
}

/**
 * Пример 3: Сценарий с ошибкой и откатом
 */
async function exampleErrorAndRollback(): Promise<void> {
  console.log("\n=== Пример 3: Сценарий с ошибкой и откат ===");

  const sagaManager = new SagaManager(sql);

  try {
    // Начинаем сагу
    const sagaId = await sagaManager.beginSaga({
      description: "Transfer money operation with error",
    });
    console.log(`✓ Saga started: ${sagaId}`);

    let fromUserId: number | null = null;
    let toUserId: number | null = null;

    // Операция 1: Создание первого пользователя
    const createUser1Operation: SagaOperation<number> = {
      id: "create-user-1",
      execute: async () => {
        const result = await sql`
          INSERT INTO users (name, email, balance)
          VALUES ('Sender', 'sender@example.com', 500.00)
          RETURNING id
        `;
        fromUserId = result[0].id;
        console.log(`✓ User 1 created with ID: ${fromUserId}`);
        return fromUserId;
      },
      compensate: async (data) => {
        if (data) {
          await sql`DELETE FROM users WHERE id = ${data}`;
          console.log(`✓ User ${data} deleted (compensation)`);
        }
      },
    };

    // Операция 2: Создание второго пользователя
    const createUser2Operation: SagaOperation<number> = {
      id: "create-user-2",
      execute: async () => {
        const result = await sql`
          INSERT INTO users (name, email, balance)
          VALUES ('Receiver', 'receiver@example.com', 100.00)
          RETURNING id
        `;
        toUserId = result[0].id;
        console.log(`✓ User 2 created with ID: ${toUserId}`);
        return toUserId;
      },
      compensate: async (data) => {
        if (data) {
          await sql`DELETE FROM users WHERE id = ${data}`;
          console.log(`✓ User ${data} deleted (compensation)`);
        }
      },
    };

    // Операция 3: Перевод денег (с намеренной ошибкой)
    const transferOperation: SagaOperation<void> = {
      id: "transfer-money",
      execute: async () => {
        // Имитируем ошибку (например, недостаточно средств или сетевая ошибка)
        throw new Error("Insufficient funds or network error");
      },
      compensate: async () => {
        // Компенсация не требуется, так как операция не выполнилась
        console.log("✓ Transfer operation compensation skipped (operation failed)");
      },
    };

    // Добавляем операции
    sagaManager.addOperation(createUser1Operation);
    sagaManager.addOperation(createUser2Operation);
    sagaManager.addOperation(transferOperation);

    // Пытаемся закоммитить (вызовет ошибку и откат)
    try {
      await sagaManager.commitSaga();
    } catch (error) {
      console.log(`✗ Error during commit: ${error instanceof Error ? error.message : String(error)}`);
      console.log("✓ Rollback will be triggered automatically");
    }

    // Проверяем, что пользователи были удалены (компенсация выполнена)
    const remainingUsers = await sql`SELECT COUNT(*) as count FROM users WHERE id IN (${fromUserId}, ${toUserId})`;
    console.log(`✓ Remaining users after rollback: ${remainingUsers[0].count}`);
  } catch (error) {
    console.error("✗ Unexpected error:", error);
  }
}

/**
 * Пример 4: Комплексный сценарий с несколькими операциями и частичным откатом
 */
async function exampleComplexScenario(): Promise<void> {
  console.log("\n=== Пример 4: Комплексный сценарий ===");

  const sagaManager = new SagaManager(sql);

  try {
    const sagaId = await sagaManager.beginSaga({
      description: "Complex multi-step operation",
    });
    console.log(`✓ Saga started: ${sagaId}`);

    // Операция 1: Создание пользователя
    const createUserOp: SagaOperation<number> = {
      id: "create-user",
      execute: async () => {
        const result = await sql`
          INSERT INTO users (name, email, balance)
          VALUES ('Complex User', 'complex@example.com', 1000.00)
          RETURNING id
        `;
        console.log(`✓ User created: ${result[0].id}`);
        return result[0].id;
      },
      compensate: async (data) => {
        if (data) {
          await sql`DELETE FROM users WHERE id = ${data}`;
          console.log(`✓ User ${data} deleted (compensation)`);
        }
      },
    };

    // Операция 2: Обновление баланса
    const updateBalanceOp: SagaOperation<void> = {
      id: "update-balance",
      execute: async () => {
        // Эта операция будет выполнена только если createUserOp успешна
        await sql`UPDATE users SET balance = balance + 500 WHERE email = 'complex@example.com'`;
        console.log("✓ Balance updated");
      },
      compensate: async () => {
        await sql`UPDATE users SET balance = balance - 500 WHERE email = 'complex@example.com'`;
        console.log("✓ Balance update reverted (compensation)");
      },
    };

    sagaManager.addOperation(createUserOp);
    sagaManager.addOperation(updateBalanceOp);

    const result = await sagaManager.commitSaga();
    console.log(`✓ Saga committed successfully: ${JSON.stringify(result)}`);
  } catch (error) {
    console.error("✗ Error:", error);
  }
}

/**
 * Главная функция для запуска всех примеров
 */
async function main(): Promise<void> {
  try {
    // Настройка
    await setupExampleTable();

    // Запуск примеров
    await exampleSingleOperation();
    await exampleBatchOperations();
    await exampleErrorAndRollback();
    await exampleComplexScenario();

    // Очистка (опционально)
    // await cleanupExampleTable();
  } catch (error) {
    console.error("Fatal error:", error);
  } finally {
    await sql.end();
  }
}

// Запуск примеров
main().catch(console.error);

export {
  exampleSingleOperation,
  exampleBatchOperations,
  exampleErrorAndRollback,
  exampleComplexScenario,
};

