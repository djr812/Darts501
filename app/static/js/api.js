/**
 * api.js
 * ------
 * Thin wrapper around fetch() for all API calls.
 *
 * Features:
 *   - Consistent JSON request/response handling
 *   - Offline detection and local queue
 *   - Automatic queue flush on reconnect
 *   - All functions return Promises
 *
 * Offline queue:
 *   Throws that fail due to network unavailability are saved to
 *   localStorage and replayed in order when the connection returns.
 *   This covers temporary Wi-Fi drops in the dartboard environment.
 */

const API = (() => {

    // APP_ROOT is injected by index.html from Flask's request.script_root.
    // It will be '' in development and '/Darts501' (or similar) in production.
    // This makes all fetch() calls work correctly regardless of subpath deployment.
    var BASE = (typeof APP_ROOT !== 'undefined') ? APP_ROOT : '';
    const QUEUE_KEY = 'darts_offline_queue';

    // ------------------------------------------------------------------
    // Core fetch wrapper
    // ------------------------------------------------------------------

    /**
     * Make a JSON API request.
     *
     * @param {string} method   - HTTP method ('GET', 'POST', etc.)
     * @param {string} path     - API path e.g. '/api/throws'
     * @param {object} [body]   - Request body (will be JSON-serialised)
     * @returns {Promise<object>} Parsed JSON response body
     * @throws {Error} On network failure or non-2xx response
     */
    async function request(method, path, body) {
        const options = {
            method,
            headers: { 'Content-Type': 'application/json' },
        };

        if (body !== undefined) {
            options.body = JSON.stringify(body);
        }

        const response = await fetch(BASE + path, options);
        const data = await response.json();

        if (!response.ok) {
            // Surface the server's error message if available
            const msg = data.error || `HTTP ${response.status}`;
            throw new Error(msg);
        }

        return data;
    }

    // ------------------------------------------------------------------
    // Offline queue
    // ------------------------------------------------------------------

    function loadQueue() {
        try {
            return JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]');
        } catch {
            return [];
        }
    }

    function saveQueue(queue) {
        localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
    }

    function enqueue(payload) {
        const queue = loadQueue();
        queue.push({ payload, timestamp: Date.now() });
        saveQueue(queue);
        console.warn('[API] Throw queued offline:', payload);
    }

    /**
     * Flush all queued throws to the server in order.
     * Called automatically on the 'online' event and on page load.
     */
    async function flushQueue() {
        const queue = loadQueue();
        if (queue.length === 0) return;

        console.log(`[API] Flushing ${queue.length} queued throw(s)...`);

        for (const item of queue) {
            try {
                await request('POST', '/api/throws', item.payload);
                // Remove successfully synced item from queue
                const current = loadQueue();
                current.shift();
                saveQueue(current);
            } catch (err) {
                // Stop flushing if still offline — will retry on next 'online' event
                console.warn('[API] Queue flush failed, stopping:', err.message);
                break;
            }
        }

        const remaining = loadQueue();
        if (remaining.length === 0) {
            console.log('[API] Queue flushed successfully.');
        }
    }

    // Listen for browser coming back online
    window.addEventListener('online', () => {
        console.log('[API] Connection restored — flushing queue...');
        flushQueue();
    });

    // Attempt flush on page load in case there were queued items from a prior session
    window.addEventListener('DOMContentLoaded', flushQueue);

    // ------------------------------------------------------------------
    // Public API methods
    // ------------------------------------------------------------------

    /**
     * Record a dart throw.
     *
     * Falls back to offline queue if the network is unavailable.
     *
     * @param {object} throwData - { leg_id, player_id, segment, multiplier, score_before? }
     * @returns {Promise<object>} ThrowResult from the server
     */
    async function recordThrow(throwData) {
        try {
            return await request('POST', '/api/throws', throwData);
        } catch (err) {
            if (!navigator.onLine) {
                enqueue(throwData);
                // Return a synthetic optimistic result so the UI can update immediately
                return {
                    offline: true,
                    points: throwData.segment * throwData.multiplier,
                    score_after: (throwData.score_before || 0) - (throwData.segment * throwData.multiplier),
                    is_bust: false,
                    is_checkout: false,
                    turn_complete: false,
                };
            }
            throw err;
        }
    }

    /**
     * Undo the last dart in a turn.
     *
     * @param {number} turnId
     * @returns {Promise<object>} { deleted_throw, score_reverted_to }
     */
    async function undoLastThrow(turnId) {
        return request('DELETE', '/api/throws/last', { turn_id: turnId });
    }

    /**
     * Submit a complete turn (all darts) in one request.
     * Replaces the per-dart recordThrow flow for human players.
     *
     * @param {object} turnData  { leg_id, player_id, score_before, darts: [{segment, multiplier}] }
     * @returns {Promise<object>}
     */
    async function submitTurn(turnData) {
        return request('POST', '/api/turns/submit', turnData);
    }

    /**
     * Fetch all players.
     *
     * @returns {Promise<Array>}
     */
    async function getPlayers() {
        return request('GET', '/api/players');
    }

    /**
     * Create a new player.
     *
     * @param {string} name
     * @returns {Promise<object>} { id, name, nickname }
     */
    async function createPlayer(name) {
        return request('POST', '/api/players', { name });
    }

    async function getCpuPlayer() {
        return request('GET', '/api/players/cpu');
    }

    async function startTurn(turnData) {
        return request('POST', '/api/turns', turnData);
    }

    async function startPracticeSession(data) {
        return request('POST', '/api/practice', data);
    }

    async function endPracticeSession(matchId) {
        return request('POST', '/api/practice/' + matchId + '/end', {});
    }

    /**
     * Start a new match.
     *
     * @param {object} matchData - { player_ids, sets_to_win, legs_per_set }
     * @returns {Promise<object>} New match record
     */
    async function startMatch(matchData) {
        return request('POST', '/api/matches', matchData);
    }

    /**
     * Start a new leg within a match.
     *
     * @param {object} legData - { match_id, game_type, double_out }
     * @returns {Promise<object>} New leg record
     */
    async function startLeg(legData) {
        return request('POST', '/api/legs', legData);
    }

    /**
     * Fetch computed stats for a player.
     *
     * @param {number} playerId
     * @param {object} scope - { gameType: 'all'|'501'|'201', doubleOut: 'all'|'1'|'0' }
     * @returns {Promise<object>}
     */
    async function createCricketMatch(data) {
        return request('POST', '/api/cricket/matches', data);
    }

    async function getCricketMatch(matchId) {
        return request('GET', '/api/cricket/matches/' + matchId);
    }

    async function getShanghaiMatch(matchId) {
        return request('GET', '/api/shanghai/matches/' + matchId);
    }

    async function recordCricketThrow(matchId, data) {
        return request('POST', `/api/cricket/matches/${matchId}/throw`, data);
    }

    async function undoCricketThrow(matchId) {
        return request('POST', `/api/cricket/matches/${matchId}/undo`);
    }

    async function endCricketMatch(matchId) {
        return request('POST', `/api/cricket/matches/${matchId}/end`);
    }

    async function createShanghaiMatch(data) {
        return request('POST', '/api/shanghai/matches', data);
    }

    async function submitShanghaiRound(matchId, data) {
        return request('POST', `/api/shanghai/matches/${matchId}/submit`, data);
    }

    async function endShanghaiMatch(matchId) {
        return request('POST', `/api/shanghai/matches/${matchId}/end`);
    }

    async function getPlayerHeatmap(playerId, scope = {}) {
        const params = new URLSearchParams();
        if (scope.gameType)  params.set('game_type',  scope.gameType);
        if (scope.doubleOut !== undefined) params.set('double_out', scope.doubleOut);
        if (scope.matchId)   params.set('match_id',   scope.matchId);
        return request('GET', `/api/players/${playerId}/stats/heatmap?${params}`);
    }

    async function getPlayerHistory(playerId, offset = 0, limit = 20) {
        return request('GET', `/api/players/${playerId}/history?offset=${offset}&limit=${limit}`);
    }

    async function getMatchScorecard(matchId) {
        return request('GET', `/api/matches/${matchId}/scorecard`);
    }

    async function getPlayerTrend(playerId, scope = {}) {
        const params = new URLSearchParams();
        if (scope.limit)     params.set('limit',      scope.limit);
        if (scope.gameType && scope.gameType !== 'all')
                             params.set('game_type',  scope.gameType);
        if (scope.doubleOut && scope.doubleOut !== 'all')
                             params.set('double_out', scope.doubleOut);
        const qs = params.toString() ? '?' + params.toString() : '';
        return request('GET', `/api/players/${playerId}/stats/trend${qs}`);
    }

    async function getPlayerStats(playerId, scope = {}) {
        const params = new URLSearchParams();
        if (scope.gameType  && scope.gameType  !== 'all') params.set('game_type',  scope.gameType);
        if (scope.doubleOut && scope.doubleOut !== 'all') params.set('double_out', scope.doubleOut);
        const qs = params.toString() ? '?' + params.toString() : '';
        return request('GET', `/api/players/${playerId}/stats${qs}`);
    }

    /**
     * Cancel an active match (preserves data, marks status=cancelled).
     * @param {number} matchId
     */
    async function cancelMatch(matchId) {
        return request('POST', '/api/matches/' + matchId + '/cancel', {});
    }

    /**
     * Restart a match from scratch (deletes all throws/turns/legs, resets tallies).
     * @param {number} matchId
     */
    async function restartMatch(matchId) {
        return request('POST', '/api/matches/' + matchId + '/restart', {});
    }

    async function restartCricketMatch(matchId) {
        return request('POST', '/api/cricket/matches/' + matchId + '/restart', {});
    }

    async function restartShanghaiMatch(matchId) {
        return request('POST', '/api/shanghai/matches/' + matchId + '/restart', {});
    }

    async function createBaseballMatch(data) {
        return request('POST', '/api/baseball/matches', data);
    }

    async function getBaseballMatch(matchId) {
        return request('GET', '/api/baseball/matches/' + matchId);
    }

    async function recordBaseballThrow(matchId, data) {
        return request('POST', '/api/baseball/matches/' + matchId + '/throw', data);
    }

    async function baseballNext(matchId, data) {
        return request('POST', '/api/baseball/matches/' + matchId + '/next', data);
    }

    async function baseballUndo(matchId) {
        return request('POST', '/api/baseball/matches/' + matchId + '/undo', {});
    }

    async function endBaseballMatch(matchId) {
        return request('POST', '/api/baseball/matches/' + matchId + '/end', {});
    }

    async function createKillerMatch(data) {
        return request('POST', '/api/killer/matches', data);
    }
    async function getKillerMatch(matchId) {
        return request('GET', '/api/killer/matches/' + matchId);
    }
    async function killerThrow(matchId, data) {
        return request('POST', '/api/killer/matches/' + matchId + '/throw', data);
    }
    async function killerNext(matchId) {
        return request('POST', '/api/killer/matches/' + matchId + '/next', {});
    }
    async function killerUndo(matchId) {
        return request('POST', '/api/killer/matches/' + matchId + '/undo', {});
    }
    async function endKillerMatch(matchId) {
        return request('POST', '/api/killer/matches/' + matchId + '/end', {});
    }

    async function getWarmupHighScore(playerId) {
        return request('GET', '/api/baseball/highscore/' + playerId + '?game_type=warmup');
    }

    async function submitWarmupScore(playerId, score) {
        return request('POST', '/api/baseball/highscore/' + playerId + '?game_type=warmup', { score: score });
    }

    async function getBaseballHighScore(playerId) {
        return request('GET', '/api/baseball/highscore/' + playerId);
    }

    async function submitBaseballScore(playerId, score) {
        return request('POST', '/api/baseball/highscore/' + playerId, { score: score });
    }

    // Expose public interface
    return {
        recordThrow,
        submitTurn,
        undoLastThrow,
        getPlayers,
        createPlayer,
        getCpuPlayer,
        startTurn,
        startPracticeSession,
        endPracticeSession,
        startMatch,
        startLeg,
        getPlayerStats,
        getPlayerTrend,
        getPlayerHistory,
        getPlayerHeatmap,
        createCricketMatch,
        recordCricketThrow,
        undoCricketThrow,
        endCricketMatch,
        createShanghaiMatch,
        submitShanghaiRound,
        endShanghaiMatch,
        getMatchScorecard,
        cancelMatch,
        restartMatch,
        restartCricketMatch,
        restartShanghaiMatch,
        getCricketMatch,
        getShanghaiMatch,
        createBaseballMatch,
        getBaseballMatch,
        recordBaseballThrow,
        baseballNext,
        baseballUndo,
        endBaseballMatch,
        createKillerMatch,
        getKillerMatch,
        killerThrow,
        killerNext,
        killerUndo,
        endKillerMatch,
        getWarmupHighScore,
        submitWarmupScore,
        getBaseballHighScore,
        submitBaseballScore,
        flushQueue,
    };

})();