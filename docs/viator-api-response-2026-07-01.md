# Viator API Access Response - 2026-07-01

Goal: Trailhead wants Full+Booking access, with Viator remaining merchant of record. The safest payment path is the Viator iframe payment solution so Trailhead can keep the customer inside the app while reducing PCI scope versus direct API payment collection.

Important position: we should request Full+Booking sandbox access for development and certification, but we must not claim production readiness until the booking flow, booking questions, cancellation flow, supplier cancellation polling, and PCI paperwork are complete.

## Email Reply Draft

Dear Ryan,

Thank you for the detailed clarification. Yes, Trailhead does intend to pursue Full+Booking access.

Our goal is to keep the customer inside the Trailhead app and website for the tour selection and checkout flow while Viator remains the merchant of record and owns the post-booking customer support flow. We understand this means Trailhead must build the required booking questions flow, payment handoff, booking confirmation, voucher display, cancellation quote/cancel flow, supplier cancellation polling, and certification requirements before production booking access can go live.

For payments, we plan to implement the Viator iframe payment solution. We are choosing iframe specifically to reduce PCI scope compared with direct API card collection. We understand we will still need to provide the required SAQ A AOC certification before production booking access is enabled.

We are requesting sandbox access to the booking endpoints so we can build and test the certified implementation. We understand production booking credentials will require successful front-end and back-end certification and valid PCI documentation.

Answers to your questions:

1. Payments solution selected

Trailhead will implement the iframe payment solution.

2. PCI compliance

We do not have a PCI certificate to submit today. Because we plan to use the iframe solution, our target certification path is SAQ A AOC. We understand this must be completed and shared before production booking access can go live, and we will maintain an updated certificate as required.

3. Endpoint usage

Trailhead will use the real-time search model, not ingestion. Search endpoints will only be called from user-initiated searches, with pagination. Product detail, schedule, availability, booking questions, hold, and book endpoints will only be used after a customer selects a specific product and moves through the booking flow. We will not use search endpoints for ingestion.

4. Certification requirements

Confirmed. Trailhead will comply with Viator front-end and back-end certification requirements before production launch of booking.

5. Product catalog

Yes, we are interested in the out-of-the-box high-performing catalog for the initial certified booking launch if it supports our outdoor/adventure use case. Trailhead also serves adventure destinations, trail towns, national parks, overlanding routes, and international trekking regions, so please advise if the curated catalog would limit coverage for destinations such as Pakistan/K2. If so, we would prefer broader product access with compliant real-time search and filtering.

Website and app surfaces:

- https://gettrailhead.app
- https://api.gettrailhead.app
- Trailhead mobile app for iOS and Android

Expected live date:

Target: sandbox implementation and certification build during July-August 2026. Production booking launch depends on Viator certification and PCI SAQ A AOC completion.

Best regards,
Trailhead

## Backend Check Answers

### General Questions

What is your company name?

Trailhead / GetTrailhead

Is this a B2B or B2C implementation, or both?

B2C.

Is this implementation for desktop, mobile, or app?

Mobile app for iOS and Android, plus responsive web.

How many destinations do you support? Which destinations do you exclude, if any, and why?

Trailhead supports user-initiated search across Viator-supported destinations, with an initial product focus on outdoor, parks, adventure, trail-town, road-trip, overlanding, and trekking destinations. We do not plan to exclude destinations unless Viator supply, legal restrictions, or partner policy requires it.

How many products do you support? If you filter out some products, what criteria is it based on? Are you going to add more products post launch?

Trailhead will not ingest a fixed product catalog for launch. Products will be surfaced from user-initiated real-time search, then paginated as the customer requests more results. We may filter/rank for outdoor relevance, customer rating, availability, price, duration, destination fit, free cancellation, and Viator-provided fields. We expect to broaden surfaced products after launch through the same compliant real-time search model unless Viator approves another model.

### Endpoint Usage

Selected model: real-time search model. No product ingestion.

| Endpoint | Ingestion | Real-time | Additional notes |
| --- | --- | --- | --- |
| /products/modified-since | Not used | Not used | Trailhead is not using ingestion for launch. |
| /products/bulk | Not used | Edge cases only if approved | Not used for ingestion or broad search. |
| /products/{product-code} | Not used | Single selected product only | Used only after a customer selects one product from search results. Cache max 1 hour. |
| /availability/schedules/modified-since | Not used | Not used | No availability ingestion. |
| /availability/schedules/bulk | Not used | Edge cases only if approved | Not used for ingestion or broad search. |
| /availability/schedules/{product-code} | Not used | Single selected product only | Used only after a customer selects one product, date flow, or detail page. Cache max 1 hour. |
| /products/search | Not used | User-initiated search | Real-time only. Max 50 products per request. Additional pages only when the customer requests more results. Cache max 1 hour. |
| /search/freetext | Not used | User-initiated typed search | Real-time only. Max 50 products per request. Additional pages only when the customer requests more results. Cache max 1 hour. |
| /products/tags | Weekly cache if used | Not real-time | Used only as auxiliary filter data. |
| /products/booking-questions | Monthly cache and selected-product refresh if required | During checkout for selected product only if needed | Required for booking. Used to render the required traveler/booking questions before booking. |
| /locations/bulk | Monthly cache if used | On demand for new location references if needed | Trailhead uses its own map/place providers for map display. Google location details will only be retrieved through Trailhead's own Google Places access if required. |
| /exchange-rates | Cache by expiry if used | Not real-time | If enabled, refreshed by response expiry timestamp. |
| /reviews/product | Weekly/monthly cache if used | Not real-time | Review data will not be indexed. If ratings/reviews are shown, Viator/Tripadvisor attribution will be shown. |
| /suppliers/search/product-codes | Weekly cache if used | Not real-time | Used only if needed for supplier metadata. |
| /destinations | Weekly/monthly cache if used | Not real-time | Used for destination lookup/typeahead if enabled. |
| /attractions/search | Weekly/monthly cache if used | Not real-time | If enabled, attraction data will not be indexed. |
| /attractions/{attraction-id} | Weekly/monthly cache if used | Not real-time | If enabled, attraction data will not be indexed. |
| /availability/check | Not used | Booking flow only | Called only after a specific product, travel date, and passenger mix are selected. Also called again before booking if needed to re-check price and availability. |
| /bookings/cart/hold | Not used | Checkout only | Used with /bookings/cart/book when the customer moves to checkout/payment. Hold expiry timestamps will be checked and refreshed when needed. |
| /bookings/cart/book | Not used | Checkout only | Used only after successful cart hold/payment flow. Booking status will be verified before confirming to the customer. Viator voucher will be shown/shared. |
| /v1/checkoutsessions/{sessionToken}/paymentaccounts | Not used | Payment iframe flow only | Used for iframe payment solution if required by Viator's current iframe implementation. |
| /bookings/status | Not used | Exception/pending status only | Used when booking response is pending, unclear, failed, or timed out before any re-booking attempt. Not used to poll all bookings. |
| /bookings/modified-since | Every 2-5 minutes after booking go-live | Not user-triggered | Used to process supplier cancellations and changes requiring acknowledgement. |
| /bookings/modified-since/acknowledge | Every 2-5 minutes as required by acknowledgeBy timestamp | Not user-triggered | Used to acknowledge received supplier cancellation notifications within the required time. |
| /bookings/cancel-reasons | Monthly cache | Not real-time | Used to present valid customer cancellation reasons. |
| /bookings/{booking-reference}/cancel-quote | Not used | Cancellation flow only | Called before cancellation to show refund amount accurately. |
| /bookings/{booking-reference}/cancel | Not used | Cancellation flow only | Used to cancel bookings through the API after customer confirmation. |

### Product Search

Do you provide search results to customers that are returned by our search endpoint or do you return search results directly from your database?

Search results are returned from Viator real-time search endpoints. Trailhead will not ingest search results into a permanent product database for launch.

If you're using the search endpoint(s), can you confirm that pagination has been applied and you're not requesting more than 50 products at a time?

Confirmed. Trailhead will request no more than 50 products per call. Additional pages will only be requested when the customer asks to see more results.

### Attractions

Do you use attraction data from the API? If so, could you confirm that it's not indexed?

Not initially. If enabled later, attraction data will not be indexed.

### Reviews

Do you display Viator or Tripadvisor reviews from the API? If so, could you confirm that this data is not indexed?

If ratings or reviews are displayed, they will not be indexed.

If reviews or review scoring from the API are used on your site, do you indicate the provider of the reviews?

Yes. Trailhead will show Viator/Tripadvisor attribution, including the required wording where applicable.

### Exchange Rates

Do you use the Viator exchange rates from the /exchange-rates endpoint?

Not initially. If enabled later, exchange rates will be cached and refreshed according to the expiry timestamp in the response.

### Locations

Do you have access to Google Places API to retrieve details of Google locations using the providerReference from the /locations/bulk response?

Trailhead does not rely on Viator-provided Google location details for the initial launch. We use our own map/place providers for map display. If we display Google location details from provider references later, we will use our own Google Places access.

### Real-Time Availability And Pricing

Do you conduct availability and pricing checks in real-time prior to booking? If so, at what stage of the booking flow and what endpoint do you use for this?

Yes. Trailhead will call /availability/check after the customer selects a specific product, travel date, and passenger mix based on Viator age bands. We will also re-check before booking if needed, especially if the hold is unsupported or expired.

Can you confirm that the /availability/check endpoint is used when a specific date and passenger mix are selected?

Confirmed. It will not be used for ingestion, broad search, or bulk availability checks.

In case of pricing differences between previously quoted price and the new price from the /availability/check response, do you apply the new price?

Confirmed. Trailhead will apply and communicate the new price before booking.

### Timeout

Have you implemented a timeout for API services on your end? If so, how long is it?

Trailhead will support Viator's 120-second API timeout requirement for upstream Viator service calls. The app may show loading states or retry options sooner, but the backend integration will not use a shorter upstream API timeout where certification requires 120 seconds.
