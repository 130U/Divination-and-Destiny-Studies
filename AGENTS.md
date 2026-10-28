# Divination and Destiny Studies

Work only in this repository. The user's `130U/bazi-context-agent` is a read-only source of questionnaire design; do not modify or publish to it.

## Product boundary

- Require valid birth inputs, but keep all 27 background questions and both applicability questions optional. Normalize missing answers to unknown; never invent personal facts. Validate any supplied answers before model requests.
- Use the pinned Zhenyi local calendar core to calculate all eligible candidate charts. The calendar adapter must not call a model or access a key.
- AI is explicitly allowed to compare candidate charts against questionnaire evidence, recommend a provisional working chart, and provide subsequent context-aware analysis.
- A single candidate becomes a provisional working chart with selection_source=birth_input. With multiple candidates, weak evidence still permits a provisional selection and substantive conditional analysis; disclose model versus ranked_fallback selection.
- Model recommendations are not calibrated probabilities or independently proven birth times. Preserve contradictions, alternatives, and evidence limits. Report chart_only or context_supported mode honestly.
- Keep useful report text when citation metadata can be safely normalized, and expose reportWarnings. Reject candidate identity errors and missing essential report text; retain safe modelAttempt usage when a completed response fails business validation. Never automatically retry a paid request.
- Keep question definitions in `configs/question_bank.v1.json`. Do not hide scoring weights in prompts; this MVP uses evidence references and ordinal model recommendations, not numerical correctness probabilities.
- Support the authorized static online BYOK mode: charts, questionnaire, and workflow run in the browser; each visitor supplies their own DeepSeek key and calls only the official API directly after an explicit AI action. Do not route these requests through an author-funded backend.
- Keep browser keys only in the current tab's closure memory. Never persist them in localStorage, sessionStorage, URLs, logs, exports, or build output. Clear keys and sessions on reset and page departure; refreshing must not restore them. Node local mode continues to read its runner's key from the server environment.
- Keep personal sessions in memory. Never commit real user cases, private records, keys, or local environment files. Browser BYOK uses the visitor's account; a separately shared Node backend would use its operator's account. Do not imply multi-user account isolation exists. Display usage as one model call, not a cumulative bill.
- Retain upstream licenses, fixed revisions, and integrity manifests.
- Do not silently substitute mock results for a requested real model call.
- Use synthetic fixtures for automated tests; mark live checks separately. Run `npm run check` after changes and report limits honestly.
- Keep README focused on user outcomes and link installation details separately. Use actual UI captures, and verify the public HTTPS route and browser flow before claiming deployment acceptance. Keep historical local checks separate from current public-site checks.
- No unrelated divination systems, payments, accounts, or social features in this MVP.

## Completion

Report implemented behavior, changed areas, tests, actual model-call status, remaining limitations, and the new repository commit. Verify that the old repository stayed unchanged.
