# Formal randomization operations

The formal allocation schedule is an allocation-concealment artifact. Never
commit, email unencrypted, or place the private schedule or ledger exports in
the public repository. `.private/` and export directories are ignored by Git.
The public repository contains only the randomization version and the one-way
SHA-256 schedule commitment.

## One-time production setup

1. Preserve two encrypted backups of
   `.private/randomization/mmq-randomization-2026-07-v1.json`. Do not regenerate
   this version after formal allocation begins.
2. Deploy once so the guarded build migration runner applies
   `netlify/database/schema-migrations/0001_create_randomization_ledger.sql`
   to the database branch for that deploy. The runner uses a transaction,
   advisory lock, and recorded SHA-256; a changed applied migration fails the
   build instead of being silently replayed. Keep
   `netlify/database/migrations/` empty: mixing this explicit runner with
   Netlify's native migration directory is a release-blocking error.
3. Configure `MMQ_RANDOMIZATION_HMAC_SECRET` in the Netlify UI for Functions.
   Use at least 32 random bytes. Do not put it in `netlify.toml` or Git.
4. Keep `MMQ_FORMAL_COLLECTION_OPEN` absent or set to `false` while preparing
   production. Only the exact lowercase value `true` opens the Function gate.
5. Obtain production database credentials through the Netlify Database CLI and
   expose them locally as `NETLIFY_DB_URL`.
6. Import and activate the committed schedule:

   ```text
   npm run randomization:validate
   npm run randomization:import -- --activate
   ```

Until import and activation succeed, `/api/allocate` returns
`COLLECTION_CLOSED`; the client must not use emergency randomization for this
intentional state.

The pre-build runner is intentionally limited to the current additive baseline
schema. Future destructive schema changes must use an out-of-band
expand/migrate/contract release and must not be added casually to this step.

To start formal collection, set `MMQ_FORMAL_COLLECTION_OPEN=true` in the
Netlify Functions environment only after the migration, schedule activation,
and release checks pass. Trigger a new production deploy, wait for it to become
Ready, and verify `/api/allocate` no longer returns `423 COLLECTION_CLOSED`
before distributing the link. A missing value, `false`, `TRUE`, or any other
value returns `423 COLLECTION_CLOSED` without opening a database connection.

On Netlify's Free plan, granular Functions-only scopes are unavailable. Limit
these variables to the intended deploy context, keep both names free of the
`VITE_` prefix, and redeploy after every change. This keeps the values out of
the browser bundle even though Netlify applies them to all scopes in that
context.

To end collection, first set `MMQ_FORMAL_COLLECTION_OPEN=false`, trigger a new
production deploy, wait for it to become Ready, and verify that both allocation
endpoints return `423 COLLECTION_CLOSED`. Only then close the database
schedule. Environment changes do not update an already deployed Function. This
external gate keeps an intentional shutdown distinguishable from a database
outage and prevents the client from treating closure as a reason for emergency
randomization.

## Batch audit and restricted backup

After each release batch, connect to the production database locally and run:

```text
npm run randomization:export-ledger
```

The ignored output directory contains:

- `randomization-summary.json`: assigned format/method totals, remaining
  scheduled positions, fallback proportion, longest fallback run, and alert;
- `randomization-assignments.csv`: the restricted assignment ledger, including
  private block positions and token HMACs;
- `randomization-sessions.csv`: every issued session, suitable for joining to
  Netlify Forms on `session_id`, `allocation_id`, or `participant_id`.

This database records **assigned/started identities, not submitted
questionnaires**. Never report its counts as completed responses. Download the
Netlify Forms export separately and join locally before calculating completion
or attrition by format.

Emergency-randomization review is required when its effective proportion
exceeds 1%, or when three emergency allocations occur consecutively. A current
participant may finish, but the next distribution batch should pause.

The current page may finish if a browser refuses local-storage writes, but a
refresh can then create a new browser token and assignment. Treat this as the
same residual duplicate risk as cleared storage, private browsing, or a device
change, and review it through the restricted ledger rather than assuming that
browser identity is infallible.

## Development and verification

`npm run test:randomization` checks schedule construction, concealment of the
public metadata, API/error contracts, fallback reconciliation, ledger
summaries, and the required transaction/advisory-lock SQL. A real isolated
Netlify Database branch is still required for the final 100-request concurrency
test; unit tests do not substitute for that deployment check.

The destructive preview verifier refuses production URLs and requires an
explicit acknowledgement because it consumes real positions in the isolated
preview ledger:

```text
npm run randomization:verify-preview -- \
  --base-url https://deploy-preview-N--site-name.netlify.app \
  --same-token 100 \
  --unique-tokens 100 \
  --confirm-consumes-preview-slots
```
