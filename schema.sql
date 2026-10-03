-- ReturnPilot database (v2, demo build). Paste into Supabase: SQL Editor -> New query -> Run.
-- Security: Row Level Security is ON with no browser policies, so the public key can read nothing.
-- Only our server functions (using the secret key) can read and write. Synthetic data only.

create table customers (
  id text primary key,
  name text not null,
  returns_last_90d int not null default 0
);

create table products (
  id text primary key,
  name text not null,
  category text not null,          -- must match a category in the policy rules
  colour text,
  price numeric not null
);

create table orders (
  id text primary key,
  customer_id text not null references customers(id),
  product_id text not null references products(id),
  price numeric not null,
  delivered_at timestamptz not null,
  dispatch_photo text               -- seller's packing photo (compressed image data URL)
);

create table policies (
  version int primary key,
  rules jsonb not null,
  is_active boolean not null default false,
  change_note text,
  created_at timestamptz not null default now()
);
create unique index one_active_policy on policies (is_active) where is_active;

create table proof_codes (
  order_id text not null references orders(id),
  code text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  primary key (order_id, code)
);

create table return_cases (
  id text primary key,
  order_id text not null references orders(id),
  customer_text text not null,
  language text,
  summary text,
  reply_customer text,
  status text not null default 'OPEN',
  claim_photo text,
  received_photo text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table decisions (
  id uuid primary key default gen_random_uuid(),
  case_id text not null references return_cases(id) on delete cascade,
  stage text not null,              -- claim | received | rerun | human
  policy_version int,
  facts jsonb,
  decision text not null,
  flags jsonb not null default '[]',
  clause_id text,
  evidence_score numeric,
  trace jsonb not null default '[]',
  customer_message text,
  model text,
  created_at timestamptz not null default now()
);

create table audit_log (
  id bigint generated always as identity primary key,
  case_id text,
  actor text not null,              -- agent | customer | support | warehouse | admin
  action text not null,
  payload jsonb,
  created_at timestamptz not null default now()
);

alter table customers enable row level security;
alter table products enable row level security;
alter table orders enable row level security;
alter table policies enable row level security;
alter table proof_codes enable row level security;
alter table return_cases enable row level security;
alter table decisions enable row level security;
alter table audit_log enable row level security;

-- Demo data. Edit product names and colours to match the real items you will photograph.
insert into customers values
  ('C1', 'Ravi Kumar', 0),
  ('C2', 'Ananya Rao', 0),
  ('C9', 'Arjun Mehta', 6);

insert into products values
  ('SONIC-X2',  'Wireless Earphones', 'electronics', 'Black',  4999),
  ('TEE-M-BLK', 'Cotton T-shirt, Medium', 'apparel', 'Black',   899),
  ('NOVA-BOOK', 'Nova Book 14 Laptop', 'electronics', 'Silver', 65000);

-- Delivery dates are relative to today, so the demo stays correct on any day.
insert into orders (id, customer_id, product_id, price, delivered_at) values
  ('ORD-1042', 'C1', 'SONIC-X2',  4999,  now() - interval '12 days'),
  ('ORD-2077', 'C1', 'TEE-M-BLK', 899,   now() - interval '5 days'),
  ('ORD-3001', 'C1', 'NOVA-BOOK', 65000, now() - interval '6 days'),
  ('ORD-1100', 'C2', 'SONIC-X2',  4999,  now() - interval '45 days'),
  ('ORD-5005', 'C9', 'TEE-M-BLK', 899,   now() - interval '3 days');

insert into policies (version, rules, is_active, change_note) values (1, '{
  "version": 1,
  "autoThreshold": 0.8,
  "retakeThreshold": 0.6,
  "humanReviewAbovePrice": 20000,
  "maxReturns90d": 3,
  "requireProofCode": true,
  "categories": {
    "electronics": {"clauseId": "ELEC-30", "windowDays": 30, "onDamaged": "REPLACEMENT", "onWrongItem": "EXCHANGE", "changeOfMindAllowed": false, "evidenceRequired": true},
    "apparel":     {"clauseId": "APP-15",  "windowDays": 15, "onDamaged": "REFUND",      "onWrongItem": "EXCHANGE", "changeOfMindAllowed": true,  "evidenceRequired": true}
  }
}', true, 'Initial policy');
