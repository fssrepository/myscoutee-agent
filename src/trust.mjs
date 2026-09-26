// A few explicit branches from the backend trust library, not a general policy engine.
const kernel = '.agents/trust/kernel.md';
const bugfix = '.agents/trust/reviews/bugfix.md';
const search = '.agents/trust/habits/search-before-create.md';
const completion = '.agents/trust/reviews/completion.md';

// Each step: required fact, expected value, result on mismatch, explanation, next step, source.
const checks = {
  build: {
    steps: [
      ['buildProhibited', false, 'BLOCK', 'The user prohibited builds.',
        'Respect the prohibition and continue the permitted investigation.', kernel],
      ['pipelineOwnsBuild', false, 'USE_EXISTING_PIPELINE', 'The running pipeline already owns this build.',
        'Trigger the existing pipeline and inspect its logs.', kernel],
      ['focusedBuild', true, 'REVISE_PLAN', 'The standalone build is not narrowly scoped.',
        'Narrow verification to the affected unit.', kernel],
      ['capacityAvailable', true, 'REVISE_PLAN', 'Available capacity for the standalone run has not been established.',
        'Inspect resource availability before starting a standalone build.', kernel],
    ],
    success: ['ALLOW_FOCUSED_BUILD', 'The checked prerequisites for a standalone build are satisfied.',
      'Run the focused verification within scope and record the result.'],
  },
  'before-edit': {
    steps: [
      ['editProhibited', false, 'BLOCK', 'The user prohibited edits.',
        'Continue the permitted diagnosis without editing.', kernel],
      ['failureObserved', true, 'DIAGNOSE_FIRST', 'The failure is not supported by a concrete observation.',
        'Reproduce the failure or collect concrete current-state evidence.', bugfix],
      ['expectedBehaviorEstablished', true, 'DIAGNOSE_FIRST', 'The expected behavior has not been established.',
        'Establish the expected behavior from the current request or a canonical source.', bugfix],
      ['firstWrongBoundaryKnown', true, 'DIAGNOSE_FIRST', 'The first incorrect boundary is not yet known.',
        'Distinguish data, product code, test, harness and environment failures.', bugfix],
      ['existingImplementationChecked', true, 'SEARCH_EXISTING', 'Existing implementations have not been inspected.',
        'Find the existing owner and the closest implementations.', search],
    ],
    success: ['READY_FOR_NARROW_EDIT', 'The checked prerequisites for the bug fix are satisfied.',
      'Repair the proven incorrect boundary within the requested scope.'],
  },
  complete: {
    steps: [
      ['focusedVerificationPassed', true, 'NOT_READY', 'Successful focused verification is missing.',
        'Verify the requested behavior or report the actual blocker.', completion],
      ['persistenceProofRequired', false, 'CHECK_PERSISTENCE', '', '', bugfix],
      ['finalDiffReviewed', true, 'NOT_READY', 'The final diff has not been reviewed.',
        'Review change scope and preservation of pre-existing user changes.', completion],
      ['limitationsReported', true, 'NOT_READY', 'Verification limitations have not been recorded.',
        'Record passed, failed, not-run and not-proven outcomes.', completion],
    ],
    success: ['READY_TO_REPORT', 'The reporting prerequisites checked by this prototype are satisfied.',
      'Prepare an accurate report of the evidence and remaining limitations.'],
  },
};

const persistenceStep = ['persistenceVerified', true, 'NOT_READY',
  'Persistence is not verified; HTTP 200 alone is insufficient.',
  'Verify the actual save and a fresh read or reopen.', bugfix];

function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function validate(request) {
  if (!object(request) || typeof request.check !== 'string' || !Object.hasOwn(checks, request.check)) {
    throw new Error('check must be build | before-edit | complete.');
  }
  if (Object.keys(request).some(key => !['check', 'intent', 'facts'].includes(key))) {
    throw new Error('Unknown request field. Allowed fields: check, intent, facts.');
  }
  if (typeof request.intent !== 'string' || !request.intent.trim() || !object(request.facts)) {
    throw new Error('A non-empty intent string and a facts object are required.');
  }
  const allowed = new Set(checks[request.check].steps.map(step => step[0]));
  if (request.check === 'complete') allowed.add('persistenceVerified');
  for (const [name, fact] of Object.entries(request.facts)) {
    if (!allowed.has(name)) throw new Error(`Unknown fact: ${name}`);
    if (!object(fact) || ![true, false, 'unknown'].includes(fact.value)
        || Object.keys(fact).some(key => !['value', 'evidence'].includes(key))
        || (fact.evidence !== undefined && typeof fact.evidence !== 'string')) {
      throw new Error(`Invalid fact: ${name}; value: boolean | "unknown", evidence: string.`);
    }
  }
}

export function evaluateTrust(request) {
  validate(request);
  const trace = [];
  const sources = new Set();
  const result = (decision, reason, next, missing = []) => ({
    advisory: true, check: request.check, decision, reason, next, missing,
    trace, sources: [...sources],
  });

  function visit(step) {
    const [name, expected, decision, reason, next, source] = step;
    sources.add(source);
    const fact = request.facts[name];
    const known = fact && fact.value !== 'unknown' && Boolean(fact.evidence?.trim());
    trace.push({ fact: name, value: known ? fact.value : 'unknown', source });
    if (!known) return result('NEED_EVIDENCE', `Missing or unsupported fact: ${name}.`,
      'Collect concrete evidence for this fact, then evaluate again.', [name]);
    if (fact.value === expected) return null;
    if (decision === 'CHECK_PERSISTENCE') return visit(persistenceStep);
    return result(decision, reason, next);
  }

  for (const step of checks[request.check].steps) {
    const stopped = visit(step);
    if (stopped) return stopped;
  }
  return result(...checks[request.check].success);
}
