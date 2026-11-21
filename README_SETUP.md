# NEWTON Standalone Exam Hub — Setup & Deployment Guide

This package separates the **Exams Hub, Digital Bubble Sheet Viewer, Question Bank (`QText`), Gemini AI Tutor, Adaptive Mistake Trainer, and Anki Active-Recall Deck** completely out of Supabase.

- **Database Stress on Supabase (`xpjwvvblgxiepvpqjqnv`):** **`0` connections, `0` queries, `0` JSONB writes.**
- **Data Source:** Google Sheets (cached in Vercel memory for 60 seconds per warm instance).
- **AI Engine:** Server-side `GEMINI_API_KEY` (with in-memory LRU caching so identical mistake explanations across hundreds of students are served in `<1 ms` without burning Gemini quota).

---

## 1. Folder Contents (`C:\Newton\NEWTON_STANDALONE_EXAM_HUB`)

- [`exam-hub.html`](file:///C:/Newton/NEWTON_STANDALONE_EXAM_HUB/exam-hub.html) — Standalone Digital Bubble Sheet, LaTeX/Arabic Question Cards, Gemini AI Explain (EN/AR), Practice MCQ, 3D Flashcards, LocalStorage Anki Trainer, and Anti-Print/Watermark Security Engine.
- [`api/exam-hub.js`](file:///C:/Newton/NEWTON_STANDALONE_EXAM_HUB/api/exam-hub.js) — Zero-Supabase Vercel serverless backend that reads & caches your Google Sheet, isolates each student's record by Student ID, enforces `Is_Published` and `Release_Answers` server-side, and calls Gemini.
- [`vercel.json`](file:///C:/Newton/NEWTON_STANDALONE_EXAM_HUB/vercel.json) — Rewrites `/` to `/exam-hub.html` when deployed as a standalone Vercel project.
- **Google Sheet CSV Templates (`google-sheet-templates/`):**
  - [`Settings.csv`](file:///C:/Newton/NEWTON_STANDALONE_EXAM_HUB/google-sheet-templates/Settings.csv)
  - [`Models_Questions.csv`](file:///C:/Newton/NEWTON_STANDALONE_EXAM_HUB/google-sheet-templates/Models_Questions.csv)
  - [`Student_Responses.csv`](file:///C:/Newton/NEWTON_STANDALONE_EXAM_HUB/google-sheet-templates/Student_Responses.csv)
- [`tests/exam-hub.test.cjs`](file:///C:/Newton/NEWTON_STANDALONE_EXAM_HUB/tests/exam-hub.test.cjs) — Automated verification test suite.

---

## 2. How to Set Up Your Google Sheet (2 Minutes)

1. Create a new Google Sheet with **3 bottom tabs** named exactly:
   - **`Settings`** — Import [`google-sheet-templates/Settings.csv`](file:///C:/Newton/NEWTON_STANDALONE_EXAM_HUB/google-sheet-templates/Settings.csv). Controls `Exam_ID`, `Exam_Title`, `Course_ID`, `Is_Published` (`TRUE/FALSE`), `Release_Answers` (`TRUE/FALSE`), and `Adjustment_Reason`.
   - **`Models_Questions`** — Import [`google-sheet-templates/Models_Questions.csv`](file:///C:/Newton/NEWTON_STANDALONE_EXAM_HUB/google-sheet-templates/Models_Questions.csv). Holds the official answer keys (`Correct_Key`) and question statements (`Question_Text` with LaTeX `\( ... \)` or `$ ... $`) for Models `A`, `B`, `C`, `D`.
   - **`Student_Responses`** — Import [`google-sheet-templates/Student_Responses.csv`](file:///C:/Newton/NEWTON_STANDALONE_EXAM_HUB/google-sheet-templates/Student_Responses.csv) **or** paste your raw ZipGrade CSV export directly! The universal parser automatically detects `Student_ID`, `Student_Name`, `Model` (`Key Version`), `Earned_Points`, `Possible_Points`, and `Q1..QN` / `Stu1..StuN` / `PriKey1..N`.
2. Click **Share** (top right in Google Sheets) → Under **General access**, choose **"Anyone with the link" → "Viewer"**.
   *(Students never receive the Google Sheet URL; only your Vercel backend `api/exam-hub.js` reads it using `GOOGLE_SHEET_ID` and returns only the requesting student's single row.)*
3. Copy the Sheet ID from the URL:
   `https://docs.google.com/spreadsheets/d/YOUR_GOOGLE_SHEET_ID_HERE/edit`

---

## 3. Environment Variables in Vercel

Set these two variables in your Vercel project settings:

| Variable | Description |
|---|---|
| `GOOGLE_SHEET_ID` | The Google Sheet ID (or full Google Sheet URL) |
| `GEMINI_API_KEY` | Your Gemini API key (already configured in your Vercel project) |

---

## 4. Two Ways to Deploy / Commit to GitHub

*(Note: I have **not** committed or pushed anything to GitHub automatically, so your `CP-2` frozen repositories remain 100% untouched.)*

### Deployment Path A — Drop Into Your Existing `newton-chatbot` Repo (Same Domain)
Copy just the two runtime files into your repo when ready:
- `C:\Newton\NEWTON_STANDALONE_EXAM_HUB\exam-hub.html` → `exam-hub.html`
- `C:\Newton\NEWTON_STANDALONE_EXAM_HUB\api\exam-hub.js` → `api/exam-hub.js`

Then students can open:
`https://<your-domain>/exam-hub.html` (or deep-link from announcements / portal: `https://<your-domain>/exam-hub.html?exam=Q2_PHYS101&id=200046095`).

### Deployment Path B — Deploy `C:\Newton\NEWTON_STANDALONE_EXAM_HUB` as a Separate GitHub Repo / Separate Vercel Project
If you want 100% physical isolation from the main LMS deployment:
```powershell
cd C:\Newton\NEWTON_STANDALONE_EXAM_HUB
git init
git add .
git commit -m "Initial commit: Standalone Zero-Supabase Exam Hub"
```
Then connect it to a new GitHub repo or run `vercel --prod` inside `C:\Newton\NEWTON_STANDALONE_EXAM_HUB`.
