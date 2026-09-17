# Outfit Planner

A standalone, mobile-friendly outfit planning page inspired by the supplied Yourfavalien dark editorial mockup.

Features:
- Upload photos for Top, Bottoms, Outerwear, Shoes, Accessories, Jewelry, and Makeup / Beauty
- Six makeup inspiration slots and three general inspiration slots
- Outfit preview
- Notes and date
- Save multiple looks locally in the browser using IndexedDB
- Print Look button with a printer-friendly layout
- Images stay in the browser/device and are not uploaded to GitHub
- `noindex` metadata discourages search-engine indexing

For GitHub Pages, publish the repository from the `main` branch root.


## Background removal
Use **REMOVE BG** on an uploaded item to create a transparent cutout in the browser. **RESTORE BG** brings the original image back. The first removal can take longer because the browser must download the background-removal model.
