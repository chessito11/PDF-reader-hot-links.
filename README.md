# ATLAS PDF Plans v0.2

A separate, installable PDF plan reader. It does not share files or saved data with ATLAS DXF Estimating.

## Included in the first version

- Open multipage PDF plan sets locally.
- Sheet drawer with thumbnails and search.
- Previous/next page, direct page entry, rotate, fit, zoom, pan, and pinch zoom.
- Back history after following plan links.
- Automatic first-pass sheet-name scanning and sheet-reference hyperlinks.
- Editable sheet names when the automatic scan needs correction.
- Manual link tool: draw an area and choose its destination sheet.
- Local PDF.js engine and worker; no outside PDF service is used.
- Installable PWA shell cached for offline use.

## Run or publish

The app uses JavaScript modules and a service worker, so serve the complete folder over HTTPS (or localhost). Keep `pdf.min.mjs` and `pdf.worker.min.mjs` beside `app.mjs` in the repository root.

Open `index.html`, choose **OPEN PDF**, and select a plan set. Automatic link detection works best with text/vector PDFs. Use **LINK** for scanned drawings or callouts that are not recognized.

## v0.2 GitHub Pages fix

The PDF engine and worker now load directly from the repository root. This matches GitHub's web-upload layout and fixes an inactive **OPEN PDF** button caused by a missing `vendor/` folder.

## Important v0.2 limit

The application shell works offline after it has loaded once. The selected PDF remains private in the browser session and is not uploaded. Persistent saved PDF projects will be added in a later version.
