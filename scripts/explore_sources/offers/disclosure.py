from __future__ import annotations


PARTNER_BOOKING_DISCLOSURE_KIND = "partner_booking"
PARTNER_BOOKING_DISCLOSURE_LABEL = "Partner booking · Trailhead may earn."


def offer_disclosure(provider: str = "") -> dict[str, str]:
    return {
        "kind": PARTNER_BOOKING_DISCLOSURE_KIND,
        "label": PARTNER_BOOKING_DISCLOSURE_LABEL,
        "provider": str(provider or "").strip().lower(),
    }
