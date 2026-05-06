# OptoMeasure — VR Fusional Vergence  (+8.0 D Build)

> Two-device WebRTC system for measuring fusional vergence using a Vivo Y3 smartphone and Google Cardboard with **+8.0 D lenses**. No app, no server — open in any modern mobile browser over HTTPS.

---

## File Structure

```
optomeasure/
├── index.html        Landing page (role selector)
├── styles.css        Landing page styles
├── shared.js         ★ Shared config, formulas, step tables, pixel helpers
├── controller.html   Doctor / examiner interface
├── controller.css    Controller styles
├── controller.js     Controller logic (PeerJS sender)
├── vr.html           Patient VR split-screen
├── vr.css            VR screen styles
├── vr.js             VR logic (PeerJS receiver + renderer)
└── README.md         This file
```

**Load order per page (critical — do not reorder):**

```
peerjs CDN  →  shared.js  →  controller.js   (controller page)
peerjs CDN  →  shared.js  →  vr.js           (VR page)
```

`shared.js` must load before the page scripts because both depend on
`VR_CONFIG`, `getActiveSteps()`, `getDevicePxPerCm()`, etc.

---

## Optics — +8.0 D Lens

| Parameter | Value |
|---|---|
| Lens power | +8.0 D |
| Focal length | 12.5 cm |
| Object distance (target on screen) | 10 cm |
| Virtual image distance | ~36 cm |
| Effective magnification | ~4× |

### Formulae

| Mode | Formula | Notes |
|---|---|---|
| Base-Out (convergence) | **y = 65x + 2** | y = prism Δ, x = per-eye shift cm |
| Base-In  (divergence)  | **y = 55x + 2** | Gentler slope — +8 D biases toward convergence |

Why two formulae? The +8.0 D lenses create an inherent convergence bias. For Base-In testing the eyes are already partially converged, so the same physical shift creates less *net* divergence demand. Using m = 55 instead of 65 keeps clinical step sizes accurate for BI.

---

## Step Tables

### Base-Out (BO)  —  y = 65x + 2

| Step | Shift (cm) | Prism (Δ) |
|---|---|---|
| 0 | 0.000 | 0  |
| 1 | 0.092 | 8  |
| 2 | 0.200 | 15 |
| 3 | 0.277 | 20 |
| 4 | 0.338 | 24 |
| 5 | 0.431 | 30 |
| 6 | 0.554 | 38 |

### Base-In (BI)  —  y = 55x + 2  (gentler, max 24 Δ)

| Step | Shift (cm) | Raw Prism (Δ) | Displayed Prism* |
|---|---|---|---|
| 0 | 0.000 | 0  | 0  |
| 1 | 0.055 | 5  | 1  |
| 2 | 0.109 | 8  | 4  |
| 3 | 0.164 | 11 | 7  |
| 4 | 0.236 | 15 | 11 |
| 5 | 0.327 | 20 | 16 |
| 6 | 0.400 | 24 | 20 |

\* Displayed prism = raw prism − BASE_IN_OFFSET (4 Δ). This compensates for the
+8 D convergence bias so the shown value reflects the net divergence demand.

---

## Bug Fixes vs Original +7.5 D Build

### 1 — Physical screen dimensions (Critical)
`physicalWidthCm` 14.6 → **15.93 cm**, `physicalHeightCm` 6.8 → **7.47 cm**  
(6.27" × 2.54 and 2.94" × 2.54). Wrong dimensions caused ~9% physical error in every shift value.

### 2 — `screen.width` vs `window.innerWidth` (Critical)
`getDevicePxPerCm()` now uses `window.innerWidth` (CSS pixels).  
On Android Chrome, `screen.width` often returns native hardware pixels (1544 for this device), making the scale factor ≈ 2× too large, doubling every on-screen shift.

### 3 — IPD + Shift applied via conflicting CSS properties (Critical)
Old code: IPD via `marginLeft`, shift via `transform`. These two positional systems fight each other.  
Fixed: Both are composed in **one `translate()` call** inside `applyVisualState()`.

### 4 — Single step table used for both modes (Clinical accuracy)
Old code used `VR_CONFIG.steps` for both BO and BI.  
Fixed: `VR_CONFIG.stepsBI` (m = 55) is used in BI mode via `getActiveSteps(mode)`.

### 5 — `getActiveSteps()` as a shared single source of truth
`shared.js` exports `getActiveSteps(mode)`. Both `controller.js` and `vr.js` call
this — they can never desync on which table to use.

### 6 — Mode set before step indexing in `handleCommand()` (vr.js)
If `activeStepTable` or `mode` comes in an update packet, `vrState.mode` is set
**before** `activeSteps()` is called, preventing the VR from indexing the wrong table.

### 7 — Dynamic step table HTML (controller.js)
`rebuildStepTable()` injects rows from the active JS array into `#stepTableBody`.
The HTML no longer contains hardcoded rows, so the table always matches the actual
step data including BI mode's different shifts and prism values.

### 8 — Post-fullscreen layout recompute (vr.js)
`computeLayout()` is called again 300 ms after fullscreen resolves so
`window.innerWidth` reflects the fullscreen viewport dimensions, not the pre-FS value.

### 9 — Ping-pong keepalive (vr.js ↔ controller.js)
VR sends `{type:'ping'}` every 5 s; controller replies `{type:'pong'}`.  
If 3 consecutive pongs are missed (15 s silence), the VR shows the reconnect overlay
rather than appearing frozen on the last prism state.

### 10 — Peer destroyed before reconnect
Both files call `peer.destroy()` before creating a new `Peer` object. Without this,
ghost peers accumulate on PeerJS signalling servers and cause ID collisions.

### 11 — `conn.open` guard in `sendCommand()`
`ctrl.conn.open` is checked before every `.send()` to prevent "not open" exceptions
on half-closed connections.

---

## Setup

### Requirements
- Two smartphones with **Chrome 80+** (or any modern WebView browser)
- Shared Wi-Fi or mobile hotspot (for PeerJS STUN relay)
- VR cardboard with **+8.0 D lenses**
- **HTTPS** hosting (required for `requestFullscreen()` and clipboard API)

### Hosting Options

**Netlify Drop (easiest)**
1. Go to [app.netlify.com/drop](https://app.netlify.com/drop)
2. Drag the project folder into the browser.
3. Share the live HTTPS URL with both phones.

**GitHub Pages**
1. Push folder to a GitHub repo.
2. Settings → Pages → Source: `main` branch, `/ (root)`.
3. Access `https://username.github.io/repo/`.

**Local HTTPS (dev)**
```bash
# Install mkcert (once)
brew install mkcert && mkcert -install      # macOS
# or: choco install mkcert (Windows)

mkcert localhost
npx serve . --ssl-cert localhost.pem --ssl-key localhost-key.pem -p 8443
```

---

## Usage — Step by Step

1. **VR phone** → open `vr.html` → note the 6-character room code.
2. **Doctor's phone** → open `controller.html` → type code → tap **Connect**.
3. Green dot appears on VR phone; VR goes fullscreen + locks landscape.
4. Insert VR phone into cardboard headset.
5. Adjust **IPD slider** to match the patient's pupillary distance.
6. Select **Base-Out** mode (convergence test).
7. Tap **+** to advance steps one at a time.
8. When patient reports diplopia → tap **Record Break**.
9. Tap **−** to reduce prism; when fusion returns → tap **Record Recovery**.
10. Tap **Clear Results**, switch to **Base-In**, repeat.

---

## Calibration (First Use)

### 1 — Verify screen dimensions
Open `vr.html` → connect → press `D` on a keyboard to open the debug overlay.
Check `pxPerCm x:` value.

For Vivo Y3 in fullscreen landscape (CSS viewport ≈ 780 px wide):  
Expected: `780 / 15.93 ≈ 48.97 px/cm`

If the value is ~2× that, your browser is returning physical pixels from
`window.innerWidth` — file this as a browser-specific issue and adjust
`physicalWidthCm` accordingly.

### 2 — Measure on-screen shift
Set Step 1 (shift = 0.092 cm = 0.92 mm). Remove phone from headset.
With digital calipers, measure the dot displacement from the half-screen centre.
Expected: **0.92 mm ± 0.1 mm**.

### 3 — IPD baseline
Set IPD = 79.6 mm (theoretical baseline: `eyeWidthCm/2 × 10 = 39.8 mm × 2`).  
Dot should sit exactly at the geometric centre of each half (no horizontal offset).

---

## Keyboard Shortcuts (Controller)

| Key | Action |
|---|---|
| `+` / `=` / `↑` / `→` | Step forward |
| `−` / `↓` / `←` | Step backward |
| `R` | Reset to Step 0 |
| `I` | Toggle BO ↔ BI |
| `B` | Record Break |
| `V` | Record Recovery |

| Key (VR phone, keyboard attached) | Action |
|---|---|
| `D` | Toggle debug overlay |

---

## Troubleshooting

| Problem | Likely cause | Fix |
|---|---|---|
| Cannot connect | Both phones need internet (for STUN) | Confirm Wi-Fi / mobile data on both |
| VR screen doesn't go fullscreen | Needs HTTPS or a user gesture | Use HTTPS hosting; tap screen after connecting |
| Dots not centred at baseline | Wrong `physicalWidthCm` or `window.innerWidth` returning physical px | Check debug overlay pxPerCm; re-measure screen |
| Shift appears double the expected | `screen.width` being used (old build) | Confirm you are running the v2 build with `window.innerWidth` |
| BI mode shift looks the same as BO | Old single-table build | Confirm `vr.js` calls `getActiveSteps(vrState.mode)` |
| "Connection lost" after 15 s with no activity | Ping-pong timeout | Normal — move a step on controller to restore; the overlay will reconnect automatically when controller re-sends |

---

## Technical Reference

### PeerJS IDs

| Role | ID format |
|---|---|
| VR (receiver) | `optovr-{roomcode lowercase}` |
| Controller (sender) | `optoctrl-{timestamp}` |

### Message Protocol

**Controller → VR**
```js
// Full visual state update
{
  type:            'update',
  step:            3,           // step index
  shiftCm:         0.277,       // cross-check
  prism:           20,          // raw prism from table
  adjustedPrism:   20,          // display prism (BI: raw − 4)
  mode:            'BO',        // 'BO' | 'BI'
  activeStepTable: 'BO',        // explicit table selector (same as mode)
  ipd:             72,          // mm
}

// Reset
{ type: 'reset', mode: 'BO' }

// IPD-only
{ type: 'ipd', value: 68 }

// Pong (reply to VR ping)
{ type: 'pong' }
```

**VR → Controller**
```js
// Connection confirmation
{ type: 'connected', roomCode: 'AB3XY2', lensPower: 8.0 }

// Keepalive (every 5 s)
{ type: 'ping' }
```

### CSS Custom Properties (VR Container)

Set by `computeLayout()`:

| Property | Example | Description |
|---|---|---|
| `--container-w` | `780px` | Full VR container CSS width |
| `--container-h` | `364px` | Full VR container CSS height |
| `--eye-w` | `390px` | CSS width of each half-screen |

---

*OptoMeasure is a research and educational tool. It is not a certified medical device and should not replace calibrated clinical instruments for diagnostic purposes.*
