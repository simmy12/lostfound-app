-- ===================== Lost & Found DB Schema =====================

CREATE TABLE users (
  id            SERIAL PRIMARY KEY,
  name          TEXT NOT NULL,
  email         TEXT UNIQUE,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('user','rep','admin')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ===== Categories / Items master data =====

CREATE TABLE categories_main (
  id   SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE
);

CREATE TABLE categories_sub (
  id       SERIAL PRIMARY KEY,
  main_id  INTEGER NOT NULL REFERENCES categories_main(id) ON DELETE CASCADE,
  name     TEXT NOT NULL,
  UNIQUE (main_id, name)
);

CREATE TABLE items (
  id                INTEGER PRIMARY KEY,      -- keeps original מזהה פריט ids from source data
  sub_id            INTEGER NOT NULL REFERENCES categories_sub(id) ON DELETE CASCADE,
  name              TEXT NOT NULL,
  can_be_contained  BOOLEAN NOT NULL DEFAULT true,  -- ask "was this inside something?" (e.g. false for a stroller)
  can_have_nearby   BOOLEAN NOT NULL DEFAULT true,  -- ask "were other items found/lost nearby?"
  can_contain_items BOOLEAN NOT NULL DEFAULT false  -- ask "what was inside it?" (true for bags/suitcases etc.)
);

-- ===== Attributes (dynamic question bank) =====

CREATE TABLE attributes (
  id         SERIAL PRIMARY KEY,
  name       TEXT NOT NULL UNIQUE,
  input_type TEXT NOT NULL DEFAULT 'single' CHECK (input_type IN ('single','multi','text','number','boolean')),
  scope      TEXT NOT NULL DEFAULT 'item' CHECK (scope IN ('item','universal')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE attribute_values (
  id           SERIAL PRIMARY KEY,
  attribute_id INTEGER NOT NULL REFERENCES attributes(id) ON DELETE CASCADE,
  value        TEXT NOT NULL,
  display_order INTEGER NOT NULL DEFAULT 0,
  UNIQUE (attribute_id, value)
);

-- which attributes apply to which item, in what order, with what matching weight
CREATE TABLE item_attributes (
  item_id       INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  attribute_id  INTEGER NOT NULL REFERENCES attributes(id) ON DELETE CASCADE,
  display_order INTEGER NOT NULL DEFAULT 0,
  weight        INTEGER NOT NULL DEFAULT 10,
  PRIMARY KEY (item_id, attribute_id)
);

-- universal attributes (location/date) + their weight, applies to every report
CREATE TABLE universal_attributes (
  attribute_id  INTEGER PRIMARY KEY REFERENCES attributes(id) ON DELETE CASCADE,
  display_order INTEGER NOT NULL DEFAULT 0,
  weight        INTEGER NOT NULL DEFAULT 10
);

-- ===== Reports =====

CREATE TABLE reports (
  id             SERIAL PRIMARY KEY,
  type           TEXT NOT NULL CHECK (type IN ('lost','found')),
  item_id        INTEGER NOT NULL REFERENCES items(id),
  status         TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','matched','closed')),
  free_text      TEXT,  -- "תיאור נוסף"
  note           TEXT,  -- "הערה" — a second, separate free-text field
  contact_name   TEXT,
  contact_phone  TEXT,
  contact_email  TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- actual answers given for a report: both universal (location/date) and item-specific attributes.
-- A 'multi' attribute (e.g. color) can have several rows for the same (report, attribute) — one
-- per selected value. A 'single' attribute has at most one. free_text (with value_id null) means
-- the reporter picked "אחר" and typed their own value, EXCEPT for attributes whose input_type is
-- itself 'text' (like city), where free_text is just the normal answer.
CREATE TABLE report_attribute_values (
  id             SERIAL PRIMARY KEY,
  report_id      INTEGER NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  attribute_id   INTEGER NOT NULL REFERENCES attributes(id) ON DELETE CASCADE,
  value_id       INTEGER REFERENCES attribute_values(id),   -- for select-type attributes
  free_text      TEXT,                                       -- for text-type attributes, or an "אחר" fill-in
  UNIQUE (report_id, attribute_id, value_id)
);

-- matches computed on demand, persisted once a rep confirms one
CREATE TABLE matches (
  id           SERIAL PRIMARY KEY,
  lost_report_id  INTEGER NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  found_report_id INTEGER NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  score        NUMERIC(5,2) NOT NULL,
  confirmed    BOOLEAN NOT NULL DEFAULT false,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (lost_report_id, found_report_id)
);

-- "מכיל/מוכל": a container report (e.g. a suitcase) holding one or more content reports
-- (e.g. a wallet, keys — each a fully independent report). One content belongs to one container.
CREATE TABLE report_container_links (
  container_report_id INTEGER NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  content_report_id   INTEGER NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  PRIMARY KEY (content_report_id)
);

-- items reported as found/lost near each other, likely belonging to the same person.
-- Symmetric peer link — stored once per pair (report_id_a < report_id_b).
CREATE TABLE report_nearby_links (
  report_id_a INTEGER NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  report_id_b INTEGER NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  CHECK (report_id_a < report_id_b),
  PRIMARY KEY (report_id_a, report_id_b)
);

CREATE INDEX idx_items_sub ON items(sub_id);
CREATE INDEX idx_rcl_container ON report_container_links(container_report_id);
CREATE INDEX idx_rnl_a ON report_nearby_links(report_id_a);
CREATE INDEX idx_rnl_b ON report_nearby_links(report_id_b);
CREATE INDEX idx_reports_item ON reports(item_id);
CREATE INDEX idx_reports_type_status ON reports(type, status);
CREATE INDEX idx_rav_report ON report_attribute_values(report_id);
CREATE INDEX idx_rav_attribute ON report_attribute_values(attribute_id);
