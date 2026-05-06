/**
 * OptoMeasure — VR Patient View  (vr.js)
 *
 * Patient phone, inside the cardboard headset.
 * Receives commands from controller via PeerJS WebRTC.
 *
 * KEY POINTS FOR +8.0 D / DUAL-TABLE:
 *  • getActiveSteps(mode) from shared.js is the ONLY step-table accessor.
 *  • handleCommand() sets mode BEFORE indexing steps, so the right table
 *    is always used.
 *  • applyVisualState() composes IPD offset + prism shift in ONE transform.
 *    No marginLeft / transform conflict.
 *  • computeLayout() re-runs 300 ms after fullscreen resolves so
 *    window.innerWidth reflects the final fullscreen viewport.
 *  • Ping-pong keepalive: VR sends {type:'ping'} every 5 s; controller
 *    replies with {type:'pong'}. If 3 pongs are missed the connection
 *    is considered stale and the overlay is shown.
 *  • Debug overlay toggled by pressing 'd' on a keyboard.
 */
(function () {
    'use strict';

    // ── State ─────────────────────────────────────────────────────────────────
    const vrState = {
        currentStep: 0,
        ipd:         VR_CONFIG.defaultIPD,
        mode:        'BO',
        connected:   false,
        peer:        null,
        conn:        null,
        roomCode:    '',
        pingTimer:   null,
        missedPongs: 0,
    };

    // ── DOM helper ────────────────────────────────────────────────────────────
    const $ = id => document.getElementById(id);

    // ── Layout ────────────────────────────────────────────────────────────────
    function computeLayout() {
        const L       = VR_CONFIG.layout;
        const pxPerCm = getDevicePxPerCm();

        const cW = L.containerWidthCm  * pxPerCm.x;
        const cH = L.containerHeightCm * pxPerCm.y;
        const eW = L.eyeWidthCm        * pxPerCm.x;

        const c = $('vrContainer');
        c.style.setProperty('--container-w', cW + 'px');
        c.style.setProperty('--container-h', cH + 'px');
        c.style.setProperty('--eye-w',       eW + 'px');

        console.log(
            '[VR] layout | pxPerCm', pxPerCm.x.toFixed(2) + '×' + pxPerCm.y.toFixed(2),
            '| container', cW.toFixed(0) + '×' + cH.toFixed(0) + 'px',
            '| eyeW', eW.toFixed(0) + 'px',
            '| viewport', window.innerWidth + '×' + window.innerHeight
        );
    }

    // ── Line geometry ─────────────────────────────────────────────────────────
    function renderLines() {
        const linePxH = cmToPixels (VR_CONFIG.layout.lineLengthCm);
        const linePxV = cmToPixelsY(VR_CONFIG.layout.lineLengthCm);
        const thick   = VR_CONFIG.lineThicknessPx;
        const dot     = VR_CONFIG.dotSizePx;
        const half    = dot / 2;

        // Left eye — horizontal
        $('hLineLeft').style.cssText  = `width:${linePxH}px;height:${thick}px;right:${half}px;left:auto;`;
        $('hLineRight').style.cssText = `width:${linePxH}px;height:${thick}px;left:${half}px;right:auto;`;

        // Right eye — vertical
        $('vLineTop').style.cssText    = `height:${linePxV}px;width:${thick}px;bottom:${half}px;top:auto;`;
        $('vLineBottom').style.cssText = `height:${linePxV}px;width:${thick}px;top:${half}px;bottom:auto;`;

        // Dots
        ['dotLeft', 'dotRight'].forEach(id => {
            $(id).style.cssText = `width:${dot}px;height:${dot}px;`;
        });
    }

    // ── Visual state — single transform ───────────────────────────────────────
    /**
     * applyVisualState()
     *
     * Computes leftX and rightX as the TOTAL horizontal offset of the
     * eye-content anchor from its CSS centre position, encoding both:
     *   • IPD correction (moves dot inward/outward to match patient's PD)
     *   • Prism shift    (moves targets to induce convergence / divergence)
     *
     * Everything lives in ONE transform per element — no margin / transform
     * conflict that caused fusion errors in earlier builds.
     *
     * Geometry recap:
     *   eyeWPx   = full pixel width of one half-screen
     *   baseHalf = eyeWPx / 2  → distance from divider to CSS centre
     *   halfIPD  = ipd_mm / 10 * pxPerCm → desired dot-to-divider distance
     *   ipdOff   = halfIPD − baseHalf
     *     positive: dot shifts INWARD  (IPD < baseline → eyes closer together)
     *     negative: dot shifts OUTWARD (IPD > baseline)
     *
     *   shiftPx = step.shiftCm * pxPerCm   (from ACTIVE table)
     *
     *   BO (convergence): left moves right  (+shiftPx), right moves left  (−shiftPx)
     *   BI (divergence):  left moves left   (−shiftPx), right moves right (+shiftPx)
     *   sign = +1 for BO, −1 for BI
     *
     *   LEFT  translateX = −ipdOff + sign * shiftPx
     *   RIGHT translateX =  ipdOff − sign * shiftPx
     */
    function applyVisualState() {
        const steps   = getActiveSteps(vrState.mode);
        const stepIdx = Math.max(0, Math.min(vrState.currentStep, steps.length - 1));
        const step    = steps[stepIdx];

        const px       = getDevicePxPerCm();
        const shiftPx  = step.shiftCm * px.x;

        const eyeWPx    = VR_CONFIG.layout.eyeWidthCm * px.x;
        const baseHalf  = eyeWPx / 2;
        const halfIPDpx = mmToPixels(vrState.ipd) / 2;
        const ipdOff    = halfIPDpx - baseHalf;

        const sign  = (vrState.mode === 'BO') ? 1 : -1;
        const leftX  = -ipdOff + sign * shiftPx;
        const rightX =  ipdOff - sign * shiftPx;

        // Clear any legacy margin (defensive)
        const lc = $('leftContent');
        const rc = $('rightContent');
        lc.style.marginLeft = '';
        rc.style.marginLeft = '';

        lc.style.transform = `translate(calc(-50% + ${leftX}px), -50%)`;
        rc.style.transform = `translate(calc(-50% + ${rightX}px), -50%)`;

        updateDebug(shiftPx, ipdOff, leftX, rightX, step);
    }

    // ── Debug overlay ─────────────────────────────────────────────────────────
    let debugOn = false;
    function updateDebug(shiftPx, ipdOff, leftX, rightX, step) {
        const el = $('debugOverlay');
        if (!el || !debugOn) return;
        const px = getDevicePxPerCm();
        el.textContent =
            `Lens: +8.0 D  |  Mode: ${vrState.mode}  |  Table: ${vrState.mode === 'BI' ? 'stepsBI' : 'steps'}\n` +
            `pxPerCm  x:${px.x.toFixed(2)}  y:${px.y.toFixed(2)}\n` +
            `Step ${vrState.currentStep}  |  shift: ${step.shiftCm} cm = ${shiftPx.toFixed(1)} px  |  prism: ${step.prism} Δ\n` +
            `IPD: ${vrState.ipd} mm  |  ipdOff: ${ipdOff.toFixed(1)} px\n` +
            `leftX: ${leftX.toFixed(1)} px   rightX: ${rightX.toFixed(1)} px\n` +
            `viewport: ${window.innerWidth} × ${window.innerHeight}`;
    }

    // ── Handle commands from controller ───────────────────────────────────────
    function handleCommand(data) {
        switch (data.type) {

            case 'update':
                // Set mode FIRST — must happen before getActiveSteps() is called
                if (data.activeStepTable) vrState.mode = data.activeStepTable;
                else if (data.mode)       vrState.mode = data.mode;

                if (data.ipd) vrState.ipd = data.ipd;

                // Clamp step index to the active table
                vrState.currentStep = Math.max(
                    0,
                    Math.min(data.step, getActiveSteps(vrState.mode).length - 1)
                );
                applyVisualState();
                break;

            case 'reset':
                // Reset may optionally carry a mode
                if (data.mode) vrState.mode = data.mode;
                vrState.currentStep = 0;
                applyVisualState();
                break;

            case 'ipd':
                vrState.ipd = data.value;
                applyVisualState();
                break;

            case 'mode':
                vrState.mode = data.value;
                vrState.currentStep = 0;
                applyVisualState();
                break;

            case 'pong':
                vrState.missedPongs = 0;  // connection alive
                break;
        }
    }

    // ── Keepalive ping ────────────────────────────────────────────────────────
    /**
     * Sends a ping every 5 s. If controller doesn't pong within 3 cycles
     * (15 s), we consider the connection stale and show the overlay.
     */
    function startPing() {
        stopPing();
        vrState.pingTimer = setInterval(function () {
            if (!vrState.connected) return;
            if (vrState.conn && vrState.conn.open) {
                vrState.conn.send({ type: 'ping' });
                vrState.missedPongs++;
                if (vrState.missedPongs >= 3) {
                    console.warn('[VR] No pong for 15 s — assuming stale connection');
                    onDisconnected();
                }
            }
        }, 5000);
    }

    function stopPing() {
        if (vrState.pingTimer) {
            clearInterval(vrState.pingTimer);
            vrState.pingTimer = null;
        }
        vrState.missedPongs = 0;
    }

    // ── UI helpers ────────────────────────────────────────────────────────────
    function onConnected() {
        vrState.connected = true;
        $('connectOverlay').classList.add('hidden');
        $('connIndicator').classList.add('connected');
        startPing();
    }

    function onDisconnected() {
        vrState.connected = false;
        stopPing();
        $('connIndicator').classList.remove('connected');
        $('connectOverlay').classList.remove('hidden');
        const dot = $('connectOverlay').querySelector('.status-dot');
        const txt = $('connectStatus');
        if (dot) dot.className = 'status-dot waiting';
        if (txt) txt.innerHTML =
            '<span class="status-dot waiting"></span> Controller disconnected. Waiting…';
    }

    // ── Fullscreen ────────────────────────────────────────────────────────────
    function requestFullscreen() {
        const el  = document.documentElement;
        const rfs = el.requestFullscreen
                 || el.webkitRequestFullscreen
                 || el.mozRequestFullScreen;
        if (!rfs) return;

        rfs.call(el)
            .then(function () {
                // Re-run layout 300 ms after fullscreen settles so
                // window.innerWidth reflects the fullscreen viewport.
                setTimeout(function () {
                    computeLayout();
                    renderLines();
                    applyVisualState();
                }, 300);
            })
            .catch(function () { /* user denied — ignore */ });

        if (screen.orientation && screen.orientation.lock) {
            screen.orientation.lock('landscape').catch(function () {});
        }
    }

    // ── PeerJS ────────────────────────────────────────────────────────────────
    function initPeer() {
        vrState.roomCode          = generateRoomCode();
        $('roomCode').textContent = vrState.roomCode;

        const peerId   = 'optovr-' + vrState.roomCode.toLowerCase();
        const peerOpts = {
            debug: 0,
            config: {
                iceServers: [
                    { urls: 'stun:stun.l.google.com:19302'  },
                    { urls: 'stun:stun1.l.google.com:19302' },
                    { urls: 'stun:stun2.l.google.com:19302' },
                ],
            },
        };

        // Destroy any existing peer before creating a new one
        if (vrState.peer) {
            try { vrState.peer.destroy(); } catch (_) {}
            vrState.peer = null;
        }

        vrState.peer = new Peer(peerId, peerOpts);

        vrState.peer.on('open', function () {
            console.log('[VR] Peer ready:', peerId);
        });

        vrState.peer.on('connection', function (conn) {
            // Reject a second connection if already connected
            if (vrState.connected) {
                conn.close();
                return;
            }
            vrState.conn = conn;

            conn.on('open', function () {
                onConnected();
                // Send confirmation + initial layout info to controller
                conn.send({
                    type:     'connected',
                    roomCode: vrState.roomCode,
                    lensPower: VR_CONFIG.lensPower,
                });
                requestFullscreen();
            });

            conn.on('data',  handleCommand);
            conn.on('close', onDisconnected);
            conn.on('error', function (err) {
                console.error('[VR] conn error', err);
                onDisconnected();
            });
        });

        vrState.peer.on('error', function (err) {
            console.error('[VR] peer error:', err.type);
            const txt = $('connectStatus');
            if (txt) txt.innerHTML =
                `<span class="status-dot waiting"></span> Error: ${err.type}. Retrying…`;
            // Retry with a new peer after 3 s
            setTimeout(initPeer, 3000);
        });
    }

    // ── Init ──────────────────────────────────────────────────────────────────
    function init() {
        computeLayout();
        renderLines();
        applyVisualState();
        initPeer();

        // Recompute on orientation change / resize
        window.addEventListener('resize', function () {
            computeLayout();
            renderLines();
            applyVisualState();
        });

        // Tap → request fullscreen (when already connected)
        document.addEventListener('click', function (e) {
            if (e.target.closest('#btnCopy')) return;
            if (vrState.connected) requestFullscreen();
        });

        // Copy room-code button
        const btnCopy = $('btnCopy');
        if (btnCopy) {
            btnCopy.addEventListener('click', async function (e) {
                e.stopPropagation();
                try {
                    await navigator.clipboard.writeText(vrState.roomCode);
                    btnCopy.textContent = '✅';
                    setTimeout(() => btnCopy.textContent = '📋', 2000);
                } catch (_) {}
            });
        }

        // Debug overlay toggle (keyboard 'd')
        document.addEventListener('keydown', function (e) {
            if (e.key === 'd' || e.key === 'D') {
                debugOn = !debugOn;
                const el = $('debugOverlay');
                if (el) el.style.display = debugOn ? 'block' : 'none';
                if (debugOn) applyVisualState();
            }
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
