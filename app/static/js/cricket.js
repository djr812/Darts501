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
    };

    // ─────────────────────────────────────────────────────────────────
    // Public: start
    // ─────────────────────────────────────────────────────────────────

    function start(config, onEnd) {
        SPEECH.unlock();
        if (typeof SOUNDS !== 'undefined') SOUNDS.unlock();
        UI.setLoading(true);

        _resolvePlayers(config.players)
            .then(function (players) {
                return API.createCricketMatch({ player_ids: players.map(function (p) { return p.id; }) })
                    .then(function (state) {
                        return { players: players, state: state };
                    });
            })
            .then(function (result) {
                _applyState(result.state);
                _state.onEnd = onEnd;
                UI.setLoading(false);
                _buildScreen();
                _announcePlayer();
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
        // Clear any lingering modals that might block touch events
        ['confirm-modal', 'rules-modal'].forEach(function(id) {
            var el = document.getElementById(id);
            if (el) el.remove();
        });

        var app = document.getElementById('app');
        app.innerHTML = '';
        app.style.cssText = '';
        document.body.className = 'mode-cricket';

        // ── Header ──
        var header = document.createElement('div');
        header.id = 'cricket-header';
        header.className = 'cricket-header game-header';

        // ── Left: game name + rules ──
        var leftSlot = document.createElement('div');
        leftSlot.className = 'gh-left';
        var titleWrap = document.createElement('div');
        titleWrap.className = 'gh-title-wrap';
        var titleEl = document.createElement('div');
        titleEl.className = 'gh-game-name';
        titleEl.textContent = 'CRICKET';
        var subEl = document.createElement('div');
        subEl.className = 'gh-match-info';
        subEl.textContent = _state.players.length + ' PLAYERS';
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

        // ── Centre: End ──
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

        // ── Right: Undo + Next ──
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

        // ── Scoreboard ──
        var board = document.createElement('div');
        board.id = 'cricket-board';
        board.className = 'cricket-board';
        app.appendChild(board);
        _renderBoard(board);

        // ── Multiplier tabs ──
        var tabs = document.createElement('div');
        tabs.id = 'cricket-tabs';
        tabs.className = 'cricket-tabs';
        [
            { label: 'Single', mul: 1, cls: 'active-single' },
            { label: 'Double', mul: 2, cls: 'active-double' },
            { label: 'Treble', mul: 3, cls: 'active-treble' },
        ].forEach(function (t) {
            var btn = document.createElement('button');
            btn.className = 'tab-btn';
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
        tabs.querySelector('[data-multiplier="1"]').classList.add('active-single');
        document.body.dataset.multiplier = 1;
        app.appendChild(tabs);

        // ── Segment entry grid ──
        var grid = document.createElement('div');
        grid.id = 'cricket-seg-grid';
        grid.className = 'cricket-seg-grid';

        NUMBERS.forEach(function (num) {
            var btn = document.createElement('button');
            btn.className = 'cricket-seg-btn';
            btn.dataset.number = num;
            btn.type = 'button';
            btn.textContent = NUMBER_LABELS[num] || num;
            btn.addEventListener('click', function () {
                if (_state.turnComplete) return;
                _throwDart(num);
            });
            grid.appendChild(btn);
        });

        // Miss button
        var missBtn = document.createElement('button');
        missBtn.className = 'cricket-seg-btn cricket-miss-btn';
        missBtn.type = 'button';
        missBtn.textContent = 'MISS';
        missBtn.addEventListener('click', function () {
            if (_state.turnComplete) return;
            _throwDart(0);
        });
        grid.appendChild(missBtn);

        app.appendChild(grid);
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

        // Dart pill row (current turn darts)
        var pillRow = document.createElement('div');
        pillRow.id = 'cricket-pills';
        pillRow.className = 'cricket-pills';
        container.appendChild(pillRow);

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

    function _throwDart(segment) {
        if (_state.turnComplete || _state.status !== 'active') return;

        var multiplier = _state.multiplier;
        // Miss always = 0 multiplier for scoring but we send 1
        if (segment === 0) multiplier = 1;

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
            var board = document.getElementById('cricket-board');
            if (board) _renderBoard(board);
            _addPill(last.segment, last.multiplier, last.marks_added, last.points_scored);

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
        _announcePlayer();
    }

    function _onUndo() {
        _lockBoard(true);
        API.undoCricketThrow(_state.matchId)
            .then(function (s) {
                _applyState(s);
                // Full re-render of board to reflect undone state
                var board = document.getElementById('cricket-board');
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

    function _lockBoard(locked) {
        document.querySelectorAll('.cricket-seg-btn, .cricket-tabs .tab-btn').forEach(function (btn) {
            btn.disabled = locked;
        });
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
        var player = _state.players.find(function (p) { return p.id === _state.currentPlayerId; });
        if (player) {
            setTimeout(function () {
                SPEECH.announcePlayer && SPEECH.announcePlayer(player.name);
            }, 200);
        }
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