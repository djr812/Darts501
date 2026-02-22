/**
 * app.js
 * ------
 * Main game controller.
 *
 * Flow:
 *   1. Page loads → setup screen shown
 *   2. User selects player count and enters names → onStartGame()
 *   3. Players created/fetched via API → match + leg created
 *   4. Game board rendered → throw loop begins
 */

(() => {

    // ------------------------------------------------------------------
    // Game state
    // ------------------------------------------------------------------

    const state = {
        matchId:          null,
        legId:            null,
        players:          [],      // [{ id, name, score }]
        currentIndex:     0,
        activeMultiplier: 1,
        activeTurnId:     null,
        dartsThisTurn:    0,
        turnScoreBefore:  null,    // score at start of current turn (for bust revert)
        turnComplete:     false,
        legOver:          false,
    };

    // ------------------------------------------------------------------
    // Setup — called when user taps START MATCH
    // ------------------------------------------------------------------

    /**
     * Resolve player names to player IDs.
     * Creates a new player if the name doesn't already exist.
     *
     * @param {string[]} names
     * @returns {Promise<Array>} Array of { id, name, score: 501 }
     */
    async function resolvePlayers(names) {
        // Fetch existing players
        let existing = [];
        try {
            existing = await API.getPlayers();
        } catch (err) {
            console.warn('[app] Could not fetch players list:', err.message);
        }

        const players = [];

        for (const name of names) {
            // Case-insensitive match against existing players
            const match = existing.find(
                p => p.name.toLowerCase() === name.toLowerCase()
            );

            if (match) {
                players.push({ id: match.id, name: match.name, score: 501 });
            } else {
                // Create a new player
                try {
                    const created = await API.createPlayer(name);
                    players.push({ id: created.id, name: created.name, score: 501 });
                } catch (err) {
                    // If creation fails (e.g. duplicate from a race), try fetching again
                    const retry = existing.find(
                        p => p.name.toLowerCase() === name.toLowerCase()
                    );
                    if (retry) {
                        players.push({ id: retry.id, name: retry.name, score: 501 });
                    } else {
                        throw new Error(`Could not create player '${name}': ${err.message}`);
                    }
                }
            }
        }

        return players;
    }

    /**
     * Called by UI when the user confirms the setup screen.
     * Creates players, starts a match and leg, then launches the game.
     *
     * @param {string[]} names  - Player names from the setup form
     */
    async function onStartGame(names) {
        UI.setLoading(true);

        try {
            // 1. Resolve names to player records (create if needed)
            const players = await resolvePlayers(names);

            // 2. Start a match
            const match = await API.startMatch({
                player_ids:  players.map(p => p.id),
                legs_to_win: 1,
            });

            // 3. Start the first leg
            const leg = await API.startLeg(match.id);

            // 4. Populate state
            state.matchId      = match.id;
            state.legId        = leg.id;
            state.players      = players;
            state.currentIndex = 0;
            state.dartsThisTurn  = 0;
            state.turnComplete   = false;
            state.legOver        = false;
            state.activeTurnId   = null;
            state.turnScoreBefore = null;

            // 5. Build the game board
            UI.buildShell(players, {
                onMultiplier,
                onSegment,
                onUndo,
                onNextPlayer,
            });

            const player = currentPlayer();
            UI.setActivePlayer(player.id);
            UI.setMultiplierTab(state.activeMultiplier);
            UI.setStatus(`${player.name.toUpperCase()}'S TURN — SELECT MULTIPLIER`);
            UI.setMatchInfo(`MATCH ${state.matchId} · LEG 1`);

        } catch (err) {
            UI.showToast(`SETUP FAILED: ${err.message}`, 'bust', 4000);
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
            const payload = {
                leg_id:       state.legId,
                player_id:    player.id,
                segment,
                multiplier,
                score_before: player.score,
            };

            const result = await API.recordThrow(payload);

            // Capture pre-turn score on first dart of turn
            if (state.dartsThisTurn === 0) {
                state.activeTurnId    = result.turn_id;
                state.turnScoreBefore = result.score_before;
            }

            state.dartsThisTurn++;

            // Update UI dart pill regardless of bust/checkout
            UI.addDartPill(player.id, result.points, multiplier, segment);

            if (result.is_bust) {
                // Revert to score at the START of this turn
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
                // Normal dart — update score
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

            if (state.dartsThisTurn === 0) {
                state.turnScoreBefore = null;
            }

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

        const newPlayer = currentPlayer();
        UI.setActivePlayer(newPlayer.id);
        UI.setNextPlayerEnabled(false);

        state.activeMultiplier = 1;
        UI.setMultiplierTab(1);

        UI.setStatus(`${newPlayer.name.toUpperCase()}'S TURN — SELECT MULTIPLIER`);
        UI.setMatchInfo(`MATCH ${state.matchId} · LEG ${state.legId}`);
    }

    // ------------------------------------------------------------------
    // Helpers
    // ------------------------------------------------------------------

    function _multiplierLabel(m) {
        return m === 1 ? 'SINGLE' : m === 2 ? 'DOUBLE' : 'TREBLE';
    }

    // ------------------------------------------------------------------
    // Initialise — show setup screen on load
    // ------------------------------------------------------------------

    function init() {
        UI.buildSetupScreen(onStartGame);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();