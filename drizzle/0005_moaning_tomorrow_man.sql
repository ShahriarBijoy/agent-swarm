CREATE TYPE "public"."invoice_status" AS ENUM('draft', 'pending', 'paid', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."trip_status" AS ENUM('requested', 'confirmed', 'in-route', 'completed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."vehicle_segment" AS ENUM('sedan', 'suv', 'van', 'truck');--> statement-breakpoint
CREATE TYPE "public"."vehicle_status" AS ENUM('available', 'in-use', 'maintenance');--> statement-breakpoint
CREATE TABLE "customers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"phone" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customers_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trip_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"amount_usd" numeric(10, 2) NOT NULL,
	"tax_usd" numeric(10, 2) NOT NULL,
	"total_usd" numeric(10, 2) NOT NULL,
	"status" "invoice_status" DEFAULT 'draft' NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"paid_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trips" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"status" "trip_status" DEFAULT 'requested' NOT NULL,
	"pickup_lat" double precision NOT NULL,
	"pickup_lng" double precision NOT NULL,
	"dropoff_lat" double precision NOT NULL,
	"dropoff_lng" double precision NOT NULL,
	"scheduled_start_at" timestamp with time zone NOT NULL,
	"scheduled_end_at" timestamp with time zone NOT NULL,
	"actual_start_at" timestamp with time zone,
	"actual_end_at" timestamp with time zone,
	"distance_km" numeric(10, 2) NOT NULL,
	"total_cost_usd" numeric(10, 2) NOT NULL,
	"polyline" jsonb NOT NULL,
	"task_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vehicles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plate" text NOT NULL,
	"make" text NOT NULL,
	"model" text NOT NULL,
	"year" integer NOT NULL,
	"segment" "vehicle_segment" NOT NULL,
	"seats" integer NOT NULL,
	"range_km" integer NOT NULL,
	"odometer_km" integer DEFAULT 0 NOT NULL,
	"status" "vehicle_status" DEFAULT 'available' NOT NULL,
	"home_lat" double precision NOT NULL,
	"home_lng" double precision NOT NULL,
	"depot" text NOT NULL,
	"image_slug" text NOT NULL,
	"daily_rate_usd" numeric(10, 2) NOT NULL,
	"per_km_rate_usd" numeric(10, 4) NOT NULL,
	"last_serviced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vehicles_plate_unique" UNIQUE("plate")
);
--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "invoices_status_idx" ON "invoices" USING btree ("status");--> statement-breakpoint
CREATE INDEX "invoices_customer_id_idx" ON "invoices" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "trips_status_idx" ON "trips" USING btree ("status");--> statement-breakpoint
CREATE INDEX "trips_vehicle_id_idx" ON "trips" USING btree ("vehicle_id");--> statement-breakpoint
CREATE INDEX "trips_customer_id_idx" ON "trips" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "vehicles_status_idx" ON "vehicles" USING btree ("status");--> statement-breakpoint
CREATE INDEX "vehicles_segment_idx" ON "vehicles" USING btree ("segment");