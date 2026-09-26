import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluateTrust } from '../src/trust.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const fact = value => ({ value, evidence: 'Synthetic test observation.' });
const request = (check, facts) => ({
  check, intent: 'Evaluate this test scenario.',
  facts: Object.fromEntries(Object.entries(facts).map(([key, value]) => [key, fact(value)])),
});
const build = {
  buildProhibited: false, pipelineOwnsBuild: false, focusedBuild: true, capacityAvailable: true,
};
const edit = {
  editProhibited: false, failureObserved: true, expectedBehaviorEstablished: true,
  firstWrongBoundaryKnown: true, existingImplementationChecked: true,
};
const complete = {
  focusedVerificationPassed: true, persistenceProofRequired: false,
  finalDiffReviewed: true, limitationsReported: true,
};

for (const [name, check, facts, decision] of [
  ['A user build prohibition takes precedence over a running watcher', 'build',
    { ...build, buildProhibited: true, pipelineOwnsBuild: true }, 'BLOCK'],
  ['Spare capacity never permits a duplicate build', 'build',
    { ...build, pipelineOwnsBuild: true }, 'USE_EXISTING_PIPELINE'],
  ['A focused build with no competing owner and available capacity passes', 'build', build, 'ALLOW_FOCUSED_BUILD'],
  ['A broad standalone build needs a narrower plan', 'build', { ...build, focusedBuild: false }, 'REVISE_PLAN'],
  ['Insufficient capacity stops a standalone build', 'build', { ...build, capacityAvailable: false }, 'REVISE_PLAN'],
  ['A no-edit request overrides otherwise complete diagnosis', 'before-edit', { ...edit, editProhibited: true }, 'BLOCK'],
  ['Knowing symptoms does not establish the faulty layer', 'before-edit',
    { ...edit, firstWrongBoundaryKnown: false }, 'DIAGNOSE_FIRST'],
  ['A proven bug still requires checking existing implementations', 'before-edit',
    { ...edit, existingImplementationChecked: false }, 'SEARCH_EXISTING'],
  ['An established diagnosis passes the limited pre-edit checks', 'before-edit', edit, 'READY_FOR_NARROW_EDIT'],
  ['HTTP success cannot substitute for a required fresh read', 'complete',
    { ...complete, persistenceProofRequired: true, persistenceVerified: false }, 'NOT_READY'],
  ['A required but unknown persistence result is not success', 'complete',
    { ...complete, persistenceProofRequired: true }, 'NEED_EVIDENCE'],
  ['Successful persistence proof continues to final diff review', 'complete',
    { ...complete, persistenceProofRequired: true, persistenceVerified: true, finalDiffReviewed: false }, 'NOT_READY'],
  ['A stateless change needs no artificial persistence test', 'complete', complete, 'READY_TO_REPORT'],
  ['A stateful change with supplied evidence is ready for reporting', 'complete',
    { ...complete, persistenceProofRequired: true, persistenceVerified: true }, 'READY_TO_REPORT'],
  ['Failed verification cannot be hidden by declaring limitations', 'complete',
    { ...complete, focusedVerificationPassed: false }, 'NOT_READY'],
]) {
  test(name, () => {
    const input = request(check, facts);
    const original = structuredClone(input);
    const result = evaluateTrust(input);
    assert.equal(result.decision, decision);
    assert.equal(result.advisory, true);
    assert.ok(result.trace.length > 0);
    assert.ok(result.sources.every(source => source.startsWith('.agents/trust/')));
    assert.deepEqual(input, original);
  });
}

test('Absent, explicitly unknown and unsupported assertions all require evidence', () => {
  for (const entry of [undefined, { value: 'unknown' }, { value: false }, { value: false, evidence: '  ' }]) {
    const input = request('build', build);
    if (entry === undefined) delete input.facts.pipelineOwnsBuild;
    else input.facts.pipelineOwnsBuild = entry;
    const result = evaluateTrust(input);
    assert.equal(result.decision, 'NEED_EVIDENCE');
    assert.deepEqual(result.missing, ['pipelineOwnsBuild']);
    assert.equal(result.trace.at(-1).value, 'unknown');
  }
});

test('An early prohibition does not demand unrelated facts', () => {
  const result = evaluateTrust(request('build', { buildProhibited: true }));
  assert.equal(result.decision, 'BLOCK');
  assert.deepEqual(result.trace.map(step => step.fact), ['buildProhibited']);
});

test('Malformed inputs and misspelled facts never silently receive a decision', () => {
  for (const input of [
    null, [], { check: 'constructor' }, request(['build'], build), request('delete-database', {}),
    { ...request('build', build), intent: ' ' },
    { ...request('build', build), approval: true },
    request('build', { pipelineOwnsBuid: false }),
    request('build', { buildProhibited: 'false' }),
    { ...request('build', build), facts: { buildProhibited: { value: false, evidence: 42 } } },
  ]) assert.throws(() => evaluateTrust(input));
});

test('The CLI resolves the real sibling library independently of the working directory', () => {
  const run = spawnSync(process.execPath,
    [path.join(root, 'trust.mjs'), path.join(root, 'examples/build-running.json')],
    { cwd: tmpdir(), encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  const result = JSON.parse(run.stdout);
  assert.equal(result.decision, 'USE_EXISTING_PIPELINE');
  assert.match(result.sources[0].sha256, /^[a-f0-9]{64}$/);
});

test('Missing policy sources and malformed JSON produce an error, not an advisory success', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'myscoutee-trust-test-'));
  try {
    const malformed = path.join(directory, 'bad.json');
    writeFileSync(malformed, '{');
    for (const args of [
      [path.join(root, 'examples/build-running.json'), '--backend', directory],
      [malformed],
    ]) {
      const run = spawnSync(process.execPath, [path.join(root, 'trust.mjs'), ...args], { encoding: 'utf8' });
      assert.equal(run.status, 1);
      assert.equal(run.stdout, '');
      assert.equal(typeof JSON.parse(run.stderr).error, 'string');
    }
  } finally {
    rmSync(directory, { recursive: true });
  }
});
