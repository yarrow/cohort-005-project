# Pause course access while a Refund Request is open

A learner loses access to a course the moment they open a Refund Request, not when a Platform Admin approves it. Eligibility (the Refund Window, under half the lessons completed, under two hours watched) is judged only when the request is made, so if the learner kept watching while the request waited, a Platform Admin could end up approving a request that no longer meets the rules. Pausing access freezes their progress at the point they asked, so what the Platform Admin sees is what the learner was eligible on.

## Considered Options

- **Cut access on approval.** Kinder to learners whose request is later declined, but leaves the request window open for consuming the course, and forces a choice between re-checking eligibility at decision time or approving requests that have since gone over the limits.
- **Cut access when the Refund is Issued.** Ties access to the money flow, which is a separate concern and can fail or lag without the decision changing.

## Consequences

- Access is paused by the access check refusing content while an Open Refund Request exists; the enrollment itself is only removed on approval. A Declined Refund Request restores access with progress intact.
- Because nothing can change while the request is open, a Platform Admin may approve after the Refund Window has closed.
- Learners cannot withdraw an open request to regain access; they wait for a decision.
