CREATE TABLE mmq_submissions (
  receipt_id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL UNIQUE,
  participant_id TEXT NOT NULL,
  dataset_classification TEXT NOT NULL
    CHECK (dataset_classification IN ('formal', 'test')),
  client_token_hmac TEXT NOT NULL
    CHECK (client_token_hmac ~ '^[0-9a-f]{64}$'),
  allocation_id TEXT,
  randomization_version TEXT,
  allocation_method TEXT
    CHECK (
      allocation_method IS NULL
      OR allocation_method IN ('variable_block', 'client_fallback')
    ),
  allocation_status TEXT
    CHECK (
      allocation_status IS NULL
      OR allocation_status IN ('confirmed', 'unreconciled')
    ),
  assigned_at TIMESTAMPTZ,
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
  format_assignment TEXT NOT NULL
    CHECK (format_assignment IN ('table', 'graph', 'video')),
  stimulus_set_version TEXT NOT NULL,
  catalog_hash TEXT NOT NULL
    CHECK (catalog_hash ~ '^[0-9a-f]{64}$'),
  payload_sha256 TEXT NOT NULL
    CHECK (payload_sha256 ~ '^[0-9a-f]{64}$'),
  payload_json TEXT NOT NULL,
  client_attempt_count INTEGER NOT NULL
    CHECK (client_attempt_count > 0),
  previous_attempt_latency_ms INTEGER
    CHECK (
      previous_attempt_latency_ms IS NULL
      OR previous_attempt_latency_ms >= 0
    ),
  submitted_at TIMESTAMPTZ NOT NULL,
  stored_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  trusted_client_ip TEXT,
  deploy_context TEXT NOT NULL,
  deploy_id TEXT,
  deploy_url TEXT,
  deploy_branch TEXT,
  deploy_commit_ref TEXT,
  CHECK (
    (
      dataset_classification = 'formal'
      AND allocation_id IS NOT NULL
      AND randomization_version IS NOT NULL
      AND allocation_method IS NOT NULL
      AND allocation_status = 'confirmed'
      AND assigned_at IS NOT NULL
      AND (
        (
          allocation_method = 'variable_block'
          AND fallback_reason_code IS NULL
          AND fallback_reconciled_at IS NULL
        )
        OR
        (
          allocation_method = 'client_fallback'
          AND fallback_reason_code IS NOT NULL
          AND fallback_reconciled_at IS NOT NULL
        )
      )
    )
    OR
    (
      dataset_classification = 'test'
      AND allocation_id IS NULL
      AND randomization_version IS NULL
      AND allocation_method IS NULL
      AND allocation_status IS NULL
      AND assigned_at IS NULL
      AND fallback_reason_code IS NULL
      AND fallback_reconciled_at IS NULL
    )
  )
);

CREATE INDEX mmq_submissions_by_participant
  ON mmq_submissions (participant_id, stored_at);

CREATE INDEX mmq_submissions_by_classification
  ON mmq_submissions (dataset_classification, stored_at);

CREATE INDEX mmq_submissions_by_format
  ON mmq_submissions (
    dataset_classification,
    format_assignment,
    stored_at
  );

CREATE TABLE mmq_submission_conflicts (
  conflict_id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  existing_receipt_id TEXT NOT NULL
    REFERENCES mmq_submissions(receipt_id)
    ON DELETE RESTRICT,
  attempted_payload_sha256 TEXT NOT NULL
    CHECK (attempted_payload_sha256 ~ '^[0-9a-f]{64}$'),
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  trusted_client_ip TEXT,
  deploy_context TEXT NOT NULL,
  deploy_id TEXT,
  deploy_url TEXT,
  deploy_branch TEXT,
  deploy_commit_ref TEXT
);

CREATE INDEX mmq_submission_conflicts_by_session
  ON mmq_submission_conflicts (session_id, received_at);

CREATE TABLE mmq_submission_form_mirrors (
  mirror_id TEXT PRIMARY KEY,
  receipt_id TEXT NOT NULL UNIQUE
    REFERENCES mmq_submissions(receipt_id)
    ON DELETE RESTRICT,
  form_name TEXT NOT NULL
    CHECK (
      form_name IN (
        'mmq-submission-v2-formal',
        'mmq-submission-v2-test'
      )
    ),
  state TEXT NOT NULL DEFAULT 'pending'
    CHECK (state IN ('pending', 'processing', 'accepted', 'failed')),
  attempt_count INTEGER NOT NULL DEFAULT 0
    CHECK (attempt_count >= 0),
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_attempt_at TIMESTAMPTZ,
  accepted_at TIMESTAMPTZ,
  lease_expires_at TIMESTAMPTZ,
  last_http_status INTEGER,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (
    (state = 'accepted' AND accepted_at IS NOT NULL)
    OR
    (state <> 'accepted' AND accepted_at IS NULL)
  )
);

CREATE INDEX mmq_submission_form_mirrors_due
  ON mmq_submission_form_mirrors (next_attempt_at, created_at)
  WHERE state IN ('pending', 'failed');

CREATE INDEX mmq_submission_form_mirrors_expired_lease
  ON mmq_submission_form_mirrors (lease_expires_at)
  WHERE state = 'processing';
