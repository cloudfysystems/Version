#!/usr/bin/env node
/* deploy-checks.mjs
 *
 * Smoke test pos-deploy. Verifica que o Deployment esta saudavel
 * (replicas READY == replicas DESIRED) e que pelo menos 1 pod responde
 * TCP na porta do Service. Usa kubectl (que ja foi configurado pelo workflow
 * via `aws eks update-kubeconfig`).
 *
 * Falha (exit code != 0) se:
 *   - O Deployment nao tem todas as replicas Ready em 5min
 *   - O Service nao tem endpoints
 *   - Um Job de port-forward + curl falha
 *
 * Args:
 *   --deployment=<name>  Nome do K8s Deployment a verificar (obrigatorio)
 *   --service=<name>     Nome do K8s Service (default = mesmo do deployment)
 *   --port=<num>         Porta do Service (default 3090)
 */
import { execFileSync, spawn } from 'node:child_process';
import { setTimeout as Sleep } from 'node:timers/promises';

const Args = process.argv.slice(2);
const ArgValue = (Name) => {
    const Found = Args.find((A) => A.startsWith(`--${Name}=`));
    return Found ? Found.slice(`--${Name}=`.length) : null;
};

const DEPLOYMENT = ArgValue('deployment');
const SERVICE = ArgValue('service') ?? DEPLOYMENT;
const PORT = Number.parseInt(ArgValue('port') ?? '3090', 10);

if (!DEPLOYMENT) {
    process.stderr.write('Erro: --deployment=<name> e obrigatorio.\n');
    process.exit(1);
}

const TIMEOUT_MS = 5 * 60 * 1000;

function Run(Cmd, Args) {
    return execFileSync(Cmd, Args, { encoding: 'utf-8' }).trim();
}

async function WaitDeploymentReady() {
    const Start = Date.now();
    while (Date.now() - Start < TIMEOUT_MS) {
        try {
            const Json = Run('kubectl', ['get', 'deployment', DEPLOYMENT, '-o', 'json']);
            const Obj = JSON.parse(Json);
            const Desired = Obj.spec?.replicas ?? 0;
            const Ready = Obj.status?.readyReplicas ?? 0;
            console.log(`[wait] deployment ${DEPLOYMENT}: ${Ready}/${Desired} ready`);
            if (Ready >= Desired && Desired > 0) return;
        } catch (E) {
            console.error(`[wait] erro: ${String(E)}`);
        }
        await Sleep(5000);
    }
    throw new Error(`Deployment ${DEPLOYMENT} nao ficou Ready em ${String(TIMEOUT_MS)}ms`);
}

function CheckServiceHasEndpoints() {
    const Json = Run('kubectl', ['get', 'endpoints', SERVICE, '-o', 'json']);
    const Obj = JSON.parse(Json);
    const Subsets = Obj.subsets ?? [];
    const Total = Subsets.reduce((Acc, S) => Acc + (S.addresses?.length ?? 0), 0);
    if (Total === 0) {
        throw new Error(`Service ${SERVICE} nao tem endpoints`);
    }
    console.log(`[check] service ${SERVICE} tem ${String(Total)} endpoint(s)`);
}

async function ProbeViaPortForward() {
    return new Promise((Resolve, Reject) => {
        const Pf = spawn('kubectl', ['port-forward', `service/${SERVICE}`, `${String(PORT)}:${String(PORT)}`], {
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        let Settled = false;
        const Settle = (Result) => {
            if (Settled) return;
            Settled = true;
            try {
                Pf.kill('SIGTERM');
            } catch {
                /* ignore */
            }
            if (Result instanceof Error) Reject(Result);
            else Resolve();
        };
        Pf.stdout.on('data', (Buf) => {
            const Line = Buf.toString();
            console.log(`[pf] ${Line.trim()}`);
            if (Line.includes('Forwarding from')) {
                setTimeout(() => {
                    try {
                        Run('curl', ['-fsS', '--max-time', '5', `http://localhost:${String(PORT)}/`]);
                        console.log(`[probe] HTTP ${String(PORT)} respondeu`);
                        Settle();
                    } catch (E) {
                        const Msg = String(E);
                        if (Msg.includes('exit code 22') || Msg.includes('curl: (22)')) {
                            console.log(`[probe] HTTP respondeu com erro HTTP (esperado, app nao tem rota /)`);
                            Settle();
                        } else {
                            Settle(new Error(`Probe falhou: ${Msg}`));
                        }
                    }
                }, 1500);
            }
        });
        Pf.stderr.on('data', (Buf) => {
            console.error(`[pf err] ${Buf.toString().trim()}`);
        });
        Pf.on('exit', (Code) => {
            if (!Settled) {
                Settle(new Error(`port-forward terminou prematuramente (code=${String(Code)})`));
            }
        });
        setTimeout(() => {
            if (!Settled) {
                Settle(new Error('Timeout aguardando port-forward'));
            }
        }, 30000);
    });
}

(async () => {
    try {
        await WaitDeploymentReady();
        CheckServiceHasEndpoints();
        await ProbeViaPortForward();
        console.log('[ok] smoke test passou');
        process.exit(0);
    } catch (E) {
        console.error(`[fail] ${String(E)}`);
        process.exit(1);
    }
})();
