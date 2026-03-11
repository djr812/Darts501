/**
 * cricket.js
 * ----------
 * Full-screen Cricket darts game controller.
 *
 * Public API:
 *   CRICKET_GAME.start(config, onEnd)
 *     config: { players: [{id, name, isCpu}], ... }
 *     onEnd:  called when game ends or is abandoned
 */

var CRICKET_GAME = (function () {

    // Cricket numbers in display order (top to bottom)
    var NUMBERS = [20, 19, 18, 17, 16, 15, 25];
    var NUMBER_LABELS = { 25: 'BULL' };

    var _state = {
        matchId:          null,
        players:          [],      // [{ id, name }]
        marks:            {},      // { playerId: { number: 0-3 } }
        scores:           {},      // { playerId: points }
        currentPlayerId:  null,
        currentTurn:      1,
        dartsThisTurn:    0,
        multiplier:       1,
        turnComplete:     false,   // waiting for NEXT after 3rd dart
        status:           'active',
        winnerId:         null,
        onEnd:            null,
        isFirstTurn:      false,
        cpuTurnRunning:   false,
        cpuDifficulty:    'medium',
        cpuPlayerId:      null,
    };

    // ─────────────────────────────────────────────────────────────────
    // Public: start
    // ─────────────────────────────────────────────────────────────────

    function start(config, onEnd) {
        SPEECH.unlock();
        if (typeof SOUNDS !== 'undefined') SOUNDS.unlock();
        UI.setLoading(true);

        _resolvePlayers(config.players, config.difficulty)
            .then(function (players) {
                return API.createCricketMatch({ player_ids: players.map(function (p) { return p.id; }) })
                    .then(function (state) {
                        return { players: players, state: state };
                    });
            })
            .then(function (result) {
                _applyState(result.state);
                _state.onEnd = onEnd;
                _state.isFirstTurn = true;
                UI.setLoading(false);
                _buildScreen();
                _announcePlayer();
                if (_isCpuTurn()) _scheduleCpuTurn();
            })
            .catch(function (err) {
                UI.setLoading(false);
                UI.showToast(err.message.toUpperCase(), 'bust', 4000);
                console.error('[cricket] start error:', err);
            });
    }

    // ─────────────────────────────────────────────────────────────────
    // Player resolution (reuse pattern from practice.js)
    // ─────────────────────────────────────────────────────────────────

    function _resolvePlayers(selections, difficulty) {
        var promises = selections.map(function (sel) {
            if (sel.isCpu) {
                // Fetch existing CPU record, create only if absent — avoids 409
                return API.getCpuPlayer()
                    .catch(function() { return null; })
                    .then(function(record) {
                        if (record) return record;
                        return API.createPlayer('CPU');
                    })
                    .then(function(p) { return { id: p.id, name: 'CPU' }; });
            } else if (sel.mode === 'existing') {
                return Promise.resolve({ id: sel.id, name: sel.name });
            } else {
                return API.createPlayer(sel.name)
                    .then(function (p) { return { id: p.id, name: p.name }; });
            }
        });
        return Promise.all(promises).then(function(players) {
            selections.forEach(function(sel, i) {
                if (sel.isCpu) {
                    _state.cpuPlayerId   = String(players[i].id);
                    _state.cpuDifficulty = difficulty || sel.difficulty || 'medium';
                }
            });
            return players;
        });
    }

    // ─────────────────────────────────────────────────────────────────
    // State
    // ─────────────────────────────────────────────────────────────────

    function _applyState(s) {
        _state.matchId         = s.match_id;
        _state.players         = s.players;
        _state.currentPlayerId = s.current_player_id;
        _state.currentTurn     = s.current_turn_number;
        _state.dartsThisTurn   = s.darts_this_turn;
        _state.status          = s.status;
        _state.winnerId        = s.winner_id;

        // Normalise all keys to strings so marks[pid][num] always works
        // regardless of whether JSON gave us integer or string keys
        _state.marks  = {};
        _state.scores = {};
        Object.keys(s.marks).forEach(function(pid) {
            _state.marks[String(pid)] = {};
            Object.keys(s.marks[pid]).forEach(function(num) {
                _state.marks[String(pid)][String(num)] = s.marks[pid][num];
            });
        });
        Object.keys(s.scores).forEach(function(pid) {
            _state.scores[String(pid)] = s.scores[pid];
        });
        // Also normalise currentPlayerId to string
        _state.currentPlayerId = String(s.current_player_id);
    }

    // ─────────────────────────────────────────────────────────────────
    // Screen build
    // ─────────────────────────────────────────────────────────────────

    function _buildScreen() {
        ['confirm-modal', 'rules-modal'].forEach(function(id) {
            var el = document.getElementById(id);
            if (el) el.remove();
        });

        var app = document.getElementById('app');
        app.innerHTML = '';
        app.style.cssText = '';
        document.body.className = 'mode-cricket';

        // ── Header ────────────────────────────────────────────────────────────
        var header = document.createElement('div');
        header.id = 'cricket-header';
        header.className = 'cricket-header game-header';

        var leftSlot = document.createElement('div');
        leftSlot.className = 'gh-left';
        var titleWrap = document.createElement('div');
        titleWrap.className = 'gh-title-wrap';
        var titleEl = document.createElement('div');
        titleEl.className = 'gh-game-name';
        titleEl.textContent = 'CRICKET';
        var subEl = document.createElement('div');
        subEl.className = 'gh-match-info';
        subEl.textContent = _state.players.length + ' PLAYERS · 15–BULL';
        titleWrap.appendChild(titleEl);
        titleWrap.appendChild(subEl);
        leftSlot.appendChild(titleWrap);
        var rulesBtn = document.createElement('button');
        rulesBtn.type = 'button';
        rulesBtn.className = 'rules-btn';
        rulesBtn.textContent = '📖 RULES';
        rulesBtn.addEventListener('click', function() { UI.showRulesModal('cricket'); });
        leftSlot.appendChild(rulesBtn);
        header.appendChild(leftSlot);

        var centreSlot = document.createElement('div');
        centreSlot.className = 'gh-centre';
        var endBtn = document.createElement('button');
        endBtn.id = 'cricket-end-btn';
        endBtn.className = 'gh-btn gh-btn-red';
        endBtn.type = 'button';
        endBtn.textContent = '✕ END';
        endBtn.addEventListener('click', _onEnd);
        var restartBtn = document.createElement('button');
        restartBtn.id = 'cricket-restart-btn';
        restartBtn.className = 'gh-btn gh-btn-red';
        restartBtn.type = 'button';
        restartBtn.textContent = '↺ RESTART';
        restartBtn.addEventListener('click', _onRestart);
        centreSlot.appendChild(endBtn);
        centreSlot.appendChild(restartBtn);
        header.appendChild(centreSlot);

        var rightSlot = document.createElement('div');
        rightSlot.className = 'gh-right';
        var undoBtn = document.createElement('button');
        undoBtn.id = 'cricket-undo-btn';
        undoBtn.className = 'gh-btn gh-btn-undo';
        undoBtn.type = 'button';
        undoBtn.textContent = '⟵ UNDO';
        undoBtn.disabled = true;
        undoBtn.addEventListener('click', _onUndo);
        var nextBtn = document.createElement('button');
        nextBtn.id = 'cricket-next-btn';
        nextBtn.className = 'gh-btn gh-btn-next';
        nextBtn.type = 'button';
        nextBtn.textContent = 'NEXT ▶';
        nextBtn.disabled = true;
        nextBtn.addEventListener('click', _onNext);
        rightSlot.appendChild(undoBtn);
        rightSlot.appendChild(nextBtn);
        header.appendChild(rightSlot);
        app.appendChild(header);

        // ── Sidebar — scoreboard ──────────────────────────────────────────────
        var sidebar = document.createElement('aside');
        sidebar.id = 'cricket-sidebar';
        sidebar.className = 'cricket-sidebar';
        _renderBoard(sidebar);
        app.appendChild(sidebar);

        // ── Board (right column) ──────────────────────────────────────────────
        var segBoard = document.createElement('main');
        segBoard.id = 'cricket-seg-board';
        segBoard.className = 'cricket-seg-board';

        // Status banner
        var statusEl = document.createElement('div');
        statusEl.id = 'cricket-status';
        statusEl.className = 'cricket-status-banner';
        _updateStatusBanner(statusEl);
        segBoard.appendChild(statusEl);

        // Dart pills
        var pills = document.createElement('div');
        pills.id = 'cricket-pills';
        pills.className = 'cricket-pills';
        segBoard.appendChild(pills);

        // Multiplier tabs
        _state.multiplier = 1;
        var tabs = document.createElement('div');
        tabs.id = 'cricket-tabs';
        tabs.className = 'cricket-tabs';
        [
            { label: 'Single', mul: 1, cls: 'active-single' },
            { label: 'Double', mul: 2, cls: 'active-double' },
            { label: 'Treble', mul: 3, cls: 'active-treble' },
        ].forEach(function (t) {
            var btn = document.createElement('button');
            btn.className = 'tab-btn' + (t.mul === 1 ? ' active-single' : '');
            btn.dataset.multiplier = t.mul;
            btn.dataset.activeClass = t.cls;
            btn.type = 'button';
            btn.textContent = t.label;
            UI.addTouchSafeListener(btn, function () {
                if (_state.turnComplete) return;
                _state.multiplier = t.mul;
                tabs.querySelectorAll('.tab-btn').forEach(function (b) {
                    b.classList.remove('active-single', 'active-double', 'active-treble');
                });
                btn.classList.add(t.cls);
                document.body.dataset.multiplier = t.mul;
            });
            tabs.appendChild(btn);
        });
        document.body.dataset.multiplier = 1;
        segBoard.appendChild(tabs);

        // Full segment grid (1–20)
        var grid = document.createElement('div');
        grid.id = 'cricket-seg-grid';
        grid.className = 'segment-grid';
        for (var seg = 1; seg <= 20; seg++) {
            (function (s) {
                var btn = document.createElement('button');
                btn.className = 'seg-btn';
                btn.dataset.segment = s;
                btn.type = 'button';
                btn.textContent = s;
                btn.addEventListener('click', function () {
                    if (_state.turnComplete) return;
                    _throwDart(s, _state.multiplier);
                });
                grid.appendChild(btn);
            })(seg);
        }
        segBoard.appendChild(grid);

        // Bull row (MISS / OUTER / BULL)
        var bullRow = document.createElement('div');
        bullRow.className = 'bull-row';
        var missBtn = document.createElement('button');
        missBtn.className = 'seg-btn bull-btn';
        missBtn.type = 'button';
        missBtn.textContent = 'MISS';
        missBtn.addEventListener('click', function () {
            if (_state.turnComplete) return;
            _throwDart(0, 0);
        });
        var outerBtn = document.createElement('button');
        outerBtn.className = 'seg-btn bull-btn';
        outerBtn.type = 'button';
        outerBtn.textContent = 'OUTER';
        outerBtn.addEventListener('click', function () {
            if (_state.turnComplete) return;
            _throwDart(25, 1);
        });
        var bullBtn = document.createElement('button');
        bullBtn.className = 'seg-btn bull-btn bull-btn-inner';
        bullBtn.type = 'button';
        bullBtn.textContent = 'BULL';
        bullBtn.addEventListener('click', function () {
            if (_state.turnComplete) return;
            _throwDart(25, 2);
        });
        bullRow.appendChild(missBtn);
        bullRow.appendChild(outerBtn);
        bullRow.appendChild(bullBtn);
        segBoard.appendChild(bullRow);

        // Footer
        var footer = document.createElement('footer');
        footer.className = 'cricket-footer';
        footer.textContent = 'CRICKET NUMBERS: 15 · 16 · 17 · 18 · 19 · 20 · BULL';
        segBoard.appendChild(footer);

        app.appendChild(segBoard);
    }

    // ─────────────────────────────────────────────────────────────────
    // Scoreboard render
    // ─────────────────────────────────────────────────────────────────

    function _renderBoard(container) {
        container.innerHTML = '';
        var nPlayers = _state.players.length;

        // Build grid: col 0 = number label, col 1..n = player cols
        // Header row: blank | player names + scores
        var headerRow = document.createElement('div');
        headerRow.className = 'cricket-row cricket-row-header';

        var numLbl = document.createElement('div');
        numLbl.className = 'cricket-cell cricket-num-col';
        headerRow.appendChild(numLbl);

        _state.players.forEach(function (p) {
            var cell = document.createElement('div');
            cell.className = 'cricket-cell cricket-player-header' +
    (String(p.id) === String(_state.currentPlayerId) ? ' cricket-active-player' : '');
            cell.id = 'cricket-ph-' + p.id;

            var nameEl = document.createElement('div');
            nameEl.className = 'cricket-player-name';
            nameEl.textContent = p.name.toUpperCase();

            var scoreEl = document.createElement('div');
            scoreEl.className = 'cricket-player-score';
            scoreEl.id = 'cricket-score-' + p.id;
            scoreEl.textContent = (_state.scores[String(p.id)] || 0);

            cell.appendChild(nameEl);
            cell.appendChild(scoreEl);
            headerRow.appendChild(cell);
        });
        container.appendChild(headerRow);

        // Number rows
        NUMBERS.forEach(function (num) {
            var row = document.createElement('div');
            row.className = 'cricket-row';
            row.id = 'cricket-row-' + num;

            var numCell = document.createElement('div');
            numCell.className = 'cricket-cell cricket-num-col';

            var numLabel = document.createElement('div');
            numLabel.className = 'cricket-num-label';
            numLabel.textContent = NUMBER_LABELS[num] || num;
            numCell.appendChild(numLabel);

            // Status badge: OPEN (someone can score), CLOSED (all players have 3 marks)
            var allClosed = _state.players.every(function(p) {
                return (_state.marks[String(p.id)] && _state.marks[String(p.id)][String(num)] >= 3);
            });
            // "Owned" = at least one player has closed it but not all
            var anyOpen = _state.players.some(function(p) {
                return (_state.marks[String(p.id)] && _state.marks[String(p.id)][String(num)] >= 3);
            });

            var badge = document.createElement('div');
            if (allClosed) {
                badge.className = 'cricket-num-badge badge-closed';
                badge.textContent = 'CLOSED';
            } else if (anyOpen) {
                badge.className = 'cricket-num-badge badge-open';
                badge.textContent = 'OPEN';
            } else {
                badge.className = 'cricket-num-badge badge-none';
                badge.textContent = '';
            }
            numCell.appendChild(badge);
            row.appendChild(numCell);

            _state.players.forEach(function (p) {
                var cell = document.createElement('div');
                cell.className = 'cricket-cell cricket-marks-cell';
                cell.id = 'cricket-marks-' + p.id + '-' + num;
                var marks = (_state.marks[String(p.id)] && _state.marks[String(p.id)][String(num)]) || 0;
                cell.appendChild(_buildMarksEl(marks));
                row.appendChild(cell);
            });

            container.appendChild(row);
        });

        _updateRowHighlights();
    }

    function _buildMarksEl(marks) {
        var el = document.createElement('div');
        el.className = 'cricket-marks';
        if (marks === 0) {
            el.innerHTML = '';
        } else if (marks === 1) {
            el.innerHTML = '<span class="cricket-mark cricket-mark-slash">╱</span>';
        } else if (marks === 2) {
            el.innerHTML = '<span class="cricket-mark cricket-mark-x">✕</span>';
        } else {
            el.innerHTML = '<span class="cricket-mark cricket-mark-closed">⊗</span>';
        }
        return el;
    }

    function _updateMarkCell(playerId, number, marks) {
        var cell = document.getElementById('cricket-marks-' + playerId + '-' + number);
        if (cell) {
            cell.innerHTML = '';
            cell.appendChild(_buildMarksEl(marks));
        }
    }

    function _updateScoreDisplay(playerId, points) {
        var el = document.getElementById('cricket-score-' + playerId);
        if (el) el.textContent = points;
    }

    function _updateActivePlayer() {
        document.querySelectorAll('.cricket-player-header').forEach(function (el) {
            el.classList.remove('cricket-active-player');
        });
        var active = document.getElementById('cricket-ph-' + String(_state.currentPlayerId));
        if (active) active.classList.add('cricket-active-player');
    }

    function _updateRowHighlights() {
        // Highlight rows where at least one player can still score or close
        NUMBERS.forEach(function (num) {
            var row = document.getElementById('cricket-row-' + num);
            if (!row) return;
            var allClosed = _state.players.every(function (p) {
                return (_state.marks[String(p.id)] && _state.marks[String(p.id)][String(num)] >= 3);
            });
            if (allClosed) {
                row.classList.add('cricket-row-closed');
            } else {
                row.classList.remove('cricket-row-closed');
            }
        });
    }

    function _addPill(num, multiplier, marksAdded, points) {
        var pills = document.getElementById('cricket-pills');
        if (!pills) return;

        var label;
        if (num === 0) {
            label = 'MISS';
        } else if (num === 25) {
            label = multiplier === 2 ? 'BULL' : 'OUTER';
        } else {
            label = (multiplier === 3 ? 'T' : multiplier === 2 ? 'D' : '') + num;
        }

        var pill = document.createElement('div');
        pill.className = 'dart-pill' +
            (num === 0 ? ' pill-miss' : '') +
            (points > 0 ? ' pill-hot' : '');
        pill.textContent = label + (points > 0 ? ' (+' + points + ')' : marksAdded > 0 ? ' ×' + marksAdded : '');
        pills.appendChild(pill);
    }

    function _clearPills() {
        var pills = document.getElementById('cricket-pills');
        if (pills) pills.innerHTML = '';
    }

    // ─────────────────────────────────────────────────────────────────
    // Throw
    // ─────────────────────────────────────────────────────────────────

    function _throwDart(segment, multiplier) {
        if (_state.turnComplete || _state.status !== 'active') return;

        // If multiplier not supplied (e.g. legacy call), use state
        if (multiplier === undefined) multiplier = _state.multiplier;
        // Miss: force multiplier 0 → backend treats as miss
        if (segment === 0) multiplier = 0;

        _lockBoard(true);

        API.recordCricketThrow(_state.matchId, {
            player_id:  _state.currentPlayerId,
            segment:    segment,
            multiplier: multiplier,
        })
        .then(function (s) {
            var last = s.last_throw;
            _applyState(s);

            // Re-render entire board from authoritative server state
            var board = document.getElementById('cricket-sidebar');
            if (board) _renderBoard(board);
            _addPill(last.segment, last.multiplier, last.marks_added, last.points_scored);
            _updateStatusBanner();

            // Sound
            if (typeof SOUNDS !== 'undefined' && SOUNDS.isEnabled()) {
                if (s.status === 'complete') {
                    SOUNDS.checkout();
                } else if (last.points_scored > 0) {
                    SOUNDS.ton();
                } else {
                    SOUNDS.dart();
                }
            }

            // Check win
            if (s.status === 'complete') {
                _lockBoard(true);
                setTimeout(function () { _showWinModal(s.winner_id); }, 600);
                return;
            }

            _state.dartsThisTurn = s.darts_this_turn;

            // After 3 darts — show NEXT, wait
            if (_state.dartsThisTurn >= 3 || s.darts_this_turn >= 3) {
                _state.turnComplete = true;
                var nextBtn = document.getElementById('cricket-next-btn');
                if (nextBtn) nextBtn.disabled = false;
                var undoBtn = document.getElementById('cricket-undo-btn');
                if (undoBtn) undoBtn.disabled = false;
            } else {
                _lockBoard(false);
                var undoBtn = document.getElementById('cricket-undo-btn');
                if (undoBtn) undoBtn.disabled = false;
            }

            // Speech
            if (last.points_scored > 0 && SPEECH.isEnabled()) {
                setTimeout(function () {
                    SPEECH.announceScore(last.points_scored);
                }, 300);
            }
        })
        .catch(function (err) {
            _lockBoard(false);
            UI.showToast('ERROR RECORDING DART', 'bust', 2000);
            console.error('[cricket] throw error:', err);
        });
    }

    // ─────────────────────────────────────────────────────────────────
    // Next / Undo
    // ─────────────────────────────────────────────────────────────────

    function _onNext() {
        _state.turnComplete = false;
        _state.dartsThisTurn = 0;
        _state.multiplier = 1;
        _clearPills();

        // Update active player header
        _updateActivePlayer();

        var nextBtn = document.getElementById('cricket-next-btn');
        if (nextBtn) nextBtn.disabled = true;
        var undoBtn = document.getElementById('cricket-undo-btn');
        if (undoBtn) undoBtn.disabled = true;

        // Reset multiplier tab to single
        var tabs = document.getElementById('cricket-tabs');
        if (tabs) {
            tabs.querySelectorAll('.tab-btn').forEach(function (b) {
                b.classList.remove('active-single', 'active-double', 'active-treble');
            });
            var singleTab = tabs.querySelector('[data-multiplier="1"]');
            if (singleTab) singleTab.classList.add('active-single');
        }
        document.body.dataset.multiplier = 1;

        _lockBoard(false);
        _updateStatusBanner();
        _announcePlayer();
        if (_isCpuTurn()) _scheduleCpuTurn();
    }

    function _onUndo() {
        if (_state.cpuTurnRunning) return;
        _lockBoard(true);
        API.undoCricketThrow(_state.matchId)
            .then(function (s) {
                _applyState(s);
                // Full re-render of board to reflect undone state
                var board = document.getElementById('cricket-sidebar');
                if (board) _renderBoard(board);

                // Remove last pill
                var pills = document.getElementById('cricket-pills');
                if (pills && pills.lastChild) pills.removeChild(pills.lastChild);

                _state.turnComplete = false;
                var nextBtn = document.getElementById('cricket-next-btn');
                if (nextBtn) nextBtn.disabled = true;

                var undoBtn = document.getElementById('cricket-undo-btn');
                if (undoBtn) undoBtn.disabled = s.darts_this_turn === 0;

                _lockBoard(false);
            })
            .catch(function (err) {
                _lockBoard(false);
                UI.showToast('UNDO FAILED', 'bust', 2000);
            });
    }

    function _onRestart() {
        UI.showConfirmModal({
            title:        'RESTART MATCH?',
            message:      'All scores will be wiped and the match will restart from scratch. This cannot be undone.',
            confirmLabel: 'YES, RESTART',
            confirmClass: 'confirm-btn-danger',
            onConfirm:    _doRestart,
        });
    }

    function _doRestart() {
        UI.setLoading(true);
        API.restartCricketMatch(_state.matchId)
            .then(function() {
                return API.getCricketMatch(_state.matchId);
            })
            .then(function(state) {
                _applyState(state);
                _buildScreen();
                _announcePlayer();
                UI.showToast('MATCH RESTARTED', 'info', 2000);
            })
            .catch(function(err) {
                UI.showToast('RESTART FAILED: ' + err.message.toUpperCase(), 'bust', 3000);
            })
            .finally(function() {
                UI.setLoading(false);
            });
    }

    function _onEnd() {
        UI.showConfirmModal({
            title:        'ABANDON MATCH?',
            message:      'This Cricket match will be cancelled and you will return to the home screen.',
            confirmLabel: 'YES, END MATCH',
            confirmClass: 'confirm-btn-danger',
            onConfirm:    function() {
                API.endCricketMatch(_state.matchId).catch(function(){});
                if (_state.onEnd) _state.onEnd();
            },
        });
    }

    // ─────────────────────────────────────────────────────────────────
    // Board locking
    // ─────────────────────────────────────────────────────────────────

    function _updateStatusBanner(el) {
        el = el || document.getElementById('cricket-status');
        if (!el) return;
        var p = _state.players.find(function (pl) { return String(pl.id) === String(_state.currentPlayerId); });
        el.textContent = p ? p.name.toUpperCase() + '  —  DART ' + (_state.dartsThisTurn + 1) + ' OF 3' : '';
    }

    function _lockBoard(locked) {
        var grid = document.getElementById('cricket-seg-grid');
        if (grid) grid.querySelectorAll('.seg-btn').forEach(function (b) { b.disabled = locked; });
        var bullRow = document.querySelector('.cricket-seg-board .bull-row');
        if (bullRow) bullRow.querySelectorAll('.seg-btn').forEach(function (b) { b.disabled = locked; });
        var tabs = document.getElementById('cricket-tabs');
        if (tabs) tabs.querySelectorAll('.tab-btn').forEach(function (b) { b.disabled = locked; });
    }

    // ─────────────────────────────────────────────────────────────────
    // Win modal
    // ─────────────────────────────────────────────────────────────────

    function _showWinModal(winnerId) {
        var winner = _state.players.find(function (p) { return String(p.id) === String(winnerId); });
        if (!winner) return;

        if (typeof SOUNDS !== 'undefined' && SOUNDS.isEnabled()) SOUNDS.checkout();
        if (SPEECH.isEnabled()) {
            setTimeout(function () {
                SPEECH.announceCricketWin && SPEECH.announceCricketWin(winner.name);
            }, 400);
        }

        var overlay = document.createElement('div');
        overlay.className = 'modal-overlay';

        var box = document.createElement('div');
        box.className = 'modal-box cricket-win-box';

        box.innerHTML =
            '<div class="cricket-win-icon">🏆</div>' +
            '<div class="modal-title">' + _esc(winner.name.toUpperCase()) + ' WINS!</div>' +
            '<div class="modal-subtitle">CRICKET</div>' +
            '<div class="cricket-win-scores">' +
            _state.players.map(function (p) {
                return '<div class="cricket-win-score-row' + (String(p.id) === String(winnerId) ? ' cricket-win-winner' : '') + '">' +
                    '<span>' + _esc(p.name) + '</span>' +
                    '<span>' + (_state.scores[String(p.id)] || 0) + ' pts</span>' +
                    '</div>';
            }).join('') +
            '</div>';

        var doneBtn = document.createElement('button');
        doneBtn.className = 'start-btn';
        doneBtn.type = 'button';
        doneBtn.textContent = 'BACK TO SETUP';
        doneBtn.addEventListener('click', function () {
            overlay.remove();
            if (_state.onEnd) _state.onEnd();
        });
        box.appendChild(doneBtn);

        overlay.appendChild(box);
        document.body.appendChild(overlay);
    }

    // ─────────────────────────────────────────────────────────────────
    // Speech
    // ─────────────────────────────────────────────────────────────────

    function _announcePlayer() {
        if (!SPEECH.isEnabled()) return;
        var player = _state.players.find(function (p) { return String(p.id) === String(_state.currentPlayerId); });
        if (!player) return;
        if (_state.isFirstTurn) {
            // First turn: speak welcome then player announce as a chain,
            // each in its own setTimeout so iOS TTS wakes up between them.
            _state.isFirstTurn = false;
            var welcomeMsg = 'Welcome to Cricket darts.';
            var playerMsg  = player.name + "'s turn to throw";
            setTimeout(function () {
                window.speechSynthesis && window.speechSynthesis.cancel();
                SPEECH.speak(welcomeMsg, { rate: 1.05, pitch: 1.0 });
            }, 400);
            // Delay player announce until after welcome finishes
            // 400ms start delay + 300ms TTS startup + 150ms/char
            var welcomeDur = 400 + 300 + welcomeMsg.length * 150;
            setTimeout(function () {
                window.speechSynthesis && window.speechSynthesis.cancel();
                SPEECH.speak(playerMsg, { rate: 1.05, pitch: 1.0 });
            }, welcomeDur + 300);
        } else {
            setTimeout(function () {
                window.speechSynthesis && window.speechSynthesis.cancel();
                SPEECH.speak(player.name + "'s turn to throw", { rate: 1.05, pitch: 1.0 });
            }, 300);
        }
    }

    // ─────────────────────────────────────────────────────────────────
    // CPU player logic
    // ─────────────────────────────────────────────────────────────────

    function _isCpuTurn() {
        return _state.cpuPlayerId !== null &&
               String(_state.currentPlayerId) === String(_state.cpuPlayerId) &&
               _state.status === 'active';
    }

    // Accuracy profiles — same structure as race1000.js
    var _CPU_PROFILES = {
        easy:   { trebleHit: 0.15, doubleHit: 0.25, singleHit: 0.65, missRate: 0.20 },
        medium: { trebleHit: 0.35, doubleHit: 0.55, singleHit: 0.85, missRate: 0.08 },
        hard:   { trebleHit: 0.72, doubleHit: 0.82, singleHit: 0.96, missRate: 0.02 },
    };

    // Adjacent segments on a dartboard (clockwise order)
    var _ADJACENT = {
        20:[1,5], 1:[20,18], 18:[1,4], 4:[18,13], 13:[4,6], 6:[13,10],
        10:[6,15], 15:[10,2], 2:[15,17], 17:[2,3], 3:[17,19], 19:[3,7],
        7:[19,16], 16:[7,8], 8:[16,11], 11:[8,14], 14:[11,9], 9:[14,12],
        12:[9,5], 5:[12,20],
    };

    /**
     * Given an intended target {segment, multiplier}, apply accuracy variance.
     * Returns {segment, multiplier} representing the actual landing.
     */
    function _cpuApplyVariance(segment, multiplier) {
        var profile = _CPU_PROFILES[_state.cpuDifficulty] || _CPU_PROFILES.medium;
        var rand = Math.random();

        // Complete miss (random segment)
        if (rand < profile.missRate) {
            var allSegs = [1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20];
            return { segment: allSegs[Math.floor(Math.random() * allSegs.length)], multiplier: 1 };
        }

        // Bull handling
        if (segment === 25) {
            if (multiplier === 2) {
                // Aiming bull
                if (rand < profile.trebleHit) return { segment: 25, multiplier: 2 };   // inner bull
                if (rand < profile.doubleHit) return { segment: 25, multiplier: 1 };   // outer bull
                return { segment: 25, multiplier: 1 };                                  // at least outer
            } else {
                // Aiming outer bull
                if (rand < profile.singleHit) return { segment: 25, multiplier: 1 };
                return { segment: 25, multiplier: 2 };   // overshot to inner
            }
        }

        // Number segments
        if (multiplier === 3) {
            if (rand < profile.trebleHit) return { segment: segment, multiplier: 3 };
            if (rand < profile.doubleHit) return { segment: segment, multiplier: 1 };
            // Miss treble — hit adjacent single
            var adj = _ADJACENT[segment] || [segment];
            return { segment: adj[Math.floor(Math.random() * adj.length)], multiplier: 1 };
        }
        if (multiplier === 2) {
            if (rand < profile.doubleHit) return { segment: segment, multiplier: 2 };
            return { segment: segment, multiplier: 1 };
        }
        // Single
        if (rand < profile.singleHit) return { segment: segment, multiplier: 1 };
        var adj2 = _ADJACENT[segment] || [segment];
        return { segment: adj2[Math.floor(Math.random() * adj2.length)], multiplier: 1 };
    }

    /**
     * Cricket targeting strategy.
     * Priority:
     *   1. Close open numbers (aim treble on highest open cricket number)
     *   2. Score on numbers we've closed but opponent hasn't
     * Returns {segment, multiplier} as the intended aim (before variance).
     */
    function _cpuIntend() {
        var cpuId  = String(_state.cpuPlayerId);
        var oppIds = _state.players
            .filter(function(p) { return String(p.id) !== cpuId; })
            .map(function(p) { return String(p.id); });

        var cpuMarks = _state.marks[cpuId] || {};

        // Numbers to close in priority order
        var priority = [20, 19, 18, 17, 16, 15, 25];

        // 1. Find the highest priority number that CPU hasn't closed yet
        for (var i = 0; i < priority.length; i++) {
            var num = priority[i];
            var marks = cpuMarks[String(num)] || 0;
            if (marks < 3) {
                // Aim to close it — treble if possible, except bull
                if (num === 25) {
                    var needed = 3 - marks;
                    return { segment: 25, multiplier: needed >= 2 ? 2 : 1 };
                }
                return { segment: num, multiplier: 3 };
            }
        }

        // 2. All closed — score on numbers opponent still has open
        for (var j = 0; j < priority.length; j++) {
            var scoreNum = priority[j];
            var oppStillOpen = oppIds.some(function(oid) {
                return ((_state.marks[oid] || {})[String(scoreNum)] || 0) < 3;
            });
            if (oppStillOpen) {
                if (scoreNum === 25) return { segment: 25, multiplier: 2 };
                return { segment: scoreNum, multiplier: 3 };
            }
        }

        // Fallback — aim treble 20
        return { segment: 20, multiplier: 3 };
    }

    function _scheduleCpuTurn() {
        // Small delay so speech announcement plays before board starts firing
        var speechDelay = SPEECH.isEnabled() ? 2200 : 600;
        setTimeout(function() { _doCpuTurn(0); }, speechDelay);
    }

    function _doCpuTurn(dartIndex) {
        if (_state.status !== 'active') return;
        if (dartIndex >= 3) {
            // All 3 darts thrown — auto-press NEXT after a beat
            setTimeout(function() {
                _state.cpuTurnRunning = false;
                _onNext();
            }, 900);
            return;
        }

        _state.cpuTurnRunning = true;
        _lockBoard(true);

        var intended = _cpuIntend();
        var actual   = _cpuApplyVariance(intended.segment, intended.multiplier);

        // Stagger darts ~900ms apart so it feels natural
        setTimeout(function() {
            if (_state.status !== 'active') {
                _state.cpuTurnRunning = false;
                return;
            }
            API.recordCricketThrow(_state.matchId, {
                player_id:  _state.cpuPlayerId,
                segment:    actual.segment,
                multiplier: actual.multiplier,
            })
            .then(function(s) {
                var last = s.last_throw;
                _applyState(s);

                var board = document.getElementById('cricket-sidebar');
                if (board) _renderBoard(board);
                _addPill(last.segment, last.multiplier, last.marks_added, last.points_scored);
                _updateStatusBanner();

                if (typeof SOUNDS !== 'undefined' && SOUNDS.isEnabled()) {
                    if (s.status === 'complete') SOUNDS.checkout();
                    else if (last.points_scored > 0) SOUNDS.ton();
                    else SOUNDS.dart();
                }

                if (s.status === 'complete') {
                    _state.cpuTurnRunning = false;
                    _lockBoard(true);
                    setTimeout(function() { _showWinModal(s.winner_id); }, 600);
                    return;
                }

                if (last.points_scored > 0 && SPEECH.isEnabled()) {
                    setTimeout(function() { SPEECH.announceScore(last.points_scored); }, 200);
                }

                // Continue to next dart
                _doCpuTurn(dartIndex + 1);
            })
            .catch(function(err) {
                _state.cpuTurnRunning = false;
                _lockBoard(false);
                console.error('[cricket] CPU throw error:', err);
            });
        }, dartIndex === 0 ? 300 : 900);
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