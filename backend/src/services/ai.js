const { CURRENCY_SYMBOLS, CURRENCY_MINOR_UNITS } = require('../validators/expense');

/**
 * AI Service to analyze payment failures and recommend recovery strategies.
 */
async function analyzeFailure({ customerName, historySummary, amountMinor, currency, failureCode, attemptCount }) {
  const symbol = CURRENCY_SYMBOLS[currency] || currency;
  const minorMultiplier = CURRENCY_MINOR_UNITS[currency] || 100;
  const formattedAmount = `${symbol}${(amountMinor / minorMultiplier).toFixed(currency === 'JPY' ? 0 : 2)}`;

  // 1. Try to call real LLM if API Key is configured
  if (process.env.GEMINI_API_KEY) {
    try {
      return await callGemini(customerName, historySummary, formattedAmount, currency, failureCode, attemptCount);
    } catch (err) {
      console.warn('Gemini API call failed, falling back to simulated AI:', err.message);
    }
  } else if (process.env.OPENAI_API_KEY) {
    try {
      return await callOpenAI(customerName, historySummary, formattedAmount, currency, failureCode, attemptCount);
    } catch (err) {
      console.warn('OpenAI API call failed, falling back to simulated AI:', err.message);
    }
  }

  // 2. High-fidelity simulation fallback
  return getSimulatedAnalysis(customerName, historySummary, formattedAmount, currency, failureCode, attemptCount);
}

/**
 * Call Gemini API using native fetch
 */
async function callGemini(customerName, historySummary, formattedAmount, currency, failureCode, attemptCount) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`;
  
  const systemPrompt = `You are RecoverFlow, an intelligent B2B AI revenue recovery agent.
Analyze the payment failure details and output a JSON response containing:
- "reasoning": detailed explanation of why you think this payment failed and why you chose the strategy.
- "strategy": recommended recovery strategy (must be one of: "retry", "send_reminder", "alternative_payment_method", "escalate_to_human").
- "message_draft": personalized user-friendly message to help recover this payment. For Indian currency (INR) payments, draft this in natural Hinglish (friendly blend of Hindi and English); for others, write professional English.

Return ONLY raw JSON, with no markdown code fences or backticks.`;

  const userPrompt = `Payment Failure Event:
Customer Name: ${customerName}
Payment History Profile: ${historySummary}
Amount: ${formattedAmount} (${currency})
Failure Code: ${failureCode}
Current Attempt Count: ${attemptCount}

Analyze and return JSON.`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{
        parts: [{ text: `${systemPrompt}\n\n${userPrompt}` }]
      }],
      generationConfig: {
        responseMimeType: 'application/json'
      }
    })
  });

  if (!response.ok) {
    throw new Error(`Gemini status ${response.status}`);
  }

  const result = await response.json();
  const text = result.candidates?.[0]?.content?.parts?.[0]?.text;
  return JSON.parse(text.trim());
}

/**
 * Call OpenAI API using native fetch
 */
async function callOpenAI(customerName, historySummary, formattedAmount, currency, failureCode, attemptCount) {
  const url = 'https://api.openai.com/v1/chat/completions';
  
  const systemPrompt = `You are RecoverFlow, an intelligent B2B AI revenue recovery agent.
Analyze the payment failure details and output a JSON response containing:
- "reasoning": detailed explanation of why you think this payment failed and why you chose the strategy.
- "strategy": recommended recovery strategy (must be one of: "retry", "send_reminder", "alternative_payment_method", "escalate_to_human").
- "message_draft": personalized user-friendly message to help recover this payment. For Indian currency (INR) payments, draft this in natural Hinglish (friendly blend of Hindi and English); for others, write professional English.

Return ONLY raw JSON.`;

  const userPrompt = `Payment Failure Event:
Customer Name: ${customerName}
Payment History Profile: ${historySummary}
Amount: ${formattedAmount} (${currency})
Failure Code: ${failureCode}
Current Attempt Count: ${attemptCount}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model: 'gpt-3.5-turbo',
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ]
    })
  });

  if (!response.ok) {
    throw new Error(`OpenAI status ${response.status}`);
  }

  const result = await response.json();
  const text = result.choices?.[0]?.message?.content;
  return JSON.parse(text.trim());
}

/**
 * Generate simulated LLM reasoning when API key is missing
 */
async function getSimulatedAnalysis(customerName, historySummary, formattedAmount, currency, failureCode, attemptCount) {
  // Simulate network latency for LLM call
  await new Promise(resolve => setTimeout(resolve, 600));

  const isINR = currency === 'INR';
  let reasoning = '';
  let strategy = 'send_reminder';
  let message_draft = '';

  switch (failureCode) {
    case 'bank_timeout':
      reasoning = `The transaction failed due to a BANK_TIMEOUT. This is a transient network or gateway failure. Since customer ${customerName} has a '${historySummary}' profile, the failure is highly unlikely to be credit-related. Recommending a transparent gateway retry.`;
      strategy = 'retry';
      message_draft = isINR
        ? `Hi ${customerName}, your payment of ${formattedAmount} was interrupted due to a temporary bank timeout. Don't worry, hum isse auto-retry kar rahe hain. No action needed!`
        : `Hi ${customerName}, your payment of ${formattedAmount} was interrupted due to a temporary connection issue. We are automatically retrying it for you. No action is required.`;
      break;

    case 'insufficient_funds':
      reasoning = `Hard failure: INSUFFICIENT_FUNDS. Automatically retrying this transaction will result in another fail and unnecessary bank load. The customer ${customerName} must check their account balance or fund their card. Recommending a helpful, polite reminder containing an alternative UPI payment option.`;
      strategy = 'send_reminder';
      message_draft = isINR
        ? `Hey ${customerName}, aapka ${formattedAmount} ka payment successful nahi ho paya due to insufficient funds. Please account balance check karke yahan se retry karein: https://pay.flow/p_retry`
        : `Hi ${customerName}, your payment of ${formattedAmount} failed due to insufficient funds. Please top up your account or pay using another card here: https://pay.flow/p_retry`;
      break;

    case 'expired_card':
      reasoning = `Permanent failure: EXPIRED_CARD. Gateways will instantly reject all future retries on this card token. Customer ${customerName} needs to update their credentials on file. Recommending card-update prompt.`;
      strategy = 'send_reminder';
      message_draft = isINR
        ? `Hi ${customerName}, aapka payment fail ho gaya kyunki aapka card expire ho chuka hai. Service active rakhne ke liye naya card yahan link karein: https://pay.flow/card_update`
        : `Hi ${customerName}, your payment of ${formattedAmount} failed due to an expired card. Please update your card information here to continue: https://pay.flow/card_update`;
      break;

    case 'subscription_mandate_failure':
      reasoning = `Recurring payment mandate failed. Card networks often block automated mandates. Since the customer ${customerName} has a '${historySummary}' status, sending an alternative payment method (UPI Autopay or instant link) is the fastest way to avoid churn.`;
      strategy = 'alternative_payment_method';
      message_draft = isINR
        ? `Hello ${customerName}, aapka subscription amount ${formattedAmount} auto-debit nahi ho paya. Services start rakhne ke liye yahan click karke instant payment karein: https://pay.flow/alt_pay`
        : `Hi ${customerName}, your recurring billing of ${formattedAmount} failed. You can complete the payment instantly using this checkout link: https://pay.flow/alt_pay`;
      break;

    case 'B2B_invoice_overdue':
      reasoning = `B2B corporate invoice payment is overdue. For large-value contracts, aggressive retries or automated billing blocks might damage client relationships. Escalating to human customer relations manager for Vikram/ Vikram Singh is advised.`;
      strategy = 'escalate_to_human';
      message_draft = `Dear ${customerName}, this is a gentle reminder that your invoice of ${formattedAmount} remains outstanding. Please process payment at your earliest convenience: https://pay.flow/invoice. For support, reply to this email.`;
      break;

    default:
      reasoning = `Generic payment failure (${failureCode}) detected. Attempt ${attemptCount}. Recommending recovery reminder check.`;
      strategy = 'send_reminder';
      message_draft = `Hi ${customerName}, your payment of ${formattedAmount} could not be processed. Please try again here: https://pay.flow/pay`;
  }

  return {
    reasoning,
    strategy,
    message_draft
  };
}

module.exports = { analyzeFailure };
