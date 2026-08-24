/**
 * RecoverFlow — Dashboard Application JavaScript
 * Coordinates API requests, simulator runs, policy gates, approvals, and audit trail rendering.
 */
(function () {
  'use strict';

  const API = window.location.origin;
  
  // Currencies details
  const SYMBOLS = { INR: '₹', USD: '$', EUR: '€', GBP: '£', JPY: '¥' };
  const RATES_TO_INR = { INR: 1, USD: 83.5, EUR: 91.0, GBP: 105.5, JPY: 0.56 };

  // Failure Reason Mapping for Icons and Labels
  const REASON_LABELS = {
    bank_timeout: 'Bank Link Timeout',
    insufficient_funds: 'Insufficient Funds',
    expired_card: 'Expired Card',
    subscription_mandate_failure: 'Subscription Mandate Decline',
    B2B_invoice_overdue: 'B2B Invoice Overdue',
  };

  const REASON_ICONS = {
    bank_timeout: '🔌',
    insufficient_funds: '💸',
    expired_card: '💳',
    subscription_mandate_failure: '🔄',
    B2B_invoice_overdue: '📄',
  };

  // Status Badges mapping for HTML classes
  const STATUS_CLASSES = {
    success: 'success',
    failed: 'failed',
    recovered: 'recovered',
    recovering: 'recovering',
    pending_approval: 'pending_approval',
    escalated: 'escalated',
  };

  const STATUS_LABELS = {
    success: '✅ Success',
    failed: '❌ Failed',
    recovered: '🟢 Recovered',
    recovering: '📨 Recovering',
    pending_approval: '⚠️ Pending Approval',
    escalated: '🧑‍💼 Escalated',
  };

  // ===== DOM Helpers =====
  const $ = (s) => document.getElementById(s);

  // Login UI
  const loginOverlay = $('login-overlay');
  const loginForm = $('login-form');
  const loginNameInput = $('login-name');

  // Sidebar
  const sidebar = $('sidebar');
  const overlay = $('sidebar-overlay');
  const mobileMenuBtn = $('mobile-menu-btn');
  const breadcrumb = $('breadcrumb-page');

  // Topbar
  const displayCurrencySelect = $('display-currency');
  const settingsDisplayCurrency = $('settings-display-currency');
  const searchInput = $('search-input');

  // Notifications dropdown
  const notifBtn = $('notification-btn');
  const notifDropdown = $('notification-dropdown');
  const notifDot = $('notification-dot');
  const notifList = $('notif-list');
  const notifClear = $('notif-clear');

  // Dashboard Stats
  const statTotal = $('stat-total');
  const statRecovered = $('stat-recovered');
  const statRecoveredCount = $('stat-recovered-count');
  const statAtRisk = $('stat-at-risk');
  const statRate = $('stat-rate');
  const statRateLabel = $('stat-rate-label');

  // Dashboard Lists
  const recentExpensesBody = $('recent-expenses-body');
  const categoryBreakdownBody = $('category-breakdown-body');

  // Payments List View
  const filterStatus = $('filter-status');
  const paymentsTableBody = $('expense-tbody');
  const filterResultCount = $('filter-result-count');
  const listLoading = $('list-loading');
  const listError = $('list-error');
  const listEmpty = $('list-empty');
  const tableContainer = $('expense-table-container');

  // Inspector Panel elements
  const inspectorSide = $('inspector-side');
  const inspectorClose = $('inspector-close');
  const inspectorPlaceholder = $('inspector-placeholder');
  const auditDetailsPanel = $('audit-details-panel');

  const inspPayId = $('insp-pay-id');
  const inspPayStatus = $('insp-pay-status');
  const inspCustName = $('insp-cust-name');
  const inspCustSummary = $('insp-cust-summary');
  const inspAmount = $('insp-amount');
  const inspReasonCode = $('insp-reason-code');

  // Timelines steps contents
  const stepDetectText = $('step-detect-text');
  const stepDetectTime = $('step-detect-time');
  const stepReasonChain = $('step-reason-chain');
  const stepReasonDraft = $('step-reason-draft');
  const stepDecideText = $('step-decide-text');
  const stepDecideBadge = $('step-decide-badge');
  const stepActText = $('step-act-text');
  const stepTrackText = $('step-track-text');

  // Inspector Action Buttons
  const manualActionBar = $('manual-action-bar');
  const simulationActionBar = $('simulation-action-bar');
  const btnActionApprove = $('btn-action-approve');
  const btnActionDismiss = $('btn-action-dismiss');
  const btnActionCheckout = $('btn-action-checkout');
  const btnActionRetry = $('btn-action-retry');

  // Simulator Form
  const simulatorForm = $('simulator-form');
  const simCustomer = $('sim-customer');
  const simAmount = $('sim-amount');
  const simCurrency = $('sim-currency');
  const simFailure = $('sim-failure');
  const simFormFeedback = $('form-feedback');

  // Active States
  let allPayments = [];
  let currentInspectedPaymentId = null;
  let isSubmittingSimulator = false;
  let notifications = [];

  // ===== General Utility Functions =====
  function convertToDisplay(amountMinor, fromCurrency, toCurrency) {
    const dc = getDisplayCurrency();
    const rateFrom = RATES_TO_INR[fromCurrency] || 1;
    const rateTo = RATES_TO_INR[toCurrency || dc] || 1;

    let inINR = Number(amountMinor) * rateFrom;
    if (fromCurrency === 'JPY') {
      inINR = inINR * 100; // JPY minor unit is 1, base to paise
    }
    
    let result = inINR / rateTo;
    if (toCurrency === 'JPY' || dc === 'JPY') {
      return result / 100;
    }
    return result / 100;
  }

  function formatCurrency(amount, currency) {
    const sym = SYMBOLS[currency] || currency;
    return sym + Number(amount).toLocaleString('en-IN', {
      minimumFractionDigits: currency === 'JPY' ? 0 : 2,
      maximumFractionDigits: currency === 'JPY' ? 0 : 2
    });
  }

  // Display Currency Getters/Setters
  function getDisplayCurrency() {
    return localStorage.getItem('rf_display_currency') || 'INR';
  }

  function setDisplayCurrency(c) {
    localStorage.setItem('rf_display_currency', c);
    displayCurrencySelect.value = c;
    if (settingsDisplayCurrency) settingsDisplayCurrency.value = c;
  }

  function getFormattedTime(isoString) {
    try {
      const d = new Date(isoString);
      return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) + ', ' + d.toLocaleDateString('en-IN', { month: 'short', day: 'numeric' });
    } catch {
      return isoString;
    }
  }

  // ===== Authentication (Simulated Cookie) =====
  function getUser() {
    return localStorage.getItem('rf_user');
  }

  function setUser(name) {
    localStorage.setItem('rf_user', name);
  }

  function logout() {
    localStorage.removeItem('rf_user');
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

  // ===== Notification Manager =====
  function loadNotifications() {
    const n = localStorage.getItem('rf_notifications');
    notifications = n ? JSON.parse(n) : [];
  }

  function saveNotifications() {
    localStorage.setItem('rf_notifications', JSON.stringify(notifications));
  }

  function triggerUINotification(text, type = 'info') {
    // Avoid double notification logging
    const exists = notifications.find(n => n.text === text);
    if (exists) return;

    notifications.unshift({
      id: Math.random().toString(36).substr(2, 9),
      text,
      type, // 'warn', 'danger', 'info'
      time: new Date().toISOString()
    });

    if (notifications.length > 20) notifications.pop();
    saveNotifications();
    renderNotificationsList();
  }

  function renderNotificationsList() {
    if (notifications.length === 0) {
      notifList.innerHTML = '<div class="notif-empty">No notifications</div>';
      notifDot.style.display = 'none';
      return;
    }
    notifDot.style.display = '';
    notifList.innerHTML = notifications.map(n => {
      const icon = n.type === 'danger' ? '🚨' : n.type === 'warn' ? '⚠️' : 'ℹ️';
      return `
        <div class="notif-item">
          <div class="notif-icon ${n.type || 'info'}">${icon}</div>
          <div class="notif-content">
            <div class="notif-text">${n.text}</div>
            <div class="notif-time">${getFormattedTime(n.time)}</div>
          </div>
        </div>
      `;
    }).join('');
  }

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
    renderNotificationsList();
  });

  // ===== Navigations =====
  const views = ['dashboard', 'payments', 'policies', 'simulator', 'settings'];
  const viewTitles = {
    dashboard: 'Operations Dashboard',
    payments: 'Failed Payments Registry',
    policies: 'Safety Policies & Gates',
    simulator: 'Failure Simulator',
    settings: 'Settings'
  };

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

    // Close active inspector on view switch
    closeInspector();

    if (viewName === 'dashboard') loadDashboardData();
    if (viewName === 'payments') loadPaymentsRegistry();
    if (viewName === 'simulator') loadSimulatorCustomers();
  }

  views.forEach(v => {
    const nav = $(`nav-${v}`);
    if (nav) nav.addEventListener('click', e => { e.preventDefault(); switchView(v); });
  });

  $('dash-add-btn')?.addEventListener('click', () => switchView('simulator'));
  $('quick-add-btn')?.addEventListener('click', () => switchView('simulator'));
  $('see-all-link')?.addEventListener('click', e => { e.preventDefault(); switchView('payments'); });

  mobileMenuBtn?.addEventListener('click', () => {
    sidebar.classList.toggle('open');
    overlay.classList.toggle('active');
  });

  overlay?.addEventListener('click', () => {
    sidebar.classList.remove('open');
    overlay.classList.remove('active');
  });

  // Currency select updates
  displayCurrencySelect.addEventListener('change', () => {
    setDisplayCurrency(displayCurrencySelect.value);
    refreshActiveView();
  });

  function refreshActiveView() {
    const activeView = document.querySelector('.view.active');
    if (!activeView) return;
    const viewId = activeView.id.replace('view-', '');
    if (viewId === 'dashboard') loadDashboardData();
    if (viewId === 'payments') loadPaymentsRegistry();
  }

  // ===== Dashboard Operations Loader =====
  async function loadDashboardData() {
    try {
      const dc = getDisplayCurrency();
      const res = await fetch(`${API}/api/payments`);
      const body = await res.json();
      allPayments = body.data;
      const stats = body.meta.stats;

      // Stats card calculations (normalize INR rates returned by server to current display currency)
      const displayTotal = stats.total_revenue * RATES_TO_INR.INR / RATES_TO_INR[dc];
      const displayRecovered = stats.revenue_recovered * RATES_TO_INR.INR / RATES_TO_INR[dc];
      const displayAtRisk = stats.revenue_at_risk * RATES_TO_INR.INR / RATES_TO_INR[dc];

      statTotal.textContent = formatCurrency(displayTotal, dc);
      statRecovered.textContent = formatCurrency(displayRecovered, dc);
      statAtRisk.textContent = formatCurrency(displayAtRisk, dc);
      statRate.textContent = `${stats.recovery_rate}%`;

      // Stats label modifications
      const recoveredPayments = allPayments.filter(p => p.status === 'recovered');
      statRecoveredCount.textContent = `${recoveredPayments.length} transactions recovered`;

      const atRiskCount = allPayments.filter(p => ['failed', 'recovering', 'pending_approval', 'escalated'].includes(p.status)).length;
      $('stat-at-risk-label').textContent = `${atRiskCount} events under active recovery`;

      // Render recent stream
      renderRecentStream(allPayments.slice(0, 5));
      // Render breakdown
      renderReasonBreakdown(allPayments);

    } catch (err) {
      console.error('Failed to load dashboard metrics:', err);
    }
  }

  function renderRecentStream(payments) {
    if (payments.length === 0) {
      recentExpensesBody.innerHTML = '<div class="panel-empty"><p>No payment events logged</p></div>';
      return;
    }

    const dc = getDisplayCurrency();
    recentExpensesBody.innerHTML = payments.map(p => {
      const converted = convertToDisplay(p.amount_minor, p.currency, dc);
      const icon = REASON_ICONS[p.failure_reason_code] || '💰';
      const label = p.failure_reason_code ? REASON_LABELS[p.failure_reason_code] : 'Success';
      const badgeClass = STATUS_CLASSES[p.status] || 'success';
      const badgeLabel = STATUS_LABELS[p.status] || p.status;
      
      return `
        <div class="recent-item" style="cursor: pointer;" onclick="window.inspectPayment('${p.id}')">
          <div class="recent-item-icon">${icon}</div>
          <div class="recent-item-info">
            <div class="recent-item-cat">${p.customer_name}</div>
            <div class="recent-item-desc">${label}</div>
          </div>
          <div class="recent-item-right">
            <div class="recent-item-amount">${formatCurrency(converted, dc)}</div>
            <div>
              <span class="status-badge ${badgeClass}" style="font-size:0.65rem; padding: 2px 6px; display:inline-block; margin-top:2px;">
                ${badgeLabel}
              </span>
            </div>
          </div>
        </div>
      `;
    }).join('');
  }

  function renderReasonBreakdown(payments) {
    const failedPayments = payments.filter(p => p.failure_reason_code);
    if (failedPayments.length === 0) {
      categoryBreakdownBody.innerHTML = '<div class="panel-empty"><p>No failed transactions yet</p></div>';
      return;
    }

    const dc = getDisplayCurrency();
    const totals = {};
    failedPayments.forEach(p => {
      if (!totals[p.failure_reason_code]) totals[p.failure_reason_code] = 0;
      totals[p.failure_reason_code] += convertToDisplay(p.amount_minor, p.currency, dc);
    });

    const sorted = Object.entries(totals).sort((a, b) => b[1] - a[1]);
    const maxVal = sorted[0][1];

    const colors = ['bar-violet', 'bar-rose', 'bar-amber', 'bar-blue', 'bar-orange'];

    categoryBreakdownBody.innerHTML = sorted.map(([reason, total], i) => {
      const pct = Math.max(5, (total / maxVal) * 100);
      const barClass = colors[i % colors.length];
      const icon = REASON_ICONS[reason] || '📦';
      const label = REASON_LABELS[reason] || reason;
      
      return `
        <div class="cat-bar-item">
          <div class="cat-bar-header">
            <span class="cat-bar-name">${icon} ${label}</span>
            <span class="cat-bar-amount">${formatCurrency(total, dc)}</span>
          </div>
          <div class="cat-bar-track">
            <div class="cat-bar-fill ${barClass}" style="width: ${pct}%"></div>
          </div>
        </div>
      `;
    }).join('');
  }

  // ===== Payments Registry View =====
  async function loadPaymentsRegistry() {
    showRegistryState('loading');
    try {
      const status = filterStatus.value;
      const search = searchInput.value;
      
      const queryParams = new URLSearchParams();
      if (status) queryParams.set('status', status);
      if (search) queryParams.set('search', search);

      const res = await fetch(`${API}/api/payments?${queryParams.toString()}`);
      if (!res.ok) throw new Error('API Sync Failed');

      const body = await res.json();
      allPayments = body.data;

      filterResultCount.textContent = `${allPayments.length} payment record${allPayments.length !== 1 ? 's' : ''}`;

      if (allPayments.length === 0) {
        showRegistryState('empty');
      } else {
        renderRegistryTable(allPayments);
        showRegistryState('data');
      }
    } catch (err) {
      $('list-error-message').textContent = err.message;
      showRegistryState('error');
    }
  }

  function showRegistryState(state) {
    listLoading.style.display = state === 'loading' ? '' : 'none';
    listError.style.display = state === 'error' ? '' : 'none';
    listEmpty.style.display = state === 'empty' ? '' : 'none';
    tableContainer.style.display = state === 'data' ? '' : 'none';
  }

  function renderRegistryTable(payments) {
    const dc = getDisplayCurrency();
    paymentsTableBody.innerHTML = payments.map((p, i) => {
      const converted = convertToDisplay(p.amount_minor, p.currency, dc);
      const badgeClass = STATUS_CLASSES[p.status] || 'success';
      const badgeLabel = STATUS_LABELS[p.status] || p.status;
      const failReason = p.failure_reason_code ? REASON_LABELS[p.failure_reason_code] : '—';
      const isSelected = p.id === currentInspectedPaymentId ? 'style="background:var(--bg-active);"' : '';

      return `
        <tr ${isSelected} onclick="window.inspectPayment('${p.id}')" style="animation-delay:${i * 0.03}s; cursor:pointer;">
          <td class="date-cell">${getFormattedTime(p.created_at)}</td>
          <td><strong>${p.customer_name}</strong></td>
          <td class="text-right amount-cell"><strong>${formatCurrency(converted, dc)}</strong></td>
          <td><span style="font-size:0.8rem; color:var(--text-secondary)">${failReason}</span></td>
          <td><span class="status-badge ${badgeClass}">${badgeLabel}</span></td>
        </tr>
      `;
    }).join('');
  }

  filterStatus.addEventListener('change', loadPaymentsRegistry);
  searchInput.addEventListener('input', () => {
    // Basic debounce
    clearTimeout(window.searchDebounce);
    window.searchDebounce = setTimeout(loadPaymentsRegistry, 300);
  });
  $('retry-btn')?.addEventListener('click', loadPaymentsRegistry);

  // ===== Audit Inspector Mechanics =====
  window.inspectPayment = async function (paymentId) {
    currentInspectedPaymentId = paymentId;
    
    // Highlight selected row in table
    const rows = paymentsTableBody.querySelectorAll('tr');
    allPayments.forEach((p, idx) => {
      if (rows[idx]) {
        if (p.id === paymentId) {
          rows[idx].style.background = 'var(--bg-active)';
        } else {
          rows[idx].style.background = '';
        }
      }
    });

    inspectorPlaceholder.classList.add('hidden');
    auditDetailsPanel.classList.remove('hidden');

    try {
      const res = await fetch(`${API}/api/payments/${paymentId}/audit`);
      if (!res.ok) throw new Error('Failed to load audit logs.');
      const data = await res.json();
      
      renderInspectorData(data);
    } catch (err) {
      console.error(err);
      alert('Error fetching payment audit trail.');
    }
  };

  function renderInspectorData({ payment, audit_logs, recovery_attempts }) {
    const dc = getDisplayCurrency();
    const displayAmt = convertToDisplay(payment.amount_minor, payment.currency, dc);
    
    inspPayId.textContent = payment.id;
    inspPayStatus.textContent = STATUS_LABELS[payment.status] || payment.status;
    inspPayStatus.className = `status-badge ${STATUS_CLASSES[payment.status]}`;
    
    inspCustName.textContent = payment.customer_name;
    
    const summaryLabels = {
      high_success_rate: '🌟 High Success',
      first_time_buyer: '🆕 First Time Buyer',
      frequent_failures: '⚠️ Frequent Failures'
    };
    inspCustSummary.textContent = summaryLabels[payment.payment_history_summary] || payment.payment_history_summary;
    inspAmount.textContent = formatCurrency(displayAmt, dc) + ` (${payment.currency})`;
    inspReasonCode.textContent = payment.failure_reason_code ? REASON_LABELS[payment.failure_reason_code] : 'Success';

    // Timeline Rendering
    
    // STEP 1: DETECT
    const detectLog = audit_logs.find(l => l.event_type === 'failure_detected');
    if (detectLog) {
      stepDetectText.textContent = detectLog.reason;
      stepDetectTime.textContent = getFormattedTime(detectLog.created_at);
    } else {
      stepDetectText.textContent = payment.failure_reason_code 
        ? `Payment failure of ${payment.currency} ${payment.amount_minor} detected.` 
        : 'Payment successfully initialized.';
      stepDetectTime.textContent = getFormattedTime(payment.created_at);
    }

    // STEP 2: REASON
    const aiLog = audit_logs.find(l => l.event_type === 'ai_recommendation');
    if (aiLog) {
      // Extract reasoning out of the AI log
      const reasonMatch = aiLog.reason.match(/Reasoning: "(.*?)"/);
      const reasoning = reasonMatch ? reasonMatch[1] : aiLog.reason;
      
      stepReasonChain.textContent = reasoning;
      
      const latestAttempt = recovery_attempts[0];
      if (latestAttempt && latestAttempt.message_draft) {
        stepReasonDraft.value = latestAttempt.message_draft;
        stepReasonDraft.disabled = (payment.status !== 'pending_approval');
      } else {
        // Extract message draft from log
        const draftMatch = aiLog.reason.match(/Message Draft: "(.*?)"/);
        if (draftMatch) {
          stepReasonDraft.value = draftMatch[1];
        } else {
          stepReasonDraft.value = 'N/A — System Auto-Retry';
        }
        stepReasonDraft.disabled = true;
      }
    } else {
      stepReasonChain.textContent = payment.status === 'success' 
        ? 'AI Skip: Transaction successful. No analysis required.' 
        : 'AI Analysis not triggered yet.';
      stepReasonDraft.value = '';
      stepReasonDraft.disabled = true;
    }

    // STEP 3: DECIDE
    const policyLog = audit_logs.find(l => l.event_type === 'policy_evaluation');
    if (policyLog) {
      stepDecideText.textContent = policyLog.reason;
      stepDecideBadge.textContent = policyLog.result;
      stepDecideBadge.className = `policy-badge ${policyLog.result === 'AUTHORIZED' ? 'success' : 'warn'}`;
    } else {
      stepDecideText.textContent = payment.status === 'success' 
        ? 'Policy Skip: Safe successful transaction.' 
        : 'Awaiting policy validation...';
      stepDecideBadge.textContent = 'SKIP';
      stepDecideBadge.className = 'policy-badge';
    }

    // STEP 4: ACT
    const actLog = audit_logs.find(l => l.event_type === 'action_executed');
    if (actLog) {
      stepActText.textContent = actLog.reason;
    } else {
      stepActText.textContent = payment.status === 'success'
        ? 'No recovery actions needed. Cash collected.'
        : 'Awaiting human override or scheduler dispatcher.';
    }

    // Interactive action visibility logic
    if (payment.status === 'pending_approval') {
      manualActionBar.classList.remove('hidden');
      simulationActionBar.classList.add('hidden');
    } else if (['failed', 'recovering', 'escalated'].includes(payment.status)) {
      manualActionBar.classList.add('hidden');
      simulationActionBar.classList.remove('hidden');
    } else {
      manualActionBar.classList.add('hidden');
      simulationActionBar.classList.add('hidden');
    }

    // STEP 5: TRACK
    const trackLog = audit_logs.find(l => l.event_type === 'recovery_outcome');
    if (trackLog) {
      stepTrackText.textContent = trackLog.reason;
    } else {
      if (payment.status === 'success') {
        stepTrackText.textContent = 'Revenue locked successfully. Audited.';
      } else if (payment.status === 'recovered') {
        stepTrackText.textContent = 'Resolved: Payment successfully recovered.';
      } else if (payment.status === 'recovering') {
        stepTrackText.textContent = 'Pending: Reminder sent. Awaiting customer payment.';
      } else if (payment.status === 'pending_approval') {
        stepTrackText.textContent = 'Blocked: Waiting for ops approval.';
      } else {
        stepTrackText.textContent = 'Failed: Awaiting recovery actions.';
      }
    }
  }

  function closeInspector() {
    currentInspectedPaymentId = null;
    inspectorPlaceholder.classList.remove('hidden');
    auditDetailsPanel.classList.add('hidden');
    
    // Clear selection style in table rows
    const rows = paymentsTableBody.querySelectorAll('tr');
    rows.forEach(r => r.style.background = '');
  }

  inspectorClose.addEventListener('click', closeInspector);

  // Inspector Action executions
  btnActionApprove.addEventListener('click', async () => {
    if (!currentInspectedPaymentId) return;
    const msg = stepReasonDraft.value.trim();
    
    btnActionApprove.disabled = true;
    try {
      const res = await fetch(`${API}/api/payments/${currentInspectedPaymentId}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ custom_message: msg })
      });
      if (!res.ok) throw new Error('Approval request failed.');
      
      triggerUINotification(`✓ Payment #${currentInspectedPaymentId} recovery plan approved!`, 'info');
      // Reload lists
      await refreshActiveView();
      // Re-inspect
      await inspectPayment(currentInspectedPaymentId);
    } catch (err) {
      alert(err.message);
    } finally {
      btnActionApprove.disabled = false;
    }
  });

  btnActionDismiss.addEventListener('click', async () => {
    closeInspector();
  });

  btnActionCheckout.addEventListener('click', async () => {
    if (!currentInspectedPaymentId) return;
    
    btnActionCheckout.disabled = true;
    try {
      const res = await fetch(`${API}/api/payments/${currentInspectedPaymentId}/simulate-checkout`, {
        method: 'POST'
      });
      if (!res.ok) throw new Error('Checkout simulation request failed.');
      
      triggerUINotification(`💳 Customer checkout simulated successfully! Recovered payment #${currentInspectedPaymentId}`, 'danger');
      await refreshActiveView();
      await inspectPayment(currentInspectedPaymentId);
    } catch (err) {
      alert(err.message);
    } finally {
      btnActionCheckout.disabled = false;
    }
  });

  btnActionRetry.addEventListener('click', async () => {
    if (!currentInspectedPaymentId) return;
    
    btnActionRetry.disabled = true;
    try {
      const res = await fetch(`${API}/api/payments/${currentInspectedPaymentId}/retry`, {
        method: 'POST'
      });
      if (!res.ok) throw new Error('Retry command failed.');
      
      triggerUINotification(`⚡ Gateway transaction retry dispatched for #${currentInspectedPaymentId}`, 'info');
      await refreshActiveView();
      await inspectPayment(currentInspectedPaymentId);
    } catch (err) {
      alert(err.message);
    } finally {
      btnActionRetry.disabled = false;
    }
  });

  // ===== Simulator Panel =====
  async function loadSimulatorCustomers() {
    try {
      const res = await fetch(`${API}/api/payments/customers`);
      const body = await res.json();
      const customers = body.data;

      simCustomer.innerHTML = '<option value="" disabled selected>Select customer profile...</option>' + 
        customers.map(c => {
          let summaryLabel = c.payment_history_summary === 'high_success_rate' ? '🌟 Success Profile' : c.payment_history_summary === 'frequent_failures' ? '⚠️ High Decline Rate' : '🆕 First-time Buyer';
          return `<option value="${c.id}">${c.name} (${summaryLabel})</option>`;
        }).join('');
    } catch (err) {
      console.error('Failed to load customers for simulator:', err);
    }
  }

  simulatorForm.addEventListener('submit', async e => {
    e.preventDefault();
    if (isSubmittingSimulator) return;

    simFormFeedback.className = 'form-feedback';
    simFormFeedback.textContent = '';
    
    const customerId = simCustomer.value;
    const amount = simAmount.value.trim();
    const currency = simCurrency.value;
    const failureCode = simFailure.value;

    if (!customerId || !amount || Number(amount) <= 0 || !failureCode) {
      simFormFeedback.textContent = 'Please fill out all fields with valid values.';
      simFormFeedback.className = 'form-feedback visible error';
      return;
    }

    isSubmittingSimulator = true;
    const submitBtn = simulatorForm.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    submitBtn.classList.add('loading');

    try {
      const res = await fetch(`${API}/api/payments/simulate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customer_id: customerId,
          amount,
          currency,
          failure_reason_code: failureCode
        })
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'Simulation dispatch failed');

      simFormFeedback.textContent = '✓ Failure event simulated successfully!';
      simFormFeedback.className = 'form-feedback visible success';
      
      triggerUINotification(`⚠️ Simulated failure detected: ${REASON_LABELS[failureCode]} for ${formatCurrency(amount, currency)}`, 'warn');

      // Reset form
      simulatorForm.reset();

      setTimeout(() => {
        simFormFeedback.className = 'form-feedback';
        
        // Go to failed payments list and show inspector immediately
        switchView('payments');
        inspectPayment(body.payment.id);
      }, 1000);

    } catch (err) {
      simFormFeedback.textContent = err.message || 'Something went wrong.';
      simFormFeedback.className = 'form-feedback visible error';
    } finally {
      isSubmittingSimulator = false;
      submitBtn.disabled = false;
      submitBtn.classList.remove('loading');
    }
  });

  // ===== Startup Initialization =====
  document.addEventListener('DOMContentLoaded', () => {
    loadNotifications();
    renderNotificationsList();

    const user = getUser();
    if (user) {
      showApp(user);
      switchView('dashboard');
    } else {
      loginOverlay.classList.remove('hidden');
      loginNameInput.focus();
    }
  });

})();
