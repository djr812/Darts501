/**
 * app.js
 * ------
 * Main game controller.
 *
 * CPU turns are triggered automatically whenever currentPlayer().isCpu is true.
 * The CPU module handles strategy/variance; this module calls the exact same
 * _recordDart() path a human tap uses, so all server logic is identical.
 */

(() => {

    const state = {
        matchId:          null,
        legId:            null,
        gameType:         '501',
        doubleOut:        true,
        setsToWin:        1,
        legsPerSet:       1,
        startingScore:    501,
        players:          [],   // [{ id, name, score, isCpu }]
        currentIndex:     0,
        activeMultiplier: 1,
        activeTurnId:     null,
        dartsThisTurn:    0,
        turnScoreBefore:  null,
        turnComplete:     false,
        legOver:          false,
        cpuTurnRunning:   false,
        cpuDifficulty:    'medium',   // 'easy' | 'medium' | 'hard'
        setsScore:        {},
        legsScore:        {},
    };

    // ------------------------------------------------------------------
    // Setup
    // ------------------------------------------------------------------

    async function resolvePlayers(selections) {
        const players = [];
        for (const sel of selections) {
            if (sel.isCpu) {
                // Reuse existing CPU player record if present, otherwise create
                const all = await API.getPlayers().catch(() => []);
                const existing = all.find(p => p.name === 'CPU');
                state.cpuDifficulty = sel.difficulty || 'medium';
                if (existing) {
                    players.push({ id: existing.id, name: 'CPU', score: state.startingScore, isCpu: true });
                } else {
                    const created = await API.createPlayer('CPU');
                    players.push({ id: created.id, name: 'CPU', score: state.startingScore, isCpu: true });
                }
            } else if (sel.mode === 'existing') {
                players.push({ id: sel.id, name: sel.name, score: state.startingScore, isCpu: false });
            } else {
                const created = await API.createPlayer(sel.name);
                players.push({ id: created.id, name: created.name, score: state.startingScore, isCpu: false });
            }
        }
        return players;
    }

    async function onStartGame(config) {
        UI.setLoading(true);
        const SCORES = { '501': 501, '201': 201, 'Cricket': 0 };
        state.startingScore = SCORES[config.gameType] || 501;
        state.gameType      = config.gameType;
        state.doubleOut     = config.doubleOut;
        state.setsToWin     = config.setsToWin;
        state.legsPerSet    = config.legsPerSet;

        try {
            const players = await resolvePlayers(config.players);

            const match = await API.startMatch({
                player_ids:   players.map(p => p.id),
                sets_to_win:  config.setsToWin,
                legs_per_set: config.legsPerSet,
            });
            const leg = await API.startLeg({
                match_id:   match.id,
                game_type:  config.gameType,
                double_out: config.doubleOut,
            });

            state.setsScore = {};
            state.legsScore = {};
            players.forEach(p => { state.setsScore[p.id] = 0; state.legsScore[p.id] = 0; });

            state.matchId = match.id;
            state.legId   = leg.id;
            state.players = players;

            UI.buildShell(players, { onMultiplier, onSegment, onUndo, onNextPlayer });
            _startLeg(leg.id);

        } catch (err) {
            UI.showToast(err.message.toUpperCase(), 'bust', 4000);
            console.error('[app] Setup error:', err);
        } finally {
            UI.setLoading(false);
        }
    }

    // ------------------------------------------------------------------
    // Leg lifecycle
    // ------------------------------------------------------------------

    function _startLeg(legId) {
        state.legId            = legId;
        state.currentIndex     = 0;
        state.activeMultiplier = 1;
        state.activeTurnId     = null;
        state.dartsThisTurn    = 0;
        state.turnScoreBefore  = null;
        state.turnComplete     = false;
        state.legOver          = false;
        state.cpuTurnRunning   = false;

        state.players.forEach(p => {
            p.score = state.startingScore;
            UI.setScore(p.id, p.score);
            UI.clearDartPills(p.id);
            UI.setCheckoutHint(p.id, null);
            UI.updatePlayerSetLegs(p.id, state.setsScore[p.id] || 0, state.legsScore[p.id] || 0);
        });

        UI.setActivePlayer(currentPlayer().id);
        UI.setMultiplierTab(1);
        UI.setNextPlayerEnabled(false);
        UI.setUndoEnabled(true);
        _updateMatchInfo();
        _beginTurn();
    }

    /** Called at the start of every turn (human or CPU). */
    function _beginTurn() {
        const player = currentPlayer();
        UI.setActivePlayer(player.id);
        if (player.isCpu) {
            UI.setStatus('CPU IS THINKING...');
            UI.setUndoEnabled(false);
            setTimeout(_runCpuTurn, 400);
        } else {
            UI.setStatus(`${player.name.toUpperCase()}'S TURN — SELECT MULTIPLIER`);
            UI.setUndoEnabled(true);
        }
    }

    function _updateMatchInfo() {
        const rule = state.doubleOut ? 'DOUBLE OUT' : 'SINGLE OUT';
        UI.setMatchInfo(`${state.gameType} · ${rule} · MATCH ${state.matchId}`);
    }

    // ------------------------------------------------------------------
    // Core dart recording — shared by human and CPU paths
    // ------------------------------------------------------------------

    /**
     * Record a single dart via the API and update state + UI.
     * Returns the raw server response (ThrowResult + optional leg info).
     */
    async function _recordDart(segment, multiplier) {
        const player = currentPlayer();

        const result = await API.recordThrow({
            leg_id:       state.legId,
            player_id:    player.id,
            segment,
            multiplier,
            score_before: player.score,
        });

        // Capture turn metadata on first dart
        if (state.dartsThisTurn === 0) {
            state.activeTurnId    = result.turn_id;
            state.turnScoreBefore = result.score_before;
        }
        state.dartsThisTurn++;

        // Update UI
        UI.addDartPill(player.id, result.points, multiplier, segment);

        if (result.is_bust) {
            player.score = state.turnScoreBefore;
            UI.setScore(player.id, player.score);
            UI.flashCard(player.id, 'bust');

        } else if (result.is_checkout) {
            player.score = 0;
            UI.setScore(player.id, 0);
            UI.flashCard(player.id, 'checkout');

        } else {
            player.score = result.score_after;
            UI.setScore(player.id, player.score);
            if (result.checkout_suggestion) {
                UI.setCheckoutHint(player.id, result.checkout_suggestion);
            }
        }

        return result;
    }

    // ------------------------------------------------------------------
    // CPU turn
    // ------------------------------------------------------------------

    function _runCpuTurn() {
        if (state.cpuTurnRunning || state.legOver) return;
        state.cpuTurnRunning = true;

        const cpuPlayer  = currentPlayer();
        const suggestions = []; // populated from server responses as darts land

        CPU.playTurn(
            cpuPlayer,
            { legId: state.legId, doubleOut: state.doubleOut, difficulty: state.cpuDifficulty },
            suggestions,
            // onDart — CPU calls this for each throw
            async (segment, multiplier, currentScore) => {
                const result = await _recordDart(segment, multiplier);

                // Feed server's checkout suggestion back into the suggestions array
                // so CPU.playTurn can use it for subsequent darts
                if (result.checkout_suggestion && Array.isArray(result.checkout_suggestion)) {
                    const dartIdx = state.dartsThisTurn; // already incremented
                    result.checkout_suggestion.forEach((s, i) => {
                        suggestions[dartIdx + i] = s;
                    });
                }

                // Status update during CPU turn
                if (!result.is_bust && !result.is_checkout && !result.turn_complete) {
                    const dartsLeft = 3 - state.dartsThisTurn;
                    UI.setStatus(`CPU — ${cpuPlayer.score} REMAINING — ${dartsLeft} DART${dartsLeft !== 1 ? 'S' : ''} LEFT`);
                }

                return result;
            },
            // onTurnEnd — called after all darts thrown
            (lastResult) => {
                state.cpuTurnRunning = false;

                if (lastResult && lastResult.is_checkout) {
                    // CPU won the leg
                    state.legOver      = true;
                    state.turnComplete = true;
                    UI.setStatus('CPU CHECKED OUT!', 'success');
                    UI.showToast('CPU WINS THE LEG!', 'bust', 2500);
                    setTimeout(() => _handleLegWin(lastResult, cpuPlayer), 900);

                } else if (lastResult && lastResult.is_bust) {
                    UI.showToast('CPU BUST!', 'bust', 1800);
                    UI.setStatus('CPU BUST!', 'bust');
                    state.turnComplete = true;
                    // Auto-advance after pause so human can see the bust
                    setTimeout(_advancePlayer, 1400);

                } else {
                    // Used 3 darts normally
                    state.turnComplete = true;
                    setTimeout(_advancePlayer, 1000);
                }
            }
        );
    }

    // ------------------------------------------------------------------
    // Player rotation
    // ------------------------------------------------------------------

    function _advancePlayer() {
        if (state.legOver) return;

        const oldPlayer = currentPlayer();
        UI.clearDartPills(oldPlayer.id);

        state.currentIndex     = (state.currentIndex + 1) % state.players.length;
        state.dartsThisTurn    = 0;
        state.turnComplete     = false;
        state.activeTurnId     = null;
        state.turnScoreBefore  = null;
        state.activeMultiplier = 1;

        UI.setMultiplierTab(1);
        UI.setNextPlayerEnabled(false);
        _beginTurn();
    }

    // ------------------------------------------------------------------
    // Leg / set / match resolution
    // ------------------------------------------------------------------

    function _handleLegWin(result, winnerPlayer) {
        if (result.sets_score) {
            Object.keys(result.sets_score).forEach(function(pid) {
                state.setsScore[parseInt(pid)] = result.sets_score[pid];
            });
        }
        if (result.legs_score) {
            Object.keys(result.legs_score).forEach(function(pid) {
                state.legsScore[parseInt(pid)] = result.legs_score[pid];
            });
        }

        if (result.match_complete) {
            UI.showCongratsModal(
                winnerPlayer.name,
                state.players,
                result.sets_score || {},
                _returnToSetup
            );
        } else {
            const setWinnerName = result.set_winner_id
                ? (function(){ var pw = state.players.find(function(p){ return p.id === result.set_winner_id; }); return pw ? pw.name : ''; }())
                : null;

            UI.showLegEndModal(
                {
                    legWinnerName: winnerPlayer.name,
                    setComplete:   result.set_complete || false,
                    setWinnerName,
                    setsScore:     result.sets_score || {},
                    legsScore:     result.legs_score || {},
                    legsPerSet:    state.legsPerSet,
                },
                state.players,
                () => _startLeg(result.next_leg_id)
            );
        }
    }

    async function _returnToSetup() {
        const existing = await API.getPlayers().catch(() => []);
        UI.buildSetupScreen(existing, onStartGame, _onViewStats);
    }

    // ------------------------------------------------------------------
    // Human input handlers
    // ------------------------------------------------------------------

    function onMultiplier(multiplier) {
        if (state.turnComplete || state.legOver || currentPlayer().isCpu) return;
        state.activeMultiplier = multiplier;
        UI.setMultiplierTab(multiplier);
        UI.setStatus(`${_multiplierLabel(multiplier)} — SELECT SEGMENT`);
    }

    async function onSegment(segment, forcedMultiplier = null) {
        if (state.legOver || state.cpuTurnRunning) {
            UI.showToast('CPU IS THROWING...', 'info'); return;
        }
        if (state.turnComplete) {
            UI.showToast('TAP NEXT ▶ TO CONTINUE', 'info'); return;
        }
        if (currentPlayer().isCpu) return;

        const multiplier = forcedMultiplier !== null ? forcedMultiplier : state.activeMultiplier;

        UI.setLoading(true);
        try {
            const result = await _recordDart(segment, multiplier);

            if (result.is_bust) {
                UI.showToast('BUST!', 'bust', 2500);
                UI.setStatus('BUST — TAP NEXT ▶', 'bust');
                state.turnComplete = true;
                UI.setNextPlayerEnabled(true);

            } else if (result.is_checkout) {
                state.legOver      = true;
                state.turnComplete = true;
                UI.setNextPlayerEnabled(false);
                UI.setStatus(`${currentPlayer().name.toUpperCase()} CHECKED OUT!`, 'success');
                setTimeout(() => _handleLegWin(result, currentPlayer()), 800);

            } else if (result.turn_complete) {
                UI.setStatus('END OF TURN — TAP NEXT ▶');
                state.turnComplete = true;
                UI.setNextPlayerEnabled(true);
                if (result.checkout_suggestion) UI.setCheckoutHint(currentPlayer().id, result.checkout_suggestion);

            } else {
                const dartsLeft = 3 - state.dartsThisTurn;
                UI.setStatus(`${currentPlayer().score} REMAINING — ${dartsLeft} DART${dartsLeft !== 1 ? 'S' : ''} LEFT`);
                if (result.checkout_suggestion) {
                    UI.showToast(result.checkout_suggestion.join(' → '), 'info', 3000);
                }
            }

        } catch (err) {
            UI.showToast(`ERROR: ${err.message}`, 'bust', 3000);
            UI.setStatus('ERROR — TRY AGAIN', 'bust');
            console.error('[app] Throw error:', err);
        } finally {
            UI.setLoading(false);
        }
    }

    async function onUndo() {
        if (currentPlayer().isCpu || state.cpuTurnRunning) return;
        if (!state.activeTurnId || state.dartsThisTurn === 0) {
            UI.showToast('NOTHING TO UNDO', 'info'); return;
        }
        UI.setLoading(true);
        try {
            const result = await API.undoLastThrow(state.activeTurnId);
            const player = currentPlayer();
            player.score = result.score_reverted_to;
            UI.setScore(player.id, player.score);
            const dartsRow = document.getElementById(`darts-${player.id}`);
            if (dartsRow && dartsRow.lastChild) dartsRow.removeChild(dartsRow.lastChild);
            state.dartsThisTurn--;
            state.turnComplete = false;
            UI.setNextPlayerEnabled(false);
            UI.setCheckoutHint(player.id, null);
            if (state.dartsThisTurn === 0) state.turnScoreBefore = null;
            const dartsLeft = 3 - state.dartsThisTurn;
            UI.setStatus(`UNDONE — ${player.score} REMAINING — ${dartsLeft} DART${dartsLeft !== 1 ? 'S' : ''} LEFT`);
            UI.showToast('DART UNDONE', 'info', 1500);
        } catch (err) {
            UI.showToast(`UNDO FAILED: ${err.message}`, 'bust', 3000);
        } finally {
            UI.setLoading(false);
        }
    }

    function onNextPlayer() {
        if (!state.turnComplete || state.cpuTurnRunning || currentPlayer().isCpu) return;
        _advancePlayer();
    }

    // ------------------------------------------------------------------
    // Helpers
    // ------------------------------------------------------------------

    function currentPlayer()     { return state.players[state.currentIndex]; }
    function _multiplierLabel(m) { return m === 1 ? 'SINGLE' : m === 2 ? 'DOUBLE' : 'TREBLE'; }

    // ------------------------------------------------------------------
    // Stats
    // ------------------------------------------------------------------

    async function _onViewStats() {
        const allPlayers = await API.getPlayers().catch(() => []);
        const humans = allPlayers.filter(p => p.name !== 'CPU');
        if (humans.length === 0) {
            UI.showToast('NO PLAYERS YET — PLAY A MATCH FIRST', 'info', 3000);
            return;
        }
        STATS.showPlayerPicker(humans, (player) => {
            STATS.showStatsScreen(player, async () => {
                // Back button → return to setup screen
                const existing = await API.getPlayers().catch(() => []);
                UI.buildSetupScreen(existing, onStartGame, _onViewStats);
            });
        });
    }

    // ------------------------------------------------------------------
    // Init
    // ------------------------------------------------------------------

    async function init() {
        const existing = await API.getPlayers().catch(() => []);
        UI.buildSetupScreen(existing, onStartGame, _onViewStats);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();