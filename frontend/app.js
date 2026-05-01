/**
 * ExpenseFlow — Dashboard Application
 * Login/Logout, Multi-currency conversion, Budget alerts, Notifications.
 */
(function () {
  'use strict';

  const API = window.location.origin;
  const SYMBOLS = { INR: '₹', USD: '$', EUR: '€', GBP: '£', JPY: '¥' };

  // Approximate exchange rates TO INR (base: INR=1)
  const RATES_TO_INR = { INR: 1, USD: 83.5, EUR: 91.0, GBP: 105.5, JPY: 0.56 };

  function convertToDisplay(amount, fromCurrency, toCurrency) {
    const inINR = Number(amount) * (RATES_TO_INR[fromCurrency] || 1);
    return inINR / (RATES_TO_INR[toCurrency] || 1);
  }

  const CAT_ICONS = {
    'Food & Dining': '🍽️', Transport: '🚗', 'Housing & Rent': '🏠',
    Utilities: '💡', Healthcare: '🏥', Entertainment: '🎬',
    Shopping: '🛍️', Education: '📚', Travel: '✈️',
    Insurance: '🛡️', Subscriptions: '📱', Groceries: '🛒',
    'Personal Care': '💆', 'Gifts & Donations': '🎁', Other: '📦',
  };
  const BAR_COLORS = ['bar-violet', 'bar-blue', 'bar-emerald', 'bar-amber', 'bar-rose', 'bar-cyan', 'bar-orange', 'bar-pink', 'bar-indigo'];
  const BADGE_COLORS = {
    'Food & Dining': 'badge-orange', Transport: 'badge-blue', 'Housing & Rent': 'badge-violet',
    Utilities: 'badge-cyan', Healthcare: 'badge-rose', Entertainment: 'badge-amber',
    Shopping: 'badge-pink', Education: 'badge-indigo', Travel: 'badge-emerald',
    Insurance: 'badge-violet', Subscriptions: 'badge-blue', Groceries: 'badge-emerald',
    'Personal Care': 'badge-pink', 'Gifts & Donations': 'badge-rose', Other: 'badge-violet',
  };

  // ===== DOM =====
  const $ = (s) => document.getElementById(s);

  // Login
  const loginOverlay = $('login-overlay');
  const loginForm = $('login-form');
  const loginNameInput = $('login-name');

  // Sidebar
  const sidebar = $('sidebar');
  const overlay = $('sidebar-overlay');
  const mobileMenuBtn = $('mobile-menu-btn');
  const breadcrumb = $('breadcrumb-page');

  // Form
  const form = $('expense-form');
  const submitBtn = $('submit-btn');
  const formFeedback = $('form-feedback');
  const amountInput = $('expense-amount');
  const currencySelect = $('expense-currency');
  const categorySelect = $('expense-category');
  const dateInput = $('expense-date');
  const descInput = $('expense-description');
  const currencySymbol = $('currency-symbol');

  // Filters
  const filterCat = $('filter-category');
  const sortOrder = $('sort-order');
  const filterCount = $('filter-result-count');
  const filterTotal = $('filter-result-total');

  // List states
  const listLoading = $('list-loading');
  const listError = $('list-error');
  const listEmpty = $('list-empty');
  const tableContainer = $('expense-table-container');
  const tbody = $('expense-tbody');
  const retryBtn = $('retry-btn');

  // Notifications
  const notifBtn = $('notification-btn');
  const notifDropdown = $('notification-dropdown');
  const notifDot = $('notification-dot');
  const notifList = $('notif-list');
  const notifClear = $('notif-clear');

  // Display currency
  const displayCurrencySelect = $('display-currency');
  const settingsDisplayCurrency = $('settings-display-currency');

  // Budget
  const budgetAmountInput = $('budget-amount');
  const budgetCurrencySelect = $('budget-currency');
  const saveBudgetBtn = $('save-budget-btn');
  const clearBudgetBtn = $('clear-budget-btn');
  const budgetFeedback = $('budget-feedback');
  const budgetCurrSym = $('budget-currency-sym');

  // State
  let allExpenses = [];
  let isSubmitting = false;
  let notifications = [];

  // ===== Utilities =====
  function uuid() {
    return crypto.randomUUID ? crypto.randomUUID() :
      'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
        const r = Math.random() * 16 | 0;
        return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
      });
  }

  function fmtDate(d) {
    try { return new Date(d + 'T00:00:00').toLocaleDateString('en-IN', { year: 'numeric', month: 'short', day: 'numeric' }); }
    catch { return d; }
  }

  function fmtAmt(amount, symbol) {
    const n = Number(amount);
    return symbol + n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function fmtConverted(amount, fromCurrency) {
    const dc = getDisplayCurrency();
    const converted = convertToDisplay(amount, fromCurrency, dc);
    return SYMBOLS[dc] + converted.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function getGreeting() {
    const h = new Date().getHours();
    if (h < 12) return 'Morning';
    if (h < 17) return 'Afternoon';
    return 'Evening';
  }

  function getDisplayCurrency() {
    return localStorage.getItem('ef_display_currency') || 'INR';
  }

  function setDisplayCurrency(c) {
    localStorage.setItem('ef_display_currency', c);
    displayCurrencySelect.value = c;
    if (settingsDisplayCurrency) settingsDisplayCurrency.value = c;
  }

  // ===== Authentication =====
  function getUser() {
    return localStorage.getItem('ef_user');
  }

  function setUser(name) {
    localStorage.setItem('ef_user', name);
  }

  function logout() {
    localStorage.removeItem('ef_user');
    loginOverlay.classList.remove('hidden');
    loginNameInput.value = '';
    loginNameInput.focus();
  }

  function showApp(name) {
    loginOverlay.classList.add('hidden');
    $('user-name-display').textContent = name;
    $('user-avatar').textContent = name.charAt(0).toUpperCase();
    $('greeting-name').textContent = name;
    $('settings-user-name').textContent = name;
  }

  loginForm.addEventListener('submit', e => {
    e.preventDefault();
    const name = loginNameInput.value.trim();
    if (name.length < 2) return;
    setUser(name);
    showApp(name);
    switchView('dashboard');
  });

  $('logout-btn').addEventListener('click', logout);
  $('settings-logout-btn').addEventListener('click', logout);

  // ===== Budget =====
  function getBudget() {
    const b = localStorage.getItem('ef_budget');
    return b ? JSON.parse(b) : null;
  }

  function setBudget(amount, currency) {
    localStorage.setItem('ef_budget', JSON.stringify({ amount, currency }));
  }

  function clearBudget() {
    localStorage.removeItem('ef_budget');
  }

  saveBudgetBtn.addEventListener('click', () => {
    const amt = Number(budgetAmountInput.value);
    const cur = budgetCurrencySelect.value;
    if (!amt || amt <= 0) {
      budgetFeedback.textContent = 'Enter a valid budget amount.';
      budgetFeedback.className = 'form-feedback visible error';
      return;
    }
    setBudget(amt, cur);
    budgetFeedback.textContent = '✓ Monthly budget saved!';
    budgetFeedback.className = 'form-feedback visible success';
    setTimeout(() => { budgetFeedback.className = 'form-feedback'; }, 3000);
    // Refresh dashboard
    loadDashboard();
  });

  clearBudgetBtn.addEventListener('click', () => {
    clearBudget();
    budgetAmountInput.value = '';
    budgetFeedback.textContent = 'Budget limit removed.';
    budgetFeedback.className = 'form-feedback visible success';
    setTimeout(() => { budgetFeedback.className = 'form-feedback'; }, 3000);
    loadDashboard();
  });

  budgetCurrencySelect.addEventListener('change', () => {
    budgetCurrSym.textContent = SYMBOLS[budgetCurrencySelect.value] || budgetCurrencySelect.value;
  });

  // ===== Notifications =====
  function loadNotifications() {
    const n = localStorage.getItem('ef_notifications');
    notifications = n ? JSON.parse(n) : [];
  }

  function saveNotifications() {
    localStorage.setItem('ef_notifications', JSON.stringify(notifications));
  }

  function addNotification(text, type) {
    // Prevent duplicate notifications with same text in same month
    const existing = notifications.find(n => n.text === text);
    if (existing) return;

    notifications.unshift({
      id: uuid(),
      text,
      type, // 'warn', 'danger', 'info'
      time: new Date().toISOString(),
    });
    if (notifications.length > 20) notifications = notifications.slice(0, 20);
    saveNotifications();
    renderNotifications();
  }

  function renderNotifications() {
    if (notifications.length === 0) {
      notifList.innerHTML = '<div class="notif-empty">No notifications</div>';
      notifDot.style.display = 'none';
      return;
    }

    notifDot.style.display = '';

    notifList.innerHTML = notifications.map(n => {
      const icon = n.type === 'danger' ? '🚨' : n.type === 'warn' ? '⚠️' : 'ℹ️';
      const iconClass = n.type || 'info';
      const timeAgo = getRelativeTime(n.time);
      return `
        <div class="notif-item">
          <div class="notif-icon ${iconClass}">${icon}</div>
          <div class="notif-content">
            <div class="notif-text">${n.text}</div>
            <div class="notif-time">${timeAgo}</div>
          </div>
        </div>
      `;
    }).join('');
  }

  function getRelativeTime(iso) {
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'Just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    return `${days}d ago`;
  }

  // Toggle dropdown
  notifBtn.addEventListener('click', e => {
    e.stopPropagation();
    notifDropdown.classList.toggle('open');
  });

  document.addEventListener('click', e => {
    if (!notifDropdown.contains(e.target) && e.target !== notifBtn) {
      notifDropdown.classList.remove('open');
    }
  });

  notifClear.addEventListener('click', () => {
    notifications = [];
    saveNotifications();
    renderNotifications();
  });

  // ===== Navigation =====
  const views = ['dashboard', 'add', 'expenses', 'analytics', 'settings'];
  const viewTitles = { dashboard: 'Dashboard', add: 'Add Expense', expenses: 'All Expenses', analytics: 'Analytics', settings: 'Settings' };

  function switchView(viewName) {
    views.forEach(v => {
      const el = $(`view-${v}`);
      const nav = $(`nav-${v}`);
      if (el) el.classList.toggle('active', v === viewName);
      if (nav) nav.classList.toggle('active', v === viewName);
    });
    breadcrumb.textContent = viewTitles[viewName] || viewName;

    sidebar.classList.remove('open');
    overlay.classList.remove('active');

    if (viewName === 'dashboard') loadDashboard();
    if (viewName === 'expenses') loadExpensesList();
    if (viewName === 'analytics') loadAnalytics();
    if (viewName === 'settings') loadSettings();
  }

  views.forEach(v => {
    const nav = $(`nav-${v}`);
    if (nav) nav.addEventListener('click', e => { e.preventDefault(); switchView(v); });
  });

  [$('quick-add-btn'), $('dash-add-btn'), $('empty-add-btn')].forEach(btn => {
    if (btn) btn.addEventListener('click', () => switchView('add'));
  });

  $('see-all-link')?.addEventListener('click', e => { e.preventDefault(); switchView('expenses'); });

  mobileMenuBtn?.addEventListener('click', () => {
    sidebar.classList.toggle('open');
    overlay.classList.toggle('active');
  });

  overlay?.addEventListener('click', () => {
    sidebar.classList.remove('open');
    overlay.classList.remove('active');
  });

  // Display currency change (topbar)
  displayCurrencySelect.addEventListener('change', () => {
    setDisplayCurrency(displayCurrencySelect.value);
    refreshCurrentView();
  });

  // Display currency change (settings)
  settingsDisplayCurrency.addEventListener('change', () => {
    setDisplayCurrency(settingsDisplayCurrency.value);
    refreshCurrentView();
  });

  function refreshCurrentView() {
    const activeView = document.querySelector('.view.active');
    if (!activeView) return;
    const id = activeView.id.replace('view-', '');
    if (id === 'dashboard') loadDashboard();
    if (id === 'expenses') loadExpensesList();
    if (id === 'analytics') loadAnalytics();
  }

  // ===== API =====
  async function apiGetExpenses(category, sort) {
    const p = new URLSearchParams();
    if (category) p.set('category', category);
    if (sort) p.set('sort', sort);
    const r = await fetch(`${API}/expenses${p.toString() ? '?' + p : ''}`);
    if (!r.ok) throw new Error('Failed to fetch');
    return r.json();
  }

  async function apiCreateExpense(data, key) {
    const r = await fetch(`${API}/expenses`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Idempotency-Key': key },
      body: JSON.stringify(data),
    });
    const body = await r.json();
    if (!r.ok) { const e = new Error(body.error); e.details = body.details; throw e; }
    return body;
  }

  // ===== Compute totals in display currency =====
  function computeTotalConverted(expenses) {
    const dc = getDisplayCurrency();
    let total = 0;
    expenses.forEach(e => {
      total += convertToDisplay(e.amount, e.currency, dc);
    });
    return { total, symbol: SYMBOLS[dc], currency: dc };
  }

  // ===== Dashboard =====
  async function loadDashboard() {
    try {
      const res = await apiGetExpenses('', 'date_desc');
      allExpenses = res.data;
      const dc = getDisplayCurrency();
      const sym = SYMBOLS[dc];

      // Total
      const { total } = computeTotalConverted(allExpenses);
      $('stat-total').textContent = fmtAmt(total, sym);

      // 30 Days Window
      const now = new Date();
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(now.getDate() - 30);
      thirtyDaysAgo.setHours(0, 0, 0, 0);
      
      const monthExpenses = allExpenses.filter(e => {
        return new Date(e.date) >= thirtyDaysAgo;
      });
      const monthTotal = computeTotalConverted(monthExpenses);
      $('stat-month').textContent = monthExpenses.length > 0 ? fmtAmt(monthTotal.total, sym) : '—';
      $('stat-month-count').textContent = `${monthExpenses.length} entries`;

      // Budget
      const budget = getBudget();
      const budgetCard = $('stat-budget').closest('.stat-card');
      if (budget) {
        const budgetInDisplay = convertToDisplay(budget.amount, budget.currency, dc);
        const remaining = budgetInDisplay - monthTotal.total;
        $('stat-budget').textContent = fmtAmt(Math.abs(remaining), sym);
        
        if (remaining >= 0) {
          budgetCard.className = 'stat-card budget-ok';
          $('stat-budget-label').textContent = 'Remaining this month';
          $('budget-icon').className = 'stat-card-icon icon-emerald';
        } else {
          budgetCard.className = 'stat-card budget-over';
          $('stat-budget').textContent = '−' + fmtAmt(Math.abs(remaining), sym);
          $('stat-budget-label').textContent = '⚠️ Over budget!';
          $('budget-icon').className = 'stat-card-icon icon-rose';

          const monthName = 'the last 30 days';
          addNotification(
            `You've exceeded your 30-day budget of ${fmtAmt(budgetInDisplay, sym)}. You're over by ${fmtAmt(Math.abs(remaining), sym)}.`,
            'danger'
          );
        }

        // Warning at 80%
        if (remaining >= 0 && monthTotal.total >= budgetInDisplay * 0.8) {
          addNotification(
            `Heads up! You've used 80% of your 30-day budget. Only ${fmtAmt(remaining, sym)} left.`,
            'warn'
          );
        }
      } else {
        budgetCard.className = 'stat-card';
        $('stat-budget').textContent = '—';
        $('stat-budget-label').textContent = 'Set limit in Settings';
        $('budget-icon').className = 'stat-card-icon icon-emerald';
      }

      // Entries
      $('stat-entries') && ($('stat-entries').textContent = allExpenses.length);

      // Top category
      const cats = new Set(allExpenses.map(e => e.category));
      if ($('stat-categories-count')) $('stat-categories-count').textContent = `${cats.size} categories`;
      
      if (allExpenses.length > 0) {
        const catTotals = {};
        allExpenses.forEach(e => {
          if (!catTotals[e.category]) catTotals[e.category] = 0;
          catTotals[e.category] += convertToDisplay(e.amount, e.currency, dc);
        });
        const top = Object.entries(catTotals).sort((a, b) => b[1] - a[1])[0];
        $('stat-top-cat').textContent = top[0];
        $('stat-top-cat-amount').textContent = `${Math.round((top[1] / total) * 100)}% of total`;
      }

      renderRecentExpenses(allExpenses.slice(0, 5));
      renderCategoryBreakdown(allExpenses);

    } catch (err) {
      console.error('Dashboard load error:', err);
    }
  }

  function renderRecentExpenses(expenses) {
    const body = $('recent-expenses-body');
    if (expenses.length === 0) {
      body.innerHTML = '<div class="panel-empty"><p>No expenses yet</p></div>';
      return;
    }
    const dc = getDisplayCurrency();
    const sym = SYMBOLS[dc];
    body.innerHTML = expenses.map(e => {
      const converted = convertToDisplay(e.amount, e.currency, dc);
      return `
        <div class="recent-item">
          <div class="recent-item-icon">${CAT_ICONS[e.category] || '📦'}</div>
          <div class="recent-item-info">
            <div class="recent-item-cat">${e.category}</div>
            <div class="recent-item-desc">${e.description || '—'}</div>
          </div>
          <div class="recent-item-right">
            <div class="recent-item-amount">${fmtAmt(converted, sym)}</div>
            <div class="recent-item-date">${fmtDate(e.date)}</div>
          </div>
        </div>
      `;
    }).join('');
  }

  function renderCategoryBreakdown(expenses) {
    const body = $('category-breakdown-body');
    if (expenses.length === 0) {
      body.innerHTML = '<div class="panel-empty"><p>No data available</p></div>';
      return;
    }

    const dc = getDisplayCurrency();
    const sym = SYMBOLS[dc];
    const catTotals = {};
    expenses.forEach(e => {
      if (!catTotals[e.category]) catTotals[e.category] = 0;
      catTotals[e.category] += convertToDisplay(e.amount, e.currency, dc);
    });

    const sorted = Object.entries(catTotals).sort((a, b) => b[1] - a[1]);
    const maxVal = sorted[0][1];

    body.innerHTML = sorted.map(([cat, total], i) => {
      const pct = Math.max(5, (total / maxVal) * 100);
      const barClass = BAR_COLORS[i % BAR_COLORS.length];
      return `
        <div class="cat-bar-item">
          <div class="cat-bar-header">
            <span class="cat-bar-name">${CAT_ICONS[cat] || '📦'} ${cat}</span>
            <span class="cat-bar-amount">${fmtAmt(total, sym)}</span>
          </div>
          <div class="cat-bar-track">
            <div class="cat-bar-fill ${barClass}" style="width: ${pct}%"></div>
          </div>
        </div>
      `;
    }).join('');
  }

  // ===== Expenses List =====
  async function loadExpensesList() {
    showListState('loading');
    try {
      const res = await apiGetExpenses(filterCat.value, sortOrder.value);
      allExpenses = res.data;

      const dc = getDisplayCurrency();
      const sym = SYMBOLS[dc];
      const { total } = computeTotalConverted(allExpenses);

      filterCount.textContent = `${allExpenses.length} expense${allExpenses.length !== 1 ? 's' : ''}`;
      filterTotal.textContent = allExpenses.length > 0 ? `Total: ${fmtAmt(total, sym)}` : 'Total: —';

      if (allExpenses.length === 0) {
        showListState('empty');
      } else {
        renderExpensesTable(allExpenses);
        showListState('data');
      }
    } catch (err) {
      $('list-error-message').textContent = err.message;
      showListState('error');
    }
  }

  function renderExpensesTable(expenses) {
    const dc = getDisplayCurrency();
    const sym = SYMBOLS[dc];
    tbody.innerHTML = expenses.map((e, i) => {
      const badgeClass = BADGE_COLORS[e.category] || 'badge-violet';
      const converted = convertToDisplay(e.amount, e.currency, dc);
      return `
        <tr style="animation-delay:${i * 0.03}s">
          <td class="date-cell">${fmtDate(e.date)}</td>
          <td><span class="category-badge ${badgeClass}">${e.category}</span></td>
          <td>${e.description || '<span style="color:var(--text-muted)">—</span>'}</td>
          <td class="text-right amount-cell">${fmtAmt(converted, sym)}</td>
        </tr>
      `;
    }).join('');
  }

  function showListState(state) {
    listLoading.style.display = state === 'loading' ? '' : 'none';
    listError.style.display = state === 'error' ? '' : 'none';
    listEmpty.style.display = state === 'empty' ? '' : 'none';
    tableContainer.style.display = state === 'data' ? '' : 'none';
  }

  filterCat.addEventListener('change', loadExpensesList);
  sortOrder.addEventListener('change', loadExpensesList);
  retryBtn?.addEventListener('click', loadExpensesList);

  // ===== Analytics =====
  async function loadAnalytics() {
    try {
      const res = await apiGetExpenses('', 'date_desc');
      const expenses = res.data;
      const totals = res.meta.totals;

      renderAnalyticsCategoryBars(expenses);
      renderCurrencyBreakdown(expenses, totals);
      renderTopExpenses(expenses);
    } catch (err) {
      console.error('Analytics load error:', err);
    }
  }

  function renderAnalyticsCategoryBars(expenses) {
    const body = $('analytics-category-bars');
    if (expenses.length === 0) {
      body.innerHTML = '<div class="panel-empty"><p>No data yet</p></div>';
      return;
    }

    const dc = getDisplayCurrency();
    const sym = SYMBOLS[dc];
    const catData = {};
    expenses.forEach(e => {
      if (!catData[e.category]) catData[e.category] = { total: 0, count: 0 };
      catData[e.category].total += convertToDisplay(e.amount, e.currency, dc);
      catData[e.category].count++;
    });

    const sorted = Object.entries(catData).sort((a, b) => b[1].total - a[1].total);
    const maxVal = sorted[0][1].total;

    body.innerHTML = sorted.map(([cat, data], i) => {
      const pct = Math.max(3, (data.total / maxVal) * 100);
      const barClass = BAR_COLORS[i % BAR_COLORS.length];
      return `
        <div class="cat-bar-item">
          <div class="cat-bar-header">
            <span class="cat-bar-name">${CAT_ICONS[cat] || '📦'} ${cat} <span style="color:var(--text-muted); font-weight:400; font-size:0.72rem;">(${data.count})</span></span>
            <span class="cat-bar-amount">${fmtAmt(data.total, sym)}</span>
          </div>
          <div class="cat-bar-track">
            <div class="cat-bar-fill ${barClass}" style="width: ${pct}%"></div>
          </div>
        </div>
      `;
    }).join('');
  }

  function renderCurrencyBreakdown(expenses, totals) {
    const body = $('analytics-currency');
    if (totals.length === 0) {
      body.innerHTML = '<div class="panel-empty"><p>No data yet</p></div>';
      return;
    }

    const currencyCount = {};
    expenses.forEach(e => {
      currencyCount[e.currency] = (currencyCount[e.currency] || 0) + 1;
    });

    body.innerHTML = totals.map(t => `
      <div class="currency-card">
        <div class="currency-code">
          <div class="currency-symbol-box">${t.symbol}</div>
          <div>
            <div class="currency-name">${t.currency}</div>
            <div class="currency-count">${currencyCount[t.currency] || 0} transactions</div>
          </div>
        </div>
        <div class="currency-total">${fmtAmt(t.total, t.symbol)}</div>
      </div>
    `).join('');
  }

  function renderTopExpenses(expenses) {
    const body = $('analytics-top-expenses');
    if (expenses.length === 0) {
      body.innerHTML = '<div class="panel-empty"><p>No data yet</p></div>';
      return;
    }

    const dc = getDisplayCurrency();
    const sym = SYMBOLS[dc];
    const sorted = [...expenses].map(e => ({
      ...e,
      convertedAmount: convertToDisplay(e.amount, e.currency, dc),
    })).sort((a, b) => b.convertedAmount - a.convertedAmount).slice(0, 5);

    body.innerHTML = sorted.map((e, i) => `
      <div class="top-expense-item">
        <div class="top-expense-rank">${i + 1}</div>
        <div class="top-expense-info">
          <div class="top-expense-desc">${e.description || e.category}</div>
          <div class="top-expense-cat">${e.category} · ${fmtDate(e.date)}</div>
        </div>
        <div class="top-expense-amount">${fmtAmt(e.convertedAmount, sym)}</div>
      </div>
    `).join('');
  }

  // ===== Settings =====
  function loadSettings() {
    const budget = getBudget();
    if (budget) {
      budgetAmountInput.value = budget.amount;
      budgetCurrencySelect.value = budget.currency;
      budgetCurrSym.textContent = SYMBOLS[budget.currency] || budget.currency;
    }
    const dc = getDisplayCurrency();
    settingsDisplayCurrency.value = dc;
    $('settings-user-name').textContent = getUser() || 'User';
  }

  // ===== Form Submission =====
  function validateForm() {
    let ok = true;
    document.querySelectorAll('.field-error').forEach(e => e.textContent = '');

    if (!amountInput.value || Number(amountInput.value) <= 0) {
      $('error-amount').textContent = 'Enter a valid positive amount.';
      ok = false;
    }
    if (!categorySelect.value) {
      $('error-category').textContent = 'Select a category.';
      ok = false;
    }
    if (!dateInput.value) {
      $('error-date').textContent = 'Date is required.';
      ok = false;
    } else if (new Date(dateInput.value + 'T23:59:59') > new Date()) {
      $('error-date').textContent = 'Cannot be in the future.';
      ok = false;
    }
    return ok;
  }

  form.addEventListener('submit', async e => {
    e.preventDefault();
    if (isSubmitting) return;

    formFeedback.className = 'form-feedback';
    if (!validateForm()) return;

    isSubmitting = true;
    submitBtn.disabled = true;
    submitBtn.classList.add('loading');

    try {
      await apiCreateExpense({
        amount: amountInput.value.trim(),
        currency: currencySelect.value,
        category: categorySelect.value,
        description: descInput.value.trim(),
        date: dateInput.value,
      }, uuid());

      formFeedback.textContent = '✓ Expense added successfully!';
      formFeedback.className = 'form-feedback visible success';
      form.reset();
      dateInput.value = new Date().toISOString().split('T')[0];
      currencySymbol.textContent = '₹';

      setTimeout(() => { formFeedback.className = 'form-feedback'; }, 4000);

      // Check budget after adding
      checkBudgetAfterAdd();
    } catch (err) {
      if (err.details) {
        err.details.forEach(d => {
          const el = $(`error-${d.field}`);
          if (el) el.textContent = d.message;
        });
      }
      formFeedback.textContent = err.message || 'Something went wrong.';
      formFeedback.className = 'form-feedback visible error';
    } finally {
      isSubmitting = false;
      submitBtn.disabled = false;
      submitBtn.classList.remove('loading');
    }
  });

  async function checkBudgetAfterAdd() {
    const budget = getBudget();
    if (!budget) return;
    try {
      const res = await apiGetExpenses('', 'date_desc');
      const expenses = res.data;
      const now = new Date();
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(now.getDate() - 30);
      thirtyDaysAgo.setHours(0, 0, 0, 0);
      
      const monthExpenses = expenses.filter(e => {
        return new Date(e.date) >= thirtyDaysAgo;
      });
      const dc = getDisplayCurrency();
      const sym = SYMBOLS[dc];
      const monthTotal = computeTotalConverted(monthExpenses);
      const budgetInDisplay = convertToDisplay(budget.amount, budget.currency, dc);
      const remaining = budgetInDisplay - monthTotal.total;

      if (remaining < 0) {
        addNotification(
          `You've exceeded your 30-day budget of ${fmtAmt(budgetInDisplay, sym)}. You're over by ${fmtAmt(Math.abs(remaining), sym)}.`,
          'danger'
        );
      } else if (monthTotal.total >= budgetInDisplay * 0.8) {
        addNotification(
          `Heads up! You've used 80% of your 30-day budget. Only ${fmtAmt(remaining, sym)} left.`,
          'warn'
        );
      }
    } catch (err) { /* ignore */ }
  }

  currencySelect.addEventListener('change', () => {
    currencySymbol.textContent = SYMBOLS[currencySelect.value] || currencySelect.value;
    amountInput.step = currencySelect.value === 'JPY' ? '1' : '0.01';
    amountInput.placeholder = currencySelect.value === 'JPY' ? '0' : '0.00';
  });

  // ===== Init =====
  function init() {
    $('greeting-time').textContent = getGreeting();
    dateInput.value = new Date().toISOString().split('T')[0];
    dateInput.max = new Date().toISOString().split('T')[0];

    // Load display currency
    const dc = getDisplayCurrency();
    displayCurrencySelect.value = dc;

    // Load notifications
    loadNotifications();
    renderNotifications();

    // Check auth
    const user = getUser();
    if (user) {
      showApp(user);
      switchView('dashboard');
    } else {
      loginOverlay.classList.remove('hidden');
      loginNameInput.focus();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
