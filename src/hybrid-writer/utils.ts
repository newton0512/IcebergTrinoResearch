import { createHash, randomUUID } from "crypto";
import { faker } from "@faker-js/faker";
import { Trino } from "trino-client";
import { escapeTrinoIdentifier, escapeTrinoLiteral } from "../generator/escape.js";

/**
 * Вычисляет хэш объекта на основе его значений.
 * Поля объекта могут быть строковыми или числовыми.
 * 
 * @param obj - Объект для хэширования
 * @returns Хэш-строка (hex)
 * 
 * @example
 * ```ts
 * const hash1 = hashObject({ name: "John", age: 30 });
 * const hash2 = hashObject({ age: 30, name: "John" }); // Тот же хэш (порядок ключей не важен)
 * ```
 */
export function hashObject(obj: Record<string, string | number>): string {
  // Сортируем ключи для консистентности (одинаковые объекты дают одинаковый хэш)
  const sortedKeys = Object.keys(obj).sort();
  
  // Создаем строковое представление объекта
  const str = sortedKeys
    .map((key) => `${key}:${String(obj[key])}`)
    .join("|");
  
  // Вычисляем SHA256 хэш
  return createHash("sha256").update(str).digest("hex");
}

/**
 * Список допустимых значений для registrar_type_id
 */
const REGISTRAR_TYPE_IDS = [
  "bsBonusReceiveForTrip",
  "bsRecoveryRequestDoc",
  "bsTripForBonusDoc",
  "bsBonusDocument",
  "bsCustomTransaction",
  "bsCharityDocument",
  "bsExpirationDocument",
  "bsReturnDocument",
  "bsSurveyDoc",
  "bsCompensationDoc",
  "bsSouvenirRequest",
  "bsAdvanceDoc",
  "bsReturnAdvanceDoc",
] as const;

/**
 * Тип объекта, генерируемого функцией generateRegistrarObject
 */
export interface RegistrarObject {
  registrar_type_id: string;
  registrar_id: string;
  row: number;
}

/**
 * Генерирует объект с полями registrar_type_id, registrar_id и row.
 * 
 * - registrar_type_id: случайный выбор из предопределенного списка
 * - registrar_id: UUID v4
 * - row: случайное число от 1 до 10 (включительно)
 * 
 * @returns Объект с полями registrar_type_id, registrar_id и row
 * 
 * @example
 * ```ts
 * const obj = generateRegistrarObject();
 * // { registrar_type_id: "bsBonusDocument", registrar_id: "550e8400-e29b-41d4-a716-446655440000", row: 5 }
 * ```
 */
export function generateRegistrarObject(): RegistrarObject {
  // Случайный выбор из списка registrar_type_id
  const registrarTypeId =
    REGISTRAR_TYPE_IDS[
      Math.floor(Math.random() * REGISTRAR_TYPE_IDS.length)
    ] as string;

  // Генерация UUID
  const registrarId = randomUUID();

  // Случайное число от 1 до 10 (включительно)
  const row = Math.floor(Math.random() * 10) + 1;

  return {
    registrar_type_id: registrarTypeId,
    registrar_id: registrarId,
    row,
  };
}

/**
 * Тип объекта bonus_registry, генерируемого функцией bonus_registry_faker
 */
export interface BonusRegistryFakerObject {
  id: string;
  date: Date | null;
  registrar_type_id: string | null;
  registrar_id: string | null;
  row: number | null;
  manager_id: number | null;
  bs_profile_id: string;
  accounted_for_bs_profile_id: string;
  first_name: string | null;
  first_name_latin: string | null;
  last_name: string | null;
  last_name_latin: string | null;
  departure_id: number | null;
  arrival_id: number | null;
  departure_date: Date | null;
  currency_entry_id: number | null;
  bonus_type_id: string;
  action_source_id: string;
  bs_bonus_ticket_id: string | null;
  validity_time: number | null;
  date_of_expire: Date | null;
  car_type_id: string | null;
  express_carrier_id: number | null;
  carrier_id: string | null;
  bs_partner_id: number | null;
  bs_train_number_id: string | null;
  bs_tourism_train_id: string | null;
  accounted_in_calculation: boolean | null;
  cancelled: boolean | null;
  bs_quota_id: number | null;
  doc_to_track_type_id: string;
  doc_to_track_id: string;
  doc_to_track_date: Date | null;
  active_date: Date | null;
  trip_for_another_person: boolean | null;
  ticket_number: string | null;
  currency_amount: number | null;
  amount: number;
  bs_partner_bonus_type_id: string | null;
  express_service_class_id: number | null;
  date_to_cancelled: Date | null;
  prolongable: boolean | null;
  active_by_trips: boolean | null;
  is_empty: boolean | null;
  amount_calculation: string | null;
  distance: number | null;
  addition_amount: number | null;
  operation_doc_type_id: string | null;
  is_merged: boolean | null;
  merged_date: Date | null;
}

/**
 * Списки допустимых значений для различных полей
 */
const BONUS_TYPE_IDS = ["premial", "qualification"] as const;
const ACTION_SOURCE_IDS = ["operator", "auto"] as const;
const CARRIER_IDS = ["fpk", "tver", "rzd"] as const;
const OPERATION_DOC_TYPE_IDS = [
  "operation_transfer",
  "operation_status_assignment",
  "operation_manual_bonus",
] as const;

/**
 * Генерирует объект bonus_registry с использованием библиотеки faker.
 * 
 * @returns Объект с полями bonus_registry
 * 
 * @example
 * ```ts
 * const entry = bonus_registry_faker();
 * // { id: "cmjb6eclk000nuhb4xbdid0o2", date: "2025-12-18T05:25:49.387Z", ... }
 * ```
 */
export function bonus_registry_faker(): BonusRegistryFakerObject {
  // Генерируем базовые поля
  const id = randomUUID();
  
  // Обязательные поля (setRequired() в схеме)
  const bsProfileId = faker.string.uuid();
  const accountedForBsProfileId = bsProfileId; // Обычно совпадает с bsProfileId
  const bonusTypeId = faker.helpers.arrayElement(BONUS_TYPE_IDS);
  const actionSourceId = faker.helpers.arrayElement(ACTION_SOURCE_IDS);
  const docToTrackTypeId = faker.helpers.arrayElement(REGISTRAR_TYPE_IDS);
  const docToTrackId = randomUUID();
  const amount = faker.number.int({ min: 100, max: 10000 }); // required, NumberType.Money

  // Опциональные поля (могут быть null)
  const date = faker.datatype.boolean({ probability: 0.8 }) 
    ? faker.date.recent({ days: 30 }) 
    : null;
  const registrarTypeId = faker.datatype.boolean({ probability: 0.8 }) 
    ? faker.helpers.arrayElement(REGISTRAR_TYPE_IDS) 
    : null;
  const registrarId = faker.datatype.boolean({ probability: 0.8 }) 
    ? randomUUID() 
    : null;
  const row = faker.datatype.boolean({ probability: 0.8 }) 
    ? faker.number.int({ min: 1, max: 10 }) 
    : null;
  const managerId = faker.datatype.boolean({ probability: 0.7 }) 
    ? faker.number.int({ min: 1, max: 1000 }) 
    : null;
  const firstName = faker.datatype.boolean({ probability: 0.6 }) 
    ? faker.person.firstName() 
    : null;
  const firstNameLatin = faker.datatype.boolean({ probability: 0.6 }) 
    ? faker.person.firstName() 
    : null;
  const lastName = faker.datatype.boolean({ probability: 0.6 }) 
    ? faker.person.lastName() 
    : null;
  const lastNameLatin = faker.datatype.boolean({ probability: 0.6 }) 
    ? faker.person.lastName() 
    : null;
  const departureId = faker.datatype.boolean({ probability: 0.5 }) 
    ? faker.number.int({ min: 1, max: 100 }) 
    : null;
  const arrivalId = faker.datatype.boolean({ probability: 0.5 }) 
    ? faker.number.int({ min: 1, max: 100 }) 
    : null;
  const departureDate = faker.datatype.boolean({ probability: 0.5 }) 
    ? faker.date.recent({ days: 30 }) 
    : null;
  const currencyEntryId = faker.datatype.boolean({ probability: 0.5 }) 
    ? faker.number.int({ min: 1, max: 10 }) 
    : null;
  const bsBonusTicketId = faker.datatype.boolean({ probability: 0.2 }) 
    ? randomUUID() 
    : null;
  const validityTime = faker.datatype.boolean({ probability: 0.4 }) 
    ? faker.number.int({ min: 30, max: 365 }) 
    : null;
  const dateOfExpire = faker.datatype.boolean({ probability: 0.4 }) 
    ? faker.date.future({ years: 1 }) 
    : null;
  const carTypeId = faker.datatype.boolean({ probability: 0.2 }) 
    ? faker.string.alphanumeric({ length: { min: 5, max: 10 } }) 
    : null;
  const expressCarrierId = faker.datatype.boolean({ probability: 0.3 }) 
    ? faker.number.int({ min: 1, max: 50 }) 
    : null;
  const carrierId = faker.datatype.boolean({ probability: 0.4 }) 
    ? faker.helpers.arrayElement(CARRIER_IDS) 
    : null;
  const bsPartnerId = faker.datatype.boolean({ probability: 0.3 }) 
    ? faker.number.int({ min: 1, max: 20 }) 
    : null;
  const bsTrainNumberId = faker.datatype.boolean({ probability: 0.2 }) 
    ? faker.string.alphanumeric({ length: { min: 5, max: 15 } }) 
    : null;
  const bsTourismTrainId = faker.datatype.boolean({ probability: 0.2 }) 
    ? faker.string.alphanumeric({ length: { min: 5, max: 15 } }) 
    : null;
  const accountedInCalculation = faker.datatype.boolean({ probability: 0.3 }) 
    ? faker.datatype.boolean() 
    : null;
  const cancelled = faker.datatype.boolean({ probability: 0.3 }) 
    ? faker.datatype.boolean() 
    : null;
  const bsQuotaId = faker.datatype.boolean({ probability: 0.2 }) 
    ? faker.number.int({ min: 1, max: 100 }) 
    : null;
  const docToTrackDate = faker.datatype.boolean({ probability: 0.5 }) 
    ? faker.date.recent({ days: 30 }) 
    : null;
  const activeDate = faker.datatype.boolean({ probability: 0.3 }) 
    ? faker.date.recent({ days: 30 }) 
    : null;
  const tripForAnotherPerson = faker.datatype.boolean({ probability: 0.3 }) 
    ? faker.datatype.boolean() 
    : null;
  const ticketNumber = faker.datatype.boolean({ probability: 0.2 }) 
    ? faker.string.alphanumeric({ length: { min: 10, max: 20 } }) 
    : null;
  const currencyAmount = faker.datatype.boolean({ probability: 0.2 }) 
    ? faker.number.int({ min: 100, max: 10000 }) 
    : null;
  const bsPartnerBonusTypeId = faker.datatype.boolean({ probability: 0.2 }) 
    ? faker.string.alphanumeric({ length: { min: 5, max: 15 } }) 
    : null;
  const expressServiceClassId = faker.datatype.boolean({ probability: 0.2 }) 
    ? faker.number.int({ min: 1, max: 5 }) 
    : null;
  const dateToCancelled = faker.datatype.boolean({ probability: 0.1 }) 
    ? faker.date.future({ years: 1 }) 
    : null;
  const prolongable = faker.datatype.boolean({ probability: 0.3 }) 
    ? faker.datatype.boolean() 
    : null;
  const activeByTrips = faker.datatype.boolean({ probability: 0.3 }) 
    ? faker.datatype.boolean() 
    : null;
  const isEmpty = faker.datatype.boolean({ probability: 0.3 }) 
    ? faker.datatype.boolean() 
    : null;
  const amountCalculation = faker.datatype.boolean({ probability: 0.3 }) 
    ? JSON.stringify({ 
        method: faker.helpers.arrayElement(["fixed", "percentage", "distance"]),
        value: faker.number.int({ min: 1, max: 100 })
      }) 
    : null;
  const distance = faker.datatype.boolean({ probability: 0.3 }) 
    ? faker.number.int({ min: 100, max: 5000 }) 
    : null;
  const additionAmount = faker.datatype.boolean({ probability: 0.2 }) 
    ? faker.number.int({ min: 10, max: 500 }) 
    : null;
  const operationDocTypeId = faker.datatype.boolean({ probability: 0.7 }) 
    ? faker.helpers.arrayElement(OPERATION_DOC_TYPE_IDS) 
    : null;
  const isMerged = faker.datatype.boolean({ probability: 0.3 }) 
    ? faker.datatype.boolean() 
    : null;
  const mergedDate = faker.datatype.boolean({ probability: 0.1 }) 
    ? faker.date.recent({ days: 30 }) 
    : null;

  return {
    id,
    date,
    registrar_type_id: registrarTypeId,
    registrar_id: registrarId,
    row,
    manager_id: managerId,
    bs_profile_id: bsProfileId,
    accounted_for_bs_profile_id: accountedForBsProfileId,
    first_name: firstName,
    first_name_latin: firstNameLatin,
    last_name: lastName,
    last_name_latin: lastNameLatin,
    departure_id: departureId,
    arrival_id: arrivalId,
    departure_date: departureDate,
    currency_entry_id: currencyEntryId,
    bonus_type_id: bonusTypeId,
    action_source_id: actionSourceId,
    bs_bonus_ticket_id: bsBonusTicketId,
    validity_time: validityTime,
    date_of_expire: dateOfExpire,
    car_type_id: carTypeId,
    express_carrier_id: expressCarrierId,
    carrier_id: carrierId,
    bs_partner_id: bsPartnerId,
    bs_train_number_id: bsTrainNumberId,
    bs_tourism_train_id: bsTourismTrainId,
    accounted_in_calculation: accountedInCalculation,
    cancelled,
    bs_quota_id: bsQuotaId,
    doc_to_track_type_id: docToTrackTypeId,
    doc_to_track_id: docToTrackId,
    doc_to_track_date: docToTrackDate,
    active_date: activeDate,
    trip_for_another_person: tripForAnotherPerson,
    ticket_number: ticketNumber,
    currency_amount: currencyAmount,
    amount, // required, NumberType.Money
    bs_partner_bonus_type_id: bsPartnerBonusTypeId,
    express_service_class_id: expressServiceClassId,
    date_to_cancelled: dateToCancelled,
    prolongable,
    active_by_trips: activeByTrips,
    is_empty: isEmpty,
    amount_calculation: amountCalculation,
    distance,
    addition_amount: additionAmount,
    operation_doc_type_id: operationDocTypeId,
    is_merged: isMerged,
    merged_date: mergedDate,
  };
}

/**
 * Вспомогательные функции для форматирования дат
 */
function formatDate(date: Date | null): string | null {
  if (!date) return null;
  const iso = date.toISOString();
  return iso.split("T")[0] || null; // YYYY-MM-DD
}

function formatTimestamp(date: Date | null): string | null {
  if (!date) return null;
  // Trino требует формат YYYY-MM-DD HH:mm:ss для TIMESTAMP
  // Заменяем T на пробел и убираем миллисекунды и Z
  const iso = date.toISOString();
  return iso.replace("T", " ").replace("Z", "").split(".")[0] || null;
}

/**
 * Записывает данные bonus_registry в Trino/Iceberg таблицу
 * 
 * @param trino - Экземпляр Trino клиента
 * @param data - Данные для записи
 * @param config - Конфигурация Trino (catalog, schema, table)
 */
/**
 * Проверяет, является ли ошибка конфликтом Nessie "ref hash is out of date"
 */
function isNessieHashConflict(error: unknown): boolean {
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    return (
      message.includes("ref hash is out of date") ||
      message.includes("ref 'main' is no longer valid") ||
      message.includes("cannot commit") ||
      message.includes("update the ref")
    );
  }
  return false;
}

/**
 * Retry механизм с экспоненциальной задержкой
 */
/**
 * Retry механизм с экспоненциальной задержкой
 * Оптимизирован для Nessie конфликтов: быстрые retry с умеренным backoff
 */
async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries = 3,
  initialDelayMs = 50,
  maxDelayMs = 1000,
  backoffMultiplier = 1.5
): Promise<T> {
  let lastError: unknown;
  let delay = initialDelayMs;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      // Если это не конфликт Nessie или последняя попытка - выбрасываем ошибку
      if (!isNessieHashConflict(error) || attempt === maxRetries) {
        throw error;
      }

      // Экспоненциальная задержка с jitter для уменьшения contention
      // Для Nessie конфликтов используем более короткие задержки
      const jitter = Math.random() * 0.2 * delay; // До 20% случайности
      const delayWithJitter = Math.min(delay + jitter, maxDelayMs);
      
      if (attempt < maxRetries) {
        await new Promise((resolve) => setTimeout(resolve, delayWithJitter));
        delay = Math.min(delay * backoffMultiplier, maxDelayMs);
      }
    }
  }

  throw lastError;
}

/**
 * Вставка одной записи в Trino с retry механизмом
 */
async function insertSingleRecordIntoTrino(
  trino: Trino,
  data: BonusRegistryFakerObject & {
    registrar_type_id: string;
    registrar_id: string;
    row: number;
  },
  config: {
    catalog: string;
    schema: string;
    table: string;
  }
): Promise<void> {
  const functionStartTime = Date.now();
  
  // 1. Формируем полное имя таблицы: catalog.schema.table
  const tableNameStartTime = Date.now();
  // В Trino нужно всегда указывать полное имя, даже если catalog и schema указаны в клиенте
  // Используем тот же формат, что и в trino-generator.ts
  // ВАЖНО: Trino приводит unquoted идентификаторы к нижнему регистру
  // Поэтому используем escapeTrinoIdentifier для всех частей
  const escapedCatalog = escapeTrinoIdentifier(config.catalog);
  const escapedSchema = escapeTrinoIdentifier(config.schema);
  const escapedTable = escapeTrinoIdentifier(config.table.toLowerCase()); // Приводим к нижнему регистру, как в hybrid-generator-v4
  const tableName = `${escapedCatalog}.${escapedSchema}.${escapedTable}`;
  const tableNameDuration = Date.now() - tableNameStartTime;
  console.log(`    [${tableNameDuration}ms] Formed table name: ${tableName}`);

  // 2. Формируем список колонок
  const columnsStartTime = Date.now();
  const columns = [
    "id", "date", "registrar_type_id", "registrar_id", "row",
    "manager_id", "bs_profile_id", "accounted_for_bs_profile_id",
    "first_name", "first_name_latin", "last_name", "last_name_latin",
    "departure_id", "arrival_id", "departure_date", "currency_entry_id",
    "bonus_type_id", "action_source_id", "bs_bonus_ticket_id",
    "validity_time", "date_of_expire", "car_type_id", "express_carrier_id",
    "carrier_id", "bs_partner_id", "bs_train_number_id", "bs_tourism_train_id",
    "accounted_in_calculation", "cancelled", "bs_quota_id",
    "doc_to_track_type_id", "doc_to_track_id", "doc_to_track_date",
    "active_date", "trip_for_another_person", "ticket_number",
    "currency_amount", "amount", "bs_partner_bonus_type_id",
    "express_service_class_id", "date_to_cancelled", "prolongable",
    "active_by_trips", "is_empty", "amount_calculation",
    "distance", "addition_amount", "operation_doc_type_id",
    "is_merged", "merged_date",
  ];
  const columnsDuration = Date.now() - columnsStartTime;
  console.log(`    [${columnsDuration}ms] Formed columns list (${columns.length} columns)`);

  // 3. Формируем значения с явным приведением типов для Trino
  const valuesStartTime = Date.now();
  // NULL значения не нужно приводить к типу - просто NULL
  const values = [
    `CAST(${escapeTrinoLiteral(data.id)} AS VARCHAR)`,
    data.date ? `TIMESTAMP '${formatTimestamp(data.date)!}'` : "CAST(NULL AS TIMESTAMP)",
    data.registrar_type_id ? `CAST(${escapeTrinoLiteral(data.registrar_type_id)} AS VARCHAR)` : "CAST(NULL AS VARCHAR)",
    data.registrar_id ? `CAST(${escapeTrinoLiteral(data.registrar_id)} AS VARCHAR)` : "CAST(NULL AS VARCHAR)",
    data.row !== null ? `CAST(${String(data.row)} AS INTEGER)` : "CAST(NULL AS INTEGER)",
    data.manager_id !== null ? `CAST(${String(data.manager_id)} AS INTEGER)` : "CAST(NULL AS INTEGER)",
    `CAST(${escapeTrinoLiteral(data.bs_profile_id)} AS VARCHAR)`,
    `CAST(${escapeTrinoLiteral(data.accounted_for_bs_profile_id)} AS VARCHAR)`,
    data.first_name ? `CAST(${escapeTrinoLiteral(data.first_name)} AS VARCHAR)` : "CAST(NULL AS VARCHAR)",
    data.first_name_latin ? `CAST(${escapeTrinoLiteral(data.first_name_latin)} AS VARCHAR)` : "CAST(NULL AS VARCHAR)",
    data.last_name ? `CAST(${escapeTrinoLiteral(data.last_name)} AS VARCHAR)` : "CAST(NULL AS VARCHAR)",
    data.last_name_latin ? `CAST(${escapeTrinoLiteral(data.last_name_latin)} AS VARCHAR)` : "CAST(NULL AS VARCHAR)",
    data.departure_id !== null ? `CAST(${String(data.departure_id)} AS INTEGER)` : "CAST(NULL AS INTEGER)",
    data.arrival_id !== null ? `CAST(${String(data.arrival_id)} AS INTEGER)` : "CAST(NULL AS INTEGER)",
    data.departure_date ? `CAST(${escapeTrinoLiteral(formatDate(data.departure_date)!)} AS DATE)` : "CAST(NULL AS DATE)",
    data.currency_entry_id !== null ? `CAST(${String(data.currency_entry_id)} AS INTEGER)` : "CAST(NULL AS INTEGER)",
    `CAST(${escapeTrinoLiteral(data.bonus_type_id)} AS VARCHAR)`,
    `CAST(${escapeTrinoLiteral(data.action_source_id)} AS VARCHAR)`,
    data.bs_bonus_ticket_id ? `CAST(${escapeTrinoLiteral(data.bs_bonus_ticket_id)} AS VARCHAR)` : "CAST(NULL AS VARCHAR)",
    data.validity_time !== null ? `CAST(${String(data.validity_time)} AS INTEGER)` : "CAST(NULL AS INTEGER)",
    data.date_of_expire ? `CAST(${escapeTrinoLiteral(formatDate(data.date_of_expire)!)} AS DATE)` : "CAST(NULL AS DATE)",
    data.car_type_id ? `CAST(${escapeTrinoLiteral(data.car_type_id)} AS VARCHAR)` : "CAST(NULL AS VARCHAR)",
    data.express_carrier_id !== null ? `CAST(${String(data.express_carrier_id)} AS INTEGER)` : "CAST(NULL AS INTEGER)",
    data.carrier_id ? `CAST(${escapeTrinoLiteral(data.carrier_id)} AS VARCHAR)` : "CAST(NULL AS VARCHAR)",
    data.bs_partner_id !== null ? `CAST(${String(data.bs_partner_id)} AS INTEGER)` : "CAST(NULL AS INTEGER)",
    data.bs_train_number_id ? `CAST(${escapeTrinoLiteral(data.bs_train_number_id)} AS VARCHAR)` : "CAST(NULL AS VARCHAR)",
    data.bs_tourism_train_id ? `CAST(${escapeTrinoLiteral(data.bs_tourism_train_id)} AS VARCHAR)` : "CAST(NULL AS VARCHAR)",
    data.accounted_in_calculation !== null ? `CAST(${data.accounted_in_calculation ? "TRUE" : "FALSE"} AS BOOLEAN)` : "CAST(NULL AS BOOLEAN)",
    data.cancelled !== null ? `CAST(${data.cancelled ? "TRUE" : "FALSE"} AS BOOLEAN)` : "CAST(NULL AS BOOLEAN)",
    data.bs_quota_id !== null ? `CAST(${String(data.bs_quota_id)} AS INTEGER)` : "CAST(NULL AS INTEGER)",
    `CAST(${escapeTrinoLiteral(data.doc_to_track_type_id)} AS VARCHAR)`,
    `CAST(${escapeTrinoLiteral(data.doc_to_track_id)} AS VARCHAR)`,
    data.doc_to_track_date ? `CAST(${escapeTrinoLiteral(formatDate(data.doc_to_track_date)!)} AS DATE)` : "CAST(NULL AS DATE)",
    data.active_date ? `CAST(${escapeTrinoLiteral(formatDate(data.active_date)!)} AS DATE)` : "CAST(NULL AS DATE)",
    data.trip_for_another_person !== null ? `CAST(${data.trip_for_another_person ? "TRUE" : "FALSE"} AS BOOLEAN)` : "CAST(NULL AS BOOLEAN)",
    data.ticket_number ? `CAST(${escapeTrinoLiteral(data.ticket_number)} AS VARCHAR)` : "CAST(NULL AS VARCHAR)",
    data.currency_amount !== null ? `CAST(${String(data.currency_amount)} AS INTEGER)` : "CAST(NULL AS INTEGER)",
    `CAST(${String(data.amount)} AS INTEGER)`,
    data.bs_partner_bonus_type_id ? `CAST(${escapeTrinoLiteral(data.bs_partner_bonus_type_id)} AS VARCHAR)` : "CAST(NULL AS VARCHAR)",
    data.express_service_class_id !== null ? `CAST(${String(data.express_service_class_id)} AS INTEGER)` : "CAST(NULL AS INTEGER)",
    data.date_to_cancelled ? `TIMESTAMP '${formatTimestamp(data.date_to_cancelled)!}'` : "CAST(NULL AS TIMESTAMP)",
    data.prolongable !== null ? `CAST(${data.prolongable ? "TRUE" : "FALSE"} AS BOOLEAN)` : "CAST(NULL AS BOOLEAN)",
    data.active_by_trips !== null ? `CAST(${data.active_by_trips ? "TRUE" : "FALSE"} AS BOOLEAN)` : "CAST(NULL AS BOOLEAN)",
    data.is_empty !== null ? `CAST(${data.is_empty ? "TRUE" : "FALSE"} AS BOOLEAN)` : "CAST(NULL AS BOOLEAN)",
    data.amount_calculation ? `CAST(${escapeTrinoLiteral(data.amount_calculation)} AS VARCHAR)` : "CAST(NULL AS VARCHAR)",
    data.distance !== null ? `CAST(${String(data.distance)} AS INTEGER)` : "CAST(NULL AS INTEGER)",
    data.addition_amount !== null ? `CAST(${String(data.addition_amount)} AS INTEGER)` : "CAST(NULL AS INTEGER)",
    data.operation_doc_type_id ? `CAST(${escapeTrinoLiteral(data.operation_doc_type_id)} AS VARCHAR)` : "CAST(NULL AS VARCHAR)",
    data.is_merged !== null ? `CAST(${data.is_merged ? "TRUE" : "FALSE"} AS BOOLEAN)` : "CAST(NULL AS BOOLEAN)",
    data.merged_date ? `CAST(${escapeTrinoLiteral(formatDate(data.merged_date)!)} AS DATE)` : "CAST(NULL AS DATE)",
  ];
  const valuesDuration = Date.now() - valuesStartTime;
  console.log(`    [${valuesDuration}ms] Formed values list (${values.length} values)`);

  // 4. Формируем SQL запрос
  const sqlFormationStartTime = Date.now();
  const insertSql = `
    INSERT INTO ${tableName} (${columns.map(c => escapeTrinoIdentifier(c)).join(", ")})
    VALUES (${values.join(", ")})
  `;
  const sqlFormationDuration = Date.now() - sqlFormationStartTime;
  const sqlLength = insertSql.length;
  console.log(`    [${sqlFormationDuration}ms] Formed SQL query (${sqlLength} characters)`);

  // Выполняем запрос с retry механизмом
  const retryStartTime = Date.now();
  await retryWithBackoff(async () => {
    const attemptStartTime = Date.now();
    try {
      // 5. Выполняем INSERT запрос
      const queryExecutionStartTime = Date.now();
      const query = await trino.query(insertSql);
      const queryExecutionDuration = Date.now() - queryExecutionStartTime;
      console.log(`      [${queryExecutionDuration}ms] Query executed (async iterator created)`);
      
      // 6. Потребляем результаты для завершения транзакции и проверки ошибок
      const consumeStartTime = Date.now();
      // Для INSERT запросов проверяем результаты на ошибки и потребляем для завершения транзакции
      for await (const result of query) {
        const trinoResult = result as { 
          error?: { 
            message: string; 
            errorCode?: number; 
            errorName?: string;
            errorType?: string;
          } 
        };
        if (trinoResult.error) {
          const consumeDuration = Date.now() - consumeStartTime;
          const attemptDuration = Date.now() - attemptStartTime;
          console.log(`      [${consumeDuration}ms] Error detected in result`);
          console.log(`      [${attemptDuration}ms] Total attempt time (failed)`);
          const errorDetails = {
            message: trinoResult.error.message || "Unknown error",
            errorCode: trinoResult.error.errorCode,
            errorName: trinoResult.error.errorName,
            errorType: trinoResult.error.errorType,
          };
          throw new Error(`Trino insert failed: ${JSON.stringify(errorDetails)}`);
        }
      }
      
      const consumeDuration = Date.now() - consumeStartTime;
      const attemptDuration = Date.now() - attemptStartTime;
      console.log(`      [${consumeDuration}ms] Results consumed (success)`);
      console.log(`      [${attemptDuration}ms] Total attempt time (success)`);
    } catch (error) {
      const attemptDuration = Date.now() - attemptStartTime;
      console.log(`      [${attemptDuration}ms] Total attempt time (error)`);
      // Улучшаем сообщение об ошибке
      if (error instanceof Error) {
        // Если это уже наша ошибка, пробрасываем как есть
        if (error.message.includes("Trino insert failed")) {
          throw error;
        }
        // Иначе оборачиваем в более информативное сообщение
        throw new Error(`Trino insert failed: ${error.message}${error.stack ? `\nStack: ${error.stack}` : ""}`);
      }
      throw error;
    }
  }, 3, 50, 1000, 1.5); // maxRetries=3, initialDelay=50ms, maxDelay=1000ms, multiplier=1.5
  
  const retryDuration = Date.now() - retryStartTime;
  const functionDuration = Date.now() - functionStartTime;
  console.log(`    [${retryDuration}ms] Total retryWithBackoff time`);
  console.log(`    [${functionDuration}ms] Total insertSingleRecordIntoTrino time`);
}

/**
 * Вставка батча записей в Trino одним запросом
 */
export async function insertBonusRegistryBatchIntoTrino(
  trino: Trino,
  dataArray: Array<BonusRegistryFakerObject & {
    registrar_type_id: string;
    registrar_id: string;
    row: number;
  }>,
  config: {
    catalog: string;
    schema: string;
    table: string;
  }
): Promise<void> {
  if (dataArray.length === 0) {
    return;
  }

  // Формируем полное имя таблицы
  const escapedCatalog = escapeTrinoIdentifier(config.catalog);
  const escapedSchema = escapeTrinoIdentifier(config.schema);
  const escapedTable = escapeTrinoIdentifier(config.table.toLowerCase());
  const tableName = `${escapedCatalog}.${escapedSchema}.${escapedTable}`;

  const columns = [
    "id", "date", "registrar_type_id", "registrar_id", "row",
    "manager_id", "bs_profile_id", "accounted_for_bs_profile_id",
    "first_name", "first_name_latin", "last_name", "last_name_latin",
    "departure_id", "arrival_id", "departure_date", "currency_entry_id",
    "bonus_type_id", "action_source_id", "bs_bonus_ticket_id",
    "validity_time", "date_of_expire", "car_type_id", "express_carrier_id",
    "carrier_id", "bs_partner_id", "bs_train_number_id", "bs_tourism_train_id",
    "accounted_in_calculation", "cancelled", "bs_quota_id",
    "doc_to_track_type_id", "doc_to_track_id", "doc_to_track_date",
    "active_date", "trip_for_another_person", "ticket_number",
    "currency_amount", "amount", "bs_partner_bonus_type_id",
    "express_service_class_id", "date_to_cancelled", "prolongable",
    "active_by_trips", "is_empty", "amount_calculation",
    "distance", "addition_amount", "operation_doc_type_id",
    "is_merged", "merged_date",
  ];

  // Формируем VALUES для всех записей
  const allValues = dataArray.map((data) => {
    const values = [
      `CAST(${escapeTrinoLiteral(data.id)} AS VARCHAR)`,
      data.date ? `TIMESTAMP '${formatTimestamp(data.date)!}'` : "CAST(NULL AS TIMESTAMP)",
      data.registrar_type_id ? `CAST(${escapeTrinoLiteral(data.registrar_type_id)} AS VARCHAR)` : "CAST(NULL AS VARCHAR)",
      data.registrar_id ? `CAST(${escapeTrinoLiteral(data.registrar_id)} AS VARCHAR)` : "CAST(NULL AS VARCHAR)",
      data.row !== null ? `CAST(${String(data.row)} AS INTEGER)` : "CAST(NULL AS INTEGER)",
      data.manager_id !== null ? `CAST(${String(data.manager_id)} AS INTEGER)` : "CAST(NULL AS INTEGER)",
      `CAST(${escapeTrinoLiteral(data.bs_profile_id)} AS VARCHAR)`,
      `CAST(${escapeTrinoLiteral(data.accounted_for_bs_profile_id)} AS VARCHAR)`,
      data.first_name ? `CAST(${escapeTrinoLiteral(data.first_name)} AS VARCHAR)` : "CAST(NULL AS VARCHAR)",
      data.first_name_latin ? `CAST(${escapeTrinoLiteral(data.first_name_latin)} AS VARCHAR)` : "CAST(NULL AS VARCHAR)",
      data.last_name ? `CAST(${escapeTrinoLiteral(data.last_name)} AS VARCHAR)` : "CAST(NULL AS VARCHAR)",
      data.last_name_latin ? `CAST(${escapeTrinoLiteral(data.last_name_latin)} AS VARCHAR)` : "CAST(NULL AS VARCHAR)",
      data.departure_id !== null ? `CAST(${String(data.departure_id)} AS INTEGER)` : "CAST(NULL AS INTEGER)",
      data.arrival_id !== null ? `CAST(${String(data.arrival_id)} AS INTEGER)` : "CAST(NULL AS INTEGER)",
      data.departure_date ? `CAST(${escapeTrinoLiteral(formatDate(data.departure_date)!)} AS DATE)` : "CAST(NULL AS DATE)",
      data.currency_entry_id !== null ? `CAST(${String(data.currency_entry_id)} AS INTEGER)` : "CAST(NULL AS INTEGER)",
      `CAST(${escapeTrinoLiteral(data.bonus_type_id)} AS VARCHAR)`,
      `CAST(${escapeTrinoLiteral(data.action_source_id)} AS VARCHAR)`,
      data.bs_bonus_ticket_id ? `CAST(${escapeTrinoLiteral(data.bs_bonus_ticket_id)} AS VARCHAR)` : "CAST(NULL AS VARCHAR)",
      data.validity_time !== null ? `CAST(${String(data.validity_time)} AS INTEGER)` : "CAST(NULL AS INTEGER)",
      data.date_of_expire ? `CAST(${escapeTrinoLiteral(formatDate(data.date_of_expire)!)} AS DATE)` : "CAST(NULL AS DATE)",
      data.car_type_id ? `CAST(${escapeTrinoLiteral(data.car_type_id)} AS VARCHAR)` : "CAST(NULL AS VARCHAR)",
      data.express_carrier_id !== null ? `CAST(${String(data.express_carrier_id)} AS INTEGER)` : "CAST(NULL AS INTEGER)",
      data.carrier_id ? `CAST(${escapeTrinoLiteral(data.carrier_id)} AS VARCHAR)` : "CAST(NULL AS VARCHAR)",
      data.bs_partner_id !== null ? `CAST(${String(data.bs_partner_id)} AS INTEGER)` : "CAST(NULL AS INTEGER)",
      data.bs_train_number_id ? `CAST(${escapeTrinoLiteral(data.bs_train_number_id)} AS VARCHAR)` : "CAST(NULL AS VARCHAR)",
      data.bs_tourism_train_id ? `CAST(${escapeTrinoLiteral(data.bs_tourism_train_id)} AS VARCHAR)` : "CAST(NULL AS VARCHAR)",
      data.accounted_in_calculation !== null ? `CAST(${data.accounted_in_calculation ? "TRUE" : "FALSE"} AS BOOLEAN)` : "CAST(NULL AS BOOLEAN)",
      data.cancelled !== null ? `CAST(${data.cancelled ? "TRUE" : "FALSE"} AS BOOLEAN)` : "CAST(NULL AS BOOLEAN)",
      data.bs_quota_id !== null ? `CAST(${String(data.bs_quota_id)} AS INTEGER)` : "CAST(NULL AS INTEGER)",
      `CAST(${escapeTrinoLiteral(data.doc_to_track_type_id)} AS VARCHAR)`,
      `CAST(${escapeTrinoLiteral(data.doc_to_track_id)} AS VARCHAR)`,
      data.doc_to_track_date ? `CAST(${escapeTrinoLiteral(formatDate(data.doc_to_track_date)!)} AS DATE)` : "CAST(NULL AS DATE)",
      data.active_date ? `CAST(${escapeTrinoLiteral(formatDate(data.active_date)!)} AS DATE)` : "CAST(NULL AS DATE)",
      data.trip_for_another_person !== null ? `CAST(${data.trip_for_another_person ? "TRUE" : "FALSE"} AS BOOLEAN)` : "CAST(NULL AS BOOLEAN)",
      data.ticket_number ? `CAST(${escapeTrinoLiteral(data.ticket_number)} AS VARCHAR)` : "CAST(NULL AS VARCHAR)",
      data.currency_amount !== null ? `CAST(${String(data.currency_amount)} AS INTEGER)` : "CAST(NULL AS INTEGER)",
      `CAST(${String(data.amount)} AS INTEGER)`,
      data.bs_partner_bonus_type_id ? `CAST(${escapeTrinoLiteral(data.bs_partner_bonus_type_id)} AS VARCHAR)` : "CAST(NULL AS VARCHAR)",
      data.express_service_class_id !== null ? `CAST(${String(data.express_service_class_id)} AS INTEGER)` : "CAST(NULL AS INTEGER)",
      data.date_to_cancelled ? `TIMESTAMP '${formatTimestamp(data.date_to_cancelled)!}'` : "CAST(NULL AS TIMESTAMP)",
      data.prolongable !== null ? `CAST(${data.prolongable ? "TRUE" : "FALSE"} AS BOOLEAN)` : "CAST(NULL AS BOOLEAN)",
      data.active_by_trips !== null ? `CAST(${data.active_by_trips ? "TRUE" : "FALSE"} AS BOOLEAN)` : "CAST(NULL AS BOOLEAN)",
      data.is_empty !== null ? `CAST(${data.is_empty ? "TRUE" : "FALSE"} AS BOOLEAN)` : "CAST(NULL AS BOOLEAN)",
      data.amount_calculation ? `CAST(${escapeTrinoLiteral(data.amount_calculation)} AS VARCHAR)` : "CAST(NULL AS VARCHAR)",
      data.distance !== null ? `CAST(${String(data.distance)} AS INTEGER)` : "CAST(NULL AS INTEGER)",
      data.addition_amount !== null ? `CAST(${String(data.addition_amount)} AS INTEGER)` : "CAST(NULL AS INTEGER)",
      data.operation_doc_type_id ? `CAST(${escapeTrinoLiteral(data.operation_doc_type_id)} AS VARCHAR)` : "CAST(NULL AS VARCHAR)",
      data.is_merged !== null ? `CAST(${data.is_merged ? "TRUE" : "FALSE"} AS BOOLEAN)` : "CAST(NULL AS BOOLEAN)",
      data.merged_date ? `CAST(${escapeTrinoLiteral(formatDate(data.merged_date)!)} AS DATE)` : "CAST(NULL AS DATE)",
    ];
    return `(${values.join(", ")})`;
  });

  const insertSql = `
    INSERT INTO ${tableName} (${columns.map(c => escapeTrinoIdentifier(c)).join(", ")})
    VALUES ${allValues.join(", ")}
  `;

  // Выполняем запрос с retry механизмом
  await retryWithBackoff(async () => {
    try {
      const query = await trino.query(insertSql);
      
      // Потребляем все результаты для завершения транзакции
      for await (const result of query) {
        // Проверяем различные форматы ответа от Trino
        if (result && typeof result === "object") {
          // Формат 1: { error: { message: ... } }
          const trinoResult = result as { 
            error?: { 
              message?: string; 
              errorCode?: number; 
              errorName?: string;
              errorType?: string;
            };
            data?: unknown;
          };
          
          if (trinoResult.error) {
            const errorDetails = {
              message: trinoResult.error.message || "Unknown Trino error",
              errorCode: trinoResult.error.errorCode,
              errorName: trinoResult.error.errorName,
              errorType: trinoResult.error.errorType,
            };
            throw new Error(`Trino batch insert failed (${dataArray.length} records): ${JSON.stringify(errorDetails)}`);
          }
        } else if (result && typeof result === "string") {
          // Формат 2: строка с ошибкой
          throw new Error(`Trino batch insert failed (${dataArray.length} records): ${result}`);
        }
      }
    } catch (error) {
      // Улучшаем сообщение об ошибке
      if (error instanceof Error) {
        // Если это уже наша ошибка, пробрасываем как есть
        if (error.message.includes("Trino batch insert failed") || error.message.includes("Trino insert failed")) {
          throw error;
        }
        // Иначе оборачиваем в более информативное сообщение
        const fullMessage = `Trino batch insert failed (${dataArray.length} records): ${error.message || String(error)}`;
        const enhancedError = new Error(fullMessage);
        if (error.stack) {
          enhancedError.stack = error.stack;
        }
        throw enhancedError;
      }
      // Если это не Error объект, создаем новый
      throw new Error(`Trino batch insert failed (${dataArray.length} records): ${String(error)}`);
    }
  }, 5, 100, 5000, 2); // maxRetries=5, initialDelay=100ms, maxDelay=5000ms, multiplier=2
}

/**
 * Вставка одной записи в Trino (обертка для обратной совместимости)
 */
export async function insertBonusRegistryIntoTrino(
  trino: Trino,
  data: BonusRegistryFakerObject & {
    registrar_type_id: string;
    registrar_id: string;
    row: number;
  },
  config: {
    catalog: string;
    schema: string;
    table: string;
  }
): Promise<void> {
  return insertSingleRecordIntoTrino(trino, data, config);
}

// ============================================================================
// Общие утилиты для подключения и проверки таблиц
// ============================================================================

import postgres, { type Sql } from "postgres";
import { BasicAuth } from "trino-client";
import type { HybridWriterConfig } from "./hybrid-writer.js";

/**
 * Конфигурация подключения к PostgreSQL
 */
export interface PostgresConfig {
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
}

/**
 * Конфигурация подключения к Trino
 */
export interface TrinoConfig {
  host: string;
  port: number;
  catalog: string;
  schema: string;
  user: string;
  table?: string;
}

/**
 * Результат проверки таблиц
 */
export interface TablesCheckResult {
  postgresUniqueCheck: boolean;
  postgresBalanceCheck: boolean;
  trinoTable: boolean;
}

/**
 * Получение конфигурации PostgreSQL из переменных окружения
 */
export function getPostgresConfig(): PostgresConfig {
  return {
    host: process.env.POSTGRES_HOST || "localhost",
    port: Number.parseInt(process.env.POSTGRES_PORT || "5432", 10),
    database: process.env.POSTGRES_DB || "appdb",
    username: process.env.POSTGRES_USER || "postgres",
    password: process.env.POSTGRES_PASSWORD || "postgres",
  };
}

/**
 * Получение конфигурации Trino из переменных окружения
 */
export function getTrinoConfig(): TrinoConfig {
  return {
    host: process.env.TRINO_HOST || "localhost",
    port: Number.parseInt(process.env.TRINO_PORT || "8080", 10),
    catalog: process.env.TRINO_CATALOG || "iceberg",
    schema: process.env.TRINO_SCHEMA || "warehouse",
    user: process.env.TRINO_USER || "trino",
    table: process.env.TRINO_TABLE || "bonus_registry",
  };
}

/**
 * Получение полной конфигурации HybridWriter из переменных окружения
 */
export function getHybridWriterConfig(): HybridWriterConfig {
  const postgresConfig = getPostgresConfig();
  const trinoConfig = getTrinoConfig();
  
  return {
    postgres: postgresConfig,
    trino: {
      ...trinoConfig,
      table: trinoConfig.table || "bonus_registry",
    },
    rabbitmq: {
      host: process.env.RABBITMQ_HOST || "localhost",
      port: Number.parseInt(process.env.RABBITMQ_PORT || "5672", 10),
      username: process.env.RABBITMQ_USERNAME || "guest",
      password: process.env.RABBITMQ_PASSWORD || "guest",
      queue: process.env.RABBITMQ_QUEUE || "bonus_registry_queue",
    },
    tables: {
      uniqueCheck: "bonus_registry_unique_check",
      balanceCheck: "bonus_registry_balance_check",
    },
  };
}

/**
 * Подключение к PostgreSQL
 */
export async function connectPostgres(config: PostgresConfig): Promise<Sql> {
  return postgres({
    host: config.host,
    port: config.port,
    database: config.database,
    username: config.username,
    password: config.password,
  });
}

/**
 * Подключение к Trino
 */
export function connectTrino(config: TrinoConfig): Trino {
  return Trino.create({
    server: `http://${config.host}:${config.port}`,
    catalog: config.catalog,
    schema: config.schema,
    auth: new BasicAuth(config.user),
  });
}

/**
 * Проверка существования таблицы в PostgreSQL
 */
export async function checkPostgresTableExists(
  sql: Sql,
  tableName: string,
  verbose = false
): Promise<boolean> {
  const startTime = Date.now();
  const result = await sql.unsafe<Array<{ exists: boolean }>>(`
    SELECT EXISTS (
      SELECT FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name = '${tableName}'
    ) AS exists
  `);
  const duration = Date.now() - startTime;
  const exists = result && result.length > 0 ? result[0]?.exists ?? false : false;
  if (verbose) {
    console.log(`  [${duration}ms] PostgreSQL table '${tableName}': ${exists ? "✓ exists" : "✗ not found"}`);
  }
  return exists;
}

/**
 * Проверка существования таблицы в Trino/Iceberg
 */
export async function checkTrinoTableExists(
  trino: Trino,
  catalog: string,
  schema: string,
  tableName: string,
  verbose = false
): Promise<boolean> {
  const startTime = Date.now();
  const fullTableName = `${escapeTrinoIdentifier(catalog)}.${escapeTrinoIdentifier(schema)}.${escapeTrinoIdentifier(tableName)}`;
  
  // Альтернативный подход: пробуем выполнить простой SELECT из таблицы
  // Если таблица существует, запрос не вызовет ошибку
  try {
    const testQuery = await trino.query(`
      SELECT 1 FROM ${fullTableName} LIMIT 1
    `);
    
    // Потребляем результат
    for await (const _ of testQuery) {
      // Просто потребляем, чтобы запрос выполнился
    }
    
    const duration = Date.now() - startTime;
    if (verbose) {
      console.log(`  [${duration}ms] Trino table '${fullTableName}': ✓ exists (verified by SELECT)`);
    }
    return true;
  } catch (selectError) {
    // Если SELECT не сработал, пробуем через information_schema
    try {
      const sqlQuery = `
        SELECT table_name 
        FROM ${escapeTrinoIdentifier(catalog)}.information_schema.tables 
        WHERE table_schema = ${escapeTrinoLiteral(schema)}
        AND table_catalog = ${escapeTrinoLiteral(catalog)}
        AND table_name = ${escapeTrinoLiteral(tableName)}
      `;
      
      const query = await trino.query(sqlQuery);
      
      let found = false;
      const allResults: unknown[] = [];
      for await (const result of query) {
        allResults.push(result);
        // Trino может возвращать данные в разных форматах
        // Проверяем несколько вариантов структуры ответа
        if (result && typeof result === 'object') {
          const data = result as Record<string, unknown>;
          // Может быть table_name как ключ
          if (data.table_name === tableName || data['table_name'] === tableName) {
            found = true;
            break;
          }
          // Может быть массив значений [table_name]
          if (Array.isArray(data) && data.length > 0 && data[0] === tableName) {
            found = true;
            break;
          }
          // Может быть объект с данными в другом формате
          const values = Object.values(data);
          if (values.includes(tableName)) {
            found = true;
            break;
          }
        }
        // Если результат - это строка
        if (typeof result === 'string' && result === tableName) {
          found = true;
          break;
        }
      }
      
      const duration = Date.now() - startTime;
      if (verbose) {
        if (!found && allResults.length > 0) {
          console.log(`  [${duration}ms] Trino table '${fullTableName}': ✗ not found (debug: received ${allResults.length} result(s), first result: ${JSON.stringify(allResults[0])})`);
        } else {
          console.log(`  [${duration}ms] Trino table '${fullTableName}': ${found ? "✓ exists" : "✗ not found"}`);
        }
      }
      return found;
    } catch (error) {
      const duration = Date.now() - startTime;
      if (verbose) {
        console.log(`  [${duration}ms] Trino table '${fullTableName}': ✗ error - ${error instanceof Error ? error.message : String(error)}`);
        if (error instanceof Error && error.stack) {
          console.log(`    Stack: ${error.stack}`);
        }
      }
      return false;
    }
  }
}

/**
 * Проверка всех необходимых таблиц
 */
export async function checkTables(
  sql: Sql,
  trino: Trino,
  config: {
    postgresUniqueCheck: string;
    postgresBalanceCheck: string;
    trinoCatalog: string;
    trinoSchema: string;
    trinoTable: string;
  },
  verbose = false
): Promise<TablesCheckResult> {
  if (verbose) {
    console.log("\n=== Checking tables ===");
  }
  
  const checkStartTime = Date.now();
  
  const [postgresUniqueCheck, postgresBalanceCheck, trinoTable] = await Promise.all([
    checkPostgresTableExists(sql, config.postgresUniqueCheck, verbose),
    checkPostgresTableExists(sql, config.postgresBalanceCheck, verbose),
    checkTrinoTableExists(trino, config.trinoCatalog, config.trinoSchema, config.trinoTable, verbose),
  ]);
  
  const totalDuration = Date.now() - checkStartTime;
  if (verbose) {
    console.log(`\nTotal check time: ${totalDuration}ms`);
  }
  
  return {
    postgresUniqueCheck,
    postgresBalanceCheck,
    trinoTable,
  };
}

/**
 * Парсинг аргументов командной строки для тестовых скриптов
 */
export interface ParsedArgs {
  count: number;
  optimistic: boolean;
  useBatching: boolean;
  verbose: boolean;
  concurrency: number;
}

/**
 * Парсинг аргументов командной строки
 */
export function parseArgs(): ParsedArgs {
  const args = process.argv.slice(2);
  let count = 100; // По умолчанию 100 записей
  let optimistic = false; // По умолчанию pessimistic режим
  let useBatching = false; // По умолчанию без батчинга
  let verbose = false; // По умолчанию без verbose
  const concurrency = Number.parseInt(process.env.CONCURRENCY || "10", 10); // По умолчанию 10

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    
    if (arg === "--count" || arg === "-c") {
      const value = args[i + 1];
      if (value) {
        count = Number.parseInt(value, 10);
        if (Number.isNaN(count) || count <= 0) {
          console.error("Error: --count must be a positive number");
          process.exit(1);
        }
        i++; // Пропускаем следующий аргумент
      }
    } else if (arg === "--optimistic" || arg === "-o") {
      optimistic = true;
    } else if (arg === "--batch" || arg === "-b") {
      useBatching = true;
    } else if (arg === "--verbose" || arg === "-v") {
      verbose = true;
    } else if (arg === "--help" || arg === "-h") {
      console.log(`
Usage: tsx script.ts [options]

Options:
  --count, -c <number>     Number of records to generate (default: 100)
  --optimistic, -o         Use optimistic mode (send to RabbitMQ instead of direct Trino write)
  --batch, -b              Use batching for Trino writes (only for pessimistic mode)
  --verbose, -v            Enable verbose logging (shows details for each operation)
  --help, -h               Show this help message

Environment Variables:
  CONCURRENCY              Number of parallel writes (default: 10)
                           Higher values increase throughput but may overload the system
  BATCH_SIZE               Batch size for Trino INSERT operations (default: 10)
                           Only used when --batch flag is set

Examples:
  tsx script.ts --count 1000
  tsx script.ts --count 500 --optimistic
  tsx script.ts -c 100 -o
  tsx script.ts --count 1000 --batch
  CONCURRENCY=50 tsx script.ts --count 1000 --optimistic
  tsx script.ts --count 100 --verbose
      `);
      process.exit(0);
    }
  }

  return { count, optimistic, useBatching, verbose, concurrency };
}
