/**
 * Guards the GitHub Actions workflows against a failure mode this repo actually
 * hit. `ticktick-sync` depended on `gautamkrishnar/keepalive-workflow`; GitHub
 * Staff disabled that repository for a terms-of-service violation, and from then
 * on every scheduled run died at "Getting action download info" with
 * "Repository access blocked". The sync job itself kept succeeding, so the run
 * was red while the thing it existed to do was green — the worst possible state
 * for a cron whose only signal is its own pass/fail.
 *
 * A third-party action is a standing dependency on someone else's repository
 * staying online and staying in GitHub's good graces. These workflows only poll
 * a URL on a timer and push the occasional empty commit, so they have no reason
 * to reach outside the first-party `actions/` org.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const WORKFLOW_DIR = join(process.cwd(), '.github', 'workflows');

function workflowFiles(): string[] {
  return readdirSync(WORKFLOW_DIR).filter((file) => /\.ya?ml$/.test(file));
}

/** Every `uses:` reference in a workflow, skipping commented-out lines. */
function actionRefs(source: string): string[] {
  return source
    .split('\n')
    .filter((line) => !line.trim().startsWith('#'))
    .map((line) => /^\s*-?\s*uses:\s*['"]?([^'"\s]+)/.exec(line)?.[1])
    .filter((ref): ref is string => Boolean(ref));
}

describe('GitHub Actions workflows', () => {
  it('finds workflow files to inspect', () => {
    expect(workflowFiles().length).toBeGreaterThan(0);
  });

  it.each(workflowFiles())('%s uses only first-party actions/* actions', (file) => {
    const refs = actionRefs(readFileSync(join(WORKFLOW_DIR, file), 'utf8'));
    expect(refs.filter((ref) => !ref.startsWith('actions/'))).toEqual([]);
  });

  it.each(workflowFiles())('%s pins every action to a version', (file) => {
    const refs = actionRefs(readFileSync(join(WORKFLOW_DIR, file), 'utf8'));
    expect(refs.filter((ref) => !ref.includes('@'))).toEqual([]);
  });
});
