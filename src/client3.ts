/**
 * client3.ts — Pendo Bank (KYC assíncrono / pending)
 *
 * Diferente de client1/client2 (fluxo síncrono via initEnrollmentFlow),
 * este cliente exercita o fluxo pending:
 *
 *   1. issueCredential({ kycLevel: 'pending' })
 *      → VC criada no device, status PENDING no backend
 *   2. Simulação do webhook: chama POST /public/credential/kyc-status
 *      direto do browser (em produção seria server-to-server) para virar
 *      APPROVED ou REJECTED
 *   3. smartEnroll() para observar o dispatch por status:
 *      - PENDING  → VestaSDKError statusCode=202
 *      - ACTIVE   → validação on-chain
 *      - REJECTED → limpeza local + reissue automático
 */

import { VestaSDK, VestaSDKError, VestaEnvironment } from '@hous3-digital/vesta-sdk';
import type { SmartEnrollResult } from '@hous3-digital/vesta-sdk';
import { createSDK } from './sdk-config';

// ─── Config ───────────────────────────────────────────────────────────────

const API_KEY = import.meta.env.VITE_VESTA_API_KEY as string;

// createSDK() força STAGING, então o webhook direto vai pro mesmo host.
const API_BASE_URL: Record<VestaEnvironment, string> = {
  [VestaEnvironment.STAGING]: 'https://vesta.trust-staging.com',
  [VestaEnvironment.PRODUCTION]: 'https://vesta.hous3-trust.com',
};
const BASE_URL = API_BASE_URL[VestaEnvironment.STAGING];

const VERIFIER_ID = 'verifier_pendo';
const MIN_KYC_LEVEL = 1;

// ─── Formatting helpers ───────────────────────────────────────────────────

function maskCpf(value: string): string {
  return value
    .replace(/\D/g, '')
    .replace(/(\d{3})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d{1,2})$/, '$1-$2')
    .slice(0, 14);
}

function cleanCpf(value: string): string {
  return value.replace(/\D/g, '');
}

function cleanBirthDate(value: string): string {
  return value.replace(/-/g, '');
}

function normalizeFullName(value: string): string {
  return value
    .toUpperCase()
    .trim()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ');
}

function truncHash(h: string): string {
  return h.length > 16 ? `${h.slice(0, 8)}...${h.slice(-8)}` : h;
}

// ─── Elements ─────────────────────────────────────────────────────────────

const sdk = createSDK();

const screenWelcome = document.getElementById('screen-welcome') as HTMLDivElement;
const screenForm    = document.getElementById('screen-form')    as HTMLDivElement;
const screenPending = document.getElementById('screen-pending') as HTMLDivElement;
const screenSuccess = document.getElementById('screen-success') as HTMLDivElement;

const btnCreateAccount = document.getElementById('btn-create-account') as HTMLButtonElement;
const btnSignIn        = document.getElementById('btn-signin')         as HTMLButtonElement;

const btnFormBack    = document.getElementById('btn-form-back')    as HTMLButtonElement;
const formEl         = document.getElementById('enroll-form')      as HTMLFormElement;
const inputName      = document.getElementById('fullName')          as HTMLInputElement;
const inputCpf       = document.getElementById('cpf')               as HTMLInputElement;
const inputBirth     = document.getElementById('birthDate')         as HTMLInputElement;
const formErrorEl    = document.getElementById('form-error-banner') as HTMLDivElement;
const formErrorMsg   = document.getElementById('form-error-message')as HTMLSpanElement;

const btnPendingBack = document.getElementById('btn-pending-back')  as HTMLButtonElement;
const pendingInfo    = document.getElementById('pending-info')      as HTMLDivElement;
const pendingLog     = document.getElementById('pending-log')       as HTMLDivElement;
const btnRunSmart    = document.getElementById('btn-run-smart-enroll') as HTMLButtonElement;

const elVcHash       = document.getElementById('vc-hash')       as HTMLSpanElement;
const elStatusBadge  = document.getElementById('status-badge')  as HTMLSpanElement;
const elTypeBadge    = document.getElementById('type-badge')    as HTMLSpanElement;
const elTxRow        = document.getElementById('tx-row')        as HTMLDivElement;
const elTxHash       = document.getElementById('tx-hash')       as HTMLSpanElement;
const elSuccessTitle = document.getElementById('success-title') as HTMLHeadingElement;
const elSuccessSub   = document.getElementById('success-subtitle') as HTMLParagraphElement;

// ─── State (per session) ──────────────────────────────────────────────────

let savedFullName  = '';
let savedCpf       = '';
let savedBirthDate = '';
let currentVcHash: string | null = null;
let currentCredentialId: string | null = null;

// ─── Navigation ───────────────────────────────────────────────────────────

function showScreen(id: 'welcome' | 'form' | 'pending' | 'success'): void {
  [screenWelcome, screenForm, screenPending, screenSuccess].forEach(s => s.classList.add('hidden'));
  ({ welcome: screenWelcome, form: screenForm, pending: screenPending, success: screenSuccess })[id]
    .classList.remove('hidden');
}

function showFormError(msg: string): void {
  formErrorMsg.textContent = msg;
  formErrorEl.classList.remove('hidden');
}
function hideFormError(): void {
  formErrorEl.classList.add('hidden');
}

// ─── Log helpers ──────────────────────────────────────────────────────────

function log(kind: 'ok' | 'err' | 'info', msg: string): void {
  const timestamp = new Date().toLocaleTimeString();
  const line = document.createElement('div');
  line.className = `log-${kind}`;
  line.textContent = `[${timestamp}] ${msg}`;
  pendingLog.appendChild(line);
  pendingLog.scrollTop = pendingLog.scrollHeight;
}

function resetLog(): void {
  pendingLog.textContent = '';
  log('info', 'Awaiting actions…');
}

// ─── Panel refresh ────────────────────────────────────────────────────────

function refreshPanel(): void {
  if (!currentVcHash) {
    pendingInfo.textContent = 'No pending VC.';
    return;
  }
  pendingInfo.innerHTML =
    `<b>CPF:</b> ${savedCpf}<br>` +
    `<b>credentialId:</b> ${currentCredentialId ?? '—'}<br>` +
    `<b>vcHash:</b> ${currentVcHash}`;
}

// ─── Webhook simulator ────────────────────────────────────────────────────

async function callKycStatusWebhook(
  action: 'approve' | 'reject',
  kycLevel: 'basic' | 'intermediate' | 'complete',
): Promise<void> {
  if (!savedCpf) {
    log('err', 'No CPF in session — start the flow again.');
    return;
  }

  const body = {
    cpf: savedCpf,
    status: action === 'approve' ? 'approved' : 'rejected',
    kycLevel,
  };

  log('info', `POST /public/credential/kyc-status ${JSON.stringify(body)}`);

  try {
    const resp = await fetch(`${BASE_URL}/public/credential/kyc-status`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': API_KEY,
      },
      body: JSON.stringify(body),
    });

    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      log('err', `HTTP ${resp.status} — ${JSON.stringify(data)}`);
      return;
    }

    log(
      'ok',
      `HTTP ${resp.status} — updated=${data?.data?.updated ?? data?.updated} ` +
        `status=${data?.data?.status ?? data?.status} kycLevel=${data?.data?.kycLevel ?? data?.kycLevel}`,
    );
  } catch (err) {
    log('err', `Network error: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function refreshVerifyStatus(): Promise<void> {
  if (!currentVcHash) {
    log('err', 'No local vcHash.');
    return;
  }
  log('info', `checkCredentialStatus(${truncHash(currentVcHash)})`);
  try {
    const status = await sdk.checkCredentialStatus({ vcHash: currentVcHash });
    log(
      'ok',
      `verify → valid=${status.valid} reason=${status.reason ?? '—'} kycLevel=${status.kycLevel ?? '—'}`,
    );
  } catch (err) {
    if (err instanceof VestaSDKError) {
      log('err', `VestaSDKError ${err.statusCode}: ${err.apiMessage}`);
    } else {
      log('err', err instanceof Error ? err.message : String(err));
    }
  }
}

// ─── Emit pending ─────────────────────────────────────────────────────────

async function emitPendingCredential(): Promise<void> {
  hideFormError();
  log('info', `issueCredential(kycLevel="pending") for CPF ${savedCpf}`);

  try {
    const result = await sdk.issueCredential({
      cpf: savedCpf,
      fullName: savedFullName,
      birthDate: savedBirthDate,
      kycLevel: 'pending',
      kycMethod: 'document_verification',
    });

    currentVcHash = result.vcHash;
    currentCredentialId = result.credentialId;
    log(
      'ok',
      `VC emitted — status=${result.status} vcHash=${truncHash(result.vcHash)} ` +
        `credentialId=${result.credentialId}`,
    );
    refreshPanel();
  } catch (err) {
    if (err instanceof VestaSDKError) {
      showFormError(`Erro ${err.statusCode}: ${err.apiMessage}`);
      log('err', `issueCredential falhou: ${err.statusCode} ${err.apiMessage}`);
    } else {
      const msg = err instanceof Error ? err.message : String(err);
      showFormError(msg);
      log('err', `issueCredential falhou: ${msg}`);
    }
    throw err;
  }
}

// ─── smartEnroll runner ───────────────────────────────────────────────────

async function runSmartEnroll(): Promise<void> {
  btnRunSmart.disabled = true;
  const original = btnRunSmart.textContent;
  btnRunSmart.textContent = 'Running…';

  log('info', 'smartEnroll() started');

  try {
    const result: SmartEnrollResult = await sdk.smartEnroll({
      userData: {
        cpf: savedCpf,
        fullName: savedFullName,
        birthDate: savedBirthDate,
        kycLevel: 'pending',
        kycMethod: 'document_verification',
      },
      privateInputs: {
        cpf: savedCpf,
        birthDate: cleanBirthDate(savedBirthDate),
        fullName: normalizeFullName(savedFullName),
      },
      verifierId: VERIFIER_ID,
      minKycLevel: MIN_KYC_LEVEL,
    });

    log(
      'ok',
      `smartEnroll → authenticated=${result.authenticated} isNewUser=${result.isNewUser} ` +
        `vcHash=${truncHash(result.vcHash)}`,
    );

    // Atualiza state local se o smartEnroll reemitiu (rejected → reissue).
    currentVcHash = result.vcHash;
    refreshPanel();

    showSuccess(result);
  } catch (err) {
    if (err instanceof VestaSDKError && err.statusCode === 202) {
      log('info', `PENDING — ${err.apiMessage}`);
    } else if (err instanceof VestaSDKError) {
      log('err', `VestaSDKError ${err.statusCode}: ${err.apiMessage}`);
    } else {
      log('err', err instanceof Error ? err.message : String(err));
    }
  } finally {
    btnRunSmart.disabled = false;
    btnRunSmart.textContent = original;
  }
}

// ─── Success screen ───────────────────────────────────────────────────────

function showSuccess(result: SmartEnrollResult): void {
  elVcHash.textContent = truncHash(result.vcHash);
  elStatusBadge.textContent = '✓ Active';
  elStatusBadge.className = 'badge badge-green';

  if (result.isNewUser) {
    elSuccessTitle.textContent = 'New credential!';
    elSuccessSub.textContent = 'A new VC was issued after the previous one was rejected.';
    elTypeBadge.textContent = '🆕 Reissue after rejection';
    elTypeBadge.className = 'badge badge-yellow';
  } else {
    elSuccessTitle.textContent = 'Approved!';
    elSuccessSub.textContent = 'KYC approved via webhook and validated on-chain.';
    elTypeBadge.textContent = '♻️ Recurrent (async KYC)';
    elTypeBadge.className = 'badge badge-green';
  }

  if (!result.mock && result.txHash) {
    elTxRow.classList.remove('hidden');
    elTxHash.textContent = `${result.txHash.slice(0, 8)}...${result.txHash.slice(-8)}`;
  } else {
    elTxRow.classList.add('hidden');
  }

  showScreen('success');
}

// ─── Event wiring ─────────────────────────────────────────────────────────

btnCreateAccount.addEventListener('click', () => showScreen('form'));
btnSignIn.addEventListener('click', () => showScreen('form'));

btnFormBack.addEventListener('click', () => {
  hideFormError();
  showScreen('welcome');
});

inputCpf.addEventListener('input', () => {
  inputCpf.value = maskCpf(inputCpf.value);
});

formEl.addEventListener('submit', async (e: Event) => {
  e.preventDefault();
  hideFormError();

  const fullName  = inputName.value.trim();
  const cpf       = cleanCpf(inputCpf.value);
  const birthDate = inputBirth.value;

  if (!fullName)         { showFormError('Please enter your full name.'); return; }
  if (cpf.length !== 11) { showFormError('Invalid CPF. Enter 11 digits.');   return; }
  if (!birthDate)        { showFormError('Please enter your date of birth.'); return; }

  savedFullName  = fullName;
  savedCpf       = cpf;
  savedBirthDate = birthDate;

  resetLog();
  showScreen('pending');
  refreshPanel();

  try {
    await emitPendingCredential();
  } catch {
    // erro já foi logado; volta pro form
    showScreen('form');
  }
});

btnPendingBack.addEventListener('click', () => {
  showScreen('form');
});

// Delegated click no painel de simulação de webhook.
screenPending.addEventListener('click', async (e: MouseEvent) => {
  const target = e.target as HTMLElement;
  const btn = target.closest('button[data-action]') as HTMLButtonElement | null;
  if (!btn) return;

  const action = btn.dataset.action;
  const level = (btn.dataset.level as 'basic' | 'intermediate' | 'complete' | undefined) ?? 'complete';

  btn.disabled = true;
  try {
    if (action === 'approve') {
      await callKycStatusWebhook('approve', level);
    } else if (action === 'reject') {
      // kycLevel é obrigatório no endpoint mesmo pra rejeição; usa "basic" como placeholder.
      await callKycStatusWebhook('reject', 'basic');
    } else if (action === 'refresh-status') {
      await refreshVerifyStatus();
    }
  } finally {
    btn.disabled = false;
  }
});

btnRunSmart.addEventListener('click', runSmartEnroll);
