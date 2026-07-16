/* ============================================================
   start.js — Beginner Cyber Pathway (/start)
   Enhances the server-rendered pathway per-user: marks completed
   modules/stages, lights up badges, shows the progress bar and
   streak, offers "resume," and animates the path in. Runs
   alongside main.js (navbar + auth).
   ============================================================ */

'use strict';

document.addEventListener('DOMContentLoaded', async () => {
  const pathway = document.querySelector('.pathway');
  if (!pathway) return;

  const stages = [...pathway.querySelectorAll('.pw-stage')];
  const moduleCards = [...pathway.querySelectorAll('.card[data-topic]')];
  const totalTopics = moduleCards.length;

  // ── 1. Fetch progress + streak ───────────────────────────────
  const completed = new Set();
  let streak = 0;
  try {
    const res = await fetch('/api/progress');
    if (res.ok) {
      const data = await res.json();
      for (const r of (data.results ?? [])) completed.add(String(r.topic_id));
      streak = data.streak ?? 0;
    }
  } catch { /* logged out / offline — treat as no progress */ }

  // ── 2. Mark modules + stages, find where to resume ───────────
  let doneTopics = 0;
  let firstIncompleteStage = null;
  let resumeTopicId = null;

  stages.forEach(stage => {
    const ids = (stage.dataset.topics || '').split(/\s+/).filter(Boolean);
    let stageDone = ids.length > 0;
    ids.forEach(id => {
      const card = stage.querySelector(`.card[data-topic="${id}"]`);
      if (completed.has(id)) {
        doneTopics++;
        card && card.classList.add('card-completed', 'pw-module-done');
      } else {
        stageDone = false;
        if (!resumeTopicId) resumeTopicId = id;   // first incomplete module overall
      }
    });
    if (stageDone) {
      stage.classList.add('is-done');
    } else if (!firstIncompleteStage) {
      firstIncompleteStage = stage;
      stage.classList.add('is-active');
    }
  });

  const badgesEarned = stages.filter(s => s.classList.contains('is-done')).length;
  const pct = totalTopics ? Math.round((doneTopics / totalTopics) * 100) : 0;

  // ── 3. Status: progress bar, badges, streak, resume ──────────
  const statusEl = document.getElementById('pwStatus');
  const fillEl   = document.getElementById('pwProgressFill');
  const labelEl  = document.getElementById('pwProgressLabel');
  const streakEl = document.getElementById('pwStreak');
  const resumeEl = document.getElementById('pwResume');

  if (statusEl) statusEl.hidden = false;
  if (labelEl) {
    labelEl.textContent =
      `${doneTopics} of ${totalTopics} modules complete · ${badgesEarned} badge${badgesEarned === 1 ? '' : 's'} earned`;
  }
  // Set width on the next frame so the CSS transition animates from 0.
  if (fillEl) requestAnimationFrame(() => { fillEl.style.width = pct + '%'; });

  if (streakEl && streak > 0) {
    streakEl.hidden = false;
    streakEl.textContent = `🔥 ${streak}-day streak — keep it going!`;
  }

  if (resumeEl) {
    resumeEl.hidden = false;
    if (!resumeTopicId) {
      resumeEl.href = '/topic/10';
      resumeEl.textContent = 'Pathway complete — explore careers →';
    } else {
      resumeEl.href = `/topic/${resumeTopicId}`;
      resumeEl.textContent = doneTopics === 0 ? 'Begin Stage 1 →' : 'Continue where you left off →';
    }
  }

  // ── 4. Motion (skipped entirely when reduced motion is preferred) ──
  if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches && 'IntersectionObserver' in window) {
    pathway.classList.add('js-motion');
    const io = new IntersectionObserver((entries) => {
      entries.forEach(e => {
        if (e.isIntersecting) { e.target.classList.add('is-revealed'); io.unobserve(e.target); }
      });
    }, { threshold: 0.15, rootMargin: '0px 0px -40px 0px' });
    stages.forEach(s => io.observe(s));
  }
});
