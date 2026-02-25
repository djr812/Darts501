/**
 * practice.js
 * -----------
 * Free practice mode — record throws with no game structure.
 *
 * Flow:
 *   1. PRACTICE button on setup screen → PRACTICE.showSetup(existingPlayers, onBack)
 *   2. Player selects duration and player name → PRACTICE.start(config)
 *   3. Practice screen: multiplier tabs + dartboard + timer + stats
 *   4. Timer expires or user taps End → summary shown → back to setup
 *
 * All throws are saved to the database via existing /api/throws endpoint
 * and flow into stats/AI analysis automatically.
 */

var PRACTICE = (function() {

    // ------------------------------------------------------------------
    // Practice Setup Screen
    // ------------------------------------------------------------------

    /**
     * Show the practice setup screen.
     * @param {Array}    existingPlayers  — [{ id, name }] from API
     * @param {Function} onBack           — called when user taps Back
     * @param {Function} onStart          — called with { player, duration } to begin
     */
    function showSetup(existingPlayers, onBack, onStart) {
        var app = document.getElementById('app');
        app.innerHTML = '';
        app.style.cssText = '';
        document.body.className = 'mode-setup';

        var inner = document.createElement('div');
        inner.className = 'setup-screen-inner';
        app.appendChild(inner);

        // Title
        var title = document.createElement('div');
        title.id = 'setup-title';
        title.innerHTML = '<div class="setup-logo">DARTS 501</div><div class="setup-subtitle">PRACTICE MODE</div>';
        inner.appendChild(title);

        // ---- Player selection (reuse same mechanism as match setup) ----
        var playerSection = document.createElement('div');
        playerSection.className = 'setup-section';
        playerSection.innerHTML = '<div class="setup-label">PLAYER</div>';

        var slotContainer = document.createElement('div');
        slotContainer.id = 'practice-player-slot';

        // Build a single player slot using the shared _buildPlayerSlot mechanism
        // We replicate the slot inline here since _buildPlayerSlot is private to UI
        var slot = _buildPracticePlayerSlot(existingPlayers);
        slotContainer.appendChild(slot);
        playerSection.appendChild(slotContainer);
        inner.appendChild(playerSection);

        // ---- Practice Mode ----
        var modeSection = document.createElement('div');
        modeSection.className = 'setup-section';
        modeSection.innerHTML = '<div class="setup-label">PRACTICE MODE</div>';
        var modeRow = document.createElement('div');
        modeRow.className = 'setup-option-row';

        var selectedMode = 'free';
        var selectedTarget = null; // { type, label, segment, multiplier } for segment mode

        // Target badge — shows selected target when segment mode active
        var targetBadge = document.createElement('div');
        targetBadge.id = 'practice-target-badge';
        targetBadge.className = 'practice-target-badge hidden';

        var freeModeBtn = document.createElement('button');
        freeModeBtn.className = 'option-btn selected';
        freeModeBtn.dataset.value = 'free';
        freeModeBtn.type = 'button';
        freeModeBtn.textContent = 'FREE THROW';

        var targetModeBtn = document.createElement('button');
        targetModeBtn.className = 'option-btn';
        targetModeBtn.dataset.value = 'target';
        targetModeBtn.type = 'button';
        targetModeBtn.textContent = 'TARGET';

        freeModeBtn.addEventListener('click', function() {
            freeModeBtn.classList.add('selected');
            targetModeBtn.classList.remove('selected');
            selectedMode = 'free';
            selectedTarget = null;
            targetBadge.className = 'practice-target-badge hidden';
            targetBadge.textContent = '';
        });

        targetModeBtn.addEventListener('click', function() {
            _showTargetModal(function(target) {
                selectedMode = target.type;
                selectedTarget = target;
                freeModeBtn.classList.remove('selected');
                targetModeBtn.classList.add('selected');
                targetBadge.className = 'practice-target-badge';
                targetBadge.textContent = target.label;
            });
        });

        modeRow.appendChild(freeModeBtn);
        modeRow.appendChild(targetModeBtn);
        modeSection.appendChild(modeRow);
        modeSection.appendChild(targetBadge);
        inner.appendChild(modeSection);

        // ---- Duration ----
        var durationSection = document.createElement('div');
        durationSection.className = 'setup-section';
        durationSection.innerHTML = '<div class="setup-label">PRACTICE DURATION</div>';
        var durationRow = document.createElement('div');
        durationRow.className = 'setup-option-row';

        var selectedDuration = 10;
        [5, 10, 15, 30].forEach(function(mins) {
            var btn = document.createElement('button');
            btn.className = 'option-btn' + (mins === 10 ? ' selected' : '');
            btn.dataset.value = mins;
            btn.type = 'button';
            btn.innerHTML = mins + '<span class="option-hint">min</span>';
            btn.addEventListener('click', function() {
                durationRow.querySelectorAll('.option-btn').forEach(function(b) { b.classList.remove('selected'); });
                btn.classList.add('selected');
                selectedDuration = mins;
            });
            durationRow.appendChild(btn);
        });
        durationSection.appendChild(durationRow);
        inner.appendChild(durationSection);

        // ---- Start button ----
        var startBtn = document.createElement('button');
        startBtn.className = 'start-btn';
        startBtn.textContent = 'START PRACTICE';
        startBtn.type = 'button';

        startBtn.addEventListener('click', function() {
            var playerData = _collectPracticePlayer(slot);
            if (!playerData) return;
            if (selectedMode !== 'free' && !selectedTarget) {
                UI.showToast('PLEASE SELECT A TARGET', 'bust', 2000);
                return;
            }
            onStart({
                player:          playerData,
                durationMinutes: selectedDuration,
                targetMode:      selectedMode,
                targetConfig:    selectedTarget,
            });
        });
        inner.appendChild(startBtn);

        // ---- Back button ----
        var backBtn = document.createElement('button');
        backBtn.className = 'practice-back-btn';
        backBtn.type = 'button';
        backBtn.textContent = '← BACK TO MATCH SETUP';
        backBtn.addEventListener('click', onBack);
        inner.appendChild(backBtn);
    }

    // ------------------------------------------------------------------
    // Single player slot (mirrors _buildPlayerSlot in ui.js)
    // ------------------------------------------------------------------

    function _buildPracticePlayerSlot(existingPlayers) {
        var slot = document.createElement('div');
        slot.className = 'name-slot';
        slot.dataset.index = 0;

        var toggleRow = document.createElement('div');
        toggleRow.className = 'slot-toggle-row';

        var newBtn = document.createElement('button');
        newBtn.className = 'slot-toggle-btn active';
        newBtn.textContent = '+ NEW';
        newBtn.type = 'button';

        var existingBtn = document.createElement('button');
        existingBtn.className = 'slot-toggle-btn';
        existingBtn.textContent = 'EXISTING';
        existingBtn.type = 'button';
        if (existingPlayers.length === 0) {
            existingBtn.disabled = true;
            existingBtn.title = 'No existing players';
        }
        toggleRow.appendChild(newBtn);
        toggleRow.appendChild(existingBtn);
        slot.appendChild(toggleRow);

        var newInput = document.createElement('input');
        newInput.type = 'text';
        newInput.className = 'name-input';
        newInput.placeholder = 'Your name';
        newInput.maxLength = 20;
        newInput.autocomplete = 'off';
        newInput.autocorrect = 'off';
        newInput.autocapitalize = 'words';
        newInput.spellcheck = false;
        newInput.addEventListener('input', function() { newInput.classList.remove('error'); });
        slot.appendChild(newInput);

        var existingSelect = document.createElement('select');
        existingSelect.className = 'name-select';
        existingSelect.style.display = 'none';
        var ph = document.createElement('option');
        ph.value = ''; ph.textContent = '— Select player —';
        ph.disabled = true; ph.selected = true;
        existingSelect.appendChild(ph);
        existingPlayers.filter(function(p) { return p.name !== 'CPU'; }).forEach(function(p) {
            var opt = document.createElement('option');
            opt.value = p.id; opt.textContent = p.name;
            existingSelect.appendChild(opt);
        });
        existingSelect.addEventListener('change', function() { existingSelect.classList.remove('error'); });
        slot.appendChild(existingSelect);

        function activateMode(mode) {
            if (mode === 'new') {
                newBtn.classList.add('active'); existingBtn.classList.remove('active');
                newInput.style.display = ''; existingSelect.style.display = 'none';
                slot.dataset.mode = 'new'; newInput.focus();
            } else {
                existingBtn.classList.add('active'); newBtn.classList.remove('active');
                newInput.style.display = 'none'; existingSelect.style.display = '';
                slot.dataset.mode = 'existing'; existingSelect.focus();
            }
        }
        newBtn.addEventListener('click', function() { activateMode('new'); });
        existingBtn.addEventListener('click', function() { activateMode('existing'); });
        slot.dataset.mode = 'new';
        return slot;
    }

    function _collectPracticePlayer(slot) {
        var mode = slot.dataset.mode;
        if (mode === 'existing') {
            var sel = slot.querySelector('.name-select');
            if (!sel.value) { sel.classList.add('error'); sel.focus(); return null; }
            return { mode: 'existing', id: parseInt(sel.value, 10), name: sel.options[sel.selectedIndex].textContent };
        } else {
            var input = slot.querySelector('.name-input');
            var name = input.value.trim();
            if (!name) { input.classList.add('error'); input.focus(); return null; }
            return { mode: 'new', name: name };
        }
    }

    // ------------------------------------------------------------------
    // Practice Screen
    // ------------------------------------------------------------------

    var _state = {
        matchId:       null,
        legId:         null,
        turnId:        null,
        playerId:      null,
        playerName:    '',
        dartsThrown:   0,
        totalScore:    0,
        turnScore:     0,
        segmentCounts: {},   // { '20': 5, 'T20': 3, ... }
        timerSeconds:  0,
        timerInterval: null,
        multiplier:    1,
        turnDarts:     0,     // darts in current turn (max 3)
        turnComplete:  false, // true after 3rd dart — waiting for NEXT
        onEnd:         null,  // stored so target completion can call it from any function
        // Target practice fields
        targetMode:    'free',   // 'free'|'segment'|'trebles'|'doubles'|'checkout'|'clock'
        targetConfig:  null,     // { segment, multiplier } for 'segment' mode
        targetHits:    0,
        targetAttempts:0,
        clockIndex:    0,        // 0-19, which number we're aiming at in clock mode
    };

    /**
     * Start a practice session.
     * @param {object} config  — { player: {id?, name, mode}, durationMinutes }
     * @param {Function} onEnd — called when session ends, returns to setup
     */
    function start(config, onEnd) {
        SPEECH.unlock();
        if (typeof SOUNDS !== 'undefined') SOUNDS.unlock();
        UI.setLoading(true);

        _resolvePracticePlayer(config.player)
            .then(function(player) {
                _state.playerId   = player.id;
                _state.playerName = player.name;
                _state.timerSeconds = config.durationMinutes * 60;
                _state.dartsThrown   = 0;
                _state.totalScore    = 0;
                _state.turnScore     = 0;
                _state.segmentCounts = {};
                _state.multiplier    = 1;
                _state.turnDarts     = 0;
                _state.targetMode    = config.targetMode    || 'free';
                _state.targetConfig  = config.targetConfig  || null;
                _state.targetHits    = 0;
                _state.targetAttempts = 0;
                _state.clockIndex    = 0;
                _state.onEnd         = onEnd;

                // Create a practice match + leg + turn in the DB
                return _createPracticeSession(player.id);
            })
            .then(function(session) {
                _state.matchId = session.matchId;
                _state.legId   = session.legId;
                _state.turnId  = session.turnId;
                UI.setLoading(false);
                _buildPracticeScreen(onEnd);
                _startTimer(onEnd);
                if (SPEECH.isEnabled()) {
                    SPEECH.announcePlayer(_state.playerName);
                }
            })
            .catch(function(err) {
                UI.setLoading(false);
                UI.showToast('ERROR: ' + err.message, 'bust', 3000);
            });
    }

    function _resolvePracticePlayer(playerConfig) {
        if (playerConfig.mode === 'existing') {
            return Promise.resolve({ id: playerConfig.id, name: playerConfig.name });
        }
        return API.createPlayer(playerConfig.name)
            .catch(function(err) {
                // 409 = already exists, fetch the existing player
                if (err.status === 409 || (err.message && err.message.indexOf('409') !== -1)) {
                    return API.getPlayers().then(function(players) {
                        var found = players.find(function(p) {
                            return p.name.toLowerCase() === playerConfig.name.toLowerCase();
                        });
                        if (found) return found;
                        throw new Error('Could not resolve player');
                    });
                }
                throw err;
            });
    }

    function _createPracticeSession(playerId) {
        return API.startPracticeSession({ player_id: playerId })
            .then(function(session) {
                return {
                    matchId: session.match_id,
                    legId:   session.leg_id,
                    turnId:  session.turn_id,
                };
            });
    }

    // ------------------------------------------------------------------
    // Practice Screen UI
    // ------------------------------------------------------------------

    function _buildPracticeScreen(onEnd) {
        var app = document.getElementById('app');
        app.innerHTML = '';
        app.style.cssText = '';
        document.body.className = 'mode-practice';

        // Header
        var header = document.createElement('header');
        header.id = 'practice-header';

        var titleEl = document.createElement('div');
        titleEl.className = 'practice-title';
        titleEl.textContent = _state.playerName.toUpperCase() + ' — PRACTICE';
        header.appendChild(titleEl);

        var timerEl = document.createElement('div');
        timerEl.id = 'practice-timer';
        timerEl.className = 'practice-timer';
        timerEl.textContent = _formatTime(_state.timerSeconds);
        header.appendChild(timerEl);

        var undoBtn = document.createElement('button');
        undoBtn.id = 'practice-undo-btn';
        undoBtn.className = 'practice-undo-btn';
        undoBtn.type = 'button';
        undoBtn.textContent = '\u21a9 UNDO';
        undoBtn.disabled = true;
        undoBtn.addEventListener('click', function() { _undoPracticeDart(); });
        header.appendChild(undoBtn);

        var nextBtn = document.createElement('button');
        nextBtn.id = 'practice-next-btn';
        nextBtn.className = 'practice-next-btn';
        nextBtn.type = 'button';
        nextBtn.textContent = 'NEXT \u2192';
        nextBtn.disabled = true;
        nextBtn.addEventListener('click', function() { _advanceToNextTurn(); });
        header.appendChild(nextBtn);

        var endBtn = document.createElement('button');
        endBtn.className = 'practice-end-btn';
        endBtn.type = 'button';
        endBtn.textContent = 'END';
        endBtn.addEventListener('click', function() {
            _endSession(onEnd);
        });
        header.appendChild(endBtn);

        app.appendChild(header);

        // Stats strip — layout depends on target mode
        var strip = document.createElement('div');
        strip.id = 'practice-strip';
        strip.className = 'practice-strip';
        if (_state.targetMode === 'free') {
            strip.innerHTML =
                '<div class="practice-stat"><div class="practice-stat-value" id="prac-darts">0</div><div class="practice-stat-label">DARTS</div></div>' +
                '<div class="practice-stat"><div class="practice-stat-value" id="prac-avg">0.0</div><div class="practice-stat-label">AVG / DART</div></div>' +
                '<div class="practice-stat"><div class="practice-stat-value" id="prac-turn">0.0</div><div class="practice-stat-label">3-DART AVG</div></div>' +
                '<div class="practice-stat"><div class="practice-stat-value" id="prac-best">—</div><div class="practice-stat-label">BEST SEG</div></div>';
        } else {
            var targetLabel = _state.targetMode === 'clock'
                ? _clockTarget()
                : (_state.targetConfig ? _state.targetConfig.label : '—');
            strip.innerHTML =
                '<div class="practice-stat practice-stat-target"><div class="practice-stat-value" id="prac-target">' + targetLabel + '</div><div class="practice-stat-label">TARGET</div></div>' +
                '<div class="practice-stat"><div class="practice-stat-value" id="prac-hits">0</div><div class="practice-stat-label">HITS</div></div>' +
                '<div class="practice-stat"><div class="practice-stat-value" id="prac-attempts">0</div><div class="practice-stat-label">DARTS</div></div>' +
                '<div class="practice-stat"><div class="practice-stat-value" id="prac-rate">0%</div><div class="practice-stat-label">HIT RATE</div></div>';
        }
        app.appendChild(strip);

        // Dart pills for current turn
        var pillRow = document.createElement('div');
        pillRow.id = 'practice-pills';
        pillRow.className = 'practice-pills';
        app.appendChild(pillRow);

        // Multiplier tabs
        var tabs = document.createElement('div');
        tabs.id = 'multiplier-tabs';
        [
            { label: 'Single', multiplier: 1, cls: 'active-single' },
            { label: 'Double', multiplier: 2, cls: 'active-double' },
            { label: 'Treble', multiplier: 3, cls: 'active-treble' },
        ].forEach(function(tab) {
            var btn = document.createElement('button');
            btn.className = 'tab-btn';
            btn.textContent = tab.label;
            btn.dataset.multiplier = tab.multiplier;
            btn.dataset.activeClass = tab.cls;
            btn.type = 'button';
            btn.addEventListener('click', function() {
                _state.multiplier = tab.multiplier;
                document.querySelectorAll('.tab-btn').forEach(function(b) {
                    b.classList.remove('active-single', 'active-double', 'active-treble');
                });
                btn.classList.add(tab.cls);
                document.body.dataset.multiplier = tab.multiplier;
            });
            tabs.appendChild(btn);
        });
        app.appendChild(tabs);
        // Set Single as default active
        tabs.querySelector('[data-multiplier="1"]').classList.add('active-single');
        document.body.dataset.multiplier = 1;

        // Segment grid (reuse existing structure from game board)
        var board = document.createElement('main');
        board.id = 'practice-board';
        board.appendChild(_buildPracticeSegmentGrid());
        board.appendChild(_buildPracticeBullRow());
        app.appendChild(board);

        // Highlight target segment(s) on the grid
        _applyTargetHighlights();
    }

    function _buildPracticeSegmentGrid() {
        var grid = document.createElement('div');
        grid.id = 'segment-grid';
        grid.className = 'segment-grid';
        var segments = [1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20];
        segments.forEach(function(seg) {
            var btn = document.createElement('button');
            btn.className = 'seg-btn';
            btn.dataset.segment = seg;
            btn.type = 'button';
            btn.textContent = seg;
            btn.addEventListener('click', function() { _recordPracticeDart(seg); });
            grid.appendChild(btn);
        });
        return grid;
    }

    function _buildPracticeBullRow() {
        var row = document.createElement('div');
        row.id = 'bull-row';
        row.className = 'bull-row';

        var miss = document.createElement('button');
        miss.className = 'seg-btn bull-btn';
        miss.type = 'button';
        miss.textContent = 'MISS';
        miss.addEventListener('click', function() { _recordPracticeDart(0); });
        row.appendChild(miss);

        var outer = document.createElement('button');
        outer.className = 'seg-btn bull-btn';
        outer.type = 'button';
        outer.textContent = 'OUTER';
        outer.dataset.segment = 25;
        outer.addEventListener('click', function() {
            _state.multiplier = 1;
            _recordPracticeDart(25);
        });
        row.appendChild(outer);

        var bull = document.createElement('button');
        bull.className = 'seg-btn bull-btn bull-btn-inner';
        bull.type = 'button';
        bull.textContent = 'BULL';
        bull.dataset.segment = 25;
        bull.addEventListener('click', function() {
            _state.multiplier = 2;
            _recordPracticeDart(25);
        });
        row.appendChild(bull);

        return row;
    }

    // ------------------------------------------------------------------
    // Dart recording
    // ------------------------------------------------------------------

    function _recordPracticeDart(segment) {
        var multiplier = _state.multiplier;
        var points = segment === 0 ? 0 : segment * multiplier;

        // Passes score_before: 0 every time — the throws endpoint auto-creates/
        // continues turns. For practice we don't track score countdown, only
        // accumulate stats, so score_before is always 0.
        API.recordThrow({
            leg_id:       _state.legId,
            player_id:    _state.playerId,
            segment:      segment,
            multiplier:   multiplier,
            score_before: 501, // practice has no countdown — high value prevents spurious busts
        })
        .then(function(result) {
            // Always capture turn_id — bust throws close the turn immediately
            // and the next dart opens a new turn with a different ID
            _state.turnId = result.turn_id;
            if (_state.turnDarts % 3 === 0) {
                _state.turnScore = 0;
            }

            _state.dartsThrown++;
            _state.totalScore += points;
            _state.turnScore  += points;
            _state.turnDarts++;

            // Track segment hits for best segment display
            if (segment > 0) {
                var key = (multiplier > 1 ? (multiplier === 2 ? 'D' : 'T') : '') + segment;
                _state.segmentCounts[key] = (_state.segmentCounts[key] || 0) + 1;
            }

            // Track target hits
            if (_state.targetMode !== 'free' && segment > 0) {
                _state.targetAttempts++;
                if (_isTargetHit(segment, multiplier)) {
                    _state.targetHits++;
                    // Clock mode: advance to next number on hit
                    if (_state.targetMode === 'clock') {
                        _state.clockIndex++;
                        _applyTargetHighlights();
                        // All 20 hit — show congratulations and stop processing
                        if (_state.clockIndex === 20) {
                            _addDartPill(segment, multiplier, points);
                            _updatePracticeStats();
                            _clockComplete(_state.onEnd);
                            return; // skip duplicate pill/stats calls below
                        }
                    }
                }
            }

            // Enable undo now a dart exists in this turn
            var undoB = document.getElementById('practice-undo-btn');
            if (undoB) undoB.disabled = false;

            // Dart thud
            if (typeof SOUNDS !== 'undefined' && SOUNDS.isEnabled()) {
                SOUNDS.dart();
            }

            if (SPEECH.isEnabled()) {
                SPEECH.announceDartScore(segment, multiplier, points);
            }

            // After 3rd dart: announce total, activate NEXT, lock board
            var dartsInTurn = _state.turnDarts % 3;
            if (dartsInTurn === 0) {
                _state.turnComplete = true;
                _lockBoard(true);
                var nb = document.getElementById('practice-next-btn');
                if (nb) nb.disabled = false;
                if (SPEECH.isEnabled()) {
                    setTimeout(function() {
                        SPEECH.announceTurnEnd(_state.turnScore, 0);
                    }, 900);
                }
            }

            _addDartPill(segment, multiplier, points);
            _updatePracticeStats();
        })
        .catch(function() {
            UI.showToast('ERROR RECORDING DART', 'bust', 2000);
        });
    }

    function _addDartPill(segment, multiplier, points) {
        var pills = document.getElementById('practice-pills');
        if (!pills) return;
        var pill = document.createElement('div');
        pill.className = 'dart-pill' + (points === 0 ? ' pill-miss' : points >= 60 ? ' pill-hot' : '');
        var label = points === 0 ? 'MISS' : CHECKOUT.formatDart(
            (multiplier === 3 ? 'T' : multiplier === 2 ? 'D' : 'S') + segment
        );
        pill.textContent = label + ' (' + points + ')';
        pills.appendChild(pill);
    }

    function _updatePracticeStats() {
        if (_state.targetMode === 'free') {
            var dartsEl = document.getElementById('prac-darts');
            var avgEl   = document.getElementById('prac-avg');
            var turnEl  = document.getElementById('prac-turn');
            var bestEl  = document.getElementById('prac-best');

            if (dartsEl) dartsEl.textContent = _state.dartsThrown;

            var avg = _state.dartsThrown > 0
                ? (_state.totalScore / _state.dartsThrown).toFixed(1) : '0.0';
            if (avgEl) avgEl.textContent = avg;

            var threeAvg = (_state.totalScore / Math.max(1, _state.dartsThrown) * 3).toFixed(1);
            if (turnEl) turnEl.textContent = threeAvg;

            var bestKey = '—'; var bestCount = 0;
            Object.keys(_state.segmentCounts).forEach(function(key) {
                if (_state.segmentCounts[key] > bestCount) {
                    bestCount = _state.segmentCounts[key]; bestKey = key;
                }
            });
            if (bestEl) bestEl.textContent = bestKey;
        } else {
            var targetEl   = document.getElementById('prac-target');
            var hitsEl     = document.getElementById('prac-hits');
            var attemptsEl = document.getElementById('prac-attempts');
            var rateEl     = document.getElementById('prac-rate');

            if (targetEl) {
                targetEl.textContent = _state.targetMode === 'clock'
                    ? _clockTarget() : (_state.targetConfig ? _state.targetConfig.label : '—');
            }
            if (hitsEl)     hitsEl.textContent     = _state.targetHits;
            if (attemptsEl) attemptsEl.textContent  = _state.targetAttempts;
            var rate = _state.targetAttempts > 0
                ? Math.round((_state.targetHits / _state.targetAttempts) * 100) + '%' : '0%';
            if (rateEl) rateEl.textContent = rate;
        }
    }

    // ------------------------------------------------------------------
    // Timer
    // ------------------------------------------------------------------

    function _startTimer(onEnd) {
        _state.timerInterval = setInterval(function() {
            _state.timerSeconds--;
            var timerEl = document.getElementById('practice-timer');
            if (timerEl) timerEl.textContent = _formatTime(_state.timerSeconds);

            // Warning colour in last 60 seconds
            if (_state.timerSeconds <= 60 && timerEl) {
                timerEl.classList.add('timer-warning');
            }

            if (_state.timerSeconds <= 0) {
                clearInterval(_state.timerInterval);
                _endSession(onEnd);
            }
        }, 1000);
    }

    function _formatTime(seconds) {
        var m = Math.floor(seconds / 60);
        var s = seconds % 60;
        return m + ':' + (s < 10 ? '0' : '') + s;
    }

    // ------------------------------------------------------------------
    // End session + summary
    // ------------------------------------------------------------------

    function _endSession(onEnd) {
        clearInterval(_state.timerInterval);

        // Close the practice match on the server
        API.endPracticeSession(_state.matchId)
            .catch(function() {}) // non-fatal
            .then(function() {
                _showSummary(onEnd);
            });
    }

    function _showSummary(onEnd) {
        var app = document.getElementById('app');
        app.innerHTML = '';
        document.body.className = 'mode-setup';

        var inner = document.createElement('div');
        inner.className = 'setup-screen-inner';
        app.appendChild(inner);

        var title = document.createElement('div');
        title.id = 'setup-title';
        title.innerHTML = '<div class="setup-logo">PRACTICE DONE</div>' +
            '<div class="setup-subtitle">' + _state.playerName.toUpperCase() + '</div>';
        inner.appendChild(title);

        // Heatmap
        var heatmapContainer = document.createElement('div');
        heatmapContainer.className = 'practice-heatmap';
        heatmapContainer.appendChild(_buildHeatmap());
        inner.appendChild(heatmapContainer);

        // Summary stats
        var summary = document.createElement('div');
        summary.className = 'practice-summary';

        var avg = _state.dartsThrown > 0
            ? (_state.totalScore / _state.dartsThrown).toFixed(1) : '0.0';
        var threeAvg = (parseFloat(avg) * 3).toFixed(1);
        var bestKey = '—';
        var bestCount = 0;
        Object.keys(_state.segmentCounts).forEach(function(key) {
            if (_state.segmentCounts[key] > bestCount) {
                bestCount = _state.segmentCounts[key];
                bestKey = key + ' ×' + bestCount;
            }
        });

        var summaryRows;
        if (_state.targetMode === 'free') {
            summaryRows = [
                { label: 'DARTS THROWN',  value: _state.dartsThrown },
                { label: 'TOTAL SCORE',   value: _state.totalScore },
                { label: 'AVG PER DART',  value: avg },
                { label: '3-DART AVG',    value: threeAvg },
                { label: 'MOST HIT',      value: bestKey },
            ];
        } else {
            var hitRate = _state.targetAttempts > 0
                ? Math.round((_state.targetHits / _state.targetAttempts) * 100) + '%' : '0%';
            var targetLabel = _state.targetConfig
                ? _state.targetConfig.label : _state.targetMode.toUpperCase();
            summaryRows = [
                { label: 'TARGET',        value: targetLabel },
                { label: 'DARTS THROWN',  value: _state.targetAttempts },
                { label: 'HITS',          value: _state.targetHits },
                { label: 'HIT RATE',      value: hitRate },
            ];
            if (_state.targetMode === 'clock') {
                summaryRows.push({ label: 'REACHED', value: _state.clockIndex + '/20' });
            }
        }
        summaryRows.forEach(function(row) {
            var item = document.createElement('div');
            item.className = 'practice-summary-row';
            item.innerHTML =
                '<span class="practice-summary-label">' + row.label + '</span>' +
                '<span class="practice-summary-value">' + row.value + '</span>';
            summary.appendChild(item);
        });
        inner.appendChild(summary);

        var doneBtn = document.createElement('button');
        doneBtn.className = 'start-btn';
        doneBtn.textContent = 'BACK TO SETUP';
        doneBtn.type = 'button';
        doneBtn.addEventListener('click', onEnd);
        inner.appendChild(doneBtn);
    }


    // ------------------------------------------------------------------
    // Target practice helpers
    // ------------------------------------------------------------------

    var CHECKOUT_DOUBLES = [20,16,10,8,4,2,1,25]; // D25 = Bull

    function _clockTarget() {
        return (_state.clockIndex < 20)
            ? String(_state.clockIndex + 1)
            : 'DONE';
    }

    function _isTargetHit(segment, multiplier) {
        switch (_state.targetMode) {
            case 'segment':
                var tc = _state.targetConfig;
                if (!tc) return false;
                if (tc.segment === 25) {
                    // Bull family: match exact multiplier
                    return segment === 25 && multiplier === tc.multiplier;
                }
                return segment === tc.segment && multiplier === tc.multiplier;
            case 'trebles':
                return multiplier === 3;
            case 'doubles':
                return multiplier === 2 || (segment === 25 && multiplier === 2);
            case 'checkout':
                // Any double on a checkout double segment, or Bull
                return (multiplier === 2 && CHECKOUT_DOUBLES.indexOf(segment) !== -1);
            case 'clock':
                if (_state.clockIndex >= 20) return false; // already done
                var target = _state.clockIndex + 1;
                return segment === target; // any multiplier counts
            default:
                return false;
        }
    }

    function _applyTargetHighlights() {
        if (_state.targetMode === 'free') return;

        // Clear existing highlights
        document.querySelectorAll('.seg-btn').forEach(function(btn) {
            btn.classList.remove('target-highlight');
        });

        function highlight(seg) {
            // Segment grid buttons
            var btn = document.querySelector('#segment-grid .seg-btn[data-segment="' + seg + '"]');
            if (btn) btn.classList.add('target-highlight');
            // Bull row buttons
            var bullBtn = document.querySelector('#bull-row .seg-btn[data-segment="' + seg + '"]');
            if (bullBtn) bullBtn.classList.add('target-highlight');
        }

        function highlightMiss() {
            var missBtn = document.querySelector('#bull-row .seg-btn:not([data-segment])');
            // Don't highlight MISS button
        }

        switch (_state.targetMode) {
            case 'segment':
                var tc = _state.targetConfig;
                if (tc) highlight(tc.segment);
                break;
            case 'trebles':
                for (var s = 1; s <= 20; s++) highlight(s);
                break;
            case 'doubles':
                for (var s = 1; s <= 20; s++) highlight(s);
                highlight(25);
                break;
            case 'checkout':
                CHECKOUT_DOUBLES.forEach(function(seg) { highlight(seg); });
                break;
            case 'clock':
                var t = _state.clockIndex + 1;
                if (t <= 20) highlight(t);
                break;
        }

        // For trebles/doubles modes also lock the multiplier tab
        if (_state.targetMode === 'trebles') {
            _setMultiplierTab(3);
        } else if (_state.targetMode === 'doubles' || _state.targetMode === 'checkout') {
            _setMultiplierTab(2);
        }
    }

    function _setMultiplierTab(mul) {
        _state.multiplier = mul;
        document.querySelectorAll('.tab-btn').forEach(function(b) {
            b.classList.remove('active-single', 'active-double', 'active-treble');
        });
        var cls = mul === 3 ? 'active-treble' : mul === 2 ? 'active-double' : 'active-single';
        var tab = document.querySelector('.tab-btn[data-multiplier="' + mul + '"]');
        if (tab) tab.classList.add(cls);
        document.body.dataset.multiplier = mul;
    }

    // ------------------------------------------------------------------
    // Target selection modal
    // ------------------------------------------------------------------

    function _showTargetModal(onSelect) {
        var existing = document.getElementById('target-modal');
        if (existing) existing.remove();

        var overlay = document.createElement('div');
        overlay.id = 'target-modal';
        overlay.className = 'modal-overlay';

        var box = document.createElement('div');
        box.className = 'modal-box target-modal-box';

        var titleEl = document.createElement('div');
        titleEl.className = 'modal-title';
        titleEl.textContent = 'SELECT TARGET';
        box.appendChild(titleEl);

        // ---- Category tabs ----
        var cats = [
            { id: 'single',   label: 'SINGLE SEGMENT' },
            { id: 'group',    label: 'GROUP TARGET'   },
        ];
        var catBar = document.createElement('div');
        catBar.className = 'target-cat-bar';
        var activeCat = 'single';

        var panels = {};

        cats.forEach(function(cat, i) {
            var btn = document.createElement('button');
            btn.className = 'target-cat-btn' + (i === 0 ? ' active' : '');
            btn.type = 'button';
            btn.textContent = cat.label;
            btn.addEventListener('click', function() {
                activeCat = cat.id;
                catBar.querySelectorAll('.target-cat-btn').forEach(function(b) { b.classList.remove('active'); });
                btn.classList.add('active');
                Object.keys(panels).forEach(function(k) {
                    panels[k].style.display = k === cat.id ? '' : 'none';
                });
            });
            catBar.appendChild(btn);
        });
        box.appendChild(catBar);

        // ── Single segment panel ──
        var singlePanel = document.createElement('div');
        singlePanel.className = 'target-panel';
        panels['single'] = singlePanel;

        var segCats = [
            { label: 'TREBLES', segs: [20,19,18,17,16,15,14,13,12,11,10,9,8,7,6,5,4,3,2,1],
              mul: 3, prefix: 'T' },
            { label: 'DOUBLES', segs: [20,19,18,17,16,15,14,13,12,11,10,9,8,7,6,5,4,3,2,1],
              mul: 2, prefix: 'D' },
            { label: 'SINGLES', segs: [20,19,18,17,16,15,14,13,12,11,10,9,8,7,6,5,4,3,2,1],
              mul: 1, prefix: 'S' },
            { label: 'BULL',    segs: [25],
              mul: null, prefix: null },
        ];

        var activeSegCat = 0;
        var segCatBar = document.createElement('div');
        segCatBar.className = 'target-segcat-bar';
        var segPanels = {};

        segCats.forEach(function(sc, i) {
            var scBtn = document.createElement('button');
            scBtn.className = 'target-segcat-btn' + (i === 0 ? ' active' : '');
            scBtn.type = 'button';
            scBtn.textContent = sc.label;
            scBtn.addEventListener('click', function() {
                segCatBar.querySelectorAll('.target-segcat-btn').forEach(function(b) { b.classList.remove('active'); });
                scBtn.classList.add('active');
                Object.keys(segPanels).forEach(function(k) {
                    segPanels[k].style.display = k === String(i) ? '' : 'none';
                });
            });
            segCatBar.appendChild(scBtn);
        });
        singlePanel.appendChild(segCatBar);

        segCats.forEach(function(sc, i) {
            var grid = document.createElement('div');
            grid.className = 'target-seg-grid';
            grid.style.display = i === 0 ? '' : 'none';
            segPanels[String(i)] = grid;

            if (sc.label === 'BULL') {
                // Two options: Outer Bull (S25) and Bull (D25)
                [{label: 'OUTER BULL', seg: 25, mul: 1},
                 {label: 'BULL',       seg: 25, mul: 2}].forEach(function(b) {
                    var btn = document.createElement('button');
                    btn.className = 'target-seg-btn';
                    btn.type = 'button';
                    btn.textContent = b.label;
                    btn.addEventListener('click', function() {
                        overlay.remove();
                        onSelect({
                            type:      'segment',
                            label:     b.label,
                            segment:   b.seg,
                            multiplier: b.mul,
                        });
                    });
                    grid.appendChild(btn);
                });
            } else {
                sc.segs.forEach(function(seg) {
                    var btn = document.createElement('button');
                    btn.className = 'target-seg-btn';
                    btn.type = 'button';
                    btn.textContent = sc.prefix + seg;
                    btn.addEventListener('click', function() {
                        overlay.remove();
                        onSelect({
                            type:       'segment',
                            label:      sc.prefix + seg,
                            segment:    seg,
                            multiplier: sc.mul,
                        });
                    });
                    grid.appendChild(btn);
                });
            }
            singlePanel.appendChild(grid);
        });
        box.appendChild(singlePanel);

        // ── Group targets panel ──
        var groupPanel = document.createElement('div');
        groupPanel.className = 'target-panel';
        groupPanel.style.display = 'none';
        panels['group'] = groupPanel;

        var groups = [
            { type: 'trebles',  label: 'ALL TREBLES',
              desc: 'Hit any treble — tracks treble rate across all segments' },
            { type: 'doubles',  label: 'ALL DOUBLES',
              desc: 'Hit any double — great for checkout training' },
            { type: 'checkout', label: 'CHECKOUT DOUBLES',
              desc: 'D20 D16 D10 D8 D4 D2 D1 Bull — the key finishing doubles' },
            { type: 'clock',    label: 'AROUND THE CLOCK',
              desc: 'Hit 1 through 20 in order — any multiplier counts' },
        ];

        groups.forEach(function(g) {
            var card = document.createElement('button');
            card.className = 'target-group-card';
            card.type = 'button';
            card.innerHTML =
                '<span class="target-group-label">' + g.label + '</span>' +
                '<span class="target-group-desc">'  + g.desc  + '</span>';
            card.addEventListener('click', function() {
                overlay.remove();
                onSelect({
                    type:  g.type,
                    label: g.label,
                    segment:    null,
                    multiplier: null,
                });
            });
            groupPanel.appendChild(card);
        });
        box.appendChild(groupPanel);

        // Cancel
        var cancelBtn = document.createElement('button');
        cancelBtn.className = 'stats-cancel-btn';
        cancelBtn.type = 'button';
        cancelBtn.textContent = '✕  CANCEL';
        cancelBtn.addEventListener('click', function() { overlay.remove(); });
        box.appendChild(cancelBtn);

        overlay.appendChild(box);
        overlay.addEventListener('click', function(e) { if (e.target === overlay) overlay.remove(); });
        document.body.appendChild(overlay);
    }

    // ------------------------------------------------------------------
    // Undo last dart
    // ------------------------------------------------------------------

    function _undoPracticeDart() {
        // Allow undo if darts have been thrown this turn (including completed turns)
        var dartsThisTurn = _state.turnDarts % 3 === 0 && _state.turnComplete
            ? 3
            : _state.turnDarts % 3;
        if (dartsThisTurn === 0) return;

        var undoBtn = document.getElementById('practice-undo-btn');
        if (undoBtn) undoBtn.disabled = true;

        API.undoLastThrow(_state.turnId)
            .then(function(result) {
                var deleted = result.deleted_throw;
                var points  = deleted.points || 0;

                // Reverse state
                _state.dartsThrown  = Math.max(0, _state.dartsThrown - 1);
                _state.totalScore   = Math.max(0, _state.totalScore - points);
                _state.turnScore    = Math.max(0, _state.turnScore - points);
                _state.turnDarts    = Math.max(0, _state.turnDarts - 1);

                // If we just undid within a completed turn, unlock the board
                if (_state.turnComplete) {
                    _state.turnComplete = false;
                    _lockBoard(false);
                    var nb = document.getElementById('practice-next-btn');
                    if (nb) nb.disabled = true;
                }

                // Reverse segment count
                var seg = deleted.segment;
                var mul = deleted.multiplier;
                if (seg > 0) {
                    var key = (mul > 1 ? (mul === 2 ? 'D' : 'T') : '') + seg;
                    _state.segmentCounts[key] = Math.max(0, (_state.segmentCounts[key] || 1) - 1);
                    if (_state.segmentCounts[key] === 0) delete _state.segmentCounts[key];
                }

                // Remove last pill
                var pills = document.getElementById('practice-pills');
                if (pills && pills.lastChild) pills.removeChild(pills.lastChild);

                // Undo still available if darts remain in this turn
                var remaining = _state.turnDarts % 3;
                if (undoBtn) undoBtn.disabled = (remaining === 0 && !_state.turnComplete);

                // Re-announce corrected turn score after undo so caller
                // reads the updated total before user decides to NEXT or undo again
                if (_state.turnDarts % 3 > 0 && SPEECH.isEnabled()) {
                    setTimeout(function() {
                        SPEECH.announceTurnEnd(_state.turnScore, 0);
                    }, 400);
                }

                _updatePracticeStats();
            })
            .catch(function() {
                UI.showToast('UNDO FAILED', 'bust', 2000);
                if (undoBtn) undoBtn.disabled = false;
            });
    }

    function _advanceToNextTurn() {
        // Clear pills, unlock board, reset turn state
        var pills = document.getElementById('practice-pills');
        if (pills) pills.innerHTML = '';

        var nextBtn = document.getElementById('practice-next-btn');
        if (nextBtn) nextBtn.disabled = true;

        var undoBtn = document.getElementById('practice-undo-btn');
        if (undoBtn) undoBtn.disabled = true;

        _state.turnComplete = false;
        _state.turnScore    = 0;
        _lockBoard(false);
    }

    function _lockBoard(locked) {
        var board = document.getElementById('practice-board');
        if (!board) return;
        board.querySelectorAll('.seg-btn').forEach(function(btn) {
            btn.disabled = locked;
        });
        var tabs = document.getElementById('multiplier-tabs');
        if (tabs) tabs.querySelectorAll('.tab-btn').forEach(function(btn) {
            btn.disabled = locked;
        });
    }

    // ------------------------------------------------------------------
    // Around the Clock completion
    // ------------------------------------------------------------------

    function _clockComplete(onEnd) {
        // Stop the timer
        if (_state.timerInterval) {
            clearInterval(_state.timerInterval);
            _state.timerInterval = null;
        }

        // End the DB session
        API.endPracticeSession(_state.matchId).catch(function() {});

        // Play checkout sound + speech
        if (typeof SOUNDS !== 'undefined' && SOUNDS.isEnabled()) {
            SOUNDS.checkout();
        }
        if (SPEECH.isEnabled()) {
            setTimeout(function() {
                SPEECH.announceCheckout(0);  // triggers sound guard already called above
            }, 300);
        }

        // Show congratulations modal
        var overlay = document.createElement('div');
        overlay.id = 'clock-complete-modal';
        overlay.className = 'modal-overlay';

        var box = document.createElement('div');
        box.className = 'modal-box clock-complete-box';

        box.innerHTML =
            '<div class="clock-complete-icon">🎯</div>' +
            '<div class="modal-title">AROUND THE CLOCK!</div>' +
            '<div class="modal-subtitle">All 20 segments hit in order</div>' +
            '<div class="clock-complete-stats">' +
                '<div class="clock-complete-stat">' +
                    '<span class="clock-stat-value">' + _state.targetAttempts + '</span>' +
                    '<span class="clock-stat-label">DARTS THROWN</span>' +
                '</div>' +
                '<div class="clock-complete-stat">' +
                    '<span class="clock-stat-value">' +
                        Math.round((_state.targetHits / Math.max(1, _state.targetAttempts)) * 100) + '%' +
                    '</span>' +
                    '<span class="clock-stat-label">HIT RATE</span>' +
                '</div>' +
            '</div>';

        var doneBtn = document.createElement('button');
        doneBtn.className = 'start-btn';
        doneBtn.type = 'button';
        doneBtn.textContent = 'BACK TO SETUP';
        doneBtn.addEventListener('click', function() {
            overlay.remove();
            onEnd();
        });
        box.appendChild(doneBtn);

        overlay.appendChild(box);
        document.body.appendChild(overlay);
    }

    // ------------------------------------------------------------------
    // SVG Dartboard Heatmap
    // ------------------------------------------------------------------

    /**
     * Build an SVG dartboard heatmap from _state.segmentCounts.
     *
     * Segment ring structure (radii as fractions of board radius):
     *   Bull       0  -> 0.06
     *   Outer bull 0.06 -> 0.12
     *   Single (inner) 0.12 -> 0.47
     *   Treble     0.47 -> 0.54
     *   Single (outer) 0.54 -> 0.83
     *   Double     0.83 -> 0.95
     *   Wire (outer) 0.95 -> 1.0
     *
     * Segment order clockwise from top: 20,1,18,4,13,6,10,15,2,17,3,19,7,16,8,11,14,9,12,5
     */
    function _buildHeatmap() {
        var SEGMENTS = [20,1,18,4,13,6,10,15,2,17,3,19,7,16,8,11,14,9,12,5];
        var SIZE     = 320;
        var CX = SIZE / 2, CY = SIZE / 2;
        var R  = SIZE / 2 - 4;   // board radius with small margin

        // Radii fractions
        var rBull     = R * 0.06;
        var rOuter    = R * 0.13;
        var rInner1   = R * 0.47;
        var rTreble1  = R * 0.47;
        var rTreble2  = R * 0.55;
        var rInner2   = R * 0.55;
        var rDouble1  = R * 0.84;
        var rDouble2  = R * 0.97;

        // Angle per segment (18 degrees each, starting from -99 degrees
        // so segment 20 is at the top)
        var SEG_ANGLE = 360 / 20;
        var START_OFFSET = -SEG_ANGLE / 2;  // segment 20 centred at 12 o'clock

        // Collect hit counts per zone for colour scaling
        var counts = _state.segmentCounts;
        var maxHits = 1;
        Object.keys(counts).forEach(function(k) {
            if (counts[k] > maxHits) maxHits = counts[k];
        });

        function getHits(seg, prefix) {
            // prefix: '' = single, 'D' = double, 'T' = treble
            return counts[prefix + seg] || 0;
        }

        function heatColour(hits) {
            if (hits === 0) return null;
            var t = Math.min(hits / maxHits, 1);
            // Dark amber at low end, bright amber at high end
            // 0 hits = no overlay, >0 = amber glow scaling to full
            var alpha = 0.2 + t * 0.75;
            return 'rgba(240,165,0,' + alpha.toFixed(2) + ')';
        }

        function polarToXY(angleDeg, radius) {
            var rad = (angleDeg - 90) * Math.PI / 180;
            return {
                x: CX + radius * Math.cos(rad),
                y: CY + radius * Math.sin(rad),
            };
        }

        function arcPath(r1, r2, startAngle, endAngle) {
            var p1 = polarToXY(startAngle, r1);
            var p2 = polarToXY(endAngle,   r1);
            var p3 = polarToXY(endAngle,   r2);
            var p4 = polarToXY(startAngle, r2);
            var large = (endAngle - startAngle) > 180 ? 1 : 0;
            return [
                'M', p1.x, p1.y,
                'A', r1, r1, 0, large, 1, p2.x, p2.y,
                'L', p3.x, p3.y,
                'A', r2, r2, 0, large, 0, p4.x, p4.y,
                'Z'
            ].join(' ');
        }

        // SVG namespace helper
        function el(tag, attrs) {
            var e = document.createElementNS('http://www.w3.org/2000/svg', tag);
            Object.keys(attrs).forEach(function(k) { e.setAttribute(k, attrs[k]); });
            return e;
        }

        function tooltip(svgEl, text) {
            var t = document.createElementNS('http://www.w3.org/2000/svg', 'title');
            t.textContent = text;
            svgEl.appendChild(t);
        }

        var svg = el('svg', {
            viewBox: '0 0 ' + SIZE + ' ' + SIZE,
            width:   '100%',
            style:   'max-width:320px;display:block;margin:0 auto;',
        });

        // Background circle
        svg.appendChild(el('circle', { cx: CX, cy: CY, r: R,
            fill: '#111', stroke: '#333', 'stroke-width': '1' }));

        // Draw each of the 20 segments
        SEGMENTS.forEach(function(seg, i) {
            var startAngle = START_OFFSET + i * SEG_ANGLE;
            var endAngle   = startAngle + SEG_ANGLE;

            var singleHits  = getHits(seg, '');
            var trebleHits  = getHits(seg, 'T');
            var doubleHits  = getHits(seg, 'D');

            var zones = [
                // [r1, r2, hits, zone label]
                { r1: rOuter,   r2: rInner1,  hits: singleHits, label: 'S' },
                { r1: rTreble1, r2: rTreble2, hits: trebleHits, label: 'T' },
                { r1: rInner2,  r2: rDouble1, hits: singleHits, label: 'S' },
                { r1: rDouble1, r2: rDouble2, hits: doubleHits, label: 'D' },
            ];

            zones.forEach(function(zone) {
                var path = el('path', {
                    d:    arcPath(zone.r1, zone.r2, startAngle, endAngle),
                    fill: '#1a1a1a',
                    stroke: '#2a2a2a',
                    'stroke-width': '0.5',
                });

                var colour = heatColour(zone.hits);
                if (colour) {
                    var overlay = el('path', {
                        d:    arcPath(zone.r1, zone.r2, startAngle, endAngle),
                        fill: colour,
                        stroke: 'none',
                        'pointer-events': 'none',
                    });
                    svg.appendChild(path);
                    svg.appendChild(overlay);
                } else {
                    svg.appendChild(path);
                }

                // Hit count label in treble ring if >0
                if (zone.hits > 0 && zone.label !== 'S') {
                    var midAngle = startAngle + SEG_ANGLE / 2;
                    var midR = (zone.r1 + zone.r2) / 2;
                    var mp = polarToXY(midAngle, midR);
                    var t = el('text', {
                        x: mp.x, y: mp.y,
                        'text-anchor': 'middle',
                        'dominant-baseline': 'central',
                        fill: '#fff',
                        'font-size': '7',
                        'font-family': 'monospace',
                        'pointer-events': 'none',
                    });
                    t.textContent = zone.hits;
                    svg.appendChild(t);
                }

                // Invisible touch target with tooltip
                var hitTotal  = zone.hits * (zone.label === 'T' ? 3 : zone.label === 'D' ? 2 : 1) * seg;
                var touchTarget = el('path', {
                    d:    arcPath(zone.r1, zone.r2, startAngle, endAngle),
                    fill: 'transparent',
                    stroke: 'none',
                    cursor: 'pointer',
                });
                tooltip(touchTarget,
                    zone.label + seg +
                    ' — ' + zone.hits + ' hit' + (zone.hits !== 1 ? 's' : '') +
                    ' — ' + hitTotal + ' pts'
                );
                svg.appendChild(touchTarget);
            });

            // Segment number label in outer single ring
            var midAngle = startAngle + SEG_ANGLE / 2;
            var labelR   = (rDouble2 + R) / 2;
            var lp = polarToXY(midAngle, labelR);
            // Rotate label to be readable
            var rotate = midAngle + 90;
            var lbl = el('text', {
                x: lp.x, y: lp.y,
                'text-anchor': 'middle',
                'dominant-baseline': 'central',
                fill: '#666',
                'font-size': '8',
                'font-family': 'monospace',
                transform: 'rotate(' + rotate + ',' + lp.x + ',' + lp.y + ')',
                'pointer-events': 'none',
            });
            lbl.textContent = seg;
            svg.appendChild(lbl);
        });

        // Outer bull ring
        var outerBullHits = getHits(25, '');
        var outerBullColour = heatColour(outerBullHits);
        var outerBull = el('circle', { cx: CX, cy: CY, r: rOuter,
            fill: '#1a1a1a', stroke: '#2a2a2a', 'stroke-width': '0.5' });
        svg.appendChild(outerBull);
        if (outerBullColour) {
            var outerBullOverlay = el('circle', { cx: CX, cy: CY, r: rOuter,
                fill: outerBullColour, stroke: 'none', 'pointer-events': 'none' });
            svg.appendChild(outerBullOverlay);
        }
        var obTarget = el('circle', { cx: CX, cy: CY, r: rOuter,
            fill: 'transparent', stroke: 'none', cursor: 'pointer' });
        var obScore = outerBullHits * 25;
        tooltip(obTarget, 'Outer Bull — ' + outerBullHits + ' hits — ' + obScore + ' pts');
        svg.appendChild(obTarget);

        // Bull (double bull)
        var bullHits = getHits(25, 'D');
        var bullColour = heatColour(bullHits);
        var bull = el('circle', { cx: CX, cy: CY, r: rBull,
            fill: '#1a1a1a', stroke: '#2a2a2a', 'stroke-width': '0.5' });
        svg.appendChild(bull);
        if (bullColour) {
            var bullOverlay = el('circle', { cx: CX, cy: CY, r: rBull,
                fill: bullColour, stroke: 'none', 'pointer-events': 'none' });
            svg.appendChild(bullOverlay);
        }
        var bullTarget = el('circle', { cx: CX, cy: CY, r: rBull,
            fill: 'transparent', stroke: 'none', cursor: 'pointer' });
        var bullScore = bullHits * 50;
        tooltip(bullTarget, 'Bull — ' + bullHits + ' hits — ' + bullScore + ' pts');
        svg.appendChild(bullTarget);

        // Bull text
        if (bullHits > 0) {
            var bt = el('text', { x: CX, y: CY,
                'text-anchor': 'middle', 'dominant-baseline': 'central',
                fill: '#fff', 'font-size': '7', 'font-family': 'monospace',
                'pointer-events': 'none' });
            bt.textContent = bullHits;
            svg.appendChild(bt);
        }

        // Legend
        var legendY = SIZE - 10;
        ['0 hits', '≥1 hit', 'max hits'].forEach(function(label, i) {
            var lx = 16 + i * 100;
            var rect = el('rect', { x: lx, y: legendY - 6, width: 10, height: 10,
                rx: 2, fill: i === 0 ? '#1a1a1a' : i === 1 ? 'rgba(240,165,0,0.25)' : 'rgba(240,165,0,0.95)',
                stroke: '#333', 'stroke-width': '0.5' });
            svg.appendChild(rect);
            var lt = el('text', { x: lx + 13, y: legendY + 1,
                fill: '#666', 'font-size': '8', 'font-family': 'monospace',
                'dominant-baseline': 'central' });
            lt.textContent = label;
            svg.appendChild(lt);
        });

        return svg;
    }

    // ------------------------------------------------------------------

    return {
        showSetup: showSetup,
        start:     start,
    };

}());