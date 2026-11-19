import assert from 'node:assert/strict';
import { Workflow } from '../src/workflow.ts';
import { createDeepSeekClient, DEFAULT_DEEPSEEK_THINKING, DeepSeekError, getDeepSeekStatus, type DeepSeekResult } from '../src/deepseek.ts';
import { AppError } from '../src/runtime.ts';
import { syntheticSubmission } from '../tests/fixtures.ts';

// Opt-in command. It performs at most two paid requests using only invented fixture data.
if (!getDeepSeekStatus().configured) {
  console.error('LIVE_NOT_RUN: configure DEEPSEEK_API_KEY in this process or the ignored local .env.');
  process.exitCode = 1;
} else {
  const client = createDeepSeekClient();
  const completedStages: string[] = [];
  let attemptedRequests = 0;
  const responses: Array<{ stage: string; model: string; providerModel?: string; usage: DeepSeekResult['usage']; durationMs: number }> = [];
  const thinking = process.env.DEEPSEEK_THINKING ?? DEFAULT_DEEPSEEK_THINKING;
  const workflow = new Workflow({ client: { completeJson: async request => {
    if (attemptedRequests >= 2) throw new AppError('LIVE_REQUEST_LIMIT', 'Live check allows at most two provider requests.');
    attemptedRequests++;
    const stage = (request.payload as { task: string }).task;
    const result = await client.completeJson(request);
    const trace = { stage, model: result.model, ...(result.providerModel ? { providerModel: result.providerModel } : {}), usage: result.usage, durationMs: result.durationMs };
    responses.push(trace);
    console.log(JSON.stringify({ event: 'provider_response_received', thinking, ...trace }));
    return result;
  } } });
  try {
    const submission = syntheticSubmission();
    const { startTime: _start, endTime: _end, ...exactBirth } = submission.birth;
    const birth = process.argv.includes('--single-candidate')
      ? { ...exactBirth, timeMode: 'exact', time: '09:30' }
      : submission.birth;
    const birthOnly = process.argv.includes('--birth-only');
    const session = workflow.create(birthOnly ? { birth } : { ...submission, birth });
    const review = await workflow.review(session.id);
    assert.equal(review.cached, false);
    completedStages.push('review');
    const selectedId = review.review.recommended_candidate_id ?? session.candidateSet.candidates[0]!.id;
    const analysis = await workflow.analyze(session.id, selectedId);
    assert.equal(analysis.analysis.selected_candidate_id, selectedId);
    completedStages.push('analysis');
    const cached = await workflow.review(session.id); assert.equal(cached.cached, true);
    const cachedAnalysis = await workflow.analyze(session.id, selectedId); assert.equal(cachedAnalysis.cached, true);
    assert.equal(responses.length, 2);
    console.log(JSON.stringify({
      kind: 'synthetic_live_integration_check', status: 'passed', predictiveAccuracyEvaluated: false,
      candidateCount: session.candidateSet.candidates.length, reviewStatus: review.review.status,
      workingChartSelection: review.review.selection_source, birthOnly,
      evidenceMode: analysis.analysis.evidence_mode, sectionCount: analysis.analysis.sections.length,
      reportWarnings: [...(review.review.reportWarnings ?? []), ...(analysis.analysis.reportWarnings ?? [])],
      thinking, attemptedRequests, completedStages, responses,
      cachedRepeatsAvoidedModelCalls: cached.cached && cachedAnalysis.cached,
    }, null, 2));
  } catch (error) {
    console.error(JSON.stringify({
      kind: 'synthetic_live_integration_check', status: 'failed', thinking, attemptedRequests, completedStages, responses,
      errorCode: error instanceof DeepSeekError || error instanceof AppError ? error.code : 'LIVE_ASSERTION_FAILED',
      predictiveAccuracyEvaluated: false,
    }, null, 2));
    process.exitCode = 1;
  } finally { workflow.dispose(); }
}
