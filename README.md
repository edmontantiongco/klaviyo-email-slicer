# Klaviyo Email Slicer

This app runs on your own machine. It takes a month of email designs from Figma and gets them into Klaviyo:

```
Figma section ─► detect email frames ─► layer-aware auto-slice ─► ✋ human review
           ─► MozJPEG/OxiPNG compression ─► ✋ approval gate ─► Klaviyo upload ─► update cloned campaign
```

## Quick start

Requirements: Node.js **20.11+** (22 LTS recommended).

```bash
npm install
cp .env.example .env        # optional – you can also paste keys in the app's Settings
npm run dev                 # UI → http://localhost:5173 , API → http://localhost:8787
```

Run `npm start` instead to build once and serve everything from http://localhost:8787.

### Tokens

| Where | What | Scopes |
|---|---|---|
| Figma → Settings → Security → Personal access tokens | `FIGMA_TOKEN` | File content: **Read-only** |
| Klaviyo → Settings → API keys → Create private key | `KLAVIYO_PRIVATE_KEY` | Campaigns **Read + Write**, Templates **Read + Write**, Images **Read + Write** |

You can put keys in `.env` or paste them into **Settings** (⚙). Keys entered in Settings are stored in your browser and are only sent to the local API server. Klaviyo private keys can't be used directly from a browser, so the small Express server (`server/`) makes those calls for you.

## Daily workflow

1. **Import.** In Figma, right-click your month's section (for example "October 2026") → *Copy link to selection*, then paste the link. The app lists every email frame in that section with a thumbnail, and you tick the ones you want (for example Oct 1). If you don't have Figma access, drag exported PNG/JPGs onto the upload box instead.
2. **Slice.** Each email is rendered by Figma at a 1200 px width. Auto-slice then reads the **layer tree** and cuts only where no text, button, logo or image is crossed.
   - It prefers your top-level sections (Header, Hero, Products…) and uses their names as slice names.
   - It splits rows that are too tall and merges slivers that are too short.
   - It detects **multi-column grids** (product/category tiles, linked nav bars) and splits those rows into cells.
   - It pre-fills **alt text** and **links** from the Figma copy and text hyperlinks.
   - Rows and columns always tile the frame exactly, so there are no overlaps and no gaps.
   - To edit by hand: <kbd>H</kbd> adds a horizontal cut, <kbd>V</kbd> adds a column cut. Drag lines to move them; they snap to safe gaps, and holding <kbd>Alt</kbd> turns snapping off. <kbd>Del</kbd> removes the selected cut, arrow keys nudge it, and <kbd>⌘Z</kbd>/<kbd>⇧⌘Z</kbd> undo and redo. <kbd>L</kbd> shows the detected layers.
   - The **Checks** tab flags any cut that goes through text or a button (red) or through an image (amber).
3. **Optimize & review.** Every slice is compressed in Web Workers with the same codecs Squoosh.app uses:
   - **Auto** keeps lossless PNG for flat artwork when it's no bigger than JPEG. For everything else it uses MozJPEG, binary-searching for the highest quality (88 → 55 by default) that fits under your **max size** (500 KB by default).
   - **Review one by one** opens a before/after slider. <kbd>A</kbd> approves the slice and jumps to the next unapproved one.
   - **Email preview** renders the actual generated HTML from the compressed slices, at desktop and mobile widths.
4. **Upload.** Pre-flight checks cover approvals, size budget, missing links or alt text, and the API key. Nothing uploads until **every slice is approved**.
   - The server paces uploads to stay within Klaviyo's limits (3/s, 100/min).
   - Each image is named in Klaviyo exactly like its slice's **Name** in the app (e.g. `Test 1011 - 1`). If you rename a slice after uploading, the upload button changes to **Update N names in Klaviyo**, and the existing image is renamed rather than uploaded again. **Update campaign** syncs names automatically. The file name prefix is only used for ZIP and HTML exports.
   - Files are named `oct-1-autumn-edit_05b_products-2.jpg`.
5. **Update the cloned campaign.** In Klaviyo, clone last month's campaign (it must be a **Draft** built with the **drag-and-drop editor**) and paste its link into **Update cloned campaign**.
   - The app lists every image block in the email. Tick the old images to remove. By default the header image (logo) and universal blocks (shared header/footer) are left alone.
   - **Remove from campaign** deletes the ticked images from the draft right away (after a confirm), without adding anything. The app remembers where they were and shows it ("The slices will go where it was: Section 2 · Row 1"). **Update campaign** then puts the slices in that spot. Ticked images always take priority over a remembered spot, and **Forget** clears it.
   - **Preview changes** shows exactly what will happen: how many images are removed, how many slice rows are inserted, and where. This step is required.
   - **Update campaign** uploads any slices not yet uploaded, then swaps them in. The slices go where the first removed image was, as native drag-and-drop **image blocks** with your links and alt text. Text, buttons, header, footer, subject and audience are untouched, and the email **stays in the drag-and-drop editor**.
   - Multi-column rows use Klaviyo's column presets (2–4 equal columns, 25/75, 33/67, 25/50/25 …) when the slice widths match within ~0.5%. Otherwise the row becomes a drag-and-drop **HTML block** with exact widths, so nothing gets distorted.
   - Nothing is scheduled or sent, and no copy of the old content is kept, so the change can't be undone from the app. Open the campaign in Klaviyo, check it, and send a test.
   - If Klaviyo won't let the app edit the email's content directly, the app makes a temporary drag-and-drop template, assigns it to the campaign's email (Klaviyo copies it in), and deletes the temporary template. The result is the same.
   - The paste-ready HTML (full template or rows only) is still there as a manual fallback.

The header's ⬇ button exports a **ZIP** with the images, `index.html` and `manifest.json` (coordinates, sizes, links, alt text). Your workspace is saved in IndexedDB, so a page refresh doesn't lose any work.

## Project layout

```
server/                 Express API (Figma + Klaviyo proxy, rate limiting, retries)
src/lib/slicing/        Slicing engine (pure TS, unit-tested)
  figma.ts              Figma node tree → blockers/sections, frame discovery, URL parsing
  pixels.ts             Pixel analysis fallback for flat images
  auto.ts               Candidate cut lines + dynamic-programming optimiser + grid detection
  layout.ts             Editable row/column model (always tiles exactly)
  validate.ts           "Does this cut go through text/buttons/images?"
  suggest.ts            Alt text / link suggestions from Figma copy
src/lib/compress/       @jsquash MozJPEG + OxiPNG worker pool with target-size search
src/lib/html.ts         Email-safe table HTML (Outlook/Gmail friendly)
src/store/              Zustand stores (settings in localStorage, workspace in IndexedDB)
src/components/         React + shadcn/ui screens (import, slice, optimize, upload)
```

Scripts: `npm test` runs the slicing engine tests, `npm run typecheck`, and `npm run lint` (oxlint).

## Tuning tips

- **Too many or too few slices?** Use *Auto-slice → Slice density*, *Max/Min slice height*, then *Re-run auto-slice* (undo works).
- **A slice can't get under the size limit?** Split it, set it to JPEG, or lower the quality floor.
- **Coloured text looks soft?** Turn on *Sharper coloured text* (4:4:4 chroma).
- **Designs at 600 px instead of 1200 px?** Leave export scale on *Auto*, which renders them at 2×.

## Roadmap ideas

- A Figma plugin "Send to Slicer" button, so you don't need to copy and paste URLs.
- Per-brand presets (budgets, footer, prefixes) and Klaviyo-hosted template partials.
- Inbox screenshot QA (e.g. Litmus / Email on Acid) as an extra gate before sending.
