const VALID_CATEGORIES = [
  'Food & Dining',
  'Transport',
  'Housing & Rent',
  'Utilities',
  'Healthcare',
  'Entertainment',
  'Shopping',
  'Education',
  'Travel',
  'Insurance',
  'Subscriptions',
  'Groceries',
  'Personal Care',
  'Gifts & Donations',
  'Other',
];

const VALID_CURRENCIES = ['INR', 'USD', 'EUR', 'GBP', 'JPY'];

// Currency minor unit multipliers (most are 100, JPY is 1)
const CURRENCY_MINOR_UNITS = {
  INR: 100,
  USD: 100,
  EUR: 100,
  GBP: 100,
  JPY: 1,
};

const CURRENCY_SYMBOLS = {
  INR: '₹',
  USD: '$',
  EUR: '€',
  GBP: '£',
  JPY: '¥',
};

/**
 * Validate and sanitize an expense creation request body.
 * Returns { valid: true, data: {...} } or { valid: false, errors: [...] }
 */
function validateExpense(body) {
  const errors = [];

  // --- Amount ---
  if (body.amount === undefined || body.amount === null || body.amount === '') {
    errors.push({ field: 'amount', message: 'Amount is required.' });
  } else {
    const amount = Number(body.amount);
    if (isNaN(amount)) {
      errors.push({ field: 'amount', message: 'Amount must be a valid number.' });
    } else if (amount <= 0) {
      errors.push({ field: 'amount', message: 'Amount must be greater than zero.' });
    } else if (amount > 100_000_000) {
      errors.push({ field: 'amount', message: 'Amount exceeds maximum allowed value.' });
    } else {
      // Check decimal places (max 2, or 0 for JPY)
      const currency = body.currency || 'INR';
      const maxDecimals = currency === 'JPY' ? 0 : 2;
      const parts = String(body.amount).split('.');
      if (parts[1] && parts[1].length > maxDecimals) {
        errors.push({
          field: 'amount',
          message: `Amount cannot have more than ${maxDecimals} decimal places for ${currency}.`,
        });
      }
    }
  }

  // --- Currency ---
  const currency = body.currency || 'INR';
  if (!VALID_CURRENCIES.includes(currency)) {
    errors.push({
      field: 'currency',
      message: `Invalid currency. Supported: ${VALID_CURRENCIES.join(', ')}`,
    });
  }

  // --- Category ---
  if (!body.category || typeof body.category !== 'string' || !body.category.trim()) {
    errors.push({ field: 'category', message: 'Category is required.' });
  } else if (!VALID_CATEGORIES.includes(body.category.trim())) {
    errors.push({
      field: 'category',
      message: `Invalid category. Supported: ${VALID_CATEGORIES.join(', ')}`,
    });
  }

  // --- Date ---
  if (!body.date) {
    errors.push({ field: 'date', message: 'Date is required.' });
  } else {
    const dateObj = new Date(body.date);
    if (isNaN(dateObj.getTime())) {
      errors.push({ field: 'date', message: 'Date must be a valid date.' });
    } else {
      // Don't allow future dates
      const today = new Date();
      today.setHours(23, 59, 59, 999);
      if (dateObj > today) {
        errors.push({ field: 'date', message: 'Date cannot be in the future.' });
      }
    }
  }

  // --- Description (optional but sanitize) ---
  const description = typeof body.description === 'string' ? body.description.trim() : '';
  if (description.length > 500) {
    errors.push({ field: 'description', message: 'Description cannot exceed 500 characters.' });
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  // Convert amount to minor units (paise, cents, etc.)
  const minorMultiplier = CURRENCY_MINOR_UNITS[currency] || 100;
  const amountMinor = Math.round(Number(body.amount) * minorMultiplier);

  return {
    valid: true,
    data: {
      amount_minor: amountMinor,
      currency,
      category: body.category.trim(),
      description,
      date: body.date,
    },
  };
}

module.exports = {
  validateExpense,
  VALID_CATEGORIES,
  VALID_CURRENCIES,
  CURRENCY_MINOR_UNITS,
  CURRENCY_SYMBOLS,
};
