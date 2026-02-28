/**
 * ExamFILQ'S — exam.js
 *
 * Tipe soal  : Pilihan Ganda (pg) + Esai (es)
 * Timer      : Ya (dikonfigurasi di questions.json atau CONFIG)
 * Hasil      : Hanya "Ujian selesai, terima kasih" — nilai TIDAK ditampilkan ke siswa
 * Database   : Siap dikirim ke Google Sheets via Apps Script (isi SHEETS_ENDPOINT)
 */

'use strict';

// ─── KONFIGURASI ─────────────────────────────────────────────────────────────
const CONFIG = {
  QUESTIONS_FILE   : 'questions.json',
  SHEETS_ENDPOINT  : '',    // (opsional) URL Google Apps Script deployment
  TIMER_MINUTES    : 60,    // default; bisa di-override dari questions.json > config

  // ── Supabase ──────────────────────────────────────────────────────────────
  // 1. Buat project di https://supabase.com
  // 2. Salin Project URL  → SUPABASE_URL
  // 3. Salin anon/public key → SUPABASE_ANON_KEY
  SUPABASE_URL     : 'https://gwafrmzomwjyboxeosal.supabase.co',    // contoh: 'https://xyzxyz.supabase.co'
  SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd3YWZybXpvbXdqeWJveGVvc2FsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIxNjUzODcsImV4cCI6MjA4Nzc0MTM4N30.UwHisvaqdPFTzJkK5t2drynWcII38-iV89Eef9t6VO0',

};

// ─── STATE ───────────────────────────────────────────────────────────────────
const state = {
  student    : { name: '', kelas: '' },
  questions  : [],
  glossary   : [],
  answers    : {},        // { [qIndex]: jawaban }
  flagged    : new Set(),
  current    : 0,
  timerRef   : null,
  timeLeft   : 0,         // detik
  startTime  : null,
  submitted  : false,
};

// ─── HELPERS ─────────────────────────────────────────────────────────────────
const $   = id => document.getElementById(id);
const esc = s  => String(s ?? '')
  .replace(/&/g,'&amp;').replace(/</g,'&lt;')
  .replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
const fmt = s  => esc(s).replace(/\n/g,'<br>');

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  $(id).classList.add('active');
}

function showToast(type, icon, msg) {
  const c = $('toastContainer');
  const t = document.createElement('div');
  t.className = `toast toast-${type}`;
  t.innerHTML = `<span>${icon}</span><span>${msg}</span>`;
  c.appendChild(t);
  setTimeout(() => {
    t.style.opacity = '0';
    t.style.transform = 'translateX(30px)';
    t.style.transition = 'all .3s';
    setTimeout(() => t.remove(), 300);
  }, 3000);
}

function setLoading(show, text = 'Memuat soal...') {
  $('loadingOverlay').querySelector('.loading-text').textContent = text;
  $('loadingOverlay').classList.toggle('show', show);
}

// ─── INIT ────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  showScreen('screen-login');
  checkSavedProgress();  // tampilkan banner resume jika ada sesi tersimpan
  document.addEventListener('keydown', e => {
    if (e.key === 'Enter' && $('screen-login').classList.contains('active')) startExam();
  });
});

// ─── LOGIN & MULAI UJIAN ─────────────────────────────────────────────────────
async function startExam() {
  const name  = $('input-name').value.trim();
  const kelas = $('input-kelas').value.trim();
  const errEl = $('login-error');
  errEl.classList.remove('show');

  if (!name)  { errEl.textContent = '⚠️ Nama tidak boleh kosong.';  errEl.classList.add('show'); return; }
  if (!kelas) { errEl.textContent = '⚠️ Kelas tidak boleh kosong.'; errEl.classList.add('show'); return; }

  state.student = { name, kelas };

  setLoading(true, 'Memuat soal...');
  try {
    const res = await fetch(CONFIG.QUESTIONS_FILE);
    if (!res.ok) throw new Error(`File ${CONFIG.QUESTIONS_FILE} tidak ditemukan.`);
    const data = await res.json();

    if (!Array.isArray(data.questions) || data.questions.length === 0)
      throw new Error('Soal tidak ditemukan atau format JSON tidak valid.');

    // Filter hanya PG (pg) dan Esai (es)
    state.questions = data.questions.filter(q => q.type === 'pg' || q.type === 'es' || q.type === 'cb');
    if (state.questions.length === 0)
      throw new Error('Tidak ada soal bertipe "pg", "cb", atau "es" dalam file.');

    state.glossary = Array.isArray(data.glossary) ? data.glossary : [];

    // Override timer dari JSON config jika ada
    if (data.config?.timer_minutes !== undefined)
      CONFIG.TIMER_MINUTES = Number(data.config.timer_minutes);

    setLoading(false);
    initExam();
    showScreen('screen-exam');

  } catch (err) {
    setLoading(false);
    errEl.textContent = `❌ ${err.message}`;
    errEl.classList.add('show');
  }
}

// ─── INISIALISASI LAYAR UJIAN ────────────────────────────────────────────────
function initExam() {
  state.answers   = {};
  state.flagged   = new Set();
  state.current   = 0;
  state.submitted = false;
  state.startTime = new Date();

  $('exam-user-name').textContent   = state.student.name;
  $('exam-user-kelas').textContent  = state.student.kelas;
  $('exam-user-avatar').textContent = state.student.name.charAt(0).toUpperCase();

  buildNavGrid();
  buildGlossary();
  renderQuestion(0);
  initTimer();
}

// ─── TIMER ───────────────────────────────────────────────────────────────────
function initTimer() {
  clearInterval(state.timerRef);
  if (CONFIG.TIMER_MINUTES <= 0) {
    $('exam-timer').style.display = 'none';
    return;
  }
  $('exam-timer').style.display = 'flex';
  state.timeLeft = CONFIG.TIMER_MINUTES * 60;
  updateTimerDisplay();
  state.timerRef = setInterval(() => {
    state.timeLeft--;
    updateTimerDisplay();
    if (state.timeLeft % 10 === 0) saveProgress(); // simpan setiap 10 detik
    if (state.timeLeft <= 300) $('exam-timer').classList.add('warning');
    if (state.timeLeft <= 0) {
      clearInterval(state.timerRef);
      showToast('error', '⏰', 'Waktu habis! Jawaban dikumpulkan otomatis.');
      doSubmit(true);
    }
  }, 1000);
}

function updateTimerDisplay() {
  const m = String(Math.floor(state.timeLeft / 60)).padStart(2, '0');
  const s = String(state.timeLeft % 60).padStart(2, '0');
  $('timer-display').textContent = `${m}:${s}`;
}

// ─── PANEL NAVIGASI KIRI ─────────────────────────────────────────────────────
function buildNavGrid() {
  const grid = $('q-nav-grid');
  grid.innerHTML = '';
  state.questions.forEach((_, i) => {
    const btn = document.createElement('button');
    btn.className   = 'q-nav-btn';
    btn.id          = `nav-btn-${i}`;
    btn.textContent = i + 1;
    btn.onclick     = () => renderQuestion(i);
    grid.appendChild(btn);
  });
  syncNavGrid();
}

function syncNavGrid() {
  state.questions.forEach((_, i) => {
    const btn = $(`nav-btn-${i}`);
    if (!btn) return;
    btn.className = 'q-nav-btn';
    if      (i === state.current)            btn.classList.add('current');
    else if (state.answers[i] !== undefined) btn.classList.add('answered');
    if (state.flagged.has(i))                btn.classList.add('flagged');
  });

  const answered = Object.keys(state.answers).length;
  const total    = state.questions.length;
  $('nav-answered-count').textContent = `${answered}/${total}`;
  $('nav-progress-fill').style.width  = `${Math.round(answered / total * 100)}%`;
}

// ─── RENDER SOAL ─────────────────────────────────────────────────────────────
function renderQuestion(index) {
  state.current = index;
  const q     = state.questions[index];
  const total = state.questions.length;

  $('exam-progress-fill').style.width  = `${Math.round((index + 1) / total * 100)}%`;
  $('exam-progress-label').textContent = `Soal ${index + 1} dari ${total}`;

  const typeLabel = q.type === 'pg' ? 'Pilihan Ganda'
                  : q.type === 'cb' ? 'Pilihan Ganda (Multiple)'
                  : 'Esai';
  const typePill  = q.type === 'pg' ? 'pill-pg'
                  : q.type === 'cb' ? 'pill-cb'
                  : 'pill-es';

  // --- Area Jawaban ---
  let answerHTML = '';
  if (q.type === 'pg') {
    const LABELS = ['A','B','C','D','E','F','G','H'];
    answerHTML = `<div class="answer-area">`
      + (q.options || []).map((opt, i) => {
          const sel = state.answers[index] === String(i) ? 'selected' : '';
          return `<div class="option-item ${sel}" onclick="selectPG(${index},${i})">
                    <div class="option-label">${LABELS[i] ?? i+1}</div>
                    <div class="option-text">${fmt(opt)}</div>
                  </div>`;
        }).join('')
      + `</div>`;
  } else if (q.type === 'cb') {
    // Checklist — jawaban bisa lebih dari satu
    const selected = Array.isArray(state.answers[index]) ? state.answers[index] : [];
    const LABELS   = ['A','B','C','D','E','F','G','H'];
    answerHTML = `<div class="answer-area">
      <div class="cb-hint">☑ Pilih <strong>semua</strong> jawaban yang benar</div>`
      + (q.options || []).map((opt, i) => {
          const isChecked = selected.includes(String(i));
          return `<div class="option-item cb-item ${isChecked ? 'selected' : ''}" onclick="toggleCB(${index},${i})">
                    <div class="option-label">${isChecked ? '☑' : '☐'}</div>
                    <div class="option-text">${fmt(opt)}</div>
                  </div>`;
        }).join('')
      + `<div class="cb-counter" id="cb-counter-${index}">${selected.length} jawaban dipilih</div>
      </div>`;
  } else {
    // Esai
    const val = esc(state.answers[index] ?? '');
    answerHTML = `<div class="answer-area">
      <textarea class="essay-textarea" rows="7"
        placeholder="Tuliskan jawaban Anda di sini..."
        oninput="saveEssay(${index}, this.value)"
      >${val}</textarea>
      <div class="essay-counter" id="essay-counter-${index}">
        ${(state.answers[index] ?? '').length} karakter
      </div>
    </div>`;
  }

  // --- Gambar soal (opsional) ---
  const imgHTML = q.image
    ? `<div class="question-image-wrap">
         <img src="images/${esc(q.image)}"
              alt="Gambar soal ${index + 1}"
              class="question-image"
              onload="this.style.opacity='1'"
              onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">
         <div class="question-image-error" style="display:none">
           ⚠️ Gambar tidak ditemukan: <code>images/${esc(q.image)}</code>
         </div>
       </div>`
    : '';

  // --- Tombol navigasi ---
  const isFirst = index === 0;
  const isLast  = index === total - 1;
  const navHTML = `
    <div class="question-nav-btns" style="margin-top:20px">
      <button class="btn-nav btn-prev" onclick="prevQuestion()"
        ${isFirst ? 'disabled style="opacity:.4;cursor:not-allowed"' : ''}>
        ← Sebelumnya
      </button>
      <button class="btn-flag ${state.flagged.has(index) ? 'flagged' : ''}"
        onclick="toggleFlag(${index})">
        ${state.flagged.has(index) ? '🚩 Ditandai' : '🏴 Tandai'}
      </button>
      ${isLast
        ? `<button class="btn-submit" onclick="openConfirmModal()">Selesai &amp; Kumpulkan ✓</button>`
        : `<button class="btn-nav btn-next" onclick="nextQuestion()">Berikutnya →</button>`
      }
    </div>`;

  $('exam-main-panel').innerHTML = `
    <div class="question-card">
      <div class="question-number">
        Soal ${index + 1} dari ${total}
        <span class="question-type-pill ${typePill}">${typeLabel}</span>
        ${q.subject ? `<span class="pill-subject">${esc(q.subject)}</span>` : ''}
        ${q.points  ? `<span class="pill-points">${q.points} poin</span>` : ''}
      </div>
      <div class="question-text">${fmt(q.question)}</div>
      ${imgHTML}
      ${answerHTML}
      ${navHTML}
    </div>`;

  syncNavGrid();
}

// ─── HANDLER JAWABAN ─────────────────────────────────────────────────────────
function selectPG(qIndex, optIndex) {
  state.answers[qIndex] = String(optIndex);
  saveProgress();
  renderQuestion(qIndex);
}

function toggleCB(qIndex, optIndex) {
  const key = String(optIndex);
  if (!Array.isArray(state.answers[qIndex])) state.answers[qIndex] = [];
  const arr = state.answers[qIndex];
  const pos = arr.indexOf(key);
  if (pos === -1) arr.push(key);
  else arr.splice(pos, 1);
  if (arr.length === 0) delete state.answers[qIndex];
  saveProgress();
  renderQuestion(qIndex);
}

function saveEssay(qIndex, val) {
  if (val.trim() === '') delete state.answers[qIndex];
  else state.answers[qIndex] = val;
  const counter = $(`essay-counter-${qIndex}`);
  if (counter) counter.textContent = `${val.length} karakter`;
  saveProgress();
  syncNavGrid();
}

// ─── NAVIGASI ────────────────────────────────────────────────────────────────
function nextQuestion() { if (state.current < state.questions.length - 1) renderQuestion(state.current + 1); }
function prevQuestion() { if (state.current > 0) renderQuestion(state.current - 1); }

function toggleFlag(i) {
  state.flagged.has(i) ? state.flagged.delete(i) : state.flagged.add(i);
  saveProgress();
  renderQuestion(i);
}

// ─── MODAL KONFIRMASI SUBMIT ─────────────────────────────────────────────────
function openConfirmModal() {
  const total      = state.questions.length;
  const answered   = Object.keys(state.answers).length;
  const unanswered = total - answered;

  $('confirm-summary').innerHTML = `
    <p>Total soal &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;: <strong>${total}</strong></p>
    <p>Sudah dijawab &nbsp;: <strong style="color:var(--green2)">${answered}</strong></p>
    <p>Belum dijawab &nbsp;: <strong style="color:${unanswered > 0 ? 'var(--gold2)' : 'var(--green2)'}">${unanswered}</strong></p>
    ${state.flagged.size > 0 ? `<p>Ditandai 🚩 &nbsp;&nbsp;&nbsp;: <strong style="color:var(--gold2)">${state.flagged.size}</strong></p>` : ''}
  `;
  $('confirm-modal').classList.add('open');
}
function closeConfirmModal() { $('confirm-modal').classList.remove('open'); }

// ─── SUBMIT ──────────────────────────────────────────────────────────────────
async function doSubmit(auto = false) {
  if (state.submitted) return;
  state.submitted = true;
  clearInterval(state.timerRef);
  closeConfirmModal();

  const duration = Math.round((new Date() - state.startTime) / 1000);
  const result   = calcScore();
  const payload  = buildPayload(result, duration);

  let submitted = false;

  // ── 1. Kirim ke Supabase ──────────────────────────────────────────────────
  if (CONFIG.SUPABASE_URL && CONFIG.SUPABASE_ANON_KEY) {
    try {
      setLoading(true, 'Mengirim jawaban...');
      const ok = await sendToSupabase(payload);
      setLoading(false);
      if (ok) {
        submitted = true;
        showToast('success', '✅', 'Jawaban berhasil dikumpulkan!');
      } else {
        showToast('error', '⚠️', 'Gagal mengirim ke Supabase. Data disimpan lokal.');
        saveLocal(payload);
      }
    } catch (err) {
      setLoading(false);
      showToast('error', '⚠️', `Gagal mengirim: ${err.message}. Data disimpan lokal.`);
      saveLocal(payload);
    }
  }

  // ── 2. Kirim ke Google Sheets (opsional, bisa dipakai bersamaan) ──────────
  if (CONFIG.SHEETS_ENDPOINT) {
    try {
      if (!submitted) setLoading(true, 'Mengirim jawaban...');
      await fetch(CONFIG.SHEETS_ENDPOINT, {
        method : 'POST',
        mode   : 'no-cors',
        headers: { 'Content-Type': 'application/json' },
        body   : JSON.stringify(payload),
      });
      setLoading(false);
      submitted = true;
    } catch (err) {
      setLoading(false);
      if (!submitted) {
        showToast('error', '⚠️', 'Gagal mengirim ke Google Sheets. Data disimpan lokal.');
        saveLocal(payload);
      }
    }
  }

  // ── 3. Tidak ada endpoint sama sekali — simpan lokal ─────────────────────
  if (!CONFIG.SUPABASE_URL && !CONFIG.SHEETS_ENDPOINT) {
    saveLocal(payload);
  }

  // Tampilkan durasi di layar hasil
  const mm = String(Math.floor(duration / 60)).padStart(2, '0');
  const ss = String(duration % 60).padStart(2, '0');
  $('result-duration').textContent = `${mm} menit ${ss} detik`;

  $('result-student-name').textContent  = state.student.name;
  $('result-student-kelas').textContent = state.student.kelas;
  clearProgress();   // hapus progress setelah berhasil submit
  showScreen('screen-result');
}

// ─── KIRIM KE SUPABASE ───────────────────────────────────────────────────────
async function sendToSupabase(payload) {
  // Tabel utama: exam_submissions
  const submissionRow = {
    submitted_at  : payload.timestamp,
    student_name  : payload.name,
    kelas         : payload.kelas,
    duration_s    : payload.duration_s,
    pg_correct    : payload.pg_correct,
    pg_wrong      : payload.pg_wrong,
    cb_correct    : payload.cb_correct,
    cb_wrong      : payload.cb_wrong,
    essay_count   : payload.essay_count,
  };

  const res = await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/exam_submissions`, {
    method : 'POST',
    headers: {
      'Content-Type'  : 'application/json',
      'apikey'        : CONFIG.SUPABASE_ANON_KEY,
      'Authorization' : `Bearer ${CONFIG.SUPABASE_ANON_KEY}`,
      'Prefer'        : 'return=representation',
    },
    body: JSON.stringify(submissionRow),
  });

  if (!res.ok) {
    const errText = await res.text();
    console.error('Supabase submission error:', errText);
    return false;
  }

  const [inserted] = await res.json();
  const submissionId = inserted?.id;

  // Tabel detail: exam_answers (satu baris per soal)
  if (submissionId) {
    const answerRows = payload.answers.map(a => ({
      submission_id   : submissionId,
      no              : a.no,
      type            : a.type,
      question        : a.question,
      student_answer  : a.student_answer,
      correct_answer  : a.correct_answer,
      status          : a.status,
    }));

    const resAnswers = await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/exam_answers`, {
      method : 'POST',
      headers: {
        'Content-Type'  : 'application/json',
        'apikey'        : CONFIG.SUPABASE_ANON_KEY,
        'Authorization' : `Bearer ${CONFIG.SUPABASE_ANON_KEY}`,
      },
      body: JSON.stringify(answerRows),
    });

    if (!resAnswers.ok) {
      console.warn('Gagal menyimpan detail jawaban:', await resAnswers.text());
      // Tidak return false — submission utama berhasil
    }
  }

  return true;
}

// ─── HITUNG SKOR (internal — hanya dikirim ke database, tidak ke siswa) ──────
function calcScore() {
  let pgCorrect = 0, pgWrong = 0, cbCorrect = 0, cbWrong = 0, essay = 0;

  state.questions.forEach((q, i) => {
    if (q.type === 'pg') {
      String(state.answers[i]) === String(q.answer) ? pgCorrect++ : pgWrong++;
    } else if (q.type === 'cb') {
      const studentArr = Array.isArray(state.answers[i])
        ? [...state.answers[i]].map(String).sort()
        : [];
      const correctArr  = Array.isArray(q.answer)
        ? [...q.answer].map(String).sort()
        : [];
      const isCorrect = studentArr.length === correctArr.length
        && studentArr.every((v, idx) => v === correctArr[idx]);
      isCorrect ? cbCorrect++ : cbWrong++;
    } else {
      essay++;
    }
  });
  return { pgCorrect, pgWrong, cbCorrect, cbWrong, essay };
}

// ─── BUILD PAYLOAD ────────────────────────────────────────────────────────────
function buildPayload(result, duration, endTime) {
  return {
    timestamp   : (endTime || new Date()).toISOString(),
    name        : state.student.name,
    kelas       : state.student.kelas,
    duration_s  : duration,
    pg_correct  : result.pgCorrect,
    pg_wrong    : result.pgWrong,
    cb_correct  : result.cbCorrect,
    cb_wrong    : result.cbWrong,
    essay_count : result.essay,
    answers     : state.questions.map((q, i) => {
      const ans = state.answers[i];
      let studentAns, correctAns, status;

      if (q.type === 'pg') {
        studentAns = ans !== undefined ? String(ans) : '';
        correctAns = q.answer !== undefined ? String(q.answer) : '';
        status     = String(ans) === String(q.answer) ? 'benar' : 'salah';
      } else if (q.type === 'cb') {
        const studentArr = Array.isArray(ans) ? [...ans].map(String).sort() : [];
        const correctArr  = Array.isArray(q.answer) ? [...q.answer].map(String).sort() : [];
        studentAns = studentArr.join(',');
        correctAns = correctArr.join(',');
        status     = studentAns === correctAns ? 'benar' : 'salah';
      } else {
        studentAns = ans || '';
        correctAns = '';
        status     = 'perlu_koreksi';
      }

      return {
        no             : i + 1,
        type           : q.type,
        question       : q.question,
        student_answer : studentAns,
        correct_answer : correctAns,
        status,
      };
    }),
  };
}

function saveLocal(payload) {
  try {
    const key  = 'examfilqs_submissions';
    const prev = JSON.parse(localStorage.getItem(key) || '[]');
    prev.push(payload);
    localStorage.setItem(key, JSON.stringify(prev));
  } catch (e) { /* storage penuh */ }
}

// ─── AUTO-SAVE PROGRESS ───────────────────────────────────────────────────────
const PROGRESS_KEY = 'examfilqs_progress';

/** Simpan progress ujian saat ini ke localStorage */
function saveProgress() {
  if (state.submitted || !state.student.name) return;
  try {
    const data = {
      student   : state.student,
      answers   : state.answers,
      flagged   : [...state.flagged],
      current   : state.current,
      timeLeft  : state.timeLeft,
      savedAt   : Date.now(),
    };
    localStorage.setItem(PROGRESS_KEY, JSON.stringify(data));
  } catch (e) { /* storage penuh */ }
}

/** Hapus progress (setelah submit atau kembali ke login) */
function clearProgress() {
  try { localStorage.removeItem(PROGRESS_KEY); } catch (e) {}
}

/** Muat progress tersimpan, kembalikan objek atau null */
function loadProgress() {
  try {
    const raw = localStorage.getItem(PROGRESS_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    // Hitung sisa waktu yang sebenarnya (sudah berkurang sejak disimpan)
    const elapsedSec = Math.floor((Date.now() - data.savedAt) / 1000);
    data.timeLeft = Math.max(0, (data.timeLeft || 0) - elapsedSec);
    return data;
  } catch (e) { return null; }
}

/** Cek apakah ada sesi tersimpan dan tampilkan banner resume */
function checkSavedProgress() {
  const saved = loadProgress();
  const banner = $('resume-banner');
  if (!banner) return;
  if (saved && saved.student?.name && saved.timeLeft > 0) {
    $('resume-name').textContent  = saved.student.name;
    $('resume-kelas').textContent = saved.student.kelas;
    const mm = String(Math.floor(saved.timeLeft / 60)).padStart(2, '0');
    const ss = String(saved.timeLeft % 60).padStart(2, '0');
    $('resume-time').textContent  = `${mm}:${ss}`;
    banner.style.display = 'flex';
  } else {
    banner.style.display = 'none';
    clearProgress();
  }
}

/** Lanjutkan sesi yang tersimpan */
async function resumeSession() {
  const saved = loadProgress();
  if (!saved) return;

  setLoading(true, 'Memuat soal...');
  try {
    const res  = await fetch(CONFIG.QUESTIONS_FILE);
    if (!res.ok) throw new Error(`Gagal memuat ${CONFIG.QUESTIONS_FILE}`);
    const data = await res.json();

    state.questions = data.questions.filter(q => q.type === 'pg' || q.type === 'es' || q.type === 'cb');
    state.glossary  = Array.isArray(data.glossary) ? data.glossary : [];
    if (data.config?.timer_minutes !== undefined)
      CONFIG.TIMER_MINUTES = Number(data.config.timer_minutes);

    // Pulihkan state dari localStorage
    state.student   = saved.student;
    state.answers   = saved.answers  || {};
    state.flagged   = new Set(saved.flagged || []);
    state.current   = saved.current  || 0;
    state.submitted = false;
    state.startTime = new Date(Date.now() - (CONFIG.TIMER_MINUTES * 60 - saved.timeLeft) * 1000);

    setLoading(false);

    // Init UI tanpa reset answers
    $('exam-user-name').textContent   = state.student.name;
    $('exam-user-kelas').textContent  = state.student.kelas;
    $('exam-user-avatar').textContent = state.student.name.charAt(0).toUpperCase();
    buildNavGrid();
    buildGlossary();
    renderQuestion(state.current);

    // Timer mulai dari sisa waktu
    clearInterval(state.timerRef);
    $('exam-timer').style.display = 'flex';
    state.timeLeft = saved.timeLeft;
    updateTimerDisplay();
    state.timerRef = setInterval(() => {
      state.timeLeft--;
      updateTimerDisplay();
      saveProgress();   // auto-save tiap detik
      if (state.timeLeft <= 300) $('exam-timer').classList.add('warning');
      if (state.timeLeft <= 0) {
        clearInterval(state.timerRef);
        showToast('error', '⏰', 'Waktu habis! Jawaban dikumpulkan otomatis.');
        doSubmit(true);
      }
    }, 1000);

    showScreen('screen-exam');
    showToast('success', '🔄', 'Sesi dilanjutkan dari penyimpanan terakhir!');
  } catch (err) {
    setLoading(false);
    showToast('error', '❌', `Gagal melanjutkan: ${err.message}`);
  }
}

// ─── GLOSARIUM ───────────────────────────────────────────────────────────────
function buildGlossary() {
  updateGlossaryBadge(state.glossary.length, state.glossary.length);
  renderGlossaryList(state.glossary, '');

  $('glossary-search').addEventListener('input', function () {
    const q = this.value.trim();
    const filtered = q
      ? state.glossary.filter(g =>
          g.term.toLowerCase().includes(q.toLowerCase()) ||
          g.definition.toLowerCase().includes(q.toLowerCase())
        )
      : state.glossary;

    // Reset scroll ke atas saat search berubah
    const container = $('glossary-list-container');
    if (container) container.scrollTop = 0;

    updateGlossaryBadge(filtered.length, state.glossary.length);
    renderGlossaryList(filtered, q);
  });
}

function updateGlossaryBadge(shown, total) {
  const badge = $('glossary-count');
  if (!badge) return;
  badge.textContent = shown === total
    ? `${total} istilah`
    : `${shown} / ${total}`;
}

function highlightText(text, query) {
  if (!query) return esc(text);
  const escaped = esc(text);
  const escapedQ = esc(query).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return escaped.replace(
    new RegExp(`(${escapedQ})`, 'gi'),
    '<span class="glossary-highlight">$1</span>'
  );
}

function renderGlossaryList(items, query) {
  if (!items || items.length === 0) {
    $('glossary-list').innerHTML = `<div class="glossary-empty">
      ${query ? `Tidak ada istilah "<strong>${esc(query)}</strong>"` : 'Tidak ada entri'}
    </div>`;
    return;
  }
  $('glossary-list').innerHTML = items.map(g => `
    <div class="glossary-item">
      <div class="glossary-term">${highlightText(g.term, query)}</div>
      <div class="glossary-def">${highlightText(g.definition, query)}</div>
    </div>`).join('');
}

// ─── KEMBALI KE HALAMAN LOGIN ─────────────────────────────────────────────────
function backToLogin() {
  clearInterval(state.timerRef);
  clearProgress();   // hapus progress saat kembali ke login
  Object.assign(state, {
    student   : { name:'', kelas:'' },
    questions : [],
    glossary  : [],
    answers   : {},
    flagged   : new Set(),
    current   : 0,
    submitted : false,
    timeLeft  : 0,
  });
  $('input-name').value  = '';
  $('input-kelas').value = '';
  $('login-error').classList.remove('show');
  $('exam-timer').classList.remove('warning');
  checkSavedProgress();  // sembunyikan/tampilkan banner resume
  showScreen('screen-login');
}
