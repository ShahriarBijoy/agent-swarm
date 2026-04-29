import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import {
  queryVehicles,
  checkVehicleHealth,
  getTripStatus,
  queryCustomerHistory,
  proposeRental,
  chargeInvoice,
  computeRoute,
  quoteRental,
} from '@/db/queries/domain';
import { vehicleSegmentEnum, vehicleStatusEnum } from '@/db/schema/enums';
import { db } from '@/db/client';
import { vehicles } from '@/db/schema/domain';
import { eq } from 'drizzle-orm';

export const DOMAIN_SERVER_NAME = 'auto-ride-domain' as const;

export const QUERY_VEHICLES_FQN = `mcp__${DOMAIN_SERVER_NAME}__query_vehicles` as const;
export const COMPUTE_ROUTE_FQN = `mcp__${DOMAIN_SERVER_NAME}__compute_route` as const;
export const QUOTE_RENTAL_FQN = `mcp__${DOMAIN_SERVER_NAME}__quote_rental` as const;
export const CHECK_VEHICLE_HEALTH_FQN = `mcp__${DOMAIN_SERVER_NAME}__check_vehicle_health` as const;
export const GET_TRIP_STATUS_FQN = `mcp__${DOMAIN_SERVER_NAME}__get_trip_status` as const;
export const QUERY_CUSTOMER_HISTORY_FQN = `mcp__${DOMAIN_SERVER_NAME}__query_customer_history` as const;
export const PROPOSE_RENTAL_FQN = `mcp__${DOMAIN_SERVER_NAME}__propose_rental` as const;
export const CHARGE_INVOICE_FQN = `mcp__${DOMAIN_SERVER_NAME}__charge_invoice` as const;

export const READ_DOMAIN_TOOL_FQNS = [
  QUERY_VEHICLES_FQN,
  COMPUTE_ROUTE_FQN,
  QUOTE_RENTAL_FQN,
  CHECK_VEHICLE_HEALTH_FQN,
  GET_TRIP_STATUS_FQN,
  QUERY_CUSTOMER_HISTORY_FQN,
] as const;

export const WRITE_DOMAIN_TOOL_FQNS = [
  PROPOSE_RENTAL_FQN,
  CHARGE_INVOICE_FQN,
] as const;

const segmentSchema = z.enum(vehicleSegmentEnum.enumValues);
const statusSchema = z.enum(vehicleStatusEnum.enumValues);

export const queryVehiclesTool = tool(
  'query_vehicles',
  'Find vehicles in the fleet matching filters. Read-only.',
  {
    status: statusSchema.optional(),
    segment: segmentSchema.optional(),
    seats_min: z.number().int().min(1).max(20).optional(),
    range_min_km: z.number().int().min(1).max(2000).optional(),
  },
  async (args) => {
    const rows = await queryVehicles(args);
    return { content: [{ type: 'text', text: JSON.stringify(rows, null, 2) }] };
  },
  { annotations: { readOnlyHint: true } },
);

export const computeRouteTool = tool(
  'compute_route',
  'Estimate distance + ETA + polyline between two coordinates. Read-only.',
  {
    pickup: z.object({ lat: z.number(), lng: z.number() }),
    dropoff: z.object({ lat: z.number(), lng: z.number() }),
  },
  async (args) => {
    const result = computeRoute(args);
    return { content: [{ type: 'text', text: JSON.stringify(result) }] };
  },
  { annotations: { readOnlyHint: true } },
);

export const quoteRentalTool = tool(
  'quote_rental',
  'Compute the rental quote for a vehicle over a distance and duration. Read-only.',
  {
    vehicle_id: z.string().uuid(),
    distance_km: z.number().positive(),
    days: z.number().int().min(1).max(60),
  },
  async (args) => {
    const [vehicle] = await db.select().from(vehicles).where(eq(vehicles.id, args.vehicle_id));
    if (!vehicle) {
      return {
        isError: true,
        content: [{ type: 'text', text: `unknown vehicle ${args.vehicle_id}` }],
      };
    }
    const quote = quoteRental({ vehicle, distance_km: args.distance_km, days: args.days });
    return { content: [{ type: 'text', text: JSON.stringify(quote) }] };
  },
  { annotations: { readOnlyHint: true } },
);

export const checkVehicleHealthTool = tool(
  'check_vehicle_health',
  'Return the maintenance flags for a vehicle. Read-only.',
  { vehicle_id: z.string().uuid() },
  async (args) => {
    const result = await checkVehicleHealth(args.vehicle_id);
    return { content: [{ type: 'text', text: JSON.stringify(result) }] };
  },
  { annotations: { readOnlyHint: true } },
);

export const getTripStatusTool = tool(
  'get_trip_status',
  'Return the current state of a trip by id or by customer email (most recent active).',
  {
    trip_id: z.string().uuid().optional(),
    customer_email: z.string().email().optional(),
  },
  async (args) => {
    const result = await getTripStatus(args);
    return { content: [{ type: 'text', text: JSON.stringify(result) }] };
  },
  { annotations: { readOnlyHint: true } },
);

export const queryCustomerHistoryTool = tool(
  'query_customer_history',
  'Return a customer + their past trips + total spend. Read-only.',
  {
    email: z.string().email().optional(),
    customer_id: z.string().uuid().optional(),
  },
  async (args) => {
    const result = await queryCustomerHistory(args);
    return { content: [{ type: 'text', text: JSON.stringify(result) }] };
  },
  { annotations: { readOnlyHint: true } },
);

export const proposeRentalTool = tool(
  'propose_rental',
  'Book a vehicle: create a confirmed trip + draft invoice. Always HITL-gated by the rental-confirm gate.',
  {
    customer_id: z.string().uuid(),
    vehicle_id: z.string().uuid(),
    pickup: z.object({ lat: z.number(), lng: z.number() }),
    dropoff: z.object({ lat: z.number(), lng: z.number() }),
    scheduled_start_at: z.string().datetime(),
    scheduled_end_at: z.string().datetime(),
    distance_km: z.number().positive(),
    total_usd: z.number().positive(),
    tax_usd: z.number().min(0),
    polyline: z.array(z.tuple([z.number(), z.number()])),
    task_id: z.string().uuid().optional(),
  },
  async (args) => {
    const result = await proposeRental({
      ...args,
      scheduled_start_at: new Date(args.scheduled_start_at),
      scheduled_end_at: new Date(args.scheduled_end_at),
    });
    return { content: [{ type: 'text', text: JSON.stringify(result) }] };
  },
  { annotations: { readOnlyHint: false } },
);

export const chargeInvoiceTool = tool(
  'charge_invoice',
  'Mark an invoice paid. Always HITL-gated by the payment-charge gate.',
  { invoice_id: z.string().uuid() },
  async (args) => {
    const result = await chargeInvoice({ invoice_id: args.invoice_id });
    return { content: [{ type: 'text', text: JSON.stringify(result) }] };
  },
  { annotations: { readOnlyHint: false } },
);

/** Exported for testability — the SDK server object does not expose a `.tools` array directly. */
export const DOMAIN_TOOLS = [
  queryVehiclesTool,
  computeRouteTool,
  quoteRentalTool,
  checkVehicleHealthTool,
  getTripStatusTool,
  queryCustomerHistoryTool,
  proposeRentalTool,
  chargeInvoiceTool,
] as const;

export const domainMcpServer = createSdkMcpServer({
  name: DOMAIN_SERVER_NAME,
  version: '1.0.0',
  tools: [...DOMAIN_TOOLS],
});
