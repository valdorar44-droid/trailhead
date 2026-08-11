# Foothills Parkway review sheet v1

Status: **review only - explicit decisions required**

This sheet contains the exact 13 source-locked scripts and two candidate-only artwork originals. Checking a box records review intent only; it does not sanitize or ingest artwork, authorize narration, create a manifest, upload anything, or publish.

## Product boundary

- One premium four-chapter bundle: Mountain Crossing; Little River / Cades Cove; Roaring Fork; Foothills Parkway
- Permanent price: 900 earned credits
- Explorer access: included
- Standalone Roaring Fork or Foothills product: not approved
- Other chapters approved by this sheet: no

## Artwork candidates

### Artwork 1: media_fp_panorama

Decision: [ ] Approve exact candidate  [ ] Revise: ____________________

- Subject: Exact Foothills Parkway ridge panorama
- Intended use: chapter_artwork
- Creator: Andrea Walton (NPS)
- Rights: Public domain (public_domain_us_government_work)
- Required commercial notice: `No claim to original U.S. Government works.`
- Exact credit: Foothills Parkway, October 2018, Andrea Walton, Great Smoky Mountains National Park (NPS), public domain
- Identity basis: NPS photograph of the Foothills Parkway matching the exact ridge-panorama slot
- Source asset: https://upload.wikimedia.org/wikipedia/commons/2/2a/Foothills_Parkway%2C_October_2018--Andrea_Walton_%2843968388000%29.jpg
- License record: https://commons.wikimedia.org/wiki/File:Foothills_Parkway,_October_2018--Andrea_Walton_(43968388000).jpg
- Dimensions: 4032 x 3024
- Bytes: 2067676
- SHA-256: `92da599e63f7f2afabd81106d6649441b11b5406e7c94ec3ba448c643e6f19d8`
- Local evidence locator: `smokies_media_s2:media_fp_panorama`
- Local hash verified at packet build: true
- EXIF caveat: Original contains GPS coordinates plus Apple iPhone 7/device metadata; a separately hashed sanitized derivative is required before any later ingestion consideration.
- Gate: candidate only; visual approval false; sanitation, ingestion, rendering, upload, and publication all false

### Artwork 2: media_fp_engineering

Decision: [ ] Approve exact candidate  [ ] Revise: ____________________

- Subject: Exact Missing Link bridge or construction scene
- Intended use: story_artwork
- Creator: Federal Highway Administration
- Rights: Public domain (public_domain_us_government_work)
- Required commercial notice: `No claim to original U.S. Government works.`
- Exact credit: Foothills Parkway Bridge number 2, Great Smoky Mountains National Park, Federal Highway Administration (FHWA), public domain
- Identity basis: FHWA photograph of Foothills Parkway Bridge number 2 matching the exact Missing Link engineering slot
- Source asset: https://upload.wikimedia.org/wikipedia/commons/5/58/Foothills_Parkway_Bridge_number_2_in_Great_Smoky_Mountains_National_Park_in_Tennessee_%2820133297129%29.jpg
- License record: https://commons.wikimedia.org/wiki/File:Foothills_Parkway_Bridge_number_2_in_Great_Smoky_Mountains_National_Park_in_Tennessee_(20133297129).jpg
- Dimensions: 4320 x 3240
- Bytes: 1650379
- SHA-256: `ed4f3bc69b7fd0f34040e3214a1633f410327c0deb3c0c04412d861760de78af`
- Local evidence locator: `smokies_media_s2:media_fp_engineering`
- Local hash verified at packet build: true
- EXIF caveat: Original has no GPS IFD but retains Canon device/date metadata; a separately hashed sanitized derivative is required before any later ingestion consideration.
- Gate: candidate only; visual approval false; sanitation, ingestion, rendering, upload, and publication all false

## Script review

### Script 1: A parkway made for the view (`fp_story_01`, story)

Decision: [ ] Approve exact script  [ ] Revise: ____________________

Claims: `fp_scenic_corridor`

Sources:

- [Foothills Parkway](https://www.nps.gov/places/foothills-parkway.htm) (`nps_grsm_foothills`)

Exact transcript:

Look beyond the guardrail and the road seems to float along the lower ridges. The high wall of the Smokies holds the horizon, while folds of wooded country fall away toward the Tennessee Valley. That view is not a lucky side effect of getting from one town to another. It is the reason this road exists.

Congress authorized Foothills Parkway in 1944 as a scenic parkway along the Tennessee side of Great Smoky Mountains National Park. The plan called for a long corridor following the foothills rather than cutting straight across them. From here, the main range stays in view for mile after mile. The road repeatedly turns toward an overlook, slips back into the trees, and then opens another window across the mountains.

A parkway is a particular kind of road. Its job is not simply to shorten a trip. It shapes the trip itself. Curves, grades, overlooks, and the land beside the pavement are treated as one experience. Here, the destination is not only at the end of the road. It is present in every opening between the trees and in the changing relationship between the lower ridges and the main range beyond them.

That rhythm matters. A long, uninterrupted panorama can become background, but the parkway makes the forest act like a curtain. Enclosed stretches quiet the view. Then a turn opens the landscape again, and the distance feels newly discovered. Overlooks give the eye time to stop moving even when the journey continues. The road does not need a sign at every curve to interpret the mountains; its alignment performs much of that work. Even the pauses between views are part of that rhythm.

The full authorized corridor stretches for seventy-two miles, yet it was never completed as one continuous highway. Portions opened at different times, and unfinished sections remain part of its story. That interrupted history makes the finished pavement feel less like an ordinary state route and more like a sequence of carefully placed balconies. Each completed section reveals a different relationship between the foothills and the national park beyond them.

Notice the layers in the view. The near slopes have individual trees and folds you can follow with your eye. Farther away, details merge into blue and gray bands. The highest ridges form the park's distant edge. The road keeps rearranging those layers as it turns, making the mountains seem to advance, retreat, and overlap.

That was the central promise of Foothills Parkway: not a shortcut through the Smokies, but a road built to help people see them. Whenever the landscape opens, watch how the pavement aims your attention outward. The engineered curve beneath you and the broad landscape beyond it are parts of the same design.

Transcript SHA-256: `48769cc73c2984673775b3bf96f714c7577152aa383c0c4162cb155187f8fbf2`

### Script 2: The unfinished road (`fp_story_02`, story)

Decision: [ ] Approve exact script  [ ] Revise: ____________________

Claims: `fp_long_build`

Sources:

- [Foothills Parkway](https://www.nps.gov/places/foothills-parkway.htm) (`nps_grsm_foothills`)
- [Foothills Parkway design and technical studies](https://www.nps.gov/grsm/learn/news/national-park-service-plans-to-complete-additional-design-work-and-technical-studies-for-foothills-parkway-section-8d.htm) (`nps_grsm_foothills_history`)

Exact transcript:

A finished lane can hide a complicated history. The pavement here is smooth, the shoulders are settled, and the road seems inevitable. On a map, however, Foothills Parkway is a chain of completed sections separated by gaps. That broken line records nearly a century of ambition, engineering, funding, and difficult terrain.

The idea of a scenic road beside Great Smoky Mountains National Park began in the 1930s. Federal legislation authorized the parkway in 1944, and construction started in the 1950s with the Gatlinburg Spur. The vision was large: a seventy-two-mile corridor across the Tennessee foothills. Work did not move steadily from one end to the other. Different sections advanced at different times, while other pieces waited.

The reasons become visible as you travel. These foothills are not a flat shelf beneath the main range. Ridges rise and fall, ravines cut across the proposed line, and unstable slopes can turn a short distance on a map into a major construction problem. Funding also arrived in starts and stops. A segment might be graded or partly built, then remain unfinished while plans, money, and engineering caught up.

An unfinished road also changes how communities encounter it. One completed portion may function as a local scenic drive while another ends miles away. A graded corridor can exist without serving through traffic. When a gap finally closes, two familiar dead ends become one new journey. The map changes in a moment, but the physical connection represents years of surveys, design choices, contracts, and work on the mountain.

That history is why the parkway should not be read only as a project that took too long. It is also a record of changing expectations. Building a scenic road through steep land requires more than laying pavement. Engineers must decide how a road will sit on the mountain, how water will move around it, and how a structure can cross broken ground without erasing the very landscape people came to see. Public review and environmental study have become a larger part of those decisions over time.

In 2024, the National Park Service announced more design work and technical studies for another proposed section between Wears Valley and the Spur. No completion schedule was established. That is an operational decision for the future, separate from the story you are hearing now, but it shows that the authorized corridor remains unfinished and still under consideration.

As you pass a junction or the end of a completed section, imagine the parkway as layers of time rather than a single ribbon. Some pavement dates to the middle of the twentieth century. Other stretches arrived decades later. Between them are plans that were revised, paused, or never built. The open road in front of you is the visible part of a much longer story—one measured not only in miles, but in generations of work.

Transcript SHA-256: `36d1b5f218ad0dc0a7fe05827a40e4d7bbadbd85814ae503513b0f4efa987a01`

### Script 3: Bridging the Missing Link (`fp_story_03`, story)

Decision: [ ] Approve exact script  [ ] Revise: ____________________

Claims: `fp_missing_link`

Sources:

- [Foothills Parkway Missing Link bridge construction](https://www.nps.gov/grsm/learn/news/fhp-contract-award.htm) (`nps_grsm_missing_link_bridge`)

Exact transcript:

Watch as the road leaves solid ground and sweeps across the slope. For a moment, the parkway is no longer resting on the mountain. It is being carried through open air. The bridge curves rather than crossing in a straight line, and the tall supports below it disappear into steep wooded ravines.

This is part of the section long known as the Missing Link, a short but exceptionally difficult gap between Walland and Wears Valley. Construction had advanced from both directions, yet broken terrain kept the two sides apart. The distance on a map was modest. The engineering problem was not.

One of the key structures is Bridge Number Two. The National Park Service described it as an eight-hundred-foot elevated roadway forming a serpentine curve. Four piers, some reaching as high as one hundred feet, support the bridge as it crosses two ravines on the south slope of Chilhowee Mountain. When the construction contract was announced in 2009, this was the longest single bridge required to complete the gap.

The curve is the important part to notice. A straight bridge could connect two points, but this road also had to follow the parkway's alignment and sit within a scenic mountain landscape. The structure bends with the route while lifting it above ground that would have been difficult to cut, fill, and stabilize. Instead of forcing the ravines to become a roadbed, the bridge spans them.

That solution demanded a different view of the landscape. The slopes below are not empty space. They carry water, soil, trees, and the shape of the mountain itself. Piers concentrate the bridge's support at selected points, leaving much of the ground between them open. From the roadway, most of that work is easy to miss. You feel a gentle curve and see a broad view. Underneath, loads move from the deck into the piers and down to carefully engineered foundations.

Construction itself unfolded in stages. A major bridge could advance while other structures and approaches were being designed or built from the opposite side. The contract for Bridge Number Two formed one part of a wider effort extending east from Walland and west from Wears Valley. The visible structure was a milestone, not the entire solution.

That is worth remembering as the roadway carries you across the ravines today. The completed experience compresses years of separate decisions into a few quiet seconds. Design, piers, deck, approaches, and pavement now read as one curve because each part was made to meet the next.

As the tires return to ground, notice how quietly the bridge does its job. It crosses two ravines, holds a long curve high on the slope, and preserves the experience of a road moving with the mountain. The biggest engineering on Foothills Parkway is often the part designed to feel almost effortless from the passenger seat.

Transcript SHA-256: `fadd566208b133389f9005345337b39d12d8de1f195f2cbbe81b6159295cd6fd`

### Script 4: Reading the ridgelines (`fp_story_04`, story)

Decision: [ ] Approve exact script  [ ] Revise: ____________________

Claims: `fp_geologic_view`

Sources:

- [Geology](https://www.nps.gov/grsm/learn/nature/geology.htm) (`nps_grsm_geology`)

Exact transcript:

The ridges ahead look soft from a distance—blue folds stacked one behind another—but their story begins with rock, pressure, and an almost unimaginable span of time. The view from Foothills Parkway lets you see the result at landscape scale. Near ridges stand dark and detailed. Farther ridges fade toward the horizon, each one marking another resistant fold of the mountains.

Most rocks in Great Smoky Mountains National Park began as sediment. Between roughly eight hundred and five hundred forty-five million years ago, clay, silt, sand, and pebbles washed from ancient highlands into low basins along the edge of North America. Layer after layer accumulated. Those deposits were eventually cemented into more than nine miles of rock now grouped under the name Ocoee Supergroup.

The layers did not remain flat. Between about three hundred ten and two hundred forty-five million years ago, the tectonic plates carrying North America and Africa collided as the supercontinent Pangaea formed. Heat and pressure changed the sedimentary rocks. Sandstone recrystallized into harder metasandstone or quartzite. Shale became slate. Huge masses of older rock moved along faults and were pushed over younger layers. The Appalachian chain rose on a continental scale.

The mountains created by those collisions were probably far higher than the Smokies you see today. Their present shape is the work of erosion. Water, ice, wind, and gravity kept removing material, carving valleys and carrying sediment away. Harder rock resisted that wearing more effectively, so resistant layers remained as high ridges while weaker material disappeared more quickly. The skyline is therefore not simply where mountains rose. It is also where certain rocks endured.

The park contains about twenty named rock formations, so the range is not made from one material wearing down at one rate. Metamorphosed sandstone, siltstone, and shale dominate much of the landscape. Their different resistance helps produce ledges, channels, peaks, and valleys. The green cover softens those boundaries, but it does not erase them.

Look at the long profile ahead. Peaks do not form one clean wall. Ridges overlap because streams have cut through the uplifted mass from many directions. Every valley gives water another route downhill, and every spur is a remnant between drainage systems. From this distance, vegetation hides most individual rock surfaces, but the underlying geology still controls the broad shape.

The process continues. National Park Service geologists estimate that these mountains are being eroded by about two inches every thousand years. That is too slow to see during one drive, yet over millions of years it is enough to turn towering highlands into the layered horizon in front of you.

So when the next overlook opens, read the view in two directions through time. The folded and metamorphosed rocks record ancient continental collisions. The valleys and rounded ridges record everything that happened afterward. Foothills Parkway gives you a seat between those stories, moving across a landscape that is still being shaped one grain at a time.

Transcript SHA-256: `0549301d81d4f9b17da862147e940782bfdd66d6871677b568a2e4cae7af814c`

### Script 5: A forest mosaic from above (`fp_story_05`, story)

Decision: [ ] Approve exact script  [ ] Revise: ____________________

Claims: `fp_forest_mosaic`

Sources:

- [Park Statistics](https://www.nps.gov/grsm/learn/management/statistics.htm) (`nps_grsm_statistics`)
- [Vegetation Types](https://www.nps.gov/grsm/learn/nature/vegetation-types.htm) (`nps_grsm_vegetation`)

Exact transcript:

From a moving car, the mountains can look like one continuous blanket of green. Slow your eye down and the blanket begins to break into pieces. A sunny slope may look lighter and more open. A shaded fold may hold taller, darker trees. High ridges can carry a different texture from the valleys below. What looks uniform from a distance is actually a forest mosaic.

National Park Service scientists describe plant communities as groups of species that share similar living conditions. The trees in the canopy are only the most visible layer. Under them are shrubs, wildflowers, mosses, fungi, insects, birds, and mammals using different combinations of food, moisture, shelter, and temperature. Change the conditions, and the community changes with them.

Two of the strongest controls in the Smokies are elevation and aspect. Elevation affects temperature, rainfall, cloud exposure, and the length of the growing season. Aspect is the direction a slope faces. A south-facing slope receives sunlight differently from a north-facing one, which can alter warmth and moisture even when the two slopes are close together. A ridge and its shaded backside may therefore support noticeably different vegetation.

The park identifies eight major forest types covering ninety-six percent of its area: spruce-fir, northern hardwood, cove hardwood, hemlock, oak-hickory, pine-oak, montane alluvial, and successional forest. The remaining ground includes meadows, rock outcrops, heath balds, and grassy balds. Those names are scientific categories, but from the parkway they become visible as texture, color, and density across the land.

Each community also creates habitat for other forms of life. Leaves, bark, roots, wood, nectar, fruit, and seeds become food or shelter for organisms adapted to use them. The forest floor, understory, and canopy are connected layers, not separate scenery. A shift in the dominant plants changes opportunities for insects, birds, mammals, and fungi as well.

Lower, drier slopes often appear different from cool coves where water and rich soil collect. High-elevation forests face stronger wind, colder temperatures, and frequent cloud. Along streams, trees and plants respond to moving water and floodplain soils. Historic clearing created another set of conditions; when fields and disturbed areas returned to woodland, successional forests recorded that recovery.

These communities do more than fill the view. Forests store carbon, cycle nutrients, filter air and water, reduce erosion, and provide habitat. A change in one layer can affect many others. Park scientists map vegetation and maintain long-term monitoring plots because the mosaic is not fixed. Storms, insects, disease, fire, climate, and human history all continue to rearrange it.

At the next opening, choose two slopes and compare them. Notice which one faces the light, which one drops into a damp hollow, and where the color or canopy texture changes. You are not looking at one forest repeated across every ridge. You are looking at many communities fitted to the folds of the mountains, each responding to the particular place where it grows.

Transcript SHA-256: `e6d89f51c14c3333e867e0cb204b78597d93123c12f3fd9a62fcccbe2bdc1795`

### Script 6: What the view says about the air (`fp_story_06`, story)

Decision: [ ] Approve exact script  [ ] Revise: ____________________

Claims: `fp_air_monitoring`

Sources:

- [Air Quality](https://www.nps.gov/grsm/learn/nature/air-quality.htm) (`nps_grsm_air_quality`)

Exact transcript:

The same overlook can show a completely different mountain range from one day to the next. On a clear day, distant ridges hold their shape and color. On another day, they dissolve into a pale veil. Some of that softness is natural cloud and moisture—the mist that helped give the Smokies their name. Some is human-made haze. A single glance cannot measure the difference, which is why the park monitors the air.

Look Rock is both a viewing place and an air-quality monitoring location. Instruments there help researchers track what is moving through the atmosphere above the foothills. Monitoring matters because visibility is not only about whether the sky looks attractive. The same pollutants that scatter light can affect human health, plants, soils, and high-elevation streams.

The National Park Service describes pollution haze as a more uniform whitish layer than the natural, mist-like clouds that form around the mountains. Tiny airborne particles scatter light, washing out color and hiding distant features. Much of the pollution arrives from outside the park. Winds carry emissions from power plants, industry, and vehicles toward the southern Appalachians, where mountain terrain and weather patterns can concentrate them.

The value of a monitoring station is repetition. One view may be memorable, but a long series of observations can show how visibility and pollution change across seasons and years. Researchers can compare what people see from an overlook with measured conditions, then study how regional emissions and weather influence the park. A long record turns a shifting panorama into evidence.

Visibility is only the most immediate signal. Ground-level ozone can irritate human lungs and injure plant leaves. Sulfur and nitrogen pollution can arrive in rain, dry particles, and cloud water, altering soils and streams. At high elevations, clouds can place vegetation directly inside acidic moisture. The forested ridge in the distance and the chemistry of the air between you are therefore part of the same system.

This is why it is better to describe today's view carefully rather than declare the air good or bad from appearance alone. Weather, humidity, natural mist, smoke, and pollution can overlap. Current readings and official advisories provide the evidence for current conditions; this story provides the context for understanding why those readings matter. The mountains make that shared atmosphere visible.

As the panorama opens again, see how the atmosphere creates depth. Near ridges are dark. Distant ridges grow lighter and bluer as more air lies between you and them. On a clear day, that effect makes the range seem endless. When the far ridges disappear, the missing detail is information too. Look Rock turns that changing view into a long-term record of the air shared by the park and the communities around it.

Transcript SHA-256: `2e64c4e31f03ebe54007f06749210b95e8b2f034a33b5d151537332241cf60e3`

### Script 7: Parkway orientation (`fp_cue_01`, cue)

Decision: [ ] Approve exact script  [ ] Revise: ____________________

Claims: `fp_scenic_corridor`

Sources:

- [Foothills Parkway](https://www.nps.gov/places/foothills-parkway.htm) (`nps_grsm_foothills`)

Exact transcript:

You are entering Foothills Parkway at Chilhowee Lake, traveling east toward Wears Valley. This chapter stays on the Tennessee side of the Smokies and follows the ridge road rather than crossing the national park. Let ordinary navigation handle each turn. The stories ahead stay with the view: the parkway's long construction, the mountains beneath it, the forest across them, and the air between each ridge.

East-to-west override (`east_to_west`):

You are entering Foothills Parkway at Wears Valley, traveling west toward Chilhowee Lake. This chapter stays on the Tennessee side of the Smokies and follows the ridge road rather than crossing the national park. Let ordinary navigation handle each turn. The stories ahead stay with the view: the parkway's long construction, the mountains beneath it, the forest across them, and the air between each ridge.

Transcript SHA-256: `39eb2bfecfa2851aa19b32167adb7029c13182258cbe630a08328c5d7ef61c4d`

### Script 8: A long view (`fp_cue_02`, cue)

Decision: [ ] Approve exact script  [ ] Revise: ____________________

Claims: `fp_geologic_view`

Sources:

- [Geology](https://www.nps.gov/grsm/learn/nature/geology.htm) (`nps_grsm_geology`)

Exact transcript:

The trees are opening to the first long view. Notice how the ridges stack instead of forming one wall. Their rocks were folded and altered during ancient continental collisions, then cut into separate spurs and valleys by erosion. Near ridges keep their detail; distant ones fade through layers of atmosphere. The longer geology story will return to that horizon.

Transcript SHA-256: `50cc89fa960f2896f4897ea1256388845ebc4e191c2a28b0e9c5bcf6d133b4f1`

### Script 9: Look Rock (`fp_cue_03`, cue)

Decision: [ ] Approve exact script  [ ] Revise: ____________________

Claims: `fp_air_monitoring`

Sources:

- [Air Quality](https://www.nps.gov/grsm/learn/nature/air-quality.htm) (`nps_grsm_air_quality`)

Exact transcript:

Look Rock is ahead. It is a viewpoint and an air-monitoring location, where instruments help the park measure particles, ozone, weather, and other conditions affecting the Smokies. Visibility alone cannot tell the whole story, so notice the view without guessing what causes it. Current readings and official advisories—not the color of the horizon by itself—describe today's air.

Transcript SHA-256: `3955b44ded4912c6726ce5037d06e2b1d5a23198aa1efd5ed7be8adca6ac02f0`

### Script 10: Forest from the ridge (`fp_cue_04`, cue)

Decision: [ ] Approve exact script  [ ] Revise: ____________________

Claims: `fp_forest_mosaic`

Sources:

- [Park Statistics](https://www.nps.gov/grsm/learn/management/statistics.htm) (`nps_grsm_statistics`)
- [Vegetation Types](https://www.nps.gov/grsm/learn/nature/vegetation-types.htm) (`nps_grsm_vegetation`)

Exact transcript:

The broad green view is not one uniform forest. Elevation and the direction each slope faces help organize different plant communities across the mountains. Compare a bright exposed slope with a shaded hollow, or a low ridge with the high country beyond it. Changes in color and canopy texture are clues to the forest mosaic described in the forest feature.

Transcript SHA-256: `57494b47b2a41ea3eca334a9e902b10efd60de699a30be277838dab574830171`

### Script 11: Walland connection (`fp_cue_05`, cue)

Decision: [ ] Approve exact script  [ ] Revise: ____________________

Claims: `fp_long_build`

Sources:

- [Foothills Parkway](https://www.nps.gov/places/foothills-parkway.htm) (`nps_grsm_foothills`)
- [Foothills Parkway design and technical studies](https://www.nps.gov/grsm/learn/news/national-park-service-plans-to-complete-additional-design-work-and-technical-studies-for-foothills-parkway-section-8d.htm) (`nps_grsm_foothills_history`)

Exact transcript:

This part of the parkway belongs to a road built in separated pieces across many decades. The corridor was authorized in 1944, but difficult terrain, changing plans, and uneven funding kept it from becoming one continuous highway. Around Walland and Wears Valley, completed sections once approached a stubborn gap from opposite directions. The road ahead carries that construction history in its bridges.

East-to-west override (`east_to_west`):

This part of the parkway belongs to a road built in separated pieces across many decades. The corridor was authorized in 1944, but difficult terrain, changing plans, and uneven funding kept it from becoming one continuous highway. Around Walland and Wears Valley, completed sections once approached a stubborn gap from opposite directions. The bridges you just crossed carry that construction history.

Transcript SHA-256: `55e5b68266498c13baca420a99480a31529c35d132dbcbec883b3bdbb529c7f1`

### Script 12: Across the Missing Link (`fp_cue_06`, cue)

Decision: [ ] Approve exact script  [ ] Revise: ____________________

Claims: `fp_missing_link`

Sources:

- [Foothills Parkway Missing Link bridge construction](https://www.nps.gov/grsm/learn/news/fhp-contract-award.htm) (`nps_grsm_missing_link_bridge`)

Exact transcript:

The parkway is entering the section once called the Missing Link. Watch for elevated bridges crossing steep, broken ground. One of them carries an eight-hundred-foot serpentine curve on four tall piers across two ravines. The structure lets the road follow the mountain without turning every hollow into a roadbed. The full story begins as the pavement moves out over open air.

Transcript SHA-256: `cae6702b9820d943da22ccf77c37f45ac67738e139524da7474429e4c8e02c90`

### Script 13: Wears Valley end (`fp_cue_07`, cue)

Decision: [ ] Approve exact script  [ ] Revise: ____________________

Claims: `fp_scenic_corridor`

Sources:

- [Foothills Parkway](https://www.nps.gov/places/foothills-parkway.htm) (`nps_grsm_foothills`)

Exact transcript:

The scenic section is descending toward Wears Valley and the ordinary road network. This chapter ends here, but the parkway's idea remains visible behind you: a road designed to reveal the Smokies rather than merely pass them. Trailhead will return to regular navigation after the final cue. Current closures and route availability are checked separately whenever you start this chapter.

East-to-west override (`east_to_west`):

The scenic section is nearing Chilhowee Lake and the ordinary road network. This chapter ends here, but the parkway's idea remains visible behind you: a road designed to reveal the Smokies rather than merely pass them. Trailhead will return to regular navigation after this cue. Current closures and route availability are checked separately whenever you start the chapter.

Override title: Chilhowee Lake end

Transcript SHA-256: `684e5befea32976be4c8f7cd354ddb76a80d0f6bee1fbed418b415a356e16194`

## Stop boundary

After decisions are recorded, stop. This review does not authorize artwork sanitation or ingestion, TTS or narration rendering, manifest work, uploads, production changes, or publication.
