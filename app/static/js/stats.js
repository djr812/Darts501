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
        app.style.cssText = '';
        document.body.className = 'mode-stats';

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

        const aiBtn = document.createElement('button');
        aiBtn.className = 'stats-ai-btn';
        aiBtn.type = 'button';
        aiBtn.textContent = '🤖 AI ANALYSIS';
        aiBtn.addEventListener('click', function() {
            if (typeof ANALYSIS !== 'undefined') {
                ANALYSIS.showAnalysisScreen(player, function() {
                    STATS.showStatsScreen(player, onBack);
                });
            }
        });

        header.appendChild(backBtn);
        header.appendChild(title);
        header.appendChild(aiBtn);
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

        // Match count filter (for trend chart)
        const limitGroup = document.createElement('div');
        limitGroup.className = 'filter-group';
        [10, 20, 50].forEach((n, i) => {
            const btn = document.createElement('button');
            btn.className = 'filter-btn' + (i === 1 ? ' active' : '');
            btn.dataset.limit = n;
            btn.type = 'button';
            btn.textContent = `LAST ${n}`;
            btn.addEventListener('click', () => {
                limitGroup.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                _reload(player.id, filterBar, contentArea);
            });
            limitGroup.appendChild(btn);
        });

        filterBar.appendChild(gameTypeGroup);
        filterBar.appendChild(checkoutGroup);
        filterBar.appendChild(limitGroup);
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
        const activeGameType  = filterBar.querySelector('.filter-group:nth-child(1) .filter-btn.active');
        const activeDoubleOut = filterBar.querySelector('.filter-group:nth-child(2) .filter-btn.active');
        const activeLimit     = filterBar.querySelector('.filter-group:nth-child(3) .filter-btn.active');
        return {
            gameType:  (activeGameType  && activeGameType.dataset.gameType)   || 'all',
            doubleOut: (activeDoubleOut && activeDoubleOut.dataset.doubleOut)  || 'all',
            limit:     (activeLimit     && activeLimit.dataset.limit)          || '20',
        };
    }

    async function _reload(playerId, filterBar, contentArea) {
        contentArea.innerHTML = '<div class="stats-loading">LOADING...</div>';
        const scope = _getScope(filterBar);

        try {
            const [data, trend] = await Promise.all([
                API.getPlayerStats(playerId, scope),
                API.getPlayerTrend(playerId, scope),
            ]);
            _render(data, trend, contentArea);
        } catch (err) {
            contentArea.innerHTML = `<div class="stats-error">FAILED TO LOAD STATS<br><small>${err.message}</small></div>`;
        }
    }

    function _render(data, trend, container) {
        container.innerHTML = '';

        const { records, scoring, checkout } = data;

        // ---- Trend chart ----
        if (trend && trend.matches && trend.matches.length > 1) {
            container.appendChild(_buildTrendChart(trend.matches));
        }

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

        // ---- Session history ----
        _renderHistory(data.player.id, container);
    }

    // ------------------------------------------------------------------
    // Trend chart
    // ------------------------------------------------------------------

    function _buildTrendChart(matches) {
        const W = 560, H = 160;
        const PAD = { top: 18, right: 16, bottom: 28, left: 42 };
        const innerW = W - PAD.left - PAD.right;
        const innerH = H - PAD.top  - PAD.bottom;

        const avgs = matches.map(m => m.avg);
        const minV = Math.max(0,   Math.floor(Math.min(...avgs) / 10) * 10 - 10);
        const maxV = Math.min(180, Math.ceil (Math.max(...avgs) / 10) * 10 + 10);
        const range = maxV - minV || 10;

        function xPos(i) {
            return PAD.left + (i / Math.max(matches.length - 1, 1)) * innerW;
        }
        function yPos(v) {
            return PAD.top + innerH - ((v - minV) / range) * innerH;
        }

        function el(tag, attrs, ns) {
            const e = document.createElementNS('http://www.w3.org/2000/svg', tag);
            Object.keys(attrs).forEach(k => e.setAttribute(k, attrs[k]));
            return e;
        }

        const svg = el('svg', {
            viewBox: `0 0 ${W} ${H}`,
            width: '100%',
            style: 'display:block;',
            class: 'trend-chart-svg',
        });

        // Background
        svg.appendChild(el('rect', { x: 0, y: 0, width: W, height: H,
            fill: '#1a1a1a', rx: 6 }));

        // Grid lines + Y labels
        const yTicks = 4;
        for (let i = 0; i <= yTicks; i++) {
            const v = minV + (range / yTicks) * i;
            const y = yPos(v);

            const line = el('line', {
                x1: PAD.left, x2: W - PAD.right,
                y1: y, y2: y,
                stroke: '#2a2a2a', 'stroke-width': 1,
            });
            svg.appendChild(line);

            const label = el('text', {
                x: PAD.left - 6, y: y,
                'text-anchor': 'end', 'dominant-baseline': 'central',
                fill: '#555', 'font-size': 9, 'font-family': 'monospace',
            });
            label.textContent = v.toFixed(0);
            svg.appendChild(label);
        }

        // Overall average reference line
        const overallAvg = avgs.reduce((a, b) => a + b, 0) / avgs.length;
        const avgY = yPos(overallAvg);
        const avgLine = el('line', {
            x1: PAD.left, x2: W - PAD.right,
            y1: avgY, y2: avgY,
            stroke: '#a87200', 'stroke-width': 1,
            'stroke-dasharray': '4 3',
        });
        svg.appendChild(avgLine);
        const avgLabel = el('text', {
            x: W - PAD.right + 2, y: avgY,
            'dominant-baseline': 'central',
            fill: '#a87200', 'font-size': 8, 'font-family': 'monospace',
        });
        avgLabel.textContent = overallAvg.toFixed(1);
        svg.appendChild(avgLabel);

        // Filled area under line
        const areaPoints = matches.map((m, i) => `${xPos(i)},${yPos(m.avg)}`).join(' ');
        const firstX = xPos(0), lastX = xPos(matches.length - 1);
        const baseY  = PAD.top + innerH;
        const area = el('polygon', {
            points: `${firstX},${baseY} ${areaPoints} ${lastX},${baseY}`,
            fill: 'rgba(240,165,0,0.08)',
        });
        svg.appendChild(area);

        // Line
        const linePath = matches.map((m, i) =>
            `${i === 0 ? 'M' : 'L'}${xPos(i)},${yPos(m.avg)}`
        ).join(' ');
        svg.appendChild(el('path', {
            d: linePath,
            fill: 'none',
            stroke: '#f0a500',
            'stroke-width': 2,
            'stroke-linejoin': 'round',
            'stroke-linecap':  'round',
        }));

        // Data points + tooltips
        matches.forEach((m, i) => {
            const cx = xPos(i), cy = yPos(m.avg);
            const isFirst = i === 0, isLast = i === matches.length - 1;
            const highlight = i === avgs.indexOf(Math.max(...avgs));

            const dot = el('circle', {
                cx, cy, r: highlight ? 5 : 3,
                fill: highlight ? '#f0a500' : '#c87800',
                stroke: '#0d0d0d', 'stroke-width': 1,
                cursor: 'pointer',
            });

            const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
            title.textContent = `${m.date}  vs ${m.opponent}
Avg: ${m.avg}  (${m.darts} darts)`;
            dot.appendChild(title);
            svg.appendChild(dot);

            // X axis label — show first, last, and every 5th
            if (isFirst || isLast || i % 5 === 0) {
                const xLabel = el('text', {
                    x: cx, y: H - PAD.bottom + 10,
                    'text-anchor': 'middle',
                    fill: '#444', 'font-size': 8, 'font-family': 'monospace',
                });
                xLabel.textContent = (i + 1);
                svg.appendChild(xLabel);
            }
        });

        // Chart title
        const titleEl = el('text', {
            x: PAD.left, y: 10,
            fill: '#666', 'font-size': 9, 'font-family': 'monospace',
            'letter-spacing': 1,
        });
        titleEl.textContent = '3-DART AVERAGE TREND';
        svg.appendChild(titleEl);

        const card = document.createElement('div');
        card.className = 'stat-card trend-card';
        card.appendChild(svg);
        return card;
    }

    // ------------------------------------------------------------------
    // Session history section
    // ------------------------------------------------------------------

    async function _renderHistory(playerId, container) {
        const section = document.createElement('div');
        section.className = 'stat-card history-card';

        const hdr = document.createElement('div');
        hdr.className = 'stat-card-title history-card-title';
        hdr.innerHTML = 'SESSION HISTORY <span class="history-loading-inline">…</span>';
        section.appendChild(hdr);

        const list = document.createElement('div');
        list.className = 'history-list';
        section.appendChild(list);

        const moreBtn = document.createElement('button');
        moreBtn.className = 'history-more-btn';
        moreBtn.type = 'button';
        moreBtn.textContent = 'LOAD MORE';
        moreBtn.style.display = 'none';
        section.appendChild(moreBtn);

        container.appendChild(section);

        let offset = 0;
        const PAGE = 20;

        async function loadPage() {
            moreBtn.style.display = 'none';
            try {
                const data = await API.getPlayerHistory(playerId, offset, PAGE);
                // Use local refs instead of getElementById (avoids duplicate ID issues on reload)
                const spinner = hdr.querySelector('.history-loading-inline');
                if (spinner) spinner.remove();

                if (data.sessions.length === 0 && offset === 0) {
                    list.innerHTML = '<div class="history-empty">No sessions yet</div>';
                    return;
                }

                data.sessions.forEach(session => {
                    const row = document.createElement('button');
                    row.className = 'history-row';
                    row.type = 'button';

                    const resultCls = session.result === 'WIN'      ? 'result-win'
                                    : session.result === 'LOSS'     ? 'result-loss'
                                    : session.result === 'PRACTICE' ? 'result-practice'
                                    : 'result-neutral';

                    const oppText = session.is_practice
                        ? session.game_type
                        : (session.opponent || '—');

                    row.innerHTML =
                        `<span class="history-date">${_esc(session.date)}</span>` +
                        `<span class="history-type ${resultCls}">${_esc(session.result)}</span>` +
                        `<span class="history-opp">${_esc(oppText)}</span>` +
                        `<span class="history-avg">${session.avg}</span>` +
                        `<span class="history-darts">${session.darts}d</span>` +
                        `<span class="history-chevron">›</span>`;

                    row.addEventListener('click', () => {
                        if (session.is_practice) {
                            _showPracticeSummaryModal(session);
                        } else {
                            _showScorecardModal(session.match_id, playerId);
                        }
                    });
                    list.appendChild(row);
                });

                offset += data.sessions.length;
                if (data.sessions.length === PAGE) {
                    moreBtn.style.display = '';
                }
            } catch(e) {
                console.error('[history] load failed:', e);
                const spinner = hdr.querySelector('.history-loading-inline');
                if (spinner) spinner.textContent = '!';
            }
        }

        moreBtn.addEventListener('click', loadPage);
        loadPage();
        return section;
    }

    function _showPracticeSummaryModal(session) {
        const overlay = _modalOverlay('practice-summary-modal');
        const box = document.createElement('div');
        box.className = 'modal-box scorecard-box';

        box.innerHTML =
            `<div class="modal-title">PRACTICE SESSION</div>` +
            `<div class="modal-subtitle">${_esc(session.date)}</div>` +
            `<div class="scorecard-practice-stats">` +
                `<div class="sc-pstat"><span class="sc-pval">${session.darts}</span><span class="sc-plbl">DARTS</span></div>` +
                `<div class="sc-pstat"><span class="sc-pval">${session.avg}</span><span class="sc-plbl">3-DART AVG</span></div>` +
            `</div>`;

        const closeBtn = _closeButton(() => overlay.remove());
        box.appendChild(closeBtn);
        overlay.appendChild(box);
        document.body.appendChild(overlay);
    }

    async function _showScorecardModal(matchId, focusPlayerId) {
        const overlay = _modalOverlay('scorecard-modal');
        const box = document.createElement('div');
        box.className = 'modal-box scorecard-box';
        box.innerHTML = '<div class="modal-title">SCORECARD</div><div class="sc-loading">LOADING…</div>';
        overlay.appendChild(box);
        document.body.appendChild(overlay);

        try {
            const data = await API.getMatchScorecard(matchId);
            box.innerHTML = '';
            _renderScorecard(data, focusPlayerId, box, () => overlay.remove());
        } catch(e) {
            box.innerHTML = `<div class="modal-title">SCORECARD</div><div class="sc-loading">FAILED TO LOAD</div>`;
            box.appendChild(_closeButton(() => overlay.remove()));
        }
    }

    function _renderScorecard(data, focusPlayerId, box, onClose) {
        const { match, players, legs } = data;

        // Header
        const winner = players.find(p => p.id === match.winner_id);
        const titleEl = document.createElement('div');
        titleEl.className = 'modal-title';
        titleEl.textContent = match.game_type.toUpperCase();
        box.appendChild(titleEl);

        const metaEl = document.createElement('div');
        metaEl.className = 'sc-meta';
        metaEl.textContent = match.ended_at +
            (winner ? '  ·  ' + winner.name.toUpperCase() + ' WINS' : '');
        box.appendChild(metaEl);

        // One section per leg
        legs.forEach((leg, li) => {
            const legHdr = document.createElement('div');
            legHdr.className = 'sc-leg-header';
            const legWinner = players.find(p => p.id === leg.winner_id);
            legHdr.textContent = 'LEG ' + leg.leg_number +
                (legWinner ? '  ·  ' + legWinner.name.toUpperCase() : '');
            box.appendChild(legHdr);

            // Column headers
            const colHdr = document.createElement('div');
            colHdr.className = 'sc-col-header';
            // Build columns dynamically per player
            let hdrHTML = '<span class="sc-turn-num">#</span>';
            players.forEach(p => {
                hdrHTML +=
                    `<span class="sc-player-col${p.id === focusPlayerId ? ' sc-focus' : ''}">${_esc(p.name.toUpperCase())}</span>`;
            });
            colHdr.innerHTML = hdrHTML;
            box.appendChild(colHdr);

            // Group turns by turn_number
            const turnMap = {};
            leg.turns.forEach(t => {
                if (!turnMap[t.turn_number]) turnMap[t.turn_number] = {};
                turnMap[t.turn_number][t.player_id] = t;
            });

            const turnNums = Object.keys(turnMap).map(Number).sort((a,b)=>a-b);
            turnNums.forEach(tn => {
                const rowEl = document.createElement('div');
                rowEl.className = 'sc-turn-row';

                let rowHTML = `<span class="sc-turn-num">${tn}</span>`;
                players.forEach(p => {
                    const turn = turnMap[tn][p.id];
                    if (!turn) {
                        rowHTML += `<span class="sc-player-col${p.id === focusPlayerId ? ' sc-focus' : ''}">—</span>`;
                        return;
                    }

                    const dartStr = turn.throws.map(th => {
                        let cls = th.is_checkout ? 'dart-checkout' : '';
                        return `<span class="sc-dart ${cls}">${_esc(th.notation)}</span>`;
                    }).join('');

                    const turnCls = turn.is_bust ? 'sc-bust'
                                  : turn.is_checkout ? 'sc-checkout' : '';

                    const remaining = turn.is_bust ? 'BUST'
                                    : (turn.score_after !== null ? turn.score_after : '—');

                    rowHTML +=
                        `<span class="sc-player-col${p.id === focusPlayerId ? ' sc-focus' : ''}">` +
                            `<span class="sc-darts">${dartStr}</span>` +
                            `<span class="sc-turn-score ${turnCls}">${turn.is_bust ? 0 : turn.turn_score}</span>` +
                            `<span class="sc-remaining ${turnCls}">${remaining}</span>` +
                        `</span>`;
                });
                rowEl.innerHTML = rowHTML;
                box.appendChild(rowEl);
            });
        });

        box.appendChild(_closeButton(onClose));
    }

    // ------------------------------------------------------------------
    // Modal helpers
    // ------------------------------------------------------------------

    function _modalOverlay(id) {
        const existing = document.getElementById(id);
        if (existing) existing.remove();
        const overlay = document.createElement('div');
        overlay.id = id;
        overlay.className = 'modal-overlay';
        overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
        return overlay;
    }

    function _closeButton(onClick) {
        const btn = document.createElement('button');
        btn.className = 'stats-cancel-btn';
        btn.type = 'button';
        btn.textContent = '✕  CLOSE';
        btn.addEventListener('click', onClick);
        return btn;
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