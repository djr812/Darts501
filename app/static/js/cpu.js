/**
 * cpu.js
 * ------
 * CPU player logic for single-player vs CPU mode.
 *
 * The CPU plays a realistic but beatable game:
 *
 *   Score > 62 (can't checkout yet):
 *     Aims for T20. Occasionally drifts to adjacent segments or singles
 *     to simulate real human variance (~15% chance of a non-ideal result).
 *
 *   Score ≤ 62 (checkout range) and checkout suggestion exists:
 *     Attempts to follow the checkout suggestion exactly.
 *     Has a higher miss rate on doubles (~25%) to stay competitive.
 *
 *   Score ≤ 62 but no direct checkout available this dart:
 *     Plays a setup shot — aims for the segment that leaves a clean double.
 *
 * Difficulty is "pub player" — good but not perfect.
 * Hit rate on trebles: ~82%, doubles: ~72%, singles: ~96%.
 */

const CPU = (() => {

    // Clockwise board order — used to find adjacent segments for drift
    const BOARD_RING = [20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19, 7, 16, 8, 11, 14, 9, 12, 5];

    // Delay between CPU darts (ms) — makes it feel like thinking
    const DART_DELAY    = 900;
    const TURN_START_DELAY = 600;

    /**
     * Parse a dart notation string into { segment, multiplier }.
     * Handles: T20, D20, S20, DB (double bull), OB (outer bull)
     */
    function _parseDart(notation) {
        if (!notation) return null;
        const s = notation.toUpperCase().trim();
        if (s === 'DB')  return { segment: 25, multiplier: 2 };
        if (s === 'OB')  return { segment: 25, multiplier: 1 };
        const m = s.match(/^([TDS])(\d+)$/);
        if (!m) return null;
        const multiplier = m[1] === 'T' ? 3 : m[1] === 'D' ? 2 : 1;
        return { segment: parseInt(m[2], 10), multiplier };
    }

    /**
     * Return a random adjacent segment (one step clockwise or anticlockwise).
     */
    function _adjacentSegment(segment) {
        if (segment === 25) return 25;  // bull drift stays on bull ring
        const idx = BOARD_RING.indexOf(segment);
        if (idx === -1) return segment;
        const dir = Math.random() < 0.5 ? 1 : -1;
        return BOARD_RING[(idx + dir + BOARD_RING.length) % BOARD_RING.length];
    }

    /**
     * Apply realistic variance to an intended dart.
     * Returns { segment, multiplier } that the CPU actually hits.
     *
     * @param {number} segment    - Intended segment
     * @param {number} multiplier - Intended multiplier (1=single, 2=double, 3=treble)
     * @returns {{ segment: number, multiplier: number }}
     */
    function _applyVariance(segment, multiplier) {
        const r = Math.random();

        if (multiplier === 3) {
            // Treble: 82% hit, 10% single same, 8% adjacent single
            if (r < 0.82) return { segment, multiplier: 3 };
            if (r < 0.92) return { segment, multiplier: 1 };
            return { segment: _adjacentSegment(segment), multiplier: 1 };
        }

        if (multiplier === 2) {
            // Double: 72% hit, 12% single same, 10% miss (segment 0), 6% adjacent single
            if (r < 0.72) return { segment, multiplier: 2 };
            if (r < 0.84) return { segment, multiplier: 1 };
            if (r < 0.94) return { segment: 0, multiplier: 1 };  // miss outside
            return { segment: _adjacentSegment(segment), multiplier: 1 };
        }

        // Single: 96% hit, 4% adjacent
        if (r < 0.96) return { segment, multiplier: 1 };
        return { segment: _adjacentSegment(segment), multiplier: 1 };
    }

    /**
     * Choose the CPU's intended dart given the current score and checkout
     * suggestion for this dart position.
     *
     * @param {number}      score       - CPU's current remaining score this turn
     * @param {string|null} suggestion  - Checkout suggestion dart notation for this position, or null
     * @param {boolean}     doubleOut   - Whether double-out rules apply
     * @returns {{ segment: number, multiplier: number }} - Intended dart (before variance)
     */
    function _chooseDart(score, suggestion, doubleOut) {
        // If we have a checkout suggestion for this dart, try to follow it
        if (suggestion) {
            const parsed = _parseDart(suggestion);
            if (parsed) return parsed;
        }

        // Score > 62 or no suggestion — aim for maximum scoring
        if (score > 62) {
            // Occasionally aim for T19 or T18 instead of T20 (variety/strategy)
            const r = Math.random();
            if (r < 0.78) return { segment: 20, multiplier: 3 };  // T20 — primary target
            if (r < 0.88) return { segment: 19, multiplier: 3 };  // T19
            if (r < 0.93) return { segment: 20, multiplier: 1 };  // S20
            return { segment: 5, multiplier: 3 };                   // T5 (near T20)
        }

        // Score 41–62, no checkout suggestion — set up a double
        // Aim to leave a clean double (prefer D16, D8, D4, D2 chain)
        if (score > 40) {
            // Try to leave an even number on a double
            const target = score - 32; // aim to leave D16
            if (target > 0 && target <= 20) return { segment: target, multiplier: 1 };
            return { segment: 20, multiplier: 1 };
        }

        // Score ≤ 40 — should have a suggestion, but if not, go for the double directly
        if (score % 2 === 0 && score <= 40) {
            return { segment: score / 2, multiplier: 2 };
        }

        // Odd score ≤ 40 — hit a single 1 to make it even, then double
        if (score <= 41) {
            return { segment: 1, multiplier: 1 };
        }

        // Fallback
        return { segment: 20, multiplier: 3 };
    }

    /**
     * Play a full CPU turn — throws up to 3 darts with delays between each,
     * calling onDart after each throw and onTurnEnd when the turn is complete.
     *
     * @param {object}   cpuPlayer    - { id, name, score }
     * @param {object}   gameState    - { legId, doubleOut, startingScore }
     * @param {string[]} suggestions  - Checkout suggestion array for current score, or []
     * @param {Function} onDart       - async (segment, multiplier) => ThrowResult
     *                                  Called to actually record each dart via the API
     * @param {Function} onTurnEnd    - Called when turn is complete (bust, checkout, or 3 darts)
     */
    async function playTurn(cpuPlayer, gameState, suggestions, onDart, onTurnEnd) {
        let score       = cpuPlayer.score;
        let dartsThrown = 0;
        let turnOver    = false;
        let lastResult  = null;

        await _delay(TURN_START_DELAY);

        while (dartsThrown < 3 && !turnOver) {
            // Pick the suggestion for this dart position (0-indexed into suggestions array)
            const suggestionForThisDart = suggestions && suggestions[dartsThrown]
                ? suggestions[dartsThrown]
                : null;

            const intended = _chooseDart(score, suggestionForThisDart, gameState.doubleOut);
            const actual   = _applyVariance(intended.segment, intended.multiplier);

            // Record the dart via the API (same path as a human throw)
            lastResult  = await onDart(actual.segment, actual.multiplier, score);
            dartsThrown++;

            if (lastResult.is_bust) {
                score    = cpuPlayer.score;  // reverted to turn start
                turnOver = true;
            } else if (lastResult.is_checkout) {
                score    = 0;
                turnOver = true;
            } else {
                score = lastResult.score_after;
                if (lastResult.turn_complete) turnOver = true;

                // Refresh suggestions for subsequent darts from server response
                if (!turnOver && lastResult.checkout_suggestion) {
                    const remaining = lastResult.checkout_suggestion;
                    for (let i = 0; i < remaining.length; i++) {
                        if (dartsThrown + i < 3) {
                            suggestions[dartsThrown + i] = remaining[i];
                        }
                    }
                }
            }

            if (!turnOver) await _delay(DART_DELAY);
        }

        // Pass the last result to onTurnEnd so app.js can resolve checkouts/busts
        onTurnEnd(lastResult);
    }

    function _delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    return { playTurn };

})();