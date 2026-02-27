/**
 * shanghai.js
 * -----------
 * Full-screen Shanghai darts game controller.
 *
 * Public API:
 *   SHANGHAI_GAME.start(config, onEnd)
 *     config: { players: [{id, name, isCpu, mode}], numRounds: 7|20, cpuDifficulty: 'easy'|'medium'|'hard' }
 *     onEnd:  called when game ends or is abandoned
 */

var SHANGHAI_GAME = (function () {

    // Target numbers for each round (index 0 = round 1)
    var ROUND_TARGETS = [1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20];

    var _state = {
        matchId:        null,
        gameId:         null,
        numRounds:      7,
        players:        [],      // [{ id, name, isCpu }]
        scores:         {},      // { playerId: total }
        roundsByPlayer: {},      // { playerId: [{ round_number, score, shanghai }] }
        currentRound:   1,
        targetNumber:   1,
        currentPlayerId: null,
        tiebreak:       false,
        status:         'active',
        winnerId:       null,
        // Local dart buffer (not yet submitted)
        pendingDarts:   [],      // [{ segment, multiplier, points }]
        turnComplete:   false,   // true after 3rd dart — waiting for NEXT
        multiplier:     1,
        cpuDifficulty:  'medium',
        cpuRunning:     false,
        onEnd:          null,
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
                return API.createShanghaiMatch({
                    player_ids: players.map(function (p) { return p.id; }),
                    num_rounds: config.numRounds || 7,
                })
                .then(function (state) {
                    return { players: players, state: state };
                });
            })
            .then(function (result) {
                _applyState(result.state, result.players);
                _state.cpuDifficulty = config.cpuDifficulty || 'medium';
                _state.onEnd = onEnd;
                UI.setLoading(false);
                _buildScreen();
                _beginTurn();
            })
            .catch(function (err) {
                UI.setLoading(false);
                UI.showToast(err.message.toUpperCase(), 'bust', 4000);
                console.error('[shanghai] start error:', err);
            });
    }

    // ─────────────────────────────────────────────────────────────────
    // Player resolution
    // ─────────────────────────────────────────────────────────────────

    function _resolvePlayers(selections) {
        // Process sequentially (not Promise.all) so CPU resolution doesn't race
        var result = [];
        function resolveNext(i) {
            if (i >= selections.length) return Promise.resolve(result);
            var sel = selections[i];
            var p;
            if (sel.isCpu) {
                // CPU must have a real DB record (same pattern as 501)
                p = API.getCpuPlayer()
                    .catch(function () { return null; })
                    .then(function (rec) {
                        if (!rec) return API.createPlayer('CPU');
                        return rec;
                    })
                    .then(function (rec) {
                        result.push({ id: rec.id, name: 'CPU', isCpu: true,
                                      difficulty: sel.difficulty || 'medium' });
                    });
            } else if (sel.mode === 'existing') {
                result.push({ id: sel.id, name: sel.name, isCpu: false });
                p = Promise.resolve();
            } else {
                p = API.createPlayer(sel.name)
                    .then(function (rec) {
                        result.push({ id: rec.id, name: rec.name, isCpu: false });
                    });
            }
            return p.then(function () { return resolveNext(i + 1); });
        }
        return resolveNext(0);
    }

    // ─────────────────────────────────────────────────────────────────
    // State
    // ─────────────────────────────────────────────────────────────────

    function _applyState(s, playersOverride) {
        _state.matchId         = s.match_id;
        _state.gameId          = s.game_id;
        _state.numRounds       = s.num_rounds;
        _state.status          = s.status;
        _state.winnerId        = s.winner_id;
        _state.tiebreak        = !!s.tiebreak;
        _state.currentRound    = s.current_round;
        _state.targetNumber    = s.target_number;
        _state.currentPlayerId = String(s.current_player_id);

        // Scores
        _state.scores = {};
        if (s.scores) {
            Object.keys(s.scores).forEach(function (pid) {
                _state.scores[String(pid)] = s.scores[pid];
            });
        }

        // Rounds by player
        _state.roundsByPlayer = {};
        if (s.rounds_by_player) {
            Object.keys(s.rounds_by_player).forEach(function (pid) {
                _state.roundsByPlayer[String(pid)] = s.rounds_by_player[pid];
            });
        }

        // Apply player list from override (has isCpu) or from server state
        if (playersOverride) {
            _state.players = playersOverride.map(function (p) {
                return { id: String(p.id), name: p.name, isCpu: !!p.isCpu };
            });
        } else if (s.players) {
            _state.players = s.players.map(function (p) {
                var existing = _state.players.find(function (ep) { return String(ep.id) === String(p.id); });
                return { id: String(p.id), name: p.name, isCpu: existing ? existing.isCpu : false };
            });
        }
    }

    function _currentPlayer() {
        return _state.players.find(function (p) { return String(p.id) === String(_state.currentPlayerId); });
    }

    // ─────────────────────────────────────────────────────────────────
    // Screen build
    // ─────────────────────────────────────────────────────────────────

    function _buildScreen() {
        var app = document.getElementById('app');
        app.innerHTML = '';
        app.style.cssText = '';
        document.body.className = 'mode-shanghai';

        // ── Header ──────────────────────────────────────────────────
        var header = document.createElement('div');
        header.className = 'sh-header';

        var undoBtn = document.createElement('button');
        undoBtn.id = 'sh-undo-btn';
        undoBtn.className = 'sh-btn sh-btn-undo';
        undoBtn.type = 'button';
        undoBtn.textContent = '↩ UNDO';
        undoBtn.disabled = true;
        undoBtn.addEventListener('click', _onUndo);
        header.appendChild(undoBtn);

        var nextBtn = document.createElement('button');
        nextBtn.id = 'sh-next-btn';
        nextBtn.className = 'sh-btn sh-btn-next';
        nextBtn.type = 'button';
        nextBtn.textContent = 'NEXT ›';
        nextBtn.disabled = true;
        nextBtn.addEventListener('click', _onNext);
        header.appendChild(nextBtn);

        var rulesBtn = document.createElement('button');
        rulesBtn.type = 'button';
        rulesBtn.className = 'rules-btn';
        rulesBtn.textContent = '📖 RULES';
        rulesBtn.addEventListener('click', function() { UI.showRulesModal('shanghai'); });
        header.appendChild(rulesBtn);

        var endBtn = document.createElement('button');
        endBtn.id = 'sh-end-btn';
        endBtn.className = 'sh-btn sh-btn-end';
        endBtn.type = 'button';
        endBtn.textContent = 'END';
        endBtn.addEventListener('click', _onEnd);
        header.appendChild(endBtn);

        app.appendChild(header);

        // ── Scoreboard ──────────────────────────────────────────────
        var scoreboard = document.createElement('div');
        scoreboard.id = 'sh-scoreboard';
        scoreboard.className = 'sh-scoreboard';
        app.appendChild(scoreboard);
        _renderScoreboard();

        // ── Target banner ────────────────────────────────────────────
        var banner = document.createElement('div');
        banner.id = 'sh-target-banner';
        banner.className = 'sh-target-banner';
        app.appendChild(banner);
        _updateTargetBanner();

        // ── Dart pills ───────────────────────────────────────────────
        var pills = document.createElement('div');
        pills.id = 'sh-pills';
        pills.className = 'sh-pills';
        app.appendChild(pills);

        // ── Multiplier tabs ──────────────────────────────────────────
        var tabs = document.createElement('div');
        tabs.id = 'sh-tabs';
        tabs.className = 'sh-tabs';
        [
            { label: 'Single', mul: 1, cls: 'active-single' },
            { label: 'Double', mul: 2, cls: 'active-double' },
            { label: 'Treble', mul: 3, cls: 'active-treble' },
        ].forEach(function (t) {
            var btn = document.createElement('button');
            btn.className = 'tab-btn';
            btn.type = 'button';
            btn.dataset.multiplier = t.mul;
            btn.dataset.activeClass = t.cls;
            btn.textContent = t.label;
            UI.addTouchSafeListener(btn, function () {
                if (_state.turnComplete || _state.cpuRunning) return;
                _state.multiplier = t.mul;
                tabs.querySelectorAll('.tab-btn').forEach(function (b) {
                    b.classList.remove('active-single', 'active-double', 'active-treble');
                });
                btn.classList.add(t.cls);
                document.body.dataset.multiplier = t.mul;
            });
            tabs.appendChild(btn);
        });
        _setMultiplierTab(1);
        app.appendChild(tabs);

        // ── Segment grid ─────────────────────────────────────────────
        // Shows all 20 numbers + BULL + MISS
        // Non-target hits are accepted but score 0 (board can't be restricted
        // because players might accidentally tap — we just score 0)
        var grid = document.createElement('div');
        grid.id = 'sh-seg-grid';
        grid.className = 'sh-seg-grid';

        var allNums = [20,1,18,4,13,6,10,15,2,17,3,19,7,16,8,11,14,9,12,5];
        allNums.forEach(function (n) {
            var btn = document.createElement('button');
            btn.className = 'sh-seg-btn';
            btn.dataset.seg = n;
            btn.type = 'button';
            btn.textContent = n;
            btn.addEventListener('click', function () {
                if (_state.turnComplete || _state.cpuRunning) return;
                _throwDart(n);
            });
            grid.appendChild(btn);
        });

        // Bull button
        var bullBtn = document.createElement('button');
        bullBtn.className = 'sh-seg-btn sh-bull-btn';
        bullBtn.type = 'button';
        bullBtn.textContent = 'BULL';
        bullBtn.addEventListener('click', function () {
            if (_state.turnComplete || _state.cpuRunning) return;
            _throwDart(25);
        });
        grid.appendChild(bullBtn);

        // Miss button
        var missBtn = document.createElement('button');
        missBtn.className = 'sh-seg-btn sh-miss-btn';
        missBtn.type = 'button';
        missBtn.textContent = 'MISS';
        missBtn.addEventListener('click', function () {
            if (_state.turnComplete || _state.cpuRunning) return;
            _throwDart(0);
        });
        grid.appendChild(missBtn);

        app.appendChild(grid);
        _applyTargetHighlight();
    }

    // ─────────────────────────────────────────────────────────────────
    // Scoreboard
    // ─────────────────────────────────────────────────────────────────

    function _renderScoreboard() {
        var sb = document.getElementById('sh-scoreboard');
        if (!sb) return;
        sb.innerHTML = '';

        var totalRounds = _state.numRounds;

        _state.players.forEach(function (p) {
            var col = document.createElement('div');
            col.className = 'sh-player-col' +
                (String(p.id) === String(_state.currentPlayerId) ? ' sh-active-player' : '');
            col.id = 'sh-pcol-' + p.id;

            // Player name + total score
            var header = document.createElement('div');
            header.className = 'sh-player-header';

            var nameEl = document.createElement('div');
            nameEl.className = 'sh-player-name';
            nameEl.textContent = p.name.toUpperCase();

            var scoreEl = document.createElement('div');
            scoreEl.className = 'sh-player-total';
            scoreEl.id = 'sh-total-' + p.id;
            scoreEl.textContent = _state.scores[String(p.id)] || 0;

            header.appendChild(nameEl);
            header.appendChild(scoreEl);
            col.appendChild(header);

            // Round rows
            var rounds = _state.roundsByPlayer[String(p.id)] || [];
            var roundMap = {};
            rounds.forEach(function (r) { roundMap[r.round_number] = r; });

            for (var rn = 1; rn <= totalRounds; rn++) {
                var row = document.createElement('div');
                row.className = 'sh-round-row';
                row.id = 'sh-round-' + p.id + '-' + rn;

                var roundData = roundMap[rn];
                if (roundData) {
                    row.classList.add('sh-round-done');
                    if (roundData.shanghai) row.classList.add('sh-round-shanghai');
                    var displayVal = roundData.shanghai
                        ? '🎯 S!'
                        : (roundData.score > 0 ? roundData.score : '—');
                    row.textContent = displayVal;
                } else if (rn === _state.currentRound && String(p.id) === String(_state.currentPlayerId)) {
                    row.classList.add('sh-round-active');
                    row.textContent = '▶';
                } else {
                    row.textContent = '';
                }
                col.appendChild(row);
            }

            sb.appendChild(col);
        });
    }

    function _updateScoreDisplay(playerId, total) {
        var el = document.getElementById('sh-total-' + playerId);
        if (el) el.textContent = total;
    }

    function _updateActivePlayer() {
        document.querySelectorAll('.sh-player-col').forEach(function (el) {
            el.classList.remove('sh-active-player');
        });
        var col = document.getElementById('sh-pcol-' + _state.currentPlayerId);
        if (col) col.classList.add('sh-active-player');
    }

    function _markRoundDone(playerId, roundNumber, score, isShanghai) {
        var row = document.getElementById('sh-round-' + playerId + '-' + roundNumber);
        if (!row) return;
        row.classList.remove('sh-round-active');
        row.classList.add('sh-round-done');
        if (isShanghai) {
            row.classList.add('sh-round-shanghai');
            row.textContent = '🎯 S!';
        } else {
            row.textContent = score > 0 ? score : '—';
        }
    }

    function _setActiveRoundIndicator(playerId, roundNumber) {
        // Clear previous active row for this player
        document.querySelectorAll('#sh-pcol-' + playerId + ' .sh-round-active').forEach(function (el) {
            el.classList.remove('sh-round-active');
            el.textContent = '';
        });
        var row = document.getElementById('sh-round-' + playerId + '-' + roundNumber);
        if (row) {
            row.classList.add('sh-round-active');
            row.textContent = '▶';
        }
    }

    // ─────────────────────────────────────────────────────────────────
    // Target banner
    // ─────────────────────────────────────────────────────────────────

    function _updateTargetBanner() {
        var banner = document.getElementById('sh-target-banner');
        if (!banner) return;

        var player = _currentPlayer();
        var playerName = player ? player.name.toUpperCase() : '';

        if (_state.tiebreak) {
            banner.innerHTML =
                '<span class="sh-banner-label">TIEBREAK</span>' +
                '<span class="sh-banner-target">BULL</span>' +
                '<span class="sh-banner-player">' + _esc(playerName) + '</span>';
        } else {
            var roundLabel = 'ROUND ' + _state.currentRound + ' / ' + _state.numRounds;
            banner.innerHTML =
                '<span class="sh-banner-round">' + roundLabel + '</span>' +
                '<span class="sh-banner-target">' + (_state.targetNumber === 25 ? 'BULL' : _state.targetNumber) + '</span>' +
                '<span class="sh-banner-player">' + _esc(playerName) + '</span>';
        }

        _applyTargetHighlight();
    }

    function _applyTargetHighlight() {
        // Highlight the current target segment button
        document.querySelectorAll('.sh-seg-btn').forEach(function (btn) {
            btn.classList.remove('sh-seg-target');
        });
        var target = _state.targetNumber;
        if (target === 25) {
            var bull = document.querySelector('.sh-bull-btn');
            if (bull) bull.classList.add('sh-seg-target');
        } else {
            var btn = document.querySelector('.sh-seg-btn[data-seg="' + target + '"]');
            if (btn) btn.classList.add('sh-seg-target');
        }
    }

    // ─────────────────────────────────────────────────────────────────
    // Turn management
    // ─────────────────────────────────────────────────────────────────

    function _beginTurn() {
        _state.pendingDarts = [];
        _state.turnComplete = false;
        _state.multiplier   = 1;
        _setMultiplierTab(1);
        _lockBoard(false);
        _clearPills();
        _updateTargetBanner();
        _updateActivePlayer();

        var player = _currentPlayer();
        if (!player) return;

        // Speech: "{Name} your number is {target}"
        if (SPEECH.isEnabled()) {
            var target = _state.tiebreak ? 'Bull' : String(_state.targetNumber);
            setTimeout(function () {
                SPEECH.announceShanghai
                    ? SPEECH.announceShanghai(player.name, target)
                    : SPEECH.announcePlayer(player.name + ', your number is ' + target);
            }, 300);
        }

        if (player.isCpu) {
            _runCpuTurn();
        }
    }

    // ─────────────────────────────────────────────────────────────────
    // Local dart recording
    // ─────────────────────────────────────────────────────────────────

    // _throwDart(segment, multiplierOverride)
    // Called by both human taps (no override) and CPU (explicit multiplier).
    function _throwDart(segment, multiplierOverride) {
        if (_state.turnComplete || _state.status !== 'active') return;

        var multiplier = (multiplierOverride !== undefined) ? multiplierOverride : _state.multiplier;
        if (segment === 0) multiplier = 1;   // miss always = 1

        var target = _state.targetNumber;
        var points = 0;
        if (segment !== 0) {
            if (_state.tiebreak) {
                if (segment === 25) points = 25 * multiplier;
            } else {
                if (segment === target) points = segment * multiplier;
            }
        }

        _state.pendingDarts.push({ segment: segment, multiplier: multiplier, points: points });

        // Update running total display
        var pendingTotal  = _state.pendingDarts.reduce(function (s, d) { return s + d.points; }, 0);
        var existingTotal = _state.scores[String(_state.currentPlayerId)] || 0;
        _updateScoreDisplay(_state.currentPlayerId, existingTotal + pendingTotal);

        _addPill(segment, multiplier, points);

        if (typeof SOUNDS !== 'undefined' && SOUNDS.isEnabled()) SOUNDS.dart();
        if (SPEECH.isEnabled()) SPEECH.announceDartScore(segment, multiplier, points);

        // Check for Shanghai (S+D+T of target all in pending darts)
        var hasShanghai = _checkPendingShanghai();
        if (hasShanghai) {
            _state.turnComplete = true;
            _lockBoard(true);
            UI.showToast('SHANGHAI! 🎯', 'checkout', 3000);
            if (typeof SOUNDS !== 'undefined' && SOUNDS.isEnabled()) SOUNDS.checkout();
            _enableNext(true);
            _enableUndo(false);
            return;
        }

        // After 3rd dart — lock board, show NEXT
        if (_state.pendingDarts.length >= 3) {
            _state.turnComplete = true;
            _lockBoard(true);
            _enableNext(true);
            if (SPEECH.isEnabled()) {
                var turnScore = _state.pendingDarts.reduce(function (s, d) { return s + d.points; }, 0);
                setTimeout(function () {
                    SPEECH.announceTurnEnd(turnScore, 0);
                }, 800);
            }
        }

        _enableUndo(_state.pendingDarts.length > 0 && !hasShanghai);
    }

    function _checkPendingShanghai() {
        if (_state.tiebreak) return false;
        var target = _state.targetNumber;
        var hitSingle = false, hitDouble = false, hitTreble = false;
        _state.pendingDarts.forEach(function (d) {
            if (d.segment === target) {
                if (d.multiplier === 1) hitSingle = true;
                if (d.multiplier === 2) hitDouble = true;
                if (d.multiplier === 3) hitTreble = true;
            }
        });
        return hitSingle && hitDouble && hitTreble;
    }

    // ─────────────────────────────────────────────────────────────────
    // Pills
    // ─────────────────────────────────────────────────────────────────

    function _addPill(segment, multiplier, points) {
        var pills = document.getElementById('sh-pills');
        if (!pills) return;
        var label;
        if (segment === 0) {
            label = 'MISS';
        } else if (segment === 25) {
            label = multiplier === 2 ? 'BULL' : 'OUTER';
        } else {
            label = (multiplier === 3 ? 'T' : multiplier === 2 ? 'D' : 'S') + segment;
        }
        var pill = document.createElement('div');
        pill.className = 'dart-pill' +
            (segment === 0 ? ' pill-miss' : '') +
            (points > 0 ? ' pill-hot' : '');
        pill.textContent = label + (points > 0 ? ' (' + points + ')' : '');
        pills.appendChild(pill);
    }

    function _clearPills() {
        var pills = document.getElementById('sh-pills');
        if (pills) pills.innerHTML = '';
    }

    // ─────────────────────────────────────────────────────────────────
    // NEXT — submit round to server
    // ─────────────────────────────────────────────────────────────────

    function _onNext() {
        if (!_state.turnComplete) return;

        _lockBoard(true);
        _enableNext(false);
        _enableUndo(false);
        UI.setLoading(true);

        var player   = _currentPlayer();
        var isShanghai = _checkPendingShanghai();
        var darts    = _state.pendingDarts.slice();

        API.submitShanghaiRound(_state.matchId, {
            player_id:     parseInt(_state.currentPlayerId, 10),
            round_number:  _state.currentRound,
            target_number: _state.targetNumber,
            darts: darts.map(function (d) {
                return { segment: d.segment, multiplier: d.multiplier };
            }),
        })
        .then(function (s) {
            UI.setLoading(false);
            var result = s.round_result;

            // Mark round done in scoreboard
            _markRoundDone(_state.currentPlayerId, _state.currentRound, result.score, result.is_shanghai);

            // Apply full server state
            _applyState(s);

            // Revert score display to authoritative server value
            _updateScoreDisplay(player.id, _state.scores[String(player.id)] || 0);

            _state.pendingDarts = [];

            // Shanghai instant win?
            if (result.is_shanghai || s.status === 'complete') {
                _lockBoard(true);
                setTimeout(function () { _showResultModal(s); }, 600);
                return;
            }

            // Tiebreak triggered?
            if (result.tiebreak) {
                UI.showToast('TIEBREAK — THROW FOR BULL!', 'info', 3000);
            }

            // Advance to next player / round
            _advanceTurn();
        })
        .catch(function (err) {
            UI.setLoading(false);
            _lockBoard(false);
            _enableNext(true);
            UI.showToast('SYNC ERROR: ' + err.message, 'bust', 3000);
            console.error('[shanghai] submit error:', err);
        });
    }

    function _advanceTurn() {
        _clearPills();
        _setMultiplierTab(1);
        _state.multiplier   = 1;
        _state.turnComplete = false;

        // Update active player indicator
        _setActiveRoundIndicator(_state.currentPlayerId, _state.currentRound);
        _updateActivePlayer();

        _beginTurn();
    }

    // ─────────────────────────────────────────────────────────────────
    // Undo — local only
    // ─────────────────────────────────────────────────────────────────

    function _onUndo() {
        if (_state.cpuRunning || _state.pendingDarts.length === 0) return;

        var removed = _state.pendingDarts.pop();

        // Remove last pill
        var pills = document.getElementById('sh-pills');
        if (pills && pills.lastChild) pills.removeChild(pills.lastChild);

        // Revert score display
        var pendingTotal = _state.pendingDarts.reduce(function (s, d) { return s + d.points; }, 0);
        var existingTotal = _state.scores[String(_state.currentPlayerId)] || 0;
        _updateScoreDisplay(_state.currentPlayerId, existingTotal + pendingTotal);

        if (_state.turnComplete) {
            _state.turnComplete = false;
            _lockBoard(false);
            _enableNext(false);
        }

        _enableUndo(_state.pendingDarts.length > 0);
        UI.showToast('DART UNDONE', 'info', 1200);
    }

    // ─────────────────────────────────────────────────────────────────
    // End
    // ─────────────────────────────────────────────────────────────────

    function _onEnd() {
        UI.showConfirmModal({
            title:        'ABANDON SHANGHAI?',
            message:      'The match will be cancelled.',
            confirmLabel: 'YES, END',
            confirmClass: 'confirm-btn-danger',
            onConfirm: function () {
                API.endShanghaiMatch(_state.matchId).catch(function () {});
                if (_state.onEnd) _state.onEnd();
            },
        });
    }

    // ─────────────────────────────────────────────────────────────────
    // CPU turn
    // ─────────────────────────────────────────────────────────────────

    function _runCpuTurn() {
        if (_state.cpuRunning) return;
        _state.cpuRunning = true;
        _lockBoard(true);

        var player   = _currentPlayer();
        var target   = _state.targetNumber;
        var profile  = _getCpuProfile();
        var dartsLeft = 3;
        var delay    = 900;

        // CPU aims: treble of target, falls back per variance
        function throwNext() {
            if (dartsLeft === 0) {
                _state.cpuRunning = false;
                _state.turnComplete = true;
                _enableNext(true);
                if (SPEECH.isEnabled()) {
                    var turnScore = _state.pendingDarts.reduce(function (s, d) { return s + d.points; }, 0);
                    setTimeout(function () { SPEECH.announceTurnEnd(turnScore, 0); }, 500);
                }
                return;
            }

            setTimeout(function () {
                if (_state.status !== 'active') return;

                // Intended: treble of target (or bull for tiebreak)
                var intended, actual;
                if (_state.tiebreak) {
                    intended = { segment: 25, multiplier: 2 }; // aim inner bull
                } else {
                    intended = { segment: target, multiplier: 3 }; // aim treble
                }
                actual = _applyCpuVariance(intended, profile);

                _throwDart(actual.segment, actual.multiplier);
                dartsLeft--;

                // If Shanghai was hit, stop early
                if (_state.turnComplete) {
                    _state.cpuRunning = false;
                    return;
                }

                throwNext();
            }, delay);
        }

        setTimeout(function () { throwNext(); }, 600);
    }



    function _getCpuProfile() {
        // Reuse CPU difficulty profiles — aim single of target with variance
        var profiles = {
            easy:   { hit: 0.45, adjacent: 0.30, miss: 0.25 },
            medium: { hit: 0.65, adjacent: 0.25, miss: 0.10 },
            hard:   { hit: 0.82, adjacent: 0.14, miss: 0.04 },
        };
        return profiles[_state.cpuDifficulty] || profiles.medium;
    }

    var BOARD_RING = [20,1,18,4,13,6,10,15,2,17,3,19,7,16,8,11,14,9,12,5];

    function _applyCpuVariance(intended, profile) {
        var r = Math.random();
        var seg = intended.segment;
        var mul = intended.multiplier;

        if (_state.tiebreak) {
            // Aiming at bull
            if (r < profile.hit)                        return { segment: 25, multiplier: 2 }; // inner bull
            if (r < profile.hit + profile.adjacent)     return { segment: 25, multiplier: 1 }; // outer bull
            return { segment: 0, multiplier: 1 };                                               // miss
        }

        // Aiming treble of target
        if (r < profile.hit)                            return { segment: seg, multiplier: 3 };
        if (r < profile.hit + (profile.adjacent * 0.5)) return { segment: seg, multiplier: 1 };
        if (r < profile.hit + profile.adjacent) {
            var idx  = BOARD_RING.indexOf(seg);
            var adj  = idx >= 0 ? BOARD_RING[(idx + (Math.random() < 0.5 ? 1 : -1) + 20) % 20] : seg;
            return { segment: adj, multiplier: 1 };
        }
        return { segment: 0, multiplier: 1 }; // miss
    }

    // ─────────────────────────────────────────────────────────────────
    // Result modal (win / draw / tiebreak)
    // ─────────────────────────────────────────────────────────────────

    function _showResultModal(s) {
        if (typeof SOUNDS !== 'undefined' && SOUNDS.isEnabled()) SOUNDS.checkout();

        var overlay = document.createElement('div');
        overlay.className = 'modal-overlay';

        var box = document.createElement('div');
        box.className = 'modal-box sh-result-box';

        var isShanghai = s.round_result && s.round_result.is_shanghai;
        var winnerId   = s.winner_id;

        if (winnerId) {
            var winner = _state.players.find(function (p) { return String(p.id) === String(winnerId); });
            var title  = isShanghai
                ? '🎯 SHANGHAI!'
                : '🏆 ' + _esc(winner ? winner.name.toUpperCase() : '') + ' WINS!';

            box.innerHTML =
                '<div class="sh-result-icon">' + (isShanghai ? '🎯' : '🏆') + '</div>' +
                '<div class="modal-title">' + title + '</div>' +
                '<div class="modal-subtitle">' + (isShanghai ? 'INSTANT WIN' : 'SHANGHAI') + '</div>';
        } else {
            box.innerHTML =
                '<div class="sh-result-icon">🤝</div>' +
                '<div class="modal-title">DRAW!</div>' +
                '<div class="modal-subtitle">ALL SCORES EQUAL</div>';
        }

        // Score breakdown
        var breakdown = document.createElement('div');
        breakdown.className = 'sh-result-scores';
        _state.players.forEach(function (p) {
            var row = document.createElement('div');
            row.className = 'sh-result-score-row' + (String(p.id) === String(winnerId) ? ' sh-result-winner' : '');
            row.innerHTML =
                '<span>' + _esc(p.name) + '</span>' +
                '<span>' + (_state.scores[String(p.id)] || 0) + ' pts</span>';
            breakdown.appendChild(row);
        });
        box.appendChild(breakdown);

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

        if (SPEECH.isEnabled()) {
            setTimeout(function () {
                if (winnerId && winner) {
                    SPEECH.announceCricketWin && SPEECH.announceCricketWin(winner.name);
                }
            }, 400);
        }
    }

    // ─────────────────────────────────────────────────────────────────
    // Board locking / button helpers
    // ─────────────────────────────────────────────────────────────────

    function _lockBoard(locked) {
        var grid = document.getElementById('sh-seg-grid');
        if (grid) {
            grid.querySelectorAll('.sh-seg-btn').forEach(function (btn) {
                btn.disabled = locked;
            });
        }
        var tabs = document.getElementById('sh-tabs');
        if (tabs) {
            tabs.querySelectorAll('.tab-btn').forEach(function (btn) {
                btn.disabled = locked;
            });
        }
    }

    function _enableNext(enabled) {
        var btn = document.getElementById('sh-next-btn');
        if (btn) btn.disabled = !enabled;
    }

    function _enableUndo(enabled) {
        var btn = document.getElementById('sh-undo-btn');
        if (btn) btn.disabled = !enabled;
    }

    function _setMultiplierTab(mul) {
        _state.multiplier = mul;
        var tabs = document.getElementById('sh-tabs');
        if (!tabs) return;
        tabs.querySelectorAll('.tab-btn').forEach(function (b) {
            b.classList.remove('active-single', 'active-double', 'active-treble');
        });
        var cls = mul === 1 ? 'active-single' : mul === 2 ? 'active-double' : 'active-treble';
        var btn = tabs.querySelector('[data-multiplier="' + mul + '"]');
        if (btn) btn.classList.add(cls);
        document.body.dataset.multiplier = mul;
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