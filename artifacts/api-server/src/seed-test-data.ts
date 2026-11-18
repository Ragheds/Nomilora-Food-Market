import { createOperationsStore } from "./lib/operations-store";
import { db, pool } from "@workspace/db";
if (
  process.env.NOMILORA_SEED_TEST_DATA !== "yes" ||
  process.env.NODE_ENV === "production"
)
  throw new Error(
    "Explicit development-only seed approval is required. Set NOMILORA_SEED_TEST_DATA=yes.",
  );
try {
  const result = await createOperationsStore(db).seedTestData();
  console.log(
    "Fictional test kitchen, illustrative menu and one future test window are ready.",
    result,
  );
} finally {
  await pool.end();
}
