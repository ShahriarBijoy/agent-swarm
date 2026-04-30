import {
  pgTable,
  uuid,
  text,
  integer,
  doublePrecision,
  numeric,
  timestamp,
  jsonb,
  index,
} from 'drizzle-orm/pg-core';
import {
  vehicleSegmentEnum,
  vehicleStatusEnum,
  tripStatusEnum,
  invoiceStatusEnum,
} from './enums';
import { tasks } from './tasks';
import { user } from './auth';

export const vehicles = pgTable(
  'vehicles',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    plate: text('plate').notNull().unique(),
    make: text('make').notNull(),
    model: text('model').notNull(),
    year: integer('year').notNull(),
    segment: vehicleSegmentEnum('segment').notNull(),
    seats: integer('seats').notNull(),
    rangeKm: integer('range_km').notNull(),
    odometerKm: integer('odometer_km').notNull().default(0),
    status: vehicleStatusEnum('status').notNull().default('available'),
    homeLat: doublePrecision('home_lat').notNull(),
    homeLng: doublePrecision('home_lng').notNull(),
    depot: text('depot').notNull(),
    imageSlug: text('image_slug').notNull(),
    dailyRateUsd: numeric('daily_rate_usd', { precision: 10, scale: 2 }).notNull(),
    perKmRateUsd: numeric('per_km_rate_usd', { precision: 10, scale: 4 }).notNull(),
    lastServicedAt: timestamp('last_serviced_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('vehicles_status_idx').on(t.status),
    index('vehicles_segment_idx').on(t.segment),
  ],
);

export const customers = pgTable(
  'customers',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    // Phase 11 — opportunistic link to a Better Auth user. Nullable: seeded
    // demo customers (ana.khan@…) have no operator account, and we only
    // stamp this column on the first scenario task from a signed-in user
    // (see app/api/tasks/route.ts).
    userId: uuid('user_id').references(() => user.id, {
      onDelete: 'set null',
    }),
    name: text('name').notNull(),
    email: text('email').notNull().unique(),
    phone: text('phone'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index('customers_user_id_idx').on(t.userId)],
);

export const trips = pgTable(
  'trips',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id),
    vehicleId: uuid('vehicle_id')
      .notNull()
      .references(() => vehicles.id),
    status: tripStatusEnum('status').notNull().default('requested'),
    pickupLat: doublePrecision('pickup_lat').notNull(),
    pickupLng: doublePrecision('pickup_lng').notNull(),
    dropoffLat: doublePrecision('dropoff_lat').notNull(),
    dropoffLng: doublePrecision('dropoff_lng').notNull(),
    scheduledStartAt: timestamp('scheduled_start_at', { withTimezone: true }).notNull(),
    scheduledEndAt: timestamp('scheduled_end_at', { withTimezone: true }).notNull(),
    actualStartAt: timestamp('actual_start_at', { withTimezone: true }),
    actualEndAt: timestamp('actual_end_at', { withTimezone: true }),
    distanceKm: numeric('distance_km', { precision: 10, scale: 2 }).notNull(),
    totalCostUsd: numeric('total_cost_usd', { precision: 10, scale: 2 }).notNull(),
    polyline: jsonb('polyline').$type<Array<[number, number]>>().notNull(),
    taskId: uuid('task_id').references(() => tasks.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('trips_status_idx').on(t.status),
    index('trips_vehicle_id_idx').on(t.vehicleId),
    index('trips_customer_id_idx').on(t.customerId),
  ],
);

export const invoices = pgTable(
  'invoices',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tripId: uuid('trip_id')
      .notNull()
      .references(() => trips.id),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id),
    amountUsd: numeric('amount_usd', { precision: 10, scale: 2 }).notNull(),
    taxUsd: numeric('tax_usd', { precision: 10, scale: 2 }).notNull(),
    totalUsd: numeric('total_usd', { precision: 10, scale: 2 }).notNull(),
    status: invoiceStatusEnum('status').notNull().default('draft'),
    dueAt: timestamp('due_at', { withTimezone: true }).notNull(),
    paidAt: timestamp('paid_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('invoices_status_idx').on(t.status),
    index('invoices_customer_id_idx').on(t.customerId),
  ],
);
