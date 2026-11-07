# PaisaTrail

**Find bank charges on your savings account that conflict with RBI rules, and get them reversed.**

[![Test & deploy](https://github.com/Chickoo123/paisatrail/actions/workflows/ci.yml/badge.svg)](https://github.com/Chickoo123/paisatrail/actions/workflows/ci.yml)
[![CodeQL](https://github.com/Chickoo123/paisatrail/actions/workflows/codeql.yml/badge.svg)](https://github.com/Chickoo123/paisatrail/actions/workflows/codeql.yml)
![Runtime dependencies: 0](https://img.shields.io/badge/runtime%20dependencies-0-0d5c4a)

**[Try it with the sample statement →](https://chickoo123.github.io/paisatrail/?demo)** · [Use your own statement](https://chickoo123.github.io/paisatrail/)

<img src="docs/dashboard.png" alt="PaisaTrail showing ₹545 of reversible charges in a sample statement, with the evidence line and RBI rule for a minimum-balance penalty that pushed the balance below zero" width="860">

## The problem

Indian banks deduct a steady trickle of small charges from savings accounts: minimum-balance penalties, ATM fees, SMS charges, NEFT fees, debit-card fees, usually with 18% GST on top. Each one is small enough to ignore, and buried among dozens of UPI lines.

RBI has rules about many of them, for example:

- A minimum-balance penalty must be **proportionate to the shortfall**, preceded by **notice**, and must **never push the balance below zero** (RBI, Nov 2014).
- ATM charges apply only **beyond the free monthly limit**, and are **capped at ₹23** per transaction from 1 May 2025.
- **Online NEFT** from a savings account has been **free** since 1 Jan 2020.
- **Basic Savings Bank Deposit (BSBD) accounts** have no minimum balance and must get free withdrawals, a free debit card and a free cheque book.

To use these rules you have to find the charges, pair them with their GST lines, count ATM withdrawals per month, read the running balance, and know which circular applies. Almost nobody does all that. PaisaTrail does it in a few seconds.

## What PaisaTrail does

1. **Reads real statement exports.** It finds the header row under bank preambles, Indian date formats, ₹ lakh grouping, debit/credit or amount + Dr/Cr columns, and the running balance.
2. **Finds charges** from their narrations (`NON MAINTENANCE OF AMB CHGS`, `ATM CHGS`, `SMS CHGS`, `NEFT CHGS INB`…) and **pairs each GST line** with the charge it was levied on.
3. **Checks each charge against a specific RBI rule**, using only what the statement proves:

   | Finding | Status | Rule |
   |---|---|---|
   | Minimum-balance penalty that took the balance below zero (the negative part, plus its GST) | Ask to reverse | Min-balance circular, 2014 |
   | Minimum-balance penalty on a BSBD or zero-balance account | Ask to reverse | BSBDA instructions |
   | Any other minimum-balance penalty (notice and proportionality aren't visible in a statement) | Confirm | Min-balance circular |
   | ATM charge in a month with 3 or fewer ATM withdrawals | Ask to reverse | ATM charges circular |
   | ATM charge above ₹23 from 1 May 2025 | Ask to reverse (excess) | ATM charges circular |
   | NEFT charge marked as online / channel unknown | Ask to reverse / Confirm | NEFT waiver, 2019 |
   | Debit-card or cheque-book fee on a BSBD account | Ask to reverse | BSBDA instructions |
   | The same periodic charge twice in a month | Ask to reverse | (arithmetic) |
   | PMSBY / PMJJBY / APY auto-debit | Good to know | Confirm you enrolled |

4. **Shows its evidence.** Each finding lists the exact statement lines, the charge and GST, and the amount claimed, with the rule linked. An "Every charge found" table lets you catch anything it missed.
5. **Drafts the request** to your bank with every line itemised and the 30-day route to the RBI Ombudsman.

## Design decisions

- **It only claims what the statement proves.** "This penalty pushed your balance to −₹419.50" is provable, so it's *Ask to reverse*. "The bank didn't notify you first" isn't, so it's *Confirm*.
- **The stronger claim wins.** An ATM charge in a month with only two withdrawals is disputed in full, not just the ₹2 above the cap.
- **No double counting.** A charge disputed under one rule is never claimed again as a duplicate. A test covers this.
- **Your statement never leaves the tab.** A strict CSP (`connect-src 'none'`) blocks every network request, and nothing is stored.
- **What was cut.** Version 1 was a generic spend dashboard, which plenty of apps already provide. Version 2 keeps the hard part, the Indian statement parser, and points it at a problem nobody else solves.

## Limits

PaisaTrail can't see your bank's schedule of charges, can't tell your own bank's ATMs from others' unless the narration says so, and may miss charges with unusual narrations. It isn't legal advice. Each source in [`src/rules.js`](src/rules.js) has a last-checked date and links to the official RBI page. RBI updated the BSBDA framework in December 2025, so check the current text.

## Engineering

- `src/statement.js`: a statement reader (CSV, dates, amounts, column and balance detection).
- `src/charges.js`: charge classification, GST pairing and rule checks, plus the dispute letter. It's pure, with no DOM access.
- `src/rules.js`: the citation registry. A test checks that every rule links to an official RBI page.
- 13 `node:test` suites, covering the parser, the classifier (including false-positive guards such as "COFFEE" and UPI payments), each rule with a counter-case, GST pairing, no double counting, and an end-to-end run on a synthetic statement.
- Zero runtime dependencies, keyboard-accessible, works on phones. CI runs on Node 20 and 22, with CodeQL and Pages deploy.

```bash
npm test
npm run serve
```

## Related

[LoanLens](https://github.com/Chickoo123/loanlens) checks loan offers (the KFS, APR and RBI's fair-lending rules) the same way.

---

Built by [Harshil Desai](https://github.com/Chickoo123). Not affiliated with RBI or any bank. Not legal or financial advice. The sample statement is synthetic.
