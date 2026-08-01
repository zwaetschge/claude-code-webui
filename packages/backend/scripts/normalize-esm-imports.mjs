import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import ts from 'typescript';

const backendRoot = path.resolve(new URL('..', import.meta.url).pathname);
const sourceRoot = path.join(backendRoot, 'src');
const checkOnly = process.argv.includes('--check');
const sourceExtensions = ['.ts', '.tsx', '.mts', '.cts'];

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) return walk(absolutePath);
    return sourceExtensions.includes(path.extname(entry.name)) ? [absolutePath] : [];
  });
}

function resolvedSpecifier(filePath, specifier) {
  if (!specifier.startsWith('.') || path.extname(specifier)) return specifier;

  const target = path.resolve(path.dirname(filePath), specifier);
  if (sourceExtensions.some((extension) => fs.existsSync(`${target}${extension}`))) {
    return `${specifier}.js`;
  }
  if (sourceExtensions.some((extension) => fs.existsSync(path.join(target, `index${extension}`)))) {
    return `${specifier.replace(/\/$/, '')}/index.js`;
  }

  throw new Error(`Cannot resolve relative module '${specifier}' from ${filePath}`);
}

function moduleSpecifiers(sourceFile) {
  const nodes = [];
  const visit = (node) => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      nodes.push(node.moduleSpecifier);
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length === 1 &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      nodes.push(node.arguments[0]);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return nodes;
}

let changedFiles = 0;
let changedSpecifiers = 0;

for (const filePath of walk(sourceRoot)) {
  const input = fs.readFileSync(filePath, 'utf8');
  const sourceFile = ts.createSourceFile(
    filePath,
    input,
    ts.ScriptTarget.Latest,
    true,
    filePath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  );
  const replacements = [];

  for (const node of moduleSpecifiers(sourceFile)) {
    const next = resolvedSpecifier(filePath, node.text);
    if (next === node.text) continue;
    replacements.push({ start: node.getStart(sourceFile) + 1, end: node.getEnd() - 1, next });
  }

  if (replacements.length === 0) continue;
  changedFiles += 1;
  changedSpecifiers += replacements.length;
  if (checkOnly) continue;

  let output = input;
  for (const replacement of replacements.sort((a, b) => b.start - a.start)) {
    output = `${output.slice(0, replacement.start)}${replacement.next}${output.slice(replacement.end)}`;
  }
  fs.writeFileSync(filePath, output);
}

if (checkOnly && changedFiles > 0) {
  console.error(
    `${changedSpecifiers} Node ESM specifier(s) in ${changedFiles} backend source file(s) need normalization. Run pnpm --filter @plum-code-webui/backend fix:esm-imports.`
  );
  process.exitCode = 1;
} else {
  console.log(
    checkOnly
      ? 'Backend Node ESM specifiers are normalized.'
      : `Normalized ${changedSpecifiers} Node ESM specifier(s) in ${changedFiles} backend source file(s).`
  );
}
