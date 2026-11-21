import crypto from 'crypto';

// ============================================================================
// NEWTON STANDALONE EXAM HUB API (ZERO-SUPABASE ARCHITECTURE)
// Backed by Google Sheets (CSV export / gviz / Web App) + Server-Side Gemini API
// ============================================================================

const SHEET_CACHE_TTL_MS = Number(process.env.EXAM_HUB_CACHE_TTL_MS) || 60 * 1000; // 60s in-memory cache
const AI_CACHE_MAX_ENTRIES = 1000;

// Module-scoped caches (shared across requests in a warm Vercel serverless instance)
const sheetCache = new Map(); // key: sheetId -> { fetchedAt, data }
const aiResponseCache = new Map(); // key: deterministic cache key -> response payload

function setAiCache(key, value) {
  if (aiResponseCache.size >= AI_CACHE_MAX_ENTRIES) {
    const oldestKey = aiResponseCache.keys().next().value;
    if (oldestKey) aiResponseCache.delete(oldestKey);
  }
  aiResponseCache.set(key, value);
}

// ----------------------------------------------------------------------------
// 1. BUILT-IN FALLBACK SAMPLE DATA (Used when GOOGLE_SHEET_ID is not set or in demo mode)
// ----------------------------------------------------------------------------
const BUILTIN_SAMPLE_SETTINGS_CSV = `Exam_ID,Course_ID,Course_Name,Exam_Title,Instructor,Num_Questions,Max_Score,Is_Published,Release_Answers,Adjustment_Reason,Watermark_Enabled
Q2_PHYS101,PHYS.101,General Physics & Biophysics,Quiz 2 - Elasticity & Fluid Mechanics,Dr. Mohamed Ali,10,10,TRUE,TRUE,,TRUE
Q1_AHST302,AHST.302,Applied Health Physics,Quiz 1 - Biomechanics & Dimensions,Dr. Mohamed Ali,10,10,TRUE,TRUE,Question 4 awarded full credit across all models,TRUE`;

const BUILTIN_SAMPLE_QUESTIONS_CSV = `Exam_ID,Model,Q_Num,Correct_Key,Points,Question_Text
Q2_PHYS101,A,1,D,1,"Hooke's Law within the elastic limit states that restoring force or stress is directly proportional to strain:\nA) \\( F = m a \\)\nB) \\( P = F / A \\)\nC) \\( V = I R \\)\nD) \\( F = k \\Delta L \\)"
Q2_PHYS101,A,2,B,1,"Which dental tissue has the HIGHEST toughness (total area under the stress-strain curve before fracture)?\nA) Enamel\nB) Dentin\nC) Ceramic crown\nD) Glass ionomer"
Q2_PHYS101,A,3,A,1,"Statement: 'Enamel is tough compared to dentin.' Is this statement scientifically True or False?\nA) False — Enamel is the hardest tissue, but it is brittle with low toughness compared to dentin\nB) True — Enamel is both tougher and harder than dentin\nC) True — Because enamel has a higher Young's modulus\nD) False — Dentin has higher hardness than enamel"
Q2_PHYS101,A,4,C,1,"What is the dimensional formula of Surface Tension \\( \\gamma = F / L \\)?\nA) \\( [M L T^{-2}] \\)\nB) \\( [M L^{-1} T^{-2}] \\)\nC) \\( [M T^{-2}] \\)\nD) \\( [M L^{-1} T^{-1}] \\)"
Q2_PHYS101,A,5,B,1,"According to Poiseuille's Law \\( Q = \\frac{\\pi \\Delta P r^4}{8 \\eta L} \\), if the radius \\( r \\) of a blood vessel doubles while other factors remain constant, the volume flow rate \\( Q \\) increases by a factor of:\nA) 2\nB) 16\nC) 4\nD) 8"
Q2_PHYS101,A,6,A,1,"What is the dimensional formula of longitudinal strain \\( \\epsilon = \\Delta L / L_0 \\)?\nA) Dimensionless \\( [1] \\)\nB) \\( [L] \\)\nC) \\( [M L^{-1} T^{-2}] \\)\nD) \\( [L^2] \\)"
Q2_PHYS101,A,7,C,1,"Young's Modulus of Elasticity \\( E \\) is represented graphically on a stress-strain curve by:\nA) The total area under the entire curve up to fracture\nB) The maximum stress at the breaking point\nC) The slope of the initial linear elastic region\nD) The plastic deformation width"
Q2_PHYS101,A,8,D,1,"What is the SI unit and dimensional formula of dynamic viscosity \\( \\eta \\)?\nA) \\( \\text{N/m} \\), \\( [M T^{-2}] \\)\nB) \\( \\text{Pa} \\), \\( [M L^{-1} T^{-2}] \\)\nC) \\( \\text{J} \\), \\( [M L^2 T^{-2}] \\)\nD) \\( \\text{Pa}\\cdot\\text{s} \\), \\( [M L^{-1} T^{-1}] \\)"
Q2_PHYS101,A,9,B,1,"According to Stokes' Law \\( F_d = 6 \\pi \\eta r v \\), the viscous drag force on a small sphere moving at terminal velocity is proportional to:\nA) \\( r^2 v^2 \\)\nB) \\( r v \\)\nC) \\( r^4 \\)\nD) \\( 1 / r \\)"
Q2_PHYS101,A,10,A,1,"Using King's Interpolation formula for the Mode \\( \\text{Mode} = L + \\left(\\frac{f_2}{f_1 + f_2}\\right) \\times w \\), if \\( L = 20 \\), \\( f_1 = 10 \\), \\( f_2 = 10 \\), and class width \\( w = 10 \\), the Mode equals:\nA) 25\nB) 22\nC) 28\nD) 30"
Q2_PHYS101,B,1,B,1,"Which dental tissue has the HIGHEST toughness (total area under the stress-strain curve before fracture)?\nA) Enamel\nB) Dentin\nC) Ceramic crown\nD) Glass ionomer"
Q2_PHYS101,B,2,D,1,"Hooke's Law within the elastic limit states that restoring force or stress is directly proportional to strain:\nA) \\( F = m a \\)\nB) \\( P = F / A \\)\nC) \\( V = I R \\)\nD) \\( F = k \\Delta L \\)"
Q2_PHYS101,B,3,C,1,"What is the dimensional formula of Surface Tension \\( \\gamma = F / L \\)?\nA) \\( [M L T^{-2}] \\)\nB) \\( [M L^{-1} T^{-2}] \\)\nC) \\( [M T^{-2}] \\)\nD) \\( [M L^{-1} T^{-1}] \\)"
Q2_PHYS101,B,4,A,1,"Statement: 'Enamel is tough compared to dentin.' Is this statement scientifically True or False?\nA) False — Enamel is the hardest tissue, but it is brittle with low toughness compared to dentin\nB) True — Enamel is both tougher and harder than dentin\nC) True — Because enamel has a higher Young's modulus\nD) False — Dentin has higher hardness than enamel"
Q2_PHYS101,B,5,A,1,"What is the dimensional formula of longitudinal strain \\( \\epsilon = \\Delta L / L_0 \\)?\nA) Dimensionless \\( [1] \\)\nB) \\( [L] \\)\nC) \\( [M L^{-1} T^{-2}] \\)\nD) \\( [L^2] \\)"
Q2_PHYS101,B,6,B,1,"According to Poiseuille's Law \\( Q = \\frac{\\pi \\Delta P r^4}{8 \\eta L} \\), if the radius \\( r \\) of a blood vessel doubles while other factors remain constant, the volume flow rate \\( Q \\) increases by a factor of:\nA) 2\nB) 16\nC) 4\nD) 8"
Q2_PHYS101,B,7,D,1,"What is the SI unit and dimensional formula of dynamic viscosity \\( \\eta \\)?\nA) \\( \\text{N/m} \\), \\( [M T^{-2}] \\)\nB) \\( \\text{Pa} \\), \\( [M L^{-1} T^{-2}] \\)\nC) \\( \\text{J} \\), \\( [M L^2 T^{-2}] \\)\nD) \\( \\text{Pa}\\cdot\\text{s} \\), \\( [M L^{-1} T^{-1}] \\)"
Q2_PHYS101,B,8,C,1,"Young's Modulus of Elasticity \\( E \\) is represented graphically on a stress-strain curve by:\nA) The total area under the entire curve up to fracture\nB) The maximum stress at the breaking point\nC) The slope of the initial linear elastic region\nD) The plastic deformation width"
Q2_PHYS101,B,9,A,1,"Using King's Interpolation formula for the Mode \\( \\text{Mode} = L + \\left(\\frac{f_2}{f_1 + f_2}\\right) \\times w \\), if \\( L = 20 \\), \\( f_1 = 10 \\), \\( f_2 = 10 \\), and class width \\( w = 10 \\), the Mode equals:\nA) 25\nB) 22\nC) 28\nD) 30"
Q2_PHYS101,B,10,B,1,"According to Stokes' Law \\( F_d = 6 \\pi \\eta r v \\), the viscous drag force on a small sphere moving at terminal velocity is proportional to:\nA) \\( r^2 v^2 \\)\nB) \\( r v \\)\nC) \\( r^4 \\)\nD) \\( 1 / r \\)"`;

const BUILTIN_SAMPLE_RESPONSES_CSV = `Exam_ID,Student_ID,Student_Name,Section,Model,Earned_Points,Possible_Points,Q1,Q2,Q3,Q4,Q5,Q6,Q7,Q8,Q9,Q10
Q2_PHYS101,200046095,Shahd Mohamed Ali,A1,A,8,10,D,A,A,C,B,A,C,B,B,A
Q2_PHYS101,200012345,Ahmed Hassan Ibrahim,A2,B,9,10,B,D,C,B,A,B,D,C,A,B
Q2_PHYS101,200099999,Hana Mohamed Ali,B1,A,10,10,D,B,A,C,B,A,C,D,B,A
Q1_AHST302,200046095,Shahd Mohamed Ali,A1,A,9,10,B,C,D,A,C,A,A,C,C,A`;

// ----------------------------------------------------------------------------
// 2. UNIVERSAL CSV / TSV PARSER (Handles multi-line quoted LaTeX cells cleanly)
// ----------------------------------------------------------------------------
export function detectDelimiter(text) {
  const firstLine = (text || '').split(/\r?\n/)[0] || '';
  const candidates = [',', '\t', ';'];
  let best = ',';
  let maxCount = 0;
  for (const d of candidates) {
    const count = firstLine.split(d).length;
    if (count > maxCount) {
      maxCount = count;
      best = d;
    }
  }
  return best;
}

export function parseCSVTable(rawText) {
  if (!rawText || typeof rawText !== 'string') return { headers: [], rows: [] };
  const text = rawText.replace(/^\uFEFF/, '').trim();
  if (!text) return { headers: [], rows: [] };

  const delim = detectDelimiter(text);
  const allRows = [];
  let curRow = [];
  let curCell = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];

    if (ch === '"') {
      if (inQuotes && next === '"') {
        curCell += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === delim && !inQuotes) {
      curRow.push(curCell.trim());
      curCell = '';
    } else if ((ch === '\n' || (ch === '\r' && next === '\n')) && !inQuotes) {
      if (ch === '\r') i++;
      curRow.push(curCell.trim());
      if (curRow.some(cell => cell !== '')) {
        allRows.push(curRow);
      }
      curRow = [];
      curCell = '';
    } else {
      curCell += ch;
    }
  }
  curRow.push(curCell.trim());
  if (curRow.some(cell => cell !== '')) {
    allRows.push(curRow);
  }

  if (allRows.length === 0) return { headers: [], rows: [] };
  return {
    headers: allRows[0],
    rows: allRows.slice(1)
  };
}

// ----------------------------------------------------------------------------
// 3. GOOGLE SHEETS FETCHER & NORMALIZER
// ----------------------------------------------------------------------------
export function extractGoogleSheetId(input) {
  if (!input || typeof input !== 'string') return null;
  const trimmed = input.trim();
  const urlMatch = trimmed.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]{15,})/);
  if (urlMatch) return urlMatch[1];
  if (/^[a-zA-Z0-9-_]{20,60}$/.test(trimmed)) return trimmed;
  return null;
}

async function fetchSheetTabCSV(sheetId, tabName) {
  const url = `https://docs.google.com/spreadsheets/d/${encodeURIComponent(sheetId)}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(tabName)}`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Newton-Standalone-Exam-Hub/1.0' },
    signal: AbortSignal.timeout ? AbortSignal.timeout(8000) : undefined
  });
  if (!res.ok) {
    throw new Error(`Google Sheet tab "${tabName}" returned HTTP ${res.status}`);
  }
  const text = await res.text();
  if (text.trim().startsWith('<!DOCTYPE html') || text.includes('accounts.google.com/ServiceLogin')) {
    throw new Error(`Google Sheet "${sheetId}" requires view permission. Set Share -> "Anyone with the link can view".`);
  }
  return text;
}

function parseBoolFlag(val, defaultVal = true) {
  if (val === undefined || val === null || String(val).trim() === '') return defaultVal;
  const norm = String(val).trim().toLowerCase();
  if (['true', '1', 'yes', 'y', 'published', 'released', 'active'].includes(norm)) return true;
  if (['false', '0', 'no', 'n', 'hidden', 'draft', 'withheld'].includes(norm)) return false;
  return defaultVal;
}

export function buildExamHubStateFromCSVs({ settingsCsv, questionsCsv, responsesCsv, defaultExamId = 'Q2_PHYS101' }) {
  const exams = {}; // examId -> metadata & modelKeys & questionBank & studentMap
  const settingsTable = parseCSVTable(settingsCsv);
  const questionsTable = parseCSVTable(questionsCsv);
  const responsesTable = parseCSVTable(responsesCsv);

  // 1. Parse Settings Tab
  if (settingsTable.headers.length > 0) {
    const h = settingsTable.headers;
    const findCol = (regex) => h.findIndex(col => regex.test(col.trim()));
    const cExamId = findCol(/^(Exam[_\s]*ID|Quiz[_\s]*ID|ID)$/i);
    const cCourseId = findCol(/^(Course[_\s]*ID|Course[_\s]*Code|Course)$/i);
    const cCourseName = findCol(/^(Course[_\s]*Name|Subject)$/i);
    const cTitle = findCol(/^(Exam[_\s]*Title|Quiz[_\s]*Name|Title|Name)$/i);
    const cInstructor = findCol(/^(Instructor|Teacher|Professor|Coordinator)$/i);
    const cNumQ = findCol(/^(Num[_\s]*Questions|Total[_\s]*Questions|Questions)$/i);
    const cMaxScore = findCol(/^(Max[_\s]*Score|Possible[_\s]*Points|Out[_\s]*Of)$/i);
    const cPublished = findCol(/^(Is[_\s]*Published|Published|Visible)$/i);
    const cReleaseAns = findCol(/^(Release[_\s]*Answers|Is[_\s]*Review[_\s]*Released|Show[_\s]*Keys)$/i);
    const cAdjReason = findCol(/^(Adjustment[_\s]*Reason|Review[_\s]*Reason|Adjustment[_\s]*Note)$/i);
    const cWatermark = findCol(/^(Watermark[_\s]*Enabled|Watermark)$/i);

    for (const r of settingsTable.rows) {
      const examId = (cExamId !== -1 ? r[cExamId] : '') || defaultExamId;
      if (!examId) continue;
      exams[examId] = {
        exam_id: examId,
        course_id: (cCourseId !== -1 && r[cCourseId]) ? r[cCourseId] : 'PHYS.101',
        course_name: (cCourseName !== -1 && r[cCourseName]) ? r[cCourseName] : 'University Physics',
        exam_title: (cTitle !== -1 && r[cTitle]) ? r[cTitle] : examId,
        instructor: (cInstructor !== -1 && r[cInstructor]) ? r[cInstructor] : 'Course Instructor',
        num_questions: (cNumQ !== -1 && parseInt(r[cNumQ], 10) > 0) ? parseInt(r[cNumQ], 10) : 10,
        max_score: (cMaxScore !== -1 && parseFloat(r[cMaxScore]) > 0) ? parseFloat(r[cMaxScore]) : 10,
        is_published: cPublished !== -1 ? parseBoolFlag(r[cPublished], true) : true,
        release_answers: cReleaseAns !== -1 ? parseBoolFlag(r[cReleaseAns], true) : true,
        adjustment_reason: (cAdjReason !== -1 && r[cAdjReason]) ? r[cAdjReason] : '',
        watermark_enabled: cWatermark !== -1 ? parseBoolFlag(r[cWatermark], true) : true,
        model_keys: {},      // model -> { qNum: 'A' }
        question_bank: {},   // model -> { qNum: { text, points } }
        students: []         // array of normalized student response objects
      };
    }
  }

  const ensureExam = (examId) => {
    const id = examId || defaultExamId;
    if (!exams[id]) {
      exams[id] = {
        exam_id: id,
        course_id: 'PHYS.101',
        course_name: 'University Course',
        exam_title: id,
        instructor: 'Course Instructor',
        num_questions: 10,
        max_score: 10,
        is_published: true,
        release_answers: true,
        adjustment_reason: '',
        watermark_enabled: true,
        model_keys: {},
        question_bank: {},
        students: []
      };
    }
    return exams[id];
  };

  // 2. Parse Models_Questions Tab (Question Bank + Official Answer Keys)
  if (questionsTable.headers.length > 0) {
    const h = questionsTable.headers;
    const findCol = (regex) => h.findIndex(col => regex.test(col.trim()));
    const cExamId = findCol(/^(Exam[_\s]*ID|Quiz[_\s]*ID)$/i);
    const cModel = findCol(/^(Model|Key[_\s]*Letter|Key[_\s]*Version|Form)$/i);
    const cQNum = findCol(/^(Q[_\s]*Num|Question[_\s]*Number|Question|Q|Item)$/i);
    const cKey = findCol(/^(Correct[_\s]*Key|Correct[_\s]*Answer|Answer|Key|Response\/Mapping)$/i);
    const cPts = findCol(/^(Points|Pts|Weight|Score)$/i);
    const cText = findCol(/^(Question[_\s]*Text|Question[_\s]*Statement|Statement|Text|Stem)$/i);
    const cOptA = findCol(/^(Option[_\s]*A|Choice[_\s]*A|A)$/i);
    const cOptB = findCol(/^(Option[_\s]*B|Choice[_\s]*B|B)$/i);
    const cOptC = findCol(/^(Option[_\s]*C|Choice[_\s]*C|C)$/i);
    const cOptD = findCol(/^(Option[_\s]*D|Choice[_\s]*D|D)$/i);
    const cOptE = findCol(/^(Option[_\s]*E|Choice[_\s]*E|E)$/i);

    for (const r of questionsTable.rows) {
      const examId = (cExamId !== -1 && r[cExamId]) ? r[cExamId] : Object.keys(exams)[0] || defaultExamId;
      const ex = ensureExam(examId);
      const model = ((cModel !== -1 && r[cModel]) ? r[cModel] : 'A').trim().toUpperCase();
      const qNum = cQNum !== -1 ? parseInt(String(r[cQNum]).replace(/\D+/g, ''), 10) : NaN;
      if (!Number.isInteger(qNum) || qNum < 1 || qNum > 250) continue;

      const keyLetter = (cKey !== -1 && r[cKey]) ? r[cKey].trim().toUpperCase() : '';
      const pts = (cPts !== -1 && parseFloat(r[cPts]) > 0) ? parseFloat(r[cPts]) : 1;
      let qText = (cText !== -1 && r[cText]) ? r[cText].trim() : '';

      // Append separate Option A..E columns if present and not already inside Question_Text
      const extraOpts = [];
      if (cOptA !== -1 && r[cOptA]) extraOpts.push(`A) ${r[cOptA]}`);
      if (cOptB !== -1 && r[cOptB]) extraOpts.push(`B) ${r[cOptB]}`);
      if (cOptC !== -1 && r[cOptC]) extraOpts.push(`C) ${r[cOptC]}`);
      if (cOptD !== -1 && r[cOptD]) extraOpts.push(`D) ${r[cOptD]}`);
      if (cOptE !== -1 && r[cOptE]) extraOpts.push(`E) ${r[cOptE]}`);
      if (extraOpts.length > 0) {
        qText = qText ? `${qText}\n${extraOpts.join('\n')}` : extraOpts.join('\n');
      }
      // Unescape literal \n sequences pasted into single-line spreadsheet cells
      qText = qText.replace(/\\n/g, '\n');

      if (!ex.model_keys[model]) ex.model_keys[model] = {};
      if (keyLetter) ex.model_keys[model][qNum] = keyLetter;

      if (!ex.question_bank[model]) ex.question_bank[model] = {};
      ex.question_bank[model][qNum] = {
        q_num: qNum,
        correct_key: keyLetter,
        points: pts,
        question_text: qText
      };
    }
  }

  // 3. Parse Student_Responses Tab (Universal ZipGrade & Simple Sheet Support)
  if (responsesTable.headers.length > 0) {
    const headers = responsesTable.headers;
    const rows = responsesTable.rows;

    const cExamId = headers.findIndex(h => /^(Exam[_\s]*ID|Quiz[_\s]*ID)$/i.test(h.trim()));
    const cQuizName = headers.findIndex(h => /^(Quiz[_\s]*Name|Exam[_\s]*Name|Title|Quiz)$/i.test(h.trim()));
    let cId = headers.findIndex(h => /^(Student[_\s]*ID|ZipGrade[_\s]*ID|External[_\s]*ID|Roll[_\s]*No|Seat[_\s]*No|ID|Code|الرقم\s*الجامعي|كود\s*الطالب)$/i.test(h.trim()));
    if (cId === -1) {
      cId = headers.findIndex(h => /id|code|number|رقم/i.test(h) && !/quiz|exam|question|point|custom/i.test(h));
    }
    let cFirst = headers.findIndex(h => /^(Student[_\s]*Name|Full[_\s]*Name|First[_\s]*Name|Name|الاسم|اسم\s*الطالب)$/i.test(h.trim()));
    const cLast = headers.findIndex(h => /^(Last[_\s]*Name|Surname|Family[_\s]*Name)$/i.test(h.trim()));
    const cSection = headers.findIndex(h => /^(Section|Sec|Group|Class|السكشن)$/i.test(h.trim()));
    const cModel = headers.findIndex(h => /^(Model|Key[_\s]*Version|Key[_\s]*Letter|CustomKey|Version|Form)$/i.test(h.trim()));
    const cEarned = headers.findIndex(h => /^(Earned[_\s]*Points|Num[_\s]*PointsEarned|Score|Total[_\s]*Score|Grade|Points|الدرجة)$/i.test(h.trim()));
    const cPossible = headers.findIndex(h => /^(Possible[_\s]*Points|Max[_\s]*Points|Out[_\s]*Of|Total[_\s]*Possible)$/i.test(h.trim()));

    const usedCols = new Set([cExamId, cQuizName, cId, cFirst, cLast, cSection, cModel, cEarned, cPossible]);
    const questionCols = [];

    headers.forEach((h, idx) => {
      if (usedCols.has(idx)) return;
      const m = h.trim().match(/^(?:Stu|Student\s*Ans|Q|Question|Item|Resp|Answer|س)\s*[._#-]*\s*(\d+)$/i) || h.trim().match(/^(\d+)$/);
      if (m) {
        const qNum = parseInt(m[1], 10);
        if (qNum > 0 && qNum <= 250) {
          questionCols.push({
            qNum,
            stuCol: idx,
            keyCol: headers.findIndex(col => new RegExp(`^(PriKey|Key|Correct|ModelAns|AnsKey)[._\\s#-]*${qNum}$`, 'i').test(col.trim())),
            markCol: headers.findIndex(col => new RegExp(`^(Mark|Status|Result)[._\\s#-]*${qNum}$`, 'i').test(col.trim())),
            ptsCol: headers.findIndex(col => new RegExp(`^(Points|Pts|Score)[._\\s#-]*${qNum}$`, 'i').test(col.trim()))
          });
          usedCols.add(idx);
        }
      }
    });
    questionCols.sort((a, b) => a.qNum - b.qNum);

    const combinedAnsCol = questionCols.length === 0
      ? headers.findIndex((h, idx) => !usedCols.has(idx) && /^(Answers|Answers[_\s]*String|Responses|Student[_\s]*Responses)$/i.test(h.trim()))
      : -1;

    // First pass: check for embedded ANSWER KEY rows in the responses table
    rows.forEach(r => {
      const rawId = cId !== -1 ? (r[cId] || '').trim() : '';
      const rawName = cFirst !== -1 ? (r[cFirst] || '').trim() : '';
      if (/^(KEY|ANSWER|ANSWERS|MODEL|MASTER|0000)$/i.test(rawId) || /^(ANSWER\s*KEY|MODEL\s*[A-Z])$/i.test(rawName)) {
        const rowExamId = (cExamId !== -1 && r[cExamId]) ? r[cExamId].trim() : (Object.keys(exams)[0] || defaultExamId);
        const ex = ensureExam(rowExamId);
        const mKey = (cModel !== -1 && r[cModel]) ? r[cModel].trim().toUpperCase() : 'A';
        if (!ex.model_keys[mKey]) ex.model_keys[mKey] = {};
        questionCols.forEach(qObj => {
          const ans = (r[qObj.stuCol] || '').trim().toUpperCase();
          if (ans) ex.model_keys[mKey][qObj.qNum] = ans;
        });
      }
    });

    // Second pass: parse student records
    rows.forEach(r => {
      let sid = cId !== -1 ? (r[cId] || '').trim() : '';
      let rawFirst = cFirst !== -1 ? (r[cFirst] || '').trim() : '';
      const rawLast = cLast !== -1 ? (r[cLast] || '').trim() : '';

      if (!sid && /^(\d{4,14})\s*[-_:]/.test(rawFirst)) {
        sid = rawFirst.match(/^(\d{4,14})/)[1];
      }
      if (!sid || /^(KEY|ANSWER|ANSWERS|MODEL|MASTER|0000)$/i.test(sid)) return;
      if (/^(ANSWER\s*KEY|MODEL\s*[A-Z])$/i.test(rawFirst)) return;

      let cleanName = rawFirst;
      if (cleanName.includes('-')) {
        const parts = cleanName.split('-');
        if (/^\d+$/.test(parts[0].trim())) {
          cleanName = parts.slice(1).join('-').trim();
        }
      }
      if (rawLast && !/AHST|PHYS|COURSE|CLASS/i.test(rawLast)) {
        cleanName = `${cleanName} ${rawLast}`.trim();
      }
      if (!cleanName) cleanName = `Student ${sid}`;

      const rowExamId = (cExamId !== -1 && r[cExamId])
        ? r[cExamId].trim()
        : ((cQuizName !== -1 && r[cQuizName] && exams[r[cQuizName].trim()]) ? r[cQuizName].trim() : (Object.keys(exams)[0] || defaultExamId));
      const ex = ensureExam(rowExamId);

      const model = ((cModel !== -1 && r[cModel]) ? r[cModel] : 'A').trim().toUpperCase() || 'A';
      const section = (cSection !== -1 && r[cSection]) ? r[cSection].trim().toUpperCase() : '—';
      const mKeys = ex.model_keys[model] || ex.model_keys.A || {};
      const mBank = ex.question_bank[model] || ex.question_bank.A || {};

      const qItems = [];
      let computedEarned = 0;

      if (combinedAnsCol !== -1) {
        const str = (r[combinedAnsCol] || '').trim().toUpperCase();
        const parts = str.includes(',') ? str.split(',').map(s => s.trim()) : str.split('');
        const totalQ = Math.max(parts.length, ex.num_questions || 10);
        for (let i = 0; i < totalQ; i++) {
          const qNum = i + 1;
          const stuAns = (parts[i] || '').toUpperCase();
          const correctAns = (mKeys[qNum] || mBank[qNum]?.correct_key || '').toUpperCase();
          const hasKey = Boolean(correctAns);
          const isCorrect = hasKey ? (stuAns !== '' && stuAns === correctAns) : false;
          const pts = mBank[qNum]?.points || 1;
          if (isCorrect) computedEarned += pts;
          qItems.push({
            q_num: qNum,
            student_ans: stuAns,
            correct_ans: correctAns,
            has_key: hasKey,
            is_correct: isCorrect,
            points: pts,
            question_text: mBank[qNum]?.question_text || ''
          });
        }
      } else {
        questionCols.forEach(qObj => {
          const qNum = qObj.qNum;
          const stuAns = (r[qObj.stuCol] || '').trim().toUpperCase();
          const rowKey = (qObj.keyCol !== -1 && r[qObj.keyCol]) ? r[qObj.keyCol].trim().toUpperCase() : '';
          const correctAns = rowKey || (mKeys[qNum] || mBank[qNum]?.correct_key || '').toUpperCase();
          if (rowKey) {
            if (!ex.model_keys[model]) ex.model_keys[model] = {};
            if (!ex.model_keys[model][qNum]) ex.model_keys[model][qNum] = rowKey;
          }

          const markVal = (qObj.markCol !== -1 && r[qObj.markCol]) ? r[qObj.markCol].trim().toUpperCase() : '';
          const ptsVal = (qObj.ptsCol !== -1 && r[qObj.ptsCol] !== undefined && r[qObj.ptsCol] !== '') ? parseFloat(r[qObj.ptsCol]) : NaN;
          const hasKey = Boolean(correctAns || markVal || !isNaN(ptsVal));

          let isCorrect = false;
          if (!isNaN(ptsVal)) {
            isCorrect = ptsVal > 0;
          } else if (markVal) {
            isCorrect = ['C', '1', 'TRUE', 'CORRECT', '✔'].includes(markVal);
          } else if (correctAns) {
            isCorrect = stuAns !== '' && stuAns === correctAns;
          }

          const qPts = mBank[qNum]?.points || 1;
          if (isCorrect) computedEarned += (!isNaN(ptsVal) ? ptsVal : qPts);

          qItems.push({
            q_num: qNum,
            student_ans: stuAns,
            correct_ans: correctAns,
            has_key: hasKey,
            is_correct: isCorrect,
            points: qPts,
            question_text: mBank[qNum]?.question_text || ''
          });
        });
      }

      if (qItems.length > ex.num_questions) {
        ex.num_questions = qItems.length;
      }

      const explicitEarned = (cEarned !== -1 && r[cEarned] !== '' && !isNaN(parseFloat(r[cEarned])))
        ? parseFloat(r[cEarned])
        : computedEarned;
      const explicitPossible = (cPossible !== -1 && r[cPossible] !== '' && !isNaN(parseFloat(r[cPossible])))
        ? parseFloat(r[cPossible])
        : (ex.max_score || qItems.length || 10);

      ex.students.push({
        student_id: sid,
        name: cleanName,
        section,
        model,
        earned_points: explicitEarned,
        possible_points: explicitPossible,
        questions: qItems
      });
    });
  }

  return { exams };
}

const DEFAULT_GOOGLE_SHEET_ID = '13dlchvvBJeut4e7o1edXVy7rjrTiMoX93yCUzbE4RCQ';

async function loadExamHubData(customSheetId = null) {
  const rawSheetRef = customSheetId || process.env.GOOGLE_SHEET_ID || process.env.GOOGLE_SHEET_URL || DEFAULT_GOOGLE_SHEET_ID;
  const sheetId = extractGoogleSheetId(rawSheetRef);

  if (!sheetId) {
    return {
      source: 'builtin_sample',
      sheet_id: null,
      ...buildExamHubStateFromCSVs({
        settingsCsv: BUILTIN_SAMPLE_SETTINGS_CSV,
        questionsCsv: BUILTIN_SAMPLE_QUESTIONS_CSV,
        responsesCsv: BUILTIN_SAMPLE_RESPONSES_CSV
      })
    };
  }

  const cached = sheetCache.get(sheetId);
  if (cached && (Date.now() - cached.fetchedAt) < SHEET_CACHE_TTL_MS) {
    return cached.data;
  }

  const settingsTab = process.env.GOOGLE_SHEET_SETTINGS_TAB || 'Settings';
  const questionsTab = process.env.GOOGLE_SHEET_QUESTIONS_TAB || 'Models_Questions';
  const responsesTab = process.env.GOOGLE_SHEET_RESPONSES_TAB || 'Student_Responses';

  try {
    const [settingsCsv, questionsCsv, responsesCsv] = await Promise.all([
      fetchSheetTabCSV(sheetId, settingsTab).catch(() => ''),
      fetchSheetTabCSV(sheetId, questionsTab).catch(() => ''),
      fetchSheetTabCSV(sheetId, responsesTab)
    ]);

    const state = {
      source: 'google_sheet',
      sheet_id: sheetId,
      ...buildExamHubStateFromCSVs({
        settingsCsv,
        questionsCsv,
        responsesCsv
      })
    };

    sheetCache.set(sheetId, { fetchedAt: Date.now(), data: state });
    return state;
  } catch (err) {
    // Graceful fallback to built-in sample if sheet isn't shared yet or offline during local tests
    if (!customSheetId && !process.env.GOOGLE_SHEET_ID && !process.env.GOOGLE_SHEET_URL) {
      return {
        source: 'builtin_sample',
        sheet_id: sheetId,
        sheet_notice: err.message,
        ...buildExamHubStateFromCSVs({
          settingsCsv: BUILTIN_SAMPLE_SETTINGS_CSV,
          questionsCsv: BUILTIN_SAMPLE_QUESTIONS_CSV,
          responsesCsv: BUILTIN_SAMPLE_RESPONSES_CSV
        })
      };
    }
    throw err;
  }
}

// ----------------------------------------------------------------------------
// 4. STUDENT ID RESOLUTION (Exact 9-Digit + Unambiguous 5-Digit Legacy Suffix)
// ----------------------------------------------------------------------------
function isLegitimateIdMatch(inputId, recordId) {
  const cleanIn = String(inputId || '').trim();
  const cleanDb = String(recordId || '').trim();
  if (!cleanIn || !cleanDb) return false;
  if (cleanIn.toLowerCase() === cleanDb.toLowerCase()) return true;
  if (/^\d{5}$/.test(cleanIn) && /^\d{9}$/.test(cleanDb) && cleanDb.endsWith(cleanIn)) return true;
  if (/^2000\d{5}$/.test(cleanIn) && /^\d{5}$/.test(cleanDb) && cleanIn.slice(4) === cleanDb) return true;
  return false;
}

export function findStudentInExam(exam, rawStudentId) {
  const cleanIn = String(rawStudentId || '').trim();
  if (!cleanIn || cleanIn.length > 32 || /[%_*?\\'"`;\s\x00-\x1f]/.test(cleanIn)) {
    return { ok: false, status: 400, error: 'Please enter a valid Student ID.' };
  }

  const students = exam?.students || [];
  // 1. Exact match first
  const exactMatches = students.filter(s => String(s.student_id).trim().toLowerCase() === cleanIn.toLowerCase());
  if (exactMatches.length === 1) {
    return { ok: true, student: exactMatches[0] };
  }
  if (exactMatches.length > 1) {
    return { ok: false, status: 409, error: 'Multiple records match this Student ID. Please contact your instructor.' };
  }

  // 2. Legacy 5-digit suffix match (2000xxxxx <-> xxxxx)
  const legacyMatches = students.filter(s => isLegitimateIdMatch(cleanIn, s.student_id));
  if (legacyMatches.length === 1) {
    return { ok: true, student: legacyMatches[0] };
  }
  if (legacyMatches.length > 1) {
    return { ok: false, status: 409, error: 'Ambiguous 5-digit ID suffix. Please enter your full 9-digit Student ID.' };
  }

  return { ok: false, status: 404, error: 'Student ID not found in this exam.' };
}

export function sanitizeStudentSheetForClient(exam, student) {
  const releaseAnswers = exam.release_answers !== false;
  const mBank = exam.question_bank?.[student.model] || exam.question_bank?.A || {};
  const mKeys = exam.model_keys?.[student.model] || exam.model_keys?.A || {};

  const sanitizedQuestions = (student.questions || []).map((q, idx) => {
    const qNum = q.q_num || (idx + 1);
    const fullText = q.question_text || mBank[qNum]?.question_text || '';
    const key = q.correct_ans || mKeys[qNum] || mBank[qNum]?.correct_key || '';

    if (!releaseAnswers) {
      // Withhold official keys, correctness flags, and question bank statements when answers are not released
      return {
        q_num: qNum,
        student_ans: q.student_ans || '',
        correct_ans: '',
        has_key: false,
        is_correct: null,
        question_text: ''
      };
    }

    return {
      q_num: qNum,
      student_ans: q.student_ans || '',
      correct_ans: key,
      has_key: Boolean(key || q.has_key),
      is_correct: q.is_correct,
      review_reason: exam.adjustment_reason || '',
      question_text: fullText
    };
  });

  return {
    exam_id: exam.exam_id,
    course_id: exam.course_id,
    course_name: exam.course_name,
    exam_title: exam.exam_title,
    instructor: exam.instructor,
    is_published: exam.is_published !== false,
    release_answers: releaseAnswers,
    adjustment_reason: exam.adjustment_reason || '',
    watermark_enabled: exam.watermark_enabled !== false,
    student: {
      student_id: student.student_id,
      name: student.name,
      section: student.section,
      model: student.model,
      earned_points: student.earned_points,
      possible_points: student.possible_points,
      score_pct: student.possible_points > 0
        ? Math.round((student.earned_points / student.possible_points) * 100)
        : 0,
      questions: sanitizedQuestions
    }
  };
}

// ----------------------------------------------------------------------------
// 5. ENCRYPTED PRACTICE MCQ CHALLENGE TOKEN (Prevents Answer Leakage in Network Tab)
// ----------------------------------------------------------------------------
function getChallengeSecretKey() {
  const raw = process.env.EXAM_HUB_SECRET || process.env.GEMINI_API_KEY || 'newton_standalone_exam_hub_default_key';
  return crypto.createHash('sha256').update(`newton_exam_hub_v1:${raw}`).digest();
}

export function createMcqChallengeToken({ examId, studentId, qNum, difficulty, correctOption, explanation }) {
  const key = getChallengeSecretKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const payload = JSON.stringify({
    eid: String(examId || ''),
    sid: String(studentId || ''),
    q: Number(qNum),
    diff: String(difficulty || 'medium'),
    ans: String(correctOption || 'A').trim().toUpperCase(),
    exp: String(explanation || '').slice(0, 1200),
    iat: Date.now()
  });
  const encrypted = Buffer.concat([cipher.update(payload, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `eh1.${iv.toString('base64url')}.${encrypted.toString('base64url')}.${tag.toString('base64url')}`;
}

export function verifyMcqChallengeToken(token, chosenOption) {
  if (!token || typeof token !== 'string' || !token.startsWith('eh1.')) {
    return { ok: false, error: 'Invalid challenge token.' };
  }
  const parts = token.split('.');
  if (parts.length !== 4) return { ok: false, error: 'Malformed challenge token.' };

  try {
    const key = getChallengeSecretKey();
    const iv = Buffer.from(parts[1], 'base64url');
    const encrypted = Buffer.from(parts[2], 'base64url');
    const tag = Buffer.from(parts[3], 'base64url');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    const decoded = JSON.parse(Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8'));
    const cleanChoice = String(chosenOption || '').trim().toUpperCase();
    const isCorrect = cleanChoice !== '' && cleanChoice === decoded.ans;
    return {
      ok: true,
      is_correct: isCorrect,
      correct_option: decoded.ans,
      explanation: decoded.exp || ''
    };
  } catch (e) {
    return { ok: false, error: 'Failed to verify challenge token.' };
  }
}

// ----------------------------------------------------------------------------
// 6. GEMINI AI TUTOR ENGINE (Bilingual Explain, Practice MCQ, 3D Flashcards, Anki)
// ----------------------------------------------------------------------------
function getDomainKnowledgeBase(isEn) {
  return isEn
    ? `AUTHORITATIVE DOMAIN KNOWLEDGE BASE (CONSULT BEFORE ANSWERING):
1. Mechanical Properties & Biomechanics (Dental & Tissue Physics):
   - Toughness: Total energy absorbed per unit volume before fracture = TOTAL AREA UNDER THE STRESS-STRAIN CURVE (J/m³ or Pa). Dentin has HIGH toughness; Enamel is brittle with LOW toughness. "Enamel is tough compared to dentin" is FALSE.
   - Hardness: Resistance to surface indentation or scratching. Enamel has the HIGHEST hardness in the human body, much harder than dentin. Never confuse Hardness with Toughness.
   - Stiffness / Young's Modulus (E = Stress/Strain): Slope of the linear elastic region. Enamel (~80 GPa) is stiffer than dentin (~18-20 GPa).
   - Modulus of Resilience: Area under the linear elastic region only.
2. Dimensional Analysis & Quantities:
   - Force: [M L T^-2] (N) | Work/Energy: [M L^2 T^-2] (J) | Power: [M L^2 T^-3] (W)
   - Stress / Pressure / Young's Modulus: [M L^-1 T^-2] (Pa)
   - Surface Tension (F/L): [M T^-2] (N/m)
   - Viscosity (eta): [M L^-1 T^-1] (Pa·s)
   - Strain / Angle / Relative density: Dimensionless [1]
3. Fluids & Biostatistics:
   - Poiseuille's Law: Q = (pi * Delta P * r^4) / (8 * eta * L) (proportional to r^4).
   - Stokes' Law: F_d = 6 * pi * eta * r * v.
   - King's Mode Interpolation: Mode = L + (f_2 / (f_1 + f_2)) * w.`
    : `قاعدة المعرفة العلمية المعتمدة (راجعها قبل الإجابة):
1. الخواص الميكانيكية وفيزياء الأنسجة والأسنان:
   - المتانة (Toughness): الطاقة الكلية الممتصة لكل وحدة حجوم حتى الكسر = المساحة الكلية تحت منحنى الإجهاد والانفعال. العاج (Dentin) يتميز بمتانة عالية، بينما المينا (Enamel) مادة هشة (Brittle) ذات متانة منخفضة. عبارة "Enamel is tough compared to dentin" خاطئة علمياً (FALSE).
   - الصلادة (Hardness): مقاومة الخدش أو الاختراق السطحي. المينا (Enamel) أصلد نسيج في جسم الإنسان وأعلى صلادة من العاج. لا تخلط بين الصلادة (Hardness) والمتانة (Toughness).
   - الجساءة / معامل يونغ (Young's Modulus): ميل الجزء الخطي المرن من منحنى الإجهاد والانفعال.
2. معادلات الأبعاد:
   - القوة: [M L T^-2] | الشغل والطاقة: [M L^2 T^-2] | الضغط والإجهاد ومعامل يونغ: [M L^-1 T^-2]
   - التوتر السطحي (Surface Tension): [M T^-2] (N/m)
   - معامل اللزوجة (Viscosity): [M L^-1 T^-1] (Pa·s)
   - الانفعال (Strain): عديم الأبعاد [1]
3. الموائع والإحصاء الحيوي:
   - قانون بوازوي (Poiseuille's Law): معدل التدفق يتناسب طردياً مع القوة الرابعة لنصف القطر r^4.
   - قانون ستوكس (Stokes' Law): F = 6 * pi * eta * r * v.
   - طريقة كينغ لحساب المنوال (Mode): Mode = L + [f_2 / (f_1 + f_2)] * w.`;
}

async function callGeminiAPI({ prompt, apiKey, expectJson = false, temperature = 0.25 }) {
  const candidateModels = [
    'gemini-3.5-flash-lite',
    'gemini-3.5-flash',
    'gemini-3.8-flash',
    'gemini-2.5-flash',
    'gemini-2.0-flash'
  ];

  let lastError = null;
  for (const modelName of candidateModels) {
    try {
      const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;
      const generationConfig = {
        temperature,
        maxOutputTokens: 2200
      };
      if (expectJson) {
        generationConfig.responseMimeType = 'application/json';
      }

      const res = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig
        }),
        signal: AbortSignal.timeout ? AbortSignal.timeout(9000) : undefined
      });

      if (res.ok) {
        const json = await res.json();
        const rawText = json.candidates?.[0]?.content?.parts?.[0]?.text || '';
        if (rawText) {
          if (expectJson) {
            const cleaned = rawText.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();
            return { ok: true, data: JSON.parse(cleaned), model: modelName };
          }
          return { ok: true, text: rawText, model: modelName };
        }
      } else {
        const errBody = await res.text();
        lastError = `${modelName} HTTP ${res.status}: ${errBody.slice(0, 200)}`;
      }
    } catch (err) {
      lastError = `${modelName} error: ${err.message}`;
    }
  }
  return { ok: false, error: lastError || 'All Gemini models failed.' };
}

// ----------------------------------------------------------------------------
// 7. MAIN VERCEL SERVERLESS HANDLER
// ----------------------------------------------------------------------------
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    const body = req.method === 'GET' ? (req.query || {}) : (req.body || {});
    const action = String(body.action || 'list-exams').trim();
    const customSheetId = body.sheet_id || null;

    // ACTION 1: Verify Practice MCQ answer token (no sheet lookup needed)
    if (action === 'verify-mcq') {
      const { challenge_token, chosen_option } = body;
      const result = verifyMcqChallengeToken(challenge_token, chosen_option);
      if (!result.ok) {
        return res.status(400).json({ success: false, error: result.error });
      }
      return res.status(200).json({
        success: true,
        is_correct: result.is_correct,
        correct_option: result.correct_option,
        explanation: result.explanation
      });
    }

    // Load cached Google Sheet state (or built-in sample if no GOOGLE_SHEET_ID set)
    const hubState = await loadExamHubData(customSheetId);
    const allExams = hubState.exams || {};

    // ACTION 2: List Published Exams for the Dropdown
    if (action === 'list-exams') {
      const examList = Object.values(allExams)
        .filter(e => e.is_published !== false)
        .map(e => ({
          exam_id: e.exam_id,
          course_id: e.course_id,
          course_name: e.course_name,
          exam_title: e.exam_title,
          instructor: e.instructor,
          num_questions: e.num_questions,
          max_score: e.max_score,
          release_answers: e.release_answers !== false
        }));

      return res.status(200).json({
        success: true,
        source: hubState.source,
        exams: examList
      });
    }

    // Resolve target exam
    const requestedExamId = String(body.exam_id || '').trim();
    const exam = (requestedExamId && allExams[requestedExamId])
      ? allExams[requestedExamId]
      : Object.values(allExams).find(e => e.is_published !== false) || Object.values(allExams)[0];

    if (!exam) {
      return res.status(404).json({ error: 'No exams configured in the Google Sheet.' });
    }
    if (exam.is_published === false) {
      return res.status(403).json({ error: 'This exam is currently hidden by your instructor.' });
    }

    // ACTION 3: Lookup Single Student Bubble Sheet by Student ID Only
    if (action === 'get-student-sheet') {
      const lookup = findStudentInExam(exam, body.student_id);
      if (!lookup.ok) {
        return res.status(lookup.status || 404).json({ error: lookup.error });
      }
      const payload = sanitizeStudentSheetForClient(exam, lookup.student);
      return res.status(200).json({
        success: true,
        source: hubState.source,
        ...payload
      });
    }

    // ACTION 4: Gemini AI Explain / Practice MCQ / 3D Flashcard / Anki Card Generation
    if (['explain', 'train_mcq', 'train_flashcard', 'generate_anki_cards'].includes(action)) {
      if (exam.release_answers === false) {
        return res.status(403).json({
          error: 'Answer key and AI explanations have not been released for this exam yet.'
        });
      }

      const lookup = findStudentInExam(exam, body.student_id);
      if (!lookup.ok) {
        return res.status(lookup.status || 401).json({ error: lookup.error });
      }

      const student = lookup.student;
      const qNum = parseInt(body.q_num, 10);
      if (!Number.isInteger(qNum) || qNum < 1 || qNum > 250) {
        return res.status(400).json({ error: 'Valid question number (q_num) is required.' });
      }

      const qItem = (student.questions || []).find(q => Number(q.q_num) === qNum);
      if (!qItem) {
        return res.status(404).json({ error: `Question ${qNum} not found on your bubble sheet.` });
      }

      const mBank = exam.question_bank?.[student.model] || exam.question_bank?.A || {};
      const mKeys = exam.model_keys?.[student.model] || exam.model_keys?.A || {};

      const stuAns = String(qItem.student_ans || '').trim().toUpperCase();
      const correctAns = String(qItem.correct_ans || mKeys[qNum] || mBank[qNum]?.correct_key || '').trim().toUpperCase();
      const isCorrect = Boolean(qItem.is_correct);
      const qText = String(qItem.question_text || mBank[qNum]?.question_text || body.question_text || `Question ${qNum}`).trim();
      const adjReason = String(exam.adjustment_reason || '').trim();
      const lang = String(body.lang || 'en').trim().toLowerCase() === 'ar' ? 'ar' : 'en';
      const isEn = lang === 'en';
      const difficulty = ['easy', 'medium', 'hard'].includes(String(body.difficulty || '').toLowerCase())
        ? String(body.difficulty).toLowerCase()
        : 'medium';

      const apiKey = (process.env.GEMINI_API_KEY || body.gemini_api_key || '').trim();
      if (!apiKey) {
        return res.status(500).json({
          error: 'GEMINI_API_KEY is not configured on the server (or provide a Gemini API key in Settings).'
        });
      }

      const domainKB = getDomainKnowledgeBase(isEn);

      // 4A. Standard Step-by-Step Explanation
      if (action === 'explain') {
        const cacheKey = `EXPL_${exam.exam_id}_M${student.model}_Q${qNum}_S${stuAns}_K${correctAns}_C${isCorrect ? 1 : 0}_${lang}`;
        if (aiResponseCache.has(cacheKey)) {
          return res.status(200).json({
            success: true,
            cached: true,
            explanation: aiResponseCache.get(cacheKey)
          });
        }

        const explanationLabel = isEn ? 'EXPLANATION' : 'الشرح';
        const prompt = `A university student answered Question ${qNum} on "${exam.exam_title}".
Student's Chosen Answer: "${stuAns || 'Blank'}"
Official Correct Answer (Key): "${correctAns}"
Status: ${isCorrect ? 'CORRECT (Credit awarded)' : 'INCORRECT'}
${adjReason ? `INSTRUCTOR ADJUSTMENT NOTE: "${adjReason}".\n` : ''}
QUESTION & CHOICES:
----------
${qText}
----------
${domainKB}

INSTRUCTIONS:
${isEn
  ? `- Write 100% in clear academic English (under 150 words).
- Start with "${explanationLabel}:" and explain step-by-step why choice (${correctAns}) is correct and why (${stuAns || 'Blank'}) is ${isCorrect ? 'right' : 'incorrect'}.`
  : `- اكتب الشرح كاملاً باللغة العربية الفصحى الواضحة (أقل من 150 كلمة) مع وضع المصطلحات العلمية الإنجليزية بين قوسين مثل: المتانة (Toughness).
- ابدأ بـ "${explanationLabel}:" واشرح بالخطوات لماذا الخيار (${correctAns}) هو الصحيح ولماذا (${stuAns || 'عدم الإجابة'}) ${isCorrect ? 'صحيح' : 'خاطئ'}.`}
- Use standalone $$...$$ on separate lines for equations. NEVER put Arabic characters inside $...$ or $$...$$ math blocks.`;

        const gemRes = await callGeminiAPI({ prompt, apiKey, expectJson: false, temperature: 0.2 });
        if (!gemRes.ok) {
          return res.status(502).json({ error: 'Failed to generate AI explanation.', details: gemRes.error });
        }

        setAiCache(cacheKey, gemRes.text);
        return res.status(200).json({
          success: true,
          cached: false,
          explanation: gemRes.text
        });
      }

      // 4B. Adaptive Mistake Trainer (Practice MCQ / 3D Flashcard / Anki Bundle)
      const prevList = Array.isArray(body.previous_questions) ? body.previous_questions.slice(-3) : [];
      const cacheKey = `ANKI_${exam.exam_id}_M${student.model}_Q${qNum}_S${stuAns}_K${correctAns}_${difficulty}_${lang}`;
      let bundle = (prevList.length === 0 && aiResponseCache.has(cacheKey))
        ? aiResponseCache.get(cacheKey)
        : null;

      if (!bundle) {
        const avoidBlock = prevList.length > 0
          ? `\nDO NOT repeat these previous questions:\n- ${prevList.join('\n- ')}\n`
          : '';

        const ankiPrompt = `You are "Newton", a university Physics & Biostatistics AI Tutor creating a ${difficulty.toUpperCase()} active-recall bundle for Question ${qNum}.
ORIGINAL QUESTION:
----------
${qText}
----------
Student's Answer: "${stuAns || 'Blank'}" | Official Key: "${correctAns}" | Status: ${isCorrect ? 'CORRECT' : 'INCORRECT'}
${adjReason ? `Instructor Adjustment: "${adjReason}"\n` : ''}
${domainKB}
${avoidBlock}
Rules:
- ${isEn ? 'Write 100% in English.' : 'اكتب باللغة العربية الفصحى الواضحة مع كتابة المصطلحات الإنجليزية بين قوسين، واجعل target_answer في بطاقة cloze مصطلحاً علمياً واضحاً بالإنجليزية أو رقماً.'}
- NEVER place Arabic letters inside LaTeX $...$ or $$...$$.
- Make every card self-contained (never say "in Question ${qNum}").

Return ONLY valid JSON matching this schema:
{
  "concept_badge": "Short concept title (2-4 words)",
  "misconception_diagnosis": "1 concise sentence diagnosing the trap/concept",
  "difficulty": "${difficulty}",
  "cards": {
    "forward": {
      "card_type": "forward",
      "front": "Self-contained concept question",
      "back": "Clear answer and explanation",
      "golden_rule": "1-line takeaway rule"
    },
    "reverse": {
      "card_type": "reverse",
      "front": "Definition or formula asking for the scientific term",
      "back": "Exact scientific term and brief explanation",
      "golden_rule": "1-line distinction hook"
    },
    "cloze": {
      "card_type": "cloze",
      "sentence_with_blank": "Scientific sentence with [...] replacing the key term",
      "target_answer": "Exact 1-2 word term or value",
      "hint": "Short clue",
      "back_explanation": "Completed statement"
    },
    "mcq": {
      "card_type": "mcq",
      "question": "Brand-new 4-option multiple choice question testing the same concept at ${difficulty.toUpperCase()} difficulty",
      "options": { "A": "Option A", "B": "Option B", "C": "Option C", "D": "Option D" },
      "correct_option": "A",
      "hint": "Conceptual hint without revealing the letter",
      "explanation": "Step-by-step solution"
    }
  }
}`;

        const gemRes = await callGeminiAPI({ prompt: ankiPrompt, apiKey, expectJson: true, temperature: 0.5 });
        if (!gemRes.ok || !gemRes.data) {
          return res.status(502).json({ error: 'Failed to generate AI training cards.', details: gemRes.error });
        }
        bundle = gemRes.data;
        if (prevList.length === 0) {
          setAiCache(cacheKey, bundle);
        }
      }

      const mcq = bundle?.cards?.mcq || {};
      const forward = bundle?.cards?.forward || {};
      const challengeToken = createMcqChallengeToken({
        examId: exam.exam_id,
        studentId: student.student_id,
        qNum,
        difficulty,
        correctOption: mcq.correct_option || 'A',
        explanation: mcq.explanation || ''
      });

      if (action === 'train_mcq') {
        return res.status(200).json({
          success: true,
          difficulty,
          training: {
            card_type: 'mcq',
            concept_badge: bundle.concept_badge || 'Concept Drill',
            misconception_note: bundle.misconception_diagnosis || '',
            question: mcq.question || '',
            options: mcq.options || {},
            hint: mcq.hint || '',
            challenge_token: challengeToken
          }
        });
      }

      if (action === 'train_flashcard') {
        return res.status(200).json({
          success: true,
          difficulty,
          training: {
            card_type: 'forward',
            concept_badge: bundle.concept_badge || 'Flashcard',
            front_question: forward.front || '',
            front_hint: forward.golden_rule || '',
            back_answer: forward.back || '',
            golden_rule: forward.golden_rule || ''
          }
        });
      }

      // action === 'generate_anki_cards'
      return res.status(200).json({
        success: true,
        difficulty,
        anki_bundle: {
          ...bundle,
          cards: {
            ...(bundle.cards || {}),
            mcq: {
              ...mcq,
              challenge_token: challengeToken
            }
          }
        }
      });
    }

    return res.status(400).json({ error: `Unsupported action: ${action}` });
  } catch (err) {
    console.error('[api/exam-hub] Error:', err);
    return res.status(500).json({ error: err.message || 'Internal server error in Exam Hub.' });
  }
}
