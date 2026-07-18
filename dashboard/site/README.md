<div align="center">

# Horizon HQ — Field Bureau

 <img src="https://img.shields.io/badge/Astro-6.0-FF5D01?logo=astro&logoColor=white" alt="Astro">
  <img src="https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black" alt="React">
  <img src="https://img.shields.io/badge/Tailwind_CSS-4.0-06B6D4?logo=tailwindcss&logoColor=white" alt="Tailwind CSS">
  <img src="https://img.shields.io/badge/Framer_Motion-12-0055FF?logo=framer&logoColor=white" alt="Framer Motion">
<img width="1648" height="994" alt="6" src="https://github.com/user-attachments/assets/1c6b88a6-b605-4d07-bb66-f4156caca63d" />
</div>


---

### Overview

A premium expedition bureau website with spatial scroll animations, interactive SVG trail maps, dark mode, and JSON-driven content. Built for outdoor agencies, travel bureaus, and adventure brands.

### Features

- Dark mode with theme persistence
- Spatial scroll-driven Framer Motion animations
- Expedition showcase with detail modals
- Interactive SVG hiking trail maps
- Destination pages with dynamic routes
- Guide profiles with regions and roles
- Gear checklist with accordion image reveals
- Journal / field notes section
- Press and testimonials (bento grid layout)
- Philosophy accordion section
- Timeline component for company history
- Contact form with field selector
- Animated hero with blur-counting stats
- Scattered image stack on story page
- JSON-driven content — update copy without touching code
- Mobile-first responsive layouts
- Sitemap generation

### Pages

`Home` `Expeditions` `Destinations` `Destination Detail` `Guides` `Gear` `Journal` `Our Story` `Press` `Contact`

### Tech Stack

`Astro` `React` `Tailwind CSS` `Framer Motion`

### Getting Started

```bash
# Install dependencies
npm install

# Start dev server
npm run dev

# Build for production
npm run build
```

### App-link association credentials

The static association files use the confirmed app identifiers (`com.trailhead.app`) and internal-build signing credentials:

- Apple Team ID: `4FJKGBQA5X`.
- EAS internal Android signing SHA-256: `DE:BB:4B:74:EF:C8:94:42:1B:00:B3:E0:92:45:86:77:DA:EB:A5:72:C7:82:74:76:61:AA:FC:93:89:CA:CB:C6`.

The Android association therefore verifies EAS internal builds. Before a public Google Play release, add the production app-signing SHA-256 from Google Play Console → Setup → App integrity → App signing key certificate to the `sha256_cert_fingerprints` array. Keep the EAS fingerprint if both internal and store builds should open these links.

After deployment, confirm both URLs return the JSON body directly over HTTPS with no redirects:

- `/.well-known/apple-app-site-association`
- `/.well-known/assetlinks.json`

The canonical Originals URL uses `https://gettrailhead.app`. The apex currently needs an address/alias record pointing at the same host as `api.gettrailhead.app`; until that DNS prerequisite is complete, use the `https://api.gettrailhead.app/originals/...` preview URL. Verify both association files on the apex and API host before the public launch.
