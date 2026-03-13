/**
 * AG-UI Middleware Types and Configuration
 *
 * Defines the middleware options schema and types for AG-UI protocol integration.
 */

import type { BaseEvent } from "@ag-ui/core";
import { z } from "zod";

/**
 * Middleware options schema with Zod validation.
 */
export const AGUIMiddlewareOptionsSchema = z.object({
  // Callback function (required)
  publish: z.custom<(event: BaseEvent) => void>(
    (val) => typeof val === "function",
    {
      message: "publish must be a function",
    }
  ),

  emitStateSnapshots: z
    .enum(["initial", "final", "all", "none"])
    .default("initial"),
  emitActivities: z.boolean().default(false),

  // Session Override
  threadIdOverride: z.string().optional(),
  runIdOverride: z.string().optional(),

  // Error Handling
  errorDetailLevel: z
    .enum(["full", "message", "code", "none"])
    .default("message"),

  // Data Mappers (New in Protocol Compliance)
  stateMapper: z.custom<(state: unknown) => unknown>().optional(),
  activityMapper: z.custom<(node: unknown) => unknown>().optional(),

  // Validation (New - @ag-ui/core integration)
  /**
   * Enable runtime validation of events against @ag-ui/core schemas.
   * Disabled by default for performance. Enable in development for debugging.
   *
   * - false (default): No validation, events emitted as-is
   * - true: Validate events, log warnings for invalid events
   * - "strict": Validate events, throw on invalid events
   */
  validateEvents: z.union([z.boolean(), z.literal("strict")]).default(false),
});

/**
 * Inferred type for middleware options.
 */
export type AGUIMiddlewareOptions = z.infer<typeof AGUIMiddlewareOptionsSchema>;
