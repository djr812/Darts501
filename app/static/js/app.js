/**
 * app.js
 * ------
 * Main game controller.
 *
 * Owns all game state and orchestrates interactions between:
 *   - UI  (rendering, user input)
 *   - API (server communication)
 *
 * State is intentionally kept flat and simple for this phase.
 * The server is the source of truth — local state reflects the
 * last known server response and is updated on every throw.
 *
 * Game flow:
 *   1. Page loads → prompt for match setup (hardcoded for now, Phase 3 adds UI)
 *   2. Player taps multiplier → taps segment → throw is sent to API
 *   3. Server responds → UI updates score, dart pills, checkout hint
 *   4. On turn_complete → Next Player button activates
 *   5. Player taps Next Player → rotate to next player, clear pills
 *   6. On checkout → show winner, offer new game
 */

(() => {

    // ------------------------------------------------------------------
    // Game state
    // ------------------------------------------------------------------

    const state = {
        matchId:       null,
        legId:         null,
        players:       [],      // [{ id, name, score }]
        currentIndex:  0,       // index into players array
        activeMultiplier: 1,    // currently selected multiplier (1/2/3)
        activeTurnId:  null,    // turn_id returned by server on first dart
        dartsThisTurn: 0,       // how many darts thrown this turn (0–3)
        turnScoreBefore:  null, // the players score at the start of the turn
        turnComplete:  false,   // true when server says turn is done
        legOver:       false,   // true when someone checked out
    };

    // ------------------------------------------------------------------
    // Hardcoded bootstrap — Phase 3 will replace with match setup screen
    // ------------------------------------------------------------------

    /**
     * Temporary bootstrap: reads match/leg/player config from the page's
     * data attributes set by the Flask template, or falls back to defaults.
     *
     * In the index.html template, add these to <body> to pre-configure:
     *   data-match-id="1"
     *   data-leg-id="1"
     *   data-players='[{"id":1,"name":"Player 1","score":501},{"id":2,"name":"Player 2","score":501}]'
     */
    function bootstrap() {
        const body = document.body;

        state.matchId = parseInt(body.dataset.matchId || '1', 10);
        state.legId   = parseInt(body.dataset.legId   || '1', 10);

        try {
            state.players = JSON.parse(body.dataset.players || '[]');
        } catch {
            state.players = [];
        }

        // Default players if none configured
        if (state.players.length === 0) {
            state.players = [
                { id: 1, name: 'Player 1', score: 501 },
                { id: 2, name: 'Player 2', score: 501 },
            ];
        }

        state.currentIndex = 0;
        state.dartsThisTurn = 0;
        state.turnComplete = false;
        state.legOver = false;
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
    // Event handlers passed to UI
    // ------------------------------------------------------------------

    /**
     * Called when the user taps a multiplier tab.
     */
    function onMultiplier(multiplier) {
        if (state.turnComplete || state.legOver) return;
        state.activeMultiplier = multiplier;
        UI.setMultiplierTab(multiplier);
        UI.setStatus(`${_multiplierLabel(multiplier)} — SELECT SEGMENT`);
    }

    /**
     * Called when the user taps a segment button (or bull/miss button).
     *
     * Some buttons (miss, outer bull, bull) pass a forced multiplier as
     * the second argument, overriding the active multiplier.
     *
     * @param {number} segment
     * @param {number|null} [forcedMultiplier]
     */
    async function onSegment(segment, forcedMultiplier = null) {
        if (state.turnComplete || state.legOver) {
            UI.showToast('TAP NEXT PLAYER TO CONTINUE', 'info');
            return;
        }

        const multiplier = forcedMultiplier !== null ? forcedMultiplier : state.activeMultiplier;
        const player = currentPlayer();

        UI.setLoading(true);

        try {
            const payload = {
                leg_id:      state.legId,
                player_id:   player.id,
                segment:     segment,
                multiplier:  multiplier,
                score_before: player.score,
            };

            const result = await API.recordThrow(payload);

            // On first dart of turn, capture the score before and store the turn_id
            if (state.dartsThisTurn === 0) {
                state.activeTurnId = result.turn_id;
                state.turnScoreBefore = result.score_before;  // capture pre-turn score
            }

            state.dartsThisTurn++;

            // Update local score
            player.score = result.score_after;

            // Update UI
            UI.setScore(player.id, result.score_after);
            UI.addDartPill(player.id, result.points, multiplier, segment);

            if (result.is_bust) {
                // Revert to the score at the START of the turn, not just before this dart
                player.score = state.turnScoreBefore;
                UI.setScore(player.id, player.score);
                UI.flashCard(player.id, 'bust');
                UI.showToast('BUST!', 'bust', 2500);
                UI.setStatus('BUST — TAP NEXT PLAYER', 'bust');
                state.turnComplete = true;
                UI.setNextPlayerEnabled(true);

            } else if (result.is_checkout) {
                UI.flashCard(player.id, 'checkout');
                UI.showToast(`${player.name.toUpperCase()} WINS THE LEG!`, 'success', 4000);
                UI.setStatus(`${player.name.toUpperCase()} CHECKED OUT!`, 'success');
                state.legOver = true;
                state.turnComplete = true;
                UI.setNextPlayerEnabled(false);
                // Phase 3: trigger leg end flow here

            } else if (result.turn_complete) {
                // Used all 3 darts
                UI.setStatus('END OF TURN — TAP NEXT PLAYER');
                state.turnComplete = true;
                UI.setNextPlayerEnabled(true);

                // Show checkout hint for next visit if applicable
                if (result.checkout_suggestion) {
                    UI.setCheckoutHint(player.id, result.checkout_suggestion);
                }

            } else {
                // Turn continues — update status with remaining score and hint
                const dartsLeft = 3 - state.dartsThisTurn;
                UI.setStatus(`${player.score} REMAINING — ${dartsLeft} DART${dartsLeft !== 1 ? 'S' : ''} LEFT`);

                if (result.checkout_suggestion) {
                    UI.setCheckoutHint(player.id, result.checkout_suggestion);
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

    /**
     * Called when the user taps the Undo button.
     * Deletes the last dart and reverts the player's score.
     */
    async function onUndo() {
        if (!state.activeTurnId || state.dartsThisTurn === 0) {
            state.turnScoreBefore = null;
            UI.showToast('NOTHING TO UNDO', 'info');
            return;
        }

        UI.setLoading(true);

        try {
            const result = await API.undoLastThrow(state.activeTurnId);
            const player = currentPlayer();

            // Revert score
            player.score = result.score_reverted_to;
            UI.setScore(player.id, player.score);

            // Remove last dart pill
            const dartsRow = document.getElementById(`darts-${player.id}`);
            if (dartsRow && dartsRow.lastChild) {
                dartsRow.removeChild(dartsRow.lastChild);
            }

            state.dartsThisTurn--;
            state.turnComplete = false;
            UI.setNextPlayerEnabled(false);
            UI.setCheckoutHint(player.id, null);

            const dartsLeft = 3 - state.dartsThisTurn;
            UI.setStatus(`UNDONE — ${player.score} REMAINING — ${dartsLeft} DART${dartsLeft !== 1 ? 'S' : ''} LEFT`);
            UI.showToast('DART UNDONE', 'info', 1500);

        } catch (err) {
            UI.showToast(`UNDO FAILED: ${err.message}`, 'bust', 3000);
            console.error('[app] Undo error:', err);
        } finally {
            UI.setLoading(false);
        }
    }

    /**
     * Called when the user taps the Next Player button.
     * Advances to the next player and resets turn state.
     */
    function onNextPlayer() {
        if (!state.turnComplete) return;

        const oldPlayer = currentPlayer();
        UI.clearDartPills(oldPlayer.id);

        // Advance player
        state.currentIndex   = nextPlayerIndex();
        state.dartsThisTurn  = 0;
        state.turnComplete   = false;
        state.activeTurnId   = null;
        state.turnScoreBefore = null;

        const newPlayer = currentPlayer();
        UI.setActivePlayer(newPlayer.id);
        UI.setNextPlayerEnabled(false);

        // Reset multiplier to single for new turn
        state.activeMultiplier = 1;
        UI.setMultiplierTab(1);

        UI.setStatus(`${newPlayer.name.toUpperCase()}'S TURN — SELECT MULTIPLIER`);
        UI.setMatchInfo(`LEG ${state.legId} — ${newPlayer.name.toUpperCase()}`);
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

    function init() {
        bootstrap();

        UI.buildShell(state.players, {
            onMultiplier,
            onSegment,
            onUndo,
            onNextPlayer,
        });

        const player = currentPlayer();
        UI.setActivePlayer(player.id);
        UI.setMultiplierTab(state.activeMultiplier);
        UI.setStatus(`${player.name.toUpperCase()}'S TURN — SELECT MULTIPLIER`);
        UI.setMatchInfo(`LEG ${state.legId} — ${player.name.toUpperCase()}`);
    }

    // Run after DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();
