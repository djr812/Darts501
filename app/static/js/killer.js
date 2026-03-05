/**
 * killer.js
 * ---------
 * Multiplayer Killer darts game controller.
 *
 * Public API:
 *   KILLER_GAME.start(config, onEnd)
 *     config: { players: [{id, name}], variant: 'doubles'|'triples' }
 *     onEnd:  called when game ends or is abandoned
 */

var KILLER_GAME = (function () {

    // ── State ─────────────────────────────────────────────────────────────────
    var _state = {
        matchId:            null,
        gameId:             null,
        variant:            'doubles',
        players:            [],       // [{id, name, assigned_number, hits, is_killer, lives, eliminated}]
        currentPlayerIndex: 0,
        currentPlayerId:    null,
        status:             'active',
        winnerId:           null,
        onEnd:              null,
        multiplier:         1,
        turnNumber:         1,
        setComplete:        false,    // board locked after 3rd dart
    };

    var _pendingThrows = [];  // buffered for current set
    var _throwHistory  = [];  // for undo (local copy mirrors pending)
    var _pendingEvents = [];  // accumulated events from buffered throws

    // ── Public: start ─────────────────────────────────────────────────────────

    function start(config, onEnd) {
        SPEECH.unlock();
        if (typeof SOUNDS !== 'undefined') SOUNDS.unlock();
        UI.setLoading(true);

        _resolvePlayers(config.players)
            .then(function (players) {
                return API.createKillerMatch({
                    player_ids: players.map(function (p) { return p.id; }),
                    variant:    config.variant || 'doubles',
                });
            })
            .then(function (s) {
                _applyState(s);
                _state.onEnd = onEnd;
                UI.setLoading(false);
                _buildScreen();
                _announceAssignments();
            })
            .catch(function (err) {
                UI.setLoading(false);
                UI.showToast((err && err.message ? err.message : 'Error starting game').toUpperCase(), 'bust', 4000);
                console.error('[killer] start error:', err);
            });
    }

    // ── Player resolution ─────────────────────────────────────────────────────

    function _resolvePlayers(selections) {
        var promises = selections.map(function (sel) {
            if (sel.mode === 'existing') {
                return Promise.resolve({ id: sel.id, name: sel.name });
            }
            return API.createPlayer(sel.name).then(function (p) { return { id: p.id, name: p.name }; });
        });
        return Promise.all(promises);
    }

    // ── State ─────────────────────────────────────────────────────────────────

    function _applyState(s) {
        _state.matchId            = s.match_id;
        _state.gameId             = s.game_id;
        _state.variant            = s.variant || 'doubles';
        _state.players            = s.players || [];
        _state.currentPlayerIndex = s.current_player_index;
        _state.currentPlayerId    = s.current_player_id ? String(s.current_player_id) : null;
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

    // ── Screen build ──────────────────────────────────────────────────────────

    function _buildScreen() {
        ['confirm-modal', 'rules-modal'].forEach(function (id) {
            var el = document.getElementById(id);
            if (el) el.remove();
        });

        var app = document.getElementById('app');
        app.innerHTML = '';
        app.style.cssText = '';
        document.body.className = 'mode-killer';

        // ── Header ────────────────────────────────────────────────────────────
        var header = document.createElement('div');
        header.className = 'game-header';

        var leftSlot = document.createElement('div');
        leftSlot.className = 'gh-left';
        var titleWrap = document.createElement('div');
        titleWrap.className = 'gh-title-wrap';
        var titleEl = document.createElement('div');
        titleEl.className = 'gh-game-name';
        titleEl.textContent = 'KILLER';
        var subEl = document.createElement('div');
        subEl.className = 'gh-match-info';
        subEl.textContent = _state.players.length + ' PLAYERS · ' + _state.variant.toUpperCase();
        titleWrap.appendChild(titleEl);
        titleWrap.appendChild(subEl);
        leftSlot.appendChild(titleWrap);
        var rulesBtn = document.createElement('button');
        rulesBtn.type = 'button';
        rulesBtn.className = 'rules-btn';
        rulesBtn.textContent = '📖 RULES';
        rulesBtn.addEventListener('click', function () { UI.showRulesModal('killer'); });
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
        undoBtn.id = 'killer-undo-btn';
        undoBtn.className = 'gh-btn gh-btn-undo';
        undoBtn.type = 'button';
        undoBtn.textContent = '⟵ UNDO';
        undoBtn.disabled = true;
        undoBtn.addEventListener('click', _onUndo);
        var nextBtn = document.createElement('button');
        nextBtn.id = 'killer-next-btn';
        nextBtn.className = 'gh-btn gh-btn-next';
        nextBtn.type = 'button';
        nextBtn.textContent = 'NEXT ▶';
        nextBtn.disabled = true;
        nextBtn.addEventListener('click', _onNext);
        rightSlot.appendChild(undoBtn);
        rightSlot.appendChild(nextBtn);
        header.appendChild(rightSlot);
        app.appendChild(header);

        // ── Scoreboard ────────────────────────────────────────────────────────
        var board = document.createElement('div');
        board.id = 'killer-board';
        board.className = 'killer-board';
        app.appendChild(board);
        _renderBoard(board);

        // ── Status ────────────────────────────────────────────────────────────
        var statusEl = document.createElement('div');
        statusEl.id = 'killer-status';
        statusEl.className = 'killer-status';
        app.appendChild(statusEl);
        _updateStatus();

        // ── Dart pills ────────────────────────────────────────────────────────
        var pills = document.createElement('div');
        pills.id = 'killer-pills';
        pills.className = 'practice-pills';
        app.appendChild(pills);

        // ── Multiplier tabs ───────────────────────────────────────────────────
        _state.multiplier = 1;
        var tabs = document.createElement('div');
        tabs.id = 'killer-tabs';
        tabs.className = 'killer-tabs';
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

        // ── Segment grid ──────────────────────────────────────────────────────
        var segBoard = document.createElement('main');
        segBoard.id = 'killer-seg-board';
        app.appendChild(segBoard);
        segBoard.appendChild(_buildGrid());
        segBoard.appendChild(_buildBullRow());

        _applyHighlights();
    }

    // ── Scoreboard ────────────────────────────────────────────────────────────

    function _renderBoard(container) {
        container.innerHTML = '';
        _state.players.forEach(function (p) {
            var row = document.createElement('div');
            row.id = 'killer-row-' + p.id;
            row.className = 'killer-player-row' +
                (String(p.id) === String(_state.currentPlayerId) ? ' killer-active' : '') +
                (p.eliminated ? ' killer-eliminated' : '');

            // Name + number
            var nameEl = document.createElement('div');
            nameEl.className = 'killer-player-name';
            nameEl.textContent = p.name.toUpperCase();
            var numEl = document.createElement('div');
            numEl.className = 'killer-player-number';
            numEl.textContent = p.assigned_number;
            var nameWrap = document.createElement('div');
            nameWrap.className = 'killer-name-wrap';
            nameWrap.appendChild(nameEl);
            nameWrap.appendChild(numEl);
            row.appendChild(nameWrap);

            // Hits progress (toward killer status) or K badge
            var hitsEl = document.createElement('div');
            hitsEl.id = 'killer-hits-' + p.id;
            hitsEl.className = 'killer-hits';
            _renderHits(hitsEl, p);
            row.appendChild(hitsEl);

            // Lives pips
            var livesEl = document.createElement('div');
            livesEl.id = 'killer-lives-' + p.id;
            livesEl.className = 'killer-lives';
            _renderLives(livesEl, p);
            row.appendChild(livesEl);

            container.appendChild(row);
        });
    }

    function _renderHits(container, p) {
        container.innerHTML = '';
        if (p.is_killer) {
            var badge = document.createElement('span');
            badge.className = 'killer-badge';
            badge.textContent = 'K';
            container.appendChild(badge);
        } else {
            for (var i = 0; i < 3; i++) {
                var pip = document.createElement('span');
                pip.className = 'killer-hit-pip' + (i < p.hits ? ' killer-hit-pip-on' : '');
                container.appendChild(pip);
            }
        }
    }

    function _renderLives(container, p) {
        container.innerHTML = '';
        for (var i = 0; i < 3; i++) {
            var pip = document.createElement('span');
            pip.className = 'killer-life-pip' + (i < p.lives ? ' killer-life-pip-on' : '');
            container.appendChild(pip);
        }
    }

    function _updateBoard() {
        _state.players.forEach(function (p) {
            var row = document.getElementById('killer-row-' + p.id);
            if (row) {
                row.className = 'killer-player-row' +
                    (String(p.id) === String(_state.currentPlayerId) ? ' killer-active' : '') +
                    (p.eliminated ? ' killer-eliminated' : '');
            }
            var hitsEl = document.getElementById('killer-hits-' + p.id);
            if (hitsEl) _renderHits(hitsEl, p);
            var livesEl = document.getElementById('killer-lives-' + p.id);
            if (livesEl) _renderLives(livesEl, p);
        });
    }

    function _updateStatus() {
        var el = document.getElementById('killer-status');
        if (!el) return;
        var p = _currentPlayer();
        if (!p) return;
        var targetStr = _state.variant === 'doubles' ? 'D' : 'T';
        if (p.is_killer) {
            el.textContent = p.name.toUpperCase() + '  ·  KILLER  ·  AIM FOR OPPONENT ' + targetStr + 's';
        } else {
            var needed = 3 - p.hits;
            el.textContent = p.name.toUpperCase() + '  ·  HIT ' + targetStr + p.assigned_number +
                '  ·  ' + needed + ' HIT' + (needed === 1 ? '' : 'S') + ' TO BECOME KILLER';
        }
    }

    // ── Segment grid ──────────────────────────────────────────────────────────

    function _buildGrid() {
        var grid = document.createElement('div');
        grid.id = 'segment-grid';
        grid.className = 'segment-grid';
        for (var seg = 1; seg <= 20; seg++) {
            var btn = document.createElement('button');
            btn.className = 'seg-btn';
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
        var p = _currentPlayer();
        if (!p) return;
        var targetSeg = p.is_killer ? null : p.assigned_number;
        // Highlight assigned numbers of all active (non-eliminated) players
        var activeSets = {};
        _state.players.forEach(function (pl) {
            if (!pl.eliminated) activeSets[pl.assigned_number] = true;
        });

        document.querySelectorAll('#killer-seg-board .seg-btn[data-segment]').forEach(function (btn) {
            var seg = parseInt(btn.dataset.segment);
            btn.classList.remove('target-highlight', 'killer-assigned-highlight');
            if (seg === targetSeg) {
                btn.classList.add('target-highlight');
            } else if (activeSets[seg]) {
                btn.classList.add('killer-assigned-highlight');
            }
        });
    }

    function _lockBoard(locked) {
        var board = document.getElementById('killer-seg-board');
        if (board) board.querySelectorAll('.seg-btn').forEach(function (b) { b.disabled = locked; });
        var tabs = document.getElementById('killer-tabs');
        if (tabs) tabs.querySelectorAll('.tab-btn').forEach(function (b) { b.disabled = locked; });
    }

    // ── Throw handling ────────────────────────────────────────────────────────

    function _onThrow(segment, multiplier) {
        if (_state.setComplete || _state.status !== 'active') return;
        if (_pendingThrows.length >= 3) return;

        var p        = _currentPlayer();
        var variant  = _state.variant;
        var targetMul = variant === 'doubles' ? 2 : 3;

        // Derive local effect
        var hitsScored = 0;
        var localEvents = [];

        if (segment !== 0 && multiplier >= targetMul) {
            // Count hits (doubles game: D=1, T=2; triples game: T=1 only effectively)
            var rawHits = multiplier === targetMul ? 1 :
                          multiplier > targetMul ? (multiplier - targetMul + 1) : 0;

            // Find whose number was hit
            var targetPlayer = _state.players.find(function (pl) { return pl.assigned_number === segment; });

            if (targetPlayer) {
                var isSelf = String(targetPlayer.id) === String(_state.currentPlayerId);
                if (!p.is_killer) {
                    if (isSelf) {
                        var prev = p.hits;
                        p.hits = Math.min(p.hits + rawHits, 3);
                        hitsScored = p.hits - prev;
                        if (p.hits >= 3 && !p.is_killer) {
                            p.is_killer = true;
                            localEvents.push({ type: 'killer', player_id: p.id });
                        }
                    }
                } else {
                    if (!targetPlayer.eliminated) {
                        var prevLives = targetPlayer.lives;
                        targetPlayer.lives = Math.max(0, targetPlayer.lives - rawHits);
                        hitsScored = prevLives - targetPlayer.lives;
                        for (var i = 0; i < hitsScored; i++) {
                            localEvents.push({ type: 'life_lost', player_id: targetPlayer.id });
                        }
                        if (targetPlayer.lives <= 0) {
                            targetPlayer.eliminated = true;
                            localEvents.push({ type: 'eliminated', player_id: targetPlayer.id });
                        }
                    }
                }
            }
        }

        _pendingThrows.push({ segment: segment, multiplier: multiplier });
        _throwHistory.push({
            segment:     segment,
            multiplier:  multiplier,
            hitsScored:  hitsScored,
            events:      localEvents,
            // Snapshots for undo
            playerSnaps: _state.players.map(function (pl) {
                return { id: pl.id, hits: pl.hits, is_killer: pl.is_killer,
                         lives: pl.lives, eliminated: pl.eliminated };
            }),
        });
        _pendingEvents = _pendingEvents.concat(localEvents);

        // Sound
        if (typeof SOUNDS !== 'undefined' && SOUNDS.isEnabled()) {
            if (hitsScored > 0) SOUNDS.dart();
        }

        // Pill
        _addPill(segment, multiplier, hitsScored);

        // Per-dart speech
        _speakDart(segment, multiplier, hitsScored, localEvents);

        // Update UI
        _updateBoard();
        _updateStatus();
        _applyHighlights();

        var ub = document.getElementById('killer-undo-btn');
        if (ub) ub.disabled = false;

        // Check for win locally
        var survivors = _state.players.filter(function (pl) { return !pl.eliminated; });
        if (survivors.length === 1) {
            _state.status   = 'complete';
            _state.winnerId = survivors[0].id;
        }

        // After 3 darts — lock board
        if (_pendingThrows.length >= 3 || _state.status === 'complete') {
            _state.setComplete = true;
            _lockBoard(true);
            var nb = document.getElementById('killer-next-btn');
            if (nb) nb.disabled = false;
        }
    }

    // ── Next ──────────────────────────────────────────────────────────────────

    function _onNext() {
        UI.setLoading(true);
        var throwsToSubmit = _pendingThrows.slice();
        var turnNum        = _state.turnNumber;
        var isComplete     = _state.status === 'complete';

        var submitPromise = throwsToSubmit.length > 0
            ? API.killerThrow(_state.matchId, { throws: throwsToSubmit, turn_number: turnNum })
            : Promise.resolve(null);

        submitPromise
            .then(function (s) {
                if (s) _applyState(s);
                if (isComplete || _state.status === 'complete') {
                    UI.setLoading(false);
                    _showResult();
                    return;
                }
                return API.killerNext(_state.matchId);
            })
            .then(function (s) {
                if (!s) return;
                _pendingThrows  = [];
                _throwHistory   = [];
                _pendingEvents  = [];
                _state.setComplete = false;
                _state.turnNumber++;
                _applyState(s);
                UI.setLoading(false);

                _resetUI();
                _updateBoard();
                _updateStatus();
                _applyHighlights();
                _announceCurrentPlayer();
            })
            .catch(function (err) {
                UI.setLoading(false);
                UI.showToast('ERROR', 'bust', 3000);
                console.error('[killer] next error:', err);
            });
    }

    function _resetUI() {
        var pills = document.getElementById('killer-pills');
        if (pills) pills.innerHTML = '';
        var nb = document.getElementById('killer-next-btn');
        if (nb) nb.disabled = true;
        var ub = document.getElementById('killer-undo-btn');
        if (ub) ub.disabled = true;
        _lockBoard(false);
        // Reset multiplier to Single
        _state.multiplier = 1;
        var tabs = document.getElementById('killer-tabs');
        if (tabs) {
            tabs.querySelectorAll('.tab-btn').forEach(function (b) {
                b.classList.remove('active-single', 'active-double', 'active-treble');
            });
            var s1 = tabs.querySelector('[data-multiplier="1"]');
            if (s1) s1.classList.add('active-single');
        }
        document.body.dataset.multiplier = 1;
    }

    // ── Undo ──────────────────────────────────────────────────────────────────

    function _onUndo() {
        if (_throwHistory.length === 0) return;

        var snap = _throwHistory.pop();
        _pendingThrows.pop();

        // Restore all player states from snapshot
        snap.playerSnaps.forEach(function (ps) {
            var pl = _state.players.find(function (p) { return String(p.id) === String(ps.id); });
            if (pl) {
                pl.hits        = ps.hits;
                pl.is_killer   = ps.is_killer;
                pl.lives       = ps.lives;
                pl.eliminated  = ps.eliminated;
            }
        });

        // Restore game status if we'd declared a winner locally
        _state.status   = 'active';
        _state.winnerId = null;

        // If board was locked, unlock it
        if (_state.setComplete) {
            _state.setComplete = false;
            _lockBoard(false);
            var nb = document.getElementById('killer-next-btn');
            if (nb) nb.disabled = true;
        }

        var pills = document.getElementById('killer-pills');
        if (pills && pills.lastChild) pills.removeChild(pills.lastChild);

        var ub = document.getElementById('killer-undo-btn');
        if (ub) ub.disabled = (_throwHistory.length === 0);

        _updateBoard();
        _updateStatus();
        _applyHighlights();
    }

    // ── End ───────────────────────────────────────────────────────────────────

    function _onEnd() {
        UI.showConfirmModal({
            title:    'END GAME?',
            message:  'Abandon this Killer match?',
            onConfirm: function () {
                UI.setLoading(true);
                API.endKillerMatch(_state.matchId)
                    .then(function () { UI.setLoading(false); if (_state.onEnd) _state.onEnd(); })
                    .catch(function () { UI.setLoading(false); if (_state.onEnd) _state.onEnd(); });
            }
        });
    }

    // ── Result screen ─────────────────────────────────────────────────────────

    function _showResult() {
        var winner = _playerById(_state.winnerId);
        var winName = winner ? winner.name.toUpperCase() : 'WINNER';

        var app = document.getElementById('app');
        app.innerHTML = '';
        document.body.className = 'mode-setup';

        var inner = document.createElement('div');
        inner.className = 'setup-screen-inner';
        app.appendChild(inner);

        inner.innerHTML =
            '<div id="setup-title">' +
            '<div class="setup-logo">🏆 ' + _esc(winName) + ' WINS!</div>' +
            '<div class="setup-subtitle">KILLER DARTS · ' + _state.variant.toUpperCase() + '</div>' +
            '</div>';

        // Final standings table
        var table = document.createElement('div');
        table.className = 'killer-result-table';

        var headRow = document.createElement('div');
        headRow.className = 'killer-result-row killer-result-head';
        headRow.innerHTML =
            '<span class="killer-result-name">PLAYER</span>' +
            '<span class="killer-result-num">№</span>' +
            '<span class="killer-result-status">STATUS</span>' +
            '<span class="killer-result-lives">LIVES</span>';
        table.appendChild(headRow);

        var sorted = _state.players.slice().sort(function (a, b) {
            if (!a.eliminated && b.eliminated) return -1;
            if (a.eliminated && !b.eliminated) return 1;
            return b.lives - a.lives;
        });

        sorted.forEach(function (p) {
            var isWinner = String(p.id) === String(_state.winnerId);
            var row = document.createElement('div');
            row.className = 'killer-result-row' + (isWinner ? ' killer-result-winner' : '');
            row.innerHTML =
                '<span class="killer-result-name">' + _esc(p.name.toUpperCase()) + '</span>' +
                '<span class="killer-result-num">' + p.assigned_number + '</span>' +
                '<span class="killer-result-status">' +
                    (isWinner ? '🏆 WINNER' : p.is_killer ? '☠️ KILLER' : 'PLAYER') +
                '</span>' +
                '<span class="killer-result-lives">' + p.lives + '</span>';
            table.appendChild(row);
        });
        inner.appendChild(table);

        var doneBtn = document.createElement('button');
        doneBtn.className = 'start-btn';
        doneBtn.type = 'button';
        doneBtn.textContent = 'BACK TO HOME';
        doneBtn.addEventListener('click', function () { if (_state.onEnd) _state.onEnd(); });
        inner.appendChild(doneBtn);

        _speakWinner(winName);
    }

    // ── Pills ─────────────────────────────────────────────────────────────────

    function _addPill(segment, multiplier, hitsScored) {
        var pills = document.getElementById('killer-pills');
        if (!pills) return;
        var mulStr = multiplier === 3 ? 'T' : multiplier === 2 ? 'D' : segment === 0 ? '' : 'S';
        var segStr = segment === 0 ? 'MISS' :
                     segment === 25 ? (multiplier === 2 ? 'BULL' : 'OUTER') :
                     mulStr + segment;
        var pill = document.createElement('div');
        pill.className = 'dart-pill' + (hitsScored > 0 ? '' : ' pill-miss');
        if (hitsScored > 0) pill.className += ' pill-hot';
        pill.textContent = hitsScored > 0
            ? segStr + ' — ' + hitsScored + (hitsScored === 1 ? ' HIT' : ' HITS')
            : segStr + ' — MISS';
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
        }, delay || 200);
    }

    function _announceAssignments() {
        if (!SPEECH.isEnabled()) return;
        var msgs = _state.players.map(function (p) {
            return p.name + ', your number is ' + p.assigned_number + '.';
        });
        // Chain with delays
        msgs.forEach(function (msg, idx) {
            setTimeout(function () {
                window.speechSynthesis && window.speechSynthesis.speak(
                    Object.assign(new SpeechSynthesisUtterance(msg), { rate: 1.0, pitch: 1.0 })
                );
            }, 600 + idx * 2200);
        });
    }

    function _announceCurrentPlayer() {
        var p = _currentPlayer();
        if (!p) return;
        _speak(p.name + '.', 400);
    }

    function _speakDart(segment, multiplier, hitsScored, events) {
        if (!SPEECH.isEnabled()) return;
        var targetMul = _state.variant === 'doubles' ? 2 : 3;
        var mulLabel  = multiplier === 3 ? 'Treble' : multiplier === 2 ? 'Double' : 'Single';
        var segLabel  = segment === 0 ? 'Miss' :
                        segment === 25 ? (multiplier === 2 ? 'Bullseye' : 'Outer bull') :
                        mulLabel + ' ' + segment;

        var parts = [segLabel];

        events.forEach(function (ev) {
            var pl = _playerById(ev.player_id);
            var name = pl ? pl.name : '';
            if (ev.type === 'killer') {
                parts.push(name + ', you are now a killer!');
            } else if (ev.type === 'life_lost') {
                parts.push(name + ' loses a life.');
            } else if (ev.type === 'eliminated') {
                parts.push(name + ' is eliminated!');
            }
        });

        var msg = parts.join(' ');
        setTimeout(function () {
            window.speechSynthesis && window.speechSynthesis.cancel();
            window.speechSynthesis && window.speechSynthesis.speak(
                Object.assign(new SpeechSynthesisUtterance(msg), { rate: 1.0, pitch: 1.0 })
            );
        }, 200);
    }

    function _speakWinner(winName) {
        _speak(winName + ' wins! Well played.', 600);
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    function _esc(str) {
        return String(str)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    return { start: start };

})();