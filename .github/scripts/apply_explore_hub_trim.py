#!/usr/bin/env python3
"""Apply the second-stage Explore home performance patch.

This script is intentionally idempotent so the GitHub Actions workflow can be
re-run from a phone without duplicating the inserted search hydration effect.
"""
from __future__ import annotations

import re
from pathlib import Path

GUIDE_PATH = Path("mobile/app/(tabs)/guide.tsx")

COMPACT_LOAD_EFFECT = """  useEffect(() => {
    let cancelled = false;
    let backgroundTimer: ReturnType<typeof setTimeout> | null = null;

    const mergeById = (base: ExplorePlaceProfile[], next: ExplorePlaceProfile[]) => {
      const seen = new Set(base.map(place => place.id));
      const merged = [...base];
      for (const place of next) {
        if (!place?.id || seen.has(place.id)) continue;
        seen.add(place.id);
        merged.push(place);
      }
      return merged;
    };

    const withExploreTimeout = <T,>(promise: Promise<T>, ms = 5200) => new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Explore catalog timeout')), ms);
      promise.then(
        value => {
          clearTimeout(timer);
          resolve(value);
        },
        error => {
          clearTimeout(timer);
          reject(error);
        },
      );
    });

    const readCachedCatalog = async () => {
      const raw = await storage.get(EXPLORE_CACHE_KEY).catch(() => '');
      if (!raw) return [] as ExplorePlaceProfile[];
      try {
        const cached = JSON.parse(raw);
        return Array.isArray(cached?.places) ? cached.places as ExplorePlaceProfile[] : [];
      } catch {
        return [] as ExplorePlaceProfile[];
      }
    };

    const hydrateRemainingCatalog = async (cursor: number | null | undefined, seededPlaces: ExplorePlaceProfile[]) => {
      let nextCursor = cursor;
      let allPlaces = seededPlaces;
      for (let page = 0; nextCursor != null && page < 8; page += 1) {
        const catalog = await api.getExploreCatalogIndex({ limit: 500, cursor: nextCursor });
        const pagePlaces = (catalog.places ?? []).map(exploreIndexItemToProfile);
        allPlaces = mergeById(allPlaces, pagePlaces);
        nextCursor = catalog.next_cursor;
        if (cancelled) return;
        await new Promise(resolve => setTimeout(resolve, 120));
      }
      if (!cancelled && allPlaces.length > seededPlaces.length) {
        storage.set(EXPLORE_CACHE_KEY, JSON.stringify({ places: allPlaces, fetched_at: Date.now() })).catch(() => {});
      }
    };

    // Compact home load: show a curated first page, keep source-rich data findable through search/filter.
    setExploreLoading(true);
    (async () => {
      try {
        const firstPage = await withExploreTimeout(api.getExploreCatalogIndex({ limit: 120, cursor: 0 }));
        const firstPlaces = (firstPage.places ?? []).map(exploreIndexItemToProfile);
        if (cancelled) return;
        setExplorePlaces(firstPlaces);
        setExploreError('');
        setExploreLoading(false);
        backgroundTimer = setTimeout(() => {
          hydrateRemainingCatalog(firstPage.next_cursor, firstPlaces).catch(() => {});
        }, 3200);
      } catch {
        const cached = await readCachedCatalog();
        if (cancelled) return;
        if (cached.length) {
          setExplorePlaces(cached.slice(0, 160));
          setExploreError('');
        } else {
          setExploreError('Explore catalog unavailable offline until it has been loaded once.');
        }
        setExploreLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      if (backgroundTimer) clearTimeout(backgroundTimer);
    };
  }, []);"""

REMOTE_SEARCH_EFFECT = """

  useEffect(() => {
    const query = exploreQuery.trim();
    const category = exploreCategory !== 'all' ? exploreCategory : '';
    const shouldFetch = tab === 'explore'
      && exploreMode === 'featured'
      && !exploreSavedOnly
      && (query.length >= 2 || !!category);
    if (!shouldFetch) return;

    let cancelled = false;
    const timer = setTimeout(() => {
      api.getExploreCatalogIndex({
        q: query.length >= 2 ? query : undefined,
        category: category || undefined,
        limit: 420,
        cursor: 0,
      })
        .then(catalog => {
          if (cancelled) return;
          const remotePlaces = (catalog.places ?? []).map(exploreIndexItemToProfile);
          if (!remotePlaces.length) return;
          setExplorePlaces(current => {
            const seen = new Set(current.map(place => place.id));
            const merged = [...current];
            for (const place of remotePlaces) {
              if (!place?.id || seen.has(place.id)) continue;
              seen.add(place.id);
              merged.push(place);
            }
            return merged;
          });
        })
        .catch(() => {});
    }, 280);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [tab, exploreMode, exploreQuery, exploreCategory, exploreSavedOnly]);"""

CATALOG_EFFECT_PATTERN = re.compile(
    r"  useEffect\(\(\) => \{\n"
    r"\s*let cancelled = false;\n"
    r"\s*let backgroundTimer:[\s\S]*?"
    r"\n\s*\}, \[\]\);"
)


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        if new in text:
            return text
        raise SystemExit(f"Could not find expected text for {label}")
    return text.replace(old, new, 1)


def main() -> None:
    text = GUIDE_PATH.read_text()

    text = text.replace("const EXPLORE_INITIAL_VISIBLE = 80;", "const EXPLORE_INITIAL_VISIBLE = 48;")
    text = text.replace("const EXPLORE_VISIBLE_STEP = 80;", "const EXPLORE_VISIBLE_STEP = 48;")

    if "Compact home load: show a curated first page" not in text:
        text, count = CATALOG_EFFECT_PATTERN.subn(COMPACT_LOAD_EFFECT, text, count=1)
        if count != 1:
            raise SystemExit("Could not find exactly one staged Explore catalog-loading effect in guide.tsx")

    if "limit: 420" not in text:
        marker = "  useEffect(() => {\n    let cancelled = false;\n    storage.get(SAVED_EXPLORE_KEY)"
        if marker not in text:
            raise SystemExit("Could not find saved Explore useEffect insertion point")
        text = text.replace(marker, REMOTE_SEARCH_EFFECT + "\n\n" + marker, 1)

    text = replace_once(text, "if (picks.length >= 8) break;", "if (picks.length >= 4) break;", "trending pick cap")
    text = replace_once(text, "return picks.slice(0, 8);", "return picks.slice(0, 4);", "trending slice")
    text = replace_once(
        text,
        "return FEATURED_SECTION_ORDER\n      .map(key => {",
        "return FEATURED_SECTION_ORDER.slice(0, 6)\n      .map(key => {",
        "featured section cap",
    )
    text = replace_once(
        text,
        "          .slice(0, 5);\n        rows.forEach",
        "          .slice(0, 3);\n        rows.forEach",
        "featured section row cap",
    )
    text = text.replace("featured hubs", "featured picks")

    GUIDE_PATH.write_text(text)
    print("Explore hub trim patch applied or already present.")


if __name__ == "__main__":
    main()
