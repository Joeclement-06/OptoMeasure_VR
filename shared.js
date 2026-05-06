/**
 * OptoMeasure — Shared Constants & Calculations  (shared.js)
 *
 * Device : Vivo Y3 / 1938  (6.27" × 2.94" active display)
 * Lens   : +8.0 D  |  Magnification ≈ 4×  |  Image distance ≈ 36 cm
 *
 * Formulae
 *   Base-Out  y = 65x + 2   (y = prism Δ, x = per-eye shift in cm)
 *   Base-In   y = 55x + 2   (gentler slope — fights +8 D convergence bias)
 *
 * FIX LOG (vs original +7.5 D build)
 *  1. lensPower 7.5 → 8.0 D
 *  2. imageDistance 40 → 36 cm  (+8 D brings virtual image closer)
 *  3. formula.m  80 → 65  (BO)
 *  4. formulaBI  added  m = 55, c = 2  (BI gentler)
 *  5. stepsBI table added with 7 steps (max 24 Δ), smaller shifts
 *  6. physicalWidthCm / HeightCm corrected (14.6/6.8 → 15.93/7.47)
 *  7. getDevicePxPerCm() uses window.innerWidth (CSS px), not screen.width
 *  8. defaultIPD corrected 62 → 75 mm
 *  9. BASE_IN_OFFSET = 4  (display compensation for convergence bias)
 * 10. getActiveSteps(mode) exported as single source of truth for both files
 */

'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// CONFIG
// ─────────────────────────────────────────────────────────────────────────────
const VR_CONFIG = {

    // ── Optics ───────────────────────────────────────────────────────────────
    magnification:  4,
    lensPower:      8.0,   // +8.0 D
    objectDistance: 10,    // cm (target distance from lens)
    imageDistance:  36,    // cm (virtual image perceived distance, +8 D)

    // ── Device: Vivo Y3 (Vivo 1938) ─────────────────────────────────────────
    device: {
        name:             'Vivo Y3 (1938)',
        physicalWidthCm:  15.93,   // 6.27" × 2.54
        physicalHeightCm:  7.47,   // 2.94" × 2.54
        resolutionW:      1544,    // native landscape width (px)
        resolutionH:       720,    // native landscape height (px)
        ppi:               270,    // informational only
    },

    // ── Layout (physical cm) ─────────────────────────────────────────────────
    layout: {
        containerWidthCm:  15.93,
        containerHeightCm:  7.47,
        eyeWidthCm:         7.965,  // containerWidthCm / 2
        lineLengthCm:       3,      // 3 cm each side of dot
    },

    // ── Visual elements ──────────────────────────────────────────────────────
    lineLengthCm:    3,
    lineThicknessPx: 4,
    dotSizePx:       12,

    // ── IPD ──────────────────────────────────────────────────────────────────
    defaultIPD: 75,   // mm — geometric baseline for this device
    minIPD:     50,
    maxIPD:     90,

    // ── Base-Out formula  y = 65x + 2 ───────────────────────────────────────
    formula:   { m: 65, c: 2 },

    // ── Base-In formula   y = 55x + 2 ───────────────────────────────────────
    // Smaller m → smaller physical shift per prism step.
    // +8 D naturally biases eyes toward convergence, so BI needs gentler steps.
    formulaBI: { m: 55, c: 2 },
};

// ─────────────────────────────────────────────────────────────────────────────
// BASE-IN DISPLAY OFFSET
// Subtracted from shown prism in BI mode to reflect net divergence demand
// after correcting for the +8 D convergence bias.
// ─────────────────────────────────────────────────────────────────────────────
const BASE_IN_OFFSET = 4;   // Δ

// ─────────────────────────────────────────────────────────────────────────────
// STEP TABLES
// shiftCm = (prism - c) / m  for each formula
// ─────────────────────────────────────────────────────────────────────────────

/** Base-Out steps  (formula m=65, max 38 Δ) */
VR_CONFIG.steps = [
    { index: 0, shiftCm: 0,      prism: 0  },
    { index: 1, shiftCm: 0.092,  prism: 8  },   // (8-2)/65
    { index: 2, shiftCm: 0.200,  prism: 15 },   // (15-2)/65
    { index: 3, shiftCm: 0.277,  prism: 20 },   // (20-2)/65
    { index: 4, shiftCm: 0.338,  prism: 24 },   // (24-2)/65
    { index: 5, shiftCm: 0.431,  prism: 30 },   // (30-2)/65
    { index: 6, shiftCm: 0.554,  prism: 38 },   // (38-2)/65
];

/** Base-In steps  (formula m=55, gentler, max 24 Δ) */
VR_CONFIG.stepsBI = [
    { index: 0, shiftCm: 0,      prism: 0  },
    { index: 1, shiftCm: 0.055,  prism: 5  },   // gentle entry  (5-2)/55
    { index: 2, shiftCm: 0.109,  prism: 8  },   // (8-2)/55
    { index: 3, shiftCm: 0.164,  prism: 11 },   // intermediate  (11-2)/55
    { index: 4, shiftCm: 0.236,  prism: 15 },   // (15-2)/55
    { index: 5, shiftCm: 0.327,  prism: 20 },   // (20-2)/55
    { index: 6, shiftCm: 0.400,  prism: 24 },   // (24-2)/55
];

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS — used by both controller.js and vr.js
// ─────────────────────────────────────────────────────────────────────────────

/**
 * getActiveSteps(mode)
 * Single source of truth — both controller.js and vr.js call this.
 * @param {'BO'|'BI'} mode
 * @returns {Array} step objects
 */
function getActiveSteps(mode) {
    return (mode === 'BI') ? VR_CONFIG.stepsBI : VR_CONFIG.steps;
}

/**
 * shiftToPrism(shiftCm, mode)
 * Uses the formula for the given mode.
 */
function shiftToPrism(shiftCm, mode) {
    const f = (mode === 'BI') ? VR_CONFIG.formulaBI : VR_CONFIG.formula;
    return f.m * shiftCm + f.c;
}

/**
 * prismToShift(prism, mode)
 * Inverse formula.
 */
function prismToShift(prism, mode) {
    const f = (mode === 'BI') ? VR_CONFIG.formulaBI : VR_CONFIG.formula;
    return (prism - f.c) / f.m;
}

/**
 * getAdjustedPrism(prism, mode)
 * Returns the display prism value. In BI mode subtracts BASE_IN_OFFSET
 * to reflect the net divergence demand after the +8 D convergence bias.
 */
function getAdjustedPrism(prism, mode) {
    if (mode === 'BI') return Math.max(0, prism - BASE_IN_OFFSET);
    return prism;
}

/**
 * getDevicePxPerCm()
 *
 * CRITICAL FIX: uses window.innerWidth (CSS pixels), NOT screen.width.
 * On Android Chrome, screen.width often returns native physical pixels
 * (e.g. 1544), making pxPerCm ~2× too large.
 *
 * Must be called AFTER fullscreen resolves (vr.js re-calls from setTimeout).
 *
 * @returns {{ x: number, y: number }}  CSS pixels per cm
 */
function getDevicePxPerCm() {
    const sw = Math.max(window.innerWidth,  window.innerHeight);
    const sh = Math.min(window.innerWidth,  window.innerHeight);
    return {
        x: sw / VR_CONFIG.device.physicalWidthCm,
        y: sh / VR_CONFIG.device.physicalHeightCm,
    };
}

/** cm → CSS pixels (horizontal) */
function cmToPixels(cm)  { return cm * getDevicePxPerCm().x; }
/** cm → CSS pixels (vertical) */
function cmToPixelsY(cm) { return cm * getDevicePxPerCm().y; }
/** mm → CSS pixels (horizontal) */
function mmToPixels(mm)  { return (mm / 10) * getDevicePxPerCm().x; }

/** Generate a random 6-character room code */
function generateRoomCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 6; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
}
