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
            const [data, trend, heatmap] = await Promise.all([
                API.getPlayerStats(playerId, scope),
                API.getPlayerTrend(playerId, scope),
                API.getPlayerHeatmap(playerId, scope),
            ]);
            _render(data, trend, heatmap, contentArea);
        } catch (err) {
            contentArea.innerHTML = `<div class="stats-error">FAILED TO LOAD STATS<br><small>${err.message}</small></div>`;
        }
    }

    function _render(data, trend, heatmap, container) {
        container.innerHTML = '';

        const { records, scoring, checkout } = data;

        // ── Two-column layout wrapper ──
        const cols = document.createElement('div');
        cols.className = 'stats-two-col';
        container.appendChild(cols);

        // ── LEFT column: trend chart + session history ──
        const leftCol = document.createElement('div');
        leftCol.className = 'stats-col stats-col-left';
        cols.appendChild(leftCol);

        if (trend && trend.matches && trend.matches.length > 1) {
            leftCol.appendChild(_buildTrendChart(trend.matches));
        }
        _renderHistory(data.player.id, leftCol);

        // ── RIGHT column: condensed stats card ──
        const rightCol = document.createElement('div');
        rightCol.className = 'stats-col stats-col-right';
        cols.appendChild(rightCol);

        rightCol.appendChild(_buildCondensedStats(records, scoring, checkout));

        // ── Heatmap ──
        if (heatmap && heatmap.counts) {
            const hmCard = document.createElement('div');
            hmCard.className = 'stat-card heatmap-card';
            const hmTitle = document.createElement('div');
            hmTitle.className = 'stat-card-title';
            hmTitle.textContent = 'DART HEATMAP';
            hmCard.appendChild(hmTitle);
            hmCard.appendChild(_buildStatsHeatmap(heatmap.counts));
            rightCol.appendChild(hmCard);
        }
    }

    function _buildCondensedStats(records, scoring, checkout) {
        const card = document.createElement('div');
        card.className = 'stat-card condensed-stats-card';

        // Scrollable inner wrapper — keeps card at fixed height
        const scroll = document.createElement('div');
        scroll.className = 'condensed-stats-scroll';
        card.appendChild(scroll);

        function group(title, rows) {
            const hdr = document.createElement('div');
            hdr.className = 'condensed-group-title';
            hdr.textContent = title;
            scroll.appendChild(hdr);

            rows.forEach(([label, value, sub, highlight]) => {
                const row = document.createElement('div');
                row.className = 'stat-row' + (highlight ? ' stat-row-highlight' : '');
                row.innerHTML =
                    `<span class="stat-label">${_esc(label)}</span>` +
                    `<span class="stat-value">${_esc(String(value))}` +
                    (sub ? `<span class="stat-sub"> ${_esc(sub)}</span>` : '') +
                    `</span>`;
                scroll.appendChild(row);
            });
        }

        const favDbl = checkout.favourite_double
            ? `${checkout.favourite_double.notation} (×${checkout.favourite_double.times})`
            : '—';

        group('RECORD', [
            ['Played',       records.matches_played],
            ['Won',          records.matches_won,         `(${records.match_win_rate}%)`,  true],
            ['Legs won',     records.legs_won,             `of ${records.legs_played}`],
        ]);

        group('SCORING', [
            ['3-dart avg',   scoring.three_dart_avg,       null,                            true],
            ['First 9 avg',  scoring.first9_avg],
            ['Best turn',    scoring.highest_turn],
            ['Worst turn',   scoring.lowest_turn],
            ['Best dart',    scoring.highest_dart],
            ['Total darts',  scoring.total_darts],
            ['180s',         scoring.one_eighties,         null,                            scoring.one_eighties > 0],
            ['140+',         scoring.ton_forties],
            ['100+',         scoring.tons],
            ['Busts',        scoring.busts],
        ]);

        group('CHECKOUT', [
            ['Best',         checkout.best_checkout        || '—',  null,                   true],
            ['Best D/O',     checkout.best_double_checkout || '—'],
            ['Best S/O',     checkout.best_single_checkout || '—'],
            ['Avg darts',    checkout.avg_darts_to_checkout || '—'],
            ['Fav double',   favDbl],
        ]);

        return card;
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
    // Stats heatmap (full multi-colour gradient)
    // ------------------------------------------------------------------

    function _buildStatsHeatmap(counts) {
        const SEGMENTS = [20,1,18,4,13,6,10,15,2,17,3,19,7,16,8,11,14,9,12,5];
        const SIZE = 200, CX = SIZE/2, CY = SIZE/2;
        const R = SIZE/2 - 4;

        const rBull    = R * 0.06;
        const rOuter   = R * 0.13;
        const rInner1  = R * 0.47;
        const rTreble2 = R * 0.55;
        const rDouble1 = R * 0.84;
        const rDouble2 = R * 0.97;

        const SEG_ANGLE   = 360 / 20;
        const START_OFF   = -SEG_ANGLE / 2;

        // Find max hits for scaling
        let maxHits = 1;
        Object.values(counts).forEach(v => { if (v > maxHits) maxHits = v; });

        function getHits(seg, prefix) {
            if (seg === 25) return counts[prefix === 'D' ? 'BULL' : 'OUTER'] || 0;
            return counts[prefix + seg] || 0;
        }

        // Multi-colour gradient: cold (black) → purple → red → tan/orange → green (hot)
        // Using site palette colours: var colours at 0%, 25%, 50%, 75%, 100%
        function heatColour(hits, isDouble, isTreble) {
            if (hits === 0) return null;
            const t = Math.pow(hits / maxHits, 0.6); // power <1 spreads low values

            // Colour stops matching site palette
            // 0.00: #0d0d0d  (near black — cold)
            // 0.20: #4a1060  (deep purple)
            // 0.45: #c0392b  (site red / bust colour)
            // 0.70: #c8a068  (site tan / warm)
            // 1.00: #2ecc71  (site green / checkout colour)
            const stops = [
                { t: 0.00, r: 13,  g: 13,  b: 13  },
                { t: 0.20, r: 74,  g: 16,  b: 96  },
                { t: 0.45, r: 192, g: 57,  b: 43  },
                { t: 0.70, r: 200, g: 160, b: 104 },
                { t: 1.00, r: 46,  g: 204, b: 113 },
            ];

            // Find the two stops t falls between
            let lo = stops[0], hi = stops[stops.length - 1];
            for (let i = 0; i < stops.length - 1; i++) {
                if (t >= stops[i].t && t <= stops[i+1].t) {
                    lo = stops[i]; hi = stops[i+1]; break;
                }
            }
            const span = hi.t - lo.t || 1;
            const f    = (t - lo.t) / span;
            const r = Math.round(lo.r + f * (hi.r - lo.r));
            const g = Math.round(lo.g + f * (hi.g - lo.g));
            const b = Math.round(lo.b + f * (hi.b - lo.b));

            // Trebles/doubles get slightly higher opacity for ring distinction
            const alpha = isTreble ? 0.95 : isDouble ? 0.88 : 0.80;
            return `rgba(${r},${g},${b},${alpha})`;
        }

        function polarToXY(angleDeg, radius) {
            const rad = (angleDeg - 90) * Math.PI / 180;
            return { x: CX + radius * Math.cos(rad), y: CY + radius * Math.sin(rad) };
        }

        function arcPath(r1, r2, a1, a2) {
            const p1 = polarToXY(a1, r1), p2 = polarToXY(a2, r1);
            const p3 = polarToXY(a2, r2), p4 = polarToXY(a1, r2);
            const lg = (a2 - a1) > 180 ? 1 : 0;
            return `M ${p1.x} ${p1.y} A ${r1} ${r1} 0 ${lg} 1 ${p2.x} ${p2.y} L ${p3.x} ${p3.y} A ${r2} ${r2} 0 ${lg} 0 ${p4.x} ${p4.y} Z`;
        }

        function svgEl(tag, attrs) {
            const e = document.createElementNS('http://www.w3.org/2000/svg', tag);
            Object.entries(attrs).forEach(([k,v]) => e.setAttribute(k, v));
            return e;
        }

        function tip(el, text) {
            const t = document.createElementNS('http://www.w3.org/2000/svg', 'title');
            t.textContent = text;
            el.appendChild(t);
        }

        const svg = svgEl('svg', {
            viewBox: `0 0 ${SIZE} ${SIZE}`,
            width: '100%',
            style: 'width:100%;display:block;',
        });

        // Dark board background
        svg.appendChild(svgEl('circle', { cx: CX, cy: CY, r: R, fill: '#0d0d0d', stroke: '#222', 'stroke-width': '1' }));

        SEGMENTS.forEach((seg, i) => {
            const a1 = START_OFF + i * SEG_ANGLE;
            const a2 = a1 + SEG_ANGLE;

            const sH = getHits(seg, 'S');
            const tH = getHits(seg, 'T');
            const dH = getHits(seg, 'D');

            const zones = [
                { r1: rOuter,   r2: rInner1,  hits: sH, dbl: false, tbl: false, lbl: 'S' },
                { r1: rInner1,  r2: rTreble2, hits: tH, dbl: false, tbl: true,  lbl: 'T' },
                { r1: rTreble2, r2: rDouble1, hits: sH, dbl: false, tbl: false, lbl: 'S' },
                { r1: rDouble1, r2: rDouble2, hits: dH, dbl: true,  tbl: false, lbl: 'D' },
            ];

            zones.forEach(zone => {
                const colour = heatColour(zone.hits, zone.dbl, zone.tbl);
                const fill   = colour || '#141414';
                const path   = svgEl('path', {
                    d: arcPath(zone.r1, zone.r2, a1, a2),
                    fill,
                    stroke: '#1e1e1e',
                    'stroke-width': '0.5',
                });
                svg.appendChild(path);

                // Hit count on treble/double rings if >0
                if (zone.hits > 0 && zone.lbl !== 'S') {
                    const mid = a1 + SEG_ANGLE / 2;
                    const mr  = (zone.r1 + zone.r2) / 2;
                    const mp  = polarToXY(mid, mr);
                    const txt = svgEl('text', {
                        x: mp.x, y: mp.y,
                        'text-anchor': 'middle', 'dominant-baseline': 'central',
                        fill: '#fff', 'font-size': '6.5', 'font-family': 'monospace',
                        'font-weight': 'bold', 'pointer-events': 'none',
                    });
                    txt.textContent = zone.hits;
                    svg.appendChild(txt);
                }

                // Tooltip target
                const hitPts = zone.hits * (zone.lbl === 'T' ? 3 : zone.lbl === 'D' ? 2 : 1) * seg;
                const ttEl = svgEl('path', { d: arcPath(zone.r1, zone.r2, a1, a2), fill: 'transparent', stroke: 'none', cursor: 'default' });
                tip(ttEl, `${zone.lbl}${seg} — ${zone.hits} hit${zone.hits !== 1 ? 's' : ''} — ${hitPts} pts`);
                svg.appendChild(ttEl);
            });

            // Number label in wire ring
            const mid   = a1 + SEG_ANGLE / 2;
            const labelR = (rDouble2 + R) / 2;
            const lp    = polarToXY(mid, labelR);
            const rot   = mid + 90;
            const lbl   = svgEl('text', {
                x: lp.x, y: lp.y, 'text-anchor': 'middle', 'dominant-baseline': 'central',
                fill: '#555', 'font-size': '7.5', 'font-family': 'monospace',
                transform: `rotate(${rot},${lp.x},${lp.y})`, 'pointer-events': 'none',
            });
            lbl.textContent = seg;
            svg.appendChild(lbl);
        });

        // Outer bull
        const obH  = getHits(25, 'S');
        const obC  = heatColour(obH, false, false);
        svg.appendChild(svgEl('circle', { cx: CX, cy: CY, r: rOuter, fill: obC || '#141414', stroke: '#1e1e1e', 'stroke-width': '0.5' }));
        if (obH > 0) {
            const obTxt = svgEl('text', { x: CX, y: CY + rBull + (rOuter - rBull)/2 - 1,
                'text-anchor': 'middle', 'dominant-baseline': 'central',
                fill: '#fff', 'font-size': '6', 'font-family': 'monospace', 'pointer-events': 'none' });
            obTxt.textContent = obH;
            svg.appendChild(obTxt);
        }
        const obTT = svgEl('circle', { cx: CX, cy: CY, r: rOuter, fill: 'transparent', stroke: 'none', cursor: 'default' });
        tip(obTT, `Outer Bull — ${obH} hit${obH !== 1 ? 's' : ''} — ${obH * 25} pts`);
        svg.appendChild(obTT);

        // Inner bull
        const bH  = getHits(25, 'D');
        const bC  = heatColour(bH, true, false);
        svg.appendChild(svgEl('circle', { cx: CX, cy: CY, r: rBull, fill: bC || '#141414', stroke: '#1e1e1e', 'stroke-width': '0.5' }));
        if (bH > 0) {
            const bTxt = svgEl('text', { x: CX, y: CY,
                'text-anchor': 'middle', 'dominant-baseline': 'central',
                fill: '#fff', 'font-size': '6', 'font-family': 'monospace', 'pointer-events': 'none' });
            bTxt.textContent = bH;
            svg.appendChild(bTxt);
        }
        const bTT = svgEl('circle', { cx: CX, cy: CY, r: rBull, fill: 'transparent', stroke: 'none', cursor: 'default' });
        tip(bTT, `Bull — ${bH} hit${bH !== 1 ? 's' : ''} — ${bH * 50} pts`);
        svg.appendChild(bTT);

        // Gradient legend
        // ── Side-by-side layout: SVG board + contextual legend ──
        const inner = document.createElement('div');
        inner.className = 'heatmap-inner';

        // Left: SVG board
        const svgWrap = document.createElement('div');
        svgWrap.className = 'heatmap-svg-wrap';
        svgWrap.appendChild(svg);
        inner.appendChild(svgWrap);

        // Right: legend
        const legend = document.createElement('div');
        legend.className = 'heatmap-legend';

        const lgTitle = document.createElement('div');
        lgTitle.className = 'heatmap-legend-title';
        lgTitle.textContent = 'COLOUR GUIDE';
        legend.appendChild(lgTitle);

        const legendItems = [
            { colour: '#2ecc71', label: 'Hottest',    desc: 'Most frequently hit zones' },
            { colour: '#c8a068', label: 'Hot',         desc: 'Above average frequency'   },
            { colour: '#c0392b', label: 'Moderate',    desc: 'Occasionally hit'           },
            { colour: '#4a1060', label: 'Cold',        desc: 'Rarely hit'                 },
            { colour: '#0d0d0d', label: 'Coldest',     desc: 'Never or almost never hit', border: '#444' },
        ];

        legendItems.forEach(function(item) {
            const row = document.createElement('div');
            row.className = 'heatmap-legend-item';

            const swatch = document.createElement('div');
            swatch.className = 'heatmap-legend-swatch';
            swatch.style.background = item.colour;
            if (item.border) swatch.style.borderColor = item.border;
            row.appendChild(swatch);

            const txt = document.createElement('div');
            txt.className = 'heatmap-legend-text';
            txt.innerHTML = '<strong>' + item.label + '</strong>' + item.desc;
            row.appendChild(txt);

            legend.appendChild(row);
        });

        // Gradient bar at bottom of legend
        const barRow = document.createElement('div');
        barRow.className = 'heatmap-gradient-bar-row';
        barRow.innerHTML =
            '<span class="heatmap-gradient-lbl">COLD</span>' +
            '<div class="heatmap-gradient-bar"></div>' +
            '<span class="heatmap-gradient-lbl">HOT</span>';
        legend.appendChild(barRow);

        inner.appendChild(legend);

        const wrap = document.createElement('div');
        wrap.className = 'heatmap-wrap';
        wrap.appendChild(inner);
        return wrap;
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