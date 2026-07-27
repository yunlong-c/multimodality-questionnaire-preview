CREATE TABLE IF NOT EXISTS mmq_admin_audit (
  audit_id UUID PRIMARY KEY,
  actor TEXT NOT NULL DEFAULT 'shared_admin'
    CHECK (actor = 'shared_admin'),
  event_type TEXT NOT NULL
    CHECK (
      event_type IN (
        'login_success',
        'login_failure',
        'logout',
        'export'
      )
    ),
  export_id UUID,
  export_scope TEXT
    CHECK (export_scope IS NULL OR export_scope IN ('formal', 'all')),
  export_format TEXT
    CHECK (
      export_format IS NULL
      OR export_format IN (
        'json',
        'participants.csv',
        'trials.csv',
        'mirrors.csv',
        'conflicts.csv'
      )
    ),
  export_row_count INTEGER
    CHECK (export_row_count IS NULL OR export_row_count >= 0),
  trusted_client_ip INET,
  deploy_context TEXT,
  deploy_id TEXT,
  deploy_url TEXT,
  branch TEXT,
  commit_ref TEXT,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT mmq_admin_audit_export_shape CHECK (
    (
      event_type = 'export'
      AND export_id IS NOT NULL
      AND export_scope IS NOT NULL
      AND export_format IS NOT NULL
      AND export_row_count IS NOT NULL
    )
    OR (
      event_type <> 'export'
      AND export_id IS NULL
      AND export_scope IS NULL
      AND export_format IS NULL
      AND export_row_count IS NULL
    )
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS mmq_admin_audit_export_id_uq
  ON mmq_admin_audit (export_id)
  WHERE export_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS mmq_admin_audit_occurred_at_idx
  ON mmq_admin_audit (occurred_at DESC);

CREATE TABLE IF NOT EXISTS mmq_admin_login_throttle (
  trusted_client_ip INET PRIMARY KEY,
  window_started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  attempt_count INTEGER NOT NULL DEFAULT 0
    CHECK (attempt_count >= 0),
  blocked_until TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS mmq_admin_login_throttle_updated_at_idx
  ON mmq_admin_login_throttle (updated_at);
