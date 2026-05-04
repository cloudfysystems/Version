#!/usr/bin/env node
/* deploy-checks.mjs
 *
 * Smoke test pos-deploy. Verifica que o Deployment esta saudavel
 * (replicas READY == replicas DESIRED) e que pelo menos 1 pod responde
 * TCP na porta 3090. Usa kubectl (que ja foi configurado pelo workflow
 * via `aws eks update-kubeconfig`).
 *
 * Falha (exit code != 0) se:
 *   - O Deployment nao tem todas as replicas Ready em 5min
 *   - O Service n03ap01v2 nao tem endpoints
 *   - Um Job de port-forward + nc -z localhost 3090 falha
 */
import { execFileSync, spawn } from 'node:child_process';
import { setTimeout as Sleep } from 'node:timers/promises';

const DEPLOYMENT = 'n03ap01v2';
const SERVICE = 'n03ap01v2';
const PORT = 3090;
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
                // Aguarda 1s pra estabilizar e prova
                setTimeout(() => {
                    try {
                        Run('curl', ['-fsS', '--max-time', '5', `http://localhost:${String(PORT)}/`]);
                        console.log(`[probe] HTTP ${String(PORT)} respondeu`);
                        Settle();
                    } catch (E) {
                        // 404 ou outro tambem e aceitavel — significa que o socket abriu.
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
        // Timeout de 30s pra estabelecer port-forward
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
