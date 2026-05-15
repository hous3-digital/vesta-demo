/**
 * enrollment.ts — Lógica compartilhada do fluxo de cadastro
 *
 * Importado por client1.ts e client2.ts. Recebe config e conduz o
 * usuário pelas 4 telas: Welcome → Form → KYC → Success.
 */

import { VestaSDK } from '@hous3-digital/vesta-sdk';
import type { SmartEnrollResult } from '@hous3-digital/vesta-sdk';

export interface EnrollmentConfig {
  sdk: VestaSDK;
  verifierId: string;
  minKycLevel: number;
}

// ─── Helpers de formatação ─────────────────────────────────────────────────

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

/** YYYY-MM-DD → YYYYMMDD */
function cleanBirthDate(value: string): string {
  return value.replace(/-/g, '');
}

/** Maiúsculas sem acentos */
function normalizeFullName(value: string): string {
  return value
    .toUpperCase()
    .trim()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ');
}

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

// ─── Main export ───────────────────────────────────────────────────────────

export function initEnrollmentFlow(config: EnrollmentConfig): void {
  const { sdk } = config;

  // ── Screen elements
  const screenWelcome = document.getElementById('screen-welcome') as HTMLDivElement;
  const screenForm    = document.getElementById('screen-form')    as HTMLDivElement;
  const screenKyc     = document.getElementById('screen-kyc')     as HTMLDivElement;
  const screenSuccess = document.getElementById('screen-success') as HTMLDivElement;

  // ── Welcome
  const btnCreateAccount = document.getElementById('btn-create-account') as HTMLButtonElement;
  const btnSignIn        = document.getElementById('btn-signin')         as HTMLButtonElement;

  // ── Form
  const btnFormBack  = document.getElementById('btn-form-back')  as HTMLButtonElement;
  const formEl       = document.getElementById('enroll-form')    as HTMLFormElement;
  const inputName    = document.getElementById('fullName')        as HTMLInputElement;
  const inputCpf     = document.getElementById('cpf')             as HTMLInputElement;
  const inputBirth   = document.getElementById('birthDate')       as HTMLInputElement;
  const btnContinue  = document.getElementById('btn-continue')    as HTMLButtonElement;

  // ── KYC
  const btnKycBack         = document.getElementById('btn-kyc-back')          as HTMLButtonElement;
  const kycNewSection      = document.getElementById('kyc-new-section')       as HTMLDivElement;
  const kycHasVcSection    = document.getElementById('kyc-has-vc-section')    as HTMLDivElement;
  const kycAnimSection     = document.getElementById('kyc-animation-section') as HTMLDivElement;
  const btnStartVerif      = document.getElementById('btn-start-verification') as HTMLButtonElement;
  const btnSkipKyc         = document.getElementById('btn-skip-kyc')           as HTMLButtonElement;

  // KYC option cards (cosmetic selection)
  const kycCards = document.querySelectorAll<HTMLDivElement>('.kyc-card-option');

  // KYC animation steps
  const kycStep1 = document.getElementById('kyc-step-1') as HTMLDivElement;
  const kycStep2 = document.getElementById('kyc-step-2') as HTMLDivElement;
  const kycStep3 = document.getElementById('kyc-step-3') as HTMLDivElement;
  const kycInd1  = document.getElementById('kyc-ind-1')  as HTMLDivElement;
  const kycInd2  = document.getElementById('kyc-ind-2')  as HTMLDivElement;
  const kycInd3  = document.getElementById('kyc-ind-3')  as HTMLDivElement;

  // ── Success
  const elSuccessTitle    = document.getElementById('success-title')    as HTMLHeadingElement;
  const elSuccessSubtitle = document.getElementById('success-subtitle') as HTMLParagraphElement;
  const elVcHash          = document.getElementById('vc-hash')          as HTMLSpanElement;
  const elStatusBadge     = document.getElementById('status-badge')     as HTMLSpanElement;
  const elTypeBadge       = document.getElementById('type-badge')       as HTMLSpanElement;
  const elTxRow           = document.getElementById('tx-row')           as HTMLDivElement;
  const elTxHash          = document.getElementById('tx-hash')          as HTMLSpanElement;
  const elMockRow         = document.getElementById('mock-row')         as HTMLDivElement;
  const elErrorBanner     = document.getElementById('error-banner')     as HTMLDivElement;
  const elErrorMessage    = document.getElementById('error-message')    as HTMLSpanElement;

  // ── Form data (persisted between screens)
  let savedFullName  = '';
  let savedCpf       = '';
  let savedBirthDate = '';

  // ─── Navigation helpers ──────────────────────────────────────────────────

  function showScreen(id: 'welcome' | 'form' | 'kyc' | 'success'): void {
    screenWelcome.classList.add('hidden');
    screenForm.classList.add('hidden');
    screenKyc.classList.add('hidden');
    screenSuccess.classList.add('hidden');

    const map = { welcome: screenWelcome, form: screenForm, kyc: screenKyc, success: screenSuccess };
    map[id].classList.remove('hidden');
  }

  function showError(message: string): void {
    elErrorMessage.textContent = message;
    elErrorBanner.classList.remove('hidden');
  }

  function hideError(): void {
    elErrorBanner.classList.add('hidden');
  }

  // ─── KYC animation helpers ───────────────────────────────────────────────

  function setStepActive(step: HTMLDivElement, ind: HTMLDivElement): void {
    step.classList.add('active');
    step.classList.remove('done');
    ind.textContent = '';
  }

  function setStepDone(step: HTMLDivElement, ind: HTMLDivElement): void {
    step.classList.remove('active');
    step.classList.add('done');
    ind.textContent = '✓';
  }

  function startKycAnimation(): void {
    // step 1 immediately
    setStepActive(kycStep1, kycInd1);

    setTimeout(() => {
      setStepDone(kycStep1, kycInd1);
      setStepActive(kycStep2, kycInd2);
    }, 1200);

    setTimeout(() => {
      setStepDone(kycStep2, kycInd2);
      setStepActive(kycStep3, kycInd3);
    }, 2500);
  }

  async function finishKycAnimation(): Promise<void> {
    setStepDone(kycStep3, kycInd3);
    await sleep(600);
  }

  // ─── initKycScreen ────────────────────────────────────────────────────────

  async function initKycScreen(): Promise<void> {
    kycNewSection.classList.add('hidden');
    kycHasVcSection.classList.add('hidden');
    kycAnimSection.classList.add('hidden');
    hideError();

    try {
      const hasVC = await sdk.hasStoredCredential();
      if (hasVC) {
        kycHasVcSection.classList.remove('hidden');
      } else {
        kycNewSection.classList.remove('hidden');
      }
    } catch {
      kycNewSection.classList.remove('hidden');
    }
  }

  // ─── showSuccess ─────────────────────────────────────────────────────────

  function showSuccess(result: SmartEnrollResult): void {
    const truncHash = (h: string) =>
      h.length > 16 ? `${h.slice(0, 8)}...${h.slice(-8)}` : h;

    elVcHash.textContent = truncHash(result.vcHash);
    elStatusBadge.textContent = '✓ Verificado';
    elStatusBadge.className = 'badge badge-green';

    if (result.isNewUser) {
      elSuccessTitle.textContent    = 'Tudo certo!';
      elSuccessSubtitle.textContent = 'Sua identidade foi verificada e sua credencial Vesta foi criada.';
      elTypeBadge.textContent       = '🆕 Nova credencial';
      elTypeBadge.className         = 'badge badge-yellow';
    } else {
      elSuccessTitle.textContent    = 'Identidade portada!';
      elSuccessSubtitle.textContent = 'Sua credencial Vesta existente foi validada. KYC pulado com sucesso!';
      elTypeBadge.textContent       = '♻️ Credencial portada';
      elTypeBadge.className         = 'badge badge-green';
    }

    if (!result.mock && result.txHash) {
      elTxRow.classList.remove('hidden');
      elTxHash.textContent = `${result.txHash.slice(0, 8)}...${result.txHash.slice(-8)}`;
    } else {
      elTxRow.classList.add('hidden');
    }

    if (result.mock) {
      elMockRow.classList.remove('hidden');
    } else {
      elMockRow.classList.add('hidden');
    }

    showScreen('success');
  }

  // ─── smartEnroll call ─────────────────────────────────────────────────────

  async function runSmartEnroll(): Promise<SmartEnrollResult> {
    return sdk.smartEnroll({
      userData: {
        cpf: savedCpf,
        fullName: savedFullName,
        birthDate: savedBirthDate,
        kycLevel: 'complete',
        kycMethod: 'document_verification',
      },
      privateInputs: {
        cpf: savedCpf,
        birthDate: cleanBirthDate(savedBirthDate),
        fullName: normalizeFullName(savedFullName),
      },
      verifierId: config.verifierId,
      minKycLevel: config.minKycLevel,
    });
  }

  // ─── Event listeners ──────────────────────────────────────────────────────

  // Welcome → Form
  btnCreateAccount.addEventListener('click', () => {
    showScreen('form');
  });

  if (btnSignIn) {
    btnSignIn.addEventListener('click', () => {
      showScreen('form');
    });
  }

  // Form back → Welcome
  btnFormBack.addEventListener('click', () => {
    hideError();
    showScreen('welcome');
  });

  // CPF mask
  inputCpf.addEventListener('input', () => {
    inputCpf.value = maskCpf(inputCpf.value);
  });

  // Form submit → KYC
  formEl.addEventListener('submit', async (e: Event) => {
    e.preventDefault();
    hideError();

    const fullName  = inputName.value.trim();
    const cpf       = cleanCpf(inputCpf.value);
    const birthDate = inputBirth.value;

    if (!fullName)          { showError('Informe seu nome completo.');        return; }
    if (cpf.length !== 11)  { showError('CPF inválido. Informe 11 dígitos.'); return; }
    if (!birthDate)         { showError('Informe sua data de nascimento.');    return; }

    savedFullName  = fullName;
    savedCpf       = cpf;
    savedBirthDate = birthDate;

    await initKycScreen();
    showScreen('kyc');
  });

  // KYC back → Form
  btnKycBack.addEventListener('click', () => {
    hideError();
    showScreen('form');
  });

  // KYC card cosmetic selection
  kycCards.forEach(card => {
    card.addEventListener('click', () => {
      kycCards.forEach(c => c.classList.remove('selected'));
      card.classList.add('selected');
    });
  });

  // Start verification (new user path)
  btnStartVerif.addEventListener('click', async () => {
    kycNewSection.classList.add('hidden');
    kycAnimSection.classList.remove('hidden');
    hideError();

    startKycAnimation();

    try {
      const result = await runSmartEnroll();
      await finishKycAnimation();
      showSuccess(result);
    } catch (err) {
      kycAnimSection.classList.add('hidden');
      kycNewSection.classList.remove('hidden');
      const msg = err instanceof Error ? err.message : 'Erro desconhecido.';
      showError(msg);
    }
  });

  // Skip KYC (has-VC path)
  btnSkipKyc.addEventListener('click', async () => {
    btnSkipKyc.disabled = true;
    const originalContent = btnSkipKyc.innerHTML;
    btnSkipKyc.innerHTML = '<div class="spinner"></div> Validando...';
    hideError();

    try {
      const result = await runSmartEnroll();
      showSuccess(result);
    } catch (err) {
      btnSkipKyc.disabled = false;
      btnSkipKyc.innerHTML = originalContent;
      const msg = err instanceof Error ? err.message : 'Erro desconhecido.';
      showError(msg);
    }
  });
}
