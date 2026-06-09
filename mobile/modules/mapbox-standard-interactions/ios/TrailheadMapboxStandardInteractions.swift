import CoreLocation
import ExpoModulesCore
@_spi(Experimental) import MapboxMaps
#if canImport(MapboxSearch)
import MapboxSearch
#endif
import UIKit

public class TrailheadMapboxStandardInteractions: Module {
    private var enabled = false
    private weak var installedMapView: MapView?
    private var styleCancelables = Set<AnyCancelable>()
    private var interactionCancelables: [any Cancelable] = []
#if canImport(MapboxSearch)
    private lazy var searchEngine = SearchEngine()
#endif

    public func definition() -> ModuleDefinition {
        Name("TrailheadMapboxStandardInteractions")
        Events("onStandardFeatureTap")

        AsyncFunction("enable") { (promise: Promise) in
            DispatchQueue.main.async {
                self.enabled = true
                self.installIfPossible()
                promise.resolve(self.installedMapView != nil)
            }
        }

        AsyncFunction("disable") { (promise: Promise) in
            DispatchQueue.main.async {
                self.enabled = false
                self.styleCancelables.removeAll()
                self.interactionCancelables.removeAll()
                self.installedMapView = nil
                promise.resolve(true)
            }
        }

        AsyncFunction("enrichPlace") { (payload: [String: Any], promise: Promise) in
#if canImport(MapboxSearch)
            DispatchQueue.main.async {
                self.enrichPlaceWithSearchSDK(payload: payload, promise: promise)
            }
#else
            promise.resolve(nil)
#endif
        }
    }

    private func installIfPossible() {
        guard enabled else { return }
        guard let mapView = findMapboxMapView() else { return }
        if installedMapView === mapView { return }
        installedMapView = mapView
        addInteractions(to: mapView)
        mapView.mapboxMap.onStyleLoaded.observe { [weak self, weak mapView] _ in
            guard let self, self.enabled, let mapView else { return }
            self.addInteractions(to: mapView)
        }.store(in: &styleCancelables)
    }

    private func addInteractions(to mapView: MapView) {
        interactionCancelables.removeAll()
        let poiTap = mapView.mapboxMap.addInteraction(TapInteraction(.standardPoi, radius: 60) { [weak self] poi, context in
            self?.emitPoi(poi, context: context)
            return true
        })
        let placeTap = mapView.mapboxMap.addInteraction(TapInteraction(.standardPlaceLabels, radius: 52) { [weak self] place, context in
            self?.emitPlaceLabel(place, context: context)
            return true
        })
        let buildingTap = mapView.mapboxMap.addInteraction(TapInteraction(.standardBuildings, radius: 44) { [weak self] building, context in
            self?.emitBuilding(building, context: context)
            return true
        })
        interactionCancelables = [poiTap, placeTap, buildingTap]
    }

    private func emitPoi(_ poi: StandardPoiFeature, context: InteractionContext) {
        emitFeature(
            featureset: "standardPoi",
            featureId: describeFeatureId(poi.id),
            name: poi.name,
            coordinate: poi.coordinate,
            context: context,
            properties: [
                "name": poi.name,
                "class": poi.`class`,
                "group": poi.group,
                "maki": poi.maki,
                "airport_ref": poi.airportRef,
                "transit_mode": poi.transitMode,
                "transit_network": poi.transitNetwork,
                "transit_stop_type": poi.transitStopType,
            ],
            confidence: "high"
        )
    }

    private func emitPlaceLabel(_ place: StandardPlaceLabelsFeature, context: InteractionContext) {
        emitFeature(
            featureset: "standardPlaceLabels",
            featureId: describeFeatureId(place.id),
            name: place.name,
            coordinate: context.coordinate,
            context: context,
            properties: [
                "name": place.name,
                "class": place.`class`,
            ],
            confidence: "medium"
        )
    }

    private func emitBuilding(_ building: StandardBuildingsFeature, context: InteractionContext) {
        emitFeature(
            featureset: "standardBuildings",
            featureId: describeFeatureId(building.id),
            name: "Building",
            coordinate: context.coordinate,
            context: context,
            properties: [
                "group": building.group,
            ],
            confidence: "low"
        )
    }

    private func emitFeature(
        featureset: String,
        featureId: String?,
        name: String?,
        coordinate: CLLocationCoordinate2D,
        context: InteractionContext,
        properties: [String: Any?],
        confidence: String
    ) {
        let point = context.point
        var cleanProperties: [String: Any] = [:]
        properties.forEach { key, value in
            if let value { cleanProperties[key] = value }
        }
        let category = cleanProperties["class"] ?? cleanProperties["group"] ?? cleanProperties["maki"]
        var payload: [String: Any] = [
            "source": "mapbox_standard_feature",
            "featureset": featureset,
            "lat": coordinate.latitude,
            "lng": coordinate.longitude,
            "screen_x": Double(point.x),
            "screen_y": Double(point.y),
            "screen_position": screenPosition(point),
            "selection_confidence": confidence,
            "properties": cleanProperties,
        ]
        if let featureId {
            payload["feature_id"] = featureId
            payload["mapbox_id"] = featureId
        }
        if let name { payload["name"] = name }
        if let value = cleanProperties["class"] { payload["class"] = value }
        if let category { payload["category"] = category }
        if let value = cleanProperties["group"] { payload["group"] = value }
        if let value = cleanProperties["maki"] { payload["maki"] = value }
        sendEvent("onStandardFeatureTap", payload)
    }

    private func findMapboxMapView() -> MapView? {
        let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
        for window in scenes.flatMap({ $0.windows }).filter({ !$0.isHidden }) {
            if let found = findMapboxMapView(in: window) {
                return found
            }
        }
        return nil
    }

    private func findMapboxMapView(in view: UIView) -> MapView? {
        if let map = view as? MapView {
            return map
        }
        for child in view.subviews {
            if let found = findMapboxMapView(in: child) {
                return found
            }
        }
        return nil
    }

    private func describeFeatureId(_ id: FeaturesetFeatureId?) -> String? {
        guard let id else { return nil }
        let value = String(describing: id)
        return value.isEmpty ? nil : value
    }

    private func screenPosition(_ point: CGPoint) -> String {
        guard let mapView = installedMapView else { return "center" }
        let width = max(1, mapView.bounds.width)
        let height = max(1, mapView.bounds.height)
        let nx = point.x / width
        let ny = point.y / height
        if nx >= 0.34 && nx <= 0.66 && ny >= 0.28 && ny <= 0.68 { return "center" }
        if ny < 0.28 { return "top" }
        if ny > 0.68 { return "bottom" }
        return nx < 0.5 ? "left" : "right"
    }

#if canImport(MapboxSearch)
    private func enrichPlaceWithSearchSDK(payload: [String: Any], promise: Promise) {
        let name = String(describing: payload["name"] ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        let lat = doubleValue(payload["lat"])
        let lng = doubleValue(payload["lng"])
        guard !name.isEmpty, let lat, let lng else {
            promise.resolve(nil)
            return
        }
        let coordinate = CLLocationCoordinate2D(latitude: lat, longitude: lng)
        let options = SearchOptions(
            limit: 6,
            proximity: coordinate,
            origin: coordinate
        )
        searchEngine.forward(query: name, options: options) { [weak self] result in
            guard let self else { return }
            switch result {
            case .success(let results):
                let radius = self.doubleValue(payload["radius_meters"]) ?? 90
                let category = String(describing: payload["category"] ?? "").lowercased()
                let best = results
                    .filter { searchResult in
                        let distance = self.distanceMeters(from: coordinate, to: searchResult.coordinate)
                        guard distance <= radius else { return false }
                        if self.textMatches(searchResult.name, name) { return true }
                        if let categories = searchResult.categories, !category.isEmpty {
                            return categories.map { $0.lowercased() }.joined(separator: " ").contains(category)
                        }
                        return false
                    }
                    .sorted { lhs, rhs in
                        let lhsName = self.textMatches(lhs.name, name) ? 0 : 1
                        let rhsName = self.textMatches(rhs.name, name) ? 0 : 1
                        return lhsName == rhsName
                            ? self.distanceMeters(from: coordinate, to: lhs.coordinate) < self.distanceMeters(from: coordinate, to: rhs.coordinate)
                            : lhsName < rhsName
                    }
                    .first
                guard let best else {
                    promise.resolve(nil)
                    return
                }
                promise.resolve(self.payload(for: best))
            case .failure(let error):
                promise.reject("mapbox_search_sdk_error", String(describing: error))
            }
        }
    }

    private func payload(for result: SearchResult) -> [String: Any] {
        var out: [String: Any] = [
            "id": result.id,
            "name": result.name,
            "lat": result.coordinate.latitude,
            "lng": result.coordinate.longitude,
            "source": "mapbox_search_sdk",
            "type": String(describing: result.type),
        ]
        if let value = result.mapboxId { out["mapbox_id"] = value }
        if let value = result.iconName { out["maki"] = value }
        if let value = result.descriptionText { out["description"] = value }
        if let value = result.address?.formattedAddress(style: .medium) { out["address"] = value }
        if let value = result.categories { out["categories"] = value }
        if let value = result.categoryIds { out["category_ids"] = value }
        if let value = result.distance { out["distance_meters"] = value }
        if let value = result.estimatedTime?.converted(to: .minutes).value { out["eta_minutes"] = value }
        if let points = result.routablePoints {
            out["routable_points"] = points.map { point in
                [
                    "name": point.name,
                    "lat": point.point.latitude,
                    "lng": point.point.longitude,
                ] as [String: Any]
            }
        }
        if let metadata = result.metadata {
            if let value = metadata.phone { out["phone"] = value }
            if let value = metadata.website { out["website"] = value.absoluteString }
            if let value = metadata.rating { out["rating"] = value; out["average_rating"] = value }
            if let value = metadata.reviewCount { out["review_count"] = value; out["rating_count"] = value }
            if let value = metadata.description { out["description"] = value }
            if let value = metadata.priceLevel { out["price_level"] = value }
            if let value = metadata.popularity { out["popularity"] = value }
            if let value = metadata.openHours { out["open_hours"] = String(describing: value); out["hours_label"] = String(describing: value) }
            if let url = bestImageURL(metadata.primaryImage) { out["primary_image"] = url }
            let otherImages = (metadata.otherImages ?? []).compactMap { bestImageURL($0) }
            if !otherImages.isEmpty { out["other_images"] = otherImages }
            out["metadata"] = metadata.data
        }
        return out
    }

    private func bestImageURL(_ image: MapboxSearch.Image?) -> String? {
        guard let image else { return nil }
        return image.sizes
            .sorted { lhs, rhs in
                (lhs.size.width * lhs.size.height) > (rhs.size.width * rhs.size.height)
            }
            .compactMap { $0.url?.absoluteString }
            .first
    }

    private func doubleValue(_ value: Any?) -> Double? {
        if let value = value as? Double { return value }
        if let value = value as? NSNumber { return value.doubleValue }
        if let value = value as? String { return Double(value) }
        return nil
    }

    private func distanceMeters(from: CLLocationCoordinate2D, to: CLLocationCoordinate2D) -> CLLocationDistance {
        CLLocation(latitude: from.latitude, longitude: from.longitude)
            .distance(from: CLLocation(latitude: to.latitude, longitude: to.longitude))
    }

    private func textMatches(_ lhs: String, _ rhs: String) -> Bool {
        let a = normalizeText(lhs)
        let b = normalizeText(rhs)
        guard !a.isEmpty, !b.isEmpty else { return false }
        return a.contains(b) || b.contains(a)
    }

    private func normalizeText(_ value: String) -> String {
        value.folding(options: [.diacriticInsensitive, .caseInsensitive], locale: nil)
            .lowercased()
            .components(separatedBy: CharacterSet.alphanumerics.inverted)
            .filter { !$0.isEmpty }
            .joined(separator: " ")
    }
#endif
}
