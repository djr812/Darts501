/**
 * speech.js
 * ---------
 * Darts scorer speech synthesis.
 *
 * Speaks dart scores and remaining totals in classic caller style.
 * Built on Web Speech Synthesis API (supported Safari 7+ / iOS 7+).
 *
 * Public API:
 *   SPEECH.isSupported()               → bool
 *   SPEECH.isEnabled()                 → bool
 *   SPEECH.setEnabled(bool)            → void
 *   SPEECH.announceTurnScore(points)   → void  — called after each dart
 *   SPEECH.announceRemaining(score)    → void  — called after turn ends (score ≤ 170)
 *   SPEECH.announceBust()              → void
 *   SPEECH.announceCheckout(points)    → void
 */

var SPEECH = (function() {

    var _enabled = false;

    // ------------------------------------------------------------------
    // Support check
    // ------------------------------------------------------------------

    function isSupported() {
        return !!(window.speechSynthesis && window.SpeechSynthesisUtterance);
    }

    function isEnabled() { return _enabled; }

    function setEnabled(val) {
        _enabled = !!val;
        // Cancel any in-flight speech when toggled off
        if (!_enabled && isSupported()) window.speechSynthesis.cancel();
    }

    // ------------------------------------------------------------------
    // Core speak helper
    // ------------------------------------------------------------------

    function _speak(text, priority) {
        if (!_enabled || !isSupported()) return;
        // Cancel current utterance for high-priority announcements (new dart)
        // so queued speech doesn't pile up during fast scoring
        if (priority) window.speechSynthesis.cancel();
        var u = new SpeechSynthesisUtterance(text);
        u.lang  = 'en-GB';   // British English — fits darts well
        u.rate  = 1.05;       // Slightly brisk, like a real caller
        u.pitch = 1.0;
        window.speechSynthesis.speak(u);
    }

    // ------------------------------------------------------------------
    // Score phrasing
    // Classic darts caller phrases for notable scores
    // ------------------------------------------------------------------

    var SPECIAL_SCORES = {
        180: 'One hundred and eighty!',
        171: 'One hundred and seventy one',
        170: 'One hundred and seventy',
        167: 'One hundred and sixty seven',
        164: 'One hundred and sixty four',
        161: 'One hundred and sixty one',
        160: 'One hundred and sixty',
        157: 'One hundred and fifty seven',
        156: 'One hundred and fifty six',
        155: 'One hundred and fifty five',
        154: 'One hundred and fifty four',
        153: 'One hundred and fifty three',
        152: 'One hundred and fifty two',
        151: 'One hundred and fifty one',
        150: 'One hundred and fifty',
        140: 'Ton forty',
        141: 'Ton forty one',
        100: 'Ton',
        101: 'Ton and one',
        60:  'Sixty',
        26:  'Twenty six',
        41:  'Forty one',
        45:  'Forty five',
        85:  'Eighty five',
    };

    // Numbers 1–20 as words (for "N remaining" phrasing)
    var ONES = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven',
                'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen',
                'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen',
                'nineteen', 'twenty'];
    var TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty',
                'seventy', 'eighty', 'ninety'];

    function _numberToWords(n) {
        if (n === 0) return 'zero';
        if (n <= 20) return ONES[n];
        if (n < 100) {
            var t = Math.floor(n / 10);
            var o = n % 10;
            return o === 0 ? TENS[t] : TENS[t] + ' ' + ONES[o];
        }
        if (n < 200) {
            var rest = n - 100;
            if (rest === 0) return 'one hundred';
            return 'one hundred and ' + _numberToWords(rest);
        }
        // 200–180 range handled above via SPECIAL_SCORES mostly,
        // but handle generically just in case
        var h = Math.floor(n / 100);
        var r = n % 100;
        var base = ONES[h] + ' hundred';
        return r === 0 ? base : base + ' and ' + _numberToWords(r);
    }

    function _phraseScore(points) {
        if (SPECIAL_SCORES[points]) return SPECIAL_SCORES[points];

        // Ton+ range (101–179, excluding specials above)
        if (points >= 101 && points <= 180) {
            return 'One hundred and ' + _numberToWords(points - 100);
        }

        return _numberToWords(points);
    }

    function _phraseRemaining(score) {
        // e.g. "Forty five remaining" / "double top to finish" etc.
        if (score === 0)  return '';           // already checked out
        if (score === 2)  return 'Double one';
        if (score === 50) return 'Bull';

        // Clean double finish
        if (score <= 40 && score % 2 === 0) {
            return 'Double ' + _numberToWords(score / 2) + ' remaining';
        }

        return _numberToWords(score) + ' remaining';
    }

    // ------------------------------------------------------------------
    // Public announcement methods
    // ------------------------------------------------------------------

    /**
     * Speak the score of a single dart throw.
     * Called immediately after each dart is recorded.
     * Only speaks the dart's point value — the remaining announcement
     * happens separately after the turn ends.
     *
     * @param {number} points  — raw points for this dart (0–60)
     */
    function announceDartScore(points) {
        if (!_enabled) return;
        if (points === 0) {
            _speak('Miss', true);
            return;
        }
        _speak(_phraseScore(points), true);
    }

    /**
     * Speak the turn total and remaining score after a full turn.
     * Only announces remaining if score ≤ 170.
     *
     * @param {number} turnPoints  — total scored this turn (score_before - score_after)
     * @param {number} remaining   — player's score after the turn
     */
    function announceTurnEnd(turnPoints, remaining) {
        if (!_enabled) return;

        var phrase = _phraseScore(turnPoints);

        if (remaining > 0 && remaining <= 170) {
            phrase = phrase + '... ' + _phraseRemaining(remaining);
        }

        _speak(phrase, false);
    }

    /**
     * Speak a bust.
     */
    function announceBust() {
        _speak('Bust!', true);
    }

    /**
     * Speak a checkout.
     * @param {number} points — the score checked out on
     */
    function announceCheckout(points) {
        var phrase = _phraseScore(points) + '... checkout!';
        _speak(phrase, true);
    }

    // ------------------------------------------------------------------

    return {
        isSupported:      isSupported,
        isEnabled:        isEnabled,
        setEnabled:       setEnabled,
        announceDartScore: announceDartScore,
        announceTurnEnd:  announceTurnEnd,
        announceBust:     announceBust,
        announceCheckout: announceCheckout,
    };

}());