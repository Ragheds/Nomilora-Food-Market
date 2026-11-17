import { nomiloraMeals } from "./nomilora-catalog";
import {
  createOperationsStore,
  type OperationsStore,
  DomainError,
} from "./operations-store";
export async function resolvePublicMeals(
  getter?: () => Promise<OperationsStore>,
): Promise<typeof nomiloraMeals> {
  if (!getter && !process.env.DATABASE_URL) return nomiloraMeals;
  try {
    const store = getter
      ? await getter()
      : createOperationsStore((await import("@workspace/db")).db);
    const catalog = await store.catalog();
    if (!catalog.length && !(await store.hasCatalog())) return nomiloraMeals;
    return catalog.map((meal) => {
      const original = nomiloraMeals.find((row) => row.id === meal.id);
      return {
        id: meal.id,
        name: meal.name,
        description: meal.description,
        priceCents: meal.priceCents,
        photoUrl: original?.photoUrl ?? "",
        cuisine: original?.cuisine ?? "Test menu",
        mealType: original?.mealType ?? "Lunch or dinner",
        category: original?.category ?? "Test menu",
        dietaryTags: meal.dietaryTags,
        ingredients: meal.ingredients,
        allergens: meal.allergens,
        crossContactAllergens: meal.crossContactAllergens,
        crossContact: meal.crossContact,
        crossContactKnown:
          !/unknown/i.test(meal.crossContact) && !!meal.crossContact.trim(),
        dietaryStatus: meal.dietaryVerified
          ? ("verified" as const)
          : ("unverified" as const),
        allergenStatus: meal.allergenVerified
          ? ("verified" as const)
          : ("unverified" as const),
        nutritionStatus: "unverified" as const,
        portion: original?.portion ?? "Not verified",
        storage: original?.storage ?? "Storage instructions not verified",
        reheating: original?.reheating ?? "Reheating instructions not verified",
        featured: original?.featured ?? false,
        demoOnly: true,
      };
    });
  } catch (error) {
    const code =
      (error as { cause?: { code?: string }; code?: string }).cause?.code ??
      (error as { code?: string }).code;
    if (code === "42P01") return nomiloraMeals;
    throw new DomainError(
      503,
      "The menu is temporarily unavailable. Please try again.",
    );
  }
}
