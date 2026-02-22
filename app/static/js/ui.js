/**
 * ui.js
 * -----
 * DOM construction and manipulation helpers.
 *
 * Responsibilities:
 *   - Build the HTML structure inside #app
 *   - Render the segment tap grid
 *   - Update scoreboard cards
 *   - Show/hide toast messages
 *   - All DOM queries isolated here so app.js stays logic-focused
 */

const UI = (() => {

    // ------------------------------------------------------------------
    // Build the full app shell inside #app
    // ------------------------------------------------------------------

    /**
     * Render the complete UI skeleton.
     * Called once on page load by app.js after game state is initialised.
     *
     * @param {Array}  players    - Array of player objects { id, name, score }
     * @param {object} callbacks  - { onSegment, onUndo, onNextPlayer }
     */
    function buildShell(players, callbacks) {
        const app = document.getElementById('app');
        app.innerHTML = '';

        app.appendChild(_buildHeader());
        app.appendChild(_buildSidebar(players));
        app.appendChild(_buildBoard(callbacks));
        app.appendChild(_buildStatusBar(callbacks));

        document.body.appendChild(_buildToast());
        document.body.appendChild(_buildLoading());
    }

    // ------------------------------------------------------------------
    // Header
    // ------------------------------------------------------------------

    function _buildHeader() {
        const el = document.createElement('header');
        el.id = 'header';
        el.innerHTML = `
            <h1>DARTS 501</h1>
            <span id="match-info"></span>
        `;
        return el;
    }

    // ------------------------------------------------------------------
    // Sidebar: player score cards
    // ------------------------------------------------------------------

    function _buildSidebar(players) {
        const el = document.createElement('aside');
        el.id = 'sidebar';

        players.forEach(player => {
            el.appendChild(_buildPlayerCard(player));
        });

        return el;
    }

    function _buildPlayerCard(player) {
        const card = document.createElement('div');
        card.className = 'player-card';
        card.id = `player-card-${player.id}`;
        card.innerHTML = `
            <div class="player-name">${_esc(player.name)}</div>
            <div class="player-score" id="score-${player.id}">${player.score}</div>
            <div class="player-darts" id="darts-${player.id}"></div>
            <div class="checkout-hint" id="hint-${player.id}"></div>
        `;
        return card;
    }

    // ------------------------------------------------------------------
    // Board: multiplier tabs + segment grid + bull row
    // ------------------------------------------------------------------

    function _buildBoard(callbacks) {
        const el = document.createElement('main');
        el.id = 'board';

        el.appendChild(_buildMultiplierTabs(callbacks.onMultiplier));
        el.appendChild(_buildSegmentGrid(callbacks.onSegment));
        el.appendChild(_buildBullRow(callbacks.onSegment));

        return el;
    }

    /**
     * Multiplier selector tabs: SINGLE / DOUBLE / TREBLE
     * Selecting a tab sets the active multiplier for subsequent segment taps.
     */
    function _buildMultiplierTabs(onMultiplier) {
        const row = document.createElement('div');
        row.id = 'multiplier-tabs';

        const tabs = [
            { label: 'Single', multiplier: 1, cls: 'active-single' },
            { label: 'Double', multiplier: 2, cls: 'active-double' },
            { label: 'Treble', multiplier: 3, cls: 'active-treble' },
        ];

        tabs.forEach(tab => {
            const btn = document.createElement('button');
            btn.className = 'tab-btn';
            btn.textContent = tab.label;
            btn.dataset.multiplier = tab.multiplier;
            btn.dataset.activeClass = tab.cls;
            btn.addEventListener('click', () => onMultiplier(tab.multiplier, btn));
            row.appendChild(btn);
        });

        return row;
    }

    /**
     * 4×5 grid of segment buttons (1–20).
     * Layout order matches a dartboard's clockwise layout starting from 20:
     * 20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19, 7, 16, 8, 11, 14, 9, 12, 5
     */
    function _buildSegmentGrid(onSegment) {
        const grid = document.createElement('div');
        grid.id = 'segment-grid';

        // Dartboard order (clockwise from top)
        const BOARD_ORDER = [20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19, 7, 16, 8, 11, 14, 9, 12, 5];

        BOARD_ORDER.forEach(segment => {
            const btn = document.createElement('button');
            btn.className = 'seg-btn';
            btn.textContent = segment;
            btn.dataset.segment = segment;
            btn.addEventListener('click', () => onSegment(segment));
            grid.appendChild(btn);
        });

        return grid;
    }

    /**
     * Bottom row: Miss | Outer Bull | Bull | (spacer for next player later)
     */
    function _buildBullRow(onSegment) {
        const row = document.createElement('div');
        row.id = 'bull-row';

        // Miss (segment 0, multiplier 1 always)
        const miss = document.createElement('button');
        miss.className = 'bull-btn miss-btn';
        miss.textContent = 'MISS';
        miss.addEventListener('click', () => onSegment(0, 1));  // force multiplier 1
        row.appendChild(miss);

        // Outer Bull (25pts — single only)
        const outer = document.createElement('button');
        outer.className = 'bull-btn';
        outer.innerHTML = 'OUTER<br><small>25</small>';
        outer.addEventListener('click', () => onSegment(25, 1));  // force multiplier 1
        row.appendChild(outer);

        // Bull (50pts — double bull)
        const bull = document.createElement('button');
        bull.className = 'bull-btn';
        bull.innerHTML = 'BULL<br><small>50</small>';
        bull.addEventListener('click', () => onSegment(25, 2));   // force multiplier 2
        row.appendChild(bull);

        // Spacer (used for Next Player button in status bar — kept here for layout balance)
        const spacer = document.createElement('div');
        row.appendChild(spacer);

        return row;
    }

    // ------------------------------------------------------------------
    // Status bar
    // ------------------------------------------------------------------

    function _buildStatusBar(callbacks) {
        const el = document.createElement('footer');
        el.id = 'status-bar';

        const msg = document.createElement('span');
        msg.id = 'status-message';
        msg.textContent = 'SELECT MULTIPLIER THEN SEGMENT';

        const undoBtn = document.createElement('button');
        undoBtn.className = 'action-btn undo';
        undoBtn.id = 'btn-undo';
        undoBtn.textContent = '⟵ UNDO';
        undoBtn.addEventListener('click', callbacks.onUndo);

        const nextBtn = document.createElement('button');
        nextBtn.className = 'action-btn next-player';
        nextBtn.id = 'btn-next';
        nextBtn.textContent = 'NEXT ▶';
        nextBtn.disabled = true;
        nextBtn.addEventListener('click', callbacks.onNextPlayer);

        el.appendChild(msg);
        el.appendChild(undoBtn);
        el.appendChild(nextBtn);

        return el;
    }

    // ------------------------------------------------------------------
    // Toast
    // ------------------------------------------------------------------

    function _buildToast() {
        const el = document.createElement('div');
        el.id = 'toast';
        return el;
    }

    function _buildLoading() {
        const el = document.createElement('div');
        el.id = 'loading';
        el.textContent = 'SYNCING...';
        return el;
    }

    // ------------------------------------------------------------------
    // Update functions — called by app.js after state changes
    // ------------------------------------------------------------------

    /**
     * Set which player card is highlighted as active.
     *
     * @param {number} playerId
     */
    function setActivePlayer(playerId) {
        document.querySelectorAll('.player-card').forEach(card => {
            card.classList.remove('active');
        });
        const card = document.getElementById(`player-card-${playerId}`);
        if (card) card.classList.add('active');
    }

    /**
     * Update a player's displayed score.
     *
     * @param {number} playerId
     * @param {number} score
     */
    function setScore(playerId, score) {
        const el = document.getElementById(`score-${playerId}`);
        if (el) el.textContent = score;
    }

    /**
     * Add a dart pill to a player's dart display row.
     *
     * @param {number} playerId
     * @param {number} points       - Points scored (shown in pill)
     * @param {number} multiplier   - Used to colour the pill
     * @param {number} segment      - Used to colour bull pills
     */
    function addDartPill(playerId, points, multiplier, segment) {
        const row = document.getElementById(`darts-${playerId}`);
        if (!row) return;

        const pill = document.createElement('span');
        pill.className = 'dart-pill';

        if (segment === 25) {
            pill.classList.add('bull');
        } else if (multiplier === 3) {
            pill.classList.add('treble');
        } else if (multiplier === 2) {
            pill.classList.add('double');
        }

        pill.textContent = points;
        row.appendChild(pill);
    }

    /**
     * Clear the dart pills from a player's card (start of new turn).
     *
     * @param {number} playerId
     */
    function clearDartPills(playerId) {
        const row = document.getElementById(`darts-${playerId}`);
        if (row) row.innerHTML = '';
    }

    /**
     * Show or clear the checkout hint on a player's card.
     *
     * @param {number} playerId
     * @param {Array|null} suggestion  - e.g. ["T20", "T20", "DB"] or null
     */
    function setCheckoutHint(playerId, suggestion) {
        const el = document.getElementById(`hint-${playerId}`);
        if (!el) return;
        el.textContent = suggestion ? suggestion.join(' → ') : '';
    }

    /**
     * Flash a player's card for a bust or checkout event.
     *
     * @param {number} playerId
     * @param {'bust'|'checkout'} type
     */
    function flashCard(playerId, type) {
        const card = document.getElementById(`player-card-${playerId}`);
        if (!card) return;
        card.classList.add(type);
        setTimeout(() => card.classList.remove(type), 1200);
    }

    /**
     * Set the active multiplier tab highlight.
     *
     * @param {number} multiplier  - 1, 2, or 3
     */
    function setMultiplierTab(multiplier) {
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.classList.remove('active-single', 'active-double', 'active-treble');
        });

        const activeTab = document.querySelector(`.tab-btn[data-multiplier="${multiplier}"]`);
        if (activeTab) {
            activeTab.classList.add(activeTab.dataset.activeClass);
        }

        // Set body attribute so CSS can tint segment buttons
        document.body.dataset.multiplier = multiplier;
    }

    /**
     * Enable or disable the Next Player button.
     *
     * @param {boolean} enabled
     */
    function setNextPlayerEnabled(enabled) {
        const btn = document.getElementById('btn-next');
        if (btn) btn.disabled = !enabled;
    }

    /**
     * Set the status bar message.
     *
     * @param {string} text
     * @param {'normal'|'bust'|'success'} [type='normal']
     */
    function setStatus(text, type = 'normal') {
        const el = document.getElementById('status-message');
        if (!el) return;
        el.textContent = text;
        el.className = type === 'normal' ? '' : type;
    }

    /**
     * Show a toast notification that auto-dismisses.
     *
     * @param {string} text
     * @param {'info'|'bust'|'success'} [type='info']
     * @param {number} [duration=2000]  - ms before auto-hide
     */
    let _toastTimer = null;

    function showToast(text, type = 'info', duration = 2000) {
        const toast = document.getElementById('toast');
        if (!toast) return;

        toast.textContent = text;
        toast.className = `visible ${type}`;

        clearTimeout(_toastTimer);
        _toastTimer = setTimeout(() => {
            toast.className = '';
        }, duration);
    }

    /**
     * Show or hide the loading overlay.
     *
     * @param {boolean} visible
     */
    function setLoading(visible) {
        const el = document.getElementById('loading');
        if (el) el.classList.toggle('visible', visible);
    }

    /**
     * Update the header match info string.
     *
     * @param {string} text
     */
    function setMatchInfo(text) {
        const el = document.getElementById('match-info');
        if (el) el.textContent = text;
    }

    // ------------------------------------------------------------------
    // Helpers
    // ------------------------------------------------------------------

    /** Escape HTML to prevent XSS in player names */
    function _esc(str) {
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    // ------------------------------------------------------------------
    // Public interface
    // ------------------------------------------------------------------

    return {
        buildShell,
        setActivePlayer,
        setScore,
        addDartPill,
        clearDartPills,
        setCheckoutHint,
        flashCard,
        setMultiplierTab,
        setNextPlayerEnabled,
        setStatus,
        showToast,
        setLoading,
        setMatchInfo,
    };

})();
