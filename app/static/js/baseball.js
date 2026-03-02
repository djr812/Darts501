/**
 * baseball.js
 * -----------
 * Multiplayer Baseball Darts game controller.
 *
 * Public API:
 *   BASEBALL_GAME.start(config, onEnd)
 *     config: { players: [{id, name}] }
 *     onEnd:  called when game ends or is abandoned
 */

var BASEBALL_GAME = (function () {

    var _state = {
        matchId:            null,
        gameId:             null,
        players:            [],
        startNumber:        1,
        currentInning:      1,
        currentPlayerIndex: 0,
        currentPlayerId:    null,
        innings:            {},   // { pid: { inningNum: { runs, outs, darts, complete } } }
        totalRuns:          {},   // { pid: total }
        currentThrows:      [],   // throws in current set
        dartsInSet:         0,
        status:             'active',
        winnerIds:          null,
        highScoreResults:   null,
        onEnd:              null,
        // Local UI state
        setComplete:        false,  // board locked after 3rd dart in a set
        inningComplete:     false,  // 3 outs reached — inning is over
    };

    var _throwHistory  = []; // local undo stack (cleared on NEXT)
    var _pendingThrows = []; // buffered throws for current set, submitted on NEXT

    // ─────────────────────────────────────────────────────────────────
    // Public: start
    // ─────────────────────────────────────────────────────────────────

    function start(config, onEnd) {
        SPEECH.unlock();
        if (typeof SOUNDS !== 'undefined') SOUNDS.unlock();
        UI.setLoading(true);

        _resolvePlayers(config.players)
            .then(function (players) {
                return API.createBaseballMatch({ player_ids: players.map(function (p) { return p.id; }) });
            })
            .then(function (state) {
                _applyState(state);
                _state.onEnd = onEnd;
                UI.setLoading(false);
                _buildScreen();
                _announceCurrentPlayer(true);
            })
            .catch(function (err) {
                UI.setLoading(false);
                UI.showToast((err && err.message ? err.message : 'Error starting game').toUpperCase(), 'bust', 4000);
                console.error('[baseball] start error:', err);
            });
    }

    // ─────────────────────────────────────────────────────────────────
    // Player resolution
    // ─────────────────────────────────────────────────────────────────

    function _resolvePlayers(selections) {
        var promises = selections.map(function (sel) {
            if (sel.mode === 'existing') {
                return Promise.resolve({ id: sel.id, name: sel.name });
            } else {
                return API.createPlayer(sel.name)
                    .then(function (p) { return { id: p.id, name: p.name }; });
            }
        });
        return Promise.all(promises);
    }

    // ─────────────────────────────────────────────────────────────────
    // State application
    // ─────────────────────────────────────────────────────────────────

    function _applyState(s) {
        _state.matchId            = s.match_id;
        _state.gameId             = s.game_id;
        _state.players            = s.players || [];
        _state.startNumber        = s.start_number;
        _state.currentInning      = s.current_inning;
        _state.currentPlayerIndex = s.current_player_index;
        _state.currentPlayerId    = s.current_player_id ? String(s.current_player_id) : null;
        _state.innings            = s.innings || {};
        _state.totalRuns          = s.total_runs || {};
        _state.currentThrows      = s.current_throws || [];
        _state.dartsInSet         = s.darts_in_set || 0;
        _state.status             = s.status || 'active';
        _state.winnerIds          = s.winner_ids || null;
        _state.highScoreResults   = s.high_score_results || null;

        // Derive local UI state
        var inn = _currentInningData();
        _state.inningComplete = inn ? (inn.outs >= 3 && (inn.darts % 3 === 0)) : false;
        _state.setComplete    = inn ? (inn.darts > 0 && inn.darts % 3 === 0) : false;
    }

    function _currentInningData() {
        var pid = String(_state.currentPlayerId);
        var inns = _state.innings[pid];
        if (!inns) return null;
        return inns[_state.currentInning] || null;
    }

    function _targetNumber() {
        return _state.startNumber + _state.currentInning - 1;
    }

    function _currentPlayer() {
        return _state.players.find(function (p) {
            return String(p.id) === String(_state.currentPlayerId);
        }) || _state.players[_state.currentPlayerIndex] || null;
    }

    // ─────────────────────────────────────────────────────────────────
    // Screen build
    // ─────────────────────────────────────────────────────────────────

    function _buildScreen() {
        ['confirm-modal', 'rules-modal'].forEach(function (id) {
            var el = document.getElementById(id);
            if (el) el.remove();
        });

        var app = document.getElementById('app');
        app.innerHTML = '';
        app.style.cssText = '';
        document.body.className = 'mode-baseball';

        // ── Header ───────────────────────────────────────────────────
        var header = document.createElement('div');
        header.className = 'game-header';

        var leftSlot = document.createElement('div');
        leftSlot.className = 'gh-left';
        var titleWrap = document.createElement('div');
        titleWrap.className = 'gh-title-wrap';
        var titleEl = document.createElement('div');
        titleEl.className = 'gh-game-name';
        titleEl.textContent = 'BASEBALL';
        var subEl = document.createElement('div');
        subEl.className = 'gh-match-info';
        subEl.id = 'bb-mp-subtitle';
        subEl.textContent = _state.players.length + ' PLAYERS · 9 INNINGS';
        titleWrap.appendChild(titleEl);
        titleWrap.appendChild(subEl);
        leftSlot.appendChild(titleWrap);
        var rulesBtn = document.createElement('button');
        rulesBtn.type = 'button';
        rulesBtn.className = 'rules-btn';
        rulesBtn.textContent = '📖 RULES';
        rulesBtn.addEventListener('click', function () { UI.showRulesModal('baseball'); });
        leftSlot.appendChild(rulesBtn);
        header.appendChild(leftSlot);

        var centreSlot = document.createElement('div');
        centreSlot.className = 'gh-centre';
        var endBtn = document.createElement('button');
        endBtn.className = 'gh-btn gh-btn-red';
        endBtn.type = 'button';
        endBtn.textContent = '✕ END';
        endBtn.addEventListener('click', _onEnd);
        centreSlot.appendChild(endBtn);
        header.appendChild(centreSlot);

        var rightSlot = document.createElement('div');
        rightSlot.className = 'gh-right';
        var undoBtn = document.createElement('button');
        undoBtn.id = 'bbmp-undo-btn';
        undoBtn.className = 'gh-btn gh-btn-undo';
        undoBtn.type = 'button';
        undoBtn.textContent = '⟵ UNDO';
        undoBtn.disabled = true;
        undoBtn.addEventListener('click', _onUndo);
        var nextBtn = document.createElement('button');
        nextBtn.id = 'bbmp-next-btn';
        nextBtn.className = 'gh-btn gh-btn-next';
        nextBtn.type = 'button';
        nextBtn.textContent = 'NEXT ▶';
        nextBtn.disabled = true;
        nextBtn.addEventListener('click', _onNext);
        rightSlot.appendChild(undoBtn);
        rightSlot.appendChild(nextBtn);
        header.appendChild(rightSlot);
        app.appendChild(header);

        // ── Scoreboard ───────────────────────────────────────────────
        var scoreBoard = document.createElement('div');
        scoreBoard.id = 'bbmp-scoreboard';
        scoreBoard.className = 'bbmp-scoreboard';
        app.appendChild(scoreBoard);
        _renderScoreboard(scoreBoard);

        // ── Status bar ───────────────────────────────────────────────
        var statusBar = document.createElement('div');
        statusBar.id = 'bbmp-status';
        statusBar.className = 'bbmp-status';
        app.appendChild(statusBar);
        _updateStatus();

        // ── Dart pills ───────────────────────────────────────────────
        var pills = document.createElement('div');
        pills.id = 'bbmp-pills';
        pills.className = 'practice-pills';
        app.appendChild(pills);

        // ── Multiplier tabs ──────────────────────────────────────────
        _state.multiplier = 1;
        var tabs = document.createElement('div');
        tabs.id = 'bbmp-tabs';
        tabs.className = 'bbmp-tabs';
        [
            { label: 'Single', mul: 1, cls: 'active-single' },
            { label: 'Double', mul: 2, cls: 'active-double' },
            { label: 'Treble', mul: 3, cls: 'active-treble' },
        ].forEach(function (tab) {
            var btn = document.createElement('button');
            btn.className = 'tab-btn' + (tab.mul === 1 ? ' active-single' : '');
            btn.dataset.multiplier = tab.mul;
            btn.dataset.activeClass = tab.cls;
            btn.type = 'button';
            btn.textContent = tab.label;
            UI.addTouchSafeListener(btn, function () {
                if (_state.setComplete) return;
                _state.multiplier = tab.mul;
                tabs.querySelectorAll('.tab-btn').forEach(function (b) {
                    b.classList.remove('active-single', 'active-double', 'active-treble');
                });
                btn.classList.add(tab.cls);
                document.body.dataset.multiplier = tab.mul;
            });
            tabs.appendChild(btn);
        });
        document.body.dataset.multiplier = 1;
        app.appendChild(tabs);

        // ── Segment grid ─────────────────────────────────────────────
        var segBoard = document.createElement('main');
        segBoard.id = 'bbmp-board';
        app.appendChild(segBoard);
        segBoard.appendChild(_buildGrid());
        segBoard.appendChild(_buildBullRow());

        _applyTargetHighlight();
    }

    // ─────────────────────────────────────────────────────────────────
    // Segment grid
    // ─────────────────────────────────────────────────────────────────

    function _buildGrid() {
        var grid = document.createElement('div');
        grid.id = 'segment-grid';
        grid.className = 'segment-grid';
        var target = _targetNumber();
        for (var seg = 1; seg <= 20; seg++) {
            var btn = document.createElement('button');
            btn.className = 'seg-btn' + (seg === target ? ' target-highlight' : '');
            btn.dataset.segment = seg;
            btn.type = 'button';
            btn.textContent = seg;
            (function (s) {
                btn.addEventListener('click', function () { _onThrow(s, _state.multiplier); });
            })(seg);
            grid.appendChild(btn);
        }
        return grid;
    }

    function _buildBullRow() {
        var row = document.createElement('div');
        row.id = 'bull-row';
        row.className = 'bull-row';

        var miss = document.createElement('button');
        miss.className = 'seg-btn bull-btn';
        miss.type = 'button';
        miss.textContent = 'MISS';
        miss.addEventListener('click', function () { _onThrow(0, 0); });
        row.appendChild(miss);

        var outer = document.createElement('button');
        outer.className = 'seg-btn bull-btn';
        outer.type = 'button';
        outer.textContent = 'OUTER';
        outer.dataset.segment = 25;
        outer.addEventListener('click', function () { _onThrow(25, 1); });
        row.appendChild(outer);

        var bull = document.createElement('button');
        bull.className = 'seg-btn bull-btn bull-btn-inner';
        bull.type = 'button';
        bull.textContent = 'BULL';
        bull.dataset.segment = 25;
        bull.addEventListener('click', function () { _onThrow(25, 2); });
        row.appendChild(bull);

        return row;
    }

    function _applyTargetHighlight() {
        document.querySelectorAll('#bbmp-board .seg-btn').forEach(function (btn) {
            btn.classList.remove('target-highlight');
        });
        var t = _targetNumber();
        var btn = document.querySelector('#bbmp-board .seg-btn[data-segment="' + t + '"]');
        if (btn) btn.classList.add('target-highlight');
    }

    // ─────────────────────────────────────────────────────────────────
    // Scoreboard
    // ─────────────────────────────────────────────────────────────────

    function _renderScoreboard(container) {
        container.innerHTML = '';
        var numInnings = 9;
        var startNum   = _state.startNumber;

        // Header row: blank + inning numbers + total
        var headRow = document.createElement('div');
        headRow.className = 'bbmp-sb-row bbmp-sb-head';
        var nameCell = document.createElement('div');
        nameCell.className = 'bbmp-sb-name';
        headRow.appendChild(nameCell);
        for (var i = 0; i < numInnings; i++) {
            var hCell = document.createElement('div');
            hCell.className = 'bbmp-sb-cell bbmp-sb-inn-head';
            hCell.textContent = startNum + i;
            headRow.appendChild(hCell);
        }
        var totHead = document.createElement('div');
        totHead.className = 'bbmp-sb-cell bbmp-sb-total-head';
        totHead.textContent = 'R';
        headRow.appendChild(totHead);
        container.appendChild(headRow);

        // One row per player
        _state.players.forEach(function (p) {
            var pid  = String(p.id);
            var row  = document.createElement('div');
            row.className = 'bbmp-sb-row' +
                (pid === String(_state.currentPlayerId) ? ' bbmp-sb-active' : '');
            row.id = 'bbmp-row-' + pid;

            var nCell = document.createElement('div');
            nCell.className = 'bbmp-sb-name';
            nCell.textContent = p.name.toUpperCase();
            row.appendChild(nCell);

            for (var inn = 1; inn <= numInnings; inn++) {
                var cell = document.createElement('div');
                var isCurrentCell = (pid === String(_state.currentPlayerId) &&
                                     inn === _state.currentInning);
                cell.className = 'bbmp-sb-cell' +
                    (isCurrentCell ? ' bbmp-sb-cell-current' : '');
                cell.id = 'bbmp-cell-' + pid + '-' + inn;

                var innData = (_state.innings[pid] || {})[inn];
                if (innData && innData.complete) {
                    cell.textContent = innData.runs;
                } else if (isCurrentCell) {
                    var cur = _currentInningData();
                    cell.textContent = cur ? cur.runs : '·';
                } else {
                    cell.textContent = '·';
                }
                row.appendChild(cell);
            }

            var totCell = document.createElement('div');
            totCell.className = 'bbmp-sb-cell bbmp-sb-total';
            totCell.id = 'bbmp-total-' + pid;
            totCell.textContent = _state.totalRuns[pid] || 0;
            row.appendChild(totCell);

            container.appendChild(row);
        });

        // Outs indicators for current player
        var outsRow = document.createElement('div');
        outsRow.className = 'bbmp-outs-row';
        outsRow.id = 'bbmp-outs-row';
        _renderOuts(outsRow);
        container.appendChild(outsRow);
    }

    function _renderOuts(container) {
        container.innerHTML = '';
        var label = document.createElement('span');
        label.className = 'bbmp-outs-label';
        label.textContent = 'OUTS:';
        container.appendChild(label);
        var inn = _currentInningData();
        var outs = inn ? inn.outs : 0;
        for (var i = 0; i < 3; i++) {
            var pip = document.createElement('span');
            pip.className = 'bb-out-pip' + (i < outs ? ' bb-out-pip-on' : '');
            container.appendChild(pip);
        }
    }

    function _updateScoreboard() {
        // Update active row highlight
        _state.players.forEach(function (p) {
            var pid = String(p.id);
            var row = document.getElementById('bbmp-row-' + pid);
            if (row) {
                row.classList.toggle('bbmp-sb-active', pid === String(_state.currentPlayerId));
            }
            // Update all inning cells for this player
            for (var inn = 1; inn <= 9; inn++) {
                var cell = document.getElementById('bbmp-cell-' + pid + '-' + inn);
                if (!cell) continue;
                var isCurrentCell = (pid === String(_state.currentPlayerId) &&
                                     inn === _state.currentInning);
                cell.className = 'bbmp-sb-cell' + (isCurrentCell ? ' bbmp-sb-cell-current' : '');
                var innData = (_state.innings[pid] || {})[inn];
                if (innData && innData.complete) {
                    cell.textContent = innData.runs;
                } else if (isCurrentCell) {
                    var cur = _currentInningData();
                    cell.textContent = cur ? cur.runs : '·';
                } else {
                    cell.textContent = '·';
                }
            }
            var totCell = document.getElementById('bbmp-total-' + pid);
            if (totCell) totCell.textContent = _state.totalRuns[pid] || 0;
        });
        var outsRow = document.getElementById('bbmp-outs-row');
        if (outsRow) _renderOuts(outsRow);
    }

    // ─────────────────────────────────────────────────────────────────
    // Status bar
    // ─────────────────────────────────────────────────────────────────

    function _updateStatus() {
        var el = document.getElementById('bbmp-status');
        if (!el) return;
        var player = _currentPlayer();
        var name   = player ? player.name.toUpperCase() : '';
        var inn    = _currentInningData();
        var outs   = inn ? inn.outs : 0;
        var target = _targetNumber();
        if (_state.status !== 'active') {
            el.textContent = 'GAME OVER';
            return;
        }
        var outsLeft = 3 - outs;
        el.textContent = name + '  ·  INNING ' + _state.currentInning + ' / 9' +
            '  ·  TARGET ' + target +
            '  ·  ' + outsLeft + (outsLeft === 1 ? ' OUT' : ' OUTS') + ' REMAINING';
    }

    // ─────────────────────────────────────────────────────────────────
    // Throw handling
    // ─────────────────────────────────────────────────────────────────

    function _onThrow(segment, multiplier) {
        if (_state.setComplete || _state.status !== 'active') return;
        // Enforce max 3 darts per set locally
        if (_pendingThrows.length >= 3) return;

        var target = _targetNumber();
        var isHit  = (segment === target);
        var runs   = isHit ? multiplier : 0;
        var isOut  = !isHit;

        // Buffer the throw
        _pendingThrows.push({ segment: segment, multiplier: multiplier, runs: runs, isOut: isOut });
        _throwHistory.push({ segment: segment, multiplier: multiplier, runs: runs, isOut: isOut });

        // Update local display state
        if (!_state.innings[String(_state.currentPlayerId)]) {
            _state.innings[String(_state.currentPlayerId)] = {};
        }
        var pid = String(_state.currentPlayerId);
        if (!_state.innings[pid][_state.currentInning]) {
            _state.innings[pid][_state.currentInning] = { runs: 0, outs: 0, darts: 0, complete: false };
        }
        var inn = _state.innings[pid][_state.currentInning];
        inn.runs  += runs;
        inn.outs  += isOut ? 1 : 0;
        inn.darts += 1;
        _state.totalRuns[pid] = (_state.totalRuns[pid] || 0) + runs;

        // Sound
        if (typeof SOUNDS !== 'undefined' && SOUNDS.isEnabled()) {
            isHit ? SOUNDS.dart() : (SOUNDS.bust && SOUNDS.bust());
        }

        // Pill
        _addPill(segment, multiplier, runs, isHit);

        // Speech
        _speakDart(isHit, runs);

        _updateScoreboard();
        _updateStatus();

        var undoBtn = document.getElementById('bbmp-undo-btn');
        if (undoBtn) undoBtn.disabled = false;

        // After 3 darts — lock board, enable NEXT
        if (_pendingThrows.length >= 3) {
            _endSet(inn);
        }
    }

    function _endSet(inn) {
        _state.setComplete   = true;
        _state.inningComplete = inn && inn.outs >= 3;

        _lockBoard(true);
        var nb = document.getElementById('bbmp-next-btn');
        if (nb) nb.disabled = false;

        if (_state.inningComplete) {
            _speakInningEnd(inn);
            if (typeof SOUNDS !== 'undefined' && SOUNDS.isEnabled()) {
                setTimeout(function () { SOUNDS.checkout && SOUNDS.checkout(); }, 300);
            }
        } else {
            // Announce outs remaining
            if (SPEECH.isEnabled()) {
                var outsLeft = 3 - inn.outs;
                setTimeout(function () {
                    window.speechSynthesis && window.speechSynthesis.speak(
                        Object.assign(new SpeechSynthesisUtterance(
                            outsLeft + (outsLeft === 1 ? ' out' : ' outs') + ' remaining.'
                        ), { rate: 1.0, pitch: 1.0 })
                    );
                }, 700);
            }
        }
    }

    // ─────────────────────────────────────────────────────────────────
    // Next
    // ─────────────────────────────────────────────────────────────────

    function _onNext() {
        UI.setLoading(true);
        var inningComplete = _state.inningComplete;
        var throwsToSubmit = _pendingThrows.slice(); // copy before clearing

        // Submit buffered throws first, then advance
        var submitPromise = throwsToSubmit.length > 0
            ? API.recordBaseballThrow(_state.matchId, { throws: throwsToSubmit })
            : Promise.resolve(null);

        submitPromise
            .then(function () {
                return API.baseballNext(_state.matchId, { inning_complete: inningComplete });
            })
            .then(function (s) {
                _throwHistory  = [];
                _pendingThrows = [];
                _state.setComplete    = false;
                _state.inningComplete = false;
                _applyState(s);
                UI.setLoading(false);

                // Clear pills & reset buttons
                var pills = document.getElementById('bbmp-pills');
                if (pills) pills.innerHTML = '';
                var nb = document.getElementById('bbmp-next-btn');
                if (nb) nb.disabled = true;
                var ub = document.getElementById('bbmp-undo-btn');
                if (ub) ub.disabled = true;
                _lockBoard(false);

                // Reset multiplier tab to Single
                _state.multiplier = 1;
                var tabs = document.getElementById('bbmp-tabs');
                if (tabs) {
                    tabs.querySelectorAll('.tab-btn').forEach(function (b) {
                        b.classList.remove('active-single', 'active-double', 'active-treble');
                    });
                    var s1 = tabs.querySelector('[data-multiplier="1"]');
                    if (s1) s1.classList.add('active-single');
                }
                document.body.dataset.multiplier = 1;

                if (s.status === 'complete') {
                    _showResult(s);
                    return;
                }

                _updateScoreboard();
                _updateStatus();
                _applyTargetHighlight();
                _announceCurrentPlayer(false);
            })
            .catch(function (err) {
                UI.setLoading(false);
                UI.showToast('ERROR', 'bust', 3000);
                console.error('[baseball] next error:', err);
            });
    }

    // ─────────────────────────────────────────────────────────────────
    // Undo
    // ─────────────────────────────────────────────────────────────────

    function _onUndo() {
        if (_throwHistory.length === 0) return;

        var last = _throwHistory.pop();
        _pendingThrows.pop();

        // Reverse the local state update
        var pid = String(_state.currentPlayerId);
        var inn = _state.innings[pid] && _state.innings[pid][_state.currentInning];
        if (inn) {
            inn.runs  -= last.runs;
            inn.outs  -= last.isOut ? 1 : 0;
            inn.darts -= 1;
        }
        _state.totalRuns[pid] = (_state.totalRuns[pid] || 0) - last.runs;

        // If board was locked after 3rd dart, unlock it
        if (_state.setComplete) {
            _state.setComplete    = false;
            _state.inningComplete = false;
            _lockBoard(false);
            var nb = document.getElementById('bbmp-next-btn');
            if (nb) nb.disabled = true;
        }

        // Remove last pill
        var pills = document.getElementById('bbmp-pills');
        if (pills && pills.lastChild) pills.removeChild(pills.lastChild);

        var ub = document.getElementById('bbmp-undo-btn');
        if (ub) ub.disabled = (_throwHistory.length === 0);

        _updateScoreboard();
        _updateStatus();
    }

    // ─────────────────────────────────────────────────────────────────
    // End / abandon
    // ─────────────────────────────────────────────────────────────────

    function _onEnd() {
        UI.showConfirmModal({
            title:    'END GAME?',
            message:  'Abandon this Baseball match?',
            onConfirm: function () {
                UI.setLoading(true);
                API.endBaseballMatch(_state.matchId)
                    .then(function () {
                        UI.setLoading(false);
                        if (_state.onEnd) _state.onEnd();
                    })
                    .catch(function () {
                        UI.setLoading(false);
                        if (_state.onEnd) _state.onEnd();
                    });
            }
        });
    }

    // ─────────────────────────────────────────────────────────────────
    // Result screen
    // ─────────────────────────────────────────────────────────────────

    function _showResult(s) {
        var app = document.getElementById('app');
        app.innerHTML = '';
        document.body.className = 'mode-setup';

        var winnerIds = (s.winner_ids || '').split(',').map(function (x) { return x.trim(); });
        var winners   = _state.players.filter(function (p) {
            return winnerIds.indexOf(String(p.id)) !== -1;
        });
        var isTie     = winners.length > 1;
        var titleText = isTie ? 'TIE GAME!' : (winners.length ? winners[0].name.toUpperCase() + ' WINS!' : 'GAME OVER');

        var inner = document.createElement('div');
        inner.className = 'setup-screen-inner';
        app.appendChild(inner);

        inner.innerHTML =
            '<div id="setup-title">' +
            '<div class="setup-logo">' + _esc(titleText) + '</div>' +
            '<div class="setup-subtitle">BASEBALL DARTS — 9 INNINGS</div>' +
            '</div>';

        // Full scorecard
        var scorecard = document.createElement('div');
        scorecard.className = 'bbmp-result-scorecard';
        var headRow = document.createElement('div');
        headRow.className = 'bbmp-result-row bbmp-result-head';
        headRow.innerHTML = '<span class="bbmp-result-name">PLAYER</span>';
        for (var i = 0; i < 9; i++) {
            headRow.innerHTML += '<span class="bbmp-result-cell">' + (_state.startNumber + i) + '</span>';
        }
        headRow.innerHTML += '<span class="bbmp-result-cell bbmp-result-total">TOT</span>';
        scorecard.appendChild(headRow);

        _state.players.forEach(function (p) {
            var pid    = String(p.id);
            var isWin  = winnerIds.indexOf(pid) !== -1;
            var pRow   = document.createElement('div');
            pRow.className = 'bbmp-result-row' + (isWin ? ' bbmp-result-winner' : '');
            pRow.innerHTML = '<span class="bbmp-result-name">' + _esc(p.name.toUpperCase()) + '</span>';
            var total = 0;
            for (var inn = 1; inn <= 9; inn++) {
                var innData = (s.innings[pid] || {})[inn];
                var r = innData ? innData.runs : 0;
                total += r;
                pRow.innerHTML += '<span class="bbmp-result-cell">' + r + '</span>';
            }
            pRow.innerHTML += '<span class="bbmp-result-cell bbmp-result-total">' + total + '</span>';
            scorecard.appendChild(pRow);
        });
        inner.appendChild(scorecard);

        // High score notifications
        if (s.high_score_results) {
            var hsWrap = document.createElement('div');
            hsWrap.className = 'bbmp-hs-wrap';
            s.high_score_results.forEach(function (r) {
                if (!r.is_new_high) return;
                var player = _state.players.find(function (p) { return String(p.id) === String(r.player_id); });
                var name   = player ? player.name : 'Player';
                var line   = document.createElement('div');
                line.className = 'bbmp-hs-line';
                line.textContent = '🏆 ' + name.toUpperCase() + ' — NEW HIGH SCORE: ' + r.high_score;
                hsWrap.appendChild(line);
            });
            if (hsWrap.children.length) inner.appendChild(hsWrap);
        }

        var doneBtn = document.createElement('button');
        doneBtn.className = 'start-btn';
        doneBtn.type = 'button';
        doneBtn.textContent = 'BACK TO HOME';
        doneBtn.addEventListener('click', function () { if (_state.onEnd) _state.onEnd(); });
        inner.appendChild(doneBtn);

        // Speech
        _speakResult(titleText, s.high_score_results);
    }

    // ─────────────────────────────────────────────────────────────────
    // Board lock
    // ─────────────────────────────────────────────────────────────────

    function _lockBoard(locked) {
        var board = document.getElementById('bbmp-board');
        if (board) board.querySelectorAll('.seg-btn').forEach(function (btn) {
            btn.disabled = locked;
        });
        var tabs = document.getElementById('bbmp-tabs');
        if (tabs) tabs.querySelectorAll('.tab-btn').forEach(function (btn) {
            btn.disabled = locked;
        });
    }

    // ─────────────────────────────────────────────────────────────────
    // Pills
    // ─────────────────────────────────────────────────────────────────

    function _addPill(segment, multiplier, runs, isHit) {
        var pills = document.getElementById('bbmp-pills');
        if (!pills) return;
        var mulStr = multiplier === 3 ? 'T' : multiplier === 2 ? 'D' : segment === 0 ? '' : 'S';
        var segStr = segment === 0 ? 'MISS' :
                     segment === 25 ? (multiplier === 2 ? 'BULL' : 'OUTER') :
                     mulStr + segment;
        var pill = document.createElement('div');
        pill.className = 'dart-pill' + (isHit ? (runs >= 3 ? ' pill-hot' : '') : ' pill-miss');
        pill.textContent = isHit
            ? (segStr + ' — ' + runs + (runs === 1 ? ' RUN' : ' RUNS'))
            : (segStr + ' — OUT');
        pills.appendChild(pill);
    }

    // ─────────────────────────────────────────────────────────────────
    // Speech
    // ─────────────────────────────────────────────────────────────────

    function _speak(text, delay) {
        if (!SPEECH.isEnabled()) return;
        setTimeout(function () {
            window.speechSynthesis && window.speechSynthesis.cancel();
            window.speechSynthesis && window.speechSynthesis.speak(
                Object.assign(new SpeechSynthesisUtterance(text), { rate: 1.0, pitch: 1.0 })
            );
        }, delay || 200);
    }

    function _announceCurrentPlayer(isFirst) {
        var player = _currentPlayer();
        if (!player) return;
        var target = _targetNumber();
        var msg = isFirst
            ? player.name + ', welcome to Baseball Darts. In inning ' + _state.currentInning +
              ' you are targeting number ' + target + '.'
            : player.name + '. Inning ' + _state.currentInning + '. Target number ' + target + '.';
        _speak(msg, 400);
    }

    function _speakDart(isHit, runs) {
        if (!SPEECH.isEnabled()) return;
        var msg = isHit
            ? (runs === 1 ? 'Single. 1 run.' : runs === 2 ? 'Double. 2 runs.' : 'Treble. 3 runs.')
            : 'Out.';
        _speak(msg, 200);
    }

    function _speakInningEnd(inn) {
        if (!SPEECH.isEnabled()) return;
        var player = _currentPlayer();
        var name   = player ? player.name : '';
        var runs   = inn ? inn.runs : 0;
        var msg    = 'Inning ' + _state.currentInning + ' over for ' + name + '. ' +
                     runs + (runs === 1 ? ' run' : ' runs') + ' this inning.';
        _speak(msg, 500);
    }

    function _speakResult(titleText, hsResults) {
        if (!SPEECH.isEnabled()) return;
        var msg = titleText + ' ';
        if (hsResults) {
            hsResults.forEach(function (r) {
                if (r.is_new_high) {
                    var player = _state.players.find(function (p) { return String(p.id) === String(r.player_id); });
                    msg += (player ? player.name : 'Player') + ' made a new high score of ' + r.high_score + '. ';
                }
            });
        }
        _speak(msg, 1000);
    }

    // ─────────────────────────────────────────────────────────────────
    // Helpers
    // ─────────────────────────────────────────────────────────────────

    function _esc(str) {
        return String(str)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    return { start: start };

})();