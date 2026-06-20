# TrailHead Emergency Backup

Backup branch for continuing work if the local WSL laptop environment is unavailable.

Source repo: `https://github.com/valdorar44-droid/trailhead`

Source commit: `b1e2182`

Archive:

- `trailhead-local-explore-cache-b1e2182-20260619.tgz`

SHA-256:

```text
9d21625d69a41f0a75b14fe0576910bb809c3b14da706f0fe3534651b9a9cae4
```

## Restore

From a fresh clone of `master`:

```bash
git clone https://github.com/valdorar44-droid/trailhead.git
cd trailhead
git fetch origin emergency-backup/b1e2182-20260619
git show origin/emergency-backup/b1e2182-20260619:trailhead-local-explore-cache-b1e2182-20260619.tgz > /tmp/trailhead-local-explore-cache-b1e2182-20260619.tgz
tar -xzf /tmp/trailhead-local-explore-cache-b1e2182-20260619.tgz
python3 scripts/qa_explore_catalog_matrix.py
```

This backup intentionally excludes secrets, API keys, auth tokens, `node_modules`, and virtual environments.

