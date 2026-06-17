from __future__ import annotations


def import_overpass_region(*_args, **_kwargs):
    """Reserved for small targeted Overpass refreshes.

    Production bulk imports should use prepared Geofabrik-derived extracts.
    """
    raise NotImplementedError("Overpass region importer is intentionally not enabled for bulk imports yet.")

