-- ═══════════════════════════════════════════════════════════════════
--  NC COMPLIANCE CRM — SUPABASE SCHEMA  (fixed v2)
--  Paste into: Supabase Dashboard → SQL Editor → New Query → Run
-- ═══════════════════════════════════════════════════════════════════

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ─── DROP old policies if re-running ────────────────────────────
DO $$ BEGIN
  EXECUTE (
    SELECT string_agg('DROP POLICY IF EXISTS "' || policyname || '" ON ' || tablename || ';', E'\n')
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN ('crm_users','prospects','emails','audit_log','system_settings')
  );
EXCEPTION WHEN others THEN NULL;
END $$;

-- ─── 1. USERS ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS crm_users (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  username    TEXT UNIQUE NOT NULL,
  password    TEXT NOT NULL,
  name        TEXT NOT NULL,
  email       TEXT UNIQUE NOT NULL,
  role        TEXT NOT NULL DEFAULT 'user'
                CHECK (role IN ('superadmin','admin','manager','user','viewer')),
  active      BOOLEAN NOT NULL DEFAULT TRUE,
  avatar      TEXT,
  last_login  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── 2. PROSPECTS ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS prospects (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_name        TEXT NOT NULL DEFAULT '',
  contact_name        TEXT DEFAULT '',
  title               TEXT DEFAULT '',
  email_phone         TEXT DEFAULT '',
  city_market         TEXT DEFAULT '',
  market              TEXT DEFAULT '',
  source_url          TEXT DEFAULT '',
  source_type         TEXT DEFAULT '',
  verification_notes  TEXT DEFAULT '',
  why_fit             TEXT DEFAULT '',
  vertical            TEXT DEFAULT '',
  hr_person_listed    TEXT DEFAULT 'No',
  hr_people_contact   TEXT DEFAULT '',
  org_size            TEXT DEFAULT '',
  t1_send_date        DATE,
  t1_due_date         DATE,
  t2_send_date        DATE,
  t2_due_date         DATE,
  t3_send_date        DATE,
  t3_due_date         DATE,
  lead_pain_point     TEXT DEFAULT '',
  melissa_review      TEXT DEFAULT '',
  t3_approved         BOOLEAN DEFAULT FALSE,
  reply_received      BOOLEAN DEFAULT FALSE,
  flag_to_melissa     BOOLEAN DEFAULT FALSE,
  do_not_respond      BOOLEAN DEFAULT FALSE,
  current_status      TEXT DEFAULT 'NEW',
  outreach_notes      TEXT DEFAULT '',
  priority_score      INTEGER,
  remarks             TEXT DEFAULT '',
  created_by          UUID,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Auto-update updated_at trigger
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$;
DROP TRIGGER IF EXISTS prospects_updated_at ON prospects;
CREATE TRIGGER prospects_updated_at
  BEFORE UPDATE ON prospects
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ─── 3. EMAILS ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS emails (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  prospect_id   UUID,
  sent_by       UUID,
  to_email      TEXT NOT NULL DEFAULT '',
  to_name       TEXT DEFAULT '',
  subject       TEXT NOT NULL DEFAULT '',
  body          TEXT DEFAULT '',
  touch         TEXT DEFAULT 'Custom',
  direction     TEXT NOT NULL DEFAULT 'outbound',
  from_email    TEXT DEFAULT '',
  from_name     TEXT DEFAULT '',
  opened        BOOLEAN DEFAULT FALSE,
  sentiment     TEXT DEFAULT 'neutral',
  label         TEXT DEFAULT NULL,
  sent_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── 4. AUDIT LOG ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS audit_log (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID,
  username    TEXT NOT NULL DEFAULT '',
  action      TEXT NOT NULL DEFAULT '',
  entity_type TEXT DEFAULT NULL,
  entity_id   UUID DEFAULT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── 5. SYSTEM SETTINGS ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS system_settings (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  key         TEXT UNIQUE NOT NULL,
  value       TEXT,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── 6. INDEXES ──────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_prospects_status   ON prospects(current_status);
CREATE INDEX IF NOT EXISTS idx_prospects_market   ON prospects(market);
CREATE INDEX IF NOT EXISTS idx_prospects_vertical ON prospects(vertical);
CREATE INDEX IF NOT EXISTS idx_emails_prospect    ON emails(prospect_id);
CREATE INDEX IF NOT EXISTS idx_audit_created      ON audit_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_settings_key       ON system_settings(key);

-- ─── 7. ROW LEVEL SECURITY ───────────────────────────────────────
-- IMPORTANT: We disable RLS on all tables so the anon key can read/write freely.
-- The CRM handles its own role-based access control in the React app.
-- For production you can re-enable and add per-role policies.

ALTER TABLE crm_users       DISABLE ROW LEVEL SECURITY;
ALTER TABLE prospects        DISABLE ROW LEVEL SECURITY;
ALTER TABLE emails           DISABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log        DISABLE ROW LEVEL SECURITY;
ALTER TABLE system_settings  DISABLE ROW LEVEL SECURITY;

-- ─── 8. GRANT PERMISSIONS to anon role ───────────────────────────
-- This allows the anon (public) API key to read and write all tables.
GRANT ALL ON crm_users      TO anon, authenticated;
GRANT ALL ON prospects       TO anon, authenticated;
GRANT ALL ON emails          TO anon, authenticated;
GRANT ALL ON audit_log       TO anon, authenticated;
GRANT ALL ON system_settings TO anon, authenticated;

-- Sequences (needed for uuid_generate_v4 in some Supabase versions)
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated;

-- ─── 9. SEED DATA ────────────────────────────────────────────────
INSERT INTO crm_users (username, password, name, email, role, active, avatar)
VALUES
  ('superadmin','superadmin','Super Administrator', 'superadmin@hrondemand.com','superadmin',TRUE,'SA'),
  ('admin',     'admin',     'System Administrator','admin@hrondemand.com',      'admin',      TRUE,'AD'),
  ('manager1',  'manager123','Melissa Pennington',  'melissa@hrondemand.com',    'manager',    TRUE,'MP'),
  ('user1',     'user123',   'Jordan Hayes',        'jordan@hrondemand.com',     'user',       TRUE,'JH'),
  ('viewer1',   'view123',   'Alex Torres',         'alex@hrondemand.com',       'viewer',     TRUE,'AT')
ON CONFLICT (username) DO NOTHING;

INSERT INTO prospects
  (company_name,contact_name,title,email_phone,city_market,market,
   source_type,verification_notes,why_fit,vertical,hr_person_listed,org_size,
   t1_send_date,t1_due_date,t2_send_date,t2_due_date,t3_send_date,t3_due_date,
   lead_pain_point,t3_approved,reply_received,flag_to_melissa,do_not_respond,
   current_status,priority_score)
VALUES
  ('Comfort Keepers – Raleigh','Bob Marshall','Franchise Owner',
   'bobmarshall@comfortkeepers.com','Raleigh','Raleigh',
   'Franchise Directory','Verified.','Wage/hour compliance risk.',
   'Home Health / Homecare','No','10-49',
   '2026-05-05','2026-05-12','2026-05-12','2026-05-19','2026-05-19','2026-05-26',
   'Caregiver misclassification.',FALSE,FALSE,FALSE,TRUE,'NURTURE/T3 SENT',5),

  ('Bright Horizons Childcare','Sandra Kim','Executive Director',
   'sandra@brighthorizons-nc.com','Durham','Durham',
   'LinkedIn','Confirmed active.','Staff classification risk.',
   'Childcare & Licensed Group Homes','Yes','50-99',
   '2026-05-10','2026-05-17',NULL,NULL,NULL,NULL,
   'Worker classification, I-9.',FALSE,FALSE,TRUE,FALSE,'T1 SENT',8),

  ('NC Hope Foundation','Dr. Angela Foster','Executive Director',
   'afoster@nchopefoundation.org','Raleigh','Raleigh',
   'Nonprofit Directory','501(c)(3) confirmed.','HR documentation gaps.',
   'Nonprofits & Associations','No','10-49',
   NULL,NULL,NULL,NULL,NULL,NULL,
   'HR documentation gaps.',FALSE,FALSE,FALSE,FALSE,'NEW',7),

  ('Triangle Logistics Partners','Marcus Webb','Operations Manager',
   'mwebb@trianglelogistics.com','Durham','Durham',
   'Apollo.io','Verified.','Driver classification risk.',
   'Light Manufacturing & Logistics','No','50-99',
   '2026-05-08','2026-05-15','2026-05-15','2026-05-22','2026-05-22','2026-05-29',
   'Driver misclassification.',TRUE,FALSE,FALSE,FALSE,'TOUCH 3 GATE',9),

  ('Community Care Services','Linda Torres','Executive Director',
   'ltorres@communitycare-nc.org','Greensboro','Greensboro',
   'Nonprofit Directory','Active 501(c)(3).','Human services staffing compliance.',
   'Human Services Nonprofits','No','50-99',
   NULL,NULL,NULL,NULL,NULL,NULL,
   'FLSA, I-9 documentation.',FALSE,FALSE,FALSE,FALSE,'NEW',8)
ON CONFLICT DO NOTHING;

INSERT INTO system_settings (key, value) VALUES
  ('siteName',              'NC Compliance CRM'),
  ('orgName',               'HR On Demand'),
  ('senderName',            'Melissa Pennington'),
  ('senderEmail',           'melissa@hrondemand.com'),
  ('senderTitle',           'Founder, HR On Demand'),
  ('honeyLink',             '[Schedule Link]'),
  ('website',               'thehrondemand.com'),
  ('maxProspects',          '1000'),
  ('requireMelissaApproval','true'),
  ('autoArchiveDNR',        'false'),
  ('emailGmailDefault',     'true'),
  ('apolloKey',             ''),
  ('hunterKey',             ''),
  ('anthropicKey',          '')
ON CONFLICT (key) DO NOTHING;

INSERT INTO audit_log (username, action)
VALUES ('system', 'Database initialized — NC Compliance CRM v4.0 (schema v2)');

-- ═══════════════════════════════════════════════════════════════════
--  DONE ✓
--  Verify in Table Editor that crm_users shows 5 rows
--  and prospects shows 5 rows.
-- ═══════════════════════════════════════════════════════════════════
