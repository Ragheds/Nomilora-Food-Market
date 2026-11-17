import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parse, stringify } from "yaml";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import * as c from "@workspace/api-zod/operations";
const file = fileURLToPath(new URL("./openapi.yaml", import.meta.url));
const spec = parse(readFileSync(file, "utf8"));
spec.info.description =
  "Nomilora development API. All commerce and delivery operations are test-only. Live operations are disabled.";
const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const schemas: Record<string, z.ZodTypeAny> = {
  MarketCheckoutInput: c.checkoutInput,
  SubscriptionBoxInput: c.subscriptionBoxInput,
  OrderTransitionInput: c.transitionInput,
  SupportTicketInput: c.ticketInput,
  SupportMessageInput: c.messageInput,
  SupportTicketUpdate: c.ticketUpdateInput,
  PartnerInput: c.partnerInput,
  PartnerReview: c.partnerReviewInput,
  KitchenInput: c.kitchenInput,
  KitchenMemberInput: c.memberInput,
  MenuDraftInput: c.mealInput,
  MenuUpdateInput: c.mealUpdateInput,
  MenuReviewInput: c.mealReviewInput,
  TestZoneInput: c.zoneInput,
  TestSlotInput: c.slotInput,
  TestSlotUpdate: c.slotUpdateInput,
  TestPromotionInput: c.promoInput,
  TestSubscriptionInput: c.subscriptionInput,
  SubscriptionAction: c.subscriptionActionInput,
  CustomerAccessUpdate: c.accountAdminInput,
  RoleGrantInput: c.roleGrantInput,
  PartnerCompensationInput: c.compensationInput,
  LaunchInquiryInput: c.leadInput,
  LaunchInquiryUpdate: c.leadUpdateInput,
  TestOrder: c.orderViewSchema,
  SupportTicket: c.ticketViewSchema,
  TestCatalogMeal: c.catalogViewSchema,
  TestDeliverySlot: c.slotViewSchema,
  TestSubscription: c.subscriptionViewSchema,
  AccountNotification: c.notificationViewSchema,
  AdminCustomer: c.customerAdminViewSchema,
  TestPayable: c.payableViewSchema,
  LaunchInquiry: c.leadViewSchema,
  RestaurantProspect: c.partnerViewSchema,
  PartnerKitchen: c.kitchenViewSchema,
  StaffPortal: c.portalViewSchema,
};
for (const [name, schema] of Object.entries(schemas)) {
  const result = zodToJsonSchema(schema, {
    $refStrategy: "none",
    target: "openApi3",
  });
  delete (result as any).$schema;
  spec.components.schemas[name] = result;
}
spec.components.schemas.Meal.properties.allergenStatus.enum = [
  "unverified",
  "verified",
];
spec.components.schemas.Meal.properties.crossContactAllergens = {
  type: "array",
  items: { type: "string" },
};
spec.components.schemas.Meal.properties.crossContactKnown = { type: "boolean" };
spec.components.schemas.Meal.properties.crossContact = { type: "string" };
const result = (name: string, array = false) =>
  array ? { type: "array", items: ref(name) } : ref(name);
const object = { type: "object", additionalProperties: true };
type Entry = [string, string, string, string?, object?, number?];
const entries: Entry[] = [
  ['/market/plan-boxes','get','getWeeklyBoxWorkspace',undefined,object],
  ['/market/plan-boxes','post','saveWeeklyTestBox','SubscriptionBoxInput',object],
  ['/market/billing-attention','get','getBillingExceptions',undefined,{type:'array',items:object}],
  ['/market/billing-attention/{invoice}/retry','post','retryVerifiedFulfillment',undefined,object],
  [
    "/market/config",
    "get",
    "getMarketConfiguration",
    undefined,
    {
      type: "object",
      properties: {
        mode: { type: "string" },
        livePayments: { type: "boolean", enum: [false] },
        realDelivery: { type: "boolean", enum: [false] },
        stripeTestConfigured: { type: "boolean" },
      },
    },
  ],
  [
    "/market/catalog",
    "get",
    "getTestCatalog",
    undefined,
    result("TestCatalogMeal", true),
  ],
  [
    "/market/slots",
    "get",
    "getTestSlots",
    undefined,
    result("TestDeliverySlot", true),
  ],
  [
    "/market/orders",
    "get",
    "getSavedTestOrders",
    undefined,
    result("TestOrder", true),
  ],
  [
    "/market/orders",
    "post",
    "createSavedTestOrder",
    "MarketCheckoutInput",
    object,
  ],
  [
    "/market/orders/{id}",
    "get",
    "getSavedTestOrder",
    undefined,
    result("TestOrder"),
  ],
  ["/market/orders/{id}/pay", "post", "resumeTestPayment", undefined, object],
  [
    "/market/orders/{id}/transition",
    "post",
    "transitionTestOrder",
    "OrderTransitionInput",
  ],
  ["/market/orders/{id}/refund", "post", "refundTestOrder", undefined, object],
  [
    "/market/tickets",
    "get",
    "getSupportTickets",
    undefined,
    result("SupportTicket", true),
  ],
  [
    "/market/tickets",
    "post",
    "createSupportTicket",
    "SupportTicketInput",
    object,
  ],
  [
    "/market/tickets/{id}",
    "get",
    "getSupportTicket",
    undefined,
    result("SupportTicket"),
  ],
  ["/market/tickets/{id}", "put", "updateSupportTicket", "SupportTicketUpdate"],
  [
    "/market/tickets/{id}/messages",
    "post",
    "sendSupportMessage",
    "SupportMessageInput",
  ],
  [
    "/market/notifications",
    "get",
    "getAccountNotifications",
    undefined,
    result("AccountNotification", true),
  ],
  ["/market/notifications/{id}/read", "put", "markNotificationRead"],
  ["/market/portal", "get", "getStaffPortal", undefined, result("StaffPortal")],
  [
    "/market/partners",
    "post",
    "createRestaurantProspect",
    "PartnerInput",
    result("RestaurantProspect"),
  ],
  ["/market/partners/{id}", "put", "reviewRestaurantProspect", "PartnerReview"],
  [
    "/market/kitchens",
    "post",
    "createPartnerKitchen",
    "KitchenInput",
    result("PartnerKitchen"),
  ],
  [
    "/market/kitchen-members",
    "put",
    "assignKitchenMember",
    "KitchenMemberInput",
  ],
  [
    "/market/kitchen-members",
    "delete",
    "removeKitchenMember",
    "KitchenMemberInput",
  ],
  ["/market/menus", "post", "createPrivateMenu", "MenuDraftInput", object],
  [
    "/market/menus/{mealId}",
    "put",
    "updatePrivateMenu",
    "MenuUpdateInput",
    object,
  ],
  ["/market/menus/{mealId}/submit", "post", "submitPrivateMenu"],
  [
    "/market/menus/{mealId}/review",
    "post",
    "reviewPrivateMenu",
    "MenuReviewInput",
  ],
  ["/market/zones", "post", "createTestZone", "TestZoneInput", object],
  ["/market/slots", "post", "createTestSlot", "TestSlotInput", object],
  ["/market/slots/{id}", "put", "updateTestSlot", "TestSlotUpdate"],
  ["/market/promotions", "put", "saveTestPromotion", "TestPromotionInput"],
  [
    "/market/customers",
    "get",
    "getAdminCustomers",
    undefined,
    result("AdminCustomer", true),
  ],
  [
    "/market/customers/{id}",
    "put",
    "updateCustomerAccess",
    "CustomerAccessUpdate",
  ],
  [
    "/market/customers/{id}/role",
    "put",
    "changeApplicationRole",
    "RoleGrantInput",
  ],
  [
    "/market/compensation",
    "put",
    "saveTestCompensation",
    "PartnerCompensationInput",
  ],
  [
    "/market/payables",
    "get",
    "getTestPayables",
    undefined,
    result("TestPayable", true),
  ],
  ["/market/payables/{id}/settle-test", "post", "recordTestSettlement"],
  [
    "/market/leads",
    "get",
    "getLaunchInquiries",
    undefined,
    result("LaunchInquiry", true),
  ],
  ["/market/leads/{id}", "put", "updateLaunchInquiry", "LaunchInquiryUpdate"],
  [
    "/market/subscriptions",
    "get",
    "getTestSubscriptions",
    undefined,
    result("TestSubscription", true),
  ],
  [
    "/market/subscriptions",
    "post",
    "createTestSubscription",
    "TestSubscriptionInput",
    object,
  ],
  [
    "/market/subscriptions/{id}/pay",
    "post",
    "resumeTestSubscriptionCheckout",
    undefined,
    object,
  ],
  [
    "/market/subscriptions/{id}/action",
    "post",
    "changeTestSubscription",
    "SubscriptionAction",
  ],
  [
    "/launch-inquiries",
    "post",
    "submitLaunchInquiry",
    "LaunchInquiryInput",
    object,
    201,
  ],
];
for (const [path, method, operationId, input, output, status] of entries) {
  const parameters = Array.from(path.matchAll(/\{([^}]+)\}/g)).map((match) => ({
    in: "path",
    name: match[1],
    required: true,
    schema: {
      type: "string",
      ...(match[1] === "id" ? { format: "uuid" } : {}),
    },
  }));
  const responses: Record<string, unknown> = {};
  for (const code of [400, 401, 403, 404, 409, 429, 500, 503])
    responses[code] = {
      description: "Request could not be completed",
      content: { "application/json": { schema: ref("ErrorResponse") } },
    };
  responses[String(status ?? (output ? 200 : 204))] = {
    description: output ? "Success" : "Saved",
    ...(output ? { content: { "application/json": { schema: output } } } : {}),
  };
  spec.paths[path] ??= {};
  spec.paths[path][method] = {
    operationId,
    summary: operationId.replace(/([A-Z])/g, " $1"),
    tags: [path === "/launch-inquiries" ? "Inquiries" : "Test operations"],
    security: path === "/launch-inquiries" ? [] : [{ bearerAuth: [] }],
    ...(parameters.length ? { parameters } : {}),
    ...(input
      ? {
          requestBody: {
            required: true,
            content: { "application/json": { schema: ref(input) } },
          },
        }
      : {}),
    responses,
  };
}
spec.components.schemas.StripeTestWebhookEnvelope = object;
spec.paths["/payments/webhook"] = {
  post: {
    operationId: "receiveStripeTestWebhook",
    security: [],
    parameters: [
      {
        in: "header",
        name: "stripe-signature",
        required: true,
        schema: { type: "string" },
      },
    ],
    requestBody: {
      required: true,
      content: {
        "application/json": { schema: ref("StripeTestWebhookEnvelope") },
      },
    },
    responses: {
      200: { description: "Verified test event received" },
      400: { description: "Invalid signature or live event rejected" },
      503: { description: "Test webhook not configured" },
    },
  },
};
writeFileSync(file, stringify(spec, { lineWidth: 110 }));
