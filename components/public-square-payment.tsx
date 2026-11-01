"use client";

import { formatCents } from "@/modules/payments/format-cents";
import Script from "next/script";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { SubmitRetryNotice } from "@/components/submit-retry-notice";
import { submitJson, unavailableMessage } from "@/lib/submit-json";
import { CreditCard, ExternalLink, LoaderCircle, ShieldCheck, TriangleAlert } from "lucide-react";
import {
  paymentChoiceOptionPresentations,
} from "@/modules/payments/payment-choice-presentation";
import { startHostedReturnPolling } from "@/modules/payments/hosted-return-polling";
import {
  hostedReturnMessage,
  hostedReturnStorageKey,
  isHostedReturnId,
  type HostedReturnState,
} from "@/modules/payments/hosted-return-presentation";
import { squareTestModeNotice } from "@/modules/payments/square-sandbox-notice";

const SQUARE_LOAD_TIMEOUT_MS = 20_000;

/** A card form that never finishes attaching (a blocker holding a frame open) is a failure, not a wait. */
function withTimeout<T>(promise: Promise<T>, milliseconds: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error("Square took too long to load.")), milliseconds);
    promise.then(
      (value) => { window.clearTimeout(timer); resolve(value); },
      (error: unknown) => { window.clearTimeout(timer); reject(error); },
    );
  });
}

type SquareCheckout = {
  state:
    | "READY"
    | "CHOICE_REQUIRED"
    | "NOT_CONFIGURED"
    | "NOT_ELIGIBLE"
    | "NO_BALANCE"
    | "FORM_UNAVAILABLE";
  message: string;
  amountCents: number;
  balanceCents: number;
  surchargeCents: number;
  currency: "USD";
  cardSelected: boolean;
  /** What `amountCents` pays (#415): the whole balance, or the form's fixed reservation deposit. */
  paymentKind: "BALANCE" | "DEPOSIT";
  /** A deposit that can be paid now instead of the whole balance; null when none is on offer. */
  deposit: {
    depositCents: number;
    surchargeCents: number;
    chargeCents: number;
    balanceAfterCents: number;
    chosenOnForm: boolean;
  } | null;
  /** A deposit is already recorded, so the reservation is held. */
  depositRecorded: boolean;
  /** The event offers "Pay on Square" and this registration can use it right now (#327). */
  hostedLink?: boolean;
  paymentChoice: {
    available: boolean;
    locked: boolean;
    selected: "CARD" | "PAY_LATER" | null;
    currentOperationId: string | null;
    baseSubtotalCents: number;
    cardProcessingFeeCents: number;
    cardTotalCents: number;
    payLaterTotalCents: number;
    /** False when online card payment cannot be taken right now (#1405): only pay later is offered. */
    cardAvailable?: boolean;
  } | null;
  square: {
    environment: "sandbox" | "production";
    applicationId: string;
    locationId: string;
    scriptUrl: string;
  } | null;
  billingContact: {
    givenName: string;
    familyName: string;
    email: string;
    phone: string;
  } | null;
};

type SquareTokenResult = {
  status: string;
  token?: string;
  errors?: Array<{ message?: string; detail?: string }>;
};

type SquarePaymentMethod = {
  destroy?(): Promise<void>;
};

type SquareCard = SquarePaymentMethod & {
  attach(selector: string): Promise<void>;
  tokenize(details: {
    amount: string;
    billingContact?: {
      givenName?: string;
      familyName?: string;
      email?: string;
      phone?: string;
    };
    currencyCode: "USD";
    intent: "CHARGE";
    customerInitiated: true;
    sellerKeyedIn: false;
  }): Promise<SquareTokenResult>;
};

type SquareWallet = SquarePaymentMethod & {
  tokenize(): Promise<SquareTokenResult>;
};

type SquareGooglePay = SquareWallet & {
  attach(selector: string): Promise<void>;
};

type SquarePaymentRequest = object;

type SquarePayments = {
  card(): Promise<SquareCard>;
  paymentRequest(input: {
    countryCode: "US";
    currencyCode: "USD";
    total: {
      amount: string;
      label: string;
    };
  }): SquarePaymentRequest;
  applePay(request: SquarePaymentRequest): Promise<SquareWallet>;
  googlePay(request: SquarePaymentRequest): Promise<SquareGooglePay>;
};

declare global {
  interface Window {
    Square?: {
      payments(
        applicationId: string,
        locationId: string,
      ): SquarePayments | Promise<SquarePayments>;
    };
  }
}

type PaymentMethodKind = "CARD" | "APPLE_PAY" | "GOOGLE_PAY";

function firstTokenizationError(
  errors: Array<{ message?: string; detail?: string }> | undefined,
  fallback = "Review the card details and try again.",
) {
  return errors?.find((error) => error.message || error.detail)?.message
    ?? errors?.find((error) => error.detail)?.detail
    ?? fallback;
}

function methodLabel(method: PaymentMethodKind) {
  if (method === "APPLE_PAY") return "Apple Pay";
  if (method === "GOOGLE_PAY") return "Google Pay";
  return "card";
}

function destroyPaymentMethod(method: SquarePaymentMethod | null) {
  if (method?.destroy) void method.destroy();
}

async function fetchCheckout(endpoint: string, kind: "BALANCE" | "DEPOSIT" | null = null) {
  const response = await fetch(kind ? `${endpoint}?kind=${kind}` : endpoint, {
    method: "GET",
    cache: "no-store",
  });
  const body = await response.json() as {
    checkout?: SquareCheckout;
    message?: string;
  };
  if (!response.ok || !body.checkout) {
    throw new Error(
      body.message ?? "Online payment details are unavailable.",
    );
  }
  return body.checkout;
}

function unavailableCheckout(error: unknown): SquareCheckout {
  return {
    state: "NOT_CONFIGURED",
    message: error instanceof Error
      ? error.message
      : "Online payment is unavailable. Your registration is still saved.",
    amountCents: 0,
    balanceCents: 0,
    surchargeCents: 0,
    currency: "USD",
    cardSelected: false,
    paymentKind: "BALANCE",
    deposit: null,
    depositRecorded: false,
    hostedLink: false,
    paymentChoice: null,
    square: null,
    billingContact: null,
  };
}

/**
 * After Square, the return page sends the payer back here with `?ret=<returnId>`. That is a
 * courtesy, never proof: the banner reports what the server's own status for that return id says,
 * which is written only from the verified webhook. The parameter is removed from the address once
 * read, so a refresh or a shared screenshot does not carry it.
 */
function readReturnId() {
  try {
    const url = new URL(window.location.href);
    const value = url.searchParams.get("ret");
    if (value === null) return null;
    url.searchParams.delete("ret");
    url.searchParams.delete("pay");
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
    return isHostedReturnId(value) ? value : null;
  } catch {
    return null;
  }
}

/** An opaque id Square will send the payer back to: 32 random bytes, base64url. */
function newReturnId() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export function PublicSquarePayment({
  token,
  manageEndpoint: explicitManageEndpoint,
  staffPreview = false,
  initialKind,
  nonce,
}: {
  token?: string;
  manageEndpoint?: string;
  /** Open on the whole balance (a balance reminder link) instead of the deposit the form chose (#415). */
  initialKind?: "BALANCE" | "DEPOSIT";
  /** True only in a staff preview session; the public never sees the test-mode line. */
  staffPreview?: boolean;
  /** The request's CSP nonce for the Square script tag (#1401); `strict-dynamic` ignores hosts. */
  nonce?: string;
}) {
  const manageEndpoint = explicitManageEndpoint
    ?? `/api/public/manage/${encodeURIComponent(token ?? "")}`;
  const paymentEndpoint = `${manageEndpoint}/payment`;
  const choiceEndpoint = `${manageEndpoint}/payment-choice`;
  const router = useRouter();
  const instanceId = useId().replace(/[^A-Za-z0-9_-]/g, "");
  const cardContainerId = `square-card-${instanceId}`;
  const googlePayContainerId = `square-google-pay-${instanceId}`;
  const cardRef = useRef<SquareCard | null>(null);
  const applePayRef = useRef<SquareWallet | null>(null);
  const googlePayRef = useRef<SquareGooglePay | null>(null);
  const idempotencyKeyRef = useRef<string | null>(null);
  const sourceIdRef = useRef<string | null>(null);
  const sourceMethodRef = useRef<PaymentMethodKind | null>(null);
  const choiceRequestRef = useRef<{
    choice: "CARD" | "PAY_LATER";
    clientRequestId: string;
    expectedPriorOperationId: string | null;
  } | null>(null);
  const [checkout, setCheckout] = useState<SquareCheckout | null>(null);
  const [loading, setLoading] = useState(true);
  const [sdkReady, setSdkReady] = useState(false);
  // Square's script or card form could not load (a blocker, a privacy setting or the network, #1445). Try again reloads it.
  const [sdkFailed, setSdkFailed] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [cardReady, setCardReady] = useState(false);
  const [applePayReady, setApplePayReady] = useState(false);
  const [googlePayReady, setGooglePayReady] = useState(false);
  const [submittingMethod, setSubmittingMethod] = useState<
    PaymentMethodKind | null
  >(null);
  const [choiceSubmitting, setChoiceSubmitting] = useState<
    "CARD" | "PAY_LATER" | null
  >(null);
  const [pendingChoice, setPendingChoice] = useState<
    "CARD" | "PAY_LATER" | null
  >(null);
  const hostedKeyRef = useRef<string | null>(null);
  const [hostedSubmitting, setHostedSubmitting] = useState(false);
  const hostedReturnRef = useRef<string | null>(null);
  const [returnId, setReturnId] = useState<string | null>(null);
  const [returnState, setReturnState] = useState<HostedReturnState | null>(null);
  const [notice, setNotice] = useState<{
    tone: "success" | "error" | "pending";
    message: string;
  } | null>(null);
  // The site was restarting (#1263): the payment keys and the card token stay, so Try again cannot charge twice.
  const [siteUpdating, setSiteUpdating] = useState<string | false>(false);
  const retryRef = useRef<(() => void) | null>(null);

  // The registrant's own pick between a deposit and the whole balance (#415); null leaves the server to choose.
  const kindRef = useRef<"BALANCE" | "DEPOSIT" | null>(initialKind ?? null);
  const loadCheckout = useCallback(async () => {
    try {
      setCheckout(await fetchCheckout(paymentEndpoint, kindRef.current));
    } catch (error) {
      setCheckout(unavailableCheckout(error));
    } finally {
      setLoading(false);
    }
  }, [paymentEndpoint]);

  useEffect(() => {
    let active = true;
    void fetchCheckout(paymentEndpoint, kindRef.current).then(
      (nextCheckout) => {
        if (!active) return;
        setReturnId(readReturnId());
        setCheckout(nextCheckout);
        setLoading(false);
      },
      (error: unknown) => {
        if (!active) return;
        setReturnId(readReturnId());
        setCheckout(unavailableCheckout(error));
        setLoading(false);
      },
    );
    return () => {
      active = false;
    };
  }, [paymentEndpoint]);

  useEffect(() => {
    if (!returnId) return;
    return startHostedReturnPolling(returnId, async (status) => {
      setReturnState(status.state);
      if (status.state !== "CONFIRMING") {
        await loadCheckout();
        router.refresh();
      }
    }, { immediate: true });
  }, [loadCheckout, returnId, router]);

  useEffect(() => {
    if (
      !sdkReady
      || checkout?.state !== "READY"
      || !checkout.square
      || !window.Square
      || cardRef.current
      || applePayRef.current
      || googlePayRef.current
    ) {
      return;
    }
    let active = true;
    void (async () => {
      let card: SquareCard | null = null;
      let applePay: SquareWallet | null = null;
      let googlePay: SquareGooglePay | null = null;
      try {
        const payments = await window.Square!.payments(
          checkout.square!.applicationId,
          checkout.square!.locationId,
        );
        const request = payments.paymentRequest({
          countryCode: "US",
          currencyCode: "USD",
          total: {
            amount: (checkout.amountCents / 100).toFixed(2),
            label: "IMSDA Events registration",
          },
        });

        const [cardResult, applePayResult, googlePayResult] =
          await Promise.allSettled([
            payments.card().then(async (nextCard) => {
              await withTimeout(nextCard.attach(`#${cardContainerId}`), SQUARE_LOAD_TIMEOUT_MS);
              return nextCard;
            }),
            payments.applePay(request),
            payments.googlePay(request).then(async (nextGooglePay) => {
              await withTimeout(nextGooglePay.attach(`#${googlePayContainerId}`), SQUARE_LOAD_TIMEOUT_MS);
              return nextGooglePay;
            }),
          ]);
        card = cardResult.status === "fulfilled" ? cardResult.value : null;
        applePay = applePayResult.status === "fulfilled"
          ? applePayResult.value
          : null;
        googlePay = googlePayResult.status === "fulfilled"
          ? googlePayResult.value
          : null;

        if (!active) {
          destroyPaymentMethod(card);
          destroyPaymentMethod(applePay);
          destroyPaymentMethod(googlePay);
          return;
        }
        cardRef.current = card;
        applePayRef.current = applePay;
        googlePayRef.current = googlePay;
        setCardReady(Boolean(card));
        setApplePayReady(Boolean(applePay));
        setGooglePayReady(Boolean(googlePay));
        if (!card && !applePay && !googlePay) {
          setSdkFailed(true);
        } else if (!card) {
          setNotice({
            tone: "pending",
            message: "Card entry is unavailable in this browser, but an available wallet can still be used.",
          });
        }
      } catch {
        destroyPaymentMethod(card);
        destroyPaymentMethod(applePay);
        destroyPaymentMethod(googlePay);
        if (active) setSdkFailed(true);
      }
    })();
    return () => {
      active = false;
      const card = cardRef.current;
      const applePay = applePayRef.current;
      const googlePay = googlePayRef.current;
      cardRef.current = null;
      applePayRef.current = null;
      googlePayRef.current = null;
      setCardReady(false);
      setApplePayReady(false);
      setGooglePayReady(false);
      destroyPaymentMethod(card);
      destroyPaymentMethod(applePay);
      destroyPaymentMethod(googlePay);
    };
  }, [cardContainerId, checkout, googlePayContainerId, sdkReady, loadAttempt]);

  // A blocker can hold Square's script request open without refusing it: after a while, say so instead of waiting forever.
  const squareWaiting = checkout?.state === "READY" && Boolean(checkout.square) && !sdkReady && !sdkFailed;
  useEffect(() => {
    if (!squareWaiting) return;
    const timer = window.setTimeout(() => setSdkFailed(true), SQUARE_LOAD_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [squareWaiting, loadAttempt]);

  function retrySquareLoad() {
    setSdkFailed(false);
    setNotice(null);
    // A script that already loaded only needs its card form built again; one that failed is requested again.
    setSdkReady(typeof window !== "undefined" && Boolean(window.Square));
    setLoadAttempt((attempt) => attempt + 1);
  }

  function clearPaymentAttempt() {
    idempotencyKeyRef.current = null;
    sourceIdRef.current = null;
    sourceMethodRef.current = null;
  }

  function beginPayment(
    method: PaymentMethodKind,
    tokenize: () => Promise<SquareTokenResult>,
  ) {
    if (!checkout || checkout.state !== "READY" || submittingMethod) return;
    if (
      sourceIdRef.current
      && sourceMethodRef.current
      && sourceMethodRef.current !== method
    ) {
      setNotice({
        tone: "pending",
        message: `First retry the ${methodLabel(sourceMethodRef.current)} payment so Square can confirm its result.`,
      });
      return;
    }

    // Apple requires tokenize() to be invoked directly from its click handler,
    // with no awaited work in between. Start every payment method synchronously
    // here, then hand the promise to the shared server-submission flow.
    let tokenization: Promise<SquareTokenResult> | null = null;
    try {
      if (!sourceIdRef.current) tokenization = tokenize();
    } catch {
      setNotice({
        tone: "error",
        message: `${methodLabel(method)} could not be opened. Try again or choose another payment method.`,
      });
      return;
    }
    setSubmittingMethod(method);
    setNotice(null);
    setSiteUpdating(false);
    void completePayment(method, tokenization);
  }

  function retryPayment(method: PaymentMethodKind) {
    if (submittingMethod || !sourceIdRef.current) return;
    setSubmittingMethod(method);
    setNotice(null);
    setSiteUpdating(false);
    void completePayment(method, null);
  }

  async function completePayment(
    method: PaymentMethodKind,
    tokenization: Promise<SquareTokenResult> | null,
  ) {
    try {
      let sourceId = sourceIdRef.current;
      if (!sourceId) {
        const tokenized = await tokenization!;
        if (tokenized.status !== "OK" || !tokenized.token) {
          clearPaymentAttempt();
          setNotice({
            tone: "error",
            message: firstTokenizationError(
              tokenized.errors,
              `${methodLabel(method)} was not authorized. Try again or choose another payment method.`,
            ),
          });
          return;
        }
        sourceId = tokenized.token;
        sourceIdRef.current = sourceId;
        sourceMethodRef.current = method;
      }

      idempotencyKeyRef.current ??= crypto.randomUUID();
      const response = await submitJson(paymentEndpoint, {
        sourceId,
        idempotencyKey: idempotencyKeyRef.current,
        kind: checkout?.paymentKind,
      }, { idempotent: true });
      if (response.unavailable) {
        retryRef.current = () => retryPayment(method);
        setSiteUpdating(unavailableMessage(response));
        return;
      }
      const body = response.body as {
        payment?: { status: string; message: string };
        message?: string;
        retryable?: boolean;
      };
      if (!response.ok || !body.payment) {
        // A timeout (status 0) may still be running at Square: keep the key and the card token.
        if (!body.retryable && response.status !== 0) clearPaymentAttempt();
        setNotice({
          tone: body.retryable ? "pending" : "error",
          message: body.message
            ?? "Square could not complete the payment. Try again.",
        });
        return;
      }

      if (body.payment.status === "SUCCEEDED") {
        clearPaymentAttempt();
      }
      setNotice({
        tone: body.payment.status === "SUCCEEDED" ? "success" : "pending",
        message: body.payment.message,
      });
      await loadCheckout();
    } catch {
      setNotice({
        tone: "pending",
        message: "The payment result was not confirmed. It is safe to use the button again; the same request will not be charged twice.",
      });
    } finally {
      setSubmittingMethod(null);
    }
  }

  async function payOnSquare() {
    if (!checkout || checkout.state !== "READY" || submittingMethod || hostedSubmitting) return;
    setHostedSubmitting(true);
    setNotice(null);
    setSiteUpdating(false);
    try {
      hostedKeyRef.current ??= crypto.randomUUID();
      hostedReturnRef.current ??= newReturnId();
      const response = await submitJson(`${manageEndpoint}/payment-link`, {
        idempotencyKey: hostedKeyRef.current,
        returnId: hostedReturnRef.current,
        kind: checkout.paymentKind,
      }, { idempotent: true });
      if (response.unavailable) {
        retryRef.current = () => void payOnSquare();
        setSiteUpdating(unavailableMessage(response));
        return;
      }
      const body = response.body as {
        link?: { url: string };
        message?: string;
        retryable?: boolean;
      };
      if (!response.ok || !body.link?.url) {
        if (!body.retryable && response.status !== 0) {
          hostedKeyRef.current = null;
          hostedReturnRef.current = null;
        }
        setNotice({
          tone: body.retryable ? "pending" : "error",
          message: body.message ?? "The Pay on Square link could not be created. Try again.",
        });
        if (response.status === 409 || response.status === 422) await loadCheckout();
        return;
      }
      // Square returns the payer to an opaque status page, so remember where they started: their
      // private page, when they came from one. An account page has no secret in its address and
      // is reached from the return page's own link.
      if (!explicitManageEndpoint) {
        try {
          window.sessionStorage.setItem(
            hostedReturnStorageKey(hostedReturnRef.current),
            window.location.pathname,
          );
        } catch {
          // Storage is blocked; the return page then points to the confirmation email.
        }
      }
      window.location.assign(body.link.url);
    } catch {
      setNotice({
        tone: "pending",
        message: "The Pay on Square link was not confirmed. It is safe to try again; no second link is made for the same balance.",
      });
    } finally {
      setHostedSubmitting(false);
    }
  }

  function submitCardPayment() {
    if (!checkout || !cardRef.current) return;
    beginPayment("CARD", () => cardRef.current!.tokenize({
      amount: (checkout.amountCents / 100).toFixed(2),
      billingContact: checkout.billingContact ?? undefined,
      currencyCode: "USD",
      intent: "CHARGE",
      customerInitiated: true,
      sellerKeyedIn: false,
    }));
  }

  function submitApplePay() {
    if (!applePayRef.current) return;
    beginPayment("APPLE_PAY", () => applePayRef.current!.tokenize());
  }

  function submitGooglePay() {
    if (!googlePayRef.current) return;
    beginPayment("GOOGLE_PAY", () => googlePayRef.current!.tokenize());
  }

  async function savePaymentChoice(choice: "CARD" | "PAY_LATER") {
    if (
      !checkout?.paymentChoice
      || !checkout.paymentChoice.available
      || checkout.paymentChoice.locked
      || choiceSubmitting
    ) {
      return;
    }
    if (
      choiceRequestRef.current
      && choiceRequestRef.current.choice !== choice
    ) {
      setNotice({
        tone: "pending",
        message: `First retry the ${choiceRequestRef.current.choice === "CARD" ? "card" : "pay-later"} choice so we can confirm whether it was saved.`,
      });
      return;
    }

    const request = choiceRequestRef.current ?? {
      choice,
      clientRequestId: crypto.randomUUID(),
      expectedPriorOperationId:
        checkout.paymentChoice.currentOperationId,
    };
    choiceRequestRef.current = request;
    setPendingChoice(choice);
    setChoiceSubmitting(choice);
    setNotice(null);
    setSiteUpdating(false);
    try {
      const response = await submitJson(choiceEndpoint, request, { idempotent: true });
      if (response.unavailable) {
        retryRef.current = () => void savePaymentChoice(choice);
        setSiteUpdating(unavailableMessage(response));
        return;
      }
      const body = response.body as {
        paymentChoice?: {
          choice: "CARD" | "PAY_LATER";
          totalCents: number;
        };
        message?: string;
        retryable?: boolean;
      };
      if (!response.ok || !body.paymentChoice) {
        if (!body.retryable && response.status !== 0) {
          choiceRequestRef.current = null;
          setPendingChoice(null);
        }
        setNotice({
          tone: body.retryable ? "pending" : "error",
          message: body.message
            ?? "The payment choice could not be saved. Try again.",
        });
        if (
          response.status === 409
          || response.status === 422
        ) {
          await loadCheckout();
        }
        return;
      }

      choiceRequestRef.current = null;
      setPendingChoice(null);
      clearPaymentAttempt();
      setNotice({
        tone: "success",
        message: body.paymentChoice.choice === "CARD"
          ? `Card payment selected. Your secure amount is ${formatCents(body.paymentChoice.totalCents)}.`
          : "Pay later selected. No card payment will be requested online.",
      });
      await loadCheckout();
    } catch {
      setNotice({
        tone: "pending",
        message: "We could not confirm the saved choice. Use the same choice button again; the request will be replayed without adding the card fee twice.",
      });
    } finally {
      setChoiceSubmitting(null);
    }
  }

  /** Switches between the deposit and the whole balance; the quote, wallets and any Pay on Square link follow it. */
  async function chooseKind(next: "BALANCE" | "DEPOSIT") {
    if (submittingMethod || hostedSubmitting || checkout?.paymentKind === next) return;
    kindRef.current = next;
    clearPaymentAttempt();
    hostedKeyRef.current = null;
    hostedReturnRef.current = null;
    setNotice(null);
    await loadCheckout();
  }

  if (loading) {
    return (
      <div className="public-square-state is-loading" aria-live="polite">
        <LoaderCircle size={18} className="is-spinning" aria-hidden="true" />
        Checking online payment availability…
      </div>
    );
  }
  if (!checkout) return null;

  const paymentChoice = checkout.paymentChoice;
  const paymentChoiceOptions = paymentChoice
    ? paymentChoiceOptionPresentations(paymentChoice, formatCents)
    : [];
  const cardChoice = paymentChoiceOptions.find(
    (option) => option.choice === "CARD",
  );
  const payLaterChoice = paymentChoiceOptions.find(
    (option) => option.choice === "PAY_LATER",
  );
  const noticeElement = notice && (
    <div
      className={`public-square-notice is-${notice.tone}`}
      role={notice.tone === "error" ? "alert" : "status"}
    >
      {notice.tone === "success"
        ? <ShieldCheck size={18} aria-hidden="true" />
        : <TriangleAlert size={18} aria-hidden="true" />}
      <span>{notice.message}</span>
    </div>
  );
  const retryElement = siteUpdating && (
    <SubmitRetryNotice
      message={siteUpdating}
      busy={Boolean(submittingMethod) || hostedSubmitting || Boolean(choiceSubmitting)}
      onRetry={() => retryRef.current?.()}
    />
  );
  const returnElement = returnId && (
    <div
      className={`public-square-notice is-${returnState === "CONFIRMED" ? "success" : returnState === "HELD" ? "error" : "pending"}`}
      role={returnState === "HELD" ? "alert" : "status"}
    >
      {returnState === "CONFIRMED"
        ? <span className="confirm-check-icon" aria-hidden="true"><ShieldCheck size={18} aria-hidden="true" /></span>
        : returnState === "HELD"
          ? <TriangleAlert size={18} aria-hidden="true" />
          : <LoaderCircle size={18} className="is-spinning" aria-hidden="true" />}
      <span>{hostedReturnMessage(returnState ?? "CONFIRMING")}</span>
    </div>
  );
  const paymentChoicePanel = paymentChoice && (
    <section className="public-payment-choice" aria-labelledby="public-payment-choice-heading">
      <div className="public-payment-choice-heading">
        <span><CreditCard size={20} aria-hidden="true" /></span>
        <div>
          <strong id="public-payment-choice-heading">
            {paymentChoice.selected
              ? "Your payment choice"
              : "Choose how you want to pay"}
          </strong>
          <p>
            Your place is now available. Nothing is charged until you enter
            and submit payment details through Square.
          </p>
        </div>
      </div>
      <div className="public-payment-choice-options">
        <button
          type="button"
          className={cardChoice?.selected ? "is-selected" : ""}
          aria-pressed={cardChoice?.selected}
          disabled={
            !paymentChoice.available
            || paymentChoice.cardAvailable === false
            || paymentChoice.locked
            || Boolean(choiceSubmitting)
          }
          onClick={() => void savePaymentChoice("CARD")}
        >
          <span>
            <strong>
              {choiceSubmitting === "CARD"
                ? "Saving card choice…"
                : pendingChoice === "CARD"
                  ? "Retry card choice"
                  : cardChoice?.title}
            </strong>
            <small>{paymentChoice.cardAvailable === false ? "Online card payment is not available right now." : cardChoice?.detail}</small>
          </span>
          <b translate="no">{formatCents(cardChoice?.totalCents ?? 0)}</b>
        </button>
        <button
          type="button"
          className={payLaterChoice?.selected ? "is-selected" : ""}
          aria-pressed={payLaterChoice?.selected}
          disabled={
            !paymentChoice.available
            || paymentChoice.locked
            || Boolean(choiceSubmitting)
          }
          onClick={() => void savePaymentChoice("PAY_LATER")}
        >
          <span>
            <strong>
              {choiceSubmitting === "PAY_LATER"
                ? "Saving pay-later choice…"
                : pendingChoice === "PAY_LATER"
                  ? "Retry pay-later choice"
                  : payLaterChoice?.title}
            </strong>
            <small>{payLaterChoice?.detail}</small>
          </span>
          <b translate="no">{formatCents(payLaterChoice?.totalCents ?? 0)}</b>
        </button>
      </div>
      {paymentChoice.locked && (
        <p className="public-payment-choice-locked">
          This choice is locked because a payment has started or been
          recorded. Contact the event team if it needs to change.
        </p>
      )}
      {!paymentChoice.available && !paymentChoice.locked && (
        <p className="public-payment-choice-locked">
          The event team needs to review this payment total before it can be
          changed.
        </p>
      )}
      {noticeElement}
      {retryElement}
    </section>
  );

  if (checkout.state !== "READY" || !checkout.square) {
    return (
      <div className="public-payment-stack">
        {returnElement}
        {paymentChoicePanel}
        <div className={`public-square-state is-${checkout.state.toLowerCase().replaceAll("_", "-")}`}>
          {checkout.state === "NO_BALANCE" ? (
            <ShieldCheck size={19} aria-hidden="true" />
          ) : (
            <CreditCard size={19} aria-hidden="true" />
          )}
          <div>
            <strong>
              {checkout.state === "CHOICE_REQUIRED"
                ? "Choose one option above"
                : checkout.state === "NOT_CONFIGURED"
                  ? "Online payment is not available yet"
                  : checkout.state === "NO_BALANCE"
                    ? "No online payment is due"
                    : "Online payment is unavailable"}
            </strong>
            <p>{checkout.message}</p>
          </div>
        </div>
        {!paymentChoice && noticeElement}
      {!paymentChoice && retryElement}
      </div>
    );
  }

  const testModeNotice = squareTestModeNotice({ environment: checkout.square.environment, staffPreview });
  return (
    <div className="public-payment-stack">
      {returnElement}
      {paymentChoicePanel}
      <div className="public-square-checkout">
      <Script
        key={loadAttempt}
        id={`square-web-payments-${checkout.square.environment}-${loadAttempt}`}
        // A fragment makes a retry a new script to the loader (it remembers addresses it has tried); the request is the same.
        src={loadAttempt > 0 ? `${checkout.square.scriptUrl}#retry-${loadAttempt}` : checkout.square.scriptUrl}
        nonce={nonce}
        strategy="afterInteractive"
        onReady={() => {
          // A load that finishes after the give-up timer still counts.
          setSdkFailed(false);
          setSdkReady(true);
        }}
        onError={() => setSdkFailed(true)}
      />
      {sdkFailed && (
        <div className="public-square-notice is-error" data-testid="square-load-failed" role="alert">
          <TriangleAlert size={18} aria-hidden="true" />
          <div>
            <span>
              The secure card form could not load. A browser privacy setting, an ad blocker or the network may be blocking
              Square. Your registration is saved.
            </span>
            <p>
              {payLaterChoice && paymentChoice?.available && !paymentChoice.locked
                ? "You can choose Pay later in the options above."
                : "Your registration is saved, so you can still pay another way: contact the event team."}
              {checkout.hostedLink && " If this keeps failing, Pay on Square below opens Square's own page, which a blocker may stop too."}
            </p>
            <button className="secondary-button" onClick={retrySquareLoad} type="button">Try again</button>
          </div>
        </div>
      )}
      {checkout.deposit && (
        <div className="public-square-deposit-choice" role="group" aria-label="What to pay now">
          <button
            type="button"
            className={checkout.paymentKind === "DEPOSIT" ? "secondary-button is-selected" : "secondary-button"}
            aria-pressed={checkout.paymentKind === "DEPOSIT"}
            disabled={Boolean(submittingMethod) || hostedSubmitting}
            onClick={() => void chooseKind("DEPOSIT")}
          >
            Pay a deposit now: <span translate="no">{formatCents(checkout.deposit.chargeCents)}</span>
          </button>
          <button
            type="button"
            className={checkout.paymentKind === "BALANCE" ? "secondary-button is-selected" : "secondary-button"}
            aria-pressed={checkout.paymentKind === "BALANCE"}
            disabled={Boolean(submittingMethod) || hostedSubmitting}
            onClick={() => void chooseKind("BALANCE")}
          >
            Pay the whole balance
          </button>
        </div>
      )}
      {checkout.depositRecorded && (
        <p className="public-square-fee-breakdown">Your deposit is recorded and your reservation is held.</p>
      )}
      <div className="public-square-heading">
        <span><CreditCard size={20} aria-hidden="true" /></span>
        <div>
          <strong>{checkout.paymentKind === "DEPOSIT" ? "Pay the deposit of" : "Pay"} <span translate="no">{formatCents(checkout.amountCents)}</span> securely with Square</strong>
          {checkout.paymentKind === "DEPOSIT" && checkout.deposit && (
            <p className="public-square-fee-breakdown">
              Deposit <span translate="no">{formatCents(checkout.deposit.depositCents)}</span> + card processing{" "}
              <span translate="no">{formatCents(checkout.deposit.surchargeCents)}</span>. The rest,{" "}
              <span translate="no">{formatCents(checkout.deposit.balanceAfterCents)}</span>, stays as your balance and is due later.
            </p>
          )}
          {checkout.paymentKind !== "DEPOSIT" && checkout.surchargeCents > 0 && (
            <p className="public-square-fee-breakdown">
              Balance <span translate="no">{formatCents(checkout.balanceCents)}</span> + card processing{" "}
              <span translate="no">{formatCents(checkout.surchargeCents)}</span>. Paying by another method avoids
              the processing fee — contact the event team to arrange it.
            </p>
          )}
          <p>
            Use an available digital wallet or enter a card. Payment details go
            directly to Square and are never stored by IMSDA Events.
          </p>
        </div>
      </div>
      {testModeNotice && <p className="public-square-sandbox">{testModeNotice}</p>}
      <div className="public-square-wallets" aria-label="Digital wallet payment methods">
        <button
          type="button"
          aria-label={`Pay ${formatCents(checkout.amountCents)} with Apple Pay`}
          className={`public-square-apple-pay${applePayReady ? "" : " is-unavailable"}`}
          disabled={!applePayReady || Boolean(submittingMethod)}
          onClick={submitApplePay}
        />
        <div
          id={googlePayContainerId}
          className={`public-square-google-pay${googlePayReady ? "" : " is-unavailable"}`}
          onClick={submitGooglePay}
        />
      </div>
      {(applePayReady || googlePayReady) && (
        <div className="public-square-divider"><span>or enter a card</span></div>
      )}
      <div id={cardContainerId} className="public-square-card-frame" />
      <button
        type="button"
        className="public-square-pay-button"
        disabled={!cardReady || Boolean(submittingMethod)}
        onClick={submitCardPayment}
      >
        {submittingMethod === "CARD" ? (
          <><LoaderCircle size={17} className="is-spinning" /> Confirming with Square…</>
        ) : (
          <><ShieldCheck size={17} /> Pay <span translate="no">{formatCents(checkout.amountCents)}</span></>
        )}
      </button>
      {checkout.hostedLink && (
        <div className="public-square-hosted">
          <div className="public-square-divider"><span>or</span></div>
          <button
            type="button"
            className="public-square-hosted-button"
            disabled={Boolean(submittingMethod) || hostedSubmitting}
            onClick={() => void payOnSquare()}
          >
            {hostedSubmitting ? (
              <><LoaderCircle size={17} className="is-spinning" /> Opening Square…</>
            ) : (
              <><ExternalLink size={17} /> Pay on Square</>
            )}
          </button>
          <p className="public-square-hosted-note">
            Opens Square&rsquo;s own secure payment page for <span translate="no">{formatCents(checkout.amountCents)}</span>,
            the same amount. Use it if the form above does not work for you. After you pay, Square brings you back
            here, and your payment shows once Square confirms it.
          </p>
        </div>
      )}
      {!paymentChoice && noticeElement}
      {!paymentChoice && retryElement}
      </div>
    </div>
  );
}
