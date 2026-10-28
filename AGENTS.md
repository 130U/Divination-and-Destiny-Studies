# Divination and Destiny Studies

Work only in this repository. The user's `130U/bazi-context-agent` is a read-only source of questionnaire design; do not modify or publish to it.

## Product boundary

- Collect all applicable questionnaire answers before any AI request.
- Use the pinned Zhenyi local calendar core to calculate all eligible candidate charts. The calendar adapter must not call a model or access a key.
- AI is explicitly allowed to compare candidate charts against questionnaire evidence, recommend a provisional working chart, and provide subsequent context-aware analysis.
- Model recommendations are not calibrated probabilities or independently proven birth times. Preserve contradictions, alternatives, and insufficient-evidence outcomes.
- Keep question definitions in `configs/question_bank.v1.json`. Do not hide scoring weights in prompts; this MVP uses evidence references and ordinal model recommendations, not numerical correctness probabilities.
- Keep keys server-side and personal sessions in memory. Never commit real user cases, private records, keys, or local environment files.
- Retain upstream licenses, fixed revisions, and integrity manifests.
- Do not silently substitute mock results for a requested real model call.
- Use synthetic fixtures for automated tests; mark live checks separately. Run `npm run check` after changes and report limits honestly.
- No unrelated divination systems, payments, accounts, or social features in this MVP.

## Completion

Report implemented behavior, changed areas, tests, actual model-call status, remaining limitations, and the new repository commit. Verify that the old repository stayed unchanged.
