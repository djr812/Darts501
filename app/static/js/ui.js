/**
 * ui.js
 * -----
 * DOM construction and manipulation helpers.
 *
 * Responsibilities:
 *   - Build the setup screen (player count + name entry)
 *   - Build the game UI shell
 *   - Render the segment tap grid
 *   - Update scoreboard cards
 *   - Show/hide toast messages
 *   - All DOM queries isolated here so app.js stays logic-focused
 */

const UI = (() => {

    // ------------------------------------------------------------------
    // Setup Screen
    // ------------------------------------------------------------------

    /**
     * Render the player setup screen inside #app.
     *
     * @param {Function} onStartGame  - Called with array of name strings when
     *                                  the user confirms. e.g. ["Dave", "Sue"]
     */
    function buildSetupScreen(onStartGame) {
        const app = document.getElementById('app');
        app.innerHTML = '';
        app.style.cssText = 'display:flex; flex-direction:column; align-items:center; justify-content:center;';

        if (!document.getElementById('toast'))   document.body.appendChild(_buildToast());
        if (!document.getElementById('loading')) document.body.appendChild(_buildLoading());

        // Title
        const title = document.createElement('div');
        title.id = 'setup-title';
        title.innerHTML = `
            <div class="setup-logo">DARTS 501</div>
            <div class="setup-subtitle">MATCH SETUP</div>
        `;
        app.appendChild(title);

        // Player count selector
        const countSection = document.createElement('div');
        countSection.id = 'setup-count-section';
        countSection.innerHTML = '<div class="setup-label">NUMBER OF PLAYERS</div>';

        const countRow = document.createElement('div');
        countRow.id = 'setup-count-row';

        // Names section declared here so count buttons can reference it
        const namesSection = document.createElement('div');
        namesSection.id = 'setup-names-section';

        // Start button declared here so _renderNameInputs can reference it
        const startBtn = document.createElement('button');
        startBtn.id = 'setup-start-btn';
        startBtn.className = 'start-btn';
        startBtn.textContent = 'START MATCH';
        startBtn.disabled = true;

        [1, 2, 3, 4].forEach(n => {
            const btn = document.createElement('button');
            btn.className = 'count-btn';
            btn.dataset.count = n;

            if (n === 1) {
                btn.innerHTML = `1<span class="vs-cpu"> vs CPU</span>`;
            } else {
                btn.textContent = n;
            }

            btn.addEventListener('click', () => {
                document.querySelectorAll('.count-btn').forEach(b => b.classList.remove('selected'));
                btn.classList.add('selected');
                _renderNameInputs(n, namesSection, startBtn, onStartGame);
                startBtn.disabled = false;
            });

            countRow.appendChild(btn);
        });

        countSection.appendChild(countRow);
        app.appendChild(countSection);
        app.appendChild(namesSection);

        startBtn.addEventListener('click', () => {
            const names = _collectNames(namesSection);
            if (!names) return;
            onStartGame(names);
        });
        app.appendChild(startBtn);

        // Default to 2 players on load
        countRow.querySelector('[data-count="2"]').click();
    }

    function _renderNameInputs(count, container, startBtn, onStartGame) {
        container.innerHTML = '';

        const grid = document.createElement('div');
        grid.id = 'setup-names-grid';
        grid.style.gridTemplateColumns = count <= 2 ? '1fr 1fr' : 'repeat(4, 1fr)';

        for (let i = 0; i < count; i++) {
            const slot = document.createElement('div');
            slot.className = 'name-slot';

            const label = document.createElement('label');
            label.textContent = count === 1 ? 'YOUR NAME' : `PLAYER ${i + 1}`;
            label.className = 'name-label';

            const input = document.createElement('input');
            input.type        = 'text';
            input.className   = 'name-input';
            input.placeholder = count === 1 ? 'Enter your name' : `Player ${i + 1}`;
            input.maxLength   = 20;
            input.dataset.index   = i;
            input.autocomplete    = 'off';
            input.autocorrect     = 'off';
            input.autocapitalize  = 'words';
            input.spellcheck      = false;

            // Return key: advance to next input or trigger start
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    const inputs = container.querySelectorAll('.name-input');
                    const next = inputs[i + 1];
                    if (next) {
                        next.focus();
                    } else {
                        startBtn.click();
                    }
                }
            });

            input.addEventListener('input', () => input.classList.remove('error'));

            slot.appendChild(label);
            slot.appendChild(input);
            grid.appendChild(slot);
        }

        container.appendChild(grid);

        // Focus first input after brief delay (iOS keyboard timing)
        setTimeout(() => container.querySelector('.name-input')?.focus(), 150);
    }

    function _collectNames(container) {
        const inputs = container.querySelectorAll('.name-input');
        const names  = [];
        let valid    = true;
        let firstErr = null;

        inputs.forEach(input => {
            const val = input.value.trim();
            if (!val) {
                input.classList.add('error');
                if (!firstErr) firstErr = input;
                valid = false;
            } else {
                input.classList.remove('error');
                names.push(val);
            }
        });

        if (!valid && firstErr) firstErr.focus();
        return valid ? names : null;
    }

    // ------------------------------------------------------------------
    // Game Shell
    // ------------------------------------------------------------------

    function buildShell(players, callbacks) {
        const app = document.getElementById('app');
        app.innerHTML = '';
        app.style.cssText = '';   // reset inline styles from setup screen

        app.appendChild(_buildHeader());
        app.appendChild(_buildSidebar(players));
        app.appendChild(_buildBoard(callbacks));
        app.appendChild(_buildStatusBar(callbacks));

        if (!document.getElementById('toast'))   document.body.appendChild(_buildToast());
        if (!document.getElementById('loading')) document.body.appendChild(_buildLoading());
    }

    function _buildHeader() {
        const el = document.createElement('header');
        el.id = 'header';
        el.innerHTML = `<h1>DARTS 501</h1><span id="match-info"></span>`;
        return el;
    }

    function _buildSidebar(players) {
        const el = document.createElement('aside');
        el.id = 'sidebar';
        players.forEach(player => el.appendChild(_buildPlayerCard(player)));
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

    function _buildBoard(callbacks) {
        const el = document.createElement('main');
        el.id = 'board';
        el.appendChild(_buildMultiplierTabs(callbacks.onMultiplier));
        el.appendChild(_buildSegmentGrid(callbacks.onSegment));
        el.appendChild(_buildBullRow(callbacks.onSegment));
        return el;
    }

    function _buildMultiplierTabs(onMultiplier) {
        const row = document.createElement('div');
        row.id = 'multiplier-tabs';

        [
            { label: 'Single', multiplier: 1, cls: 'active-single' },
            { label: 'Double', multiplier: 2, cls: 'active-double' },
            { label: 'Treble', multiplier: 3, cls: 'active-treble' },
        ].forEach(tab => {
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

    function _buildSegmentGrid(onSegment) {
        const grid = document.createElement('div');
        grid.id = 'segment-grid';

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

    function _buildBullRow(onSegment) {
        const row = document.createElement('div');
        row.id = 'bull-row';

        const miss = document.createElement('button');
        miss.className = 'bull-btn miss-btn';
        miss.textContent = 'MISS';
        miss.addEventListener('click', () => onSegment(0, 1));
        row.appendChild(miss);

        const outer = document.createElement('button');
        outer.className = 'bull-btn';
        outer.innerHTML = 'OUTER<br><small>25</small>';
        outer.addEventListener('click', () => onSegment(25, 1));
        row.appendChild(outer);

        const bull = document.createElement('button');
        bull.className = 'bull-btn';
        bull.innerHTML = 'BULL<br><small>50</small>';
        bull.addEventListener('click', () => onSegment(25, 2));
        row.appendChild(bull);

        row.appendChild(document.createElement('div'));   // layout spacer
        return row;
    }

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
    // Update helpers
    // ------------------------------------------------------------------

    function setActivePlayer(playerId) {
        document.querySelectorAll('.player-card').forEach(c => c.classList.remove('active'));
        document.getElementById(`player-card-${playerId}`)?.classList.add('active');
    }

    function setScore(playerId, score) {
        const el = document.getElementById(`score-${playerId}`);
        if (el) el.textContent = score;
    }

    function addDartPill(playerId, points, multiplier, segment) {
        const row = document.getElementById(`darts-${playerId}`);
        if (!row) return;
        const pill = document.createElement('span');
        pill.className = 'dart-pill';
        if (segment === 25)     pill.classList.add('bull');
        else if (multiplier === 3) pill.classList.add('treble');
        else if (multiplier === 2) pill.classList.add('double');
        pill.textContent = points;
        row.appendChild(pill);
    }

    function clearDartPills(playerId) {
        const row = document.getElementById(`darts-${playerId}`);
        if (row) row.innerHTML = '';
    }

    function setCheckoutHint(playerId, suggestion) {
        const el = document.getElementById(`hint-${playerId}`);
        if (el) el.textContent = suggestion ? suggestion.join(' → ') : '';
    }

    function flashCard(playerId, type) {
        const card = document.getElementById(`player-card-${playerId}`);
        if (!card) return;
        card.classList.add(type);
        setTimeout(() => card.classList.remove(type), 1200);
    }

    function setMultiplierTab(multiplier) {
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.classList.remove('active-single', 'active-double', 'active-treble');
        });
        const tab = document.querySelector(`.tab-btn[data-multiplier="${multiplier}"]`);
        if (tab) tab.classList.add(tab.dataset.activeClass);
        document.body.dataset.multiplier = multiplier;
    }

    function setNextPlayerEnabled(enabled) {
        const btn = document.getElementById('btn-next');
        if (btn) btn.disabled = !enabled;
    }

    function setStatus(text, type = 'normal') {
        const el = document.getElementById('status-message');
        if (!el) return;
        el.textContent = text;
        el.className = type === 'normal' ? '' : type;
    }

    let _toastTimer = null;
    function showToast(text, type = 'info', duration = 2000) {
        const toast = document.getElementById('toast');
        if (!toast) return;
        toast.textContent = text;
        toast.className = `visible ${type}`;
        clearTimeout(_toastTimer);
        _toastTimer = setTimeout(() => { toast.className = ''; }, duration);
    }

    function setLoading(visible) {
        document.getElementById('loading')?.classList.toggle('visible', visible);
    }

    function setMatchInfo(text) {
        const el = document.getElementById('match-info');
        if (el) el.textContent = text;
    }

    function _esc(str) {
        return String(str)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    return {
        buildSetupScreen,
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