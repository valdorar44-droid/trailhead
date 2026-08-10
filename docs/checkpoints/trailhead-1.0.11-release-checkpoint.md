# Trailhead 1.0.11 paired release checkpoint

## Release freeze baseline — 2026-07-31

- Release branch: `release/trailhead-1.0.11`.
- Accepted product baseline: `bd9a1fbe338491e7ca9910db63cf2fd9071f8f6f`, including accepted Trails implementation `c9c81988d14096697eddaf95204eab6e64078b54`.
- Apple public version reported by the product owner: `1.0.10`.
- Android public version reported by the product owner: `1.0.6`; Android may advance directly to `1.0.11`.
- Authorized build budget: exactly one Android production AAB and one iOS production IPA from one immutable SHA.
- Marketing version normalized to `1.0.11`.
- Android runtime: `native-1.0.11-android.1`.
- iOS runtime: `native-1.0.11-ios.1`.
- EAS remotely manages the actual Android version code and iOS build number; do not assume local values.
- Protected Explore serving-index SHA-256 at release fork: `7e59e5e2273dbbe1a26d7bbd4d947faa20935c51fb79c464eed8a17babf4d8f4`.
- Protected App Store copy SHA-256 at release fork: `aaad7e9ced46e5931bda0c50a82cc66c331bcee5dd5ea8c8a24641e617a24a86`.
- `.cursor/`, the protected files above, uncommitted NPS candidate tooling, Valhalla work, and unrelated Android helper changes are absent from this clean release worktree.

## Accepted Trails preview evidence

- Android accepted preview update `019fb92d-a890-7a24-848c-a73efac5fc7f`, runtime `native-1.0.10-android.7`.
- iOS paired preview update `019fb92d-a890-7de3-9aa7-71fb909cc8af`, runtime `native-1.0.10-ios.6`.
- Final Android Full -> 3D -> Back evidence: `C:\Users\User\Documents\Codex\trailhead-evidence\trail-back-full-c9c8198.png`, SHA-256 `5bd9066fc51e02f90686e522b02fb6de04355d8f7bb5a81bb1abc9848743afb4`.
- Open accepted-source P0/P1: none.

## Release gate and next action

1. Commit only the coordinated version/runtime/config assertion changes and this checkpoint.
2. Run the native/config, privacy/copy, TypeScript, Android compile/unit, and protected pre-preview gates once from the committed release source.
3. Tag the resulting clean immutable SHA.
4. Start exactly one Android `production` build and one iOS `production` build from that same SHA.
5. Record actual EAS build IDs, build numbers, source SHA, runtimes, artifact URLs and hashes. Do not submit or publish a production OTA until the binaries are available and checked.

## Do not repeat

- Do not repeat completed Trails, Memory, Layers, Yellowstone, NPS rabbit-hole, Originals lifecycle, Android Auto, Store screenshot, or broad Map/sheet crawls before built-candidate smoke testing.
- Do not backport native-dependent Trails code to older production runtimes.
- Do not add NPS/USFS/BLM candidate data to this release commit.
- Do not spend an extra native build if either platform fails; checkpoint the failure before any rebuild decision.
