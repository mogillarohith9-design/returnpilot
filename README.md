# ReturnPilot: evidence-based return resolution agent

AI HACK X MRDU 2026 · Team The Web Guild · PS: Autonomous Product Return Resolution Agent

**Live demo:** https://returnpilot-peach.vercel.app

**The idea:** AI reads the customer's complaint and photos; a fixed, tested policy engine makes the decision and explains it; weak or risky cases go to a human. Every step is recorded.

## Features
1. **Explainable decision**: every decision cites the policy clause, evidence score and each step taken.
2. **Evidence chain**: packing photo (seller) vs customer photo vs returned-item photo. Flags likely transit damage and possible swaps or empty boxes; a mismatch holds the refund and sends the case to a human.
3. **Proof-of-now photo**: the app issues a one-time 4-digit code; the customer writes it next to the item. Old or downloaded photos lack it. This raises the effort needed to fake a photo; it does not make fraud impossible.
4. **Policy what-if simulator**: before saving a rule change, see which past decisions would flip.
5. **Any-language complaints**: Telugu, Hindi, Hinglish or English; support sees an English summary.

## Architecture
- Frontend: React + Vite (`src/`)
- Backend: Vercel serverless functions (`api/`); API keys stay on the server
- AI: Google Gemini (`gemini-3.8-flash`, automatic retry and fallback to other Flash models)
- Database: Supabase Postgres (`schema.sql`); Row Level Security on, only the server can read/write
- Decision engine: `api/_lib/policyEngine.ts`, deterministic, 20 automated tests (`npm test`)

## Code tour
- `api/_lib/policyEngine.ts`: the rules that decide (no AI inside)
- `api/_lib/assess.ts`: the AI prompt; the model only reports facts as JSON
- `api/_lib/claim.ts`: proof-of-now code check, then the engine decides
- `api/_lib/gemini.ts`: model fallback chain and time limits
- `tests/`: 20 automated tests for the engine

## Run / deploy
1. Supabase: run `schema.sql` in the SQL editor.
2. Vercel env vars: `GEMINI_API_KEY`, `SUPABASE_URL`, `SUPABASE_SECRET_KEY`.
3. Push to GitHub; Vercel deploys automatically.

Demo data only. Pickup, carrier and payments are sandboxed.
