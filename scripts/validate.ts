/**
 * Validates the policy repository. Runs in CI on every pull request; a policy
 * change cannot merge while this fails.
 */
import Ajv from 'ajv';
import { basename, dirname } from 'path';
import { ComponentCatalog, loadYaml, loadYamlDir, ownersOf, Policy, PolicyException, today, VerifierCatalog } from './lib';

const errors: string[] = [];
const warnings: string[] = [];
const err = (file: string, msg: string) => errors.push(`${file}: ${msg}`);
const warn = (file: string, msg: string) => warnings.push(`${file}: ${msg}`);
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);

const ajv = new Ajv({ allErrors: true, strict: false, validateFormats: false });
const checkPolicy = ajv.compile(loadYaml<object>('schema/policy.schema.json'));
const checkException = ajv.compile(loadYaml<object>('schema/exception.schema.json'));

const components = loadYaml<ComponentCatalog>('catalog/components.yaml');
const verifiers = loadYaml<VerifierCatalog>('catalog/verifiers.yaml');
const profile = loadYaml<{ authorities: string[] }>('profiles/payments-critical.yaml');
const knownComponents = new Set(Object.values(components.repositories).flatMap((r) => Object.keys(r.components)));

const policies = loadYamlDir<Policy>('policies');
const byId = new Map<string, Policy>();

for (const { file, doc: p } of policies) {
  if (!checkPolicy(p)) {
    for (const e of checkPolicy.errors ?? []) err(file, `${e.instancePath || '/'} ${e.message}`);
    continue;
  }
  if (byId.has(p.id)) err(file, `duplicate policy id ${p.id}`);
  byId.set(p.id, p);
  if (!basename(file).startsWith(p.id + '-')) err(file, `file name must start with "${p.id}-"`);
  if (basename(dirname(file)) !== p.authority) err(file, `policy with authority "${p.authority}" must live in policies/${p.authority}/`);

  // The owner field must match who GitHub will ask to approve changes to this file.
  const owners = ownersOf(file);
  if (!owners.includes(p.owner)) err(file, `owner ${p.owner} is not the CODEOWNER for this path (${owners.join(', ') || 'none'})`);

  for (const d of ['effective_from', 'review_by'] as const) if (!DATE.test(p[d])) err(file, `${d} must be YYYY-MM-DD`);
  if (p.status === 'approved') {
    if (p.review_by < today()) err(file, `review_by ${p.review_by} has passed: the owner must re-review this policy`);
    else if (daysBetween(today(), p.review_by) <= 30) warn(file, `review due by ${p.review_by}`);
  }

  for (const c of p.applies_to.components ?? []) if (!knownComponents.has(c)) err(file, `unknown component "${c}" (see catalog/components.yaml)`);
  if (!profile.authorities.includes(p.authority)) err(file, `authority "${p.authority}" is not in the payments-critical profile`);

  const seen = new Set<string>();
  for (const o of p.obligations) {
    if (!o.id.startsWith(p.id + '.')) err(file, `obligation ${o.id} must start with "${p.id}."`);
    if (seen.has(o.id)) err(file, `duplicate obligation ${o.id}`);
    seen.add(o.id);
    const v = verifiers.verifiers[o.evidence.verifier];
    if (!v) err(file, `${o.id}: unknown verifier ${o.evidence.verifier}`);
    else if (!v.checks[o.evidence.check]) err(file, `${o.id}: verifier ${o.evidence.verifier} has no check "${o.evidence.check}"`);
  }
  if (p.exceptions.allowed && p.exceptions.approver_authority !== p.authority)
    warn(file, `exceptions are approved by ${p.exceptions.approver_authority}, not the owning authority ${p.authority}`);
}

for (const { file, doc: x } of loadYamlDir<PolicyException>('exceptions')) {
  if (!checkException(x)) {
    for (const e of checkException.errors ?? []) err(file, `${e.instancePath || '/'} ${e.message}`);
    continue;
  }
  const p = byId.get(x.policy);
  if (!p) { err(file, `unknown policy ${x.policy}`); continue; }
  if (!p.exceptions.allowed) { err(file, `${p.id} does not allow exceptions`); continue; }
  if (basename(dirname(file)) !== p.exceptions.approver_authority) err(file, `exceptions to ${p.id} live in exceptions/${p.exceptions.approver_authority}/`);
  for (const o of x.obligations) if (!p.obligations.some((po) => po.id === o)) err(file, `${o} is not an obligation of ${p.id}`);
  if (!DATE.test(x.expires)) err(file, 'expires must be YYYY-MM-DD');
  else if (x.expires < today()) warn(file, `expired on ${x.expires}; QIVVRA ignores it`);
  if (x.granted && p.exceptions.max_days && daysBetween(x.granted, x.expires) > p.exceptions.max_days)
    err(file, `lasts ${daysBetween(x.granted, x.expires)} days; ${p.id} allows at most ${p.exceptions.max_days}`);
}

const obligationCount = [...byId.values()].reduce((n, p) => n + p.obligations.length, 0);
for (const w of warnings) console.log(`warning  ${w}`);
for (const e of errors) console.log(`error    ${e}`);
if (errors.length) {
  console.log(`\n${errors.length} error(s). Fix them before this change can merge.`);
  process.exit(1);
}
console.log(`OK: ${byId.size} policies, ${obligationCount} obligations, ${knownComponents.size} components, ${Object.keys(verifiers.verifiers).length} verifiers.`);
