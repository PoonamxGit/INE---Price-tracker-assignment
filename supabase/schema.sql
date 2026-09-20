-- Run once in a fresh Supabase project using SQL Editor. All browser access is denied.
begin;
create table public.tracked_products (
 id uuid primary key default gen_random_uuid(),
 source_product_id text not null unique check (source_product_id ~ '^[1-9][0-9]{0,8}$'),
 name text not null check(length(name)>0), sku text not null,
 product_url text not null unique,
 image_url text, currency text check(currency ~ '^[A-Z]{3}$'),
 is_active boolean not null default true,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 last_successful_scrape_at timestamptz,
 last_scrape_status text check(last_scrape_status in ('running','retried','success','failed')),
 check(product_url='https://demo.inelabteamdev.com/product/'||source_product_id)
);
create table public.scrape_runs (
 id uuid primary key default gen_random_uuid(), product_id uuid not null references public.tracked_products(id),
 trigger_type text not null check(trigger_type in ('manual','initial','cron','headed')),
 cron_key text, status text not null default 'running' check(status in ('running','success','failed')),
 created_at timestamptz not null default now(), finished_at timestamptz,
 lease_until timestamptz not null default now()+interval '5 minutes',
 unique(product_id,cron_key)
);
create unique index one_running_product on public.scrape_runs(product_id) where status='running';
create index run_lease on public.scrape_runs(lease_until) where status='running';
create table public.scrape_attempts (
 id uuid primary key default gen_random_uuid(), product_id uuid not null references public.tracked_products(id),
 run_id uuid not null references public.scrape_runs(id), attempt_number integer not null check(attempt_number between 1 and 3),
 status text not null check(status in ('running','retried','success','failed')),
 error_type text, error_message text check(length(error_message)<=300), http_status integer,
 duration_ms integer check(duration_ms>=0), extraction_method text, source_version text,
 diagnostics jsonb not null default '{}'::jsonb check(pg_column_size(diagnostics)<16000),
 created_at timestamptz not null default now(), finished_at timestamptz,
 unique(run_id,attempt_number)
);
create table public.price_history (
 id uuid primary key default gen_random_uuid(),product_id uuid not null references public.tracked_products(id),
 run_id uuid not null unique references public.scrape_runs(id),
 price numeric(14,2) not null check(price>=0 and price<'Infinity'::numeric),
 currency text not null check(currency ~ '^[A-Z]{3}$'),
 stock_status text not null check(stock_status in ('in_stock','out_of_stock','limited','unknown')),
 stock_quantity integer check(stock_quantity>=0),
 scraped_at timestamptz not null,created_at timestamptz not null default now(),
 check(stock_status<>'out_of_stock' or (stock_quantity is not null and stock_quantity=0)),
 check(stock_status not in ('in_stock','limited') or stock_quantity is null or stock_quantity>0)
);
create index price_history_product_time on public.price_history(product_id,scraped_at desc);
create index scrape_attempts_product_time on public.scrape_attempts(product_id,created_at desc);

create function public.track_product(p_metadata jsonb) returns public.tracked_products language plpgsql set search_path=public as $$
declare result tracked_products;
begin
 perform pg_advisory_xact_lock(717143);
 select * into result from tracked_products where source_product_id=p_metadata->>'id';
 if (result.id is null or not result.is_active) and (select count(*) from tracked_products where is_active)>=20 then
  raise exception 'TRACKING_LIMIT';
 end if;
 insert into tracked_products(source_product_id,name,sku,product_url)
 values(p_metadata->>'id',p_metadata->>'name',p_metadata->>'sku','https://demo.inelabteamdev.com/product/'||(p_metadata->>'id'))
 on conflict(source_product_id) do update set is_active=true,updated_at=now()
 returning * into result;
 return result;
end $$;

create function public.claim_run(p_product_id uuid,p_trigger text,p_cron_key text default null) returns jsonb language plpgsql set search_path=public as $$
declare result scrape_runs; expired record;
begin
 perform pg_advisory_xact_lock(717143);
 -- A crashed worker leaves an honest terminal attempt when the next worker arrives.
 for expired in select * from scrape_runs where status='running' and lease_until<now() for update loop
  update scrape_attempts set status='failed',error_type='WORKER_INTERRUPTED',error_message='Worker lease expired before completion.',finished_at=now()
   where run_id=expired.id and status='running';
  if not exists(select 1 from scrape_attempts where run_id=expired.id and status='failed') then
   insert into scrape_attempts(product_id,run_id,attempt_number,status,error_type,error_message)
   select expired.product_id,expired.id,coalesce(max(attempt_number),0)+1,'failed','WORKER_INTERRUPTED','Worker stopped between attempts.' from scrape_attempts where run_id=expired.id;
  end if;
  update scrape_runs set status='failed',finished_at=now() where id=expired.id;
  update tracked_products set last_scrape_status='failed',updated_at=now() where id=expired.product_id;
 end loop;
 if not exists(select 1 from tracked_products where id=p_product_id and is_active) then return jsonb_build_object('status','inactive');end if;
 if p_cron_key is not null and exists(select 1 from scrape_runs where product_id=p_product_id and cron_key=p_cron_key) then return jsonb_build_object('status','duplicate');end if;
 if exists(select 1 from scrape_runs where product_id=p_product_id and status='running') or (select count(*) from scrape_runs where status='running')>=2 then return jsonb_build_object('status','busy');end if;
 insert into scrape_runs(product_id,trigger_type,cron_key) values(p_product_id,p_trigger,p_cron_key) returning * into result;
 update tracked_products set last_scrape_status='running',updated_at=now() where id=p_product_id;
 return jsonb_build_object('status','claimed','runId',result.id);
end $$;

create function public.start_attempt(p_run_id uuid,p_attempt integer) returns void language plpgsql set search_path=public as $$
declare run scrape_runs;
begin
 select * into run from scrape_runs where id=p_run_id for update;
 if run.status<>'running' or run.lease_until<now() or run.id is null then raise exception 'RUN_NOT_ACTIVE';end if;
 insert into scrape_attempts(product_id,run_id,attempt_number,status) values(run.product_id,run.id,p_attempt,'running');
end $$;

create function public.fail_attempt(p_run_id uuid,p_attempt integer,p_status text,p_error_type text,p_error_message text,p_duration integer,p_diagnostics jsonb) returns void language plpgsql set search_path=public as $$
declare run scrape_runs;
begin
 select * into run from scrape_runs where id=p_run_id for update;
 if run.status<>'running' or run.id is null then raise exception 'RUN_NOT_ACTIVE';end if;
 if p_status not in ('retried','failed') then raise exception 'INVALID_STATUS';end if;
 update scrape_attempts set status=p_status,error_type=p_error_type,error_message=p_error_message,duration_ms=p_duration,
 diagnostics=p_diagnostics,http_status=(p_diagnostics->>'http_status')::int,extraction_method=p_diagnostics->>'extraction_method',source_version=p_diagnostics->>'source_version',finished_at=now()
 where run_id=p_run_id and attempt_number=p_attempt and status='running';
 if not found then raise exception 'ATTEMPT_NOT_RUNNING';end if;
 update tracked_products set last_scrape_status=p_status,updated_at=now() where id=run.product_id;
 if p_status='failed' then update scrape_runs set status='failed',finished_at=now() where id=p_run_id;end if;
end $$;

create function public.complete_attempt(p_run_id uuid,p_attempt integer,p_observation jsonb,p_duration integer,p_diagnostics jsonb) returns void language plpgsql set search_path=public as $$
declare run scrape_runs; price_text text;
begin
 select * into run from scrape_runs where id=p_run_id for update;
 if run.status='success' then return;end if; -- Safe replay after a lost commit response.
 if run.id is null or run.status<>'running' or run.lease_until<now() then raise exception 'RUN_NOT_ACTIVE';end if;
 price_text=p_observation->>'price';
 if price_text is null or price_text !~ '^[0-9]{1,12}\.[0-9]{2}$' then raise exception 'INVALID_PRICE';end if;
 insert into price_history(product_id,run_id,price,currency,stock_status,stock_quantity,scraped_at)
 values(run.product_id,run.id,price_text::numeric,p_observation->>'currency',p_observation->>'stock_status',(p_observation->>'stock_quantity')::integer,(p_observation->>'scraped_at')::timestamptz);
 update scrape_attempts set status='success',duration_ms=p_duration,diagnostics=p_diagnostics,
 http_status=(p_diagnostics->>'http_status')::int,extraction_method=p_diagnostics->>'extraction_method',source_version=p_diagnostics->>'source_version',finished_at=now()
 where run_id=p_run_id and attempt_number=p_attempt and status='running';
 if not found then raise exception 'ATTEMPT_NOT_RUNNING';end if;
 update tracked_products set currency=p_observation->>'currency',last_successful_scrape_at=(p_observation->>'scraped_at')::timestamptz,last_scrape_status='success',updated_at=now() where id=run.product_id;
 update scrape_runs set status='success',finished_at=now() where id=run.id;
end $$;

alter table public.tracked_products enable row level security;
alter table public.scrape_runs enable row level security;
alter table public.scrape_attempts enable row level security;
alter table public.price_history enable row level security;
revoke all on public.tracked_products,public.scrape_runs,public.scrape_attempts,public.price_history from anon,authenticated;
grant all on public.tracked_products,public.scrape_runs,public.scrape_attempts,public.price_history to service_role;
revoke execute on function public.track_product(jsonb),public.claim_run(uuid,text,text),public.start_attempt(uuid,integer),public.fail_attempt(uuid,integer,text,text,text,integer,jsonb),public.complete_attempt(uuid,integer,jsonb,integer,jsonb) from public,anon,authenticated;
grant execute on function public.track_product(jsonb),public.claim_run(uuid,text,text),public.start_attempt(uuid,integer),public.fail_attempt(uuid,integer,text,text,text,integer,jsonb),public.complete_attempt(uuid,integer,jsonb,integer,jsonb) to service_role;
create table public.cron_jobs (
 id uuid primary key default gen_random_uuid(),slot text not null unique,
 product_ids uuid[] not null,status text not null default 'pending' check(status in ('pending','running','completed')),
 lease_until timestamptz,created_at timestamptz not null default now(),finished_at timestamptz,
 results jsonb not null default '[]'::jsonb
);
alter table public.cron_jobs enable row level security;
revoke all on public.cron_jobs from anon,authenticated;
grant all on public.cron_jobs to service_role;
create function public.enqueue_cron() returns public.cron_jobs language plpgsql set search_path=public as $$
declare job cron_jobs; bucket text;
begin
 bucket=floor(extract(epoch from now())/7200)::text;
 insert into cron_jobs(slot,product_ids) select bucket,coalesce(array_agg(id),'{}'::uuid[]) from tracked_products where is_active
 on conflict(slot) do update set slot=excluded.slot returning * into job;
 return job;
end $$;
create function public.claim_cron() returns public.cron_jobs language plpgsql set search_path=public as $$
declare job cron_jobs;
begin
 perform pg_advisory_xact_lock(717144);
 if exists(select 1 from cron_jobs where status='running' and lease_until>now()) then return null;end if;
 select * into job from cron_jobs where status='pending' or (status='running' and lease_until<=now()) order by created_at limit 1 for update;
 if job.id is null then return null;end if;
 update cron_jobs set status='running',lease_until=now()+interval '30 minutes' where id=job.id returning * into job;
 return job;
end $$;
create function public.finish_cron(p_job_id uuid,p_lease_until timestamptz,p_results jsonb,p_complete boolean) returns void language plpgsql set search_path=public as $$
begin
 update cron_jobs set status=case when p_complete then 'completed' else 'pending' end,results=p_results,finished_at=case when p_complete then now() else null end
 where id=p_job_id and status='running' and lease_until=p_lease_until;
 if not found then raise exception 'JOB_LEASE_LOST';end if;
end $$;
revoke execute on function public.enqueue_cron(),public.claim_cron(),public.finish_cron(uuid,timestamptz,jsonb,boolean) from public,anon,authenticated;
grant execute on function public.enqueue_cron(),public.claim_cron(),public.finish_cron(uuid,timestamptz,jsonb,boolean) to service_role;

commit;
