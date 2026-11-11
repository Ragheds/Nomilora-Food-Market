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
import { nomiloraMeals } from "../lib/nomilora-catalog";

const router: IRouter = Router();

const allergenNotice =
  "All meal ingredients and allergen declarations are unverified demo data. No meal is represented as allergen-safe. No partner kitchen or contact channel is configured yet; never rely on this preview for a food-safety decision.";

router.get("/meals", (_req, res) => {
  res.json(ListMealsResponse.parse(nomiloraMeals));
});

router.get("/meals/:mealId", (req, res) => {
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

router.post("/recommendations", (req, res) => {
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

  if (preferences.strictAllergens.length > 0) {
    res.json(
      GetRecommendationsResponse.parse({
        recommendations: [],
        allergenNotice,
        preferenceSummary:
          "Allergy-safe recommendations are unavailable because the demo menu has not been verified.",
      }),
    );
    return;
  }

  const dislikeTerms = preferences.dislikes
    .map((term) => term.trim().toLowerCase())
    .filter(Boolean);

  const recommendations = nomiloraMeals
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
      const goalsText = `${meal.category} ${meal.dietaryTags.join(" ")}`.toLowerCase();
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

  const preferenceSummary =
    preferences.cuisines.length > 0
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

router.post("/demo-checkouts", (req, res) => {
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
    const meal = nomiloraMeals.find((candidate) => candidate.id === item.mealId);
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
      error: "Your basket contains a sample meal that is no longer available.",
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

export default router;
