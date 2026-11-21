/**
 * NEWTON Standalone Exam Hub — Automatic AI_Logs Google Sheet Appender
 *
 * Setup (Optional — for persistent cross-cold-start Google Sheet logging):
 * 1. Open your Google Sheet -> Extensions -> Apps Script.
 * 2. Paste this script and click Deploy -> New deployment -> Web app.
 * 3. Execute as: "Me" | Who has access: "Anyone".
 * 4. Copy the Web App URL and add it to Vercel Environment Variables as:
 *    GOOGLE_SHEET_LOG_WEBHOOK_URL
 */
function doPost(e) {
  try {
    var payload = JSON.parse(e.postData.contents);
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName('AI_Logs');
    if (!sheet) {
      sheet = ss.insertSheet('AI_Logs');
      sheet.appendRow([
        'Cache_Key', 'Exam_ID', 'Model', 'Q_Num', 'Action', 'Lang',
        'Difficulty', 'Student_Ans', 'Correct_Ans', 'Stem_Hash',
        'Response_Payload', 'Created_At'
      ]);
      sheet.setFrozenRows(1);
    }
    sheet.appendRow([
      payload.cache_key || '',
      payload.exam_id || '',
      payload.model || '',
      payload.q_num || '',
      payload.action || '',
      payload.lang || 'en',
      payload.difficulty || '',
      payload.student_ans || '',
      payload.correct_ans || '',
      payload.stem_hash || '',
      payload.response_payload || '',
      payload.created_at || new Date().toISOString()
    ]);
    return ContentService
      .createTextOutput(JSON.stringify({ ok: true }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ ok: false, error: String(err) }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}
