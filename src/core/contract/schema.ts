// The two shapes that cross the AI boundary. SPEC §6.1 and §6.2.

import { z } from 'zod';
import type { Contract, ContractRequest } from '../types';
import { MAX_COLUMNS, SAMPLE_ROWS, TOP_SHAPES, VALUE_CAP, VALUE_MAX_LENGTH } from './request';

/**
 * SPEC §6.2: the contract the model returns. It is sent to the API as the structured-output
 * schema, so it stays inside the supported subset of JSON Schema: objects, arrays, strings and
 * string enums, every property required, no length or count constraints, no unions.
 */
export const ContractSchema = z.object({
  columns: z.array(
    z.object({
      name: z.string(),
      meaning: z.string(),
      role: z.enum(['identifier', 'category', 'measure', 'date', 'free-text', 'other']),
      format: z.enum(['email', 'url', 'none']),
    }),
  ),
  missingTokens: z.array(z.object({ column: z.string(), token: z.string() })),
  canonicalGroups: z.array(z.object({ column: z.string(), values: z.array(z.string()), reason: z.string() })),
  suspiciousValues: z.array(z.object({ column: z.string(), value: z.string(), reason: z.string() })),
  ranges: z.array(z.object({ column: z.string(), min: z.string(), max: z.string(), reason: z.string() })),
  dependencies: z.array(z.object({ determinant: z.string(), dependent: z.string(), reason: z.string() })),
}) satisfies z.ZodType<Contract>;

const count = z.number().int().nonnegative();
const numeric = z.strictObject({
  count,
  min: z.number(),
  p5: z.number(),
  q1: z.number(),
  median: z.number(),
  q3: z.number(),
  p95: z.number(),
  max: z.number(),
});

/**
 * SPEC §6.1: what the contract route accepts. Strict and capped with the limits
 * `buildContractRequest` works to, so the route cannot be used to send arbitrary text.
 */
export const ContractRequestSchema = z.strictObject({
  rowCount: count,
  columns: z
    .array(
      z.strictObject({
        name: z.string(),
        kind: z.enum(['number', 'date', 'text']),
        rows: count,
        missing: count,
        distinct: count,
        categorical: z.boolean(),
        freeText: z.boolean(),
        identifierLike: z.boolean(),
        numeric: numeric.optional(),
        shapes: z.array(z.strictObject({ shape: z.string(), count })).max(TOP_SHAPES),
        values: z
          .array(z.strictObject({ value: z.string().max(VALUE_MAX_LENGTH), count, cut: z.boolean() }))
          .max(VALUE_CAP),
        allValues: z.boolean(),
      }),
    )
    .min(1)
    .max(MAX_COLUMNS),
  sampleRows: z.array(z.array(z.string().max(VALUE_MAX_LENGTH)).max(MAX_COLUMNS)).max(SAMPLE_ROWS),
}) satisfies z.ZodType<ContractRequest>;
