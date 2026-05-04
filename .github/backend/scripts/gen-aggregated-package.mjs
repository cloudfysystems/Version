#!/usr/bin/env node
/* gen-aggregated-package.mjs
 *
 * Le packages/corp/package.json + apps/<APP>/package.json e gera um
 * package.json AGREGADO (sem workspace:*) que e copiado pra imagem Docker.
 * O `npm install --omit=dev` dentro do container resolve as dependencies.
 *
 * Output em stdout — o workflow GHA redireciona pra .github/backend/package.json
 * antes do `docker build`.
 *
 * Logica de merge: pega sempre a MAIOR versao semver de cada dependency.
 * Mesmo input -> mesmo output, deterministicamente.
 *
 * Uso:
 *   node gen-aggregated-package.mjs --app=<app-name> --root=<path-do-monorepo>
 *   node gen-aggregated-package.mjs <app-name> --root=<path>
 *   node gen-aggregated-package.mjs <app-name>           # root=cwd (compat antigo)
 *
 * Exemplos:
 *   # Quando rodando do version repo, apontando pro source do backend clonado
 *   node version-repo/.github/backend/scripts/gen-aggregated-package.mjs \
 *       --app=n03ap01 --root=backend-source
 *
 *   # Compat antigo: rodar de dentro do backend repo, sem --root
 *   cd backend && node .github/scripts/gen-aggregated-package.mjs n03ap01
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Resolucao dos args: --app=<name>, --root=<path>, ou positional p/ app
const Args = process.argv.slice(2);
const NamedApp = Args.find((A) => A.startsWith('--app='));
const NamedRoot = Args.find((A) => A.startsWith('--root='));
const PositionalArg = Args.find((A) => !A.startsWith('--'));
const AppName = NamedApp ? NamedApp.slice('--app='.length) : (PositionalArg ?? '');
const Root = NamedRoot ? resolve(NamedRoot.slice('--root='.length)) : process.cwd();

if (!AppName) {
    process.stderr.write(
        'Erro: nome da app obrigatorio.\n' +
            'Uso: node gen-aggregated-package.mjs --app=<app-name> --root=<path>\n' +
            '     node gen-aggregated-package.mjs <app-name>            # root=cwd\n',
    );
    process.exit(1);
}

const AppPackagePath = resolve(Root, 'apps', AppName, 'package.json');
if (!existsSync(AppPackagePath)) {
    process.stderr.write(`Erro: ${AppPackagePath} nao encontrado (root=${Root})\n`);
    process.exit(1);
}

const CorpPackagePath = resolve(Root, 'packages/corp/package.json');
if (!existsSync(CorpPackagePath)) {
    process.stderr.write(`Erro: ${CorpPackagePath} nao encontrado (root=${Root})\n`);
    process.exit(1);
}

const PROJETOS = [CorpPackagePath, AppPackagePath];

function compararVersoes(V1, V2) {
    if (V1 === V2) return 0;
    const Sanitize = (V) => String(V).replace(/^[\^~>=<\s]+/, '');
    const A = Sanitize(V1)
        .split('.')
        .map((P) => Number.parseInt(P, 10) || 0);
    const B = Sanitize(V2)
        .split('.')
        .map((P) => Number.parseInt(P, 10) || 0);
    const Len = Math.max(A.length, B.length);
    for (let I = 0; I < Len; I++) {
        const PA = A[I] ?? 0;
        const PB = B[I] ?? 0;
        if (PA > PB) return 1;
        if (PA < PB) return -1;
    }
    return 0;
}

const Deps = {};
for (const Path of PROJETOS) {
    const Pkg = JSON.parse(readFileSync(Path, 'utf-8'));
    for (const [Name, Versao] of Object.entries(Pkg.dependencies ?? {})) {
        // Pula refs workspace — @cloudfy/corp e provido pelo PVC em runtime.
        if (typeof Versao === 'string' && Versao.startsWith('workspace:')) continue;
        if (Name.startsWith('@cloudfy/')) continue;
        if (!Deps[Name]) {
            Deps[Name] = Versao;
        } else if (compararVersoes(Versao, Deps[Name]) === 1) {
            Deps[Name] = Versao;
        }
    }
}

// Saida ordenada alfabeticamente pra hash deterministico.
const Sorted = {};
for (const Key of Object.keys(Deps).sort()) {
    Sorted[Key] = Deps[Key];
}

const Output = {
    name: `cloudfy-${AppName}-runtime`,
    version: '1.0.0',
    description: `Cloudfy ${AppName} runtime image (corp + ${AppName})`,
    type: 'module',
    engines: { node: '>=24.0.0' },
    dependencies: Sorted,
};

process.stdout.write(JSON.stringify(Output, null, 2) + '\n');
