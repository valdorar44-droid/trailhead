# Trailhead Originals V1 pattern notes

Reviewed in Mobbin on 2026-07-16. These are interaction references, not visual templates. No Mobbin screenshots or branded assets are stored in this repository.

## Fixed Trailhead direction

- Use Trailhead's clean white, true black, silver, and orange system.
- Do not use green as the Originals accent.
- Do not add AI labels, sparkles, or generated-content framing.
- Keep Explore, Trailhead Originals, and Viator guided tours visibly separate.
- During a drive, prioritize glanceable status and large controls over supporting context.

## Reference patterns and decisions

| Area | Pattern observed | Trailhead decision |
| --- | --- | --- |
| Tour structure | [Google Arts & Culture talking tours](https://mobbin.com/flows/e44fa2e8-f0a8-4be2-b027-61b669213dca) treats the tour as an ordered story sequence with a clear entry point. | Show route, story count, duration, access, and one preview on the Original detail. Keep the complete transcript and narration inside the acquired bundle. |
| Route acquisition | [Strava route download](https://mobbin.com/flows/08e86cae-9d63-4aa1-9597-25969e2fc2a7) keeps download attached to the route and confirms offline readiness. | One Download Original action owns manifest, route, narration, transcripts, artwork, and the map region. Confirm verified readiness rather than merely reporting transfer completion. |
| Download progress | [Google Maps offline progress](https://mobbin.com/screens/56b5795f-556c-446b-9f30-f415d3dcc594) gives explicit progress and network behavior. [Apple Maps region download](https://mobbin.com/screens/1ea97074-a32f-41d9-890f-3082c9a022b4) previews the exact region and size. | Show component-level progress, total size, map bounds, Wi-Fi behavior, storage failure, retry, and resume. Preserve the last verified version until its replacement is complete. |
| Driving hierarchy | [Apple Maps active navigation](https://mobbin.com/screens/49ff9c63-a766-4214-a0bb-ea1486dfc2e0) keeps the next cue dominant and secondary trip status anchored. | Keep the next story, route progress, and GPS/off-route status above supporting controls. Narration never competes with navigation or hazard prompts. |
| Driving controls | [Tesla Robotaxi trip playback](https://mobbin.com/screens/9a7ec56d-2669-43b3-a4e4-8b6daa2a58e6) separates route status from a compact media row. | Use a large central pause/resume action with replay, skip, mute, captions, and Stories as secondary controls. Do not add commercial or discovery interruptions during a session. |
| Permission education | [Upside's location pre-prompt](https://mobbin.com/screens/1409167e-9e2a-4019-b05b-b90766d59910) explains the immediate benefit before the OS prompt. [Waze's settings recovery](https://mobbin.com/screens/9c8ae6b0-fc68-45ba-9044-ace148ac85bb) gives a direct recovery action. | Ask only from Start Tour, state what location enables, explain background use in plain language, and provide Settings recovery. Do not request passive always-on monitoring. |
| Long-form audio | [Apple Podcasts playback](https://mobbin.com/screens/416723d1-24a7-4c15-b7c3-fb21d53d44ae) and [Amazon Music playback](https://mobbin.com/screens/8467e14b-bf62-4e46-8274-0f2193ba07b5) make pause and short replay the primary actions while retaining progress. | Persist exact playback position, expose captions, support lock-screen pause/replay, and never auto-resume user-paused audio. Navigation interruptions resume at the saved position. |
| Recovery | [Waymo offline recovery](https://mobbin.com/screens/66ee96c8-a0e3-401b-a8d2-d7c80dbdaae7) uses a single explicit retry without hiding the state. | Keep interrupted downloads and paused tours durable, explain the specific blocker, and offer Retry or Resume in place. A network error must not erase verified offline content. |

## V1 guardrails

- Mobbin references informed hierarchy, state clarity, and recovery only.
- Trailhead typography, spacing, color, map treatment, copy, components, and branding remain original.
- Screenshots are intentionally not copied into source control or Figma deliverables.
