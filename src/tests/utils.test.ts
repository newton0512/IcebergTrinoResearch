import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  hashObject,
  generateRegistrarObject,
  bonus_registry_faker,
  type RegistrarObject,
  type BonusRegistryFakerObject,
} from "../hybrid-writer/utils.js";

describe("utils", () => {
  describe("hashObject", () => {
    it("should generate consistent hash for same object", () => {
      const obj = { name: "John", age: 30 };
      const hash1 = hashObject(obj);
      const hash2 = hashObject(obj);
      expect(hash1).toBe(hash2);
    });

    it("should generate same hash regardless of key order", () => {
      const obj1 = { name: "John", age: 30 };
      const obj2 = { age: 30, name: "John" };
      const hash1 = hashObject(obj1);
      const hash2 = hashObject(obj2);
      expect(hash1).toBe(hash2);
    });

    it("should generate different hashes for different values", () => {
      const obj1 = { name: "John", age: 30 };
      const obj2 = { name: "Jane", age: 30 };
      const hash1 = hashObject(obj1);
      const hash2 = hashObject(obj2);
      expect(hash1).not.toBe(hash2);
    });

    it("should handle numeric values", () => {
      const obj = { id: 123, count: 456 };
      const hash = hashObject(obj);
      expect(hash).toBeTruthy();
      expect(typeof hash).toBe("string");
      expect(hash.length).toBeGreaterThan(0);
    });

    it("should handle string values", () => {
      const obj = { name: "test", value: "value" };
      const hash = hashObject(obj);
      expect(hash).toBeTruthy();
      expect(typeof hash).toBe("string");
    });

    it("should handle mixed string and number values", () => {
      const obj = { name: "John", age: 30, score: 100 };
      const hash = hashObject(obj);
      expect(hash).toBeTruthy();
      expect(typeof hash).toBe("string");
    });

    it("should generate SHA256 hex hash (64 characters)", () => {
      const obj = { test: "value" };
      const hash = hashObject(obj);
      expect(hash.length).toBe(64); // SHA256 produces 64 hex characters
      expect(/^[0-9a-f]{64}$/i.test(hash)).toBe(true);
    });
  });

  describe("generateRegistrarObject", () => {
    it("should generate object with required fields", () => {
      const result = generateRegistrarObject();
      expect(result).toHaveProperty("registrar_type_id");
      expect(result).toHaveProperty("registrar_id");
      expect(result).toHaveProperty("row");
    });

    it("should generate valid registrar_type_id from predefined list", () => {
      const validTypes = [
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

      // Генерируем несколько объектов и проверяем, что все типы валидны
      for (let i = 0; i < 50; i++) {
        const result = generateRegistrarObject();
        expect(validTypes).toContain(result.registrar_type_id);
      }
    });

    it("should generate valid UUID for registrar_id", () => {
      const uuidRegex =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      const result = generateRegistrarObject();
      expect(result.registrar_id).toMatch(uuidRegex);
    });

    it("should generate unique registrar_id for each call", () => {
      const result1 = generateRegistrarObject();
      const result2 = generateRegistrarObject();
      expect(result1.registrar_id).not.toBe(result2.registrar_id);
    });

    it("should generate row between 1 and 10", () => {
      for (let i = 0; i < 100; i++) {
        const result = generateRegistrarObject();
        expect(result.row).toBeGreaterThanOrEqual(1);
        expect(result.row).toBeLessThanOrEqual(10);
        expect(Number.isInteger(result.row)).toBe(true);
      }
    });

    it("should generate different objects on multiple calls", () => {
      const results = Array.from({ length: 10 }, () =>
        generateRegistrarObject()
      );
      const uniqueIds = new Set(results.map((r) => r.registrar_id));
      // С высокой вероятностью все ID должны быть уникальными
      expect(uniqueIds.size).toBeGreaterThan(1);
    });
  });

  describe("bonus_registry_faker", () => {
    it("should generate object with all required fields", () => {
      const result = bonus_registry_faker();
      expect(result).toHaveProperty("id");
      expect(result).toHaveProperty("date");
      expect(result).toHaveProperty("manager_id");
      expect(result).toHaveProperty("bs_profile_id");
      expect(result).toHaveProperty("accounted_for_bs_profile_id");
      expect(result).toHaveProperty("first_name");
      expect(result).toHaveProperty("first_name_latin");
      expect(result).toHaveProperty("last_name");
      expect(result).toHaveProperty("last_name_latin");
      expect(result).toHaveProperty("departure_id");
      expect(result).toHaveProperty("arrival_id");
      expect(result).toHaveProperty("departure_date");
      expect(result).toHaveProperty("currency_entry_id");
      expect(result).toHaveProperty("bonus_type_id");
      expect(result).toHaveProperty("action_source_id");
      expect(result).toHaveProperty("validity_time");
      expect(result).toHaveProperty("date_of_expire");
      expect(result).toHaveProperty("doc_to_track_type_id");
      expect(result).toHaveProperty("doc_to_track_id");
      expect(result).toHaveProperty("doc_to_track_date");
      expect(result).toHaveProperty("amount");
    });

    it("should generate valid UUID for id", () => {
      const uuidRegex =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      const result = bonus_registry_faker();
      expect(result.id).toMatch(uuidRegex);
    });

    it("should generate unique id for each call", () => {
      const result1 = bonus_registry_faker();
      const result2 = bonus_registry_faker();
      expect(result1.id).not.toBe(result2.id);
    });

    it("should generate valid Date for date field", () => {
      const result = bonus_registry_faker();
      expect(result.date).toBeInstanceOf(Date);
      expect(result.date.getTime()).toBeLessThanOrEqual(Date.now());
    });

    it("should generate manager_id as number between 1 and 1000", () => {
      for (let i = 0; i < 50; i++) {
        const result = bonus_registry_faker();
        expect(result.manager_id).toBeGreaterThanOrEqual(1);
        expect(result.manager_id).toBeLessThanOrEqual(1000);
        expect(Number.isInteger(result.manager_id)).toBe(true);
      }
    });

    it("should generate departure_id and arrival_id as numbers between 1 and 100", () => {
      for (let i = 0; i < 50; i++) {
        const result = bonus_registry_faker();
        expect(result.departure_id).toBeGreaterThanOrEqual(1);
        expect(result.departure_id).toBeLessThanOrEqual(100);
        expect(result.arrival_id).toBeGreaterThanOrEqual(1);
        expect(result.arrival_id).toBeLessThanOrEqual(100);
        expect(Number.isInteger(result.departure_id)).toBe(true);
        expect(Number.isInteger(result.arrival_id)).toBe(true);
      }
    });

    it("should generate currency_entry_id as number between 1 and 10", () => {
      for (let i = 0; i < 50; i++) {
        const result = bonus_registry_faker();
        expect(result.currency_entry_id).toBeGreaterThanOrEqual(1);
        expect(result.currency_entry_id).toBeLessThanOrEqual(10);
        expect(Number.isInteger(result.currency_entry_id)).toBe(true);
      }
    });

    it("should generate validity_time as number between 30 and 365", () => {
      for (let i = 0; i < 50; i++) {
        const result = bonus_registry_faker();
        expect(result.validity_time).toBeGreaterThanOrEqual(30);
        expect(result.validity_time).toBeLessThanOrEqual(365);
        expect(Number.isInteger(result.validity_time)).toBe(true);
      }
    });

    it("should generate amount as number between 100 and 10000", () => {
      for (let i = 0; i < 50; i++) {
        const result = bonus_registry_faker();
        expect(result.amount).toBeGreaterThanOrEqual(100);
        expect(result.amount).toBeLessThanOrEqual(10000);
        expect(Number.isInteger(result.amount)).toBe(true);
      }
    });

    it("should generate valid bonus_type_id from predefined list", () => {
      const validTypes = ["premial", "qualification"];
      for (let i = 0; i < 50; i++) {
        const result = bonus_registry_faker();
        expect(validTypes).toContain(result.bonus_type_id);
      }
    });

    it("should generate valid action_source_id from predefined list", () => {
      const validSources = ["operator", "auto"];
      for (let i = 0; i < 50; i++) {
        const result = bonus_registry_faker();
        expect(validSources).toContain(result.action_source_id);
      }
    });

    it("should generate valid doc_to_track_type_id from registrar types", () => {
      const validTypes = [
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
      for (let i = 0; i < 50; i++) {
        const result = bonus_registry_faker();
        expect(validTypes).toContain(result.doc_to_track_type_id);
      }
    });

    it("should generate valid UUID for doc_to_track_id", () => {
      const uuidRegex =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      const result = bonus_registry_faker();
      expect(result.doc_to_track_id).toMatch(uuidRegex);
    });

    it("should generate valid Date for doc_to_track_date", () => {
      const result = bonus_registry_faker();
      expect(result.doc_to_track_date).toBeInstanceOf(Date);
    });

    it("should generate valid Date for date_of_expire", () => {
      const result = bonus_registry_faker();
      expect(result.date_of_expire).toBeInstanceOf(Date);
      expect(result.date_of_expire.getTime()).toBeGreaterThan(Date.now());
    });

    it("should generate valid Date for departure_date", () => {
      const result = bonus_registry_faker();
      expect(result.departure_date).toBeInstanceOf(Date);
    });

    it("should generate non-null first_name_latin and last_name_latin", () => {
      for (let i = 0; i < 50; i++) {
        const result = bonus_registry_faker();
        expect(result.first_name_latin).not.toBeNull();
        expect(result.last_name_latin).not.toBeNull();
        expect(typeof result.first_name_latin).toBe("string");
        expect(typeof result.last_name_latin).toBe("string");
      }
    });

    it("should generate boolean values for boolean fields", () => {
      const result = bonus_registry_faker();
      expect(typeof result.accounted_in_calculation).toBe("boolean");
      expect(typeof result.cancelled).toBe("boolean");
      expect(typeof result.trip_for_another_person).toBe("boolean");
      expect(typeof result.is_empty).toBe("boolean");
      expect(typeof result.is_merged).toBe("boolean");
    });

    it("should generate bs_profile_id and accounted_for_bs_profile_id as strings", () => {
      const result = bonus_registry_faker();
      expect(typeof result.bs_profile_id).toBe("string");
      expect(typeof result.accounted_for_bs_profile_id).toBe("string");
      // Обычно они совпадают
      expect(result.accounted_for_bs_profile_id).toBe(result.bs_profile_id);
    });

    it("should handle nullable fields correctly", () => {
      // Некоторые поля могут быть null
      const result = bonus_registry_faker();
      // Проверяем, что nullable поля либо имеют значение, либо null
      if (result.bs_bonus_ticket_id !== null) {
        expect(typeof result.bs_bonus_ticket_id).toBe("string");
      }
      if (result.active_date !== null) {
        expect(result.active_date).toBeInstanceOf(Date);
      }
      if (result.date_to_cancelled !== null) {
        expect(result.date_to_cancelled).toBeInstanceOf(Date);
      }
    });

    it("should generate valid amount_calculation as JSON string when not null", () => {
      for (let i = 0; i < 50; i++) {
        const result = bonus_registry_faker();
        if (result.amount_calculation !== null) {
          expect(typeof result.amount_calculation).toBe("string");
          // Проверяем, что это валидный JSON
          expect(() => JSON.parse(result.amount_calculation!)).not.toThrow();
          const parsed = JSON.parse(result.amount_calculation!);
          expect(parsed).toHaveProperty("method");
          expect(parsed).toHaveProperty("value");
        }
      }
    });
  });
});

