import assert from 'node:assert/strict';
import { Workflow } from '../src/workflow.ts';
import { getDeepSeekStatus } from '../src/deepseek.ts';
import { syntheticSubmission } from '../tests/fixtures.ts';

// Opt-in command. It performs two paid requests using only invented fixture data.
if (!getDeepSeekStatus().configured) {
  console.error('LIVE_NOT_RUN: configure DEEPSEEK_API_KEY in this process or the ignored local .env.');
  process.exitCode = 1;
} else {
  const workflow = new Workflow();
  const session = workflow.create(syntheticSubmission());
  try {
    const review = await workflow.review(session.id);
    assert.equal(review.cached, false);
    const selectedId = review.review.recommended_candidate_id ?? session.candidateSet.candidates[0]!.id;
    const analysis = await workflow.analyze(session.id, selectedId);
    assert.equal(analysis.analysis.selected_candidate_id, selectedId);
    const cached = await workflow.review(session.id); assert.equal(cached.cached, true);
    console.log(JSON.stringify({
      kind: 'synthetic_live_integration_check', predictiveAccuracyEvaluated: false,
      candidateCount: session.candidateSet.candidates.length, reviewStatus: review.review.status,
      workingChartSelection: review.review.recommended_candidate_id ? 'model_recommendation' : 'explicit_synthetic_test_selection',
      review: { model: review.model, usage: review.usage, durationMs: review.durationMs },
      analysis: { model: analysis.model, usage: analysis.usage, durationMs: analysis.durationMs },
      cachedRepeatAvoidedModelCall: cached.cached,
    }, null, 2));
  } finally { workflow.delete(session.id); }
}
