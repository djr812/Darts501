/**
 * app.js
 * ------
 * Main game controller.
 *
 * Flow:
 *   1. Page loads → fetch existing players → show setup screen
 *   2. User selects game type, checkout rule, player count and names
 *   3. onStartGame({ players, gameType, doubleOut }) called
 *   4. Players resolved → match created → leg created with config
 *   5. Game board rendered
 */

(() => {

    // ------------------------------------------------------------------
    // Game state
    // ------------------------------------------------------------------

    const state = {
        matchId:          null,
        legId:            null,
        gameType:         '501',
        doubleOut:        true,
        startingScore:    501,
        players:          [],
        currentIndex:     0,
        activeMultiplier: 1,
        activeTurnId:     null,
        dartsThisTurn:    0,
        turnScoreBefore:  null,
        turnComplete:     false,
        legOver:          false,
    };

    // ------------------------------------------------------------------
    // Setup
    // ------------------------------------------------------------------

    async function resolvePlayers(selections) {
        const players = [];
        for (const sel of selections) {
            if (sel.mode === 'existing') {
                players.push({ id: sel.id, name: sel.name, score: state.startingScore });
            } else {
                try {
                    const created = await API.createPlayer(sel.name);
                    players.push({ id: created.id, name: created.name, score: state.startingScore });
                } catch (err) {
                    throw new Error(err.message);
                }
            }
        }
        return players;
    }

    /**
     * @param {object} config
     * @param {Array}   config.players   - [{ mode, name, id? }]
     * @param {string}  config.gameType  - '501' | '201' | 'Cricket'
     * @param {boolean} config.doubleOut - true = double out required
     */
    async function onStartGame(config) {
        UI.setLoading(true);

        // Set starting score based on game type before resolving players
        // so player objects get the correct score
        const STARTING_SCORES = { '501': 501, '201': 201, 'Cricket': 0 };
        state.startingScore = STARTING_SCORES[config.gameType] || 501;
        state.gameType      = config.gameType;
        state.doubleOut     = config.doubleOut;

        try {
            const players = await resolvePlayers(config.players);

            const match = await API.startMatch({
                player_ids:  players.map(p => p.id),
                legs_to_win: 1,
            });

            const leg = await API.startLeg({
                match_id:   match.id,
                game_type:  config.gameType,
                double_out: config.doubleOut,
            });

            state.matchId        = match.id;
            state.legId          = leg.id;
            state.players        = players;
            state.currentIndex   = 0;
            state.dartsThisTurn  = 0;
            state.turnComplete   = false;
            state.legOver        = false;
            state.activeTurnId   = null;
            state.turnScoreBefore = null;
            state.activeMultiplier = 1;

            UI.buildShell(players, { onMultiplier, onSegment, onUndo, onNextPlayer });

            const player = currentPlayer();
            UI.setActivePlayer(player.id);
            UI.setMultiplierTab(1);

            const ruleLabel = config.doubleOut ? 'DOUBLE OUT' : 'SINGLE OUT';
            UI.setStatus(`${player.name.toUpperCase()}'S TURN — SELECT MULTIPLIER`);
            UI.setMatchInfo(`${config.gameType} · ${ruleLabel} · MATCH ${state.matchId}`);

        } catch (err) {
            UI.showToast(err.message.toUpperCase(), 'bust', 4000);
            console.error('[app] Setup error:', err);
        } finally {
            UI.setLoading(false);
        }
    }

    // ------------------------------------------------------------------
    // Derived helpers
    // ------------------------------------------------------------------

    function currentPlayer() {
        return state.players[state.currentIndex];
    }

    function nextPlayerIndex() {
        return (state.currentIndex + 1) % state.players.length;
    }

    // ------------------------------------------------------------------
    // Game event handlers
    // ------------------------------------------------------------------

    function onMultiplier(multiplier) {
        if (state.turnComplete || state.legOver) return;
        state.activeMultiplier = multiplier;
        UI.setMultiplierTab(multiplier);
        UI.setStatus(`${_multiplierLabel(multiplier)} — SELECT SEGMENT`);
    }

    async function onSegment(segment, forcedMultiplier = null) {
        if (state.turnComplete || state.legOver) {
            UI.showToast('TAP NEXT PLAYER TO CONTINUE', 'info');
            return;
        }

        const multiplier = forcedMultiplier !== null ? forcedMultiplier : state.activeMultiplier;
        const player     = currentPlayer();

        UI.setLoading(true);

        try {
            const result = await API.recordThrow({
                leg_id:       state.legId,
                player_id:    player.id,
                segment,
                multiplier,
                score_before: player.score,
            });

            if (state.dartsThisTurn === 0) {
                state.activeTurnId    = result.turn_id;
                state.turnScoreBefore = result.score_before;
            }

            state.dartsThisTurn++;
            UI.addDartPill(player.id, result.points, multiplier, segment);

            if (result.is_bust) {
                player.score = state.turnScoreBefore;
                UI.setScore(player.id, player.score);
                UI.flashCard(player.id, 'bust');
                UI.showToast('BUST!', 'bust', 2500);
                UI.setStatus('BUST — TAP NEXT PLAYER', 'bust');
                state.turnComplete = true;
                UI.setNextPlayerEnabled(true);

            } else if (result.is_checkout) {
                player.score = 0;
                UI.setScore(player.id, 0);
                UI.flashCard(player.id, 'checkout');
                UI.showToast(`${player.name.toUpperCase()} WINS THE LEG!`, 'success', 4000);
                UI.setStatus(`${player.name.toUpperCase()} CHECKED OUT!`, 'success');
                state.legOver      = true;
                state.turnComplete = true;
                UI.setNextPlayerEnabled(false);

            } else {
                player.score = result.score_after;
                UI.setScore(player.id, player.score);

                if (result.turn_complete) {
                    UI.setStatus('END OF TURN — TAP NEXT PLAYER');
                    state.turnComplete = true;
                    UI.setNextPlayerEnabled(true);
                    if (result.checkout_suggestion) {
                        UI.setCheckoutHint(player.id, result.checkout_suggestion);
                    }
                } else {
                    const dartsLeft = 3 - state.dartsThisTurn;
                    UI.setStatus(
                        `${player.score} REMAINING — ${dartsLeft} DART${dartsLeft !== 1 ? 'S' : ''} LEFT`
                    );
                    if (result.checkout_suggestion) {
                        UI.setCheckoutHint(player.id, result.checkout_suggestion);
                        UI.showToast(result.checkout_suggestion.join(' → '), 'info', 3000);
                    }
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
        if (!state.activeTurnId || state.dartsThisTurn === 0) {
            UI.showToast('NOTHING TO UNDO', 'info');
            return;
        }

        UI.setLoading(true);

        try {
            const result = await API.undoLastThrow(state.activeTurnId);
            const player = currentPlayer();

            player.score = result.score_reverted_to;
            UI.setScore(player.id, player.score);

            const dartsRow = document.getElementById(`darts-${player.id}`);
            if (dartsRow?.lastChild) dartsRow.removeChild(dartsRow.lastChild);

            state.dartsThisTurn--;
            state.turnComplete = false;
            UI.setNextPlayerEnabled(false);
            UI.setCheckoutHint(player.id, null);

            if (state.dartsThisTurn === 0) state.turnScoreBefore = null;

            const dartsLeft = 3 - state.dartsThisTurn;
            UI.setStatus(
                `UNDONE — ${player.score} REMAINING — ${dartsLeft} DART${dartsLeft !== 1 ? 'S' : ''} LEFT`
            );
            UI.showToast('DART UNDONE', 'info', 1500);

        } catch (err) {
            UI.showToast(`UNDO FAILED: ${err.message}`, 'bust', 3000);
            console.error('[app] Undo error:', err);
        } finally {
            UI.setLoading(false);
        }
    }

    function onNextPlayer() {
        if (!state.turnComplete) return;

        const oldPlayer = currentPlayer();
        UI.clearDartPills(oldPlayer.id);

        state.currentIndex    = nextPlayerIndex();
        state.dartsThisTurn   = 0;
        state.turnComplete    = false;
        state.activeTurnId    = null;
        state.turnScoreBefore = null;
        state.activeMultiplier = 1;

        const newPlayer = currentPlayer();
        UI.setActivePlayer(newPlayer.id);
        UI.setNextPlayerEnabled(false);
        UI.setMultiplierTab(1);

        UI.setStatus(`${newPlayer.name.toUpperCase()}'S TURN — SELECT MULTIPLIER`);
    }

    // ------------------------------------------------------------------
    // Helpers
    // ------------------------------------------------------------------

    function _multiplierLabel(m) {
        return m === 1 ? 'SINGLE' : m === 2 ? 'DOUBLE' : 'TREBLE';
    }

    // ------------------------------------------------------------------
    // Initialise
    // ------------------------------------------------------------------

    async function init() {
        let existingPlayers = [];
        try {
            existingPlayers = await API.getPlayers();
        } catch (err) {
            console.warn('[app] Could not load existing players:', err.message);
        }
        UI.buildSetupScreen(existingPlayers, onStartGame);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();