CREATE TABLE "launch_leads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"postal_code" text NOT NULL,
	"message" text DEFAULT '' NOT NULL,
	"consent" boolean NOT NULL,
	"status" text DEFAULT 'received' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "partner_compensation" (
	"kitchen_id" uuid PRIMARY KEY NOT NULL,
	"per_meal_cents" integer NOT NULL,
	"reference" text NOT NULL,
	CONSTRAINT "compensation_amount_check" CHECK ("partner_compensation"."per_meal_cents" >= 0)
);
--> statement-breakpoint
CREATE TABLE "partner_payables" (
	"order_id" uuid PRIMARY KEY NOT NULL,
	"kitchen_id" uuid NOT NULL,
	"amount_cents" integer NOT NULL,
	"status" text DEFAULT 'recorded' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payable_amount_check" CHECK ("partner_payables"."amount_cents" >= 0)
);
--> statement-breakpoint
ALTER TABLE "app_users" ADD COLUMN "disabled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "partner_allocation_cents" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "partner_compensation" ADD CONSTRAINT "partner_compensation_kitchen_id_kitchens_id_fk" FOREIGN KEY ("kitchen_id") REFERENCES "public"."kitchens"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_payables" ADD CONSTRAINT "partner_payables_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_payables" ADD CONSTRAINT "partner_payables_kitchen_id_kitchens_id_fk" FOREIGN KEY ("kitchen_id") REFERENCES "public"."kitchens"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "leads_status_idx" ON "launch_leads" USING btree ("status");