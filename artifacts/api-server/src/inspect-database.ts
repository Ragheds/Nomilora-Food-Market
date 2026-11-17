/** Read-only preflight for the original Drizzle-push schema; never establishes a guessed journal. */
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { pool } from "@workspace/db";
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
  // A read-only transaction prevents accidental mutation even if this script is later extended.
  const client = await pool.connect();
  try {
    await client.query("BEGIN READ ONLY");
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
          readOnly: true,
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
    await client.query("ROLLBACK");
  } finally {
    client.release();
  }
} finally {
  await expected.close();
  await pool.end();
}
