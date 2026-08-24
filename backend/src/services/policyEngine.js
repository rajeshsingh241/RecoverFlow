// Approximate exchange rates to INR for threshold evaluation (minor units)
const RATES_TO_INR = {
  INR: 1.0,
  USD: 83.5,
  EUR: 91.0,
  GBP: 105.5,
  JPY: 0.56
};

// Conversions to minor units of INR (paise)
function convertToINRMinor(amountMinor, currency) {
  const rate = RATES_TO_INR[currency] || 1.0;
  // If currency is JPY (multiplier is 1, so convert JPY minor units to INR minor units)
  const isJPY = currency === 'JPY';
  
  let inINRBase = Number(amountMinor) * rate;
  if (isJPY) {
    // JPY has no minor unit in our system, so 1 JPY = 100 Paise equivalent base
    inINRBase = inINRBase * 100;
  }
  return Math.round(inINRBase);
}

/**
 * Deterministic Policy Engine for safety gates.
 * 
 * @param {Object} payment - The payment transaction object.
 * @param {Object} customer - The customer profile object.
 * @param {string} recommendedStrategy - The strategy recommended by the AI.
 * @returns {Object} Evaluation result: { authorized, requiresApproval, action, reason }
 */
function evaluatePolicy(payment, customer, recommendedStrategy) {
  const amountMinorINR = convertToINRMinor(payment.amount_minor, payment.currency);
  const amountINRDisplay = (amountMinorINR / 100).toLocaleString('en-IN', { style: 'currency', currency: 'INR' });

  // 1. High-Value safety gate: Transactions >= ₹50,000 INR equivalent require manual sign-off
  const HIGH_VALUE_THRESHOLD_PAISE = 50000 * 100; // 50,000 INR in Paise
  
  if (amountMinorINR >= HIGH_VALUE_THRESHOLD_PAISE) {
    return {
      authorized: false,
      requiresApproval: true,
      action: recommendedStrategy,
      reason: `Policy Triggered: Transaction amount (${amountINRDisplay}) exceeds the ₹50,000 safety threshold. Halting automatic recovery. Human approval required.`
    };
  }

  // 2. Strategy-specific policy checks
  if (recommendedStrategy === 'retry') {
    // Attempt limit check
    if (payment.attempt_count >= 3) {
      return {
        authorized: true,
        requiresApproval: false,
        action: 'alternative_payment_method',
        reason: `Policy Override: Max auto-retry attempts (3) reached. Overriding strategy 'retry' to 'alternative_payment_method' to prevent gateway fatigue and customer charge penalties.`
      };
    }

    // Hard failures check (insufficient funds, expired card)
    const hardFailures = ['insufficient_funds', 'expired_card'];
    if (hardFailures.includes(payment.failure_reason_code)) {
      return {
        authorized: true,
        requiresApproval: false,
        action: 'send_reminder',
        reason: `Policy Override: Automatic retry is blocked for hard failure '${payment.failure_reason_code}'. Overriding strategy to 'send_reminder' to request account action from customer.`
      };
    }

    // Chronic failures profile check
    if (customer.payment_history_summary === 'frequent_failures') {
      return {
        authorized: true,
        requiresApproval: false,
        action: 'alternative_payment_method',
        reason: `Policy Override: Customer has a chronic failure history ('frequent_failures'). Blocking auto-retry; overriding strategy to 'alternative_payment_method' to offer alternative gateways.`
      };
    }

    // Standard retry approved
    return {
      authorized: true,
      requiresApproval: false,
      action: 'retry',
      reason: `Policy Approved: Amount (${amountINRDisplay}) is below threshold, attempts (${payment.attempt_count}) < 3, and failure code '${payment.failure_reason_code}' is transient.`
    };
  }

  // 3. Communication strategies (send_reminder, alternative_payment_method) are safe by default
  return {
    authorized: true,
    requiresApproval: false,
    action: recommendedStrategy,
    reason: `Policy Approved: Safe communication-based recovery strategy '${recommendedStrategy}' authorized automatically (zero merchant financial risk).`
  };
}

module.exports = { evaluatePolicy };
