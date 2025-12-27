import { parseArgs } from "node:util";
import {
  getEnglishMaleNames,
  getEnglishFemaleNames,
  getEnglishSurnames,
  getRussianMaleNames,
  getRussianFemaleNames,
  getRussianMaleSurnames,
  getRussianFemaleSurnames,
} from "@mkven/name-dictionaries";
import {
  PostgresDataGenerator,
  ClickHouseDataGenerator,
  SQLiteDataGenerator,
  TrinoDataGenerator,
  HybridDataGenerator,
  HybridDataGeneratorV2,
  formatDuration,
  type DataGenerator,
  type Scenario,
  type HybridGeneratorConfig,
  type HybridGeneratorConfigV2,
} from "../src/generator/index.js";

// Usage:
//   npx tsx scripts/generate-all.ts
//   npx tsx scripts/generate-all.ts --rows 1000
//   npx tsx scripts/generate-all.ts -r 1000 --postgres
//   npx tsx scripts/generate-all.ts --clickhouse --trino
//   npx tsx scripts/generate-all.ts --scenario english-names
//   npx tsx scripts/generate-all.ts --scenario english-names --clickhouse -r 1_000
//   npx tsx scripts/generate-all.ts --scenario lookup-demo --clickhouse -r 1_000
//   npx tsx scripts/generate-all.ts --help

// Build name arrays from dictionaries
const ENGLISH_FIRST_NAMES = [
  ...getEnglishMaleNames(),
  ...getEnglishFemaleNames(),
];
const ENGLISH_LAST_NAMES = getEnglishSurnames();
const RUSSIAN_FIRST_NAMES = [
  ...getRussianMaleNames(),
  ...getRussianFemaleNames(),
];
const RUSSIAN_LAST_NAMES = [
  ...getRussianMaleSurnames(),
  ...getRussianFemaleSurnames(),
];

const SCENARIO_NAMES = [
  "simple",
  "english-names",
  "russian-names",
  "lookup-demo",
  "bonus-registry",
] as const;
type ScenarioName = (typeof SCENARIO_NAMES)[number];

const { values } = parseArgs({
  options: {
    rows: { type: "string", short: "r", default: "1000" },
    batch: { type: "string", short: "b" },
    scenario: { type: "string", short: "s", default: "simple" },
    sqlite: { type: "boolean", default: false },
    postgres: { type: "boolean", default: false },
    clickhouse: { type: "boolean", default: false },
    trino: { type: "boolean", default: false },
    hybrid: { type: "boolean", default: false },
    hybridV2: { type: "boolean", default: false },
    help: { type: "boolean", short: "h", default: false },
  },
});

if (values.help) {
  console.log(`
Usage: npx tsx scripts/generate-all.ts [options]

Options:
  -r, --rows <count>     Number of rows to generate (default: 1000, supports 1_000_000 format)
  -b, --batch <size>     Batch size for generation (e.g., 100_000_000 for 100M per batch)
  -s, --scenario <name>  Scenario to run: ${SCENARIO_NAMES.join(", ")} (default: simple)
  --sqlite               Generate for SQLite only
  --postgres             Generate for PostgreSQL only
  --clickhouse           Generate for ClickHouse only
  --trino                Generate for Trino only
  --hybrid               Generate for Hybrid (PostgreSQL + Trino via external table)
  --hybridV2             Generate for Hybrid V2 (PostgreSQL + Trino, optimized with Saga batches)
  -h, --help             Show this help message

Scenarios:
  simple         Random strings and values (5 columns)
  english-names  English first/last names with email template (7 columns)
  russian-names  Russian first/last names with email template (7 columns)
  lookup-demo    Employees with department lookup (demonstrates LookupTransformation)

If no database is specified, all databases are generated.

Examples:
  npx tsx scripts/generate-all.ts --rows 1000
  npx tsx scripts/generate-all.ts -r 10000 --postgres
  npx tsx scripts/generate-all.ts --scenario english-names --clickhouse
  npx tsx scripts/generate-all.ts -s russian-names --trino
  npx tsx scripts/generate-all.ts -r 1_000_000_000 -b 100_000_000 --trino
`);
  process.exit(0);
}

const ROW_COUNT = parseInt(values.rows.replace(/_/g, ""), 10);
const BATCH_SIZE = values.batch
  ? parseInt(values.batch.replace(/_/g, ""), 10)
  : undefined;
const SCENARIO = values.scenario as ScenarioName;

if (!SCENARIO_NAMES.includes(SCENARIO)) {
  console.error(
    `Invalid scenario: ${SCENARIO}. Valid options: ${SCENARIO_NAMES.join(", ")}`
  );
  process.exit(1);
}

function getScenarioConfig(scenario: ScenarioName, rowCount: number): Scenario {
  switch (scenario) {
    case "simple":
      return {
        name: "Simple benchmark",
        steps: [
          {
            table: {
              name: "samples",
              columns: [
                {
                  name: "id",
                  type: "bigint",
                  generator: { kind: "sequence", start: 1 },
                },
                {
                  name: "name",
                  type: "string",
                  generator: { kind: "randomString", length: 10 },
                },
                {
                  name: "value",
                  type: "float",
                  generator: { kind: "randomFloat", min: 0, max: 1000 },
                },
                {
                  name: "status",
                  type: "string",
                  generator: {
                    kind: "choice",
                    values: ["active", "pending", "inactive"],
                  },
                },
                {
                  name: "created_at",
                  type: "datetime",
                  generator: { kind: "datetime" },
                },
              ],
            },
            rowCount,
          },
        ],
      };

    case "english-names":
      return {
        name: "English names",
        steps: [
          {
            table: {
              name: "samples",
              columns: [
                {
                  name: "id",
                  type: "bigint",
                  generator: { kind: "sequence", start: 1 },
                },
                {
                  name: "first_name",
                  type: "string",
                  generator: {
                    kind: "choiceByLookup",
                    values: ENGLISH_FIRST_NAMES,
                  },
                },
                {
                  name: "last_name",
                  type: "string",
                  generator: {
                    kind: "choiceByLookup",
                    values: ENGLISH_LAST_NAMES,
                  },
                },
                {
                  name: "email",
                  type: "string",
                  generator: { kind: "constant", value: "" },
                },
                {
                  name: "score",
                  type: "float",
                  generator: { kind: "randomFloat", min: 0, max: 100 },
                },
                {
                  name: "status",
                  type: "string",
                  generator: {
                    kind: "choice",
                    values: ["active", "pending", "inactive"],
                  },
                },
                {
                  name: "created_at",
                  type: "datetime",
                  generator: { kind: "datetime" },
                },
              ],
            },
            rowCount,
            transformations: [
              {
                description: "Generate email from first and last name",
                transformations: [
                  {
                    kind: "template",
                    column: "email",
                    template: "{first_name}.{last_name}@example.com",
                    lowercase: true,
                  },
                ],
              },
            ],
          },
        ],
      };

    case "russian-names":
      return {
        name: "Russian names",
        steps: [
          {
            table: {
              name: "samples",
              columns: [
                {
                  name: "id",
                  type: "bigint",
                  generator: { kind: "sequence", start: 1 },
                },
                {
                  name: "first_name",
                  type: "string",
                  generator: {
                    kind: "choiceByLookup",
                    values: RUSSIAN_FIRST_NAMES,
                  },
                },
                {
                  name: "last_name",
                  type: "string",
                  generator: {
                    kind: "choiceByLookup",
                    values: RUSSIAN_LAST_NAMES,
                  },
                },
                {
                  name: "email",
                  type: "string",
                  generator: { kind: "constant", value: "" },
                },
                {
                  name: "score",
                  type: "float",
                  generator: { kind: "randomFloat", min: 0, max: 100 },
                },
                {
                  name: "status",
                  type: "string",
                  generator: {
                    kind: "choice",
                    values: ["active", "pending", "inactive"],
                  },
                },
                {
                  name: "created_at",
                  type: "datetime",
                  generator: { kind: "datetime" },
                },
              ],
            },
            rowCount,
            transformations: [
              {
                description: "Generate email from first and last name",
                transformations: [
                  {
                    kind: "template",
                    column: "email",
                    template: "{first_name}.{last_name}@example.com",
                    lowercase: true,
                  },
                ],
              },
            ],
          },
        ],
      };

    case "lookup-demo":
      return {
        name: "Lookup transformation demo",
        description:
          "Demonstrates LookupTransformation with departments and employees",
        steps: [
          // Step 1: Create departments lookup table
          {
            table: {
              name: "departments",
              description: "Departments lookup table (10K rows)",
              columns: [
                {
                  name: "id",
                  type: "integer",
                  generator: { kind: "sequence", start: 1 },
                },
                {
                  name: "name",
                  type: "string",
                  generator: { kind: "randomString", length: 12 },
                },
                {
                  name: "budget",
                  type: "float",
                  generator: {
                    kind: "randomFloat",
                    min: 100000,
                    max: 10000000,
                    precision: 2,
                  },
                },
              ],
            },
            rowCount: 10_000,
          },
          // Step 2: Create employees table with department_id
          {
            table: {
              name: "employees",
              description: "Employees with department reference",
              columns: [
                {
                  name: "id",
                  type: "bigint",
                  generator: { kind: "sequence", start: 1 },
                },
                {
                  name: "first_name",
                  type: "string",
                  generator: {
                    kind: "choiceByLookup",
                    values: ENGLISH_FIRST_NAMES,
                  },
                },
                {
                  name: "last_name",
                  type: "string",
                  generator: {
                    kind: "choiceByLookup",
                    values: ENGLISH_LAST_NAMES,
                  },
                },
                {
                  name: "department_id",
                  type: "integer",
                  generator: { kind: "randomInt", min: 1, max: 10_000 },
                },
                {
                  name: "department_name",
                  type: "string",
                  generator: { kind: "constant", value: "" },
                },
                {
                  name: "salary",
                  type: "float",
                  generator: {
                    kind: "randomFloat",
                    min: 30000,
                    max: 200000,
                    precision: 2,
                  },
                },
                {
                  name: "hire_date",
                  type: "datetime",
                  generator: { kind: "datetime" },
                },
              ],
            },
            rowCount,
          },
          // Step 3: Apply lookup transformation to populate department_name
          {
            tableName: "employees",
            transformations: [
              {
                description: "Lookup department name from departments table",
                transformations: [
                  {
                    kind: "lookup",
                    column: "department_name",
                    fromTable: "departments",
                    fromColumn: "name",
                    joinOn: {
                      targetColumn: "department_id",
                      lookupColumn: "id",
                    },
                  },
                ],
              },
            ],
          },
        ],
      };

    case "bonus-registry":
      return {
        name: "Bonus Registry (PostgreSQL + Trino hybrid)",
        description:
          "Bonus registry scenario for hybrid generators: PostgreSQL table with registrar data, Trino table with full bonus registry data",
        steps: [
          {
            table: {
              name: "bonus_registry",
              description: "Bonus registry table (PostgreSQL: registrar fields, Trino: full data)",
              columns: [
                // Поля для PostgreSQL (основные)
                {
                  name: "id",
                  type: "string",
                  generator: { kind: "uuid" },
                },
                {
                  name: "registrar_type_id",
                  type: "string",
                  generator: {
                    kind: "choice",
                    values: ["TYPE_1", "TYPE_2", "TYPE_3", "TYPE_4", "TYPE_5"],
                  },
                },
                {
                  name: "registrar_id",
                  type: "string",
                  generator: { kind: "randomString", length: 10 },
                },
                {
                  name: "row",
                  type: "integer",
                  generator: { kind: "randomInt", min: 1, max: 1000 },
                },
                {
                  name: "amount",
                  type: "float",
                  generator: {
                    kind: "randomFloat",
                    min: 0,
                    max: 10000,
                    precision: 2,
                  },
                },
                {
                  name: "created_at",
                  type: "datetime",
                  generator: { kind: "datetime" },
                },
                // Поля для Trino (дополнительные)
                {
                  name: "date",
                  type: "datetime",
                  generator: { kind: "datetime" },
                },
                {
                  name: "manager_id",
                  type: "integer",
                  generator: { kind: "randomInt", min: 1, max: 1000 },
                },
                {
                  name: "bs_profile_id",
                  type: "string",
                  generator: { kind: "randomString", length: 10 },
                },
                {
                  name: "accounted_for_bs_profile_id",
                  type: "string",
                  generator: { kind: "randomString", length: 10 },
                },
                {
                  name: "first_name",
                  type: "string",
                  generator: {
                    kind: "choiceByLookup",
                    values: ENGLISH_FIRST_NAMES,
                  },
                },
                {
                  name: "first_name_latin",
                  type: "string",
                  generator: {
                    kind: "choiceByLookup",
                    values: ENGLISH_FIRST_NAMES,
                  },
                },
                {
                  name: "last_name",
                  type: "string",
                  generator: {
                    kind: "choiceByLookup",
                    values: ENGLISH_LAST_NAMES,
                  },
                },
                {
                  name: "last_name_latin",
                  type: "string",
                  generator: {
                    kind: "choiceByLookup",
                    values: ENGLISH_LAST_NAMES,
                  },
                },
                {
                  name: "departure_id",
                  type: "integer",
                  generator: { kind: "randomInt", min: 1, max: 100 },
                },
                {
                  name: "arrival_id",
                  type: "integer",
                  generator: { kind: "randomInt", min: 1, max: 100 },
                },
                {
                  name: "departure_date",
                  type: "date",
                  generator: { kind: "datetime" },
                },
                {
                  name: "currency_entry_id",
                  type: "integer",
                  generator: { kind: "randomInt", min: 1, max: 10 },
                },
                {
                  name: "bonus_type_id",
                  type: "string",
                  generator: { kind: "randomString", length: 8 },
                },
                {
                  name: "action_source_id",
                  type: "string",
                  generator: { kind: "randomString", length: 8 },
                },
                {
                  name: "bs_bonus_ticket_id",
                  type: "string",
                  generator: { kind: "randomString", length: 12 },
                },
                {
                  name: "validity_time",
                  type: "integer",
                  generator: { kind: "randomInt", min: 30, max: 365 },
                },
                {
                  name: "date_of_expire",
                  type: "date",
                  generator: { kind: "datetime" },
                },
                {
                  name: "car_type_id",
                  type: "string",
                  generator: { kind: "randomString", length: 5 },
                },
                {
                  name: "express_carrier_id",
                  type: "integer",
                  generator: { kind: "randomInt", min: 1, max: 50 },
                },
                {
                  name: "carrier_id",
                  type: "string",
                  generator: { kind: "randomString", length: 8 },
                },
                {
                  name: "bs_partner_id",
                  type: "integer",
                  generator: { kind: "randomInt", min: 1, max: 100 },
                },
                {
                  name: "bs_train_number_id",
                  type: "string",
                  generator: { kind: "randomString", length: 10 },
                },
                {
                  name: "bs_tourism_train_id",
                  type: "string",
                  generator: { kind: "randomString", length: 10 },
                },
                {
                  name: "accounted_in_calculation",
                  type: "boolean",
                  generator: {
                    kind: "choice",
                    values: [true, false],
                  },
                },
                {
                  name: "cancelled",
                  type: "boolean",
                  generator: {
                    kind: "choice",
                    values: [true, false],
                  },
                },
                {
                  name: "bs_quota_id",
                  type: "integer",
                  generator: { kind: "randomInt", min: 1, max: 1000 },
                },
                {
                  name: "doc_to_track_type_id",
                  type: "string",
                  generator: { kind: "randomString", length: 5 },
                },
                {
                  name: "doc_to_track_id",
                  type: "string",
                  generator: { kind: "randomString", length: 10 },
                },
                {
                  name: "doc_to_track_date",
                  type: "date",
                  generator: { kind: "datetime" },
                },
                {
                  name: "active_date",
                  type: "date",
                  generator: { kind: "datetime" },
                },
                {
                  name: "trip_for_another_person",
                  type: "boolean",
                  generator: {
                    kind: "choice",
                    values: [true, false],
                  },
                },
                {
                  name: "ticket_number",
                  type: "string",
                  generator: { kind: "randomString", length: 15 },
                },
                {
                  name: "currency_amount",
                  type: "integer",
                  generator: { kind: "randomInt", min: 100, max: 10000 },
                },
                {
                  name: "bs_partner_bonus_type_id",
                  type: "string",
                  generator: { kind: "randomString", length: 8 },
                },
                {
                  name: "express_service_class_id",
                  type: "integer",
                  generator: { kind: "randomInt", min: 1, max: 5 },
                },
                {
                  name: "date_to_cancelled",
                  type: "datetime",
                  generator: { kind: "datetime" },
                },
                {
                  name: "prolongable",
                  type: "boolean",
                  generator: {
                    kind: "choice",
                    values: [true, false],
                  },
                },
                {
                  name: "active_by_trips",
                  type: "boolean",
                  generator: {
                    kind: "choice",
                    values: [true, false],
                  },
                },
                {
                  name: "is_empty",
                  type: "boolean",
                  generator: {
                    kind: "choice",
                    values: [true, false],
                  },
                },
                {
                  name: "amount_calculation",
                  type: "string",
                  generator: { kind: "randomString", length: 20 },
                },
                {
                  name: "distance",
                  type: "integer",
                  generator: { kind: "randomInt", min: 100, max: 5000 },
                },
                {
                  name: "addition_amount",
                  type: "integer",
                  generator: { kind: "randomInt", min: 0, max: 1000 },
                },
                {
                  name: "operation_doc_type_id",
                  type: "string",
                  generator: { kind: "randomString", length: 5 },
                },
                {
                  name: "is_merged",
                  type: "boolean",
                  generator: {
                    kind: "choice",
                    values: [true, false],
                  },
                },
                {
                  name: "merged_date",
                  type: "date",
                  generator: { kind: "datetime" },
                },
              ],
            },
            rowCount,
          },
        ],
      };
  }
}

const scenarioConfig = getScenarioConfig(SCENARIO, ROW_COUNT);

interface GeneratorEntry {
  name: string;
  generator: DataGenerator;
  flag: keyof typeof values;
}

function createGenerators(): GeneratorEntry[] {
  const generators: GeneratorEntry[] = [
    {
      name: "SQLite",
      flag: "sqlite",
      generator: new SQLiteDataGenerator({ path: "data/samples.db" }),
    },
    {
      name: "PostgreSQL",
      flag: "postgres",
      generator: new PostgresDataGenerator({
        host: "localhost",
        port: 5432,
        database: "appdb",
        username: "postgres",
        password: "postgres",
      }),
    },
    {
      name: "ClickHouse",
      flag: "clickhouse",
      generator: new ClickHouseDataGenerator({
        host: "localhost",
        port: 8123,
        database: "default",
        username: "default",
        password: "clickhouse",
      }),
    },
    {
      name: "Trino",
      flag: "trino",
      generator: new TrinoDataGenerator({
        host: "localhost",
        port: 8080,
        user: "trino",
        catalog: "iceberg",
        schema: "warehouse",
      }),
    },
  ];

  // Функция для создания маппинга колонок на основе сценария
  function createColumnMapping(
    scenario: ScenarioName
  ): {
    postgresColumnMapping: HybridGeneratorConfig["postgresColumnMapping"];
    trinoColumnMapping: HybridGeneratorConfig["trinoColumnMapping"];
  } {
    switch (scenario) {
      case "simple": {
        return {
          postgresColumnMapping: [
            { sourceColumn: "id", targetColumn: "id" },
            { sourceColumn: "name", targetColumn: "name" },
            { sourceColumn: "value", targetColumn: "value" },
            { sourceColumn: "status", targetColumn: "status" },
            { sourceColumn: "created_at", targetColumn: "created_at" },
          ],
          trinoColumnMapping: [
            { sourceColumn: "id", targetColumn: "id" },
            { sourceColumn: "name", targetColumn: "name" },
            { sourceColumn: "value", targetColumn: "value" },
            { sourceColumn: "status", targetColumn: "status" },
            { sourceColumn: "created_at", targetColumn: "created_at" },
          ],
        };
      }
      case "english-names":
      case "russian-names": {
        return {
          postgresColumnMapping: [
            { sourceColumn: "id", targetColumn: "id" },
            { sourceColumn: "first_name", targetColumn: "first_name" },
            { sourceColumn: "last_name", targetColumn: "last_name" },
            { sourceColumn: "email", targetColumn: "email" },
            { sourceColumn: "score", targetColumn: "score" },
            { sourceColumn: "status", targetColumn: "status" },
            { sourceColumn: "created_at", targetColumn: "created_at" },
          ],
          trinoColumnMapping: [
            { sourceColumn: "id", targetColumn: "id" },
            { sourceColumn: "first_name", targetColumn: "first_name" },
            { sourceColumn: "last_name", targetColumn: "last_name" },
            { sourceColumn: "email", targetColumn: "email" },
            { sourceColumn: "score", targetColumn: "score" },
            { sourceColumn: "status", targetColumn: "status" },
            { sourceColumn: "created_at", targetColumn: "created_at" },
          ],
        };
      }
      case "lookup-demo": {
        // Для lookup-demo используем employees таблицу
        return {
          postgresColumnMapping: [
            { sourceColumn: "id", targetColumn: "id" },
            { sourceColumn: "first_name", targetColumn: "first_name" },
            { sourceColumn: "last_name", targetColumn: "last_name" },
            { sourceColumn: "department_id", targetColumn: "department_id" },
            { sourceColumn: "department_name", targetColumn: "department_name" },
            { sourceColumn: "salary", targetColumn: "salary" },
            { sourceColumn: "hire_date", targetColumn: "hire_date" },
          ],
          trinoColumnMapping: [
            { sourceColumn: "id", targetColumn: "id" },
            { sourceColumn: "first_name", targetColumn: "first_name" },
            { sourceColumn: "last_name", targetColumn: "last_name" },
            { sourceColumn: "department_id", targetColumn: "department_id" },
            { sourceColumn: "department_name", targetColumn: "department_name" },
            { sourceColumn: "salary", targetColumn: "salary" },
            { sourceColumn: "hire_date", targetColumn: "hire_date" },
          ],
        };
      }
      case "bonus-registry": {
        // PostgreSQL: только основные поля для регистрации
        // Trino: все поля включая дополнительные
        return {
          postgresColumnMapping: [
            { sourceColumn: "id", targetColumn: "id" },
            { sourceColumn: "registrar_type_id", targetColumn: "registrar_type_id" },
            { sourceColumn: "registrar_id", targetColumn: "registrar_id" },
            { sourceColumn: "row", targetColumn: "row" },
            { sourceColumn: "amount", targetColumn: "amount" },
            { sourceColumn: "created_at", targetColumn: "createdAt" },
          ],
          trinoColumnMapping: [
            // Поля из PostgreSQL
            { sourceColumn: "id", targetColumn: "id" },
            { sourceColumn: "date", targetColumn: "date" },
            { sourceColumn: "registrar_type_id", targetColumn: "registrar_type_id" },
            { sourceColumn: "registrar_id", targetColumn: "registrar_id" },
            { sourceColumn: "row", targetColumn: "row" },
            { sourceColumn: "amount", targetColumn: "amount" },
            // Дополнительные поля для Trino
            { sourceColumn: "manager_id", targetColumn: "manager_id" },
            { sourceColumn: "bs_profile_id", targetColumn: "bs_profile_id" },
            { sourceColumn: "accounted_for_bs_profile_id", targetColumn: "accounted_for_bs_profile_id" },
            { sourceColumn: "first_name", targetColumn: "first_name" },
            { sourceColumn: "first_name_latin", targetColumn: "first_name_latin" },
            { sourceColumn: "last_name", targetColumn: "last_name" },
            { sourceColumn: "last_name_latin", targetColumn: "last_name_latin" },
            { sourceColumn: "departure_id", targetColumn: "departure_id" },
            { sourceColumn: "arrival_id", targetColumn: "arrival_id" },
            { sourceColumn: "departure_date", targetColumn: "departure_date" },
            { sourceColumn: "currency_entry_id", targetColumn: "currency_entry_id" },
            { sourceColumn: "bonus_type_id", targetColumn: "bonus_type_id" },
            { sourceColumn: "action_source_id", targetColumn: "action_source_id" },
            { sourceColumn: "bs_bonus_ticket_id", targetColumn: "bs_bonus_ticket_id" },
            { sourceColumn: "validity_time", targetColumn: "validity_time" },
            { sourceColumn: "date_of_expire", targetColumn: "date_of_expire" },
            { sourceColumn: "car_type_id", targetColumn: "car_type_id" },
            { sourceColumn: "express_carrier_id", targetColumn: "express_carrier_id" },
            { sourceColumn: "carrier_id", targetColumn: "carrier_id" },
            { sourceColumn: "bs_partner_id", targetColumn: "bs_partner_id" },
            { sourceColumn: "bs_train_number_id", targetColumn: "bs_train_number_id" },
            { sourceColumn: "bs_tourism_train_id", targetColumn: "bs_tourism_train_id" },
            { sourceColumn: "accounted_in_calculation", targetColumn: "accounted_in_calculation" },
            { sourceColumn: "cancelled", targetColumn: "cancelled" },
            { sourceColumn: "bs_quota_id", targetColumn: "bs_quota_id" },
            { sourceColumn: "doc_to_track_type_id", targetColumn: "doc_to_track_type_id" },
            { sourceColumn: "doc_to_track_id", targetColumn: "doc_to_track_id" },
            { sourceColumn: "doc_to_track_date", targetColumn: "doc_to_track_date" },
            { sourceColumn: "active_date", targetColumn: "active_date" },
            { sourceColumn: "trip_for_another_person", targetColumn: "trip_for_another_person" },
            { sourceColumn: "ticket_number", targetColumn: "ticket_number" },
            { sourceColumn: "currency_amount", targetColumn: "currency_amount" },
            { sourceColumn: "bs_partner_bonus_type_id", targetColumn: "bs_partner_bonus_type_id" },
            { sourceColumn: "express_service_class_id", targetColumn: "express_service_class_id" },
            { sourceColumn: "date_to_cancelled", targetColumn: "date_to_cancelled" },
            { sourceColumn: "prolongable", targetColumn: "prolongable" },
            { sourceColumn: "active_by_trips", targetColumn: "active_by_trips" },
            { sourceColumn: "is_empty", targetColumn: "is_empty" },
            { sourceColumn: "amount_calculation", targetColumn: "amount_calculation" },
            { sourceColumn: "distance", targetColumn: "distance" },
            { sourceColumn: "addition_amount", targetColumn: "addition_amount" },
            { sourceColumn: "operation_doc_type_id", targetColumn: "operation_doc_type_id" },
            { sourceColumn: "is_merged", targetColumn: "is_merged" },
            { sourceColumn: "merged_date", targetColumn: "merged_date" },
          ],
        };
      }
      default: {
        // По умолчанию используем simple
        return createColumnMapping("simple");
      }
    }
  }

  // Гибридный генератор (вариант 1: через внешнюю таблицу)
  // Для гибридных генераторов всегда используем bonus-registry сценарий
  const hybridScenario: ScenarioName = "bonus-registry";
  const columnMapping = createColumnMapping(hybridScenario);
  const hybridConfig: HybridGeneratorConfig = {
    postgresConfig: {
      host: "localhost",
      port: 5432,
      database: "appdb",
      username: "postgres",
      password: "postgres",
    },
    trinoConfig: {
      host: "localhost",
      port: 8080,
      catalog: "iceberg",
      schema: "warehouse",
      user: "trino",
    },
    postgresColumnMapping: columnMapping.postgresColumnMapping,
    trinoColumnMapping: columnMapping.trinoColumnMapping,
    postgresTableName: "BonusRegistryUniqueAndBalanceCheck",
    trinoTableName: "bonus_registry",
  };

  generators.push({
    name: "Hybrid (PostgreSQL + Trino)",
    flag: "hybrid",
    generator: new HybridDataGenerator(hybridConfig),
  });

  // Гибридный генератор (вариант 2: Saga с оптимизацией)
  const hybridConfigV2: HybridGeneratorConfigV2 = {
    ...hybridConfig,
    sagaBatchSize: 100000, // 100K строк на сагу
  };

  generators.push({
    name: "Hybrid V2 (PostgreSQL + Trino, optimized)",
    flag: "hybridV2",
    generator: new HybridDataGeneratorV2(hybridConfigV2),
  });

  return generators;
}

async function generateForDatabase(entry: GeneratorEntry): Promise<void> {
  const { name, generator } = entry;
  console.log(`\n=== ${name} ===`);

  try {
    await generator.connect();
    console.log(`Connected to ${name}`);

    // Для гибридных генераторов используем bonus-registry сценарий
    const scenarioToUse =
      entry.flag === "hybrid" || entry.flag === "hybridV2"
        ? getScenarioConfig("bonus-registry", ROW_COUNT)
        : scenarioConfig;

    const result = await generator.runScenario({
      scenario: scenarioToUse,
      dropFirst: true,
      batchSize: BATCH_SIZE,
    });

    // Log results for each step
    for (const step of result.steps) {
      if (step.generate) {
        console.log(
          `[${step.tableName}] Generated ${step.generate.rowsInserted.toLocaleString()} rows in ${formatDuration(step.generate.generateMs)}`
        );
      }
      if (step.transform) {
        console.log(
          `[${step.tableName}] Applied ${String(step.transform.batchesApplied)} transformation batch(es) in ${formatDuration(step.transform.durationMs)}`
        );
      }
    }

    console.log(
      `Total: ${result.totalRowsInserted.toLocaleString()} rows in ${formatDuration(result.durationMs)} (generation: ${formatDuration(result.generateMs)}, transformation: ${formatDuration(result.transformMs)}, optimize: ${formatDuration(result.optimizeMs)})`
    );

    // Verify row counts and show sample for each unique table
    const uniqueTables = [...new Set(result.steps.map((s) => s.tableName))];
    for (const tableName of uniqueTables) {
      const count = await generator.countRows(tableName);
      const size = await generator.getTableSizeForHuman(tableName);
      console.log(
        `[${tableName}] Verified: ${count.toLocaleString()} rows${size ? `, ${size}` : ""}`
      );
      const rows = await generator.queryRows(tableName, 1);
      if (rows.length > 0) {
        console.log(`[${tableName}] Sample:`, rows[0]);
      }
    }

    console.log(`Disconnected from ${name}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error(`Error with ${name}: ${message}`);
  } finally {
    await generator.disconnect();
  }
}

async function main(): Promise<void> {
  const generators = createGenerators();
  console.log(`Scenario: ${SCENARIO}`);
  console.log(
    `Generating ${ROW_COUNT.toLocaleString()} rows in each database...`
  );

  // Check which databases to generate for
  const anyDbSelected = generators.some((g) => values[g.flag]);
  const enableAll = !anyDbSelected;

  for (const entry of generators) {
    const enabled = enableAll || values[entry.flag];
    if (enabled) {
      await generateForDatabase(entry);
    } else {
      console.log(`\n=== ${entry.name} === (skipped)`);
    }
  }

  console.log("\n=== Done ===");
}

main().catch(console.error);
