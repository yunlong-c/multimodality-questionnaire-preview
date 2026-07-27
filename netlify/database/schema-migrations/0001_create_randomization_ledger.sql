CREATE TABLE mmq_randomization_schedules (
  randomization_version TEXT PRIMARY KEY,
  schema_version INTEGER NOT NULL CHECK (schema_version = 1),
  schedule_sha256 TEXT NOT NULL UNIQUE
    CHECK (schedule_sha256 ~ '^[0-9a-f]{64}$'),
  total_slots INTEGER NOT NULL CHECK (total_slots > 0),
  allowed_block_sizes INTEGER[] NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'active', 'closed')),
  imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  activated_at TIMESTAMPTZ,
  closed_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB
);

CREATE UNIQUE INDEX mmq_randomization_one_active_schedule
  ON mmq_randomization_schedules ((status))
  WHERE status = 'active';

CREATE TABLE mmq_randomization_slots (
  randomization_version TEXT NOT NULL
    REFERENCES mmq_randomization_schedules(randomization_version)
    ON DELETE RESTRICT,
  position INTEGER NOT NULL CHECK (position > 0),
  block_id TEXT NOT NULL,
  block_size INTEGER NOT NULL CHECK (block_size IN (6, 9, 12)),
  block_position INTEGER NOT NULL CHECK (
    block_position > 0 AND block_position <= block_size
  ),
  format_assignment TEXT NOT NULL
    CHECK (format_assignment IN ('table', 'graph', 'video')),
  allocation_id TEXT,
  assigned_at TIMESTAMPTZ,
  PRIMARY KEY (randomization_version, position),
  UNIQUE (randomization_version, block_id, block_position),
  UNIQUE (allocation_id),
  CHECK (
    (allocation_id IS NULL AND assigned_at IS NULL)
    OR
    (allocation_id IS NOT NULL AND assigned_at IS NOT NULL)
  )
);

CREATE INDEX mmq_randomization_next_slot
  ON mmq_randomization_slots (randomization_version, position)
  WHERE allocation_id IS NULL;

CREATE TABLE mmq_randomization_assignments (
  allocation_id TEXT PRIMARY KEY,
  randomization_version TEXT NOT NULL
    REFERENCES mmq_randomization_schedules(randomization_version)
    ON DELETE RESTRICT,
  schedule_position INTEGER,
  token_hmac TEXT NOT NULL CHECK (token_hmac ~ '^[0-9a-f]{64}$'),
  participant_id TEXT NOT NULL UNIQUE,
  format_assignment TEXT NOT NULL
    CHECK (format_assignment IN ('table', 'graph', 'video')),
  allocation_method TEXT NOT NULL
    CHECK (allocation_method IN ('variable_block', 'client_fallback')),
  allocation_status TEXT NOT NULL DEFAULT 'confirmed'
    CHECK (allocation_status = 'confirmed'),
  assigned_at TIMESTAMPTZ NOT NULL,
  fallback_reason_code TEXT
    CHECK (
      fallback_reason_code IS NULL
      OR fallback_reason_code IN (
        'allocation_timeout',
        'allocation_network_error',
        'allocation_server_error'
      )
    ),
  fallback_reconciled_at TIMESTAMPTZ,
  supersedes_allocation_id TEXT
    REFERENCES mmq_randomization_assignments(allocation_id)
    ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  visit_count INTEGER NOT NULL DEFAULT 1 CHECK (visit_count > 0),
  FOREIGN KEY (randomization_version, schedule_position)
    REFERENCES mmq_randomization_slots(randomization_version, position)
    ON DELETE RESTRICT,
  CHECK (
    (
      allocation_method = 'variable_block'
      AND schedule_position IS NOT NULL
      AND fallback_reason_code IS NULL
      AND fallback_reconciled_at IS NULL
      AND supersedes_allocation_id IS NULL
    )
    OR
    (
      allocation_method = 'client_fallback'
      AND schedule_position IS NULL
      AND fallback_reason_code IS NOT NULL
      AND fallback_reconciled_at IS NOT NULL
    )
  )
);

CREATE UNIQUE INDEX mmq_randomization_one_scheduled_assignment_per_token
  ON mmq_randomization_assignments (randomization_version, token_hmac)
  WHERE allocation_method = 'variable_block';

CREATE UNIQUE INDEX mmq_randomization_one_fallback_assignment_per_token
  ON mmq_randomization_assignments (randomization_version, token_hmac)
  WHERE allocation_method = 'client_fallback';

CREATE UNIQUE INDEX mmq_randomization_one_assignment_per_slot
  ON mmq_randomization_assignments (randomization_version, schedule_position)
  WHERE schedule_position IS NOT NULL;

CREATE TABLE mmq_randomization_sessions (
  session_id TEXT PRIMARY KEY,
  allocation_id TEXT NOT NULL
    REFERENCES mmq_randomization_assignments(allocation_id)
    ON DELETE RESTRICT,
  opened_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  source TEXT NOT NULL CHECK (source IN ('allocate', 'reconcile'))
);

CREATE INDEX mmq_randomization_sessions_by_allocation
  ON mmq_randomization_sessions (allocation_id, opened_at);
