# FactoryLens — AI War Room for Industrial Failures

**Multi-agent, multimodal incident diagnosis for robotics, factories, and field engineering — on Gemma 4 31B + Cerebras.**

FactoryLens turns raw incident evidence (controller logs, config, maintenance/operator notes, and a photo of the equipment) into a reconstructed timeline, an evidence graph, ranked root-cause hypotheses, and a **safety-aware repair decision** — produced by a coordinated team of specialized agents in seconds.

Built for the **Cerebras × Google DeepMind Gemma 4 24-Hour Hackathon** (Tracks 1 & 3).

---

## Why it matters

Unplanned industrial downtime costs thousands of dollars per minute, and root-cause analysis is slow, manual, and dependent on a senior engineer's intuition. FactoryLens gives a maintenance tech a fast, grounded **first-pass triage** that is honest about uncertainty and never recommends unsafe actions — a second opinion at the speed of thought.

This is only possible at this latency because of Cerebras: a real multi-agent investigation (multiple Gemma 4 calls, including a multimodal vision pass and an adversarial review round) completes in ~1–3 seconds instead of a minute.

## The multi-agent pipeline

```
        ┌──────────────────────┐
 image →│  Vision Inspector    │  multimodal Gemma 4 — reads the equipment photo
        └──────────┬───────────┘
                   ▼
        ┌──────────────────────┐
 logs  →│  Synthesis (8 agents)│  log forensics · controls · maintenance · root cause …
 config │                      │  → timeline, evidence graph, ranked hypotheses, report
 notes  └──────────┬───────────┘
                   ▼
        ┌──────────────────────┐
        │  Skeptic (red-team)  │  attacks the conclusion, RE-CALIBRATES confidence,
        └──────────┬───────────┘  demands missing evidence  ← changes the answer
                   ▼
        Incident Commander Report  (safety-aware decision + calibrated confidence)
```

The **Skeptic round visibly changes the output** — leading-hypothesis confidence is lowered (e.g. 84% → 61%) and missing-evidence requests are added. That before→after delta is the proof this is genuine multi-agent collaboration, not a single prompt.

### How the hackathon criteria map

- **Agent collaboration** — distinct agents with real jobs; the Skeptic's critique measurably revises the synthesis.
- **Multimodal intelligence** — a dedicated Gemma 4 vision agent reads the equipment photo and feeds its observations into the diagnosis.
- **Speed in action** — every run reports Gemma 4 call count, throughput (tok/s), wall time, and a side-by-side latency comparison vs an estimated GPU baseline.
- **Enterprise impact** — incident response is a first-class enterprise use case; the tool is production-shaped: honest failure modes, calibrated confidence, no unsafe repair steps, deployable on Vercel.

## Honest by design

FactoryLens **never fabricates a diagnosis**. If the live model is unavailable, it fails with a clear message — it does not silently invent results. **Demo mode** is an explicit, clearly-labeled toggle that runs on built-in sample incidents so you can explore the full experience without a live key.

## Getting started

```bash
npm install
cp .env.example .env        # add your CEREBRAS_API_KEY
npm run dev                 # http://localhost:3000
```

- **Live mode** (default): real Gemma 4 pipeline on Cerebras. Requires `CEREBRAS_API_KEY` with Gemma 4 access.
- **Demo mode**: toggle in the header — runs the full UX on deterministic sample data.

### Accuracy eval

```bash
npm run eval
```

Runs the live pipeline over the labeled demo incidents and scores top-1 root-cause accuracy, using Gemma 4 as a judge against known ground truth.

## Architecture

| Path | Role |
| --- | --- |
| `lib/orchestrator.ts` | Multi-agent pipeline: Vision → Synthesis → Skeptic, with telemetry |
| `lib/agents.ts` | Per-agent prompt builders |
| `lib/schema.ts` | Strict structured-output schemas (Cerebras JSON mode) |
| `lib/cerebras.ts` | Cerebras chat-completions client + typed errors |
| `lib/mockInvestigation.ts` | Deterministic sample generator for Demo mode |
| `app/api/analyze/route.ts` | API route: demo vs live, honest error handling |
| `app/page.tsx` + `components/` | Tabbed results workspace (Overview, Agents, Timeline, Evidence, Hypotheses, Safety, Diagnostics) |

## Stack

Next.js (App Router) · React · TypeScript · Tailwind CSS · Cerebras Inference · Gemma 4 31B (multimodal).
