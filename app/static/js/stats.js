/**
 * stats.js
 * --------
 * Player statistics screen.
 *
 * Provides two public functions:
 *
 *   STATS.showPlayerPicker(players, onSelect)
 *     Renders a modal listing all non-CPU players to pick from.
 *
 *   STATS.showStatsScreen(player, onBack)
 *     Replaces the #app content with a full stats screen for that player,
 *     with scope filter tabs (All / 501 / 201 × Double / Single out).
 *     Calls onBack() when the user taps the back button.
 */

const STATS = (() => {

    // ------------------------------------------------------------------
    // Player picker modal
    // ------------------------------------------------------------------

    function showPlayerPicker(players, onSelect) {
        var _spm = document.getElementById('stats-picker-modal'); if (_spm) _spm.remove();

        const humanPlayers = players.filter(p => p.name !== 'CPU');
        if (humanPlayers.length === 0) {
            _toast('NO PLAYERS YET'); return;
        }

        const overlay = document.createElement('div');
        overlay.id = 'stats-picker-modal';
        overlay.className = 'modal-overlay';

        const box = document.createElement('div');
        box.className = 'modal-box stats-picker-box';
        box.innerHTML = `
            <div class="modal-title">VIEW STATS</div>
            <div class="modal-subtitle">SELECT A PLAYER</div>
        `;

        const list = document.createElement('div');
        list.className = 'stats-picker-list';

        humanPlayers.forEach(p => {
            const btn = document.createElement('button');
            btn.className = 'stats-picker-btn';
            btn.type = 'button';
            btn.textContent = p.name;
            btn.addEventListener('click', () => {
                overlay.remove();
                onSelect(p);
            });
            list.appendChild(btn);
        });

        box.appendChild(list);

        const cancelBtn = document.createElement('button');
        cancelBtn.className = 'stats-cancel-btn';
        cancelBtn.type = 'button';
        cancelBtn.textContent = '✕  CANCEL';
        cancelBtn.addEventListener('click', () => overlay.remove());
        box.appendChild(cancelBtn);

        overlay.appendChild(box);
        overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
        document.body.appendChild(overlay);
    }

    // ------------------------------------------------------------------
    // Stats screen
    // ------------------------------------------------------------------

    /**
     * Replace #app content with the stats screen for the given player.
     *
     * @param {{ id: number, name: string }} player
     * @param {Function} onBack  — called when user taps Back
     */
    function showStatsScreen(player, onBack) {
        const app = document.getElementById('app');
        app.innerHTML = '';
        app.style.cssText = 'display:flex; flex-direction:column; overflow:hidden;';

        // ---- Header bar ----
        const header = document.createElement('div');
        header.className = 'stats-header';

        const backBtn = document.createElement('button');
        backBtn.className = 'stats-back-btn';
        backBtn.type = 'button';
        backBtn.innerHTML = '‹ BACK';
        backBtn.addEventListener('click', onBack);

        const title = document.createElement('div');
        title.className = 'stats-header-title';
        title.textContent = player.name.toUpperCase();

        header.appendChild(backBtn);
        header.appendChild(title);
        app.appendChild(header);

        // ---- Scope filters ----
        const filterBar = document.createElement('div');
        filterBar.className = 'stats-filter-bar';

        // Game type filter
        const gameTypeGroup = document.createElement('div');
        gameTypeGroup.className = 'filter-group';
        const gameTypes = [
            { label: 'ALL GAMES', gameType: 'all' },
            { label: '501',       gameType: '501' },
            { label: '201',       gameType: '201' },
        ];
        gameTypes.forEach((opt, i) => {
            const btn = document.createElement('button');
            btn.className = 'filter-btn' + (i === 0 ? ' active' : '');
            btn.dataset.gameType = opt.gameType;
            btn.type = 'button';
            btn.textContent = opt.label;
            btn.addEventListener('click', () => {
                gameTypeGroup.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                _reload(player.id, filterBar, contentArea);
            });
            gameTypeGroup.appendChild(btn);
        });

        // Checkout rule filter
        const checkoutGroup = document.createElement('div');
        checkoutGroup.className = 'filter-group';
        const checkouts = [
            { label: 'ALL RULES',   doubleOut: 'all' },
            { label: 'DOUBLE OUT',  doubleOut: '1'   },
            { label: 'SINGLE OUT',  doubleOut: '0'   },
        ];
        checkouts.forEach((opt, i) => {
            const btn = document.createElement('button');
            btn.className = 'filter-btn' + (i === 0 ? ' active' : '');
            btn.dataset.doubleOut = opt.doubleOut;
            btn.type = 'button';
            btn.textContent = opt.label;
            btn.addEventListener('click', () => {
                checkoutGroup.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                _reload(player.id, filterBar, contentArea);
            });
            checkoutGroup.appendChild(btn);
        });

        filterBar.appendChild(gameTypeGroup);
        filterBar.appendChild(checkoutGroup);
        app.appendChild(filterBar);

        // ---- Content area ----
        const contentArea = document.createElement('div');
        contentArea.className = 'stats-content';
        app.appendChild(contentArea);

        // Initial load
        _reload(player.id, filterBar, contentArea);
    }

    // ------------------------------------------------------------------
    // Data load + render
    // ------------------------------------------------------------------

    function _getScope(filterBar) {
        const activeGameType  = filterBar.querySelector('.filter-group:first-child .filter-btn.active');
        const activeDoubleOut = filterBar.querySelector('.filter-group:last-child  .filter-btn.active');
        return {
            gameType:  (activeGameType && activeGameType.dataset.gameType)  || 'all',
            doubleOut: (activeDoubleOut && activeDoubleOut.dataset.doubleOut) || 'all',
        };
    }

    async function _reload(playerId, filterBar, contentArea) {
        contentArea.innerHTML = '<div class="stats-loading">LOADING...</div>';
        const scope = _getScope(filterBar);

        try {
            const data = await API.getPlayerStats(playerId, scope);
            _render(data, contentArea);
        } catch (err) {
            contentArea.innerHTML = `<div class="stats-error">FAILED TO LOAD STATS<br><small>${err.message}</small></div>`;
        }
    }

    function _render(data, container) {
        container.innerHTML = '';

        const { records, scoring, checkout } = data;

        // Helper: build a stat card section
        function section(title, rows) {
            const card = document.createElement('div');
            card.className = 'stat-card';

            const h = document.createElement('div');
            h.className = 'stat-card-title';
            h.textContent = title;
            card.appendChild(h);

            rows.forEach(([label, value, sub]) => {
                const row = document.createElement('div');
                row.className = 'stat-row';
                row.innerHTML = `
                    <span class="stat-label">${_esc(label)}</span>
                    <span class="stat-value">${_esc(String(value))}${sub ? `<span class="stat-sub"> ${_esc(sub)}</span>` : ''}</span>
                `;
                card.appendChild(row);
            });

            return card;
        }

        // ---- Win/Loss record ----
        container.appendChild(section('RECORD', [
            ['Matches played',  records.matches_played],
            ['Matches won',     records.matches_won,    `(${records.match_win_rate}%)`],
            ['Sets won',        records.sets_won],
            ['Legs played',     records.legs_played],
            ['Legs won',        records.legs_won,       `(${records.leg_win_rate}%)`],
        ]));

        // ---- Scoring ----
        container.appendChild(section('SCORING', [
            ['3-dart average',  scoring.three_dart_avg],
            ['First 9 average', scoring.first9_avg],
            ['Highest turn',    scoring.highest_turn],
            ['Lowest turn',     scoring.lowest_turn],
            ['Highest single dart', scoring.highest_dart],
            ['Total darts thrown',  scoring.total_darts],
            ['180s',            scoring.one_eighties],
            ['140+ turns',      scoring.ton_forties],
            ['100+ turns',      scoring.tons],
            ['Busts',           scoring.busts],
        ]));

        // ---- Checkout ----
        const favDbl = checkout.favourite_double
            ? `${checkout.favourite_double.notation} (×${checkout.favourite_double.times})`
            : '—';

        container.appendChild(section('CHECKOUT', [
            ['Best checkout',         checkout.best_checkout    || '—'],
            ['Best double-out finish', checkout.best_double_checkout || '—'],
            ['Best single-out finish', checkout.best_single_checkout || '—'],
            ['Avg darts to checkout', checkout.avg_darts_to_checkout || '—'],
            ['Favourite double',      favDbl],
        ]));
    }

    // ------------------------------------------------------------------
    // Helpers
    // ------------------------------------------------------------------

    function _esc(str) {
        return String(str)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function _toast(msg) {
        const t = document.getElementById('toast');
        if (!t) return;
        t.textContent = msg;
        t.className = 'visible info';
        setTimeout(() => { t.className = ''; }, 2500);
    }

    return { showPlayerPicker, showStatsScreen };

})();