/**
 * OptoMeasure — Shared Constants & Calculations  (shared.js)
 *
 * Device : Vivo Y3 / 1938  (6.27" × 2.94" active display)
 * Lens   : +8.0 D  |  Magnification ≈ 4×  |  Image distance ≈ 80 cm
 *
 * Formulae
 *   Base-Out  y = 65x + 2   (y = prism Δ, x = per-eye shift in cm)
 *   Base-In   y = 35x + 1   (reduced divergence demand for easier BI fusion)
 *
 * FIX LOG (vs original +7.5 D build)
 *  1. lensPower 7.5 → 8.0 D
 *  2. imageDistance 36 → 80 cm (reduced accommodative convergence bias)
 *  3. formula.m  80 → 65  (BO)
 *  4. formulaBI reduced 55x+2 → 35x+1
 *  5. stepsBI table rebuilt (gentler divergence progression, max 12 Δ)
 *  6. physicalWidthCm / HeightCm corrected (14.6/6.8 → 15.93/7.47)
 *  7. getDevicePxPerCm() uses window.innerWidth (CSS px), not screen.width
 *  8. defaultIPD corrected 75 → 63 mm (physiological baseline)
 *  9. BASE_IN_OFFSET removed (0 Δ)
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

    // Increased from 36 → 80 cm
    // Reduces convergence bias and improves BI fusion.
    imageDistance:  80,

    // ── Device: Vivo Y3 (Vivo 1938) ─────────────────────────────────────────
    device: {
        name:             'Vivo Y3 (1938)',
        physicalWidthCm:  15.93,
        physicalHeightCm:  7.47,
        resolutionW:      1544,
        resolutionH:       720,
        ppi:               270,
    },

    // ── Layout (physical cm) ─────────────────────────────────────────────────
    layout: {
        containerWidthCm:  15.93,
        containerHeightCm:  7.47,
        eyeWidthCm:         7.965,
        lineLengthCm:       3,
    },

    // ── Visual elements ──────────────────────────────────────────────────────
    lineLengthCm:    3,
    lineThicknessPx: 4,
    dotSizePx:       12,

    // ── IPD ──────────────────────────────────────────────────────────────────
    // Reduced from 75 mm → 63 mm
    // Prevents excessive convergence preload.
    defaultIPD: 63,
    minIPD:     50,
    maxIPD:     75,

    // ── Base-Out formula  y = 65x + 2 ───────────────────────────────────────
    formula: { m: 65, c: 2 },

    // ── Base-In formula  y = 35x + 1 ────────────────────────────────────────
    // Gentler BI progression for +8 D VR optics.
    formulaBI: { m: 35, c: 1 },
};

// ─────────────────────────────────────────────────────────────────────────────
// BASE-IN DISPLAY OFFSET
// Removed artificial display compensation.
// Displayed prism now matches actual vergence demand.
// ─────────────────────────────────────────────────────────────────────────────
const BASE_IN_OFFSET = 0;

// ─────────────────────────────────────────────────────────────────────────────
// STEP TABLES
// shiftCm = (prism - c) / m
// ─────────────────────────────────────────────────────────────────────────────

/** Base-Out steps  (formula m=65, max 38 Δ) */
VR_CONFIG.steps = [
    { index: 0, shiftCm: 0.000, prism: 0  },

    // (8-2)/65
    { index: 1, shiftCm: 0.092, prism: 8  },

    // (15-2)/65
    { index: 2, shiftCm: 0.200, prism: 15 },

    // (20-2)/65
    { index: 3, shiftCm: 0.277, prism: 20 },

    // (24-2)/65
    { index: 4, shiftCm: 0.338, prism: 24 },

    // (30-2)/65
    { index: 5, shiftCm: 0.431, prism: 30 },

    // (38-2)/65
    { index: 6, shiftCm: 0.554, prism: 38 },
];

/** Base-In steps  (formula m=35, c=1, max 12 Δ) */
VR_CONFIG.stepsBI = [
    { index: 0, shiftCm: 0.000, prism: 0  },

    // (2-1)/35
    { index: 1, shiftCm: 0.029, prism: 2 },

    // (4-1)/35
    { index: 2, shiftCm: 0.086, prism: 4 },

    // (6-1)/35
    { index: 3, shiftCm: 0.143, prism: 6 },

    // (8-1)/35
    { index: 4, shiftCm: 0.200, prism: 8 },

    // (10-1)/35
    { index: 5, shiftCm: 0.257, prism: 10 },

    // (12-1)/35
    { index: 6, shiftCm: 0.314, prism: 12 },
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
 * BI offset removed — displayed prism equals actual prism.
 */
function getAdjustedPrism(prism, mode) {
    return prism;
}

/**
 * getDevicePxPerCm()
 *
 * Uses CSS viewport pixels, not physical hardware pixels.
 *
 * Must be called AFTER fullscreen resolves.
 *
 * @returns {{ x: number, y: number }}
 */
function getDevicePxPerCm() {
    const sw = Math.max(window.innerWidth, window.innerHeight);
    const sh = Math.min(window.innerWidth, window.innerHeight);

    return {
        x: sw / VR_CONFIG.device.physicalWidthCm,
        y: sh / VR_CONFIG.device.physicalHeightCm,
    };
}

/** cm → CSS pixels (horizontal) */
function cmToPixels(cm) {
    return cm * getDevicePxPerCm().x;
}

/** cm → CSS pixels (vertical) */
function cmToPixelsY(cm) {
    return cm * getDevicePxPerCm().y;
}

/** mm → CSS pixels (horizontal) */
function mmToPixels(mm) {
    return (mm / 10) * getDevicePxPerCm().x;
}

/** Generate a random 6-character room code */
function generateRoomCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

    let code = '';

    for (let i = 0; i < 6; i++) {
        code += chars.charAt(
            Math.floor(Math.random() * chars.length)
        );
    }

    return code;
}
