/**
 * Shows which policies and obligations QIVVRA would assure a change against.
 *
 *   npm run select -- --repo vendorpay --paths src/routes/bankChanges.ts,public/app.js
 *   npm run select -- --repo vendorpay --repo-dir ../vendorpay-app --range main...feature/VP-184-bank-change --jira VP-184
 *   add --json for machine-readable output (the same shape QIVVRA freezes as its policy snapshot)
 */
import { execFileSync } from 'child_process';
import picomatch from 'picomatch';
import { ComponentCatalog, loadYaml, loadYamlDir, Policy, PolicyException, ROOT, sha256, today } from './lib';

const args = process.argv.slice(2);
const opt = (name: string) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
const repo = opt('repo') ?? 'vendorpay';
const jira = opt('jira');

let paths: string[];
if (opt('paths')) paths = opt('paths')!.split(',').map((s) => s.trim()).filter(Boolean);
else if (opt('repo-dir') && opt('range'))
  paths = execFileSync('git', ['-C', opt('repo-dir')!, 'diff', '--name-only', opt('range')!], { encoding: 'utf8' }).split('\n').filter(Boolean);
else {
  console.error('Give --paths a,b,c  or  --repo-dir <dir> --range <base...head>');
  process.exit(2);
}

const catalog = loadYaml<ComponentCatalog>('catalog/components.yaml').repositories[repo];
if (!catalog) { console.error(`Unknown repository "${repo}" in catalog/components.yaml`); process.exit(2); }

// Files → components
const hits = new Map<string, string[]>();
for (const [name, c] of Object.entries(catalog.components)) {
  const isMatch = picomatch(c.paths, { dot: true });
  const matched = paths.filter((p) => isMatch(p));
  if (matched.length) hits.set(name, matched);
}
const unmapped = paths.filter((p) => ![...hits.values()].some((m) => m.includes(p)));

// Components → approved policies (plus policies that always apply)
const policies = loadYamlDir<Policy>('policies').filter(({ doc }) => doc.status === 'approved' && doc.effective_from <= today());
const selected = policies.filter(({ doc }) => doc.applies_to.always || doc.applies_to.components?.some((c) => hits.has(c)));

// Active exceptions for this change
const exceptions = loadYamlDir<PolicyException>('exceptions')
  .filter(({ doc }) => doc.scope.repository === repo && (!jira || doc.scope.jira === jira) && doc.expires >= today());

let policyCommit: string | null = null;
try { policyCommit = execFileSync('git', ['-C', ROOT, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { /* not a git checkout */ }

const snapshot = {
  repository: repo,
  github: catalog.github,
  jira: jira ?? null,
  profile: catalog.profile,
  policyRepoCommit: policyCommit,
  changedFiles: paths,
  components: Object.fromEntries(hits),
  unmappedFiles: unmapped,
  policies: selected.map(({ file, raw, doc }) => ({
    id: doc.id, version: doc.version, authority: doc.authority, owner: doc.owner, severity: doc.severity,
    file, digest: 'sha256:' + sha256(raw),
    obligations: doc.obligations.map((o) => ({ id: o.id, statement: o.statement, verifier: o.evidence.verifier, check: o.evidence.check })),
  })),
  exceptions: exceptions.map(({ file, doc }) => ({ id: doc.id, policy: doc.policy, obligations: doc.obligations, expires: doc.expires, file })),
};
const snapshotDigest = 'sha256:' + sha256(JSON.stringify(snapshot));

if (args.includes('--json')) {
  console.log(JSON.stringify({ ...snapshot, snapshotDigest }, null, 2));
} else {
  console.log(`Change in ${repo}${jira ? ` (${jira})` : ''}: ${paths.length} file(s), profile ${catalog.profile}\n`);
  console.log('Components touched');
  for (const [c, files] of hits) console.log(`  ${c.padEnd(24)} ${files.join(', ')}`);
  if (unmapped.length) console.log(`  (not mapped to a component: ${unmapped.join(', ')})`);
  console.log('\nPolicies selected');
  for (const p of snapshot.policies) {
    console.log(`  ${p.id} v${p.version}  [${p.authority}, ${p.severity}]  ${selected.find((s) => s.doc.id === p.id)!.doc.title}`);
    for (const o of p.obligations) console.log(`      ${o.id.padEnd(10)} ${o.verifier}/${o.check}`);
  }
  console.log(`\nExceptions in force: ${snapshot.exceptions.length ? snapshot.exceptions.map((x) => `${x.id} (${x.policy}, until ${x.expires})`).join(', ') : 'none'}`);
  console.log(`Obligations to assure: ${snapshot.policies.reduce((n, p) => n + p.obligations.length, 0)}`);
  console.log(`Snapshot ${snapshotDigest.slice(0, 19)}…  policy repo ${policyCommit ?? '(uncommitted)'}`);
}
