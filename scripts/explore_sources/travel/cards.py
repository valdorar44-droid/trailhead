from __future__ import annotations

from .normalize import compact_text
from .schema import BookableExperience


def build_experience_card(experience: BookableExperience) -> BookableExperience:
    title = compact_text(experience.title) or "Viator experience"
    summary = compact_text(experience.summary or experience.description)
    if not summary:
        summary = "Bookable tour or activity near this TrailHead Explore area."
    experience.title = title
    experience.summary = summary[:420]
    if not experience.description:
        experience.description = experience.summary
    experience.source_badge = experience.source_badge or "Viator"
    experience.primary_action = "Book on Viator"
    experience.secondary_actions = ["Save", "Add to Planner", "Show Area"]
    experience.attribution = experience.attribution or "Tours and experiences sourced from Viator."
    return experience

