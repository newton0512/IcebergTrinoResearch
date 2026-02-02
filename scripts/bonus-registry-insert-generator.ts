/**
 * Генерация SQL-выражений для массовой вставки в bonus_registry.
 * Используется write-trino-mass и bonus-registry-partitioning-fill.
 */

import { escapeTrinoLiteral } from "../src/generator/escape.js";

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
];

const BONUS_TYPE_IDS = ["premial", "qualification"];
const ACTION_SOURCE_IDS = ["operator", "auto"];
const CARRIER_IDS = ["fpk", "tver", "rzd"];
const OPERATION_DOC_TYPE_IDS = [
  "operation_transfer",
  "operation_status_assignment",
  "operation_manual_bonus",
];

/** Имена колонок для INSERT (порядок как в DDL bonus_registry). */
export const BONUS_REGISTRY_INSERT_COLUMNS = [
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

/**
 * Генерирует SQL-выражения для колонок bonus_registry (для INSERT ... SELECT).
 * @param seqExpr — не используется, оставлен для совместимости с вызовом из write-trino-mass (row_num).
 */
export function generateBonusRegistryColumnExpressions(_seqExpr: string): string[] {
  const registrarTypeIdsArray = REGISTRAR_TYPE_IDS.map((v) => escapeTrinoLiteral(v)).join(", ");
  const bonusTypeIdsArray = BONUS_TYPE_IDS.map((v) => escapeTrinoLiteral(v)).join(", ");
  const actionSourceIdsArray = ACTION_SOURCE_IDS.map((v) => escapeTrinoLiteral(v)).join(", ");
  const carrierIdsArray = CARRIER_IDS.map((v) => escapeTrinoLiteral(v)).join(", ");
  const operationDocTypeIdsArray = OPERATION_DOC_TYPE_IDS.map((v) =>
    escapeTrinoLiteral(v)
  ).join(", ");

  const nullable = (expr: string, probability: number): string =>
    `CASE WHEN random() < ${probability} THEN NULL ELSE ${expr} END`;

  const randomString = (minLen: number, maxLen: number): string => {
    const len = maxLen - minLen + 1;
    return `substr(replace(cast(uuid() as varchar), '-', ''), 1, CAST(floor(random() * ${len} + ${minLen}) AS INTEGER))`;
  };

  const ts2020 = Math.floor(new Date("2020-01-01").getTime() / 1000);
  const tsNow = Math.floor(Date.now() / 1000);
  const ts2025 = Math.floor(new Date("2025-12-31").getTime() / 1000);

  return [
    `CAST(uuid() AS VARCHAR)`,
    nullable(`from_unixtime(CAST(floor(random() * (${tsNow} - ${ts2020}) + ${ts2020}) AS BIGINT))`, 0.2),
    nullable(`element_at(ARRAY[${registrarTypeIdsArray}], CAST(floor(random() * ${REGISTRAR_TYPE_IDS.length}) + 1 AS INTEGER))`, 0.2),
    nullable(`CAST(uuid() AS VARCHAR)`, 0.2),
    nullable(`CAST(floor(random() * 10 + 1) AS INTEGER)`, 0.2),
    nullable(`CAST(floor(random() * 1000 + 1) AS INTEGER)`, 0.3),
    `CAST(uuid() AS VARCHAR)`,
    `CAST(uuid() AS VARCHAR)`,
    nullable(`CAST(uuid() AS VARCHAR)`, 0.4),
    nullable(`CAST(uuid() AS VARCHAR)`, 0.4),
    nullable(`CAST(uuid() AS VARCHAR)`, 0.4),
    nullable(`CAST(uuid() AS VARCHAR)`, 0.4),
    nullable(`CAST(floor(random() * 100 + 1) AS INTEGER)`, 0.5),
    nullable(`CAST(floor(random() * 100 + 1) AS INTEGER)`, 0.5),
    nullable(`CAST(from_unixtime(CAST(floor(random() * (${tsNow} - ${ts2020}) + ${ts2020}) AS BIGINT)) AS DATE)`, 0.5),
    nullable(`CAST(floor(random() * 10 + 1) AS INTEGER)`, 0.5),
    `element_at(ARRAY[${bonusTypeIdsArray}], CAST(floor(random() * ${BONUS_TYPE_IDS.length}) + 1 AS INTEGER))`,
    `element_at(ARRAY[${actionSourceIdsArray}], CAST(floor(random() * ${ACTION_SOURCE_IDS.length}) + 1 AS INTEGER))`,
    nullable(`CAST(uuid() AS VARCHAR)`, 0.8),
    nullable(`CAST(floor(random() * 336 + 30) AS INTEGER)`, 0.6),
    nullable(`CAST(from_unixtime(CAST(floor(random() * (${ts2025} - ${tsNow}) + ${tsNow}) AS BIGINT)) AS DATE)`, 0.6),
    nullable(randomString(5, 10), 0.8),
    nullable(`CAST(floor(random() * 50 + 1) AS INTEGER)`, 0.7),
    nullable(`element_at(ARRAY[${carrierIdsArray}], CAST(floor(random() * ${CARRIER_IDS.length}) + 1 AS INTEGER))`, 0.6),
    nullable(`CAST(floor(random() * 20 + 1) AS INTEGER)`, 0.7),
    nullable(randomString(5, 15), 0.8),
    nullable(randomString(5, 15), 0.8),
    nullable(`CAST(floor(random() * 2) AS BOOLEAN)`, 0.7),
    nullable(`CAST(floor(random() * 2) AS BOOLEAN)`, 0.7),
    nullable(`CAST(floor(random() * 100 + 1) AS INTEGER)`, 0.8),
    `element_at(ARRAY[${registrarTypeIdsArray}], CAST(floor(random() * ${REGISTRAR_TYPE_IDS.length}) + 1 AS INTEGER))`,
    `CAST(uuid() AS VARCHAR)`,
    nullable(`CAST(from_unixtime(CAST(floor(random() * (${tsNow} - ${ts2020}) + ${ts2020}) AS BIGINT)) AS DATE)`, 0.5),
    nullable(`CAST(from_unixtime(CAST(floor(random() * (${tsNow} - ${ts2020}) + ${ts2020}) AS BIGINT)) AS DATE)`, 0.7),
    nullable(`CAST(floor(random() * 2) AS BOOLEAN)`, 0.7),
    nullable(randomString(10, 20), 0.8),
    nullable(`CAST(floor(random() * 9901 + 100) AS INTEGER)`, 0.8),
    `CAST(floor(random() * 11001 - 1000) AS INTEGER)`,
    nullable(randomString(5, 15), 0.8),
    nullable(`CAST(floor(random() * 5 + 1) AS INTEGER)`, 0.8),
    nullable(`from_unixtime(CAST(floor(random() * (${ts2025} - ${tsNow}) + ${tsNow}) AS BIGINT))`, 0.9),
    nullable(`CAST(floor(random() * 2) AS BOOLEAN)`, 0.7),
    nullable(`CAST(floor(random() * 2) AS BOOLEAN)`, 0.7),
    nullable(`CAST(floor(random() * 2) AS BOOLEAN)`, 0.7),
    nullable(`CAST(uuid() AS VARCHAR)`, 0.7),
    nullable(`CAST(floor(random() * 4901 + 100) AS INTEGER)`, 0.7),
    nullable(`CAST(floor(random() * 491 + 10) AS INTEGER)`, 0.8),
    nullable(`element_at(ARRAY[${operationDocTypeIdsArray}], CAST(floor(random() * ${OPERATION_DOC_TYPE_IDS.length}) + 1 AS INTEGER))`, 0.3),
    nullable(`CAST(floor(random() * 2) AS BOOLEAN)`, 0.7),
    nullable(`CAST(from_unixtime(CAST(floor(random() * (${tsNow} - ${ts2020}) + ${ts2020}) AS BIGINT)) AS DATE)`, 0.9),
  ];
}
