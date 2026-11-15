import { z } from "zod";
import { GetRecommendationsBody } from "./generated/api";

export const roleSchema = z.enum([
  "customer",
  "restaurant_employee",
  "restaurant_manager",
  "support_agent",
  "operations_admin",
  "founder_admin",
]);
export type Role = z.infer<typeof roleSchema>;
const shortText = z.string().trim().max(200);
export const preferencesSchema = GetRecommendationsBody.extend({
  preferredMealTypes: z
    .array(z.enum(["Breakfast", "Lunch", "Dinner", "Soup or light meal"]))
    .max(4)
    .default([]),
})
  .strict()
  .superRefine((value, ctx) => {
    for (const field of [
      "eatingStyles",
      "goals",
      "cuisines",
      "strictAllergens",
      "dislikes",
    ] as const) {
      if (
        value[field].length > 30 ||
        value[field].some((item) => item.length > 200)
      )
        ctx.addIssue({
          code: "custom",
          path: [field],
          message: "Too many or oversized preferences.",
        });
    }
  });
export const profileInput = z
  .object({ displayName: shortText, phoneNumber: z.string().trim().max(30) })
  .strict();
export const cartInput = z
  .object({
    items: z
      .array(
        z
          .object({
            mealId: z
              .string()
              .regex(/^[a-z0-9-]+$/)
              .max(100),
            quantity: z.number().int().min(1).max(20),
          })
          .strict(),
      )
      .max(50),
  })
  .strict()
  .refine(
    (value) =>
      new Set(value.items.map((item) => item.mealId)).size ===
      value.items.length,
    "Duplicate meals are not allowed.",
  );
export const addressInput = z
  .object({
    label: shortText.min(1),
    recipientName: shortText.min(1),
    phoneNumber: z.string().trim().max(30).default(""),
    street1: shortText.min(1),
    street2: shortText.default(""),
    city: shortText.min(1),
    region: z
      .string()
      .trim()
      .regex(/^[A-Z]{2}$/),
    postalCode: z.string().regex(/^\d{5}(-\d{4})?$/),
    countryCode: z.literal("US").default("US"),
    deliveryInstructions: z.string().trim().max(500).default(""),
    isDefault: z.boolean().default(false),
  })
  .strict();
export type Preferences = z.infer<typeof preferencesSchema>;
export type AddressInput = z.infer<typeof addressInput>;
export type Address = AddressInput & { id: string };
export type Account = {
  id: string;
  email: string | null;
  displayName: string;
  phoneNumber: string;
  roles: Role[];
  preferences: Preferences;
  favorites: string[];
  cart: Record<string, number>;
  addresses: Address[];
};
