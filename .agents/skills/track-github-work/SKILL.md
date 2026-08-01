---
name: track-github-work
description: Track ShopSmart repository work through GitHub Issues from intake and assignment to progress, review, and closure. Use for any task that will change tracked files, when starting or resuming issue work, reporting a blocker or status, handing work off for review, or recording completed implementation and verification. Do not use to create issues for read-only questions with no repository change.
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

## Hand Off for Review

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

Then replace the workflow label with `status:review`. If a pull request exists, ensure its body names the issue and uses `Closes #<number>` only when merge will fully satisfy the acceptance criteria. A local patch or unmerged branch is review-ready, not completed.

## Complete or Stop

Close with reason `completed` only after the implementation has landed and all acceptance criteria are satisfied. Remove workflow labels when closing.

- If work is cancelled, rejected, or superseded, record why and close as `not planned`.
- If another issue duplicates it, link the canonical issue before closing as `not planned`.
- If GitHub access fails, report the exact failure. Do not fabricate labels, assignments, comments, or closure. Continue offline only with explicit user authorization and reconcile GitHub before the next handoff.

## Report to the User

Always include the issue number and URL, current workflow state, what changed, verification actually executed, and anything still required before closure.
