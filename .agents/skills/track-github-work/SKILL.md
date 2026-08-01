---
name: track-github-work
description: Track and land ShopSmart repository work through GitHub Issues from intake and assignment to progress, optional review, merge, and closure. Use for any task that will change tracked files, when starting or resuming issue work, publishing authorized changes, reporting a blocker or status, handing work off for explicitly required review, or recording completed implementation and verification. Do not use to create issues for read-only questions with no repository change.
---

# Track GitHub Work

## Overview

Use `topolar/shopsmart` GitHub Issues as the authoritative work queue and audit trail. Follow the repository `AGENTS.md`; this skill supplies the live GitHub workflow, not a replacement product plan.

## Resolve the Work Item

1. Read `AGENTS.md`, `README.md`, and the relevant `PLAN.md` section before changing behavior or architecture.
2. Resolve the repository from the local `origin` and verify it is `topolar/shopsmart`. Resolve the current branch or worktree.
3. Prefer the connected GitHub app for issue data and writes. Use authenticated `gh` when the connector is unavailable or cannot perform the operation.
4. Use an issue number or URL supplied by the user when its scope matches. Otherwise search open issues by distinctive request terms and inspect plausible matches.
5. If no matching issue exists and implementation is authorized, create exactly one issue using the structure of the appropriate repository form: task, bug, or decision. Include goal, acceptance criteria, non-goals or scope, dependencies or evidence, and only sanitized public information.
6. Before any GitHub write, state the exact repository, issue, labels, assignment, or comment target in a concise commentary update.

Do not create an issue for a read-only explanation or repository status request. Use the related existing issue when the read-only request concerns tracked work.

## Claim and Start

1. Inspect assignees and workflow labels. Do not claim work already assigned to another owner without explicit confirmation.
2. Assign the agreed owner. Use the authenticated user only when no different owner was requested.
3. Remove any other `status:*` workflow label and add `status:in-progress`.
4. Post one start comment containing the branch or worktree, concise plan, intended verification, and any assumption that affects acceptance.
5. Re-read the issue acceptance criteria immediately before editing files.

## Record Progress

Keep GitHub updates sparse and evidential.

- Comment when a finding changes the plan, scope, risk, or acceptance criteria. Update the issue body when its durable contract changes.
- For a blocker, replace the workflow label with `status:blocked` and comment with the blocking condition, evidence, attempted alternatives, and exact decision or dependency needed.
- When resuming, replace `status:blocked` or `status:ready` with `status:in-progress` and comment with what changed.
- Never paste secrets, tokens, cookies, private addresses, personal email addresses, production records, or unsanitized command output.
- Never claim a GitHub mutation or verification result without checking the returned state or command output.

## Record the Work Log

After implementing and running the required checks, post one work-log comment in this form:

```markdown
## Work log

Outcome: <what now works or changed>

Changed areas:
- <file, component, or contract>

Verification:
- `<exact command>` — <actual result>

Remaining risks or follow-ups:
- <item, or "None known">

Commit/PR: <link or "local working tree only">
```

Do not move the issue to `status:review` merely because the work is on a branch or pull request.

## Publish and Land Authorized Work

Treat an explicit request to commit and push, publish, land, merge, or finish completed repository work as authorization to carry the scoped change through the repository pull-request path unless the user says to leave it unmerged or requests review first. A pull request is a delivery mechanism; do not hand routine pull, ready, or merge operations back to the user.

1. Push the scoped branch and create or update a pull request that names the primary issue. Use `Closes #<number>` only when merge fully satisfies the acceptance criteria.
2. Make a complete pull request ready immediately. Use a draft only for unfinished work or when the user explicitly asks for a draft.
3. Inspect required checks, review requirements, conflicts, and mergeability. If checks exist, wait for them and investigate failures before merging.
4. When the pull request is mergeable, required checks pass, and no human approval is required, merge it using the repository's established strategy; use squash when no strategy is established.
5. Verify the resulting default-branch state, issue closure, labels, and follow-up dependencies. Do not claim completion from the merge command alone.

This repository rule supersedes generic draft-by-default publishing guidance.

## Hand Off for Human Review

Use `status:review` only when the user explicitly asks to review before merge, repository protection requires human approval, or a concrete product/security decision falls outside the agent's authority. Make the pull request ready, replace the workflow label with `status:review`, and comment with the exact review decision or action needed. Never tell the user to pull a pull request locally.

## Complete or Stop

Close with reason `completed` only after the implementation has landed and all acceptance criteria are satisfied. Remove workflow labels when closing. If a closing pull-request reference closes the issue automatically, still verify closure and remove any remaining `status:*` label.

- If work is cancelled, rejected, or superseded, record why and close as `not planned`.
- If another issue duplicates it, link the canonical issue before closing as `not planned`.
- If GitHub access fails, report the exact failure. Do not fabricate labels, assignments, comments, or closure. Continue offline only with explicit user authorization and reconcile GitHub before the next handoff.

## Report to the User

Always include the issue number and URL, current workflow state, what changed, verification actually executed, and anything still required before closure.
