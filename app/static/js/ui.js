/**
 * ui.js
 * -----
 * DOM construction and manipulation helpers.
 */

const UI = (() => {

    // ------------------------------------------------------------------
    // Setup Screen
    // ------------------------------------------------------------------

    /**
     * Render the player setup screen.
     *
     * @param {Array}    existingPlayers  - [{ id, name }] from GET /api/players
     * @param {Function} onStartGame      - Called with:
     *                                      {
     *                                        players:   [{ mode, name, id? }],
     *                                        gameType:  '501' | '201' | 'Cricket',
     *                                        doubleOut: true | false
     *                                      }
     */
    function buildSetupScreen(existingPlayers, onStartGame) {
        const app = document.getElementById('app');
        app.innerHTML = '';
        app.style.cssText = 'display:flex; flex-direction:column; align-items:center; justify-content:center; gap:0; overflow-y:auto; padding: 16px 0;';

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

        // ---- Game Type ----
        const gameTypeSection = document.createElement('div');
        gameTypeSection.className = 'setup-section';
        gameTypeSection.innerHTML = '<div class="setup-label">GAME TYPE</div>';

        const gameTypeRow = document.createElement('div');
        gameTypeRow.id = 'setup-gametype-row';
        gameTypeRow.className = 'setup-option-row';

        const gameTypes = [
            { value: '501',     label: '501' },
            { value: '201',     label: '201' },
            { value: 'Cricket', label: 'Cricket', disabled: true, hint: 'COMING SOON' },
        ];

        gameTypes.forEach(gt => {
            const btn = document.createElement('button');
            btn.className = 'option-btn';
            btn.dataset.value = gt.value;
            btn.type = 'button';

            if (gt.hint) {
                btn.innerHTML = `${gt.label}<span class="option-hint">${gt.hint}</span>`;
            } else {
                btn.textContent = gt.label;
            }

            if (gt.disabled) {
                btn.disabled = true;
                btn.classList.add('disabled');
            } else {
                btn.addEventListener('click', () => {
                    gameTypeRow.querySelectorAll('.option-btn').forEach(b => b.classList.remove('selected'));
                    btn.classList.add('selected');
                    // Show/hide checkout rule section based on game type
                    checkoutSection.style.display = gt.value === 'Cricket' ? 'none' : '';
                });
            }

            gameTypeRow.appendChild(btn);
        });

        gameTypeSection.appendChild(gameTypeRow);
        app.appendChild(gameTypeSection);

        // ---- Checkout Rule ----
        const checkoutSection = document.createElement('div');
        checkoutSection.className = 'setup-section';
        checkoutSection.id = 'setup-checkout-section';
        checkoutSection.innerHTML = '<div class="setup-label">CHECKOUT RULE</div>';

        const checkoutRow = document.createElement('div');
        checkoutRow.id = 'setup-checkout-row';
        checkoutRow.className = 'setup-option-row';

        const checkoutOptions = [
            { value: 'double', label: 'DOUBLE OUT', hint: 'Standard' },
            { value: 'single', label: 'SINGLE OUT', hint: 'Casual' },
        ];

        checkoutOptions.forEach(co => {
            const btn = document.createElement('button');
            btn.className = 'option-btn';
            btn.dataset.value = co.value;
            btn.type = 'button';
            btn.innerHTML = `${co.label}<span class="option-hint">${co.hint}</span>`;
            btn.addEventListener('click', () => {
                checkoutRow.querySelectorAll('.option-btn').forEach(b => b.classList.remove('selected'));
                btn.classList.add('selected');
            });
            checkoutRow.appendChild(btn);
        });

        checkoutSection.appendChild(checkoutRow);
        app.appendChild(checkoutSection);

        // ---- Player Count ----
        const countSection = document.createElement('div');
        countSection.className = 'setup-section';
        countSection.innerHTML = '<div class="setup-label">NUMBER OF PLAYERS</div>';

        const countRow = document.createElement('div');
        countRow.id = 'setup-count-row';
        countRow.className = 'setup-option-row';

        const namesSection = document.createElement('div');
        namesSection.id = 'setup-names-section';

        const startBtn = document.createElement('button');
        startBtn.id = 'setup-start-btn';
        startBtn.className = 'start-btn';
        startBtn.textContent = 'START MATCH';
        startBtn.disabled = true;

        [1, 2, 3, 4].forEach(n => {
            const btn = document.createElement('button');
            btn.className = 'option-btn count-btn';
            btn.dataset.count = n;
            btn.type = 'button';

            if (n === 1) {
                btn.innerHTML = `1<span class="option-hint">vs CPU</span>`;
            } else {
                btn.textContent = n;
            }

            btn.addEventListener('click', () => {
                countRow.querySelectorAll('.option-btn').forEach(b => b.classList.remove('selected'));
                btn.classList.add('selected');
                _renderPlayerSlots(n, existingPlayers, namesSection, startBtn, onStartGame);
                startBtn.disabled = false;
            });

            countRow.appendChild(btn);
        });

        countSection.appendChild(countRow);
        app.appendChild(countSection);
        app.appendChild(namesSection);

        startBtn.addEventListener('click', () => {
            // Collect game config
            const gameTypeSelected = gameTypeRow.querySelector('.option-btn.selected');
            const checkoutSelected  = checkoutRow.querySelector('.option-btn.selected');

            if (!gameTypeSelected) {
                showToast('SELECT A GAME TYPE', 'bust', 2000);
                return;
            }
            if (!checkoutSelected) {
                showToast('SELECT A CHECKOUT RULE', 'bust', 2000);
                return;
            }

            const players = _collectPlayerSelections(namesSection);
            if (!players) return;

            onStartGame({
                players,
                gameType:  gameTypeSelected.dataset.value,
                doubleOut: checkoutSelected.dataset.value === 'double',
            });
        });

        app.appendChild(startBtn);

        // ---- Set defaults ----
        gameTypeRow.querySelector('[data-value="501"]').click();
        checkoutRow.querySelector('[data-value="double"]').click();
        countRow.querySelector('[data-count="2"]').click();
    }

    // ------------------------------------------------------------------
    // Player slots
    // ------------------------------------------------------------------

    function _renderPlayerSlots(count, existingPlayers, container, startBtn, onStartGame) {
        container.innerHTML = '';

        const grid = document.createElement('div');
        grid.id = 'setup-names-grid';
        grid.style.gridTemplateColumns = count <= 2 ? '1fr 1fr' : 'repeat(4, 1fr)';

        for (let i = 0; i < count; i++) {
            grid.appendChild(_buildPlayerSlot(i, count, existingPlayers));
        }

        container.appendChild(grid);

        setTimeout(() => {
            const first = container.querySelector('.name-input');
            if (first) first.focus();
        }, 150);
    }

    function _buildPlayerSlot(index, totalCount, existingPlayers) {
        const slot = document.createElement('div');
        slot.className = 'name-slot';
        slot.dataset.index = index;

        const label = document.createElement('div');
        label.className = 'name-label';
        label.textContent = totalCount === 1 ? 'YOUR NAME' : `PLAYER ${index + 1}`;
        slot.appendChild(label);

        // Toggle row
        const toggleRow = document.createElement('div');
        toggleRow.className = 'slot-toggle-row';

        const newBtn = document.createElement('button');
        newBtn.className = 'slot-toggle-btn active';
        newBtn.textContent = '+ NEW';
        newBtn.type = 'button';

        const existingBtn = document.createElement('button');
        existingBtn.className = 'slot-toggle-btn';
        existingBtn.textContent = 'EXISTING';
        existingBtn.type = 'button';

        if (existingPlayers.length === 0) {
            existingBtn.disabled = true;
            existingBtn.title = 'No existing players';
        }

        toggleRow.appendChild(newBtn);
        toggleRow.appendChild(existingBtn);
        slot.appendChild(toggleRow);

        // New name input
        const newInput = document.createElement('input');
        newInput.type          = 'text';
        newInput.className     = 'name-input';
        newInput.placeholder   = `Player ${index + 1} name`;
        newInput.maxLength     = 20;
        newInput.autocomplete  = 'off';
        newInput.autocorrect   = 'off';
        newInput.autocapitalize = 'words';
        newInput.spellcheck    = false;
        newInput.dataset.slotIndex = index;
        newInput.addEventListener('input', () => newInput.classList.remove('error'));
        slot.appendChild(newInput);

        // Existing player dropdown
        const existingSelect = document.createElement('select');
        existingSelect.className = 'name-select';
        existingSelect.dataset.slotIndex = index;
        existingSelect.style.display = 'none';

        const placeholder = document.createElement('option');
        placeholder.value       = '';
        placeholder.textContent = '— Select player —';
        placeholder.disabled    = true;
        placeholder.selected    = true;
        existingSelect.appendChild(placeholder);

        existingPlayers.forEach(p => {
            const opt = document.createElement('option');
            opt.value       = p.id;
            opt.textContent = p.name;
            existingSelect.appendChild(opt);
        });

        existingSelect.addEventListener('change', () => existingSelect.classList.remove('error'));
        slot.appendChild(existingSelect);

        // Toggle mode
        function activateMode(mode) {
            if (mode === 'new') {
                newBtn.classList.add('active');
                existingBtn.classList.remove('active');
                newInput.style.display      = '';
                existingSelect.style.display = 'none';
                slot.dataset.mode = 'new';
                newInput.focus();
            } else {
                existingBtn.classList.add('active');
                newBtn.classList.remove('active');
                newInput.style.display      = 'none';
                existingSelect.style.display = '';
                slot.dataset.mode = 'existing';
                existingSelect.focus();
            }
        }

        newBtn.addEventListener('click',      () => activateMode('new'));
        existingBtn.addEventListener('click', () => activateMode('existing'));
        slot.dataset.mode = 'new';

        return slot;
    }

    function _collectPlayerSelections(container) {
        const slots  = container.querySelectorAll('.name-slot');
        const result = [];
        let valid    = true;
        let firstErr = null;

        slots.forEach(slot => {
            const mode = slot.dataset.mode;
            if (mode === 'new') {
                const input = slot.querySelector('.name-input');
                const name  = input.value.trim();
                if (!name) {
                    input.classList.add('error');
                    if (!firstErr) firstErr = input;
                    valid = false;
                } else {
                    result.push({ mode: 'new', name });
                }
            } else {
                const select = slot.querySelector('.name-select');
                if (!select.value) {
                    select.classList.add('error');
                    if (!firstErr) firstErr = select;
                    valid = false;
                } else {
                    result.push({
                        mode: 'existing',
                        id:   parseInt(select.value, 10),
                        name: select.options[select.selectedIndex].textContent,
                    });
                }
            }
        });

        const names    = result.map(r => r.name.toLowerCase());
        const hasDupes = names.some((n, i) => names.indexOf(n) !== i);
        if (hasDupes) {
            showToast('EACH PLAYER MUST BE UNIQUE', 'bust', 3000);
            valid = false;
        }

        if (!valid && firstErr) firstErr.focus();
        return valid ? result : null;
    }

    // ------------------------------------------------------------------
    // Game Shell
    // ------------------------------------------------------------------

    function buildShell(players, callbacks) {
        const app = document.getElementById('app');
        app.innerHTML = '';
        app.style.cssText = '';

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

        row.appendChild(document.createElement('div'));
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
        if (segment === 25)        pill.classList.add('bull');
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