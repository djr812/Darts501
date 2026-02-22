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

    const BASE = '';   // same origin — Flask serves both API and frontend
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

    /**
     * Start a new match.
     *
     * @param {object} matchData - { player_ids: [], legs_to_win: 1 }
     * @returns {Promise<object>} New match record
     */
    async function startMatch(matchData) {
        return request('POST', '/api/matches', matchData);
    }

    /**
     * Start a new leg within a match.
     *
     * @param {number} matchId
     * @returns {Promise<object>} New leg record
     */
    async function startLeg(matchId) {
        return request('POST', '/api/legs', { match_id: matchId });
    }

    // Expose public interface
    return {
        recordThrow,
        undoLastThrow,
        getPlayers,
        createPlayer,
        startMatch,
        startLeg,
        flushQueue,
    };

})();