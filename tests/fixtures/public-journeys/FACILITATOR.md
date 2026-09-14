# First-time Lolly study

Status: ready to recruit. No external sessions or participant results have been recorded. The earlier [reviewer walkthrough](REVIEW.md) is preparation for this study.

## Recruit and arrange

Start with three people unfamiliar with Lolly, with room for two more if their experience adds something useful. Include someone who makes company content and knows their brand colours, plus someone who usually relies on supplied templates. Avoid using Lolly contributors as newcomer participants. These sessions identify problems; counts from this small group do not estimate all users' success rates.

Reserve 45–60 minutes per person. Use a participant ID such as P01 in notes. The facilitator can observe in person or through a screen share. Ask before recording or retaining a participant's files; written notes are enough. Use the synthetic material here.

Invitation draft for Andy to send:

> Would you help us try Lolly for 45–60 minutes? It makes design assets in a browser. We are looking for people who have not used it before, to see what is clear and what gets in the way. You will try a few tasks using a fictional company; no account or company files are needed. A laptop and a phone that can scan a QR image would help. You can skip tasks or stop at any time.

## Prepare the build and browser

The test link is <https://lolly.tools/>. Record the date, URL, browser version, viewport, app script URL/build identifier, and catalog version before each session. The release checked during preparation corresponds to PR #85, merge `55c09676a`. A later production deployment needs its own record; the public URL is not a pinned build.

Use a new regular browser profile, without sync, extensions, saved Lolly work or a private company pack. Do not use Incognito for close-and-reopen tasks: closing all private windows removes their storage. Keep the same regular profile for a persistence check. Leave the participant's everyday browser data alone.

Open the app only when the first task starts, so the welcome and cold-loading experience are included. Record slow previews as they happen. Do not dismiss prompts or seed brand settings for the participant.

Give the participant [the introduction](PARTICIPANT.md) and only the current task card. Keep the token/SVG files with the facilitator until task 2; task 4 starts with the name and two colours alone.

## Task order

Vary the first task to avoid teaching every newcomer the same route before observing brand setup. Mark only each person's first task as first-use discovery. A new profile resets data, not what the person has learned.

| Participant | First task | Then | If time permits |
| --- | --- | --- | --- |
| P01 | 1: useful QR file | 3: keep/reuse; 2: existing material | 4: known colours |
| P02 | 4: known colours | 3: keep/reuse; 2: existing material | 1: useful QR file |
| P03 | 2: existing material | 3: keep/reuse; 1: useful QR file | 4: known colours |
| P04, if recruited | 4: known colours | 3: keep/reuse; 2: existing material | 1: useful QR file |
| P05, if recruited | 1: useful QR file | 3: keep/reuse; 2: existing material | 4: known colours |

Task 3 continues with the creation and profile from the preceding task. Start tasks 1, 2 and 4 in separate fresh profiles when they occur later, and label them as learned use. For task 2, record the initial brand settings before import so recovery has a concrete comparison. If a preceding task produced no creation, offer `welcome.svg` for task 3 and mark that intervention.

## Observe without teaching

Read the task as written. Start timing when the participant first sees the app for it. Ask them to think aloud. Useful neutral prompts are “What are you expecting?” and “What would you try next?” Avoid naming controls or pointing to a route during an independent attempt.

If they ask for help or would normally abandon the task, record the point and ask whether they want a hint or to move on. Record exactly what help you give and its time. If a task takes about ten minutes without a result, offer the same choice; this is a session limit, not a product success target. Stop timing at a verified result, their decision to stop, or an interruption. Record interruptions separately rather than folding them into task time.

Use [SESSION-RECORD.md](SESSION-RECORD.md), copied once per participant, and put findings in [FINDINGS.md](FINDINGS.md). Keep participants' exact words separate from your interpretation.

## Verify the result

| Task | Completion evidence |
| --- | --- |
| 1 | Open the downloaded image outside Lolly and scan that file with another device. It must resolve to `https://example.org/welcome`. A correct preview alone is insufficient. |
| 2 | Open the downloaded file outside Lolly: headline is correct, text is readable and supplied colours are present. Compare the restored brand with the recorded initial settings and check the announcement remains. Record whether font substitution and the setup action were understood. |
| 3 | Same regular profile survives full browser close/reopen. Folder and creation can be found. The second saved creation has the change; reopening the first and inspecting the reusable template confirms they retain their original content. |
| 4 | Both exact supplied colours are stored and used as intended, rather than silently replaced by a generated accent. Downloaded output is usable. The same brand survives full browser close/reopen and can be used for another creation. Record when a font/logo need becomes apparent; do not introduce that requirement before observing the initial attempt. |

Use outcomes **Independent**, **With help**, **Blocked**, or **Not attempted**. Add partial results and the verification failure when needed. A participant saying “done” and a verified result are separate timestamps.

## Follow-up and synthesis

After the core tasks, ask what felt least predictable, what they would expect to find next time, and what would prevent using Lolly for real work. If relevant, ask where they would add their company's font. Give UI explanations only after recording the discovery attempt.

Run physical-phone, keyboard-only, large-text and warmed-offline checks as separate conditions. Do not mix their timings with desktop first use. Label absent checks as not run. Earlier Chromium touch emulation and the warmed QR regression do not substitute for external observations.

After each session, verify retained artifacts and write the smallest reproducible description of each issue. Rank blocked results and lost/overwritten work first, then wrong expectations, delays/confusion and cosmetic defects. Reproduce findings on the recorded build before changing code. At the end, report observed counts with denominators, route/help differences and limitations; retain the raw record behind each finding. Keep plan 248 open until external observations and their synthesis exist.
