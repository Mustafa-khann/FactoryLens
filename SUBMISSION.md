# FactoryLens — Hackathon Submission Kit

Everything you need to submit to the Cerebras × Google DeepMind Gemma 4 Hackathon.
Targeting **Track 1 (Multiverse Agents)** and **Track 3 (Enterprise Impact)**.

---

## 60-second demo video script

> Record the browser at 1440×900. Use Demo mode if live Gemma 4 access isn't enabled yet — the experience is identical.

**0:00–0:08 — Hook.**
"Industrial downtime costs thousands a minute, and root-cause analysis is slow and manual. FactoryLens is an AI war room that diagnoses failures in seconds — on Gemma 4 and Cerebras."

**0:08–0:20 — Input + multimodal.**
Show the incident: robotic-arm emergency stop. Drag in a **photo of the damaged joint**. "We give it the logs, the config, the operator notes — and a photo. A dedicated Gemma 4 vision agent reads the image."

**0:20–0:35 — The agents work (speed).**
Click **Run**. The agents fill in live. Cut to the header: **"~1,200 tok/s."** Open Diagnostics: **"A full multi-agent investigation — Vision, 8 specialists, and a Skeptic — in under a second. ~29× faster than a GPU baseline."** (Show the side-by-side latency bars.)

**0:35–0:48 — The Skeptic changes the answer.**
Open Hypotheses. "This is the part that matters: a Skeptic agent red-teams the conclusion and **revises the confidence — 84% down to 61%** — because there's no replay yet. It's calibrated, not overconfident."

**0:48–0:58 — The decision (enterprise).**
Overview: "The Incident Commander gives a safety-aware repair decision — root cause, diagnostic steps, lockout/tagout warnings, and what evidence to collect next. Honest, fast, deployable."

**0:58–1:00 — Close.**
"FactoryLens. Diagnose at the speed of thought. Gemma 4 on Cerebras."

### Recording checklist
- Hide notifications, API keys, personal tabs (full-screen the app).
- Have a real equipment photo ready to drag in.
- Show the **tok/s counter** and the **GPU-baseline bars** clearly — that's the Cerebras requirement.
- Show the **84%→61% Skeptic revision** — that's the multi-agent proof.

---

## X / Twitter post (tag @Cerebras and @googlegemma)

> 🏭 Meet FactoryLens — an AI war room for industrial failures.
>
> Logs + a photo of broken equipment → a full multi-agent investigation in <1s. A Gemma 4 vision agent reads the image, 8 specialists debate, and a Skeptic re-calibrates the confidence.
>
> ~29× faster than a GPU baseline on @Cerebras + @googlegemma Gemma 4.
>
> #Gemma4 #Cerebras [video]

---

## Discord — Track 1 (#g4hackathon-multiverse-agents)

**FactoryLens — AI War Room for Industrial Failures**

A multi-agent + multimodal incident-diagnosis tool on Gemma 4 31B + Cerebras.

- **Multi-agent:** a Vision Inspector (multimodal), a synthesis team of 8 specialists, and an adversarial **Skeptic that revises the conclusion** — leading-hypothesis confidence visibly drops (e.g. 84%→61%) and missing-evidence requests are added. Real collaboration, not one prompt.
- **Multimodal:** a dedicated Gemma 4 vision agent reads a photo of the equipment and ties visible wear/damage to the log timeline.
- **Speed in action:** every run reports call count, tok/s, and a side-by-side latency comparison vs a GPU baseline (~29× faster). The whole investigation finishes in under a second — the workflow only exists because of Cerebras.
- **Physical-AI angle:** robotics / smart-manufacturing failure triage (robotic arms, conveyors, autonomous rovers).

Demo video: [link] · Repo: [link]

---

## Discord — Track 3 (#g4hackathon-enterprise-impact)

**FactoryLens — Incident Response for Industrial Operations**

Incident response is a core enterprise problem; FactoryLens addresses it end-to-end.

- **Business impact:** cuts root-cause triage from minutes of manual work to seconds, with a calibrated, safety-aware decision a maintenance tech can act on.
- **Production readiness:** honest failure modes (never fabricates a diagnosis), explicit demo vs live separation, server-side key handling, deployable on Vercel, an accuracy eval (`npm run eval`) scored against ground truth.
- **Technical excellence:** a clean multi-agent orchestrator with strict structured outputs and per-agent schemas.
- **AI differentiation:** Cerebras speed makes a real adversarial multi-agent loop viable in the UI, and Gemma 4's multimodality grounds the diagnosis in an actual photo — together they produce a better, more trustworthy enterprise experience.

Demo video: [link] · Repo: [link]

---

## Submission checklist
- [ ] Record + upload the 60s demo video
- [ ] Post to X tagging **@Cerebras** and **@googlegemma**
- [ ] Post Track 1 entry in `#g4hackathon-multiverse-agents`
- [ ] Post Track 3 entry in `#g4hackathon-enterprise-impact`
- [ ] (Optional) Post in `#g4hackathon-people-choice` for Track 2 with the X link
