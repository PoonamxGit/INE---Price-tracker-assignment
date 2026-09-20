import { createClient } from "@supabase/supabase-js";
export class DatabaseError extends Error {
  constructor(cause) {
    super("Database operation failed.");
    this.cause = cause;
    this.code = cause.code;
  }
}
export class Repository {
  constructor(client) {
    this.client = client;
  }
  async result(query) {
    const { data, error } = await query;
    if (error) throw new DatabaseError(error);
    return data;
  }
  rpc(name, args) {
    return this.result(this.client.rpc(name, args));
  }
  track(metadata) {
    return this.rpc("track_product", { p_metadata: metadata });
  }
  async list() {
    const products = await this.result(
      this.client
        .from("tracked_products")
        .select("*")
        .eq("is_active", true)
        .order("created_at", { ascending: false }),
    );
    return Promise.all(
      products.map(async (p) => ({
        ...p,
        recent_history: await this.history(p.id, 2),
      })),
    );
  }
  get(id) {
    return this.result(
      this.client
        .from("tracked_products")
        .select("*")
        .eq("id", id)
        .maybeSingle(),
    );
  }
  active() {
    return this.result(
      this.client
        .from("tracked_products")
        .select("*")
        .eq("is_active", true)
        .order("created_at"),
    );
  }
  deactivate(id) {
    return this.result(
      this.client
        .from("tracked_products")
        .update({ is_active: false, updated_at: new Date().toISOString() })
        .eq("id", id)
        .select()
        .maybeSingle(),
    );
  }
  async history(id, limit = 100, offset = 0) {
    const rows = await this.result(
      this.client
        .from("price_history")
        .select("*")
        .eq("product_id", id)
        .order("scraped_at", { ascending: false })
        .order("id")
        .range(offset, offset + limit - 1),
    );
    return rows.map((row) => ({ ...row, price: Number(row.price).toFixed(2) }));
  }
  logs(id, limit = 100, offset = 0) {
    return this.result(
      this.client
        .from("scrape_attempts")
        .select("*")
        .eq("product_id", id)
        .order("created_at", { ascending: false })
        .order("id")
        .range(offset, offset + limit - 1),
    );
  }
  enqueueCron() {
    return this.rpc("enqueue_cron", {});
  }
  claimCron() {
    return this.rpc("claim_cron", {});
  }
  finishCron(job, results, complete) {
    return this.rpc("finish_cron", {
      p_job_id: job.id,
      p_lease_until: job.lease_until,
      p_results: results,
      p_complete: complete,
    });
  }
  getCron(id) {
    return this.result(
      this.client.from("cron_jobs").select("*").eq("id", id).maybeSingle(),
    );
  }
  claim(id, trigger, cronKey = null) {
    return this.rpc("claim_run", {
      p_product_id: id,
      p_trigger: trigger,
      p_cron_key: cronKey,
    });
  }
  startAttempt(runId, _id, attempt) {
    return this.rpc("start_attempt", { p_run_id: runId, p_attempt: attempt });
  }
  failAttempt(v) {
    return this.rpc("fail_attempt", {
      p_run_id: v.runId,
      p_attempt: v.attempt,
      p_status: v.status,
      p_error_type: v.error_type,
      p_error_message: v.error_message,
      p_duration: v.duration_ms,
      p_diagnostics: v.diagnostics || {},
    });
  }
  succeedAttempt(v) {
    return this.rpc("complete_attempt", {
      p_run_id: v.runId,
      p_attempt: v.attempt,
      p_observation: v.observation,
      p_duration: v.duration_ms,
      p_diagnostics: v.diagnostics || {},
    });
  }
}
export function createRepository(config) {
  return new Repository(
    createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    }),
  );
}
