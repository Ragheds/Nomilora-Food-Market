import { randomUUID } from "node:crypto";
import { Router, type IRouter } from "express";
import {
  GetLaunchReadinessResponse,
  GetMealParams,
  GetMealResponse,
  GetRecommendationsBody,
  GetRecommendationsResponse,
  ListMealsResponse,
  SimulateDemoCheckoutBody,
  SimulateDemoCheckoutResponse,
} from "@workspace/api-zod";
import { nomiloraMeals as previewMeals } from "../lib/nomilora-catalog";

const allergenNotice =
  "This is an illustrative test menu. Verification flags reflect recorded test evidence and are not a food-safety guarantee. Unknown or conflicting allergen and cross-contact declarations are excluded; never rely on this preview for a food-safety decision.";

const strictDietaryRequirements: Record<string, string[]> = {
  Vegan: ["vegan"],
  Vegetarian: ["vegetarian", "vegan"],
  Pescatarian: ["pescatarian", "vegetarian", "vegan"],
  "Halal preference": ["halal"],
  "Kosher preference": ["kosher"],
  "Low Carb": ["low carb"],
  Keto: ["keto"],
  "Dairy avoidance": ["dairy free"],
  "Gluten avoidance": ["gluten free"],
};

const normalizeDietaryTag = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

function passesStrictDietaryRequirements(
  meal: (typeof previewMeals)[number],
  selectedStyles: string[],
) {
  const requirements = selectedStyles
    .map((style) => strictDietaryRequirements[style])
    .filter((requirement): requirement is string[] => !!requirement);

  if (requirements.length === 0) return true;
  if (meal.dietaryStatus !== "verified") return false;

  const tags = meal.dietaryTags.map(normalizeDietaryTag);
  return requirements.every((acceptedTags) =>
    acceptedTags.some((tag) => tags.includes(normalizeDietaryTag(tag))),
  );
}

export function createNomiloraRouter(
  resolveMeals: () => Promise<typeof previewMeals> = async () => previewMeals,
): IRouter {
  const router: IRouter = Router();
  router.get("/meals", async (_req, res) => {
    const nomiloraMeals = await resolveMeals();
    res.json(ListMealsResponse.parse(nomiloraMeals));
  });

  router.get("/meals/:mealId", async (req, res) => {
    const nomiloraMeals = await resolveMeals();
    const rawMealId = Array.isArray(req.params.mealId)
      ? req.params.mealId[0]
      : req.params.mealId;
    const parsedParams = GetMealParams.safeParse({ mealId: rawMealId });

    if (!parsedParams.success) {
      res.status(400).json({ error: "A valid meal ID is required." });
      return;
    }

    const meal = nomiloraMeals.find(
      (candidate) => candidate.id === parsedParams.data.mealId,
    );

    if (!meal) {
      res.status(404).json({ error: "Meal not found." });
      return;
    }

    res.json(GetMealResponse.parse(meal));
  });

  router.get("/launch-readiness", (_req, res) => {
    const readiness = GetLaunchReadinessResponse.parse({
      mode: "demo",
      plannedAreas: ["Astoria, Queens", "Long Island City, Queens"],
      activeDeliveryZones: [],
      deliveryEnabled: false,
      paymentsEnabled: false,
      weeklyPlanBillingEnabled: false,
      notice:
        "Astoria and Long Island City are planned pilot areas only. No delivery zones, delivery windows, payment collection, or subscriptions are active.",
    });

    res.json(readiness);
  });

  router.post("/recommendations", async (req, res) => {
    const nomiloraMeals = await resolveMeals();
    const parsed = GetRecommendationsBody.safeParse(req.body);

    if (!parsed.success) {
      req.log.warn(
        { issueCount: parsed.error.issues.length },
        "Invalid Nomilora recommendation request",
      );
      res.status(400).json({ error: "Please check your meal preferences." });
      return;
    }

    const preferences = parsed.data;

    const allergenEligible = preferences.strictAllergens.length
      ? nomiloraMeals.filter(
          (meal) =>
            meal.allergenStatus === "verified" &&
            meal.crossContactKnown === true &&
            !preferences.strictAllergens.some((allergen) =>
              [
                ...meal.allergens,
                ...(meal.crossContactAllergens ?? []),
              ].includes(allergen),
            ),
        )
      : nomiloraMeals;
    if (preferences.strictAllergens.length && !allergenEligible.length) {
      res.json(
        GetRecommendationsResponse.parse({
          recommendations: [],
          allergenNotice,
          preferenceSummary:
            "No meals have verified declarations compatible with your saved allergens.",
        }),
      );
      return;
    }

    const dislikeTerms = preferences.dislikes
      .map((term) => term.trim().toLowerCase())
      .filter(Boolean);

    const restrictedMeals = allergenEligible.filter(
      (meal) =>
        passesStrictDietaryRequirements(meal, preferences.eatingStyles) &&
        (!preferences.preferredMealTypes?.length ||
          preferences.preferredMealTypes.some((type) => {
            const normalized = meal.mealType.toLowerCase();
            return type === "Soup or light meal"
              ? /soup|light/.test(
                  `${normalized} ${meal.category} ${meal.name}`.toLowerCase(),
                )
              : normalized.includes(type.toLowerCase());
          })),
    );
    const recommendations = restrictedMeals
      .filter((meal) => {
        const searchableText = [
          meal.name,
          meal.description,
          ...meal.ingredients,
        ]
          .join(" ")
          .toLowerCase();

        return !dislikeTerms.some((term) => searchableText.includes(term));
      })
      .map((meal) => {
        const reasons: string[] = [];
        let score = meal.featured ? 12 : 0;
        const cuisineMatch = preferences.cuisines.some((cuisine) =>
          meal.cuisine.toLowerCase().includes(cuisine.toLowerCase()),
        );
        const goalsText =
          `${meal.category} ${meal.dietaryTags.join(" ")}`.toLowerCase();
        const goalTerms: Record<string, string[]> = {
          Convenience: ["everyday", "favorite", "family"],
          "Delicious everyday meals": ["everyday", "favorite", "comfort"],
          "Balanced meals": ["vegetable", "greens", "bowl", "balanced"],
          "More protein": ["protein"],
          "More vegetables": ["vegetable", "plant based", "soup", "greens"],
          "Discover new cuisines": ["global flavors"],
          "Family meals": ["family", "comfort"],
        };
        const matchedGoals = preferences.goals.filter((goal) =>
          (goalTerms[goal] ?? []).some((term) => goalsText.includes(term)),
        );
        const matchedStyle = preferences.eatingStyles.some((style) =>
          meal.dietaryTags.some((tag) =>
            tag.toLowerCase().includes(style.toLowerCase()),
          ),
        );

        if (cuisineMatch) {
          score += 40;
          reasons.push(`A cuisine you picked: ${meal.cuisine}`);
        }

        if (matchedGoals.length > 0) {
          score += Math.min(30, matchedGoals.length * 15);
          reasons.push("A fit for the goals you selected");
        }

        if (matchedStyle) {
          score += 20;
          reasons.push("Matches an illustrative menu label you selected");
        }

        if (reasons.length === 0) {
          reasons.push("A sample dish to help you explore");
        }

        return {
          mealId: meal.id,
          score: Math.min(score, 100),
          reasons,
        };
      })
      .sort(
        (left, right) =>
          right.score - left.score ||
          nomiloraMeals.findIndex((meal) => meal.id === left.mealId) -
            nomiloraMeals.findIndex((meal) => meal.id === right.mealId),
      )
      .slice(0, 8);

    const hasStrictDietaryPreference = preferences.eatingStyles.some(
      (style) => !!strictDietaryRequirements[style],
    );
    const preferenceSummary =
      hasStrictDietaryPreference && restrictedMeals.length === 0
        ? "No matches: the preview has no verified dietary labels for your strict preferences."
        : preferences.cuisines.length > 0
          ? `A starting menu inspired by ${preferences.cuisines.slice(0, 3).join(", ")}.`
          : "A starting menu picked from the tastes and goals you shared.";

    res.json(
      GetRecommendationsResponse.parse({
        recommendations,
        allergenNotice,
        preferenceSummary,
      }),
    );
  });

  router.post("/demo-checkouts", async (req, res) => {
    const nomiloraMeals = await resolveMeals();
    const parsed = SimulateDemoCheckoutBody.safeParse(req.body);

    if (!parsed.success) {
      req.log.warn(
        { issueCount: parsed.error.issues.length },
        "Invalid Nomilora demo checkout request",
      );
      res.status(400).json({
        error: "Add at least one sample meal and confirm demo-only checkout.",
      });
      return;
    }

    const lines = parsed.data.items.map((item) => {
      const meal = nomiloraMeals.find(
        (candidate) => candidate.id === item.mealId,
      );
      return meal
        ? {
            mealId: meal.id,
            name: meal.name,
            quantity: item.quantity,
            unitPriceCents: meal.priceCents,
            lineTotalCents: meal.priceCents * item.quantity,
          }
        : null;
    });

    if (lines.some((line) => line === null)) {
      res.status(400).json({
        error:
          "Your basket contains a sample meal that is no longer available.",
      });
      return;
    }

    const confirmedLines = lines.filter(
      (line): line is NonNullable<typeof line> => line !== null,
    );
    const itemCount = confirmedLines.reduce(
      (total, line) => total + line.quantity,
      0,
    );
    const subtotalCents = confirmedLines.reduce(
      (total, line) => total + line.lineTotalCents,
      0,
    );

    res.json(
      SimulateDemoCheckoutResponse.parse({
        demoId: `demo-${randomUUID()}`,
        createdAt: new Date().toISOString(),
        status: "simulated",
        paymentStatus: "not_charged",
        itemCount,
        subtotalCents,
        items: confirmedLines,
        message:
          "Demo simulation only. No real order was placed and no payment was collected.",
      }),
    );
  });

  return router;
}
export default createNomiloraRouter();
