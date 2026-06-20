# TrailHead Emergency Work Continuity

Date: 2026-06-19

## Current Safe Source State

- Main repo: `https://github.com/valdorar44-droid/trailhead`
- Main branch commit at backup time: `b1e2182`
- Working tree was clean before the emergency backup note was added.

## Local Cache Backup

The ignored local Explore enrichment cache was backed up to a GitHub branch:

- Branch: `emergency-backup/b1e2182-20260619`
- Branch commit: `f5bf8819671d89ebeff30c9629b60120359db099`
- Archive: `trailhead-local-explore-cache-b1e2182-20260619.tgz`
- Archive size: about 16 MB
- SHA-256: `9d21625d69a41f0a75b14fe0576910bb809c3b14da706f0fe3534651b9a9cae4`

The archive includes:

- `data/explore/source_cache/`
- `data/explore/imports/`
- `data/explore/nps_enrichment_state.json`
- `dashboard/explore_catalog_v3.json`
- `dashboard/explore_source_records_sample.jsonl`
- `dashboard/explore_trail_geometries_v1.json`

The archive intentionally excludes secrets, API keys, auth tokens, `node_modules`, and virtual environments.

## Restore From Fresh Clone

```bash
git clone https://github.com/valdorar44-droid/trailhead.git
cd trailhead
git fetch origin emergency-backup/b1e2182-20260619
git show origin/emergency-backup/b1e2182-20260619:trailhead-local-explore-cache-b1e2182-20260619.tgz > /tmp/trailhead-local-explore-cache-b1e2182-20260619.tgz
sha256sum /tmp/trailhead-local-explore-cache-b1e2182-20260619.tgz
tar -xzf /tmp/trailhead-local-explore-cache-b1e2182-20260619.tgz
python3 scripts/qa_explore_catalog_matrix.py
```

Expected SHA-256:

```text
9d21625d69a41f0a75b14fe0576910bb809c3b14da706f0fe3534651b9a9cae4
```

## Phone / Cloud Continuation

The closest phone-friendly replacement for this WSL setup is a cloud Linux dev box accessed from the phone:

1. GitHub Codespaces or another browser IDE for quick continuation.
2. A small Ubuntu VPS or cloud workstation for a more WSL-like terminal.
3. SSH into that box from iPhone/Android using Termius, Blink Shell, JuiceSSH, or another SSH app.
4. Clone the repo, restore the cache archive, then install project dependencies.
5. Use Railway CLI for backend deploys and EAS CLI for mobile OTA updates after logging in.

For heavy work, use the phone as the terminal screen into the cloud Linux machine. Avoid trying to build the app directly on the phone.
