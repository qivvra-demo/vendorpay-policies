import { createHash } from 'crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';
import { parse } from 'yaml';

export const ROOT = join(__dirname, '..');

export interface Obligation { id: string; statement: string; evidence: { verifier: string; check: string } }
export interface Policy {
  id: string; title: string; version: string; status: 'draft' | 'approved' | 'retired';
  authority: string; owner: string; severity: string;
  applies_to: { components?: string[]; always?: true };
  rule: string; obligations: Obligation[];
  on_violated: string; on_insufficient: string;
  exceptions: { allowed: boolean; approver_authority?: string; max_days?: number; requires?: string[] };
  effective_from: string; review_by: string;
}
export interface PolicyException {
  id: string; policy: string; obligations: string[]; scope: { repository: string; jira: string };
  reason: string; compensating_control: string; approved_by: string; granted?: string; expires: string;
}
export interface Loaded<T> { file: string; raw: string; doc: T }

function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

export function loadYamlDir<T>(dir: string): Loaded<T>[] {
  return walk(join(ROOT, dir))
    .filter((f) => /\.ya?ml$/.test(f) && !/\/_template\.ya?ml$/.test(f))
    .sort()
    .map((f) => {
      const raw = readFileSync(f, 'utf8');
      return { file: relative(ROOT, f), raw, doc: parse(raw) as T };
    });
}

export const loadYaml = <T>(file: string): T => parse(readFileSync(join(ROOT, file), 'utf8')) as T;

export interface ComponentCatalog {
  repositories: Record<string, { github: string; jira_project: string; profile: string; components: Record<string, { description: string; paths: string[] }> }>;
}
export interface VerifierCatalog { verifiers: Record<string, { name: string; checks: Record<string, string> }> }

export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

/** Parses CODEOWNERS into [pattern, owners] pairs; the last matching line wins, as on GitHub. */
export function codeowners(): Array<[string, string[]]> {
  return readFileSync(join(ROOT, 'CODEOWNERS'), 'utf8').split('\n')
    .map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))
    .map((l) => { const [pattern, ...owners] = l.split(/\s+/); return [pattern, owners]; });
}
export function ownersOf(file: string): string[] {
  let owners: string[] = [];
  for (const [pattern, o] of codeowners()) {
    if (pattern === '*' || ('/' + file).startsWith(pattern)) owners = o;
  }
  return owners;
}

export const today = () => new Date().toISOString().slice(0, 10);
