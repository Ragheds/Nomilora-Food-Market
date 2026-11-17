/** Read-only preflight by default; guarded adoption requires a reviewed, backed-up empty baseline. */
import { readFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { pool } from "@workspace/db";
import { readMigrationFiles } from "drizzle-orm/migrator";
const adopt = process.argv.includes("--adopt-empty-baseline");
const expected = new PGlite();
const queries = {
  tables: `select tablename, rowsecurity from pg_tables where schemaname='public' order by tablename`,
  columns: `select table_name,column_name,ordinal_position,is_nullable,data_type,udt_schema,udt_name,column_default from information_schema.columns where table_schema='public' order by table_name,ordinal_position`,
  enums: `select t.typname,e.enumlabel,e.enumsortorder from pg_type t join pg_enum e on t.oid=e.enumtypid join pg_namespace n on n.oid=t.typnamespace where n.nspname='public' order by t.typname,e.enumsortorder`,
  constraints: `select c.relname table_name,k.conname,k.contype,pg_get_constraintdef(k.oid) definition from pg_constraint k join pg_class c on c.oid=k.conrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' order by c.relname,k.conname`,
  indexes: `select tablename,indexname,indexdef from pg_indexes where schemaname='public' order by tablename,indexname`,
  triggers: `select c.relname table_name,t.tgname,pg_get_triggerdef(t.oid) definition from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and not t.tgisinternal order by c.relname,t.tgname`,
};
try {
  const source = await readFile(
    fileURLToPath(
      new URL(
        "../../../lib/db/migrations/0000_tidy_edwin_jarvis.sql",
        import.meta.url,
      ),
    ),
    "utf8",
  );
  await expected.exec(source);
  const expectedSchema: Record<string, unknown> = {},
    actualSchema: Record<string, unknown> = {};
  // Normal inspection is read-only. Explicit adoption locks and rechecks the original tables.
  const client = await pool.connect();
  try {
    if (adopt) {
      if (process.env.CONFIRM_EMPTY_BASELINE !== "yes")
        throw new Error("Explicit empty-baseline confirmation required.");
      const backup = process.env.NOMILORA_DATABASE_BACKUP;
      if (!backup)
        throw new Error(
          "A private PostgreSQL custom-format backup is required.",
        );
      const metadata = await stat(backup);
      if (
        metadata.size < 100 ||
        (metadata.mode & 0o077) !== 0 ||
        (await readFile(backup)).subarray(0, 5).toString() !== "PGDMP"
      )
        throw new Error(
          "Backup must be nonempty, private and PostgreSQL custom format.",
        );
    }
    await client.query(adopt ? "BEGIN" : "BEGIN READ ONLY");
    if (adopt) {
      const tables = (
        await expected.query<{ tablename: string }>(queries.tables)
      ).rows;
      await client.query(
        "LOCK TABLE " +
          tables
            .map(
              ({ tablename }) =>
                'public."' + tablename.replaceAll('"', '""') + '"',
            )
            .join(",") +
          " IN ACCESS EXCLUSIVE MODE",
      );
    }
    for (const [name, query] of Object.entries(queries)) {
      expectedSchema[name] = (await expected.query(query)).rows;
      actualSchema[name] = (await client.query(query)).rows;
    }
    const journal = await client.query(
      "select to_regclass('drizzle.__drizzle_migrations') is not null as present",
    );
    const tables = actualSchema.tables as { tablename: string }[];
    const counts: Record<string, string> = {};
    for (const { tablename } of tables) {
      // Identifiers come only from PostgreSQL's catalog; escape them nonetheless.
      const identifier = '"' + tablename.replaceAll('"', '""') + '"';
      counts[tablename] = (
        await client.query(
          `select count(*)::text as count from public.${identifier}`,
        )
      ).rows[0].count;
    }
    const mismatches = Object.keys(queries).filter(
      (name) =>
        JSON.stringify(expectedSchema[name]) !==
        JSON.stringify(actualSchema[name]),
    );
    const hash = (value: unknown) =>
      createHash("sha256").update(JSON.stringify(value)).digest("hex");
    console.log(
      JSON.stringify(
        {
          readOnly: !adopt,
          baseline: "0000",
          migrationJournalPresent: journal.rows[0].present,
          exactSchemaMatch: mismatches.length === 0,
          mismatches,
          expectedFingerprint: hash(expectedSchema),
          actualFingerprint: hash(actualSchema),
          tableRowCounts: counts,
        },
        null,
        2,
      ),
    );
    if (mismatches.length) {
      console.error(
        "Baseline mismatch: stop and review the live schema. No migration record was written.",
      );
      process.exitCode = 2;
    }
    if (adopt) {
      if (
        mismatches.length ||
        journal.rows[0].present ||
        Object.values(counts).some((count) => count !== "0") ||
        process.env.NOMILORA_REVIEWED_BASELINE_FINGERPRINT !==
          hash(actualSchema)
      )
        throw new Error(
          "Refusing baseline adoption: exact reviewed schema, no journal and empty tables are required.",
        );
      const [baseline] = readMigrationFiles({
        migrationsFolder: fileURLToPath(
          new URL("../../../lib/db/migrations", import.meta.url),
        ),
      });
      await client.query('CREATE SCHEMA "drizzle"');
      await client.query(
        'CREATE TABLE "drizzle"."__drizzle_migrations" (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at bigint)',
      );
      await client.query(
        'INSERT INTO "drizzle"."__drizzle_migrations" (hash,created_at) VALUES ($1,$2)',
        [baseline.hash, baseline.folderMillis],
      );
      await client.query("COMMIT");
      console.log(
        "Verified empty baseline 0000 adopted. Existing application tables were preserved.",
      );
    } else await client.query("ROLLBACK");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
} finally {
  await expected.close();
  await pool.end();
}
