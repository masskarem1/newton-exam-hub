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

test('1. Universal CSV Parser & 3-Tab Google Sheet State Builder (Dent101 Quiz 2 + Quiz 1: 10 Groups, 400 Questions, 1720 Submissions)', async () => {
  const apiMod = await import('../api/exam-hub.js');
  const settingsCsv = fs.readFileSync(path.join(__dirname, '../google-sheet-templates/Settings.csv'), 'utf8');
  const questionsCsv = fs.readFileSync(path.join(__dirname, '../google-sheet-templates/Models_Questions.csv'), 'utf8');
  const responsesCsv = fs.readFileSync(path.join(__dirname, '../google-sheet-templates/Student_Responses.csv'), 'utf8');

  const state = apiMod.buildExamHubStateFromCSVs({ settingsCsv, questionsCsv, responsesCsv });
  assert.equal(Object.keys(state.exams).length, 10, 'Should load all 10 exam groups (4 Quiz 2 + 6 Quiz 1)');
  assert.ok(state.exams['Q2_MON1_PHYS.101_F26-27'], 'Q2 MON1 should be loaded');
  assert.ok(state.exams['Q1_MON1_PHYS.101_F26-27'], 'Q1 MON1 should be loaded');
  assert.ok(state.exams['Q1_WED2_PHYS.101_F26-27'], 'Q1 WED2 should be loaded');

  const totalStudents = Object.values(state.exams).reduce((acc, ex) => acc + ex.students.length, 0);
  assert.equal(totalStudents, 1720, 'Should parse all 1720 student submissions (870 Quiz 2 + 850 Quiz 1)');

  const q1Mon1 = state.exams['Q1_MON1_PHYS.101_F26-27'];
  assert.equal(q1Mon1.model_keys.A[1], 'D');
  assert.ok(q1Mon1.question_bank.A[1].question_text.includes('kΔL'), 'Should have repaired Hooke Law kΔL symbol in Q1 MON1');
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

  // Test get-student-sheet via handler (Auto-Detect across all 4 Quiz 2 groups with exam_id = 'ALL')
  const req = {
    method: 'POST',
    body: { action: 'get-student-sheet', exam_id: 'ALL', student_id: '35074' }
  };
  const res = createMockRes();
  await handler(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.exam_id, 'Q2_MON1_PHYS.101_F26-27');
  assert.equal(res.body.student.student_id, '200035074');
  assert.equal(res.body.student.earned_points, 10.5);
  assert.equal(res.body.student.possible_points, 15);
  assert.equal(res.body.student.questions.length, 10);
  // Question 5 on MON1 Model B: student answered B, key is C -> is_correct must be false
  const q5 = res.body.student.questions.find(q => q.q_num === 5);
  assert.equal(q5.student_ans, 'B');
  assert.equal(q5.correct_ans, 'C');
  assert.equal(q5.is_correct, false);

  // Test Quiz 1 Auto-Detect (ALL_Q1) for student 200022703 (who is in both Quiz 1 WED1 and Quiz 2 WED1!)
  const reqQ1 = {
    method: 'POST',
    body: { action: 'get-student-sheet', exam_id: 'ALL_Q1', student_id: '200022703' }
  };
  const resQ1 = createMockRes();
  await handler(reqQ1, resQ1);
  assert.equal(resQ1.statusCode, 200);
  assert.equal(resQ1.body.exam_id, 'Q1_WED1_PHYS.101_F26-27');
  assert.equal(resQ1.body.student.earned_points, 10);
  assert.equal(resQ1.body.student.possible_points, 10);

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
    url: 'https://newton.example.edu/exam-hub.html?exam=ALL&id=200022703',
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

  // Trigger lookup for WED1 student 200022703
  dom.window.document.getElementById('studentIdInput').value = '200022703';
  await dom.window.lookupStudentSheet();

  const doc = dom.window.document;
  assert.equal(doc.getElementById('examSelector'), null, 'Assessment dropdown must be removed');
  const foundCards = doc.querySelectorAll('#foundExamsGrid .found-exam-card');
  assert.equal(foundCards.length, 2, 'Should render 2 Found Exam Cards (Quiz 2 and Quiz 1) for student 200022703');

  assert.equal(doc.getElementById('bubbleStudentName').textContent, 'Zyad Ayman Rezk Kotb Mohamed');
  assert.equal(doc.getElementById('bubbleScore').textContent, '10.5 / 15');
  assert.equal(doc.getElementById('bubbleScorePct').textContent, '70%');

  // Switch to the second found exam card (Quiz 1) and verify it renders Quiz 1 (10 / 10)
  dom.window.selectFoundExamCard(1);
  assert.equal(doc.getElementById('bubbleScore').textContent, '10 / 10');
  assert.equal(doc.getElementById('bubbleScorePct').textContent, '100%');

  const gridRows = doc.querySelectorAll('#bubbleSheetGrid .question-row');
  assert.equal(gridRows.length, 10, 'Should render 10 OMR bubble rows');

  const qCards = doc.querySelectorAll('#bubbleQuestionsList .q-card');
  assert.equal(qCards.length, 10, 'Should render 10 interactive question cards');

  // Verify single-question accordion auto-close behavior
  dom.window.toggleQuestionCard(0);
  assert.equal(doc.getElementById('qBody_0').classList.contains('open'), true, 'Q1 should open when clicked');
  dom.window.toggleQuestionCard(1);
  assert.equal(doc.getElementById('qBody_0').classList.contains('open'), false, 'Q1 should auto-close when Q2 is clicked');
  assert.equal(doc.getElementById('qBody_1').classList.contains('open'), true, 'Q2 should open when clicked');

  // Verify Arabic MathJax sanitizer never leaves Arabic inside $...$
  const formattedAr = dom.window.fixArabicMath('قانون القوة $$ \\text{التوتر السطحي} = \\frac{F}{L} $$ حيث $F$ هي القوة ($\\text{نيوتن}$)');
  assert.ok(!/\$(?:[^$]*[\u0600-\u06FF][^$]*)\$/.test(formattedAr), 'Arabic characters must be stripped out of inline math delimiters');
});
