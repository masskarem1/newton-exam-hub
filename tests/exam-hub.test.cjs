const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Give access to JSDOM from C:\Newton\newton-chatbot\node_modules if available
const chatbotNodeModules = 'C:\\Newton\\newton-chatbot\\node_modules';
if (fs.existsSync(chatbotNodeModules) && !module.paths.includes(chatbotNodeModules)) {
  module.paths.push(chatbotNodeModules);
}

function createMockRes() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(k, v) { this.headers[k] = v; },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
    end() { return this; }
  };
}

test('1. Universal CSV Parser & 3-Tab Google Sheet State Builder', async () => {
  const apiMod = await import('../api/exam-hub.js');
  const settingsCsv = fs.readFileSync(path.join(__dirname, '../google-sheet-templates/Settings.csv'), 'utf8');
  const questionsCsv = fs.readFileSync(path.join(__dirname, '../google-sheet-templates/Models_Questions.csv'), 'utf8');
  const responsesCsv = fs.readFileSync(path.join(__dirname, '../google-sheet-templates/Student_Responses.csv'), 'utf8');

  const state = apiMod.buildExamHubStateFromCSVs({ settingsCsv, questionsCsv, responsesCsv });
  assert.ok(state.exams.Q2_PHYS101, 'Q2_PHYS101 exam should be loaded');
  const q2 = state.exams.Q2_PHYS101;
  assert.equal(q2.students.length, 3, 'Should parse 3 student rows');
  assert.equal(q2.model_keys.A[1], 'D');
  assert.equal(q2.model_keys.A[2], 'B');
  assert.equal(q2.model_keys.B[1], 'B');
  assert.ok(q2.question_bank.A[5].question_text.includes('Poiseuille'), 'Should preserve multi-line LaTeX question text');
});

test('2. Student ID Lookup (Exact 9-Digit, Legacy 5-Digit Suffix & Ambiguity Rejection)', async () => {
  const apiMod = await import('../api/exam-hub.js');
  const mockExam = {
    students: [
      { student_id: '200046095', name: 'Shahd Mohamed Ali', model: 'A', questions: [] },
      { student_id: '200012345', name: 'Ahmed Hassan', model: 'B', questions: [] },
      { student_id: '200112345', name: 'Duplicate Suffix Student', model: 'A', questions: [] }
    ]
  };

  // Exact 9-digit match
  const exact = apiMod.findStudentInExam(mockExam, '200046095');
  assert.equal(exact.ok, true);
  assert.equal(exact.student.name, 'Shahd Mohamed Ali');

  // Unambiguous 5-digit legacy suffix match
  const legacy = apiMod.findStudentInExam(mockExam, '46095');
  assert.equal(legacy.ok, true);
  assert.equal(legacy.student.student_id, '200046095');

  // Ambiguous 5-digit suffix (both 200012345 and 200112345 end in 12345) -> must reject with 409
  const ambig = apiMod.findStudentInExam(mockExam, '12345');
  assert.equal(ambig.ok, false);
  assert.equal(ambig.status, 409);

  // Exact 9-digit still resolves cleanly even when 5-digit suffix is shared
  const exactDisambig = apiMod.findStudentInExam(mockExam, '200012345');
  assert.equal(exactDisambig.ok, true);
  assert.equal(exactDisambig.student.name, 'Ahmed Hassan');
});

test('3. Server-Side Student Isolation & Answer Key Release Gate', async () => {
  const apiMod = await import('../api/exam-hub.js');
  const handler = apiMod.default;

  // Test get-student-sheet via handler
  const req = {
    method: 'POST',
    body: { action: 'get-student-sheet', exam_id: 'Q2_PHYS101', student_id: '46095' }
  };
  const res = createMockRes();
  await handler(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.student.student_id, '200046095');
  assert.equal(res.body.student.earned_points, 8);
  assert.equal(res.body.student.questions.length, 10);
  // Question 2: Shahd answered A, key is B -> is_correct must be false
  const q2 = res.body.student.questions.find(q => q.q_num === 2);
  assert.equal(q2.student_ans, 'A');
  assert.equal(q2.correct_ans, 'B');
  assert.equal(q2.is_correct, false);

  // Verify answer withholding when release_answers is FALSE
  const unreleasedExam = {
    exam_id: 'Q3_HIDDEN_KEYS',
    course_id: 'PHYS.101',
    course_name: 'Physics',
    exam_title: 'Quiz 3',
    instructor: 'Dr. Ali',
    is_published: true,
    release_answers: false,
    model_keys: { A: { 1: 'D' } },
    question_bank: { A: { 1: { question_text: 'Secret stem', correct_key: 'D' } } }
  };
  const stu = {
    student_id: '200046095',
    name: 'Shahd',
    section: 'A1',
    model: 'A',
    earned_points: 9,
    possible_points: 10,
    questions: [{ q_num: 1, student_ans: 'D', correct_ans: 'D', is_correct: true, question_text: 'Secret stem' }]
  };
  const sanitized = apiMod.sanitizeStudentSheetForClient(unreleasedExam, stu);
  assert.equal(sanitized.release_answers, false);
  assert.equal(sanitized.student.questions[0].correct_ans, '');
  assert.equal(sanitized.student.questions[0].has_key, false);
  assert.equal(sanitized.student.questions[0].is_correct, null);
  assert.equal(sanitized.student.questions[0].question_text, '');
});

test('4. Encrypted Practice MCQ Challenge Token (No Cleartext Key Leakage)', async () => {
  const apiMod = await import('../api/exam-hub.js');
  const token = apiMod.createMcqChallengeToken({
    examId: 'Q2_PHYS101',
    studentId: '200046095',
    qNum: 2,
    difficulty: 'medium',
    correctOption: 'B',
    explanation: 'Dentin has the highest toughness.'
  });

  assert.ok(token.startsWith('eh1.'), 'Token should use eh1 AES-256-GCM prefix');
  assert.equal(token.includes('Dentin'), false, 'Explanation must be encrypted, not plaintext');

  const wrongCheck = apiMod.verifyMcqChallengeToken(token, 'A');
  assert.equal(wrongCheck.ok, true);
  assert.equal(wrongCheck.is_correct, false);
  assert.equal(wrongCheck.correct_option, 'B');

  const rightCheck = apiMod.verifyMcqChallengeToken(token, 'B');
  assert.equal(rightCheck.ok, true);
  assert.equal(rightCheck.is_correct, true);
  assert.equal(rightCheck.correct_option, 'B');
  assert.equal(rightCheck.explanation, 'Dentin has the highest toughness.');
});

test('5. End-to-End Frontend HTML Bubble Sheet & Arabic MathJax Filter in JSDOM', async () => {
  const { JSDOM } = require('jsdom');
  const apiMod = await import('../api/exam-hub.js');
  const handler = apiMod.default;
  const html = fs.readFileSync(path.join(__dirname, '../exam-hub.html'), 'utf8');

  const dom = new JSDOM(html, {
    url: 'https://newton.example.edu/exam-hub.html?exam=Q2_PHYS101&id=200046095',
    runScripts: 'dangerously'
  });

  // Wire fetch inside JSDOM to our serverless handler
  dom.window.fetch = async (url, opts = {}) => {
    const req = {
      method: opts.method || 'GET',
      query: {},
      body: opts.body ? JSON.parse(opts.body) : {}
    };
    if (String(url).includes('?')) {
      const qs = new URL(url, 'https://newton.example.edu').searchParams;
      for (const [k, v] of qs.entries()) req.query[k] = v;
    }
    const res = createMockRes();
    await handler(req, res);
    return {
      ok: res.statusCode >= 200 && res.statusCode < 300,
      status: res.statusCode,
      json: async () => res.body
    };
  };

  // Trigger lookup
  dom.window.document.getElementById('studentIdInput').value = '200046095';
  await dom.window.lookupStudentSheet();

  const doc = dom.window.document;
  assert.equal(doc.getElementById('bubbleStudentName').textContent, 'Shahd Mohamed Ali');
  assert.equal(doc.getElementById('bubbleScore').textContent, '8 / 10');
  assert.equal(doc.getElementById('bubbleScorePct').textContent, '80%');

  const gridRows = doc.querySelectorAll('#bubbleSheetGrid .question-row');
  assert.equal(gridRows.length, 10, 'Should render 10 OMR bubble rows');

  const qCards = doc.querySelectorAll('#bubbleQuestionsList .q-card');
  assert.equal(qCards.length, 10, 'Should render 10 interactive question cards');

  // Verify Arabic MathJax sanitizer never leaves Arabic inside $...$
  const formattedAr = dom.window.fixArabicMath('قانون القوة $$ \\text{التوتر السطحي} = \\frac{F}{L} $$ حيث $F$ هي القوة ($\\text{نيوتن}$)');
  assert.ok(!/\$(?:[^$]*[\u0600-\u06FF][^$]*)\$/.test(formattedAr), 'Arabic characters must be stripped out of inline math delimiters');
});
