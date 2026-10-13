# StudyMind

A monochrome React study workspace: read documents, ask questions with page citations, get summaries, and practise interviews tailored to your resume. Pointer-reactive particles, a frosted dock and reduced-motion support.

**Theme:** the page follows the theme and every component is inverted: black components on the white theme, white components on the black theme (see the token block in `src/style.css`).

## Access

Visitors first see a **demo page**. Every feature (library, uploads, notes, questions, study plan, Interview Studio, Ask Gemini) is locked until they **log in or sign up** from the floating card at the top right (Google, email/password, forgot password). After login, the avatar at the top right opens **AI settings**, **Back to studying** and **Log out**.

## Features

- **Multiple uploads**: drop or pick many files at once: PDF, Word (.docx, .doc), PowerPoint (.pptx, .ppt; one page per slide with speaker notes), images (read with OCR), TXT, Markdown or CSV, with per-file progress. Text and figures are saved to Firebase.
- **Library**: search, and delete any document (with its figures, notes and questions) from its card or from inside it.
- **Notes**: headings, sub-headings, detailed paragraphs, figures from the PDF and highlighted code blocks (copy button). Editable, synced.
- **Question bank**: 2, 5 and 8-mark questions with model answers and page references, generated after upload.
- **Quiz**: 3 sets of 30 questions built only from your PDF, 5 of each format: multiple choice, fill in the blank, true/false, matching, name the term and "which statement is correct?". Score and per-format breakdown at the end, review of missed questions, **New questions** for fresh sets every time, and an optional **Gemini set** (checked against the document).
- **Ask Gemini**: a floating help bot that reads the current screen, the open page (text and figures) or the whole document.
- **University library**: pick university, degree and year (GITAM VIZAG · CSE CORE · Years 1–4 to start) and Regular / Supply. Browse subjects → folders (Unit 1, Unit 2, Important questions…) → files and open any file to study it: Ask document, notes, question bank, PDF/Word downloads and Ask Gemini on its pages. "Original" opens the uploaded PDF (files up to 15 MB). Each student's notes on a shared file are saved to their own account.
- **Smart search** (University): searches every university, degree and year (or just your course), your own course first. Understands short forms (*dbms*, *os*, *cn*, *dsa*, *pyq*, *imp*), spelling slips (*normalisaton*), word forms (*normalize* → Normalization), unit numbers written any way (*unit-2*, *u2*, *unit II*), and topics inside files. When nothing matches every word, the closest topics are shown. Admin: *Search inside N older files* adds content keywords to files uploaded before this feature.
- **Downloads**: notes, summaries, question banks (important / all, by category) and Interview Studio transcripts and reports as styled **PDF or Word** files.
- **Study plan**: one plan across several PDFs, balanced by topic length over your days and hours, with revision days; optionally planned by Gemini.
- **Saved in Firebase**: documents, pages, figures, notes, question banks, chats, plans, resume, interview sessions, theme and AI engine.

## Free tier only

Everything runs on the free Firebase **Spark** plan and the free Gemini API tier. There are no Cloud Functions, no Cloud Storage and no billing. Security is enforced by Firestore rules.

## Admin, support and feedback

- **Admin dashboard** (only for `aafthabali08@gmail.com`, signed in with a verified email or Google): open it from the avatar menu.
  - **Overview:** users, active now, active this week, blocked or suspended, documents, open tickets, AI accuracy from feedback, feedback per feature.
  - **Users:** search by email; status (**Active now** = used the app in the last 5 minutes, Offline, Blocked, Suspended until …), documents, tickets, joined and last active. Filter by *Active now* or *Blocked & suspended*.
  - **Block or suspend a user:** open the user → Access. **Suspend** for 1 hour, 1 day, 3 days, 1 week or 30 days (it ends by itself), or **Block** until you unblock them, with an optional reason the user sees. Enforced by the Firestore rules: a blocked or suspended account can't read or save any data, and the app shows them a locked screen. The admin account can't be blocked.
  - **University library:** on the University page, add subjects, folders (one-tap Unit 1–5, Important questions, Previous papers, Notes, Lab) and upload files into them with **Upload files** or by **dragging and dropping** onto the folder (PDF, Word, PowerPoint, images, TXT, Markdown, CSV); give each subject or folder its own **icon** (30 built-in or any emoji); tag each as Regular, Supply or both; rename and delete (a folder with everything in it). **Edit options** adds or removes universities, degrees and years (Years 1–5 by default).
  - **Transfer or copy:** the ⇄ button on any subject, folder or file moves it (*Transfer* = cut and paste) or duplicates it (*Copy* = copy and paste) with everything inside to another university, degree or year, at the top level or into a subject or folder there. **Transfer this year** moves, copies or **swaps** a whole course with another year, degree or university.
  - **Tickets:** read the complaint, reply, set the status (Open, In progress, Resolved, Closed). The user gets a 🔔 notification.
  - **Feedback:** everything users marked ✓ correct or ✗ wrong. One click turns it into an AI guidance rule.
  - **AI guidance:** rules added to every Gemini prompt for every user.
- **Help & support** (every user): the complaint box. Raise a ticket, follow its status, reply to the team.
- **Learning from feedback:** ✓/✗ buttons on questions, notes, summaries, Ask Gemini answers and interview ratings. Wrong items are remembered per user and sent to Gemini as "avoid this"; admin guidance applies to everyone.

**After updating, publish the new security rules**, either by pasting [firestore.rules](firestore.rules) into Firebase console → Firestore Database → Rules → Publish, or with:

```sh
firebase deploy --only firestore:rules
```

## Deploy on Render (free static site)

1. Put the project on GitHub (this folder at the repository root, or set `rootDir` in `render.yaml`).
2. Render → **New → Blueprint** → pick the repository. `render.yaml` builds with `npm ci && npm run build` and serves `dist` with SPA rewrites and security headers.
3. When Render asks, paste the `VITE_*` values from `.env.local` (Firebase config and `VITE_GEMINI_API_KEY`).
4. Firebase console → Authentication → Settings → **Authorized domains** → add `your-site.onrender.com` (Google sign-in needs it).
   Google sign-in runs on the site's own domain (`render.yaml` proxies `/__/auth/*` to Firebase), so phones don't fail with *"missing initial state"*. Allow that handler once: Google Cloud console → APIs & Services → Credentials → the **Web client (auto created by Google Service)** → **Authorized redirect URIs** → add `https://your-site.onrender.com/__/auth/handler`. Then set `VITE_FIREBASE_AUTH_SAME_ORIGIN=true` in Render → Environment and redeploy.
5. Publish `firestore.rules` in the Firebase console (Firestore → Rules).

## Run

```sh
npm install
npm run dev     # http://127.0.0.1:5173
npm test        # 242 tests
npm run build
npm run preview # production build at http://127.0.0.1:4173
npm run deploy  # tests + build + Firebase Hosting + Firestore rules
npm run test:rules  # 70 security-rule checks on local emulators (needs Java)
```

### Test everything locally (no real accounts)

```sh
npm run emulators        # terminal 1: local sign-in + database (needs Java)
npm run dev:emulators    # terminal 2: http://127.0.0.1:5173 using the emulators
```

Accounts and data live only on your machine (project `demo-studymind`); the emulator UI is at http://127.0.0.1:4000.

Sign-in is required: configure Firebase (below) before using the app.

## 1. Connect Firebase (sign-in and database)

1. Go to <https://console.firebase.google.com> and click **Add project**.
2. **Build → Authentication → Get started → Sign-in method** and enable:
   - **Email/Password**, which also gives you password reset
   - **Google** (choose a support email)
3. **Authentication → Settings → Authorized domains**: add your deployed domain. `localhost` is already listed; also add `127.0.0.1` for `npm run dev`.
4. **Build → Firestore Database → Create database** (production mode, a region near you).
5. Skip **Storage**: StudyMind runs entirely on the free **Spark** plan. Text, figures, notes, question banks, chats, plans, resumes, interviews, tickets and feedback are all stored in Firestore.
6. **Project settings → General → Your apps → Web (`</>`)**: register an app and copy the config values.
7. Copy the template and fill it in:
   ```sh
   cp .env.example .env.local
   ```
8. Deploy the security rules (each user can only read and write their own data):
   ```sh
   npm install -g firebase-tools
   firebase login
   firebase use --add          # pick your project
   firebase deploy --only firestore:rules
   ```
9. Restart `npm run dev`. A **Sign in** button appears with Google, email/password, create account and **Forgot password?** (a reset email).

Optional hosting: `npm run build && firebase deploy --only hosting`.

### What is stored where

| Data                                                             | Location                                  |
| ---------------------------------------------------------------- | ----------------------------------------- |
| Document metadata and notes                                      | `users/{uid}/documents/{docId}`           |
| Extracted page text (split to stay under Firestore's 1 MB limit) | `users/{uid}/documents/{docId}/parts/{n}` |
| Resume text                                                      | `users/{uid}/resumes/current`             |
| Interview sessions                                               | `users/{uid}/interviews/{id}`             |
| University options (universities, degrees, years)                | `uni/options`                             |
| University subjects, folders and files (text, figures, original) | `uniNodes/{id}` and its sub-collections   |
| Each user's notes on a university file                           | `users/{uid}/uniStudy/{id}`               |
| Blocks and suspensions                                           | `bans/{uid}`                              |

Firestore uses an offline cache, so your library opens instantly and works without a connection.

## 2. Choose an AI engine (profile → AI engine settings)

| Engine                   | What you get                                                                                                                            | Cost / privacy                                                                             |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| **Instant** (default)    | Keyword retrieval, exact-quote answers, extractive summaries, resume questions, answer checklist                                        | No download, offline, nothing leaves the browser                                           |
| **On-device open model** | Adds semantic search (`all-MiniLM-L6-v2`) and written answers, summaries, interview questions and coaching from `Qwen2.5-0.5B-Instruct` | One-time ~400 MB download, cached; runs in a Web Worker; fastest with WebGPU (Chrome/Edge) |
| **Your model server**    | Same features with any OpenAI-compatible server running an open model                                                                   | Strongest and fastest. Presets: Ollama, LM Studio, Groq, OpenRouter                        |

For a free local server, install [Ollama](https://ollama.com) and run:

```sh
ollama pull llama3.2
ollama serve
```

Local development works as is. For a deployed site, allow its origin: `OLLAMA_ORIGINS="https://your-app.web.app" ollama serve`.

Model ids live in `src/ai/models.js`, so you can swap in a larger ONNX model.

## How documents are processed, and why

Converting text word by word is not the best approach: a single word has no meaning on its own, and a model cannot search or summarise word lists. A whole page is also a poor unit, because it mixes several ideas and is too long for small models. StudyMind uses the approach most retrieval (RAG) systems use:

1. **Read page by page.** pdf.js extracts each page's text, so every answer can cite its page.
2. **Chunk by meaning.** Pages are split into whole sentences and grouped into ~180-word chunks. Each chunk repeats the previous chunk's last sentence, so no idea is cut in half (`src/ai/text.js → chunkPages`).
3. **Index twice.** A BM25 keyword index is built instantly. With AI on, each chunk also gets a 384-number embedding (in a Web Worker, so the UI never freezes), so questions match meaning as well as exact words.
4. **Retrieve, then answer.** Keyword and semantic rankings are fused. The best 4 chunks go to the model, which must cite pages and say "The document does not cover this" when the answer isn't there. You always see an **instant verbatim extract first**; the AI answer streams in after it.
5. **Summarise (extract, then abstract).** Long documents are first reduced to their most central sentences, then written up by the model. This is much faster than reading every chunk, and it stays grounded in the text.

Every AI feature has an instant fallback, so the app stays fast and correct when no model is available.

## Interview Studio

- Upload a **resume/CV** (PDF, DOCX or TXT, up to 10 MB). StudyMind detects skills, roles, projects, education, certifications and measurable claims such as "reduced latency by 40%".
- Formats: **From my resume**, **Behavioral & project**, or **Resume + behavioral**, with 3, 5 or 8 questions.
- Answer by voice (on-device Moonshine/Whisper, see below) or by typing.
- **Review answer** gives an instant STAR checklist covering length, situation, your own actions, results, "we" vs "I", and filler words. It is not a score. With an AI engine on, **Get AI coaching** adds a rewritten, stronger version of your answer.
- When you are signed in, the resume and completed sessions are saved to your account.

## Interview Studio models

| Job | Model / tech | Runs |
| --- | --- | --- |
| Questions, follow-ups, model answers, coaching | **Gemini** | Google (needs `VITE_GEMINI_API_KEY`; built-in bank otherwise) |
| Live speech-to-text | **Moonshine tiny** (open, 28 MB) | On device, Web Worker, ~0.1 s per update |
| Final transcript | **Whisper base.en** (open, 74 MB) | On device, ~2.5 s for a 15 s answer |
| Relevance scoring | **MiniLM** sentence embeddings (open, 23 MB) | On device |
| Audio preprocessing | Web Audio: 16 kHz resampling, noise-adaptive voice detection, silence trim, gain | On device |
| Voice analysis | Pace, pauses, fillers, steadiness from mic levels + transcript | On device |
| Structure scoring | STAR, specificity, length rules | On device |

Models download once and are cached by the browser. No audio leaves the device. Browsers without WebAssembly/Web Audio fall back to the browser's own speech recognition.

## Boundaries

Scanned (image-only) PDFs are read with on-device OCR (Tesseract.js, a one-time ~7 MB download, up to 80 pages); handwriting and poor scans may read imperfectly. Voice models download once (~100 MB) and then run offline. The small on-device model is fast but less capable than larger server models. Answer feedback is guidance, not an assessment.
