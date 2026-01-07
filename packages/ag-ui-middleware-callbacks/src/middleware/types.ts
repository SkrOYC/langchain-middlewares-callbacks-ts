/**
 * AG-UI Middleware Types and Configuration
 * 
 * Defines the middleware options schema and types for AG-UI protocol integration.
 */

import { z } from "zod";
import type { AGUITransport } from "../transports/types";

/**
 * Middleware options schema with Zod validation.
 */
export const AGUIMiddlewareOptionsSchema = z.object({
  // Transport (required)
  transport: z.custom<AGUITransport>(
    (val) => val && typeof (val as AGUITransport).emit === "function",
    {
      message: "Transport must have an emit function",
    }
  ),

  // Event control
  emitToolResults: z.boolean().default(true),
  emitStateSnapshots: z.enum(["initial", "final", "all", "none"]).default("initial"),
  emitActivities: z.boolean().default(false),

  // Smart Emission Policy
  maxUIPayloadSize: z.number().positive().default(50 * 1024), // 50KB
  chunkLargeResults: z.boolean().default(false),

  // Session Override
  threadIdOverride: z.string().optional(),
  runIdOverride: z.string().optional(),

  // Error Handling
  errorDetailLevel: z.enum(["full", "message", "code", "none"]).default("message"),

  // Data Mappers (New in Protocol Compliance)
  stateMapper: z.custom<(state: any) => any>().optional(),
  resultMapper: z.custom<(result: any) => any>().optional(),
  activityMapper: z.custom<(node: any) => any>().optional(),
  
  // Validation (New - @ag-ui/core integration)
  /**
   * Enable runtime validation of events against @ag-ui/core schemas.
   * Disabled by default for performance. Enable in development for debugging.
   * 
   * - false (default): No validation, events emitted as-is
   * - true: Validate events, log warnings for invalid events
   * - "strict": Validate events, throw on invalid events
   */
  validateEvents: z.union([
    z.boolean(),
    z.literal("strict"),
  ]).default(false),
});

/**
 * Inferred type for middleware options.
 */
export type AGUIMiddlewareOptions = z.infer<typeof AGUIMiddlewareOptionsSchema>;
