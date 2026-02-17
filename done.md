# DhandhaPhone — Build Progress

> Last updated: 2026-02-18

---

## Phase 1: Bootstrap & Foundation — DONE

- [x] **Task 1.1:** Created full project directory structure (skills/, lib/, config/, server/, tests/, data dirs)
- [x] **Task 1.2:** Created Termux:API bridge script (`lib/termux-bridge.sh`) and Node.js wrapper (`lib/termux-api.js`)
- [x] **Task 1.3:** Created shared utility module (`lib/utils.js`) — PATHS, readJSON, writeJSON, appendJSONL, readJSONL, date helpers, txn ID generator
- [x] **Task 1.4:** Symlinked shared scripts (utils.js, termux-api.js, termux-bridge.sh) into all 4 skill directories
- [x] **Task 1.5:** Skipped gateway health check (requires Android/OpenClaw runtime) — all local files verified

**Files created:**
- `lib/utils.js`, `lib/termux-api.js`, `lib/termux-bridge.sh`
- `contacts/contacts.json`, `inventory/stock.json`, `pending/actions.json`
- `ledger/summary.json`, `sms/last_processed_id.txt`, `.anon-map.json`

---

## Phase 2: SMS Transaction Engine — DONE

- [x] **Task 2.1:** Built SMS parser (`skills/sms-ledger/scripts/sms-parser.js`) — handles HDFC, SBI, ICICI, Axis, Kotak, PNB, BOB, Canara, Union, IndusInd, Federal + UPI notification parsing (GPay, PhonePe, Paytm)
- [x] **Task 2.2:** Built SMS polling & dedup engine (`skills/sms-ledger/scripts/sms-poller.js`) — polls SMS, deduplicates, appends to JSONL ledger, updates summary
- [x] **Task 2.3:** Created SMS Ledger SKILL.md with full instructions for the LLM
- [x] **Task 2.4:** Created test suite (`skills/sms-ledger/scripts/test-parser.js`) — **10/10 tests pass** (HDFC credit/debit, SBI, ICICI, Axis, Kotak, NEFT, OTP filter, promo filter, rupee symbol)
- [x] **Task 2.5:** Cron job config documented in setup script (requires OpenClaw runtime to register)

**Bug fixed during build:** UPI regex didn't handle "UPI txn Ref NNNNN" format. Added multiple UPI reference patterns. Also fixed counterparty extraction capturing trailing "via" word.

**Files created:**
- `skills/sms-ledger/SKILL.md`
- `skills/sms-ledger/scripts/sms-parser.js`
- `skills/sms-ledger/scripts/sms-poller.js`
- `skills/sms-ledger/scripts/test-parser.js`
- `skills/sms-ledger/scripts/ledger-query.js`
- `skills/sms-ledger/scripts/rebuild-summary.js`

---

## Phase 3: Business Memory Skills — DONE

- [x] **Task 3.1:** Created Business Memory SKILL.md — silent data extraction, contact/inventory/action schemas, 10+ examples
- [x] **Task 3.2:** Created contact lookup helper (`skills/business-memory/scripts/contact-lookup.js`)
- [x] **Task 3.3:** Created ledger query helper (`skills/sms-ledger/scripts/ledger-query.js`) — filters by date, type, name, min amount
- [x] **Task 3.4:** Created summary rebuild script (`skills/sms-ledger/scripts/rebuild-summary.js`)

**Files created:**
- `skills/business-memory/SKILL.md`
- `skills/business-memory/scripts/contact-lookup.js`

---

## Phase 4: Proactive Briefings — DONE

- [x] **Task 4.1:** Created Business Briefing SKILL.md — morning briefing, EOD summary, weekly report templates, Hinglish formatting rules
- [x] **Tasks 4.2-4.4:** Cron job configs for morning (7 AM), EOD (9 PM), weekly (Sun 8 PM) documented in setup script

**Files created:**
- `skills/business-briefing/SKILL.md`

---

## Phase 5: Document Intelligence — DONE

- [x] **Task 5.1:** Created Document Intel SKILL.md — photo processing (invoices, bills, receipts, visiting cards), voice note handling, extraction and confirmation patterns
- [x] **Task 5.2:** Created OCR fallback script (`skills/document-intel/scripts/ocr.sh`) — Tesseract eng+hin
- [x] **Task 5.3:** E2E testing requires live Telegram + photos — documented in e2e-checklist.md

**Files created:**
- `skills/document-intel/SKILL.md`
- `skills/document-intel/scripts/ocr.sh`

---

## Phase 6: Anonymization Layer — DONE

- [x] **Task 6.1:** Built anonymization module (`lib/anonymize.js`) — replaces contact names with IDs, strips phone numbers, redacts bank accounts and UPI IDs
- [x] **Task 6.2:** Privacy rules integrated into SOUL.md
- [x] **Task 6.3:** Round-trip testing ready (anonymize → deanonymize restores names, phones/accounts stay redacted by design)

**Files created:**
- `lib/anonymize.js`

---

## Phase 7: Agent Personality & Config — DONE

- [x] **Task 7.1:** Created AGENTS.md — personality, capabilities, limitations
- [x] **Task 7.2:** Created SOUL.md — language matching, response length rules, privacy mandates, proactive behavior, error handling
- [x] **Task 7.3:** Created HEARTBEAT.md — SMS check, overdue payments, battery check, gateway health
- [x] **Task 7.4:** OpenClaw config commands documented in setup script

**Files created:**
- `config/AGENTS.md`
- `config/SOUL.md`
- `config/HEARTBEAT.md`

---

## Phase 8: Cloud LLM Router — DONE

- [x] **Task 8.1:** Created FastAPI router (`server/main.py`) — 3-tier routing: Gemini Flash (simple), DeepSeek V3 (medium), Claude Sonnet (complex) with fallback chain
- [x] **Task 8.2:** Created deployment script (`server/run.sh`) and requirements.txt
- [x] **Tasks 8.3-8.4:** Testing requires API keys and running server — documented

**Files created:**
- `server/main.py`
- `server/requirements.txt`
- `server/run.sh`

---

## Phase 9: Integration & Hardening — DONE

- [x] **Task 9.1:** Created E2E test checklist (`tests/e2e-checklist.md`)
- [x] **Task 9.2:** Watchdog script included in setup-dhandhaphone.sh
- [x] **Task 9.3:** Log rotation cron documented in build_plan.md
- [x] **Task 9.4:** Created repair script (`lib/repair.js`) — recreates corrupted JSON files with defaults

**Files created:**
- `tests/e2e-checklist.md`
- `tests/test-parser.js` (copy)
- `lib/repair.js`

---

## Phase 10: Setup Automation — DONE

- [x] **Task 10.1:** Created one-command setup script (`setup-dhandhaphone.sh`) — creates dirs, copies skills, initializes data, sets up bionic bypass, installs watchdog, prints cron job commands
- [x] **Task 10.2:** Git repo structure matches build_plan.md spec (34 files)
- [x] **Task 10.3:** Created README.md — architecture diagram, prerequisites, quick start, feature table, privacy section

**Files created:**
- `setup-dhandhaphone.sh`
- `README.md`

---

## Phase 11: Extended Skills Suite — DONE

- [x] **Task 11.1:** Created Notification Watch skill (`skills/notification-watch/SKILL.md`) — polls Android notifications from UPI apps (GPay, PhonePe, Paytm, BHIM), POS terminals (BountiPOS, Pine Labs), food delivery (Swiggy, Zomato), e-commerce; deduplicates against SMS ledger
- [x] **Task 11.2:** Created Accounting skill (`skills/accounting/SKILL.md`) — auto-categorization by counterparty/keyword/method, P&L generation, expense tracking by category, month-over-month comparison
- [x] **Task 11.3:** Created GST Assistant skill (`skills/gst-assistant/SKILL.md`) — common GST rate lookup (construction, food, services), tax calculations (CGST/SGST/IGST), ITC tracking, filing calendar with escalating reminders, composition vs regular scheme support
- [x] **Task 11.4:** Created Fraud Detection skill (`skills/fraud-detect/SKILL.md`) — 3-layer system: velocity checks (duplicate, rapid-fire, night txns), amount anomalies (unusually large, new counterparty), pattern breaks (revenue drops, expense spikes); fake SMS detection; bank helpline reference
- [x] **Task 11.5:** Created Credit Manager skill (`skills/credit-manager/SKILL.md`) — udhaar dashboard, 6-level escalating reminder templates (gentle → final), payment plans/installments, credit limits, aging reports, supplier payables tracking
- [x] **Task 11.6:** Created Price Memory skill (`skills/price-memory/SKILL.md`) — price history from invoices/conversations/transactions, supplier comparison, margin tracking, price change alerts (>5% flag, >10% alert), negotiation helper
- [x] **Task 11.7:** Updated AGENTS.md with 6 new capabilities
- [x] **Task 11.8:** Updated HEARTBEAT.md with 5 new periodic checks (notification watch, fraud Layer 3, credit aging, price monitoring, GST filing reminders)
- [x] **Task 11.9:** Created data files: `accounting/categories.json`, `accounting/gst-profile.json`, `accounting/txn-baseline.json`, `inventory/margins.json`

**Files created:**
- `skills/notification-watch/SKILL.md`
- `skills/accounting/SKILL.md`
- `skills/gst-assistant/SKILL.md`
- `skills/fraud-detect/SKILL.md`
- `skills/credit-manager/SKILL.md`
- `skills/price-memory/SKILL.md`
- `accounting/categories.json`
- `accounting/gst-profile.json`
- `accounting/txn-baseline.json`
- `inventory/margins.json`

---

## Phase 12: Voice Implementation (Phase 1) — DONE

- [x] **Task 12.1:** Created Sarvam API client (`lib/voice/sarvam-client.js`) — STT (speech-to-text), TTS (text-to-speech), translate; multipart form upload for STT, JSON for TTS; auto-chunking for text >2500 chars; timeout handling; supports all 11 Indian languages
- [x] **Task 12.2:** Created voice pipeline handler (`lib/voice/voice-handler.js`) — download Telegram voice → STT → show transcript → process as text → decide voice/text reply → TTS if needed; confidence checking; mirror-mode (voice in = voice out); language-aware UI strings
- [x] **Task 12.3:** Created TTS generator (`lib/voice/tts-generator.js`) — briefing voice generation, alert voice generation, text cleanup for speech (strip emoji/markdown/tables), per-language speaker selection
- [x] **Task 12.4:** Created audio utilities (`lib/voice/audio-utils.js`) — base64↔file conversion, OGG↔WAV conversion via ffmpeg, duration detection, temp file cleanup, ffmpeg availability check
- [x] **Task 12.5:** Created voice config (`lib/voice/voice-config.json`) — 11 Indian languages with STT/TTS codes, per-language UI strings (heard/processing/repeat/error), Sarvam API settings, voice reply thresholds
- [x] **Task 12.6:** Created test script (`scripts/test-voice.sh`) — tests Sarvam TTS (English + Hindi), round-trip STT, API connectivity check; works on Mac
- [x] **Task 12.7:** Created deploy script (`scripts/deploy-to-phone.sh`) — rsync via SSH or ADB push; auto-installs deps and restarts pm2
- [x] **Task 12.8:** Created phone setup script (`scripts/phone-setup-voice.sh`) — installs ffmpeg, sox, Node.js deps; detects Termux vs proot Ubuntu; guides Sarvam API key setup
- [x] **Task 12.9:** Updated SOUL.md — added Voice Behavior section (transcription transparency, voice/text reply decision tree, voice persona guidelines)
- [x] **Task 12.10:** Updated HEARTBEAT.md — added Voice Briefing check (morning/evening TTS generation) and audio temp cleanup
- [x] **Task 12.11:** Updated sms-ledger SKILL.md — added voice transaction entry section with multilingual examples and source: "voice"
- [x] **Task 12.12:** Updated business-memory SKILL.md — added voice contact mention handling with fuzzy name matching for STT spelling variations
- [x] **Task 12.13:** Updated business-briefing SKILL.md — added voice briefing format section (speech-optimized text, 60-second limit, de-anonymization requirement)

**Files created:**
- `lib/voice/sarvam-client.js`
- `lib/voice/voice-handler.js`
- `lib/voice/tts-generator.js`
- `lib/voice/audio-utils.js`
- `lib/voice/voice-config.json`
- `scripts/test-voice.sh`
- `scripts/deploy-to-phone.sh`
- `scripts/phone-setup-voice.sh`

**Files modified:**
- `config/SOUL.md` (Voice Behavior section)
- `config/HEARTBEAT.md` (Voice Briefing + Temp Cleanup checks)
- `skills/sms-ledger/SKILL.md` (Voice Transaction Entry)
- `skills/business-memory/SKILL.md` (Voice Contact Mentions)
- `skills/business-briefing/SKILL.md` (Voice Briefing Format)

---

## Phase 13: Document Intelligence — Sarvam Vision OCR — DONE

- [x] **Task 13.1:** Created shared Sarvam client (`lib/sarvam/sarvam-client.js`) — moved from lib/voice/ to shared location; added full Document Intelligence API lifecycle (processDocument, createDocJob, getUploadUrl, uploadFile, startDocJob, pollJobStatus, downloadJobOutput); ZIP output parsing (JSON/MD/HTML); markdown table extraction; HTML table extraction; document MIME type detection; longer timeout for document ops
- [x] **Task 13.2:** Updated voice module imports — `lib/voice/sarvam-client.js` now re-exports from `lib/sarvam/sarvam-client.js` for backward compatibility; voice-handler.js and tts-generator.js continue working unchanged
- [x] **Task 13.3:** Created document classifier (`lib/documents/doc-classifier.js`) — keyword-based scoring for invoice/receipt/business_card/bank_statement/price_list/stock_register/handwritten_note; multilingual keywords (Hindi, Telugu, Tamil, Kannada, Bengali, Marathi, Gujarati); caption hint override; structural analysis (table presence, text length)
- [x] **Task 13.4:** Created document parser (`lib/documents/doc-parser.js`) — field extractors for Indian phone numbers, email, GSTIN (state+PAN+entity+Z+checksum format), currency amounts (₹/Rs/INR), Indian date formats (DD/MM/YYYY); business card parser; bank statement parser; price list parser; stock register parser; table row parsers with header detection
- [x] **Task 13.5:** Created invoice extractor (`lib/documents/invoice-extractor.js`) — specialized for GST invoices, cash memos, kachha bills; vendor extraction (first non-keyword line); invoice number regex patterns; line item extraction from tables (with HSN/SAC) and text fallback; total/GST extraction including separate CGST+SGST addition; payment terms extraction
- [x] **Task 13.6:** Created document handler (`lib/documents/doc-handler.js`) — main orchestrator: download from Telegram → Sarvam Vision OCR → classify → route → present; 8 document type handlers (invoice, receipt, business_card, bank_statement, price_list, handwritten_note, stock_register, generic); confirmation flow for financial data; caption-based classification hints; INR formatting; error handling with graceful fallback
- [x] **Task 13.7:** Updated `lib/voice/voice-config.json` — added document_intelligence section (enabled, output format, timeout, max file size, supported formats, auto-classify, confirm before logging, temp dir)
- [x] **Task 13.8:** Updated `config/SOUL.md` — added Document Processing Behavior section (8 document types, confirmation rules, extraction quality rules, GST detail extraction, photo reference storage)
- [x] **Task 13.9:** Rewrote `skills/document-intel/SKILL.md` — replaced LLM vision approach with Sarvam Vision pipeline; documented full processing flow (download → OCR → classify → extract → confirm → update); added caption classification hints; documented business logic routing after confirmation; multilingual support via Sarvam
- [x] **Task 13.10:** Updated `skills/sms-ledger/SKILL.md` — added OCR-Captured Transactions section (source: "ocr", extra fields: ocr_document_type, ocr_vendor, ocr_invoice_no, ocr_items; bank statement batch import with dedup)
- [x] **Task 13.11:** Updated `lib/utils.js` — added ocrDir and documents PATHS
- [x] **Task 13.12:** Updated `setup-dhandhaphone.sh` — added lib/sarvam and lib/documents directories to workspace creation and copy steps

**Files created:**
- `lib/sarvam/sarvam-client.js` (shared Sarvam client with voice + document methods)
- `lib/documents/doc-handler.js` (document processing orchestrator)
- `lib/documents/doc-classifier.js` (keyword-based document classification)
- `lib/documents/doc-parser.js` (field extractors for Indian documents)
- `lib/documents/invoice-extractor.js` (invoice/receipt specialized extraction)

**Files modified:**
- `lib/voice/sarvam-client.js` (re-export wrapper pointing to shared location)
- `lib/voice/voice-config.json` (added document_intelligence section)
- `config/SOUL.md` (Document Processing Behavior section)
- `skills/document-intel/SKILL.md` (rewritten for Sarvam Vision)
- `skills/sms-ledger/SKILL.md` (OCR-Captured Transactions section)
- `lib/utils.js` (ocrDir and documents PATHS)
- `setup-dhandhaphone.sh` (sarvam and documents directories)

**npm dependency needed:** `adm-zip` (for parsing Sarvam Vision ZIP output)

---

## Summary

| Phase | Status | Files |
|-------|--------|-------|
| 1. Bootstrap & Foundation | DONE | 9 files |
| 2. SMS Transaction Engine | DONE | 6 files |
| 3. Business Memory Skills | DONE | 2 files |
| 4. Proactive Briefings | DONE | 1 file |
| 5. Document Intelligence | DONE | 2 files |
| 6. Anonymization Layer | DONE | 1 file |
| 7. Agent Personality | DONE | 3 files |
| 8. Cloud LLM Router | DONE | 3 files |
| 9. Integration & Hardening | DONE | 3 files |
| 10. Setup Automation | DONE | 2 files |
| 11. Extended Skills Suite | DONE | 10 files |
| 12. Voice (Phase 1) | DONE | 8 new + 5 modified |
| 13. Document Intelligence (Sarvam Vision) | DONE | 5 new + 7 modified |

**Total: 57 files created. All 13 phases complete. SMS parser tests: 10/10 passing.**

## What Needs Live Testing (requires Android + OpenClaw)

- Termux:API SMS reading on actual device
- OpenClaw gateway startup and Telegram connection
- Cron job registration and execution
- End-to-end SMS → ledger pipeline
- Photo/voice processing via Telegram
- Morning/EOD/weekly briefing delivery
- Anonymization in live LLM calls
- **Voice: Sarvam API key setup and STT/TTS testing**
- **Voice: Telegram voice note receive → transcribe → reply flow**
- **Voice: Morning/evening voice briefing generation**
- **Voice: Multi-language voice accuracy (Hindi, Tamil, Telugu, etc.)**
- **Voice: Noisy environment STT accuracy (shop/traffic/kitchen)**
- **Voice: End-to-end latency (voice in → voice out < 5 seconds)**
- **OCR: Sarvam Vision Document Intelligence API connectivity**
- **OCR: Invoice photo → structured extraction → ledger entry**
- **OCR: Handwritten note → text extraction → agent processing**
- **OCR: Business card → contact creation**
- **OCR: Bank statement PDF → batch transaction import**
- **OCR: Mixed-language documents (English headers + Hindi/Tamil items)**
- **OCR: Low-quality photos (angled, shadowed, thermal print)**
- **OCR: Caption-based classification hints**
- **OCR: adm-zip package installation on Termux**
