import { spawnSync } from "node:child_process";
import { readFile, mkdtemp, chmod, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { eq, sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import * as t from "@workspace/db/schema";
import { createAccountStore } from "../src/lib/account-store";
import { createOperationsStore } from "../src/lib/operations-store";

// Opt-in only: refuses hosted databases and existing application schemas.
test(
  "PostgreSQL driver serializes checkouts and restores their full backup into a fresh database",
  { skip: !process.env.TEST_DATABASE_URL, timeout: 60000 },
  async () => {
    const url = new URL(process.env.TEST_DATABASE_URL!);
    assert.ok(
      ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname),
      "Tests require a loopback PostgreSQL service",
    );
    assert.equal(url.pathname, "/nomilora_test");
    process.env.DATABASE_URL = url.toString();
    const { db, pool } = await import("@workspace/db");
    try {
      const existing = await db.execute(
        sql`select tablename from pg_tables where schemaname='public'`,
      );
      assert.equal(
        existing.rows.length,
        0,
        "Refusing to mutate a nonempty test database",
      );
      const migrationsFolder = fileURLToPath(
        new URL("../../../lib/db/migrations", import.meta.url),
      );
      // Reproduce the original Replit schema with no journal, then test guarded adoption.
      await db.execute(
        sql.raw(
          await readFile(
            path.join(migrationsFolder, "0000_tidy_edwin_jarvis.sql"),
            "utf8",
          ),
        ),
      );
      const inspector = fileURLToPath(
        new URL("../src/inspect-database.ts", import.meta.url),
      );
      const runInspect = (
        args: string[] = [],
        extra: Record<string, string> = {},
      ) =>
        spawnSync(process.execPath, ["--import", "tsx", inspector, ...args], {
          encoding: "utf8",
          env: { ...process.env, ...extra },
          timeout: 15000,
        });
      const preflight = runInspect();
      assert.equal(preflight.status, 0, preflight.stderr);
      const report = JSON.parse(preflight.stdout);
      assert.equal(report.exactSchemaMatch, true);
      assert.equal(report.migrationJournalPresent, false);
      const directory = await mkdtemp(
        path.join(tmpdir(), "nomilora-baseline-"),
      );
      try {
        const backup = path.join(directory, "before.dump");
        const dump = spawnSync(
          "pg_dump",
          ["--format=custom", "--file", backup],
          {
            encoding: "utf8",
            env: {
              ...process.env,
              PGHOST: url.hostname,
              PGPORT: url.port || "5432",
              PGUSER: decodeURIComponent(url.username),
              PGPASSWORD: decodeURIComponent(url.password),
              PGDATABASE: decodeURIComponent(url.pathname.slice(1)),
            },
            timeout: 10000,
          },
        );
        assert.equal(dump.status, 0, dump.stderr);
        await chmod(backup, 0o600);
        const vars = {
          CONFIRM_EMPTY_BASELINE: "yes",
          NOMILORA_DATABASE_BACKUP: backup,
          NOMILORA_REVIEWED_BASELINE_FINGERPRINT: "wrong",
        };
        assert.notEqual(runInspect(["--adopt-empty-baseline"], vars).status, 0);
        const adopted = runInspect(["--adopt-empty-baseline"], {
          ...vars,
          NOMILORA_REVIEWED_BASELINE_FINGERPRINT: report.actualFingerprint,
        });
        assert.equal(adopted.status, 0, adopted.stderr);
        assert.match(adopted.stdout, /baseline 0000 adopted/);
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
      await migrate(db, { migrationsFolder });
      await migrate(db, { migrationsFolder });
      const accounts = createAccountStore(db),
        operations = createOperationsStore(db);
      const fixture = await operations.seedTestData();
      const customers = await Promise.all(
        ["race-one", "race-two"].map(async (subject) => {
          const identity = await accounts.identify({
            subject,
            email: `${subject}@example.test`,
          });
          const addressId = await accounts.address(identity.id, {
            label: "Test",
            recipientName: "Fixture",
            street1: "1 Test Street",
            street2: "",
            city: "Queens",
            region: "NY",
            postalCode: "11101",
            countryCode: "US",
            phoneNumber: "",
            deliveryInstructions: "",
            isDefault: true,
          });
          await accounts.cart(identity.id, [
            { mealId: "lemon-chicken-rice", quantity: 1 },
          ]);
          return {
            actor: { id: identity.id, roles: ["customer"] as ["customer"] },
            input: {
              addressId: addressId!,
              slotId: fixture.slotId,
              mode: "simulation" as const,
              requestKey: randomUUID(),
              acknowledgedTestOnly: true as const,
            },
          };
        }),
      );
      await db
        .update(t.catalogMeals)
        .set({ stock: 1 })
        .where(eq(t.catalogMeals.id, "lemon-chicken-rice"));
      await db
        .update(t.deliverySlots)
        .set({ capacity: 1 })
        .where(eq(t.deliverySlots.id, fixture.slotId));
      const results = await Promise.allSettled(
        customers.map((c) => operations.checkout(c.actor, c.input)),
      );
      assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
      const winner = results.findIndex((r) => r.status === "fulfilled");
      const first = results[winner];
      assert.equal(first.status, "fulfilled");
      if (first.status === "fulfilled")
        assert.equal(
          (
            await operations.checkout(
              customers[winner].actor,
              customers[winner].input,
            )
          ).id,
          first.value.id,
        );
      const [meal] = await db
        .select()
        .from(t.catalogMeals)
        .where(eq(t.catalogMeals.id, "lemon-chicken-rice"));
      const [slot] = await db
        .select()
        .from(t.deliverySlots)
        .where(eq(t.deliverySlots.id, fixture.slotId));
      assert.equal(meal.stock, 0);
      assert.equal(slot.reserved, 1);
      assert.equal((await db.select().from(t.orders)).length, 1);
      // Exercise recovery with real rows and the migration journal, never the live database.
      const recoveryDir = await mkdtemp(
        path.join(tmpdir(), "nomilora-restore-"),
      );
      const recoveryName = "nomilora_restore_test";
      const pgEnv = {
        ...process.env,
        PGHOST: url.hostname,
        PGPORT: url.port || "5432",
        PGUSER: decodeURIComponent(url.username),
        PGPASSWORD: decodeURIComponent(url.password),
        PGDATABASE: "nomilora_test",
      };
      let created = false;
      const command = (
        binary: string,
        args: string[],
        database = "nomilora_test",
      ) =>
        spawnSync(binary, args, {
          env: { ...pgEnv, PGDATABASE: database },
          encoding: "utf8",
          timeout: 10000,
        });
      try {
        const dumpPath = path.join(recoveryDir, "after-checkout.dump");
        const dump = command("pg_dump", [
          "--format=custom",
          "--no-owner",
          "--no-acl",
          "--file",
          dumpPath,
        ]);
        assert.equal(dump.status, 0, dump.stderr);
        await chmod(dumpPath, 0o600);
        // No --clean or --if-exists: an existing destination is a hard failure.
        const create = command("createdb", [
          "--maintenance-db=nomilora_test",
          recoveryName,
        ]);
        assert.equal(create.status, 0, create.stderr);
        created = true;
        const restore = command(
          "pg_restore",
          [
            "--exit-on-error",
            "--no-owner",
            "--no-acl",
            "--dbname",
            recoveryName,
            dumpPath,
          ],
          recoveryName,
        );
        assert.equal(restore.status, 0, restore.stderr);
        const restored = command(
          "psql",
          [
            "--no-psqlrc",
            "--tuples-only",
            "--no-align",
            "--set=ON_ERROR_STOP=1",
            "--command",
            `select json_build_object('orders', (select count(*) from orders), 'items', (select count(*) from order_items), 'reserved', (select reserved from delivery_slots where id='${fixture.slotId}'), 'stock', (select stock from catalog_meals where id='lemon-chicken-rice'), 'migrations', (select count(*) from drizzle.__drizzle_migrations))`,
          ],
          recoveryName,
        );
        assert.equal(restored.status, 0, restored.stderr);
        assert.deepEqual(JSON.parse(restored.stdout), {
          orders: 1,
          items: 1,
          reserved: 1,
          stock: 0,
          migrations: 6,
        });
      } finally {
        if (created) {
          const drop = command("dropdb", [
            "--maintenance-db=nomilora_test",
            recoveryName,
          ]);
          assert.equal(drop.status, 0, drop.stderr);
        }
        await rm(recoveryDir, { recursive: true, force: true });
      }
    } finally {
      await pool.end();
    }
  },
);
