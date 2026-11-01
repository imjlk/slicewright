import { deepStrictEqual, ok, strictEqual } from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const skillsDir = join(root, 'skills');

/** The top-level `key: value` lines of a SKILL.md frontmatter. */
function frontmatter(text: string): Map<string, string> {
  const block = /^---\n([\s\S]*?)\n---\n/u.exec(text.replaceAll('\r\n', '\n'))?.[1];
  ok(block !== undefined, 'SKILL.md starts with YAML frontmatter');
  const fields = new Map<string, string>();
  for (const line of block.split('\n')) {
    const field = /^([a-z-]+):\s*(.*)$/u.exec(line);
    if (field?.[1] !== undefined && field[2] !== undefined) {
      fields.set(field[1], field[2]);
    }
  }
  return fields;
}

const skillNames = (): string[] =>
  readdirSync(skillsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

/** Each skill follows the Agent Skills frontmatter rules and links only to files it ships. */
export function skillsFollowTheSpec(): void {
  deepStrictEqual(skillNames(), ['slicewright', 'slicewright-browser']);
  for (const name of skillNames()) {
    const path = join(skillsDir, name, 'SKILL.md');
    const text = readFileSync(path, 'utf8');
    const fields = frontmatter(text);
    strictEqual(fields.get('name'), name, `${name}: name matches its directory`);
    ok(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(name) && name.length <= 64, `${name}: valid name`);
    const description = fields.get('description') ?? '';
    ok(
      description.length > 0 && description.length <= 1024,
      `${name}: description is 1-1024 characters`,
    );
    const compatibility = fields.get('compatibility') ?? '';
    ok(compatibility.length > 0 && compatibility.length <= 500, `${name}: top-level compatibility`);
    for (const [, target = ''] of text.matchAll(/\]\(([^)#\s]+)(?:#[^)]*)?\)/gu)) {
      if (/^[a-z]+:/u.test(target)) {
        continue;
      }
      ok(existsSync(join(dirname(path), target)), `${name}: link ${target} exists`);
    }
  }
}

/** Art and browser guidance stay in their own skills. */
export function skillsStayScoped(): void {
  const art = readFileSync(join(skillsDir, 'slicewright', 'SKILL.md'), 'utf8');
  const browser = readFileSync(join(skillsDir, 'slicewright-browser', 'SKILL.md'), 'utf8');
  const artDescription = frontmatter(art).get('description') ?? '';
  const browserDescription = frontmatter(browser).get('description') ?? '';
  ok(
    !/playwright|browser/iu.test(artDescription),
    'the art skill description does not claim browser tasks',
  );
  for (const keyword of ['nine-slice', 'three-slice', 'button', 'panel', 'bar', 'frame']) {
    ok(artDescription.includes(keyword), `the art skill description names ${keyword}`);
  }
  ok(
    browserDescription.includes('slicewright/browser'),
    'the browser skill names slicewright/browser',
  );
  ok(
    browserDescription.includes('slicewright/playwright'),
    'the browser skill names slicewright/playwright',
  );
  ok(!existsSync(join(skillsDir, 'slicewright', 'references', 'browser-testing.md')));
}

/** The Claude Code marketplace offers every skill as its own plugin. */
export function marketplaceListsEverySkill(): void {
  const marketplace = JSON.parse(
    readFileSync(join(root, '.claude-plugin', 'marketplace.json'), 'utf8'),
  ) as {
    plugins: { name: string; source: string; skills: string[] }[];
  };
  deepStrictEqual(marketplace.plugins.map((plugin) => plugin.name).sort(), skillNames());
  for (const plugin of marketplace.plugins) {
    strictEqual(plugin.source, `./skills/${plugin.name}`);
    for (const skill of plugin.skills) {
      ok(
        existsSync(join(root, plugin.source, skill, 'SKILL.md')),
        `${plugin.name}: ${skill} has a SKILL.md`,
      );
    }
  }
}

void test('skills follow the Agent Skills spec', skillsFollowTheSpec);
void test('art and browser skills stay scoped', skillsStayScoped);
void test('marketplace lists every skill', marketplaceListsEverySkill);
