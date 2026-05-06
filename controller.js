/**
 * OptoMeasure — Controller  (controller.js)
 *
 * Doctor's phone. Connects to VR device via PeerJS WebRTC.
 *
 * KEY POINTS FOR +8.0 D / DUAL-TABLE:
 *  • getActiveSteps(mode) from shared.js is the ONLY step-table accessor.
 *  • The HTML step table is rebuilt dynamically when mode changes, so it
 *    always shows the correct shifts/prisms for BO or BI.
 *  • sendUpdate() includes both `mode` and `activeStepTable` fields so
 *    vr.js cannot desync even if it receives a stale packet.
 *  • adjustedPrism is sent for logging reference; vr.js ignores it (it
 *    re-calculates from shiftCm + mode).
 *  • Connection guard: sendCommand() checks conn.open before every send.
 *  • Peer is destroyed before a reconnect attempt to prevent ghost peers.
 */
(function () {
    'use strict';

    // ── State ─────────────────────────────────────────────────────────────────
    const ctrl = {
        currentStep: 0,
        mode:        'BO',
        ipd:         VR_CONFIG.defaultIPD,
        connected:   false,
        peer:        null,
        conn:        null,
    };

    // ── DOM helper ────────────────────────────────────────────────────────────
    const $ = id => document.getElementById(id);

    // ── Toast ─────────────────────────────────────────────────────────────────
    function showToast(msg, duration = 2200) {
        const t = $('toast');
        t.textContent = msg;
        t.classList.add('show');
        clearTimeout(t._timer);
        t._timer = setTimeout(() => t.classList.remove('show'), duration);
    }

    // ── Dynamic step table ────────────────────────────────────────────────────
    /**
     * Rebuilds the visible step table rows to match the active step list.
     * Called on init and every time the mode changes.
     */
    function rebuildStepTable() {
        const steps    = getActiveSteps(ctrl.mode);
        const tbody    = $('stepTableBody');
        tbody.innerHTML = '';

        steps.forEach((s, i) => {
            if (i === 0) return; // skip step-0 (baseline row)
            const row = document.createElement('div');
            row.className = 'step-row';
            row.dataset.step = String(i);
            const adjP = getAdjustedPrism(s.prism, ctrl.mode);
            row.innerHTML =
                `<span>${i}</span>` +
                `<span>${s.shiftCm.toFixed(3)}</span>` +
                `<span>${adjP}</span>`;
            tbody.appendChild(row);
        });
    }

    // ── Step table highlighting ────────────────────────────────────────────────
    function highlightStep() {
        document.querySelectorAll('.step-row[data-step]').forEach(row => {
            const s = parseInt(row.dataset.step, 10);
            row.classList.remove('active', 'passed');
            if (s === ctrl.currentStep)    row.classList.add('active');
            else if (s < ctrl.currentStep) row.classList.add('passed');
        });
    }

    // ── Full UI refresh ───────────────────────────────────────────────────────
    function updateUI() {
        const steps        = getActiveSteps(ctrl.mode);
        const step         = steps[ctrl.currentStep];
        const displayPrism = getAdjustedPrism(step.prism, ctrl.mode);
        const maxSteps     = steps.length - 1;

        // Prism card
        $('prismValue').textContent = displayPrism;
        $('stepNum').textContent    = ctrl.currentStep;
        $('stepMax').textContent    = maxSteps;
        $('shiftValue').textContent = step.shiftCm.toFixed(3);

        // Mode buttons
        $('btnBO').classList.toggle('active', ctrl.mode === 'BO');
        $('btnBI').classList.toggle('active', ctrl.mode === 'BI');

        // Lens badge
        $('lensBadge').textContent =
            ctrl.mode === 'BO'
                ? '+8.0 D · BO · max 38 Δ'
                : '+8.0 D · BI · max 24 Δ';

        // IPD
        $('ipdValue').textContent = ctrl.ipd;
        $('ipdSlider').value      = ctrl.ipd;

        // ± button states
        $('btnMinus').disabled = ctrl.currentStep <= 0;
        $('btnPlus').disabled  = ctrl.currentStep >= maxSteps;

        // Table rows
        highlightStep();
    }

    // ── Connection ────────────────────────────────────────────────────────────
    function destroyPeer() {
        if (ctrl.peer) {
            try { ctrl.peer.destroy(); } catch (_) {}
            ctrl.peer = null;
            ctrl.conn = null;
        }
    }

    function connect() {
        const code = $('inputRoomCode').value.trim().toUpperCase();
        if (code.length < 4) {
            $('connectHint').textContent = 'Please enter a valid room code (4–6 chars).';
            return;
        }

        destroyPeer();   // clean up any previous attempt

        $('connectHint').textContent = 'Connecting…';
        $('btnConnect').disabled = true;

        const myId     = 'optoctrl-' + Date.now();
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

        ctrl.peer = new Peer(myId, peerOpts);

        ctrl.peer.on('open', function () {
            const targetId = 'optovr-' + code.toLowerCase();
            ctrl.conn = ctrl.peer.connect(targetId, { reliable: true });

            ctrl.conn.on('open', function () {
                ctrl.connected = true;
                onConnected();
            });

            ctrl.conn.on('data', function (data) {
                if (data.type === 'connected') {
                    console.log('[Ctrl] VR confirmed. roomCode:', data.roomCode);
                }
                if (data.type === 'ping') {
                    sendCommand({ type: 'pong' });
                }
            });

            ctrl.conn.on('close', onDisconnected);
            ctrl.conn.on('error', function (err) {
                console.error('[Ctrl] conn error', err);
                $('connectHint').textContent = 'Connection error. Try reconnecting.';
                $('btnConnect').disabled = false;
            });

            // Timeout: if not connected in 12 s, give up
            setTimeout(function () {
                if (!ctrl.connected) {
                    $('connectHint').textContent = 'No response. Check the room code and retry.';
                    $('btnConnect').disabled = false;
                    destroyPeer();
                }
            }, 12000);
        });

        ctrl.peer.on('error', function (err) {
            console.error('[Ctrl] peer error', err.type);
            $('connectHint').textContent = 'Peer error: ' + err.type + '. Retry.';
            $('btnConnect').disabled = false;
        });
    }

    function onConnected() {
        $('connDot').classList.add('connected');
        $('connText').textContent = 'Connected';
        $('connectSection').classList.add('hidden');
        $('mainControls').classList.add('visible');
        showToast('✅ Connected to VR device!');
        sendUpdate();  // push full state immediately so VR is in sync
    }

    function onDisconnected() {
        ctrl.connected = false;
        $('connDot').classList.remove('connected');
        $('connText').textContent = 'Disconnected';
        $('connectSection').classList.remove('hidden');
        $('mainControls').classList.remove('visible');
        $('btnConnect').disabled = false;
        $('connectHint').textContent = 'Connection lost. Re-enter code to reconnect.';
        showToast('⚠️ Disconnected from VR device');
    }

    // ── Send helpers ──────────────────────────────────────────────────────────
    function sendCommand(data) {
        if (ctrl.connected && ctrl.conn && ctrl.conn.open) {
            try { ctrl.conn.send(data); }
            catch (e) { console.warn('[Ctrl] send failed', e); }
        }
    }

    /**
     * sendUpdate()
     * Sends the complete visual state. vr.js uses `activeStepTable` + `step`
     * to index its own copy of the step table — it does NOT trust shiftCm alone.
     * shiftCm is sent as a cross-check / fallback.
     */
    function sendUpdate() {
        const steps = getActiveSteps(ctrl.mode);
        const step  = steps[ctrl.currentStep];
        sendCommand({
            type:            'update',
            step:            ctrl.currentStep,
            shiftCm:         step.shiftCm,          // cross-check
            prism:           step.prism,             // raw prism
            adjustedPrism:   getAdjustedPrism(step.prism, ctrl.mode),
            mode:            ctrl.mode,              // 'BO' | 'BI'
            activeStepTable: ctrl.mode,              // explicit table selector
            ipd:             ctrl.ipd,
        });
    }

    // ── Actions ───────────────────────────────────────────────────────────────
    function stepForward() {
        const maxStep = getActiveSteps(ctrl.mode).length - 1;
        if (ctrl.currentStep >= maxStep) {
            const maxPrism = getAdjustedPrism(getActiveSteps(ctrl.mode)[maxStep].prism, ctrl.mode);
            showToast('Maximum step reached (' + maxPrism + ' Δ)');
            return;
        }
        ctrl.currentStep++;
        updateUI();
        sendUpdate();
    }

    function stepBackward() {
        if (ctrl.currentStep <= 0) {
            showToast('Already at starting position');
            return;
        }
        ctrl.currentStep--;
        updateUI();
        sendUpdate();
    }

    function resetSteps() {
        ctrl.currentStep = 0;
        updateUI();
        sendCommand({ type: 'reset', mode: ctrl.mode });
        showToast('Reset to Step 0');
    }

    function setMode(mode) {
        ctrl.mode        = mode;
        ctrl.currentStep = 0;
        rebuildStepTable();   // rebuild HTML rows for new mode
        updateUI();
        sendUpdate();
        if (mode === 'BO') {
            showToast('◀▶  Base-Out · Convergence · max 38 Δ');
        } else {
            showToast('▶◀  Base-In · Divergence · gentle steps · max 24 Δ');
        }
    }

    function setIPD(value) {
        ctrl.ipd = parseInt(value, 10);
        $('ipdValue').textContent = ctrl.ipd;
        sendCommand({ type: 'ipd', value: ctrl.ipd });
    }

    function recordBreak() {
        if (!ctrl.connected) { showToast('Not connected'); return; }
        const step = getActiveSteps(ctrl.mode)[ctrl.currentStep];
        const p    = getAdjustedPrism(step.prism, ctrl.mode);
        $('breakVal').textContent = p + ' Δ  (Step ' + ctrl.currentStep + ')';
        showToast('Break recorded: ' + p + ' Δ');
    }

    function recordRecovery() {
        if (!ctrl.connected) { showToast('Not connected'); return; }
        const step = getActiveSteps(ctrl.mode)[ctrl.currentStep];
        const p    = getAdjustedPrism(step.prism, ctrl.mode);
        $('recoveryVal').textContent = p + ' Δ  (Step ' + ctrl.currentStep + ')';
        showToast('Recovery recorded: ' + p + ' Δ');
    }

    function clearResults() {
        $('breakVal').textContent    = '—';
        $('recoveryVal').textContent = '—';
        showToast('Results cleared');
    }

    // ── Event binding ─────────────────────────────────────────────────────────
    function bindEvents() {
        $('btnConnect').addEventListener('click', connect);
        $('inputRoomCode').addEventListener('keydown', e => {
            if (e.key === 'Enter') connect();
        });

        $('btnPlus').addEventListener('click',  stepForward);
        $('btnMinus').addEventListener('click', stepBackward);
        $('btnReset').addEventListener('click', resetSteps);

        $('btnBO').addEventListener('click', () => setMode('BO'));
        $('btnBI').addEventListener('click', () => setMode('BI'));

        $('ipdSlider').addEventListener('input', function () { setIPD(this.value); });

        $('btnBreak').addEventListener('click',        recordBreak);
        $('btnRecovery').addEventListener('click',     recordRecovery);
        $('btnClearResults').addEventListener('click', clearResults);

        // Keyboard shortcuts
        document.addEventListener('keydown', function (e) {
            if (document.activeElement === $('inputRoomCode')) return;
            switch (e.key) {
                case '+': case '=': case 'ArrowRight': case 'ArrowUp':
                    e.preventDefault(); stepForward();  break;
                case '-': case 'ArrowLeft': case 'ArrowDown':
                    e.preventDefault(); stepBackward(); break;
                case 'r': case 'R':
                    if (!e.ctrlKey) { e.preventDefault(); resetSteps(); }
                    break;
                case 'b': case 'B':
                    e.preventDefault(); recordBreak(); break;
                case 'v': case 'V':
                    e.preventDefault(); recordRecovery(); break;
                case 'i': case 'I':
                    e.preventDefault();
                    setMode(ctrl.mode === 'BO' ? 'BI' : 'BO');
                    break;
            }
        });

        // Touch pass-through for big buttons
        document.querySelectorAll('.btn-move, .btn-record, .mode-btn').forEach(btn => {
            btn.addEventListener('touchend', function (e) {
                e.preventDefault();
                btn.click();
            }, { passive: false });
        });
    }

    // ── Init ──────────────────────────────────────────────────────────────────
    function init() {
        // Set slider range from config
        const slider = $('ipdSlider');
        slider.min   = VR_CONFIG.minIPD;
        slider.max   = VR_CONFIG.maxIPD;
        slider.value = VR_CONFIG.defaultIPD;

        rebuildStepTable();  // populate BO table on load
        bindEvents();
        updateUI();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
