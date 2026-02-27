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
  SUPABASE_URL     : '',    // contoh: 'https://xyzxyz.supabase.co'
  SUPABASE_ANON_KEY: '',    // contoh: 'eyJhbGciOiJIUzI1NiIsInR5cCI6...'
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
    // Soal di-embed langsung (tidak perlu fetch file eksternal)
    const data = JSON.parse(`{"config": {"timer_minutes": 90}, "glossary": [{"term": "Above", "definition": "Di atas"}, {"term": "Accelerates", "definition": "Mempercepat"}, {"term": "Altered", "definition": "Berubah"}, {"term": "Another", "definition": "Lain"}, {"term": "Attract", "definition": "Menarik"}, {"term": "Attracted", "definition": "Tertarik"}, {"term": "Avoid", "definition": "Menghindari"}, {"term": "Balanced", "definition": "Seimbang"}, {"term": "Bonds", "definition": "Ikatan"}, {"term": "Broken", "definition": "Patah"}, {"term": "Brought", "definition": "Dibawa"}, {"term": "Carrying", "definition": "Membawa"}, {"term": "Changes", "definition": "Perubahan"}, {"term": "Changing", "definition": "Mengubah"}, {"term": "Coil", "definition": "Kumparan"}, {"term": "Comply", "definition": "Mematuhi"}, {"term": "Compound", "definition": "Senyawa"}, {"term": "Conducting", "definition": "Menjalankan"}, {"term": "Considered", "definition": "Dipertimbangkan"}, {"term": "Context", "definition": "Konteks"}, {"term": "Damaging", "definition": "Merusak"}, {"term": "Decreases", "definition": "Berkurang"}, {"term": "Differ", "definition": "Beda"}, {"term": "Difference", "definition": "Perbedaan"}, {"term": "Direction", "definition": "Arah"}, {"term": "Disappear", "definition": "Hilang"}, {"term": "Dropping", "definition": "Menjatuhkan"}, {"term": "Each", "definition": "Masing-masing"}, {"term": "Eliminated", "definition": "Dihilangkan"}, {"term": "Evidence", "definition": "Bukti"}, {"term": "Exactly", "definition": "Tepat"}, {"term": "Flowing", "definition": "Mengalir"}, {"term": "Forming", "definition": "Membentuk"}, {"term": "General", "definition": "Umum"}, {"term": "Glucose", "definition": "Glukosa"}, {"term": "Greater", "definition": "Lebih Besar"}, {"term": "Happen", "definition": "Terjadi"}, {"term": "Harmless", "definition": "Tidak Berbahaya"}, {"term": "Hitting", "definition": "Memukul"}, {"term": "Induction", "definition": "Induksi"}, {"term": "Involve", "definition": "Melibatkan"}, {"term": "Irreversible", "definition": "Tidak dapat dibalik"}, {"term": "Keeping", "definition": "Menjaga"}, {"term": "Main", "definition": "Utama"}, {"term": "Migratory", "definition": "Migrasi"}, {"term": "Needle", "definition": "Jarum"}, {"term": "Occur", "definition": "Terjadi"}, {"term": "Occurred", "definition": "Terjadi"}, {"term": "Occurs", "definition": "Terjadi"}, {"term": "Other", "definition": "Lainnya"}, {"term": "Oxidation", "definition": "Oksidasi"}, {"term": "Passing", "definition": "Lewat"}, {"term": "Pieces", "definition": "Potongan"}, {"term": "Precipitate", "definition": "Mengendap"}, {"term": "Properties", "definition": "Sifat"}, {"term": "Reacts", "definition": "Bereaksi"}, {"term": "Releases", "definition": "Melepas"}, {"term": "Remain", "definition": "Tetap"}, {"term": "Repel", "definition": "Menolak"}, {"term": "Resulting", "definition": "Menghasilkan"}, {"term": "Return", "definition": "Kembali"}, {"term": "Reversed", "definition": "Dibalik"}, {"term": "Rotate", "definition": "Memutar"}, {"term": "Several", "definition": "Beberapa"}, {"term": "Shape", "definition": "Bentuk"}, {"term": "Slightly", "definition": "Sedikit"}, {"term": "Source", "definition": "Sumber"}, {"term": "Spoiled", "definition": "Busuk"}, {"term": "Steam", "definition": "Uap"}, {"term": "Strength", "definition": "Kekuatan"}, {"term": "Stroking", "definition": "Mengusap"}, {"term": "Strongly", "definition": "Sangat"}, {"term": "Subscripts", "definition": "Subskrip"}, {"term": "Substances", "definition": "Zat"}, {"term": "Synthesis", "definition": "Sintesis"}, {"term": "Through", "definition": "Melalui"}, {"term": "Torn", "definition": "Robek"}, {"term": "Undergoes", "definition": "Mengalami"}, {"term": "Ways", "definition": "Cara"}, {"term": "Without", "definition": "Tanpa"}], "questions": [{"type": "pg", "subject": "Science", "points": 2, "question": "1. Based on their response to a magnetic field, there are three types of magnetic materials, namely ferromagnetic, paramagnetic, and diamagnetic. The material that is strongly attracted to magnets and can become a magnet, namely ….", "options": ["a. ferromagnetic", "b. paramagnetic", "c. diamagnetic", "d. barmagnetic"], "answer": "0"}, {"type": "pg", "subject": "Science", "points": 2, "question": "2. The following material considered paramagnetic is ….", "options": ["a. iron", "b. aluminium", "c. wood", "d. plastic"], "answer": "1"}, {"type": "pg", "subject": "Science", "points": 2, "question": "3. These are some correct ways to make a magnet, except ….", "options": ["a. stroking", "b. heating", "c. induction", "d. electromagnetism"], "answer": "1"}, {"type": "pg", "subject": "Science", "points": 2, "question": "4. If the north pole of a magnet is brought close to the north pole of another magnet, what will happen?", "options": ["a. they cancel each other out", "b. they attract each other", "c. they repel each other", "d. they rotate to face south"], "answer": "2"}, {"type": "pg", "subject": "Science", "points": 2, "question": "5. Look at the picture. The correct direction of the following magnetic field lines is ….", "options": ["a. A", "b. B", "c. C", "d. D"], "answer": "1", "image": "soal5.png"}, {"type": "pg", "subject": "Science", "points": 2, "question": "6. Look at the picture. The image above shows 3 bar magnets. If C is the north pole, B and C repel each other, D and E attract each other, then the types of poles at A and F are ….", "options": ["a. A the north pole and F the south pole", "b. A the south pole and F the north pole", "c. A and F are the north poles", "d. A and F are the south poles"], "answer": "3", "image": "soal6.png"}, {"type": "pg", "subject": "Science", "points": 2, "question": "7. Look at the picture. Based on the image above, the poles of magnet A and B are ….", "options": ["a. A the north pole and B is the south pole", "b. A is the south pole and B is the north pole", "c. A and B are the north poles", "d. A dan B are the south poles"], "answer": "1", "image": "soal7.png"}, {"type": "pg", "subject": "Science", "points": 2, "question": "8. A compass needle points North because it is attracted to the ….", "options": ["a. the Earth's magnetic south pole", "b. the equator", "c. magnetic north pole", "d. the geographic north pole exactly"], "answer": "0"}, {"type": "pg", "subject": "Science", "points": 2, "question": "9. A wire 50 cm long is in a magnetic field of 20 T. If the current flowing is 5 A, then the Lorentz force is ….", "options": ["a. 5 N", "b. 50 N", "c. 500 N", "d. 5000 N"], "answer": "1"}, {"type": "pg", "subject": "Science", "points": 2, "question": "10. Pay attention to the following image. Based on the image, determine the value of the primary current is ….\\n\\n(Vp = 100 V, Vs = 50 V, Is = 0,4 A)", "options": ["a. 0,1 A", "b. 0,2 A", "c. 0,3 A", "d. 0,4 A"], "answer": "1", "image": "soal10.png"}, {"type": "pg", "subject": "Science", "points": 2, "question": "11. A step down transformator is connected to a voltage of 6000 volts. If the resulting electric current is 5 A and the electrical power in the secondary coil is 27.000 watt, determine the efficiency of the transformer….", "options": ["a. 75 %", "b. 85 %", "c. 90 %", "d. 111 %"], "answer": "2"}, {"type": "pg", "subject": "Science", "points": 2, "question": "12. Pay attention to the following table. The types of transformer P and Q are ….\\n\\nTransformer P: Primary voltage 110V, Secondary voltage 200V\\nTransformer Q: Primary voltage 220V, Secondary voltage 110V", "options": ["a. transformer P is step up and transformer Q is step down", "b. transformer Q is step up and transformer P is step down", "c. transformer P and transformer Q are step up", "d. transformer P and transformer Q are step down"], "answer": "0", "image": "soal12.png"}, {"type": "pg", "subject": "Science", "points": 2, "question": "13. The following events that are not chemical reactions are...", "options": ["a. iron rusting", "b. paper burning", "c. ice melting", "d. photosynthesis"], "answer": "2"}, {"type": "pg", "subject": "Science", "points": 2, "question": "14. What is the main difference between a physical change and a chemical change?", "options": ["a. color of the substance", "b. properties of the substance", "c. shape of the substance", "d. formation of a new substance"], "answer": "3"}, {"type": "pg", "subject": "Science", "points": 2, "question": "15. What is an example of a chemical change?", "options": ["a. cooking rice", "b. making water into ice", "c. mixing sugar with water", "d. freezing water"], "answer": "0"}, {"type": "pg", "subject": "Science", "points": 2, "question": "16. What is meant by a chemical reaction?", "options": ["a. change in the form of a substance", "b. change in the properties of a substance", "c. change in a substance that cannot be reversed", "d. change in the color of a substance"], "answer": "2"}, {"type": "pg", "subject": "Science", "points": 2, "question": "17. Pay attention to the following question.\\n\\nIn the reaction equation 2H₂ + O₂ → 2H₂O, the product is...\\na. H₂\\nb. O₂\\nc. H₂O\\nd. H₂ and O₂", "options": ["a. a", "b. b", "c. c", "d. d"], "answer": "2"}, {"type": "pg", "subject": "Science", "points": 2, "question": "18. What is the general form of a decomposition reaction?", "options": ["a. A + B → AB", "b. AB → A + B", "c. A → B", "d. A + B → C"], "answer": "1"}, {"type": "pg", "subject": "Science", "points": 2, "question": "19. The general formula for a synthesis reaction is shown by ….", "options": ["a. A + B → AB", "b. AB → A + B", "c. A → B", "d. A + B → C"], "answer": "0"}, {"type": "pg", "subject": "Science", "points": 2, "question": "20. What happens in a chemical decomposition reaction?", "options": ["a. a substance is broken down into new, more complex substances", "b. a substance is broken down into new, simpler substances", "c. a substance undergoes a color change", "d. a substance reacts to form a complex compound"], "answer": "1"}, {"type": "pg", "subject": "Science", "points": 2, "question": "21. What is meant by a reactant in a chemical reaction?", "options": ["a. a substance produced after the reaction", "b. a substance used before the reaction", "c. a substance that is irreversible", "d. a substance that can return to its original form"], "answer": "1"}, {"type": "pg", "subject": "Science", "points": 2, "question": "22. Which of the following is always involved in a combustion reaction?", "options": ["a. water", "b. oxygen", "c. carbon dioxide", "d. hydrogen"], "answer": "1"}, {"type": "pg", "subject": "Science", "points": 2, "question": "23. What happens in a combination or synthesis reaction?", "options": ["a. A substance decomposes into simpler substances", "b. Simple substances combine to form a new product", "c. The substance changes color", "d. The substance evaporates into a gas"], "answer": "1"}, {"type": "pg", "subject": "Science", "points": 2, "question": "24. What is the balanced chemical equation for the reaction between sodium and chlorine gas?\\n\\na. 2Na (s) + Cl₂ (g) → NaCl (s)\\nb. Na (s) + Cl₂ (g) → NaCl (s)\\nc. Na (s) + 2Cl₂ (g) → NaCl (s)\\nd. 2Na (s) + 2Cl₂ (g) → 2NaCl (s)", "options": ["a. 2Na (s) + Cl₂ (g) → NaCl (s)", "b. Na (s) + Cl₂ (g) → NaCl (s)", "c. Na (s) + 2Cl₂ (g) → NaCl (s)", "d. 2Na (s) + 2Cl₂ (g) → 2NaCl (s)"], "answer": "3"}, {"type": "pg", "subject": "Science", "points": 2, "question": "25. What is meant by corrosive in the context of chemistry?", "options": ["a. harmless", "b. friendly", "c. damaging and dangerous", "d. colorless"], "answer": "2"}, {"type": "cb", "subject": "Science", "points": 3, "question": "26. The following is the method to save physical magnets (keeping strength) are ….\\n\\nChoose ALL correct answers.", "options": ["a. use keepers", "b. hitting or dropping", "c. use AC current", "d. avoid metal and heat"], "answer": ["0", "3"]}, {"type": "cb", "subject": "Science", "points": 3, "question": "27. If a bar magnet is cut into 2, the pieces will have the following properties, among other …\\n\\nChoose ALL correct answers.", "options": ["a. only has a south pole", "b. the piece is magnetic", "c. has a north pole and a south pole", "d. only has a north pole"], "answer": ["1", "2"]}, {"type": "cb", "subject": "Science", "points": 3, "question": "28. The properties of magnets are….\\n\\nChoose ALL correct answers.", "options": ["a. has a north pole and a south pole", "b. can attract certain object, like iron", "c. like poles attract each other", "d. not has a magnetic field"], "answer": ["0", "1"]}, {"type": "cb", "subject": "Science", "points": 3, "question": "29. The following materials considered diamagnetic are ….\\n\\nChoose ALL correct answers.", "options": ["a. gold", "b. nickel", "c. plastic", "d. cobalt"], "answer": ["0", "2"]}, {"type": "cb", "subject": "Science", "points": 3, "question": "30. The correct statement about ferromagnetic material are ….\\n\\nChoose ALL correct answers.", "options": ["a. strongly attracted to magnet", "b. can become magnet", "c. an example of the object is wood", "d. not attracted by magnets"], "answer": ["0", "1"]}, {"type": "cb", "subject": "Science", "points": 3, "question": "31. The correct example of physical and chemical changes is ….\\n\\nChoose ALL correct answers.", "options": ["a. water freezing into ice is a chemical change", "b. rusting iron is a chemical change", "c. burning wood produces a new substance", "d. cutting paper is a chemical reaction"], "answer": ["1", "2"]}, {"type": "cb", "subject": "Science", "points": 3, "question": "32. The correct example of chemical reactions in daily life is ….\\n\\nChoose ALL correct answers.", "options": ["a. water heated until it boils is a chemical reaction", "b. ice melting to form a new substance", "c. photosynthesis produces a new substance in the form of glucose", "d. spoiled milk is the result of a chemical reaction"], "answer": ["2", "3"]}, {"type": "cb", "subject": "Science", "points": 3, "question": "33. Types of Chemical Reactions are ….\\n\\nChoose ALL correct answers.", "options": ["a. decomposition reactions produce only one type of substance", "b. combustion reactions always involve oxygen", "c. synthesis reactions are the combination of several substances into a new substance", "d. the change of water into steam is considered a decomposition reaction"], "answer": ["1", "2"]}, {"type": "cb", "subject": "Science", "points": 3, "question": "34. Examples of Reaction Energy & Experimental Evidence are ….\\n\\nChoose ALL correct answers.", "options": ["a. the formation of a precipitate indicates that no chemical reaction has occurred", "b. a solution that changes color only undergoes a physical change", "c. an exothermic reaction is characterized by a rise in the surrounding temperature because heat is released", "d. energy changes in chemical reactions occur due to the breaking and forming of chemical bonds"], "answer": ["2", "3"]}, {"type": "cb", "subject": "Science", "points": 3, "question": "35. Law of Conservation of Mass & Reaction Balancing is ….\\n\\nChoose ALL correct answers.", "options": ["a. in a chemical reaction in a closed system, the total mass of substances before and after the reaction remains constant", "b. if the coefficients are increased, then the total mass of substances after the reaction becomes greater than before the reaction", "c. reaction coefficients can be changed, but the chemical formulas of the substances must not be altered when balancing", "d. balancing a reaction is done by changing the subscripts (small numbers) in the chemical formulas"], "answer": ["0", "2"]}, {"type": "es", "subject": "Science", "points": 4, "question": "36. Mention 3 ways to eliminate magnetic properties!", "answer": null}, {"type": "es", "subject": "Science", "points": 4, "question": "37. Write a simple reaction equation for photosynthesis!", "answer": null}, {"type": "es", "subject": "Science", "points": 4, "question": "38. Look at the picture. Based on the image below, the poles of magnets 1, 2, 3, 4, 5, and 6 are ….\\n\\n(Gambar: Besi 1-2, Baja (elektromagnet), Besi 3-4, Besi 5-6)", "answer": null, "image": "soal38.png"}, {"type": "es", "subject": "Science", "points": 4, "question": "39. Mention 4 characteristics of a chemical reaction!", "answer": null}, {"type": "es", "subject": "Science", "points": 4, "question": "40. Ben and Cam are conducting a physics experiment in the laboratory. Ben measures the current passing through an electronic component with a resistance of 25 Ohm. The component is given a voltage of 5 volts. It turns out that the measured electric current is the same as the electric current passing through Cam's current-carrying wire. If the current-carrying wire is 2 m long and is in a 4 T magnetic field, determine the magnitude of the resulting Lorentz force!", "answer": null}]}`);

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
  renderQuestion(qIndex);
}

function toggleCB(qIndex, optIndex) {
  const key = String(optIndex);
  if (!Array.isArray(state.answers[qIndex])) state.answers[qIndex] = [];
  const arr = state.answers[qIndex];
  const pos = arr.indexOf(key);
  if (pos === -1) arr.push(key);
  else arr.splice(pos, 1);
  // Hapus jawaban jika tidak ada yang dipilih
  if (arr.length === 0) delete state.answers[qIndex];
  renderQuestion(qIndex);
}

function saveEssay(qIndex, val) {
  if (val.trim() === '') delete state.answers[qIndex];
  else state.answers[qIndex] = val;
  const counter = $(`essay-counter-${qIndex}`);
  if (counter) counter.textContent = `${val.length} karakter`;
  syncNavGrid();
}

// ─── NAVIGASI ────────────────────────────────────────────────────────────────
function nextQuestion() { if (state.current < state.questions.length - 1) renderQuestion(state.current + 1); }
function prevQuestion() { if (state.current > 0) renderQuestion(state.current - 1); }

function toggleFlag(i) {
  state.flagged.has(i) ? state.flagged.delete(i) : state.flagged.add(i);
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
  showScreen('screen-login');
}