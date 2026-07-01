# Dispersed Site Leads

Private coordinate exports can be used only as a review queue. They are not a
public camp feed and are not shown in the app until Trailhead verifies them.

## Current Batch

- Raw file: `/home/sean/imports/ioverlander/raw/places20260701-16-9vqr55.csv`
- Format: CSV
- Categories: Wild Camping, Informal Campsite
- Dry run command:

```bash
python3 scripts/import_dispersed_site_leads.py /home/sean/imports/ioverlander/raw/places20260701-16-9vqr55.csv --today 2026-07-01
```

Dry run result:

- Rows read: 16,044
- Accepted private leads: 15,999
- Near-duplicates skipped: 45
- Wild camp leads: 10,868
- Informal camp leads: 5,131
- Future verified dates: 1, capped to 2026-07-01 and marked for field check

## Rules

- Keep raw exports outside the repo.
- Store only coordinates, category, verification date, review flags, and internal batch metadata.
- Drop names, locations, descriptions, amenities, costs, road notes, photos, and reviews.
- Keep all leads private until independently checked and published by an admin.
- Publish only Trailhead-native records. Do not publish raw export names, notes, photos, reviews, amenities, or source text.

## Contributor Review

- Users apply from Profile as a map contributor.
- Admin approval grants private field-check access.
- Normal users cannot call the lead endpoints.
- Approved contributors can see nearby leads on the map and mark a lead checked or not found.
- Contributors and admins can save a private camp draft with the normal camp edit form and add private review photos.
- Contributor checks stay private.
- Admins can publish a checked site. Published sites become normal `Dispersed` camp records in camp search and viewport camp loading; private review photos move onto the published camp record.

## Commit Gate

The importer will not write to the database unless one of these is set:

```bash
python3 scripts/import_dispersed_site_leads.py <csv> --commit --license-confirmed
```

or:

```bash
DISPERSED_LEADS_LICENSE_CONFIRMED=1 python3 scripts/import_dispersed_site_leads.py <csv> --commit
```
