-- Magnus MVP schema
-- Run against your Supabase project via the SQL editor or Supabase CLI

-- ────────────────────────────────────────
-- SCANS
-- ────────────────────────────────────────
create table if not exists scans (
  id            uuid primary key default gen_random_uuid(),
  url           text not null,
  status        text not null default 'pending'
                  check (status in ('pending','running','complete','failed')),
  scan_type     text not null default 'blackbox'
                  check (scan_type in ('whitebox','blackbox')),
  model         text not null default 'claude-opus-4-6',
  started_at    timestamptz,
  completed_at  timestamptz,
  risk_score    numeric(3,1),
  metadata      jsonb default '{}'::jsonb,
  created_at    timestamptz not null default now()
);

create index idx_scans_status on scans (status);
create index idx_scans_created on scans (created_at desc);

-- ────────────────────────────────────────
-- FINDINGS
-- ────────────────────────────────────────
create table if not exists findings (
  id              uuid primary key default gen_random_uuid(),
  scan_id         uuid not null references scans(id) on delete cascade,
  title           text not null,
  description     text,
  severity        text not null
                    check (severity in ('critical','high','medium','low','info')),
  cvss_score      numeric(3,1),
  status          text not null default 'new'
                    check (status in ('new','confirmed','in_progress','fixed','verified')),
  endpoint        text,
  file_path       text,
  cwe             text,
  owasp           text,
  exploited       boolean not null default false,
  fix_guide_json  jsonb,
  ai_commentary   text,
  created_at      timestamptz not null default now()
);

create index idx_findings_scan on findings (scan_id);
create index idx_findings_severity on findings (severity);
create index idx_findings_status on findings (status);

-- ────────────────────────────────────────
-- AGENT LOG
-- ────────────────────────────────────────
create table if not exists agent_log (
  id          uuid primary key default gen_random_uuid(),
  scan_id     uuid not null references scans(id) on delete cascade,
  timestamp   timestamptz not null default now(),
  phase       text not null
                check (phase in ('recon','planning','exploitation','reporting')),
  message     text not null,
  metadata    jsonb default '{}'::jsonb
);

create index idx_agent_log_scan on agent_log (scan_id);
create index idx_agent_log_timestamp on agent_log (scan_id, timestamp);

-- ────────────────────────────────────────
-- RESCANS
-- ────────────────────────────────────────
create table if not exists rescans (
  id                uuid primary key default gen_random_uuid(),
  original_scan_id  uuid not null references scans(id) on delete cascade,
  finding_id        uuid not null references findings(id) on delete cascade,
  status            text not null default 'pending'
                      check (status in ('pending','running','complete','failed')),
  triggered_at      timestamptz not null default now(),
  completed_at      timestamptz
);

create index idx_rescans_scan on rescans (original_scan_id);
create index idx_rescans_finding on rescans (finding_id);

-- ────────────────────────────────────────
-- ROW LEVEL SECURITY
-- ────────────────────────────────────────
alter table scans enable row level security;
alter table findings enable row level security;
alter table agent_log enable row level security;
alter table rescans enable row level security;

-- Authenticated users can read/write all rows (single-user MVP)
create policy "Authenticated users full access on scans"
  on scans for all
  to authenticated
  using (true)
  with check (true);

create policy "Authenticated users full access on findings"
  on findings for all
  to authenticated
  using (true)
  with check (true);

create policy "Authenticated users full access on agent_log"
  on agent_log for all
  to authenticated
  using (true)
  with check (true);

create policy "Authenticated users full access on rescans"
  on rescans for all
  to authenticated
  using (true)
  with check (true);
