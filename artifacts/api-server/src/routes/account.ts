import { Router, type RequestHandler, type Response } from "express";
import { z } from "zod";
import {
  addressInput,
  cartInput,
  preferencesSchema,
  profileInput,
} from "@workspace/api-zod/account";
import { authenticate, requireRoles, type VerifyToken } from "../lib/auth";
import { createAccountStore, type AccountStore } from "../lib/account-store";
import { nomiloraMeals } from "../lib/nomilora-catalog";

const getStore = async () => {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_NOT_CONFIGURED");
  return createAccountStore((await import("@workspace/db")).db);
};
export function createAccountRouter(
  options: {
    verify?: VerifyToken;
    store?: () => Promise<AccountStore>;
    catalogIds?: () => Promise<string[]>;
  } = {},
) {
  const router = Router();
  const availableIds = async () => {
    if (options.catalogIds) return options.catalogIds();
    return nomiloraMeals.map((meal) => meal.id);
  };
  router.use(authenticate(options.verify));
  router.use(async (_req, res, next) => {
    try {
      const store = await (options.store ?? getStore)();
      const user = await store.identify(res.locals.identity);
      res.locals.store = store;
      res.locals.userId = user.id;
      res.locals.roles = user.roles;
      next();
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === "DATABASE_NOT_CONFIGURED"
      ) {
        res
          .status(503)
          .json({ error: "Account storage is not configured yet." });
        return;
      }
      next(error);
    }
  });
  const save =
    <T extends z.ZodTypeAny>(
      schema: T,
      handler: (
        store: AccountStore,
        userId: string,
        data: z.output<T>,
        res: Response,
      ) => Promise<void>,
    ): RequestHandler =>
    async (req, res) => {
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: "Please check the submitted fields." });
        return;
      }
      await handler(res.locals.store, res.locals.userId, parsed.data, res);
      if (!res.headersSent) res.status(204).end();
    };
  router.get("/", async (_req, res) =>
    res.json(await (res.locals.store as AccountStore).read(res.locals.userId)),
  );
  router.put(
    "/profile",
    save(profileInput, (store, id, data) => store.profile(id, data)),
  );
  router.put(
    "/preferences",
    save(preferencesSchema, (store, id, data) => store.preferences(id, data)),
  );
  router.put(
    "/cart",
    save(cartInput, async (store, id, data, res) => {
      const ids = await availableIds();
      if (
        data.items.some(
          (item: { mealId: string }) => !ids.includes(item.mealId),
        )
      ) {
        res
          .status(400)
          .json({ error: "Your basket contains an unavailable meal." });
        return;
      }
      await store.cart(id, data.items);
    }),
  );
  for (const method of ["put", "delete"] as const)
    router[method]("/favorites/:mealId", async (req, res) => {
      const mealId = String(req.params.mealId);
      if (method === "put" && !(await availableIds()).includes(mealId)) {
        res.status(404).json({ error: "Meal not found." });
        return;
      }
      await (res.locals.store as AccountStore).favorite(
        res.locals.userId,
        mealId,
        method === "put",
      );
      res.status(204).end();
    });
  const addressHandler: RequestHandler = async (req, res) => {
    const id = req.params.addressId;
    if (id && !z.string().uuid().safeParse(id).success) {
      res.status(400).json({ error: "Invalid address." });
      return;
    }
    const parsed = addressInput.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Please check your address fields." });
      return;
    }
    try {
      const result = await (res.locals.store as AccountStore).address(
        res.locals.userId,
        parsed.data,
        id ? String(id) : undefined,
      );
      if (!result) {
        res.status(404).json({ error: "Address not found." });
        return;
      }
      res.status(id ? 200 : 201).json({ id: result });
    } catch (error) {
      if (error instanceof Error && error.message === "ADDRESS_LIMIT") {
        res.status(409).json({ error: "You can save up to 20 addresses." });
        return;
      }
      throw error;
    }
  };
  router.post("/addresses", addressHandler);
  router.put("/addresses/:addressId", addressHandler);
  router.delete("/addresses/:addressId", async (req, res) => {
    if (!z.string().uuid().safeParse(req.params.addressId).success) {
      res.status(400).json({ error: "Invalid address." });
      return;
    }
    const deleted = await (res.locals.store as AccountStore).deleteAddress(
      res.locals.userId,
      String(req.params.addressId),
    );
    res
      .status(deleted ? 204 : 404)
      .json(deleted ? undefined : { error: "Address not found." });
  });
  // Permission gates for later portals, not placeholder operational dashboards.
  router.get(
    "/access/admin",
    requireRoles("operations_admin", "founder_admin"),
    (_req, res) => res.json({ allowed: true }),
  );
  router.get(
    "/access/support",
    requireRoles("support_agent", "operations_admin", "founder_admin"),
    (_req, res) => res.json({ allowed: true }),
  );
  router.get(
    "/access/partner",
    requireRoles("restaurant_employee", "restaurant_manager"),
    (_req, res) => res.json({ allowed: true }),
  );
  return router;
}
