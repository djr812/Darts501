/**
 * ui.js
 */

const UI = (() => {

    // ------------------------------------------------------------------
    // Setup Screen
    // ------------------------------------------------------------------

    function buildSetupScreen(existingPlayers, onStartGame, onViewStats, onPractice) {
        const app = document.getElementById('app');
        app.innerHTML = '';
        app.style.cssText = '';
        document.body.className = 'mode-setup';

        if (!document.getElementById('toast'))   document.body.appendChild(_buildToast());
        if (!document.getElementById('loading')) document.body.appendChild(_buildLoading());

        // Inner wrapper handles centring and padding
        var inner = document.createElement('div');
        inner.className = 'setup-screen-inner';
        app.appendChild(inner);

        // From here, append everything to inner instead of app
        var _appTarget = inner;

        // Title
        const title = document.createElement('div');
        title.id = 'setup-title';
        title.innerHTML = `<div class="setup-logo">DARTS 501</div><div class="setup-subtitle">MATCH SETUP</div>`;
        _appTarget.appendChild(title);

        // ---- Game Type ----
        const gameTypeSection = document.createElement('div');
        gameTypeSection.className = 'setup-section';
        gameTypeSection.innerHTML = '<div class="setup-label">GAME TYPE</div>';
        const gameTypeRow = document.createElement('div');
        gameTypeRow.className = 'setup-option-row';

        const gameTypes = [
            { value: '501', label: '501' },
            { value: '201', label: '201' },
            { value: 'Cricket', label: 'Cricket', disabled: true, hint: 'COMING SOON' },
            { value: 'Practice', label: 'PRACTICE', practice: true },
        ];
        gameTypes.forEach(gt => {
            const btn = document.createElement('button');
            btn.className = 'option-btn';
            btn.dataset.value = gt.value;
            btn.type = 'button';
            btn.innerHTML = gt.hint
                ? `${gt.label}<span class="option-hint">${gt.hint}</span>`
                : gt.label;
            if (gt.disabled) {
                btn.disabled = true;
                btn.classList.add('disabled');
            } else if (gt.practice) {
                // Practice jumps straight to practice flow — no match config needed
                btn.classList.add('practice-gametype-btn');
                btn.addEventListener('click', () => {
                    if (onPractice) onPractice();
                });
            } else {
                btn.addEventListener('click', () => {
                    gameTypeRow.querySelectorAll('.option-btn').forEach(b => b.classList.remove('selected'));
                    btn.classList.add('selected');
                    checkoutSection.style.display = gt.value === 'Cricket' ? 'none' : '';
                });
            }
            gameTypeRow.appendChild(btn);
        });
        gameTypeSection.appendChild(gameTypeRow);
        _appTarget.appendChild(gameTypeSection);

        // ---- Checkout Rule ----
        const checkoutSection = document.createElement('div');
        checkoutSection.className = 'setup-section';
        checkoutSection.innerHTML = '<div class="setup-label">CHECKOUT RULE</div>';
        const checkoutRow = document.createElement('div');
        checkoutRow.className = 'setup-option-row';
        [
            { value: 'double', label: 'DOUBLE OUT', hint: 'Standard' },
            { value: 'single', label: 'SINGLE OUT', hint: 'Casual' },
        ].forEach(co => {
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
        _appTarget.appendChild(checkoutSection);

        // ---- Sets + Legs (combined row) ----
        const setsLegsSection = document.createElement('div');
        setsLegsSection.className = 'setup-section setup-section-paired';

        // Left column: Sets to Win
        const setsCol = document.createElement('div');
        setsCol.className = 'paired-col';
        const setsLabel = document.createElement('div');
        setsLabel.className = 'setup-label';
        setsLabel.textContent = 'SETS TO WIN';
        const setsRow = document.createElement('div');
        setsRow.className = 'setup-option-row setup-option-col';
        [1, 2, 3, 4, 5].forEach(function(n) {
            const btn = document.createElement('button');
            btn.className = 'option-btn option-btn-compact';
            btn.dataset.value = n;
            btn.type = 'button';
            btn.textContent = n;
            btn.addEventListener('click', function() {
                setsRow.querySelectorAll('.option-btn').forEach(function(b) { b.classList.remove('selected'); });
                btn.classList.add('selected');
            });
            setsRow.appendChild(btn);
        });
        setsCol.appendChild(setsLabel);
        setsCol.appendChild(setsRow);

        // Right column: Legs per Set
        const legsCol = document.createElement('div');
        legsCol.className = 'paired-col';
        const legsLabel = document.createElement('div');
        legsLabel.className = 'setup-label';
        legsLabel.textContent = 'LEGS PER SET';
        const legsRow = document.createElement('div');
        legsRow.className = 'setup-option-row setup-option-col';
        [1, 3, 5, 7].forEach(function(n) {
            const btn = document.createElement('button');
            btn.className = 'option-btn option-btn-compact';
            btn.dataset.value = n;
            btn.type = 'button';
            btn.innerHTML = n + '<span class="option-hint">' + (n === 1 ? 'Single' : 'First to ' + Math.ceil(n/2)) + '</span>';
            btn.addEventListener('click', function() {
                legsRow.querySelectorAll('.option-btn').forEach(function(b) { b.classList.remove('selected'); });
                btn.classList.add('selected');
            });
            legsRow.appendChild(btn);
        });
        legsCol.appendChild(legsLabel);
        legsCol.appendChild(legsRow);

        setsLegsSection.appendChild(setsCol);
        setsLegsSection.appendChild(legsCol);
        _appTarget.appendChild(setsLegsSection);

        // ---- Player Count ----
        const countSection = document.createElement('div');
        countSection.className = 'setup-section';
        countSection.innerHTML = '<div class="setup-label">NUMBER OF PLAYERS</div>';
        const countRow = document.createElement('div');
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
            btn.innerHTML = n === 1 ? `1<span class="option-hint">vs CPU</span>` : String(n);
            btn.addEventListener('click', () => {
                countRow.querySelectorAll('.option-btn').forEach(b => b.classList.remove('selected'));
                btn.classList.add('selected');
                if (n === 1) {
                    // Show difficulty picker before rendering slots
                    _showDifficultyModal((difficulty) => {
                        _renderSinglePlayerSlots(existingPlayers, namesSection, difficulty);
                        startBtn.disabled = false;
                    });
                } else {
                    _renderPlayerSlots(n, existingPlayers, namesSection);
                    startBtn.disabled = false;
                }
            });
            countRow.appendChild(btn);
        });
        countSection.appendChild(countRow);
        _appTarget.appendChild(countSection);
        _appTarget.appendChild(namesSection);

        startBtn.addEventListener('click', () => {
            const gameTypeSel  = gameTypeRow.querySelector('.option-btn.selected');
            const checkoutSel  = checkoutRow.querySelector('.option-btn.selected');
            const setsSel      = setsRow.querySelector('.option-btn.selected');
            const legsSel      = legsRow.querySelector('.option-btn.selected');

            if (!gameTypeSel)  { showToast('SELECT A GAME TYPE', 'bust', 2000);      return; }
            if (!checkoutSel)  { showToast('SELECT A CHECKOUT RULE', 'bust', 2000);  return; }
            if (!setsSel)      { showToast('SELECT SETS TO WIN', 'bust', 2000);       return; }
            if (!legsSel)      { showToast('SELECT LEGS PER SET', 'bust', 2000);      return; }

            const players = _collectPlayerSelections(namesSection);
            if (!players) return;

            onStartGame({
                players,
                gameType:    gameTypeSel.dataset.value,
                doubleOut:   checkoutSel.dataset.value === 'double',
                setsToWin:   parseInt(setsSel.dataset.value, 10),
                legsPerSet:  parseInt(legsSel.dataset.value, 10),
            });
        });
        _appTarget.appendChild(startBtn);

        // ---- Stats button ----
        if (onViewStats) {
            const statsBtn = document.createElement('button');
            statsBtn.id = 'setup-stats-btn';
            statsBtn.className = 'stats-entry-btn';
            statsBtn.type = 'button';
            statsBtn.innerHTML = '📊  VIEW PLAYER STATS';
            statsBtn.addEventListener('click', onViewStats);
            _appTarget.appendChild(statsBtn);
        }



        // Defaults
        gameTypeRow.querySelector('[data-value="501"]').click();
        checkoutRow.querySelector('[data-value="double"]').click();
        setsRow.querySelector('[data-value="1"]').click();
        legsRow.querySelector('[data-value="1"]').click();
        countRow.querySelector('[data-count="2"]').click();
    }

    // ------------------------------------------------------------------
    // Player slots
    // ------------------------------------------------------------------

    function _renderPlayerSlots(count, existingPlayers, container) {
        container.innerHTML = '';
        const grid = document.createElement('div');
        grid.id = 'setup-names-grid';
        grid.style.gridTemplateColumns = count <= 2 ? '1fr 1fr' : 'repeat(4, 1fr)';
        for (let i = 0; i < count; i++) {
            // In 1-player mode, slot 1 (index 1) is always the CPU
            const isCpuSlot = (count === 1 && i === 1);
            grid.appendChild(_buildPlayerSlot(i, count, existingPlayers, isCpuSlot));
        }
        container.appendChild(grid);
        setTimeout(function() { var fi = container.querySelector('.name-input'); if (fi) fi.focus(); }, 150);
    }

    function _renderSinglePlayerSlots(existingPlayers, container, difficulty) {
        container.innerHTML = '';
        const grid = document.createElement('div');
        grid.id = 'setup-names-grid';
        grid.style.gridTemplateColumns = '1fr 1fr';

        // Human slot
        grid.appendChild(_buildPlayerSlot(0, 1, existingPlayers, false));

        // CPU slot — fixed, displays chosen difficulty
        const label = CPU.LABELS[difficulty] || difficulty;
        const cpuSlot = document.createElement('div');
        cpuSlot.className = 'name-slot cpu-slot';
        cpuSlot.dataset.mode       = 'cpu';
        cpuSlot.dataset.isCpu      = 'true';
        cpuSlot.dataset.difficulty = difficulty;
        cpuSlot.innerHTML = `
            <div class="name-label">OPPONENT</div>
            <div class="cpu-badge">🤖 CPU</div>
            <div class="cpu-difficulty">${_esc(label)}</div>
            <button class="cpu-change-btn" type="button">CHANGE</button>
        `;

        // Allow re-picking difficulty
        cpuSlot.querySelector('.cpu-change-btn').addEventListener('click', () => {
            _showDifficultyModal((newDifficulty) => {
                _renderSinglePlayerSlots(existingPlayers, container, newDifficulty);
            });
        });

        grid.appendChild(cpuSlot);
        container.appendChild(grid);
        setTimeout(function() { var fi = container.querySelector('.name-input'); if (fi) fi.focus(); }, 150);
    }

    /**
     * Show the CPU difficulty picker modal.
     * Calls onSelect(difficulty) when the user picks a level.
     */
    function _showDifficultyModal(onSelect) {
        var _dm = document.getElementById('difficulty-modal'); if (_dm) _dm.remove();

        const overlay = document.createElement('div');
        overlay.id = 'difficulty-modal';
        overlay.className = 'modal-overlay';

        const box = document.createElement('div');
        box.className = 'modal-box difficulty-box';

        box.innerHTML = `
            <div class="modal-title">SELECT CPU DIFFICULTY</div>
            <div class="modal-subtitle">HOW HARD DO YOU WANT IT?</div>
        `;

        const levels = [
            {
                key:   'easy',
                icon:  '🍺',
                label: CPU.LABELS.easy,
                desc:  'A gentle introduction. Will occasionally aim at the wrong bit of the board entirely.',
            },
            {
                key:   'medium',
                icon:  '🎯',
                label: CPU.LABELS.medium,
                desc:  'A steady club player. Knows the checkout routes, misses under pressure.',
            },
            {
                key:   'hard',
                icon:  '🏆',
                label: CPU.LABELS.hard,
                desc:  'Precise, methodical, merciless. Hits trebles, closes out doubles, rarely loses.',
            },
        ];

        const grid = document.createElement('div');
        grid.className = 'difficulty-grid';

        levels.forEach(lvl => {
            const card = document.createElement('button');
            card.className = 'difficulty-card';
            card.dataset.difficulty = lvl.key;
            card.type = 'button';
            card.innerHTML = `
                <span class="diff-icon">${lvl.icon}</span>
                <span class="diff-label">${_esc(lvl.label)}</span>
                <span class="diff-desc">${_esc(lvl.desc)}</span>
            `;
            card.addEventListener('click', () => {
                overlay.remove();
                onSelect(lvl.key);
            });
            grid.appendChild(card);
        });

        box.appendChild(grid);
        overlay.appendChild(box);

        // Tap outside to dismiss (re-shows modal since a difficulty must be picked)
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) overlay.remove();
        });

        document.body.appendChild(overlay);

        // Animate in
        requestAnimationFrame(() => overlay.classList.add('visible'));
    }

    function _buildPlayerSlot(index, totalCount, existingPlayers) {
        const slot = document.createElement('div');
        slot.className = 'name-slot';
        slot.dataset.index = index;

        const label = document.createElement('div');
        label.className = 'name-label';
        label.textContent = totalCount === 1 ? 'YOUR NAME' : `PLAYER ${index + 1}`;
        slot.appendChild(label);

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
        if (existingPlayers.length === 0) { existingBtn.disabled = true; existingBtn.title = 'No existing players'; }
        toggleRow.appendChild(newBtn);
        toggleRow.appendChild(existingBtn);
        slot.appendChild(toggleRow);

        const newInput = document.createElement('input');
        newInput.type = 'text'; newInput.className = 'name-input';
        newInput.placeholder = `Player ${index + 1} name`; newInput.maxLength = 20;
        newInput.autocomplete = 'off'; newInput.autocorrect = 'off';
        newInput.autocapitalize = 'words'; newInput.spellcheck = false;
        newInput.addEventListener('input', () => newInput.classList.remove('error'));
        slot.appendChild(newInput);

        const existingSelect = document.createElement('select');
        existingSelect.className = 'name-select';
        existingSelect.style.display = 'none';
        const ph = document.createElement('option');
        ph.value = ''; ph.textContent = '— Select player —'; ph.disabled = true; ph.selected = true;
        existingSelect.appendChild(ph);
        existingPlayers.filter(function(p) { return p.name !== 'CPU'; }).forEach(p => {
            const opt = document.createElement('option');
            opt.value = p.id; opt.textContent = p.name;
            existingSelect.appendChild(opt);
        });
        existingSelect.addEventListener('change', () => existingSelect.classList.remove('error'));
        slot.appendChild(existingSelect);

        function activateMode(mode) {
            if (mode === 'new') {
                newBtn.classList.add('active'); existingBtn.classList.remove('active');
                newInput.style.display = ''; existingSelect.style.display = 'none';
                slot.dataset.mode = 'new'; newInput.focus();
            } else {
                existingBtn.classList.add('active'); newBtn.classList.remove('active');
                newInput.style.display = 'none'; existingSelect.style.display = '';
                slot.dataset.mode = 'existing'; existingSelect.focus();
            }
        }
        newBtn.addEventListener('click', () => activateMode('new'));
        existingBtn.addEventListener('click', () => activateMode('existing'));
        slot.dataset.mode = 'new';
        return slot;
    }

    function _collectPlayerSelections(container) {
        const slots = container.querySelectorAll('.name-slot');
        const result = []; let valid = true; let firstErr = null;
        slots.forEach(slot => {
            const mode = slot.dataset.mode;

            // CPU slot — fixed, no validation needed
            if (mode === 'cpu') {
                result.push({ isCpu: true, name: 'CPU', difficulty: slot.dataset.difficulty || 'medium' });
                return;
            }

            if (mode === 'new') {
                const input = slot.querySelector('.name-input');
                const name = input.value.trim();
                if (!name) { input.classList.add('error'); if (!firstErr) firstErr = input; valid = false; }
                else result.push({ mode: 'new', name, isCpu: false });
            } else {
                const select = slot.querySelector('.name-select');
                if (!select.value) { select.classList.add('error'); if (!firstErr) firstErr = select; valid = false; }
                else result.push({ mode: 'existing', id: parseInt(select.value, 10), name: select.options[select.selectedIndex].textContent, isCpu: false });
            }
        });
        // Duplicate check — exclude CPU from dupe detection
        const names = result.filter(r => !r.isCpu).map(r => r.name.toLowerCase());
        if (names.some((n, i) => names.indexOf(n) !== i)) {
            showToast('EACH PLAYER MUST BE UNIQUE', 'bust', 3000); valid = false;
        }
        if (!valid && firstErr) firstErr.focus();
        return valid ? result : null;
    }

    // ------------------------------------------------------------------
    // Congratulations Modal
    // ------------------------------------------------------------------

    /**
     * Show the end-of-match congratulations modal.
     *
     * @param {string}   winnerName
     * @param {Array}    players        - [{ id, name }]
     * @param {object}   setsScore      - { playerId: setsWon }
     * @param {Function} onNewMatch     - called when user taps New Match
     */
    function showCongratsModal(winnerName, players, setsScore, onNewMatch) {
        // Remove any existing modal
        var _cm = document.getElementById('congrats-modal'); if (_cm) _cm.remove();

        const overlay = document.createElement('div');
        overlay.id = 'congrats-modal';
        overlay.className = 'modal-overlay';

        const box = document.createElement('div');
        box.className = 'modal-box';

        // Trophy + winner
        box.innerHTML = `
            <div class="modal-trophy">🎯</div>
            <div class="modal-title">CONGRATULATIONS</div>
            <div class="modal-winner">${_esc(winnerName)}</div>
            <div class="modal-subtitle">WINS THE MATCH</div>
        `;

        // Final sets score
        const scoreGrid = document.createElement('div');
        scoreGrid.className = 'modal-score-grid';
        players.forEach(p => {
            const row = document.createElement('div');
            row.className = 'modal-score-row';
            row.innerHTML = `
                <span class="modal-score-name">${_esc(p.name)}</span>
                <span class="modal-score-sets">${setsScore[String(p.id)] != null ? setsScore[String(p.id)] : 0} SET${((setsScore[String(p.id)] != null ? setsScore[String(p.id)] : 0)) !== 1 ? 'S' : ''}</span>
            `;
            scoreGrid.appendChild(row);
        });
        box.appendChild(scoreGrid);

        const newMatchBtn = document.createElement('button');
        newMatchBtn.className = 'start-btn';
        newMatchBtn.textContent = 'NEW MATCH';
        newMatchBtn.addEventListener('click', () => {
            overlay.remove();
            onNewMatch();
        });
        box.appendChild(newMatchBtn);

        overlay.appendChild(box);
        document.body.appendChild(overlay);
    }

    /**
     * Show an end-of-leg interstitial — who won, current set/legs score,
     * with a button to start the next leg.
     *
     * @param {object}   info           - { legWinnerName, setComplete, setWinnerName, setsScore, legsScore, legsPerSet }
     * @param {Array}    players        - [{ id, name }]
     * @param {Function} onNextLeg      - called when user taps Continue
     */
    function showLegEndModal(info, players, onNextLeg) {
        var _lem = document.getElementById('leg-end-modal'); if (_lem) _lem.remove();

        const overlay = document.createElement('div');
        overlay.id = 'leg-end-modal';
        overlay.className = 'modal-overlay';

        const box = document.createElement('div');
        box.className = 'modal-box';

        const legsToWinSet = Math.ceil(info.legsPerSet / 2);

        if (info.setComplete) {
            box.innerHTML = `
                <div class="modal-trophy">🏆</div>
                <div class="modal-title">SET WON</div>
                <div class="modal-winner">${_esc(info.setWinnerName)}</div>
                <div class="modal-subtitle">WINS THE SET</div>
            `;
        } else {
            box.innerHTML = `
                <div class="modal-trophy">🎯</div>
                <div class="modal-title">LEG WON</div>
                <div class="modal-winner">${_esc(info.legWinnerName)}</div>
                <div class="modal-subtitle">WINS THE LEG</div>
            `;
        }

        // Current set tally (sets score) and current leg tally within the set
        const scoreGrid = document.createElement('div');
        scoreGrid.className = 'modal-score-grid';
        players.forEach(p => {
            const pid   = String(p.id);
            var sets  = info.setsScore[pid] != null ? info.setsScore[pid] : 0;
            var legs  = info.legsScore[pid] != null ? info.legsScore[pid] : 0;
            const row   = document.createElement('div');
            row.className = 'modal-score-row';
            row.innerHTML = `
                <span class="modal-score-name">${_esc(p.name)}</span>
                <span class="modal-score-sets">${sets} SET${sets !== 1 ? 'S' : ''}</span>
                <span class="modal-score-legs">${legs}/${legsToWinSet} LEGS</span>
            `;
            scoreGrid.appendChild(row);
        });
        box.appendChild(scoreGrid);

        const continueBtn = document.createElement('button');
        continueBtn.className = 'start-btn';
        continueBtn.textContent = 'NEXT LEG ▶';
        continueBtn.addEventListener('click', () => {
            overlay.remove();
            onNextLeg();
        });
        box.appendChild(continueBtn);

        overlay.appendChild(box);
        document.body.appendChild(overlay);
    }

    // ------------------------------------------------------------------
    // Game Shell
    // ------------------------------------------------------------------

    function buildShell(players, callbacks) {
        const app = document.getElementById('app');
        app.innerHTML = '';
        app.style.cssText = '';
        document.body.className = 'mode-game';
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

        const title = document.createElement('h1');
        title.textContent = 'DARTS 501';

        const matchInfo = document.createElement('span');
        matchInfo.id = 'match-info';

        const speechBtn = document.createElement('button');
        speechBtn.id    = 'btn-speech';
        speechBtn.type  = 'button';
        speechBtn.title = 'Toggle caller voice';
        speechBtn.className = 'speech-toggle';
        speechBtn.setAttribute('aria-pressed', 'true');
        _updateSpeechBtn(speechBtn, true);

        speechBtn.addEventListener('click', function() {
            if (!SPEECH.isSupported()) {
                return;
            }
            var nowEnabled = !SPEECH.isEnabled();
            SPEECH.setEnabled(nowEnabled);
            _updateSpeechBtn(speechBtn, nowEnabled);
        });

        el.appendChild(title);
        el.appendChild(matchInfo);
        el.appendChild(speechBtn);
        return el;
    }

    function _updateSpeechBtn(btn, enabled) {
        btn.textContent = enabled ? '🔊 CALLER' : '🔇 CALLER';
        btn.className   = 'speech-toggle' + (enabled ? ' speech-on' : '');
        btn.setAttribute('aria-pressed', enabled ? 'true' : 'false');
    }

    function _buildSidebar(players) {
        const el = document.createElement('aside');
        el.id = 'sidebar';
        players.forEach(p => el.appendChild(_buildPlayerCard(p)));
        el.appendChild(_buildCheckoutPanel());
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

    function _buildCheckoutPanel() {
        const panel = document.createElement('div');
        panel.id = 'checkout-panel';
        panel.className = 'checkout-panel hidden';

        const heading = document.createElement('div');
        heading.className = 'checkout-panel-heading';
        heading.textContent = 'CHECKOUT';
        panel.appendChild(heading);

        const routes = document.createElement('div');
        routes.id = 'checkout-routes';
        routes.className = 'checkout-routes';
        panel.appendChild(routes);

        return panel;
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
        [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20].forEach(seg => {
            const btn = document.createElement('button');
            btn.className = 'seg-btn';
            btn.textContent = seg;
            btn.dataset.segment = seg;
            btn.addEventListener('click', () => onSegment(seg));
            grid.appendChild(btn);
        });
        return grid;
    }

    function _buildBullRow(onSegment) {
        const row = document.createElement('div');
        row.id = 'bull-row';
        const miss = document.createElement('button');
        miss.className = 'bull-btn miss-btn'; miss.textContent = 'MISS';
        miss.addEventListener('click', () => onSegment(0, 1));
        row.appendChild(miss);
        const outer = document.createElement('button');
        outer.className = 'bull-btn'; outer.innerHTML = 'OUTER<br><small>25</small>';
        outer.addEventListener('click', () => onSegment(25, 1));
        row.appendChild(outer);
        const bull = document.createElement('button');
        bull.className = 'bull-btn'; bull.innerHTML = 'BULL<br><small>50</small>';
        bull.addEventListener('click', () => onSegment(25, 2));
        row.appendChild(bull);
        row.appendChild(document.createElement('div'));
        return row;
    }

    function _buildStatusBar(callbacks) {
        const el = document.createElement('footer');
        el.id = 'status-bar';

        // Left slot (flex:1) — UNDO, left-aligned
        const leftSlot = document.createElement('div');
        leftSlot.className = 'status-slot status-slot-left';

        const undoBtn = document.createElement('button');
        undoBtn.className = 'action-btn undo'; undoBtn.id = 'btn-undo';
        undoBtn.textContent = '⟵ UNDO';
        undoBtn.addEventListener('click', callbacks.onUndo);
        leftSlot.appendChild(undoBtn);

        // Centre slot — Cancel / Restart / status message stacked
        const centreSlot = document.createElement('div');
        centreSlot.className = 'status-slot status-slot-centre';

        const cancelBtn = document.createElement('button');
        cancelBtn.className = 'action-btn match-cancel'; cancelBtn.id = 'btn-cancel';
        cancelBtn.textContent = '✕ CANCEL';
        cancelBtn.addEventListener('click', callbacks.onCancel);

        const restartBtn = document.createElement('button');
        restartBtn.className = 'action-btn match-restart'; restartBtn.id = 'btn-restart';
        restartBtn.textContent = '↺ RESTART';
        restartBtn.addEventListener('click', callbacks.onRestart);

        const msg = document.createElement('span');
        msg.id = 'status-message';
        msg.textContent = 'SELECT MULTIPLIER THEN SEGMENT';

        centreSlot.appendChild(cancelBtn);
        centreSlot.appendChild(restartBtn);
        centreSlot.appendChild(msg);

        // Right slot (flex:1) — NEXT, right-aligned
        const rightSlot = document.createElement('div');
        rightSlot.className = 'status-slot status-slot-right';

        const nextBtn = document.createElement('button');
        nextBtn.className = 'action-btn next-player'; nextBtn.id = 'btn-next';
        nextBtn.textContent = 'NEXT ▶'; nextBtn.disabled = true;
        nextBtn.addEventListener('click', callbacks.onNextPlayer);
        rightSlot.appendChild(nextBtn);

        el.appendChild(leftSlot);
        el.appendChild(centreSlot);
        el.appendChild(rightSlot);
        return el;
    }

    function _buildToast() { const el = document.createElement('div'); el.id = 'toast'; return el; }
    function _buildLoading() { const el = document.createElement('div'); el.id = 'loading'; el.textContent = 'SYNCING...'; return el; }

    // ------------------------------------------------------------------
    // Update helpers
    // ------------------------------------------------------------------

    function setActivePlayer(playerId) {
        document.querySelectorAll('.player-card').forEach(c => c.classList.remove('active'));
        var _pc = document.getElementById('player-card-' + playerId); if (_pc) _pc.classList.add('active');
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
        if (segment === 25) pill.classList.add('bull');
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

    /**
     * Update the checkout suggestion panel on the board.
     * @param {number|null} score     — current player's score (null to hide)
     * @param {boolean}     doubleOut — true = double-out game rules
     */
    function setCheckoutPanel(score, doubleOut) {
        const panel  = document.getElementById('checkout-panel');
        const routes = document.getElementById('checkout-routes');
        if (!panel || !routes) return;

        // Hide if score is out of range or CHECKOUT module not available
        if (score === null || score > 170 || score < 1 || typeof CHECKOUT === 'undefined') {
            panel.classList.add('hidden');
            return;
        }

        const suggestions = CHECKOUT.suggest(score, doubleOut);

        // In double-out mode only show double route; in single-out show both
        // Always show both so the player can compare, but label clearly
        const doubleRoute = suggestions.double;
        const singleRoute = suggestions.single;

        // If neither route exists, hide the panel
        if (!doubleRoute && !singleRoute) {
            panel.classList.add('hidden');
            return;
        }

        routes.innerHTML = '';

        function buildRouteRow(label, route, isActive) {
            const row = document.createElement('div');
            row.className = 'checkout-route-row' + (isActive ? ' route-active' : ' route-dim');

            const lbl = document.createElement('span');
            lbl.className = 'checkout-route-label';
            lbl.textContent = label;
            row.appendChild(lbl);

            const darts = document.createElement('span');
            darts.className = 'checkout-route-darts';

            if (route) {
                route.forEach(function(dart, i) {
                    const chip = document.createElement('span');
                    chip.className = 'checkout-dart-chip';
                    chip.textContent = CHECKOUT.formatDart(dart);
                    darts.appendChild(chip);
                    if (i < route.length - 1) {
                        const arrow = document.createElement('span');
                        arrow.className = 'checkout-arrow';
                        arrow.textContent = '→';
                        darts.appendChild(arrow);
                    }
                });
            } else {
                const na = document.createElement('span');
                na.className = 'checkout-na';
                na.textContent = 'NO ROUTE';
                darts.appendChild(na);
            }

            row.appendChild(darts);
            return row;
        }

        // Double-out route (active/required in double-out game)
        routes.appendChild(buildRouteRow('D-OUT', doubleRoute, doubleOut));

        // Single-out route (active/required in single-out game)
        routes.appendChild(buildRouteRow('S-OUT', singleRoute, !doubleOut));

        panel.classList.remove('hidden');
    }
    function flashCard(playerId, type) {
        const card = document.getElementById(`player-card-${playerId}`);
        if (!card) return;
        card.classList.add(type);
        setTimeout(() => card.classList.remove(type), 1200);
    }
    function setMultiplierTab(multiplier) {
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active-single', 'active-double', 'active-treble'));
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
    function setLoading(visible) { var _ld = document.getElementById('loading'); if (_ld) _ld.classList.toggle('visible', visible); }
    function setMatchInfo(text) { const el = document.getElementById('match-info'); if (el) el.textContent = text; }

    function setUndoEnabled(enabled) {
        const btn = document.getElementById('btn-undo');
        if (btn) btn.disabled = !enabled;
    }

    function updatePlayerSetLegs(playerId, sets, legs) {
        const card = document.getElementById(`player-card-${playerId}`);
        if (!card) return;
        let tally = card.querySelector('.player-tally');
        if (!tally) {
            tally = document.createElement('div');
            tally.className = 'player-tally';
            card.appendChild(tally);
        }
        tally.textContent = `${sets}S / ${legs}L`;
    }

    function _esc(str) {
        return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    /**
     * Show a confirmation modal with a title, message, and confirm/cancel buttons.
     *
     * @param {object}   opts
     * @param {string}   opts.title        - Short heading e.g. "CANCEL MATCH?"
     * @param {string}   opts.message      - Explanatory sentence
     * @param {string}   opts.confirmLabel - Text on the confirm button e.g. "YES, CANCEL"
     * @param {string}   opts.confirmClass - Extra CSS class for confirm button e.g. "btn-danger"
     * @param {Function} opts.onConfirm    - Called if user confirms
     */
    function showConfirmModal(opts) {
        var existing = document.getElementById('confirm-modal');
        if (existing) existing.remove();

        var overlay = document.createElement('div');
        overlay.id = 'confirm-modal';
        overlay.className = 'modal-overlay';

        var box = document.createElement('div');
        box.className = 'modal-box confirm-box';

        var titleEl = document.createElement('div');
        titleEl.className = 'modal-title confirm-title';
        titleEl.textContent = opts.title;

        var msgEl = document.createElement('div');
        msgEl.className = 'confirm-message';
        msgEl.textContent = opts.message;

        var btnRow = document.createElement('div');
        btnRow.className = 'confirm-btn-row';

        var cancelBtn = document.createElement('button');
        cancelBtn.className = 'confirm-btn confirm-btn-cancel';
        cancelBtn.type = 'button';
        cancelBtn.textContent = 'NO, GO BACK';
        cancelBtn.addEventListener('click', function() { overlay.remove(); });

        var confirmBtn = document.createElement('button');
        confirmBtn.className = 'confirm-btn ' + (opts.confirmClass || 'confirm-btn-ok');
        confirmBtn.type = 'button';
        confirmBtn.textContent = opts.confirmLabel || 'CONFIRM';
        confirmBtn.addEventListener('click', function() {
            overlay.remove();
            opts.onConfirm();
        });

        btnRow.appendChild(cancelBtn);
        btnRow.appendChild(confirmBtn);
        box.appendChild(titleEl);
        box.appendChild(msgEl);
        box.appendChild(btnRow);
        overlay.appendChild(box);
        overlay.addEventListener('click', function(e) { if (e.target === overlay) overlay.remove(); });
        document.body.appendChild(overlay);
    }

    return {
        buildSetupScreen,
        buildShell,
        showCongratsModal,
        showLegEndModal,
        showConfirmModal,
        setActivePlayer,
        setScore,
        addDartPill,
        clearDartPills,
        setCheckoutHint,
        setCheckoutPanel,
        flashCard,
        setMultiplierTab,
        setNextPlayerEnabled,
        setUndoEnabled,
        setStatus,
        showToast,
        setLoading,
        setMatchInfo,
        updatePlayerSetLegs,
    };

})();