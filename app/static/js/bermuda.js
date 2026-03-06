/**
 * bermuda.js
 * ----------
 * Bermuda Triangle darts game controller.
 *
 * Public API:
 *   BERMUDA_GAME.start(config, onEnd)
 *     config: { players: [{id,name}|{mode:'new',name}] }
 *     onEnd:  called when game ends or is abandoned
 */

var BERMUDA_GAME = (function () {

    // ── Round definitions (mirrors backend) ───────────────────────────────────
    var ROUNDS = [
        null,                                                     // 1-based index padding
        { type: 'number',  value: 12,           label: '12' },
        { type: 'number',  value: 13,           label: '13' },
        { type: 'number',  value: 14,           label: '14' },
        { type: 'special', value: 'any_double', label: 'Any Double' },
        { type: 'number',  value: 15,           label: '15' },
        { type: 'number',  value: 16,           label: '16' },
        { type: 'number',  value: 17,           label: '17' },
        { type: 'special', value: 'any_triple', label: 'Any Triple' },
        { type: 'number',  value: 18,           label: '18' },
        { type: 'number',  value: 19,           label: '19' },
        { type: 'number',  value: 20,           label: '20' },
        { type: 'special', value: 'single_bull',label: 'Single Bull' },
        { type: 'special', value: 'double_bull',label: 'Double Bull' },
    ];

    // ── State ─────────────────────────────────────────────────────────────────
    var _state = {
        matchId:            null,
        players:            [],
        currentPlayerIndex: 0,
        currentPlayerId:    null,
        currentRound:       1,
        status:             'active',
        winnerId:           null,
        winnerIds:          [],
        onEnd:              null,
        multiplier:         1,
        setComplete:        false,
    };

    var _pendingThrows = [];   // { segment, multiplier, points }
    var _throwHistory  = [];   // for undo

    // ── Public ────────────────────────────────────────────────────────────────

    function start(config, onEnd) {
        _state.matchId            = null;
        _state.players            = [];
        _state.currentPlayerIndex = 0;
        _state.currentPlayerId    = null;
        _state.currentRound       = 1;
        _state.status             = 'active';
        _state.winnerId           = null;
        _state.winnerIds          = [];
        _state.onEnd              = null;
        _state.multiplier         = 1;
        _state.setComplete        = false;
        _pendingThrows = [];
        _throwHistory  = [];

        SPEECH.unlock();
        if (typeof SOUNDS !== 'undefined') SOUNDS.unlock();
        UI.setLoading(true);

        _resolvePlayers(config.players)
            .then(function (players) {
                return API.createBermudaMatch({
                    player_ids: players.map(function (p) { return p.id; }),
                });
            })
            .then(function (s) {
                _applyState(s);
                _state.onEnd = onEnd;
                UI.setLoading(false);
                _buildScreen();
                _announceRoundAndPlayer(true);
            })
            .catch(function (err) {
                UI.setLoading(false);
                console.error('[bermuda] start error:', err);
            });
    }

    // ── Player resolution ─────────────────────────────────────────────────────

    function _resolvePlayers(selections) {
        return Promise.all(selections.map(function (sel) {
            if (sel.mode === 'existing') return Promise.resolve({ id: sel.id, name: sel.name });
            return API.createPlayer(sel.name).then(function (p) { return { id: p.id, name: p.name }; });
        }));
    }

    // ── State ─────────────────────────────────────────────────────────────────

    function _applyState(s) {
        _state.matchId            = s.match_id;
        _state.players            = s.players || [];
        _state.currentPlayerIndex = s.current_player_index;
        _state.currentPlayerId    = s.current_player_id ? String(s.current_player_id) : null;
        _state.currentRound       = s.current_round || 1;
        _state.status             = s.status || 'active';
        _state.winnerId           = s.winner_id || null;
    }

    function _currentPlayer() {
        return _state.players.find(function (p) {
            return String(p.id) === String(_state.currentPlayerId);
        }) || _state.players[_state.currentPlayerIndex] || null;
    }

    function _playerById(id) {
        return _state.players.find(function (p) { return String(p.id) === String(id); }) || null;
    }

    function _roundInfo() {
        return ROUNDS[_state.currentRound] || ROUNDS[1];
    }

    // ── Score dart locally (mirrors backend) ──────────────────────────────────

    function _scoreDart(segment, multiplier, roundNum) {
        var r = ROUNDS[roundNum];
        if (!r) return 0;
        if (r.type === 'number') {
            return segment === r.value ? segment * multiplier : 0;
        }
        if (r.value === 'any_double') {
            return (multiplier === 2 && segment !== 25) ? segment * 2 : 0;
        }
        if (r.value === 'any_triple') {
            return (multiplier === 3) ? segment * 3 : 0;
        }
        if (r.value === 'single_bull') {
            return (segment === 25 && multiplier === 1) ? 25 : 0;
        }
        if (r.value === 'double_bull') {
            return (segment === 25 && multiplier === 2) ? 50 : 0;
        }
        return 0;
    }

    function _turnTotal() {
        return _pendingThrows.reduce(function (sum, t) { return sum + t.points; }, 0);
    }

    // ── Build screen ──────────────────────────────────────────────────────────

    function _buildScreen() {
        ['confirm-modal', 'rules-modal'].forEach(function (id) {
            var el = document.getElementById(id);
            if (el) el.remove();
        });

        var app = document.getElementById('app');
        app.innerHTML = '';
        app.style.cssText = '';
        document.body.className = 'mode-bermuda';

        // ── Header ────────────────────────────────────────────────────────────
        var header = document.createElement('div');
        header.className = 'game-header';

        var leftSlot = document.createElement('div');
        leftSlot.className = 'gh-left';
        var titleWrap = document.createElement('div');
        titleWrap.className = 'gh-title-wrap';
        var titleEl = document.createElement('div');
        titleEl.className = 'gh-game-name';
        titleEl.textContent = 'BERMUDA △';
        var subEl = document.createElement('div');
        subEl.id        = 'bm-sub';
        subEl.className = 'gh-match-info';
        subEl.textContent = _state.players.length + ' PLAYERS · 13 ROUNDS';
        titleWrap.appendChild(titleEl);
        titleWrap.appendChild(subEl);
        leftSlot.appendChild(titleWrap);
        var rulesBtn = document.createElement('button');
        rulesBtn.type = 'button';
        rulesBtn.className = 'rules-btn';
        rulesBtn.textContent = '📖 RULES';
        rulesBtn.addEventListener('click', function () { UI.showRulesModal('bermuda'); });
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
        undoBtn.id = 'bm-undo-btn';
        undoBtn.className = 'gh-btn gh-btn-undo';
        undoBtn.type = 'button';
        undoBtn.textContent = '⟵ UNDO';
        undoBtn.disabled = true;
        undoBtn.addEventListener('click', _onUndo);
        var nextBtn = document.createElement('button');
        nextBtn.id = 'bm-next-btn';
        nextBtn.className = 'gh-btn gh-btn-next';
        nextBtn.type = 'button';
        nextBtn.textContent = 'NEXT ▶';
        nextBtn.disabled = true;
        nextBtn.addEventListener('click', _onNext);
        rightSlot.appendChild(undoBtn);
        rightSlot.appendChild(nextBtn);
        header.appendChild(rightSlot);
        app.appendChild(header);

        // ── Round progress strip ──────────────────────────────────────────────
        var strip = document.createElement('div');
        strip.id        = 'bm-round-strip';
        strip.className = 'bm-round-strip';
        app.appendChild(strip);
        _renderRoundStrip(strip);

        // ── Scoreboard ────────────────────────────────────────────────────────
        var board = document.createElement('div');
        board.id        = 'bm-board';
        board.className = 'bm-board';
        app.appendChild(board);
        _renderBoard(board);

        // ── Status bar ────────────────────────────────────────────────────────
        var statusEl = document.createElement('div');
        statusEl.id        = 'bm-status';
        statusEl.className = 'bm-status';
        app.appendChild(statusEl);
        _updateStatus();

        // ── Dart pills ────────────────────────────────────────────────────────
        var pills = document.createElement('div');
        pills.id        = 'bm-pills';
        pills.className = 'practice-pills';
        app.appendChild(pills);

        // ── Multiplier tabs ───────────────────────────────────────────────────
        _state.multiplier = 1;
        var tabs = document.createElement('div');
        tabs.id        = 'bm-tabs';
        tabs.className = 'bm-tabs';
        [
            { label: 'Single', mul: 1, cls: 'active-single' },
            { label: 'Double', mul: 2, cls: 'active-double' },
            { label: 'Treble', mul: 3, cls: 'active-treble' },
        ].forEach(function (tab) {
            var btn = document.createElement('button');
            btn.className = 'tab-btn' + (tab.mul === 1 ? ' active-single' : '');
            btn.dataset.multiplier = tab.mul;
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

        // ── Segment grid ──────────────────────────────────────────────────────
        var segBoard = document.createElement('main');
        segBoard.id = 'bm-seg-board';
        app.appendChild(segBoard);
        segBoard.appendChild(_buildGrid());
        segBoard.appendChild(_buildBullRow());

        _applyHighlights();
    }

    // ── Round progress strip ──────────────────────────────────────────────────

    function _renderRoundStrip(container) {
        container.innerHTML = '';
        for (var i = 1; i <= 13; i++) {
            var pip = document.createElement('div');
            pip.className = 'bm-round-pip' +
                (i < _state.currentRound  ? ' bm-round-done' :
                 i === _state.currentRound ? ' bm-round-current' : '');
            pip.textContent = ROUNDS[i].label.replace('Any ', '').replace(' Bull', '');
            container.appendChild(pip);
        }
    }

    // ── Scoreboard ────────────────────────────────────────────────────────────

    function _renderBoard(container) {
        container.innerHTML = '';
        _state.players.forEach(function (p) {
            var row = document.createElement('div');
            row.id        = 'bm-row-' + p.id;
            row.className = 'bm-player-row' +
                (String(p.id) === String(_state.currentPlayerId) ? ' bm-active' : '');

            var nameEl = document.createElement('div');
            nameEl.className   = 'bm-player-name';
            nameEl.textContent = p.name.toUpperCase();

            var scoreEl = document.createElement('div');
            scoreEl.id        = 'bm-score-' + p.id;
            scoreEl.className = 'bm-player-score';
            scoreEl.textContent = p.score;

            // Turn subtotal (shown while entering darts)
            var subEl = document.createElement('div');
            subEl.id        = 'bm-sub-' + p.id;
            subEl.className = 'bm-player-sub';
            subEl.textContent = '';

            row.appendChild(nameEl);
            row.appendChild(subEl);
            row.appendChild(scoreEl);
            container.appendChild(row);
        });
    }

    function _updateBoard() {
        _state.players.forEach(function (p) {
            var row = document.getElementById('bm-row-' + p.id);
            if (row) {
                row.className = 'bm-player-row' +
                    (String(p.id) === String(_state.currentPlayerId) ? ' bm-active' : '');
            }
            var scoreEl = document.getElementById('bm-score-' + p.id);
            if (scoreEl) scoreEl.textContent = p.score;
        });
    }

    function _updateTurnSub() {
        // Show running turn total for current player only
        var p   = _currentPlayer();
        var tot = _turnTotal();
        _state.players.forEach(function (pl) {
            var subEl = document.getElementById('bm-sub-' + pl.id);
            if (!subEl) return;
            if (String(pl.id) === String(_state.currentPlayerId) && _pendingThrows.length > 0) {
                subEl.textContent = tot > 0 ? '+' + tot : '—';
                subEl.className   = 'bm-player-sub' + (tot > 0 ? ' bm-sub-scoring' : ' bm-sub-miss');
            } else {
                subEl.textContent = '';
                subEl.className   = 'bm-player-sub';
            }
        });
    }

    function _updateStatus() {
        var el = document.getElementById('bm-status');
        if (!el) return;
        var p  = _currentPlayer();
        if (!p) return;
        var ri = _roundInfo();
        el.textContent = 'ROUND ' + _state.currentRound + ' / 13  ·  ' +
            ri.label.toUpperCase() + '  ·  ' + p.name.toUpperCase();
    }

    // ── Segment grid ──────────────────────────────────────────────────────────

    function _buildGrid() {
        var grid = document.createElement('div');
        grid.id        = 'segment-grid';
        grid.className = 'segment-grid';
        for (var seg = 1; seg <= 20; seg++) {
            var btn = document.createElement('button');
            btn.className       = 'seg-btn';
            btn.dataset.segment = seg;
            btn.type            = 'button';
            btn.textContent     = seg;
            (function (s) {
                btn.addEventListener('click', function () { _onThrow(s, _state.multiplier); });
            })(seg);
            grid.appendChild(btn);
        }
        return grid;
    }

    function _buildBullRow() {
        var row = document.createElement('div');
        row.id        = 'bull-row';
        row.className = 'bull-row';

        var miss = document.createElement('button');
        miss.className = 'seg-btn bull-btn'; miss.type = 'button'; miss.textContent = 'MISS';
        miss.addEventListener('click', function () { _onThrow(0, 0); });

        var outer = document.createElement('button');
        outer.className = 'seg-btn bull-btn'; outer.type = 'button'; outer.textContent = 'OUTER';
        outer.addEventListener('click', function () { _onThrow(25, 1); });

        var bull = document.createElement('button');
        bull.className = 'seg-btn bull-btn bull-btn-inner'; bull.type = 'button'; bull.textContent = 'BULL';
        bull.addEventListener('click', function () { _onThrow(25, 2); });

        row.appendChild(miss); row.appendChild(outer); row.appendChild(bull);
        return row;
    }

    function _applyHighlights() {
        var ri = _roundInfo();
        document.querySelectorAll('#bm-seg-board .seg-btn[data-segment]').forEach(function (btn) {
            var seg = parseInt(btn.dataset.segment);
            btn.classList.remove('target-highlight', 'bm-double-highlight', 'bm-triple-highlight');
            if (ri.type === 'number' && seg === ri.value) {
                btn.classList.add('target-highlight');
            } else if (ri.value === 'any_double') {
                btn.classList.add('bm-double-highlight');
            } else if (ri.value === 'any_triple') {
                btn.classList.add('bm-triple-highlight');
            }
        });
        // Bull buttons
        ['#bm-seg-board .bull-btn'].forEach(function (sel) {
            document.querySelectorAll(sel).forEach(function (btn) {
                btn.classList.remove('target-highlight');
                if (ri.value === 'single_bull' && btn.textContent === 'OUTER') {
                    btn.classList.add('target-highlight');
                } else if (ri.value === 'double_bull' && btn.textContent === 'BULL') {
                    btn.classList.add('target-highlight');
                }
            });
        });
    }

    function _lockBoard(locked) {
        var board = document.getElementById('bm-seg-board');
        if (board) board.querySelectorAll('.seg-btn').forEach(function (b) { b.disabled = locked; });
        var tabs = document.getElementById('bm-tabs');
        if (tabs) tabs.querySelectorAll('.tab-btn').forEach(function (b) { b.disabled = locked; });
    }

    // ── Throw handling ────────────────────────────────────────────────────────

    function _onThrow(segment, multiplier) {
        if (_state.setComplete || _state.status !== 'active') return;
        if (_pendingThrows.length >= 3) return;

        var pts = _scoreDart(segment, multiplier, _state.currentRound);

        _pendingThrows.push({ segment: segment, multiplier: multiplier, points: pts });
        _throwHistory.push({ segment: segment, multiplier: multiplier, points: pts });

        if (typeof SOUNDS !== 'undefined' && SOUNDS.isEnabled() && pts > 0) SOUNDS.dart();

        _addPill(segment, multiplier, pts);
        _speakDart(segment, multiplier, pts);
        _updateTurnSub();

        var ub = document.getElementById('bm-undo-btn');
        if (ub) ub.disabled = false;

        if (_pendingThrows.length >= 3) {
            _state.setComplete = true;
            _lockBoard(true);
            var nb = document.getElementById('bm-next-btn');
            if (nb) nb.disabled = false;
            // Speak turn total after brief pause
            _speakTurnTotal();
        }
    }

    // ── Next ──────────────────────────────────────────────────────────────────

    function _onNext() {
        UI.setLoading(true);
        var throws  = _pendingThrows.slice();
        var roundNum = _state.currentRound;

        var submitPromise = throws.length > 0
            ? API.bermudaThrow(_state.matchId, { throws: throws, round_number: roundNum })
            : Promise.resolve(null);

        submitPromise
            .then(function () {
                return API.bermudaNext(_state.matchId);
            })
            .then(function (s) {
                var events = s.events || [];
                _applyState(s);
                UI.setLoading(false);
                _clearTurn();
                _updateBoard();
                _updateStatus();

                var roundStrip = document.getElementById('bm-round-strip');
                if (roundStrip) _renderRoundStrip(roundStrip);
                _applyHighlights();

                // Process events — speech chain then next player announce
                var halvedEv = events.find(function (e) { return e.type === 'halved'; });
                var scoredEv = events.find(function (e) { return e.type === 'scored'; });
                var overEv   = events.find(function (e) { return e.type === 'game_over'; });

                if (overEv) {
                    _state.winnerIds = overEv.winners || [];
                    var delay = 400;
                    if (halvedEv) {
                        delay = _speakHalved(halvedEv, true);
                    }
                    setTimeout(function () { _showResult(overEv); }, delay);
                    return;
                }

                if (halvedEv) {
                    var nextDelay = _speakHalved(halvedEv, false);
                    setTimeout(function () { _announceRoundAndPlayer(false); }, nextDelay);
                } else {
                    _announceRoundAndPlayer(false);
                }
            })
            .catch(function (err) {
                UI.setLoading(false);
                console.error('[bermuda] next error:', err);
            });
    }

    function _clearTurn() {
        _pendingThrows  = [];
        _throwHistory   = [];
        _state.setComplete = false;

        var pills = document.getElementById('bm-pills');
        if (pills) pills.innerHTML = '';
        var nb = document.getElementById('bm-next-btn');
        if (nb) nb.disabled = true;
        var ub = document.getElementById('bm-undo-btn');
        if (ub) ub.disabled = true;
        _lockBoard(false);

        // Reset multiplier to Single
        _state.multiplier = 1;
        var tabs = document.getElementById('bm-tabs');
        if (tabs) {
            tabs.querySelectorAll('.tab-btn').forEach(function (b) {
                b.classList.remove('active-single', 'active-double', 'active-treble');
            });
            var s1 = tabs.querySelector('[data-multiplier="1"]');
            if (s1) s1.classList.add('active-single');
        }
        document.body.dataset.multiplier = 1;

        // Clear turn sub for all players
        _state.players.forEach(function (p) {
            var subEl = document.getElementById('bm-sub-' + p.id);
            if (subEl) { subEl.textContent = ''; subEl.className = 'bm-player-sub'; }
        });
    }

    // ── Undo ──────────────────────────────────────────────────────────────────

    function _onUndo() {
        if (_throwHistory.length === 0) return;

        _throwHistory.pop();
        _pendingThrows.pop();

        if (_state.setComplete) {
            _state.setComplete = false;
            _lockBoard(false);
            var nb = document.getElementById('bm-next-btn');
            if (nb) nb.disabled = true;
        }

        var pills = document.getElementById('bm-pills');
        if (pills && pills.lastChild) pills.removeChild(pills.lastChild);

        var ub = document.getElementById('bm-undo-btn');
        if (ub) ub.disabled = (_throwHistory.length === 0);

        _updateTurnSub();
    }

    // ── End ───────────────────────────────────────────────────────────────────

    function _onEnd() {
        UI.showConfirmModal({
            title:    'END GAME?',
            message:  'Abandon this Bermuda Triangle match?',
            onConfirm: function () {
                UI.setLoading(true);
                API.endBermudaMatch(_state.matchId)
                    .then(function () { UI.setLoading(false); if (_state.onEnd) _state.onEnd(); })
                    .catch(function () { UI.setLoading(false); if (_state.onEnd) _state.onEnd(); });
            }
        });
    }

    // ── Result screen ─────────────────────────────────────────────────────────

    function _showResult(overEv) {
        var winnerIds = _state.winnerIds.length ? _state.winnerIds : [_state.winnerId];
        var isTie     = winnerIds.length > 1;
        var winNames  = winnerIds.map(function (id) {
            var p = _playerById(id);
            return p ? p.name.toUpperCase() : '';
        }).filter(Boolean);

        var app = document.getElementById('app');
        app.innerHTML = '';
        document.body.className = 'mode-setup';

        var inner = document.createElement('div');
        inner.className = 'setup-screen-inner';
        app.appendChild(inner);

        var titleText = isTie
            ? '🤝 TIE! ' + winNames.join(' & ')
            : '🏆 ' + winNames[0] + ' WINS!';

        inner.innerHTML =
            '<div id="setup-title">' +
            '<div class="setup-logo">' + _esc(titleText) + '</div>' +
            '<div class="setup-subtitle">BERMUDA TRIANGLE · 13 ROUNDS</div>' +
            '</div>';

        // Standings table
        var table = document.createElement('div');
        table.className = 'bm-result-table';

        var head = document.createElement('div');
        head.className = 'bm-result-row bm-result-head';
        head.innerHTML =
            '<span class="bm-result-name">PLAYER</span>' +
            '<span class="bm-result-score">SCORE</span>';
        table.appendChild(head);

        var sorted = _state.players.slice().sort(function (a, b) { return b.score - a.score; });
        sorted.forEach(function (p) {
            var isWinner = winnerIds.indexOf(p.id) !== -1 ||
                           winnerIds.indexOf(String(p.id)) !== -1;
            var row = document.createElement('div');
            row.className = 'bm-result-row' + (isWinner ? ' bm-result-winner' : '');
            row.innerHTML =
                '<span class="bm-result-name">' + _esc(p.name.toUpperCase()) +
                (isWinner ? (isTie ? ' 🤝' : ' 🏆') : '') + '</span>' +
                '<span class="bm-result-score">' + p.score + '</span>';
            table.appendChild(row);
        });
        inner.appendChild(table);

        var doneBtn = document.createElement('button');
        doneBtn.className = 'start-btn'; doneBtn.type = 'button'; doneBtn.textContent = 'BACK TO HOME';
        doneBtn.addEventListener('click', function () { if (_state.onEnd) _state.onEnd(); });
        inner.appendChild(doneBtn);

        _speakWinner(winNames, isTie);
    }

    // ── Pills ─────────────────────────────────────────────────────────────────

    function _addPill(segment, multiplier, points) {
        var pills = document.getElementById('bm-pills');
        if (!pills) return;
        var mulStr = multiplier === 3 ? 'T' : multiplier === 2 ? 'D' : segment === 0 ? '' : 'S';
        var segStr = segment === 0  ? 'MISS' :
                     segment === 25 ? (multiplier === 2 ? 'BULL' : 'OUTER') :
                     mulStr + segment;
        var pill = document.createElement('div');
        pill.className   = 'dart-pill' + (points > 0 ? ' pill-hot' : ' pill-miss');
        pill.textContent = points > 0 ? segStr + ' +' + points : segStr;
        pills.appendChild(pill);
    }

    // ── Speech ────────────────────────────────────────────────────────────────

    function _speak(text, delay) {
        if (!SPEECH.isEnabled()) return;
        setTimeout(function () {
            window.speechSynthesis && window.speechSynthesis.cancel();
            window.speechSynthesis && window.speechSynthesis.speak(
                Object.assign(new SpeechSynthesisUtterance(text), { rate: 1.0, pitch: 1.0 })
            );
        }, delay || 0);
    }

    function _announceRoundAndPlayer(isFirst) {
        if (!SPEECH.isEnabled()) return;
        var ri   = _roundInfo();
        var p    = _currentPlayer();
        if (!p) return;
        var msg  = 'The current target is ' + ri.label + '. ' + p.name + "'s turn to throw.";
        _speak(msg, isFirst ? 700 : 500);
    }

    function _speakDart(segment, multiplier, points) {
        if (!SPEECH.isEnabled()) return;
        var mulLabel = multiplier === 3 ? 'Treble' : multiplier === 2 ? 'Double' : '';
        var segLabel = segment === 0  ? 'Miss' :
                       segment === 25 ? (multiplier === 2 ? 'Bulls Eye' : 'Outer bull') :
                       (mulLabel ? mulLabel + ' ' + segment : String(segment));
        window.speechSynthesis && window.speechSynthesis.cancel();
        window.speechSynthesis && window.speechSynthesis.speak(
            Object.assign(new SpeechSynthesisUtterance(segLabel), { rate: 1.0, pitch: 1.0 })
        );
    }

    function _speakTurnTotal() {
        if (!SPEECH.isEnabled()) return;
        var total = _turnTotal();
        if (total === 0) return;  // halved/miss handled in _onNext after server confirms
        var msg = total + ' points this turn.';
        setTimeout(function () {
            window.speechSynthesis && window.speechSynthesis.cancel();
            window.speechSynthesis && window.speechSynthesis.speak(
                Object.assign(new SpeechSynthesisUtterance(msg), { rate: 1.0, pitch: 1.0 })
            );
        }, 600);
    }

    // Announce halved score; returns ms delay to wait before chaining next speech
    function _speakHalved(ev, isFinal) {
        if (!SPEECH.isEnabled()) return 400;
        var p   = _playerById(ev.player_id);
        var msg = (p ? p.name : '') + ', your total score is halved. It is now ' + ev.new_score + '.';
        setTimeout(function () {
            window.speechSynthesis && window.speechSynthesis.cancel();
            window.speechSynthesis && window.speechSynthesis.speak(
                Object.assign(new SpeechSynthesisUtterance(msg), { rate: 1.0, pitch: 1.0 })
            );
        }, 400);
        return 600 + msg.length * 80;
    }

    function _speakWinner(winNames, isTie) {
        if (!SPEECH.isEnabled()) return;
        var msg = isTie
            ? "It's a tie between " + winNames.join(' and ') + '!'
            : winNames[0] + ' wins! Well played.';
        _speak(msg, 1000);
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    function _esc(str) {
        return String(str)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    return { start: start };

})();