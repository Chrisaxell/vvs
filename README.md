# Systempolet

Browser extension that compares wine/spirit prices between Systembolaget (SE)
and Vinmonopolet (NO). Open a product page on either site and a little card
pops up bottom-right showing what it costs at the other one, per litre, in SEK.

## Run it

```
npm install
npm run build
```

Then in Brave/Chrome: `brave://extensions` → Developer mode on → **Load
unpacked** → pick the `dist/` folder. Visit any product on
systembolaget.se or vinmonopolet.no.

Vinmonopolet has an optional portal-api key you can paste in the popup's
Settings — otherwise it falls back to their public search, which works fine
most of the time.

## Publish it

```
npm run package
```

Produces `systempolet-v<version>.zip` at the project root. Upload that at
[chrome.google.com/webstore/devconsole](https://chrome.google.com/webstore/devconsole)
(one-time $5 dev-account fee). Screenshots (1280×800 or 640×400), a short
tagline, and the icon are the only real content you need to fill in.

## Poke around

- `src/background.ts` — cross-store search & matching lives here
- `src/content/` — the scripts injected into each store
- `src/lib/banner.ts` — the little floating card
- `src/lib/compare.ts` — scoring algorithm (Jaccard + bigrams, volume/ABV penalties)
- `src/icons/icon.svg` — edit this and re-run `npm run build` to regenerate the PNGs

## When it breaks

F12 on any store page, filter the console for `[vvs]`. For the background
worker: `brave://extensions` → click the "service worker" link under
Systempolet.

