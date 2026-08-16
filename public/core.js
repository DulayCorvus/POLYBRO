/* ===========================================================================
   core.js — additive feature layer, shared by cpp.html and htmlcss_1.html.

   Loaded via <script src="core.js"></script> AFTER the page's own inline
   <script> block. Everything here is purely additive:
     - No existing function body is edited — globals like render(), addXP(),
       updateMastery(), and submitQuiz() are wrapped (original saved and
       still called), never replaced.
     - No new UI is injected inside #app. Every element this file creates
       is appended directly to <body>, so the host page's own re-renders
       (which do `app.innerHTML = ...`) never touch or wipe it out.
     - New state lives under STATE.badges, a key neither file's
       DEFAULT_STATE defines. It rides along with the existing
       saveState()/progressSet() persistence automatically — no changes
       needed to the host file's persistence code.

   Both cpp.html and htmlcss_1.html expose the same set of globals this
   file depends on (STATE, QUIZZES, CHAPTERS, render, rerenderMain,
   saveState, addXP, updateMastery, escapeHtml, getMastery, currentUser),
   so this one file works unmodified on either page.

   Features:
     1. Achievements / badges — unlockable milestones based on existing
        STATE fields, with a toast on unlock and a browsable panel.
     2. Weak-topics review — a flashcard-style practice session pulling
        the lowest-mastery tags out of the existing QUIZZES data, separate
        from the real graded quiz engine (QUIZ_STATE) so it can never
        collide with an in-progress quiz.
     3. Missed-questions quiz recap — after a real quiz is submitted, an
        overlay summarizes just the questions the learner got wrong (with
        the correct answer and explain text), so they don't have to scroll
        the full quiz to find what to review. Reads QUIZ_STATE directly,
        immediately after the host page's own submitQuiz() has already
        graded it (q.correct / q.partialScore are set by then).
     4. "Show explanation on every question" toggle — a floating pill,
        visible only while STATE.currentView.type === 'quiz', that flips
        STATE.showAllExplains. When on, renderQuizQuestion's wrapper
        splices a .qexplain block onto correctly-answered questions too
        (missed questions already get one from the original function) —
        no string surgery on the *gating* logic itself, just an additive
        append onto the already-rendered HTML when it's missing.
     5. Daily practice reminder / streak-at-risk nudge — a small dismissible
        banner shown in the evening (local time) if STATE.lastActiveDate
        isn't today yet. Reads STATE.lastActiveDate / STATE.streak, which
        the host page's own touchStreak() already maintains — nothing new
        to persist. Driven by its own setInterval, not a render hook.
     6. Editor keyboard shortcuts — Ctrl/Cmd+Enter runs the current
        challenge (#prob-editor/#proj-editor/#machine-editor -> runProblem()/
        runProject()/runMachine()), Ctrl/Cmd+(forward slash) toggles a
        comment on the current line/selection: per-line "//" on cpp.html,
        a single wrapping HTML or CSS comment on htmlcss_1.html (which
        one is chosen by cursor position, since that page mixes markup
        and an inline style block with no shared comment syntax). One
        delegated keydown listener on document, installed once at
        startup — not attached to the editors themselves, since render()/
        rerenderMain() recreate those textareas on every re-render.
     7. Unified search (Ctrl/Cmd+K) — a single search box over lesson
        titles (CHAPTERS), project titles (PROJECTS), and glossary terms
        (GLOSSARY). Picking a lesson/project result calls the host page's
        own goTo('lesson'|'project', id) — the same call its own sidebar
        links make. Picking a glossary result calls goToDocs() then
        setDocsSearch(term), landing on the Documentation screen
        pre-filtered to that term, since the docs page has no per-term
        anchor to jump to. A small 🔍 fab (next to the badge/review fabs)
        opens it too, for discoverability without a keyboard.
     8. Two "fun" low-bar badges — "Hello, World" (first successful code
        run) and "Shortcut Savvy" (first accepted autocomplete suggestion).
        Hooked onto runCppSubset()/runHtmlCss() (whichever the page has —
        both return {success,...} and sit underneath runProblem/
        runProject/runMachine/checkProblem/checkProject/checkMachine, so
        wrapping the shared primitive catches a success from any of them)
        and onto acceptEditorSuggestion() (fires only when a suggestion is
        actually accepted, not just shown). New STATE fields:
        STATE.hasSuccessfulRun, STATE.usedAutocomplete — both booleans,
        same additive-state treatment as STATE.badges.
     9. Weak-topics review scheduling — the flashcard review from
        feature 2 is now spaced-repetition-driven instead of always
        pulling the 4 globally-weakest-mastery tags. A lightweight
        SM-2-lite scheduler tracks one entry per tag (tags are the
        stable review unit here since quiz questions have no persistent
        id — see feature 2's own note on this), keyed on a new additive
        field STATE.reviewSchedule. Revealing a card's answer now shows
        Again/Good/Easy self-rating buttons instead of a plain "Next";
        the rating drives the tag's next interval and due date. Session
        selection prefers due (or never-scheduled) tags, falling back
        to not-yet-due tags sorted by mastery only if there aren't
        enough due tags to fill a session, so review mode never comes
        up empty just because the schedule is caught up.

   This file also reads (but doesn't wrap) todayKey(), the host page's
   shared date-key helper, confirmed present and byte-identical in both
   host files. Feature 6 also reads (without wrapping) runProblem(),
   runProject(), runMachine(), and STATE.currentView — all typeof/
   existence-guarded so a future host page missing one just gets no
   shortcut for that editor, not an error. Feature 7 additionally reads
   (without wrapping) PROJECTS, goToDocs(), and setDocsSearch() — same
   typeof-guarded treatment, confirmed present and identically shaped in
   both cpp.html and htmlcss_1.html this session. Feature 8 is the first
   place this file wraps a *page-specific* global rather than a shared
   one: runCppSubset exists only on cpp.html, runHtmlCss only on
   htmlcss_1.html, so each wrap is independently typeof-guarded and only
   one of the two ever fires on a given page. acceptEditorSuggestion is
   shared (same name, same signature on both pages) and wrapped
   unconditionally under its own guard. Feature 9 reads getMastery() and
   todayKey() (both without wrapping, same as feature 2/5 already did)
   and adds STATE.reviewSchedule alongside STATE.badges as an additive
   field — no DEFAULT_STATE edit, no host file changes.
   =========================================================================== */
(function () {
  'use strict';

  function ready(fn) {
    if (document.readyState !== 'loading') fn();
    else document.addEventListener('DOMContentLoaded', fn);
  }

  // typeof is safe even on identifiers that don't exist yet — used instead
  // of checking `window[name]` because STATE/QUIZZES/CHAPTERS/currentUser
  // are declared with let/const in the host file and are never attached
  // to window, even though they're reachable by name from this script.
  function hasDeps() {
    try {
      return (
        typeof STATE !== 'undefined' &&
        typeof QUIZZES !== 'undefined' &&
        typeof CHAPTERS !== 'undefined' &&
        typeof render === 'function' &&
        typeof saveState === 'function' &&
        typeof addXP === 'function' &&
        typeof updateMastery === 'function' &&
        typeof escapeHtml === 'function' &&
        typeof getMastery === 'function'
      );
    } catch (e) {
      return false;
    }
  }

  /* ------------------------------------------------------------------
     Badge / achievement definitions.
     Each: id, icon, label, desc, check(state) -> bool
     ------------------------------------------------------------------ */
  var BADGES = [
    { id: 'first_run', icon: '▶️', label: 'Hello, World', desc: 'Run your code and see it work.',
      check: function (s) { return !!s.hasSuccessfulRun; } },
    { id: 'first_autocomplete', icon: '⌨️', label: 'Shortcut Savvy', desc: 'Accept an autocomplete suggestion in the editor.',
      check: function (s) { return !!s.usedAutocomplete; } },
    { id: 'first_xp', icon: '✨', label: 'First Steps', desc: 'Earn your first XP.',
      check: function (s) { return s.xp > 0; } },
    { id: 'xp_500', icon: '🔥', label: 'Grinding', desc: 'Reach 500 XP.',
      check: function (s) { return s.xp >= 500; } },
    { id: 'xp_2000', icon: '💎', label: 'Dedicated', desc: 'Reach 2000 XP.',
      check: function (s) { return s.xp >= 2000; } },
    { id: 'streak_3', icon: '📅', label: 'Building a Habit', desc: 'Hit a 3-day streak.',
      check: function (s) { return s.streak >= 3; } },
    { id: 'streak_7', icon: '🗓️', label: 'One Week Strong', desc: 'Hit a 7-day streak.',
      check: function (s) { return s.streak >= 7; } },
    { id: 'streak_30', icon: '🏆', label: 'Unstoppable', desc: 'Hit a 30-day streak.',
      check: function (s) { return s.streak >= 30; } },
    { id: 'first_lesson', icon: '📘', label: 'Lesson One', desc: 'Complete your first lesson.',
      check: function (s) { return (s.completedLessons || []).length >= 1; } },
    { id: 'lessons_10', icon: '📚', label: 'Bookworm', desc: 'Complete 10 lessons.',
      check: function (s) { return (s.completedLessons || []).length >= 10; } },
    { id: 'first_project', icon: '🛠️', label: 'Builder', desc: 'Finish your first project.',
      check: function (s) { return (s.completedProjects || []).length >= 1; } },
    { id: 'projects_5', icon: '🏗️', label: 'Portfolio', desc: 'Finish 5 projects.',
      check: function (s) { return (s.completedProjects || []).length >= 5; } },
    { id: 'perfect_quiz', icon: '🎯', label: 'Perfect Score', desc: 'Score 100% on any quiz.',
      check: function (s) { return Object.values(s.quizBest || {}).some(function (v) { return v >= 100; }); } },
    { id: 'quiz_5', icon: '🧠', label: 'Quiz Regular', desc: 'Score on 5 different quizzes.',
      check: function (s) { return Object.keys(s.quizBest || {}).length >= 5; } },
    { id: 'machine_1', icon: '⚙️', label: 'Debugger', desc: 'Solve your first machine challenge.',
      check: function (s) { return (s.machineSolved || 0) >= 1; } },
    { id: 'machine_10', icon: '🤖', label: 'Machine Whisperer', desc: 'Solve 10 machine challenges.',
      check: function (s) { return (s.machineSolved || 0) >= 10; } },
    { id: 'mastery_80', icon: '⭐', label: 'Getting Sharp', desc: 'Reach 80+ mastery in any topic.',
      check: function (s) { return Object.values(s.mastery || {}).some(function (v) { return v >= 80; }); } },
    { id: 'mastery_well_rounded', icon: '👑', label: 'Well Rounded', desc: 'Reach 50+ mastery in 5 different topics.',
      check: function (s) { return Object.values(s.mastery || {}).filter(function (v) { return v >= 50; }).length >= 5; } }
  ];

  function checkBadges() {
    if (typeof STATE === 'undefined' || !STATE) return;
    if (!STATE.badges) STATE.badges = [];
    var unlocked = [];
    BADGES.forEach(function (b) {
      if (STATE.badges.indexOf(b.id) !== -1) return;
      var earned = false;
      try { earned = !!b.check(STATE); } catch (e) { earned = false; }
      if (earned) {
        STATE.badges.push(b.id);
        unlocked.push(b);
      }
    });
    if (unlocked.length) {
      saveState();
      unlocked.forEach(function (b, i) {
        setTimeout(function () { showBadgeToast(b); }, i * 350);
      });
      renderBadgeButton();
    }
  }

  function showBadgeToast(b) {
    var el = document.createElement('div');
    el.className = 'core-badge-toast';
    el.innerHTML =
      '<span class="core-badge-toast-icon">' + b.icon + '</span>' +
      '<div><div class="core-badge-toast-title">Badge unlocked</div>' +
      '<div class="core-badge-toast-label">' + escapeHtml(b.label) + '</div></div>';
    document.body.appendChild(el);
    requestAnimationFrame(function () { el.classList.add('show'); });
    setTimeout(function () {
      el.classList.remove('show');
      setTimeout(function () { el.remove(); }, 400);
    }, 3800);
  }

  function renderBadgeButton() {
    if (!currentUser) {
      var existing = document.getElementById('core-badge-btn');
      if (existing) existing.remove();
      return;
    }
    var btn = document.getElementById('core-badge-btn');
    var earned = (STATE.badges || []).length;
    if (!btn) {
      btn = document.createElement('button');
      btn.id = 'core-badge-btn';
      btn.className = 'core-fab';
      btn.title = 'Achievements';
      btn.onclick = openBadgePanel;
      document.body.appendChild(btn);
    }
    btn.innerHTML = '🏆<span class="core-fab-count">' + earned + '/' + BADGES.length + '</span>';
  }

  function openBadgePanel() {
    closeCoreModal();
    var overlay = document.createElement('div');
    overlay.className = 'core-modal-overlay';
    overlay.id = 'core-modal-overlay';
    var earnedIds = STATE.badges || [];
    overlay.innerHTML =
      '<div class="core-modal-card">' +
        '<div class="core-modal-head">' +
          '<h3>Achievements — ' + earnedIds.length + '/' + BADGES.length + '</h3>' +
          '<button class="core-modal-close" onclick="CoreFeatures.closeModal()">✕</button>' +
        '</div>' +
        '<div class="core-badge-grid">' +
          BADGES.map(function (b) {
            var got = earnedIds.indexOf(b.id) !== -1;
            return (
              '<div class="core-badge-cell ' + (got ? 'earned' : 'locked') + '">' +
                '<div class="core-badge-cell-icon">' + (got ? b.icon : '🔒') + '</div>' +
                '<div class="core-badge-cell-label">' + escapeHtml(b.label) + '</div>' +
                '<div class="core-badge-cell-desc">' + escapeHtml(b.desc) + '</div>' +
              '</div>'
            );
          }).join('') +
        '</div>' +
      '</div>';
    overlay.addEventListener('mousedown', function (e) { if (e.target === overlay) closeCoreModal(); });
    document.body.appendChild(overlay);
  }

  function closeCoreModal() {
    var el = document.getElementById('core-modal-overlay');
    if (el) el.remove();
  }

  /* ------------------------------------------------------------------
     Missed-questions quiz recap — shown right after a real quiz is
     submitted (hooked in installHooks, same wrapper as the badge check).
     Reads QUIZ_STATE directly; by the time this runs the host page's own
     submitQuiz() has already set q.correct/q.partialScore on every
     question and QUIZ_STATE.submitted = true. Skips silently if there's
     nothing to show (perfect score, or QUIZ_STATE isn't in a submitted
     state for some reason) rather than popping an empty modal.
     ------------------------------------------------------------------ */
  function showQuizRecap() {
    if (typeof QUIZ_STATE === 'undefined' || !QUIZ_STATE || !QUIZ_STATE.submitted) return;
    var missed = QUIZ_STATE.questions.filter(function (q) { return !q.correct; });
    if (!missed.length) return;
    closeCoreModal();
    var overlay = document.createElement('div');
    overlay.className = 'core-modal-overlay';
    overlay.id = 'core-modal-overlay';
    var total = QUIZ_STATE.questions.length;
    var pct = Math.round((QUIZ_STATE.score / total) * 100);
    overlay.innerHTML =
      '<div class="core-modal-card core-recap-card">' +
        '<div class="core-modal-head">' +
          '<h3>Missed questions — ' + missed.length + '/' + total + '</h3>' +
          '<button class="core-modal-close" onclick="CoreFeatures.closeModal()">✕</button>' +
        '</div>' +
        '<p class="core-recap-score">Scored ' + pct + '% on this quiz. Here\'s what to review:</p>' +
        '<div class="core-recap-list">' +
          missed.map(renderRecapItem).join('') +
        '</div>' +
      '</div>';
    overlay.addEventListener('mousedown', function (e) { if (e.target === overlay) closeCoreModal(); });
    document.body.appendChild(overlay);
  }

  function renderRecapItem(q) {
    var answerLine;
    if (q.type === 'mc') {
      answerLine = 'Correct answer: ' + escapeHtml(q.options[q.answer]);
    } else if (q.type === 'enum') {
      answerLine = 'Accepted: ' + q.answers.map(escapeHtml).join(', ');
    } else if (q.type === 'dragdrop') {
      var totalSlots = q.items.length;
      var correctSlots = Math.round((q.partialScore || 0) * totalSlots);
      answerLine = 'You placed ' + correctSlots + '/' + totalSlots + ' correctly. Correct order: ' +
        q.items.map(escapeHtml).join(' → ');
    } else {
      answerLine = '';
    }
    return (
      '<div class="core-recap-item">' +
        '<div class="core-review-tag">' + escapeHtml(q.tag) + '</div>' +
        '<p class="qtext">' + q.q + '</p>' +
        '<div class="core-recap-answer">' + answerLine + '</div>' +
        (q.explain ? '<div class="qexplain"><b>Why:</b> ' + escapeHtml(q.explain) + '</div>' : '') +
      '</div>'
    );
  }

  /* ------------------------------------------------------------------
     "Show explanation on every question" toggle — persisted as
     STATE.showAllExplains. By original file design, renderQuizQuestion
     only renders a .qexplain block under *missed* questions. This wraps
     renderQuizQuestion, and — only when the toggle is on, the question
     has explain text, the quiz is actually submitted, and the original
     output didn't already include a .qexplain block (i.e. it was
     answered correctly) — appends one onto the end of the returned
     markup, in the same spot the original places it (right before the
     closing </div> of .qcard).
     ------------------------------------------------------------------ */
  function wrapExplainVisibility(html, q) {
    if (!q || !q.explain) return html;
    if (typeof STATE === 'undefined' || !STATE || !STATE.showAllExplains) return html;
    if (typeof QUIZ_STATE === 'undefined' || !QUIZ_STATE || !QUIZ_STATE.submitted) return html;
    if (html.indexOf('class="qexplain"') !== -1) return html; // already shown (missed question)
    var block = '<div class="qexplain"><b>Why:</b> ' + escapeHtml(q.explain) + '</div>';
    var idx = html.lastIndexOf('</div>');
    if (idx === -1) return html + block;
    return html.slice(0, idx) + block + html.slice(idx);
  }

  function toggleShowAllExplains() {
    if (typeof STATE === 'undefined' || !STATE) return;
    STATE.showAllExplains = !STATE.showAllExplains;
    saveState();
    if (typeof rerenderMain === 'function') rerenderMain();
    else renderExplainToggleButton();
  }

  function renderExplainToggleButton() {
    var existing = document.getElementById('core-explain-toggle');
    var onQuiz = typeof STATE !== 'undefined' && STATE && STATE.currentView &&
      STATE.currentView.type === 'quiz';
    if (!currentUser || !onQuiz) {
      if (existing) existing.remove();
      return;
    }
    var on = !!STATE.showAllExplains;
    if (!existing) {
      existing = document.createElement('button');
      existing.id = 'core-explain-toggle';
      existing.onclick = toggleShowAllExplains;
      document.body.appendChild(existing);
    }
    existing.className = 'core-explain-toggle' + (on ? ' on' : '');
    existing.innerHTML = '💡 Explanations: ' + (on ? 'All' : 'Missed only');
  }

  /* ------------------------------------------------------------------
     Daily practice reminder / streak-at-risk nudge — a small dismissible
     banner shown in the evening if today isn't marked active yet.
     STATE.lastActiveDate / STATE.streak are set by the host page's own
     touchStreak() (unchanged, not wrapped); this only reads them. No new
     persisted state — dismissal is in-memory only (module-level var), so
     it re-evaluates fresh on next page load, same as the explain toggle's
     visibility check. Driven by its own setInterval, not a render hook,
     since it doesn't need to react to every re-render — just to the
     clock ticking into evening or the user finally becoming active.
     ------------------------------------------------------------------ */
  var STREAK_NUDGE_EVENING_HOUR = 18; // local time, 24h clock
  var streakNudgeDismissed = false;

  function isEvening() {
    return new Date().getHours() >= STREAK_NUDGE_EVENING_HOUR;
  }

  function checkStreakNudge() {
    if (typeof STATE === 'undefined' || !STATE || !currentUser || streakNudgeDismissed) {
      removeStreakNudge();
      return;
    }
    var today = typeof todayKey === 'function' ? todayKey() : new Date().toISOString().slice(0, 10);
    var activeToday = STATE.lastActiveDate === today;
    if (activeToday || !isEvening()) {
      removeStreakNudge();
      return;
    }
    renderStreakNudge();
  }

  function renderStreakNudge() {
    if (document.getElementById('core-streak-nudge')) return; // already showing, don't re-flash it
    var streak = STATE.streak || 0;
    var msg = streak > 0
      ? 'Keep your <b>' + streak + '-day</b> streak alive — do one lesson today.'
      : 'Do a lesson today to start a streak.';
    var el = document.createElement('div');
    el.id = 'core-streak-nudge';
    el.className = 'core-streak-nudge';
    el.innerHTML =
      '<span class="core-streak-nudge-icon">🔥</span>' +
      '<span class="core-streak-nudge-text">' + msg + '</span>' +
      '<button class="core-streak-nudge-close" onclick="CoreFeatures.dismissStreakNudge()" title="Dismiss">✕</button>';
    document.body.appendChild(el);
    requestAnimationFrame(function () { el.classList.add('show'); });
  }

  function removeStreakNudge() {
    var el = document.getElementById('core-streak-nudge');
    if (el) el.remove();
  }

  function dismissStreakNudge() {
    streakNudgeDismissed = true;
    removeStreakNudge();
  }

  /* ------------------------------------------------------------------
     Keyboard shortcuts for the code editor — Ctrl/Cmd+Enter runs the
     current challenge, Ctrl/Cmd+/ toggles a comment on the current
     line/selection. Delegated on `document` (bubble phase) rather than
     attached to #prob-editor/#proj-editor/#machine-editor directly:
     those textareas are recreated every time render()/rerenderMain()
     does `el.innerHTML = ...`, so a listener attached to one instance
     would silently stop firing after the next re-render. A single
     document-level listener survives every re-render for free and
     never touches the existing inline onkeydown="handleEditorTab(...)"
     attribute — this is a fully separate listener on a different node.

     Run mapping (Ctrl/Cmd+Enter -> the ▶ Run action, not the ✓ Check/
     Submit action): #prob-editor -> runProblem(), #proj-editor ->
     runProject(chapterId) (chapterId read from STATE.currentView.id,
     which goTo() sets whenever the project view is opened), #machine-
     editor -> runMachine(). All three calls are typeof-guarded and
     wrapped in try/catch so a shortcut can never throw into the host
     page's own keydown handling.

     Comment mapping (Ctrl/Cmd+/) has two implementations because the
     two host pages edit different languages:
       - cpp.html (detected via `typeof runCppSubset === 'function'`,
         a global only that file defines): classic per-line `//`
         toggle across the lines touched by the selection, matching
         standard editor Ctrl+/ behavior.
       - htmlcss_1.html: the editor mixes an HTML document with an
         inline <style> block, which don't share a comment syntax.
         Toggles a single wrapping comment around the selection (or
         the current line, trimmed, if nothing is selected), choosing
         an HTML or a CSS comment by scanning the text before the
         cursor for an unclosed <style> tag. This assumes a selection doesn't
         straddle the HTML/CSS boundary (e.g. spanning from inside
         <style> out past </style>) — a reasonable assumption for a
         single Ctrl+/ press, but worth knowing about if it ever
         surprises someone.
     ------------------------------------------------------------------ */
  function isCppHost() {
    return typeof runCppSubset === 'function';
  }

  function escapeRegExp(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function toggleLineCommentCpp(el) {
    var value = el.value;
    var start = el.selectionStart, end = el.selectionEnd;
    var lineStart = value.lastIndexOf('\n', start - 1) + 1;
    var scanEnd = (end > start && value.charAt(end - 1) === '\n') ? end - 1 : end;
    var nextNl = value.indexOf('\n', scanEnd);
    var lineEnd = nextNl === -1 ? value.length : nextNl;
    var block = value.slice(lineStart, lineEnd);
    var lines = block.split('\n');
    var nonBlank = lines.filter(function (l) { return l.trim().length > 0; });
    var allCommented = nonBlank.length > 0 && nonBlank.every(function (l) { return /^\s*\/\//.test(l); });
    var newLines = lines.map(function (l) {
      if (allCommented) return l.replace(/^(\s*)\/\/ ?/, '$1');
      if (l.trim().length === 0) return l;
      var indent = l.match(/^\s*/)[0];
      return indent + '// ' + l.slice(indent.length);
    });
    var newBlock = newLines.join('\n');
    el.value = value.slice(0, lineStart) + newBlock + value.slice(lineEnd);
    el.selectionStart = lineStart;
    el.selectionEnd = lineStart + newBlock.length;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function isInsideStyleBlock(value, pos) {
    var before = value.slice(0, pos).toLowerCase();
    var opens = (before.match(/<style[\s>]/g) || []).length;
    var closes = (before.match(/<\/style\s*>/g) || []).length;
    return opens > closes;
  }

  function toggleBlockCommentMarkup(el) {
    var value = el.value;
    var start = el.selectionStart, end = el.selectionEnd;
    var css = isInsideStyleBlock(value, start);
    var openTok = css ? '/*' : '<!--';
    var closeTok = css ? '*/' : '-->';
    var regionStart = start, regionEnd = end;
    if (start === end) {
      var lineStart = value.lastIndexOf('\n', start - 1) + 1;
      var nextNl = value.indexOf('\n', start);
      var lineEnd = nextNl === -1 ? value.length : nextNl;
      var line = value.slice(lineStart, lineEnd);
      var trimmedStart = line.match(/^\s*/)[0].length;
      var trimmedEnd = line.replace(/\s+$/, '').length;
      if (trimmedEnd > trimmedStart) {
        regionStart = lineStart + trimmedStart;
        regionEnd = lineStart + trimmedEnd;
      } else {
        regionStart = lineStart;
        regionEnd = lineEnd;
      }
    }
    var selected = value.slice(regionStart, regionEnd);
    var trimmedSel = selected.trim();
    var isCommented = trimmedSel.indexOf(openTok) === 0 &&
      trimmedSel.slice(trimmedSel.length - closeTok.length) === closeTok;
    var replacement;
    if (isCommented) {
      replacement = selected
        .replace(new RegExp('^(\\s*)' + escapeRegExp(openTok) + ' ?'), '$1')
        .replace(new RegExp(' ?' + escapeRegExp(closeTok) + '(\\s*)$'), '$1');
    } else {
      replacement = openTok + ' ' + selected + ' ' + closeTok;
    }
    el.value = value.slice(0, regionStart) + replacement + value.slice(regionEnd);
    el.selectionStart = regionStart;
    el.selectionEnd = regionStart + replacement.length;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function toggleEditorComment(el) {
    if (isCppHost()) toggleLineCommentCpp(el);
    else toggleBlockCommentMarkup(el);
  }

  function runCurrentEditor(el) {
    try {
      if (el.id === 'prob-editor' && typeof runProblem === 'function') {
        runProblem();
      } else if (el.id === 'proj-editor' && typeof runProject === 'function') {
        var chapterId = (typeof STATE !== 'undefined' && STATE && STATE.currentView && STATE.currentView.id) || '';
        runProject(chapterId);
      } else if (el.id === 'machine-editor' && typeof runMachine === 'function') {
        runMachine();
      }
    } catch (e) { /* never let a shortcut break the editor */ }
  }

  var editorShortcutsInstalled = false;
  function installEditorShortcuts() {
    if (editorShortcutsInstalled) return;
    editorShortcutsInstalled = true;
    document.addEventListener('keydown', function (e) {
      var el = e.target;
      if (!el || !el.classList || !el.classList.contains('editor')) return;
      var mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      if (e.key === 'Enter') {
        e.preventDefault();
        runCurrentEditor(el);
      } else if (e.key === '/') {
        e.preventDefault();
        try { toggleEditorComment(el); } catch (err) { /* never break typing on a bad toggle */ }
      }
    });
  }

  /* ------------------------------------------------------------------
     Unified search (Ctrl/Cmd+K) — indexes lesson titles (CHAPTERS),
     project titles (PROJECTS), and glossary terms (GLOSSARY) into one
     searchable list. Rebuilt fresh on every keystroke rather than
     cached: the combined dataset is small (a few dozen entries across
     both host pages) so there's no real cost, and it sidesteps ever
     serving a stale index if STATE/content changes underneath it.

     Navigation reuses the host page's own functions exactly as its own
     UI calls them — goTo('lesson', id) / goTo('project', id) match the
     onclick on every lesson/project node in the side panel, and the
     glossary path (goToDocs() + setDocsSearch(term)) matches typing a
     term into the docs page's own search box. Nothing here duplicates
     or reimplements host-page navigation logic.
     ------------------------------------------------------------------ */
  var SEARCH_STATE = null; // {query, results, activeIndex}
  var SEARCH_TYPE_LABEL = { lesson: 'Lesson', project: 'Project', glossary: 'Glossary' };
  var SEARCH_TYPE_ICON = { lesson: '📘', project: '🛠️', glossary: '📖' };

  function stripTags(html) {
    return String(html || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  }

  // Reads CHAPTERS/PROJECTS/GLOSSARY defensively — each is independently
  // typeof-guarded so a host page missing one (or shaped differently in
  // some future edit) just contributes no entries from that source
  // rather than throwing and losing search entirely.
  function buildSearchIndex() {
    var items = [];
    try {
      if (typeof CHAPTERS !== 'undefined' && CHAPTERS) {
        CHAPTERS.forEach(function (ch) {
          (ch.lessons || []).forEach(function (l) {
            items.push({
              type: 'lesson',
              title: l.title,
              subtitle: ch.title,
              body: stripTags(l.concept),
              go: function () { if (typeof goTo === 'function') goTo('lesson', l.id); }
            });
          });
        });
      }
    } catch (e) { /* one bad source shouldn't blank the whole index */ }
    try {
      if (typeof PROJECTS !== 'undefined' && PROJECTS) {
        Object.keys(PROJECTS).forEach(function (pid) {
          var p = PROJECTS[pid];
          items.push({
            type: 'project',
            title: p.title,
            subtitle: p.chapterTitle || '',
            body: stripTags(p.brief),
            go: function () { if (typeof goTo === 'function') goTo('project', pid); }
          });
        });
      }
    } catch (e) { /* ditto */ }
    try {
      if (typeof GLOSSARY !== 'undefined' && GLOSSARY) {
        Object.keys(GLOSSARY).forEach(function (key) {
          var e = GLOSSARY[key];
          items.push({
            type: 'glossary',
            title: e.term,
            subtitle: e.cat || '',
            body: stripTags(e.plain),
            go: function () {
              if (typeof goToDocs === 'function') goToDocs();
              if (typeof setDocsSearch === 'function') setDocsSearch(e.term);
            }
          });
        });
      }
    } catch (e) { /* ditto */ }
    return items;
  }

  // Lower score = better match. Title-prefix beats title-substring beats
  // subtitle beats body text, so "loop" surfaces "Loop" before it surfaces
  // an unrelated glossary entry that merely mentions loops in passing.
  function searchScore(item, q) {
    var t = (item.title || '').toLowerCase();
    if (t.indexOf(q) === 0) return 0;
    if (t.indexOf(q) !== -1) return 1;
    if (item.subtitle && item.subtitle.toLowerCase().indexOf(q) !== -1) return 2;
    if (item.body && item.body.toLowerCase().indexOf(q) !== -1) return 3;
    return -1;
  }

  function runSearch(query) {
    var q = query.trim().toLowerCase();
    if (!q) return [];
    var scored = [];
    buildSearchIndex().forEach(function (item) {
      var s = searchScore(item, q);
      if (s !== -1) scored.push({ item: item, score: s });
    });
    scored.sort(function (a, b) {
      if (a.score !== b.score) return a.score - b.score;
      return a.item.title.localeCompare(b.item.title);
    });
    return scored.slice(0, 30).map(function (s) { return s.item; });
  }

  function highlightMatch(text, q) {
    text = String(text || '');
    if (!q) return escapeHtml(text);
    var idx = text.toLowerCase().indexOf(q.toLowerCase());
    if (idx === -1) return escapeHtml(text);
    return escapeHtml(text.slice(0, idx)) + '<mark>' + escapeHtml(text.slice(idx, idx + q.length)) +
      '</mark>' + escapeHtml(text.slice(idx + q.length));
  }

  function openUnifiedSearch() {
    closeCoreModal();
    SEARCH_STATE = { query: '', results: [], activeIndex: 0 };
    var overlay = document.createElement('div');
    overlay.className = 'core-modal-overlay core-search-overlay';
    overlay.id = 'core-modal-overlay';
    overlay.innerHTML =
      '<div class="core-modal-card core-search-card">' +
        '<div class="core-search-box">' +
          '<span class="core-search-icon">🔍</span>' +
          '<input id="core-search-input" class="core-search-input" autocomplete="off" ' +
            'placeholder="Search lessons, projects, and glossary terms…"/>' +
          '<button class="core-modal-close" onclick="CoreFeatures.closeModal()">✕</button>' +
        '</div>' +
        '<div id="core-search-results" class="core-search-results"></div>' +
      '</div>';
    overlay.addEventListener('mousedown', function (e) { if (e.target === overlay) closeCoreModal(); });
    document.body.appendChild(overlay);
    renderSearchResults();
    var input = document.getElementById('core-search-input');
    input.addEventListener('input', function () { updateSearchResults(input.value); });
    input.addEventListener('keydown', handleSearchKeydown);
    setTimeout(function () { input.focus(); }, 0);
  }

  function updateSearchResults(query) {
    if (!SEARCH_STATE) return;
    SEARCH_STATE.query = query;
    SEARCH_STATE.results = runSearch(query);
    SEARCH_STATE.activeIndex = 0;
    renderSearchResults();
  }

  function renderSearchResults() {
    var el = document.getElementById('core-search-results');
    if (!el || !SEARCH_STATE) return;
    var q = SEARCH_STATE.query.trim();
    if (!q) {
      el.innerHTML = '<div class="core-search-empty">Type to search lessons, projects, and glossary terms.</div>';
      return;
    }
    if (!SEARCH_STATE.results.length) {
      el.innerHTML = '<div class="core-search-empty">No matches for "' + escapeHtml(q) + '".</div>';
      return;
    }
    el.innerHTML = SEARCH_STATE.results.map(function (item, i) {
      var active = i === SEARCH_STATE.activeIndex;
      return (
        '<div class="core-search-item' + (active ? ' active' : '') + '" ' +
          'onmouseenter="CoreFeatures.searchHover(' + i + ')" onclick="CoreFeatures.searchSelect(' + i + ')">' +
          '<span class="core-search-item-icon">' + (SEARCH_TYPE_ICON[item.type] || '') + '</span>' +
          '<div class="core-search-item-body">' +
            '<div class="core-search-item-title">' + highlightMatch(item.title, q) + '</div>' +
            '<div class="core-search-item-sub">' + (SEARCH_TYPE_LABEL[item.type] || '') +
              (item.subtitle ? ' · ' + escapeHtml(item.subtitle) : '') + '</div>' +
          '</div>' +
        '</div>'
      );
    }).join('');
    var activeEl = el.querySelector('.core-search-item.active');
    if (activeEl && activeEl.scrollIntoView) activeEl.scrollIntoView({ block: 'nearest' });
  }

  function searchHover(i) {
    if (!SEARCH_STATE) return;
    SEARCH_STATE.activeIndex = i;
    renderSearchResults();
  }

  function searchSelect(i) {
    if (!SEARCH_STATE || !SEARCH_STATE.results[i]) return;
    var item = SEARCH_STATE.results[i];
    closeCoreModal();
    try { item.go(); } catch (e) { /* never let a bad nav break the page */ }
  }

  function handleSearchKeydown(e) {
    if (!SEARCH_STATE) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      closeCoreModal();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (SEARCH_STATE.results.length) {
        SEARCH_STATE.activeIndex = (SEARCH_STATE.activeIndex + 1) % SEARCH_STATE.results.length;
        renderSearchResults();
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (SEARCH_STATE.results.length) {
        SEARCH_STATE.activeIndex = (SEARCH_STATE.activeIndex - 1 + SEARCH_STATE.results.length) % SEARCH_STATE.results.length;
        renderSearchResults();
      }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      searchSelect(SEARCH_STATE.activeIndex);
    }
  }

  function renderSearchButton() {
    if (!currentUser) {
      var existing = document.getElementById('core-search-btn');
      if (existing) existing.remove();
      return;
    }
    var btn = document.getElementById('core-search-btn');
    if (!btn) {
      btn = document.createElement('button');
      btn.id = 'core-search-btn';
      btn.className = 'core-fab core-fab-tertiary';
      btn.title = 'Search (Ctrl+K)';
      btn.innerHTML = '🔍';
      btn.onclick = openUnifiedSearch;
      document.body.appendChild(btn);
    }
  }

  // Ctrl/Cmd+K, delegated on document (not scoped to .editor like the
  // Feature-6 shortcut) so it opens from anywhere on the page, including
  // while focused inside a code editor or any other input.
  var searchShortcutInstalled = false;
  function installSearchShortcut() {
    if (searchShortcutInstalled) return;
    searchShortcutInstalled = true;
    document.addEventListener('keydown', function (e) {
      var mod = e.ctrlKey || e.metaKey;
      if (!mod || e.key.toLowerCase() !== 'k') return;
      e.preventDefault();
      var existing = document.getElementById('core-search-input');
      if (existing) { existing.focus(); return; }
      if (!hasDeps()) return;
      openUnifiedSearch();
    });
  }

  /* ------------------------------------------------------------------
     Weak-topics review — flashcard-style practice pulled from tags due
     for review per a lightweight spaced-repetition schedule (see
     "Scheduling model" below). Kept entirely separate from
     QUIZ_STATE/submitQuiz so it can never interfere with an in-progress
     graded quiz.
     ------------------------------------------------------------------ */
  var REVIEW_STATE = null;

  function allQuizQuestions() {
    var out = [];
    Object.keys(QUIZZES).forEach(function (chapterId) {
      QUIZZES[chapterId].forEach(function (q) {
        var copy = Object.assign({}, q, { chapterId: chapterId });
        out.push(copy);
      });
    });
    return out;
  }

  function allReviewTags() {
    var tags = {};
    allQuizQuestions().forEach(function (q) { tags[q.tag] = true; });
    return Object.keys(tags);
  }

  /* ------------------------------------------------------------------
     Scheduling model — SM-2-lite, one entry per *tag*, not per question:
     quiz questions have no stable id across sessions (only type/tag/
     text), so the tag is the natural persistent review unit — same
     reasoning the old weakestTags() already relied on.

     STATE.reviewSchedule[tag] = { interval, ease, due, reps }
       - interval: days until the next review
       - ease:     SM-2 ease factor, clamped to [1.3, 2.8], starts 2.5
       - due:      'YYYY-MM-DD' (todayKey() format) it next becomes due,
                   or null if never reviewed
       - reps:     consecutive non-"Again" reviews; resets to 0 on Again

     A tag with no entry, or whose due date is today or earlier, counts
     as due. "Again" is deliberately simple here — it resets to a 1-day
     interval rather than requeuing the card later in the *same*
     session (real SM-2/Anki do the latter); flagging this as a
     reasonable place to tighten things up later, not a spec
     requirement.
     ------------------------------------------------------------------ */
  var REVIEW_EASE_MIN = 1.3;
  var REVIEW_EASE_MAX = 2.8;
  var REVIEW_EASE_START = 2.5;
  // Caps how far out a tag can ever get scheduled. Without this, repeated
  // "Easy" ratings compound interval*ease every review with no ceiling —
  // over enough reps that overflows Date (setDate() past the representable
  // range throws "Invalid time value") long before it'd be a realistic
  // review gap anyway. 180 days keeps every tag revisited at least twice
  // a year even at max ease.
  var REVIEW_INTERVAL_MAX = 180;

  function today() {
    return typeof todayKey === 'function' ? todayKey() : new Date().toISOString().slice(0, 10);
  }

  function addDaysToToday(days) {
    var d = new Date();
    d.setDate(d.getDate() + Math.max(0, Math.round(days)));
    return d.toISOString().slice(0, 10);
  }

  function ensureReviewSchedule() {
    if (typeof STATE === 'undefined' || !STATE) return {};
    if (!STATE.reviewSchedule) STATE.reviewSchedule = {};
    return STATE.reviewSchedule;
  }

  function getScheduleEntry(tag) {
    var sched = ensureReviewSchedule();
    return sched[tag] || { interval: 0, ease: REVIEW_EASE_START, due: null, reps: 0 };
  }

  function isTagDue(tag) {
    var entry = getScheduleEntry(tag);
    return !entry.due || entry.due <= today();
  }

  function dueTagCount() {
    return allReviewTags().filter(isTagDue).length;
  }

  // rating: 'again' | 'good' | 'easy' — see "Scheduling model" above.
  function rateTag(tag, rating) {
    var sched = ensureReviewSchedule();
    var entry = sched[tag] || { interval: 0, ease: REVIEW_EASE_START, due: null, reps: 0 };
    if (rating === 'again') {
      entry.reps = 0;
      entry.interval = 1;
      entry.ease = Math.max(REVIEW_EASE_MIN, entry.ease - 0.2);
    } else {
      entry.reps += 1;
      if (rating === 'easy') entry.ease = Math.min(REVIEW_EASE_MAX, entry.ease + 0.15);
      if (entry.reps === 1) entry.interval = 1;
      else if (entry.reps === 2) entry.interval = 6;
      else entry.interval = Math.round(entry.interval * entry.ease);
      if (rating === 'easy') entry.interval = Math.round(entry.interval * 1.3);
    }
    entry.interval = Math.min(REVIEW_INTERVAL_MAX, entry.interval);
    entry.due = addDaysToToday(entry.interval);
    sched[tag] = entry;
    saveState();
  }

  // Due (or never-scheduled) tags first, weakest-mastery first within
  // that group; pads out with not-yet-due tags — also weakest first —
  // only if there aren't enough due tags to fill a session, so review
  // mode always has something to offer even with a clean schedule.
  function dueTags(limit) {
    var scored = allReviewTags().map(function (t) {
      return { tag: t, mastery: getMastery(t), due: isTagDue(t) };
    });
    scored.sort(function (a, b) { return a.mastery - b.mastery; });
    var due = scored.filter(function (s) { return s.due; });
    var notDue = scored.filter(function (s) { return !s.due; });
    return due.concat(notDue).slice(0, limit).map(function (s) { return s.tag; });
  }

  function shuffle(arr) {
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp;
    }
    return arr;
  }

  function buildReviewSession() {
    var tags = dueTags(4);
    var pool = allQuizQuestions().filter(function (q) {
      return tags.indexOf(q.tag) !== -1 && (q.type === 'mc' || q.type === 'enum');
    });
    pool = shuffle(pool);
    return { cards: pool.slice(0, 8), index: 0, revealed: false };
  }

  function openReviewMode() {
    REVIEW_STATE = buildReviewSession();
    if (!REVIEW_STATE.cards.length) {
      alert('Answer a few quiz questions first — review mode needs some mastery data to know what to focus on.');
      return;
    }
    renderReviewCard();
  }

  function renderReviewCard() {
    closeCoreModal();
    var overlay = document.createElement('div');
    overlay.className = 'core-modal-overlay';
    overlay.id = 'core-modal-overlay';
    var total = REVIEW_STATE.cards.length;
    var q = REVIEW_STATE.cards[REVIEW_STATE.index];
    var body;
    if (q.type === 'mc') {
      body = '<div class="core-review-opts">' +
        q.options.map(function (opt, oi) {
          var cls = 'core-review-opt' + (REVIEW_STATE.revealed && oi === q.answer ? ' correct' : '');
          return '<button class="' + cls + '" onclick="CoreFeatures.revealReview()">' + escapeHtml(opt) + '</button>';
        }).join('') +
        '</div>';
    } else {
      body = '<div class="core-review-opts">' +
        '<button class="core-review-opt" onclick="CoreFeatures.revealReview()">Reveal answer</button>' +
        '</div>' +
        (REVIEW_STATE.revealed
          ? '<div class="qanswerkey">Accepted: ' + q.answers.map(escapeHtml).join(', ') + '</div>'
          : '');
    }
    // Once revealed, the learner rates recall instead of just hitting
    // "Next" — the rating is the scheduler's input, so it has to happen
    // before advancing, not after.
    var nav = REVIEW_STATE.revealed
      ? '<div class="core-review-rate">' +
          '<span class="core-review-rate-label">How well did you remember it?</span>' +
          '<div class="core-review-rate-btns">' +
            '<button class="core-review-rate-btn again" onclick="CoreFeatures.rateReview(\'again\')">Again</button>' +
            '<button class="core-review-rate-btn good" onclick="CoreFeatures.rateReview(\'good\')">Good</button>' +
            '<button class="core-review-rate-btn easy" onclick="CoreFeatures.rateReview(\'easy\')">Easy</button>' +
          '</div>' +
        '</div>'
      : '<div class="core-review-nav"><button class="btn" disabled>Reveal to rate</button></div>';
    overlay.innerHTML =
      '<div class="core-modal-card core-review-card">' +
        '<div class="core-modal-head">' +
          '<h3>Weak-topics review — ' + (REVIEW_STATE.index + 1) + '/' + total + '</h3>' +
          '<button class="core-modal-close" onclick="CoreFeatures.closeModal()">✕</button>' +
        '</div>' +
        '<div class="core-review-tag">' + escapeHtml(q.tag) + '</div>' +
        '<p class="qtext">' + q.q + '</p>' +
        body +
        (REVIEW_STATE.revealed && q.explain
          ? '<div class="qexplain"><b>Why:</b> ' + escapeHtml(q.explain) + '</div>'
          : '') +
        nav +
      '</div>';
    overlay.addEventListener('mousedown', function (e) { if (e.target === overlay) closeCoreModal(); });
    document.body.appendChild(overlay);
  }

  function revealReview() {
    if (!REVIEW_STATE) return;
    REVIEW_STATE.revealed = true;
    renderReviewCard();
  }

  // Fired from the Again/Good/Easy buttons. Updates the current card's
  // tag schedule (rateTag persists via saveState()), then advances —
  // replaces the old plain nextReview(), since advancing now always
  // requires a rating first.
  function rateReview(rating) {
    if (!REVIEW_STATE) return;
    var q = REVIEW_STATE.cards[REVIEW_STATE.index];
    rateTag(q.tag, rating);
    if (REVIEW_STATE.index + 1 >= REVIEW_STATE.cards.length) {
      closeCoreModal();
      REVIEW_STATE = null;
      renderReviewButton();
      return;
    }
    REVIEW_STATE.index++;
    REVIEW_STATE.revealed = false;
    renderReviewCard();
  }

  function renderReviewButton() {
    if (!currentUser) {
      var existing = document.getElementById('core-review-btn');
      if (existing) existing.remove();
      return;
    }
    var btn = document.getElementById('core-review-btn');
    if (!btn) {
      btn = document.createElement('button');
      btn.id = 'core-review-btn';
      btn.className = 'core-fab core-fab-secondary';
      btn.title = 'Review weak topics';
      btn.onclick = openReviewMode;
      document.body.appendChild(btn);
    }
    var due = typeof QUIZZES !== 'undefined' ? dueTagCount() : 0;
    btn.innerHTML = '🧠' + (due > 0 ? '<span class="core-fab-count">' + due + '</span>' : '');
  }

  /* ------------------------------------------------------------------
     Styles — injected once under a core- prefix so nothing here can
     collide with the host page's own class names. Colors reference the
     host page's existing CSS variables (with fallbacks) so this matches
     either track's theme automatically.
     ------------------------------------------------------------------ */
  function injectStyles() {
    if (document.getElementById('core-features-style')) return;
    var style = document.createElement('style');
    style.id = 'core-features-style';
    style.textContent =
      '.core-fab{position:fixed;right:20px;bottom:20px;z-index:200;width:52px;height:52px;border-radius:50%;' +
        'border:1px solid var(--cyan-dim,#2b6b78);background:var(--panel-2,#122a4a);color:var(--paper,#eee);' +
        'font-size:22px;cursor:pointer;display:flex;align-items:center;justify-content:center;' +
        'box-shadow:0 6px 18px rgba(0,0,0,0.4);transition:transform .15s ease;}' +
      '.core-fab:hover{transform:scale(1.08);}' +
      '.core-fab-secondary{right:82px;font-size:20px;}' +
      '.core-fab-count{position:absolute;bottom:-6px;right:-6px;background:var(--amber,#F5A623);color:#1a1a1a;' +
        'font-size:10px;font-weight:700;border-radius:10px;padding:1px 5px;font-family:\'IBM Plex Mono\',monospace;}' +
      '.core-modal-overlay{position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:300;' +
        'display:flex;align-items:center;justify-content:center;padding:20px;}' +
      '.core-modal-card{background:var(--panel,#0d1f38);border:1px solid var(--grid,#22406a);border-radius:12px;' +
        'padding:20px;max-width:560px;width:100%;max-height:80vh;overflow-y:auto;color:var(--paper,#eee);}' +
      '.core-modal-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;gap:12px;}' +
      '.core-modal-head h3{margin:0;font-size:16px;}' +
      '.core-modal-close{background:none;border:none;color:var(--paper-dim,#9fb0c8);font-size:16px;cursor:pointer;}' +
      '.core-badge-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:10px;}' +
      '.core-badge-cell{border:1px solid var(--grid,#22406a);border-radius:8px;padding:12px 10px;text-align:center;}' +
      '.core-badge-cell.locked{opacity:0.45;}' +
      '.core-badge-cell-icon{font-size:26px;margin-bottom:6px;}' +
      '.core-badge-cell-label{font-weight:700;font-size:12.5px;margin-bottom:3px;}' +
      '.core-badge-cell-desc{font-size:11px;color:var(--paper-dim,#9fb0c8);line-height:1.35;}' +
      '.core-badge-toast{position:fixed;right:20px;bottom:84px;z-index:400;background:var(--panel-2,#122a4a);' +
        'border:1px solid var(--amber,#F5A623);border-radius:10px;padding:10px 14px;display:flex;gap:10px;' +
        'align-items:center;box-shadow:0 8px 24px rgba(0,0,0,0.5);opacity:0;transform:translateY(10px);' +
        'transition:opacity .3s ease,transform .3s ease;max-width:260px;}' +
      '.core-badge-toast.show{opacity:1;transform:translateY(0);}' +
      '.core-badge-toast-icon{font-size:26px;}' +
      '.core-badge-toast-title{font-size:10px;text-transform:uppercase;letter-spacing:.04em;color:var(--amber,#F5A623);font-weight:700;}' +
      '.core-badge-toast-label{font-size:13px;font-weight:700;}' +
      '.core-review-tag{display:inline-block;font-size:10.5px;text-transform:uppercase;letter-spacing:.04em;' +
        'color:var(--cyan,#4FD1E8);border:1px solid var(--cyan-dim,#2b6b78);border-radius:20px;padding:2px 9px;margin-bottom:10px;}' +
      '.core-review-opts{display:flex;flex-direction:column;gap:8px;margin-top:10px;}' +
      '.core-review-opt{text-align:left;padding:9px 12px;border-radius:6px;border:1px solid var(--grid,#22406a);' +
        'background:transparent;color:var(--paper,#eee);cursor:pointer;font-size:13px;}' +
      '.core-review-opt.correct{border-color:var(--green,#3ecf6d);background:rgba(62,207,109,0.12);}' +
      '.core-review-nav{display:flex;justify-content:flex-end;margin-top:14px;}' +
      '.core-review-rate{margin-top:14px;}' +
      '.core-review-rate-label{display:block;font-size:11.5px;color:var(--paper-dim,#9fb0c8);margin-bottom:8px;}' +
      '.core-review-rate-btns{display:flex;gap:8px;}' +
      '.core-review-rate-btn{flex:1;padding:9px 6px;border-radius:6px;border:1px solid var(--grid,#22406a);' +
        'background:transparent;color:var(--paper,#eee);cursor:pointer;font-size:12.5px;font-weight:600;' +
        'font-family:inherit;transition:background .15s ease;}' +
      '.core-review-rate-btn.again{border-color:#e05252;color:#e05252;}' +
      '.core-review-rate-btn.again:hover{background:rgba(224,82,82,0.12);}' +
      '.core-review-rate-btn.good{border-color:var(--cyan,#4FD1E8);color:var(--cyan,#4FD1E8);}' +
      '.core-review-rate-btn.good:hover{background:rgba(79,209,232,0.12);}' +
      '.core-review-rate-btn.easy{border-color:var(--green,#3ecf6d);color:var(--green,#3ecf6d);}' +
      '.core-review-rate-btn.easy:hover{background:rgba(62,207,109,0.12);}' +
      '.core-recap-card{max-width:640px;}' +
      '.core-recap-score{margin:0 0 14px;font-size:13px;color:var(--paper-dim,#9fb0c8);}' +
      '.core-recap-list{display:flex;flex-direction:column;gap:14px;}' +
      '.core-recap-item{border:1px solid var(--grid,#22406a);border-radius:8px;padding:12px 14px;}' +
      '.core-recap-item .qtext{margin:0 0 8px;font-size:13.5px;}' +
      '.core-recap-answer{font-size:12.5px;color:var(--green,#3ecf6d);line-height:1.5;}' +
      '.core-explain-toggle{position:fixed;top:78px;right:20px;z-index:150;' +
        'border:1px solid var(--grid,#22406a);background:var(--panel-2,#122a4a);color:var(--paper-dim,#9fb0c8);' +
        'font-size:12px;padding:7px 12px;border-radius:20px;cursor:pointer;' +
        'font-family:\'IBM Plex Mono\',monospace;box-shadow:0 4px 14px rgba(0,0,0,0.3);transition:border-color .15s ease,color .15s ease;}' +
      '.core-explain-toggle:hover{border-color:var(--cyan,#4FD1E8);color:var(--cyan,#4FD1E8);}' +
      '.core-explain-toggle.on{border-color:var(--amber,#F5A623);color:var(--amber,#F5A623);}' +
      '.core-streak-nudge{position:fixed;left:20px;bottom:20px;z-index:150;display:flex;align-items:center;gap:10px;' +
        'max-width:320px;border:1px solid var(--amber,#F5A623);background:var(--panel-2,#122a4a);color:var(--paper,#eee);' +
        'font-size:12.5px;line-height:1.4;padding:10px 12px;border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,0.45);' +
        'opacity:0;transform:translateY(10px);transition:opacity .3s ease,transform .3s ease;}' +
      '.core-streak-nudge.show{opacity:1;transform:translateY(0);}' +
      '.core-streak-nudge-icon{font-size:18px;flex:none;}' +
      '.core-streak-nudge-text{flex:1;}' +
      '.core-streak-nudge-text b{color:var(--amber,#F5A623);}' +
      '.core-streak-nudge-close{flex:none;background:none;border:none;color:var(--paper-dim,#9fb0c8);' +
        'font-size:13px;cursor:pointer;padding:2px;}' +
      '.core-fab-tertiary{right:144px;font-size:19px;}' +
      '.core-search-overlay{align-items:flex-start;padding-top:12vh;}' +
      '.core-search-card{max-width:560px;width:100%;padding:14px;}' +
      '.core-search-box{display:flex;align-items:center;gap:8px;border-bottom:1px solid var(--grid,#22406a);' +
        'padding-bottom:10px;margin-bottom:4px;}' +
      '.core-search-icon{font-size:16px;flex:none;}' +
      '.core-search-input{flex:1;background:none;border:none;outline:none;color:var(--paper,#eee);' +
        'font-size:15px;font-family:inherit;min-width:0;}' +
      '.core-search-input::placeholder{color:var(--paper-dim,#9fb0c8);}' +
      '.core-search-results{max-height:50vh;overflow-y:auto;}' +
      '.core-search-empty{padding:20px 8px;text-align:center;color:var(--paper-dim,#9fb0c8);font-size:13px;}' +
      '.core-search-item{display:flex;align-items:center;gap:10px;padding:9px 8px;border-radius:6px;cursor:pointer;}' +
      '.core-search-item.active{background:var(--panel-2,#122a4a);}' +
      '.core-search-item-icon{font-size:17px;flex:none;}' +
      '.core-search-item-title{font-size:13.5px;font-weight:600;color:var(--paper,#eee);}' +
      '.core-search-item-title mark{background:rgba(245,166,35,0.35);color:inherit;border-radius:2px;}' +
      '.core-search-item-sub{font-size:11px;color:var(--paper-dim,#9fb0c8);margin-top:2px;}' +
      '@media (max-width:520px){' +
        '.core-explain-toggle{top:64px;right:12px;font-size:11px;padding:6px 10px;}' +
        '.core-fab{width:46px;height:46px;font-size:19px;right:14px;bottom:14px;}' +
        '.core-fab-secondary{right:68px;}' +
        '.core-fab-tertiary{right:122px;}' +
        '.core-streak-nudge{left:12px;right:12px;bottom:14px;max-width:none;}' +
        '.core-search-overlay{padding-top:8vh;padding-left:10px;padding-right:10px;}' +
      '}';
    document.head.appendChild(style);
  }

  /* ------------------------------------------------------------------
     Hook installation — wraps existing globals (saves the original,
     calls it first, then adds new behavior) instead of editing them.
     ------------------------------------------------------------------ */
  var hooksInstalled = false;
  function installHooks() {
    if (hooksInstalled) return;
    hooksInstalled = true;

    var _render = render;
    render = function () {
      var result = _render.apply(this, arguments);
      syncUI();
      return result;
    };

    var _addXP = addXP;
    addXP = function () {
      var result = _addXP.apply(this, arguments);
      checkBadges();
      return result;
    };

    var _updateMastery = updateMastery;
    updateMastery = function () {
      var result = _updateMastery.apply(this, arguments);
      checkBadges();
      return result;
    };

    if (typeof submitQuiz === 'function') {
      var _submitQuiz = submitQuiz;
      submitQuiz = function () {
        var result = _submitQuiz.apply(this, arguments);
        checkBadges();
        showQuizRecap();
        return result;
      };
    }

    if (typeof renderQuizQuestion === 'function') {
      var _renderQuizQuestion = renderQuizQuestion;
      renderQuizQuestion = function (q, i) {
        var html = _renderQuizQuestion.apply(this, arguments);
        return wrapExplainVisibility(html, q);
      };
    }

    if (typeof rerenderMain === 'function') {
      var _rerenderMain = rerenderMain;
      rerenderMain = function () {
        var result = _rerenderMain.apply(this, arguments);
        renderExplainToggleButton();
        return result;
      };
    }

    // Feature 8 (badges 6/7 from the backlog): "first successful run" and
    // "first autocomplete use." Only one of runCppSubset/runHtmlCss exists
    // on a given page (cpp.html vs htmlcss_1.html) — guard each separately
    // rather than assuming which one is present. Both return {success,...},
    // which is why these are wrapped instead of runProblem/runProject/
    // runMachine: those three don't return anything, so success can only be
    // read off the shared execution primitive they all call into.
    if (typeof runCppSubset === 'function') {
      var _runCppSubset = runCppSubset;
      runCppSubset = function () {
        var result = _runCppSubset.apply(this, arguments);
        if (result && result.success) markSuccessfulRun();
        return result;
      };
    }
    if (typeof runHtmlCss === 'function') {
      var _runHtmlCss = runHtmlCss;
      runHtmlCss = function () {
        var result = _runHtmlCss.apply(this, arguments);
        if (result && result.success) markSuccessfulRun();
        return result;
      };
    }

    // acceptEditorSuggestion(el, idx) fires only when a dropdown suggestion
    // is actually accepted (Tab/Enter/click) — not on every keystroke that
    // merely opens the dropdown — so this is a true "used autocomplete"
    // signal. Present under the same name on both host pages.
    if (typeof acceptEditorSuggestion === 'function') {
      var _acceptEditorSuggestion = acceptEditorSuggestion;
      acceptEditorSuggestion = function () {
        markAutocompleteUsed();
        return _acceptEditorSuggestion.apply(this, arguments);
      };
    }
  }

  function markSuccessfulRun() {
    if (typeof STATE === 'undefined' || !STATE || STATE.hasSuccessfulRun) return;
    STATE.hasSuccessfulRun = true;
    checkBadges();
  }

  function markAutocompleteUsed() {
    if (typeof STATE === 'undefined' || !STATE || STATE.usedAutocomplete) return;
    STATE.usedAutocomplete = true;
    checkBadges();
  }

  function syncUI() {
    injectStyles();
    if (typeof STATE !== 'undefined' && STATE && !STATE.badges) STATE.badges = [];
    checkBadges();
    renderBadgeButton();
    renderReviewButton();
    renderSearchButton();
    renderExplainToggleButton();
  }

  ready(function () {
    var tries = 0;
    var poll = setInterval(function () {
      tries++;
      if (hasDeps()) {
        clearInterval(poll);
        installHooks();
        installEditorShortcuts();
        installSearchShortcut();
        syncUI();
        checkStreakNudge();
        setInterval(checkStreakNudge, 60000); // re-check every minute — catches "it's now evening" and dismiss expiry
      } else if (tries > 200) {
        clearInterval(poll); // give up quietly after ~30s rather than polling forever
      }
    }, 150);
  });

  window.CoreFeatures = {
    openBadgePanel: openBadgePanel,
    closeModal: closeCoreModal,
    openReviewMode: openReviewMode,
    revealReview: revealReview,
    rateReview: rateReview,
    dismissStreakNudge: dismissStreakNudge,
    openUnifiedSearch: openUnifiedSearch,
    searchHover: searchHover,
    searchSelect: searchSelect
  };
})();
