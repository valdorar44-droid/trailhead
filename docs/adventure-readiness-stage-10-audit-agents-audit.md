# Stage 10 Audit Agents Audit

Date: 2026-06-18

## Checkpoint

Stage 10 adds lightweight Codex prompt files for repeatable self-audits during Trailhead development.

## Added Agents

- `.agents/product-polish-agent.md`
- `.agents/map-performance-agent.md`
- `.agents/data-trust-agent.md`
- `.agents/community-safety-agent.md`
- `.agents/car-platform-agent.md`

## Coverage

- Product polish: text density, source/freshness, dead ends, touch targets, route-aware next steps.
- Map performance: render thrash, repeated API calls, marker volume, style reloads, memory pressure.
- Data trust: source, license, prohibited providers, AI claims, freshness, confidence.
- Community safety: spam, PII, home-location privacy, photo moderation, sensitive locations.
- Car platform: CarPlay entitlement, Android Auto manifest, driver distraction, Mapbox billing, hardware tests.

## Validation

- `python3 scripts/qa_audit_agents_matrix.py`
- `git diff --check`

## Notes

These are repo prompt files, not global agent installation. They are intentionally small so they can be pasted into future Codex work, attached to PR review, or used as subagent instructions without hiding requirements in memory.
