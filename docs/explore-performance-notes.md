# Explore Performance Notes

## Scope

This note captures the likely causes of Explore and editor Explorer slowness after restoring local Trailhead data.

## Editor file tree

The restored local Explore cache can include generated folders and large JSON or JSONL artifacts. Editors can become slow when they watch and search these paths continuously.

This branch adds `.vscode/settings.json` so VS Code and Cursor skip generated Trailhead data, dependency folders, build outputs, Playwright output, Wrangler output, Expo output, and native build folders.

## Mobile Explore tab

The mobile Explore screen currently loads cached Explore data, fetches large catalog-index pages, stores the merged result in React state, and then filters, scores, groups, and sorts the list client-side. The visible list starts small, but the ranking work still runs against the larger loaded catalog.

A safe mobile follow-up is to load a smaller initial catalog slice, lazily fetch more pages, and move search/category paging to the backend index. That follow-up can stay OTA-safe when limited to TypeScript and JavaScript.

## Backend catalog path

The backend catalog loader reads and merges v1 and v3 Explore catalog artifacts. As the catalog grows with NPS and Wikidata source packs, this should be cached by source-file mtime or replaced with a compact prebuilt index endpoint for mobile.

## Deploy notes

The editor settings file works as soon as the branch is checked out or merged. Mobile TypeScript changes need an Expo OTA publish. Backend catalog-index changes need a Railway API deploy.
