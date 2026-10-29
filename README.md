# vendorpay-policies

The rules every VendorPay change must meet, written as code. QIVVRA reads this repository to decide **what** to assure a change against. The Jira story says what the team meant to build; this repository says what the business requires, whatever the story says.

A rule here is authoritative because of **who approved it**, not who wrote it. Finance owns the finance rules, Security owns the security rules, and so on. GitHub enforces that through `CODEOWNERS` and "Require review from Code Owners".

## Layout

```
policies/
  finance/      FIN-001 second person for bank changes
                FIN-002 hold scheduled payments on bank change
                FIN-003 second person for payment release
  security/     SEC-001 bank account numbers always masked
  compliance/   CMP-001 audit trail for every change
  platform/     PLT-001 evidence comes from the exact commit under review
catalog/
  components.yaml   code paths → components, per repository
  verifiers.yaml    QIVVRA's verifiers (V1–V5) and the checks each provides
profiles/
  payments-critical.yaml   how obligation states become a disposition
exceptions/       time-boxed waivers, approved by the owning authority
schema/           JSON Schemas for policies and exceptions
scripts/          validate and select
CODEOWNERS        who must approve changes to each folder
```

## Anatomy of a policy

```yaml
id: FIN-001
title: A bank account change needs a second person
status: approved            # draft | approved | retired; only approved rules are used
authority: finance          # must match the folder
owner: "@vendorpay/finance-controls"   # must match CODEOWNERS for the folder
severity: critical
applies_to:
  components: [supplier-bank-accounts] # or: always: true
rule: >
  A change to a supplier's bank account takes effect only after a person
  other than the requester approves it.
obligations:                # what QIVVRA checks, one verdict each
  - id: FIN-001.1
    statement: The person who requested a bank account change cannot approve it.
    evidence: { verifier: V2, check: bank-change-self-approval-blocked }
on_violated: block
on_insufficient: block
exceptions:
  allowed: false
review_by: 2027-06-30       # validation fails after this date until the owner re-reviews
```

Each obligation gets one state from QIVVRA: SUPPORTED, VIOLATED, INSUFFICIENT, CONFLICTED or NOT ASSESSED. The profile turns those states into the disposition shown on the pull request.

## How QIVVRA uses it

1. A VendorPay PR changes some files.
2. `catalog/components.yaml` maps those files to components.
3. Every approved policy for those components, plus every `always: true` policy, is selected.
4. The selection, with each policy file's SHA-256 digest and this repository's commit, is frozen as the **policy snapshot** for that assessment. Later edits here never change a past verdict.
5. Each obligation names the verifier check that produces its evidence.
6. Active exceptions for the PR's Jira key can turn an INSUFFICIENT into READY WITH EXCEPTIONS. They can never do that for a VIOLATED.

Try it against the VP-184 branch of the app:

```bash
npm install
npm run validate
npm run select -- --repo vendorpay --repo-dir ../vendorpay-app \
  --range main...feature/VP-184-bank-change --jira VP-184
# add --json to see the snapshot QIVVRA stores
```

For PR #482 this selects 6 policies and 14 obligations. The two that matter:

| Obligation | Commit 1 (8cafa75) | Commit 2 (88b666a) |
|---|---|---|
| FIN-001.1 Requester cannot approve | VIOLATED | SUPPORTED |
| FIN-002.1 Scheduled payments held after a bank change | INSUFFICIENT | INSUFFICIENT |

VP-184's acceptance criteria mention neither rule. That gap between the story and the policy is what QIVVRA exists to catch.

## Changing a rule

1. Branch, edit or add the YAML, and bump `version`.
2. Open a PR. CI runs `npm run validate`.
3. The owning authority approves (CODEOWNERS). Without that approval the PR cannot merge, so the rule does not exist yet.
4. After merge, new assessments use the new version. Old assessments keep their snapshot.

## Exceptions

Copy `exceptions/_template.yaml` to `exceptions/<authority>/EXC-<n>.yaml`. The validator refuses exceptions to policies that allow none (FIN-001, FIN-003, SEC-001, PLT-001), exceptions longer than the policy's `max_days`, and exceptions filed under the wrong authority's folder.

Example: Finance could grant a 14-day exception to FIN-002 for VP-184 if they review scheduled payments by hand meanwhile. PR #482 commit 2 would then be READY WITH EXCEPTIONS instead of NOT READY.

## Repository settings

- Protect `main`: require a PR, the "Validate policies" check, and review from Code Owners.
- Create the teams named in `CODEOWNERS` (`finance-controls`, `security`, `compliance`, `platform-eng`, `qivvra-assurance-leads`).
- Give QIVVRA's GitHub App read access to this repository only.
