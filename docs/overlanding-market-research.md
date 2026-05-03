# Overlanding App Research Notes

Date: 2026-05-01

## What Users Say They Want

- Offline data they can trust before the trip. Users complain when apps require many small map blocks, surprise authentication, or fail in weak service.
- A single route-corridor download. A recurring wishlist item is "download high resolution maps around my planned route" instead of manually drawing dozens of boxes.
- Clear separation between map display and navigation. In off-road communities, turn-by-turn routing is viewed as useful but not fully trustworthy; users still want to read the map, see the route, and know bailout options.
- Public land and legal camp confidence. Land ownership, BLM/USFS/NPS context, dispersed camping, and private-land boundaries are core buying reasons.
- Curated trail context. Difficulty, vehicle suitability, seasonal closures, photos, obstacles, and recent trail reports are more valuable than raw lines on a map.
- Practical POIs close to the route. Camps, gas, water, trailheads, viewpoints, hot springs, showers, and resupply towns matter most when they are not far off-route.
- In-dash support matters, but phone/tablet map quality still drives trust. Users often run multiple devices because CarPlay/Android Auto experiences can be limited.

## What Competitors Do Well

- onX Offroad markets confidence: offline maps, route builder, trail difficulty, vehicle filters, public/private land, dispersed camping, cell coverage, wildfire maps, trail reports, CarPlay/Android Auto, and 500k+ recreation points.
- Gaia is valued for large offline layer flexibility and broad map layers, but users complain about product stagnation, pricing, login prompts, and layer changes.
- Trails Offroad wins on expert-curated trail guides, difficulty ratings, route details, camping insights, and a focused off-road audience.
- iOverlander-style products are trusted for community camp/POI coverage, but data quality depends heavily on reports and moderation.

## Gaps Trailhead Can Exploit

- "Offline readiness" should be provable: show map file, routing graph, trip corridor, route cache, and last verified date separately.
- AI should not invent camps. It should plan intent, then verified data should fill camps, gas, water, and POIs along the route.
- Long offline routing is now a differentiator because full-state Valhalla packs are available. The UI must make it obvious that route packs are separate from map tiles.
- Field reports can become the trust layer competitors struggle with: closures, washouts, full camps, water availability, law enforcement, fire restrictions, and snow/mud.
- Trip recovery matters. Exiting a trip should never feel destructive; downloaded/saved trips should be easy to reopen.

## Product Questions To Keep Asking

- Can a user prove the app works in airplane mode before leaving home?
- Can they download exactly what they need for a multi-day route without drawing boxes manually?
- Does every generated camp/fuel/POI have a source, route distance, and reason it was included?
- Does the app help when routing is wrong, or does it overpromise?
- Can a solo driver safely operate the nav UI while bouncing on a dirt road?
- Can a reviewer understand subscriptions without live metadata delays causing a dead paywall?

## Update Decisions From This Research

- Add an offline state readiness panel that shows map vs routing status separately and downloads missing pieces together.
- Use exact routing pack fallback sizes now that all 50 state packs are extracted.
- Tighten route enrichment so camps are closer to the route, fuel is labeled as on-route/short-detour, and hot springs are first-class route POIs.
- Tighten AI instructions so it chooses geocodeable route anchors, avoids invented camps, respects detour limits, and does not overpromise off-road turn-by-turn.
