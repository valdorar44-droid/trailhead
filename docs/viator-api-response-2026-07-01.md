# Viator API Access Response - 2026-07-01

Recommended position: do not request Full+Booking access yet. Trailhead should launch with Viator real-time search/detail and redirect checkout first. Booking endpoints require PCI proof, checkout certification, booking questions, cancellation handling, and supplier-cancellation polling. We should not claim booking readiness until PCI and certification work are actually in place.

## Email Reply Draft

Dear Ryan,

Thank you for the clarification. After reviewing the implementation requirements, we would like to step back from Full+Booking access for the current launch phase.

Trailhead does not need Viator booking endpoints at this stage. We plan to use a real-time search/detail flow with checkout handed off to Viator. We will not collect customer payment details, submit bookings through the Partner API, or build the booking questions/payment/cancellation flow until we are ready for PCI and certification.

For now, please keep our integration aligned with Basic access, or Full access without booking if that is the correct path for richer product detail and compliant search/detail display. Our intended usage is:

- User-initiated tour search in Trailhead.
- No product ingestion from search endpoints.
- Pagination applied; no more than 50 products requested per call.
- Search/detail results cached for no more than 1 hour where caching is allowed.
- Checkout completed on Viator.
- No booking endpoints used in production.

Answers to your questions:

1. Payments solution selected

Not applicable for the current launch phase. Trailhead will not collect payment details or process Partner API bookings now. If we request booking access later, we expect to use the iframe payment solution because it keeps PCI scope lower than direct API payment collection.

2. PCI compliance

Not applicable for the current launch phase because Trailhead will not collect card data or process bookings through the Partner API. We do not have a PCI certificate to submit for booking access today. If we later request booking access, we will complete the required SAQ A AOC for iframe checkout, or the required PCI DSS AOC if using API payments, before requesting production booking credentials.

3. Endpoint usage

We will use the real-time search model. We will not use modified-since ingestion and we will not mix ingestion with real-time detail calls. The attached backend-check answers describe the endpoint plan.

4. Certification requirements

Confirmed. If Trailhead later requests booking access, we will comply with Viator front-end and back-end certification requirements before go-live.

5. Product catalog

Yes, we are interested in the out-of-the-box high-performing catalog for initial launch, provided it still supports our real-time destination and free-text search needs for outdoor/adventure destinations. If the curated catalog would materially limit coverage for destinations such as Pakistan/K2 or other adventure regions, please advise whether broader non-booking access is the better fit.

Website and app surfaces:

- https://gettrailhead.app
- https://api.gettrailhead.app
- Trailhead mobile app for iOS and Android

Expected live date:

Search/detail with Viator redirect checkout: July-August 2026. Full booking access: not scheduled until PCI and Viator certification are ready.

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

Trailhead supports user-initiated search across Viator-supported destinations, with an initial product focus on outdoor, parks, adventure, trail-town, and road-trip destinations. We do not plan to exclude destinations unless Viator supply, legal restrictions, or partner policy requires it.

How many products do you support? If you filter out some products, what criteria is it based on? Are you going to add more products post launch?

Trailhead does not ingest a fixed product catalog for this launch phase. Products are surfaced from user-initiated real-time search, paginated by the customer. We may filter or rank for outdoor relevance, customer rating, availability, price, duration, destination fit, and Viator-provided fields. We expect to broaden surfaced products after launch through the same compliant real-time search model unless Viator approves another model.

### Endpoint Usage

Selected model: real-time search model. No product ingestion.

| Endpoint | Ingestion | Real-time | Additional notes |
| --- | --- | --- | --- |
| /products/modified-since | Not used | Not used | No ingestion model for launch. |
| /products/bulk | Not used | Not used | Not used for ingestion or search. |
| /products/{product-code} | Not used | Single selected product only, if enabled | Used only after a customer selects one product from search results. Cache max 1 hour. |
| /availability/schedules/modified-since | Not used | Not used | No availability ingestion for launch. |
| /availability/schedules/bulk | Not used | Not used | Not used for ingestion or search. |
| /availability/schedules/{product-code} | Not used | Single selected product only, if enabled | Used only for one selected product, not for bulk availability ingestion. Cache max 1 hour. |
| /products/search | Not used | User-initiated search | Real-time only. Max 50 products per request; current app page size is lower. Additional pages only when the customer requests more results. Cache max 1 hour. |
| /search/freetext | Not used | User-initiated search | Real-time fallback for typed searches. Max 50 products per request; current app page size is lower. Additional pages only when the customer requests more results. Cache max 1 hour. |
| /products/tags | Weekly cache if used | Not real-time | Used only as auxiliary filter data if enabled. |
| /products/booking-questions | Not used | Not used | Not used unless future booking access is approved. |
| /locations/bulk | Monthly cache if used | On demand for new location references if needed | Trailhead uses its own map/place providers for map display. Google location details will only be retrieved through Trailhead's own Google Places access if required. |
| /exchange-rates | Cache by expiry if used | Not real-time | Not used initially. If enabled, refresh by response expiry timestamp. |
| /reviews/product | Weekly/monthly cache if used | Not real-time | Not used initially for full review text. If ratings/reviews are displayed, provider attribution will be shown and review data will not be indexed. |
| /suppliers/search/product-codes | Weekly cache if used | Not real-time | Not used initially. |
| /destinations | Weekly/monthly cache if used | Not real-time | Used only for auxiliary destination lookup/typeahead if enabled. |
| /attractions/search | Weekly/monthly cache if used | Not real-time | Not used initially. If enabled, attraction data will not be indexed. |
| /attractions/{attraction-id} | Weekly/monthly cache if used | Not real-time | Not used initially. If enabled, attraction data will not be indexed. |
| /availability/check | Not used | Not used for redirect checkout | Only relevant to future booking access after a date and passenger mix are selected. |
| /bookings/cart/hold | Not used | Not used | Booking access deferred. |
| /bookings/cart/book | Not used | Not used | Booking access deferred. |
| /v1/checkoutsessions/{sessionToken}/paymentaccounts | Not used | Not used | Booking access deferred. |
| /bookings/status | Not used | Not used | Booking access deferred. |
| /bookings/modified-since | Not used | Not used | Booking access deferred. |
| /bookings/modified-since/acknowledge | Not used | Not used | Booking access deferred. |
| /bookings/cancel-reasons | Not used | Not used | Booking access deferred. |
| /bookings/{booking-reference}/cancel-quote | Not used | Not used | Booking access deferred. |
| /bookings/{booking-reference}/cancel | Not used | Not used | Booking access deferred. |

### Product Search

Do you provide search results to customers that are returned by our search endpoint or do you return search results directly from your database?

Search results are returned from Viator real-time search endpoints. Trailhead does not ingest search results into a permanent product database for launch.

If you're using the search endpoint(s), can you confirm that pagination has been applied and you're not requesting more than 50 products at a time?

Confirmed. Trailhead will request no more than 50 products per call. The current app requests fewer than 50 per page. Additional pages will only be requested when the customer asks to see more results.

### Attractions

Do you use attraction data from the API? If so, could you confirm that it's not indexed?

Not used initially. If enabled later, attraction data will not be indexed.

### Reviews

Do you display Viator or Tripadvisor reviews from the API? If so, could you confirm that this data is not indexed?

Not initially for full review text. If ratings or reviews are displayed, they will not be indexed.

If reviews or review scoring from the API are used on your site, do you indicate the provider of the reviews?

Yes. If ratings or reviews are displayed, Trailhead will show Viator/Tripadvisor attribution, including the required wording where applicable.

### Exchange Rates

Do you use the Viator exchange rates from the /exchange-rates endpoint?

Not initially. If enabled later, exchange rates will be cached and refreshed according to the expiry timestamp in the response.

### Locations

Do you have access to Google Places API to retrieve details of Google locations using the providerReference from the /locations/bulk response?

Trailhead does not rely on Viator-provided Google location details for the initial launch. We use our own map/place providers for map display. If we display Google location details from provider references later, we will use our own Google Places access.

### Real-Time Availability And Pricing

Do you conduct availability and pricing checks in real-time prior to booking? If so, at what stage of the booking flow and what endpoint do you use for this?

Not for the current launch because checkout is handed off to Viator. If booking access is approved later, availability checks will be done after the customer selects a specific product, travel date, and passenger mix.

Can you confirm that the /availability/check endpoint is used when a specific date and passenger mix are selected?

For future booking access, yes. It will not be used for ingestion or broad search.

In case of pricing differences between previously quoted price and the new price from the /availability/check response, do you apply the new price?

For future booking access, yes. The current price from /availability/check would be applied and communicated before booking.

### Timeout

Have you implemented a timeout for API services on your end? If so, how long is it?

Trailhead will support Viator's 120-second API timeout requirement for upstream Viator service calls. The app may show loading states, cached results, or retry options sooner, but the backend integration will not use a shorter upstream API timeout where certification requires 120 seconds.
