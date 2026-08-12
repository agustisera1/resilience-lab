import { CardBrand, Currency, PaymentMethod } from "@/domain/models/payments";

export const CURRENCIES: readonly Currency[] = ["USD", "EUR", "ARS"];
export const CARD_BRANDS: readonly CardBrand[] = ["visa", "mastercard", "amex"];
export const METHOD_TYPES: readonly PaymentMethod["type"][] = ["card"];

// Positive decimal, up to two fraction digits
export const AMOUNT = /^\d+(\.\d{1,2})?$/;
export const LAST4 = /^\d{4}$/;

export class ValidationError extends Error {}

export function fail(message: string): never {
  throw new ValidationError(message);
}

export function record(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail(`${field} must be an object`);
  }
  return value as Record<string, unknown>;
}

export function text(value: unknown, field: string): string {
  if (typeof value !== "string") fail(`${field} must be a string`);
  const trimmed = value.trim();
  if (!trimmed) fail(`${field} must not be empty`);
  return trimmed;
}

export function integer(
  value: unknown,
  field: string,
  min: number,
  max: number,
): number {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    fail(`${field} must be an integer`);
  }
  if (value < min || value > max) {
    fail(`${field} must be between ${min} and ${max}`);
  }
  return value;
}

export function option<T extends string>(
  value: unknown,
  options: readonly T[],
  field: string,
): T {
  const raw = text(value, field);
  if (!options.includes(raw as T)) {
    fail(`${field} must be one of: ${options.join(", ")}`);
  }
  return raw as T;
}

export function money(value: unknown, field: string): string {
  const raw = text(value, field);
  if (!AMOUNT.test(raw)) {
    fail(`${field} must be a decimal amount with up to 2 decimals`);
  }
  if (Number(raw) <= 0) fail(`${field} must be greater than zero`);
  return raw;
}

export function optionalMoney(value: unknown, field: string): string | null {
  if (value === undefined || value === null) return null;
  return money(value, field);
}

export function optionalText(value: unknown, field: string): string | null {
  if (value === undefined || value === null) return null;
  return text(value, field);
}

export function stringMap(
  value: unknown,
  field: string,
): Record<string, string> | undefined {
  if (value === undefined || value === null) return undefined;
  const map = record(value, field);

  for (const [key, entry] of Object.entries(map)) {
    if (typeof entry !== "string") fail(`${field}.${key} must be a string`);
  }

  return map as Record<string, string>;
}

export function pattern(
  value: unknown,
  regex: RegExp,
  field: string,
  hint: string,
): string {
  const raw = text(value, field);
  if (!regex.test(raw)) fail(`${field} ${hint}`);
  return raw;
}
