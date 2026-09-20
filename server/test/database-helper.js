import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import { Repository } from "../src/db/repository.js";
export async function testDatabase() {
  const db = new PGlite();
  await db.exec(
    "create role anon; create role authenticated; create role service_role bypassrls;",
  );
  await db.exec(
    await readFile(
      new URL("../../supabase/schema.sql", import.meta.url),
      "utf8",
    ),
  );
  class TestRepository extends Repository {
    constructor() {
      super(null);
    }
    async rpc(name, args) {
      const keys = Object.keys(args);
      return (
        await db.query(
          `select to_jsonb(public.${name}(${keys.map((k, i) => `${k} => $${i + 1}`).join(",")})) as result`,
          Object.values(args),
        )
      ).rows[0].result;
    }
    async get(id) {
      return (
        (await db.query("select * from tracked_products where id=$1", [id]))
          .rows[0] || null
      );
    }
    async getCron(id) {
      return (
        (await db.query("select * from cron_jobs where id=$1", [id])).rows[0] ||
        null
      );
    }
    async active() {
      return (
        await db.query(
          "select * from tracked_products where is_active order by created_at",
        )
      ).rows;
    }
    async list() {
      return Promise.all(
        (await this.active()).map(async (p) => ({
          ...p,
          recent_history: await this.history(p.id, 2),
        })),
      );
    }
    async history(id, limit = 100, offset = 0) {
      return (
        await db.query(
          "select * from price_history where product_id=$1 order by scraped_at desc limit $2 offset $3",
          [id, limit, offset],
        )
      ).rows;
    }
    async logs(id, limit = 100, offset = 0) {
      return (
        await db.query(
          "select * from scrape_attempts where product_id=$1 order by created_at desc limit $2 offset $3",
          [id, limit, offset],
        )
      ).rows;
    }
    async deactivate(id) {
      return (
        await db.query(
          "update tracked_products set is_active=false where id=$1 returning *",
          [id],
        )
      ).rows[0];
    }
  }
  return { db, repository: new TestRepository() };
}
