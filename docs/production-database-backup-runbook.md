# Production Database Backup

Run a verified SQLite backup before a schema-bearing backend release and before
enabling a new write-path feature flag.

## Create And Verify

From the linked Railway project:

```bash
railway ssh -- python scripts/backup_sqlite.py \
  --source /data/trailhead.db \
  --output-dir /data/backups \
  --keep 14
```

The command uses SQLite's online backup API, runs `PRAGMA integrity_check`, and
writes a SHA-256 manifest beside the backup. A successful result must report
`"integrity_check": "ok"`, a nonzero byte count, and a nonzero table count.

List the retained backup and manifest before continuing:

```bash
railway ssh -- ls -lh /data/backups
```

Record the backup filename and hash in the release checkpoint. Do not promote a
schema-bearing release when backup creation or verification fails.

## Restore Drill

Use a non-production Railway service first. Stop application writes, copy the
selected backup to that service's configured `TRAILHEAD_DB_PATH`, start the
service, and run the backend contract suite plus an authenticated trip/library
smoke test. A production restore requires a maintenance window and a fresh
pre-restore backup; never replace the live database while the app is writing.
