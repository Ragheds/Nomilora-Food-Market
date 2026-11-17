CREATE TABLE "subscription_boxes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subscription_id" uuid NOT NULL,
	"period_start" timestamp with time zone NOT NULL,
	"period_end" timestamp with time zone NOT NULL,
	"address_id" uuid NOT NULL,
	"slot_id" uuid NOT NULL,
	"items" jsonb NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"order_id" uuid,
	"note" text DEFAULT '' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subscription_invoices" (
	"id" text PRIMARY KEY NOT NULL,
	"subscription_id" uuid NOT NULL,
	"amount_cents" integer NOT NULL,
	"period_start" timestamp with time zone NOT NULL,
	"period_end" timestamp with time zone NOT NULL,
	"payment_intent_id" text,
	"status" text DEFAULT 'paid' NOT NULL,
	"order_id" uuid,
	"note" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subscription_invoice_amount_check" CHECK ("subscription_invoices"."amount_cents" > 0 AND "subscription_invoices"."period_start" < "subscription_invoices"."period_end")
);
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "stripe_invoice_id" text;--> statement-breakpoint
ALTER TABLE "subscription_boxes" ADD CONSTRAINT "subscription_boxes_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_boxes" ADD CONSTRAINT "subscription_boxes_slot_id_delivery_slots_id_fk" FOREIGN KEY ("slot_id") REFERENCES "public"."delivery_slots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_boxes" ADD CONSTRAINT "subscription_boxes_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_invoices" ADD CONSTRAINT "subscription_invoices_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_invoices" ADD CONSTRAINT "subscription_invoices_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "subscription_box_period_unique" ON "subscription_boxes" USING btree ("subscription_id","period_start");--> statement-breakpoint
CREATE UNIQUE INDEX "order_stripe_invoice_unique" ON "orders" USING btree ("stripe_invoice_id");