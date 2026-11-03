const $ = (selector) => document.querySelector(selector);
const loginView = $('#login-view');
const appView = $('#app-view');
const expenseDialog = $('#expense-dialog');
const expenseList = $('#expense-list');
const money = new Intl.NumberFormat('ko-KR', { style: 'currency', currency: 'KRW', maximumFractionDigits: 0 });
let expenses = [];

async function api(url, options = {}) {
  const response = await fetch(url, { headers: { 'Content-Type': 'application/json', ...options.headers }, ...options });
  if (response.status === 401 && !url.includes('/auth/login')) showLogin();
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || '요청을 처리하지 못했습니다.');
  }
  return response.status === 204 ? null : response.json();
}

function today() { return new Date().toLocaleDateString('sv-SE'); }
function currentMonth() { return today().slice(0, 7); }
function showLogin() { loginView.hidden = false; appView.hidden = true; }
async function showApp() {
  loginView.hidden = true; appView.hidden = false;
  $('#stats-month').value ||= currentMonth();
  await Promise.all([loadExpenses(), loadStats()]);
}
function toast(message) { const el = $('#toast'); el.textContent = message; el.classList.add('show'); clearTimeout(toast.timer); toast.timer = setTimeout(() => el.classList.remove('show'), 2200); }

async function loadExpenses() {
  const date = $('#date-filter').value;
  expenses = await api(`/api/expenses${date ? `?date=${encodeURIComponent(date)}` : ''}`);
  renderExpenses();
}

function renderExpenses() {
  expenseList.innerHTML = expenses.map(expense => `<tr>
    <td>${escapeHtml(expense.spentOn)}</td><td><strong>${escapeHtml(expense.item)}</strong></td>
    <td><span class="category-pill">${escapeHtml(expense.category)}</span></td><td class="amount">${money.format(expense.amount)}</td>
    <td class="row-actions"><button data-edit="${expense.id}" aria-label="수정">수정</button><button class="delete" data-delete="${expense.id}" aria-label="삭제">삭제</button></td>
  </tr>`).join('');
  $('#empty-state').hidden = expenses.length > 0;
}

async function loadStats() {
  const month = $('#stats-month').value || currentMonth();
  const stats = await api(`/api/stats?month=${encodeURIComponent(month)}`);
  $('#monthly-total').textContent = money.format(stats.monthlyTotal);
  $('#monthly-caption').textContent = `${Number(month.slice(5))}월의 누적 지출입니다.`;
  const max = Math.max(...stats.categories.map(row => row.total), 0);
  $('#category-chart').innerHTML = stats.categories.length ? stats.categories.map(row => `<div class="bar-row"><span>${escapeHtml(row.category)}</span><div class="bar-track"><div class="bar-fill" style="width:${Math.max(4, row.total / max * 100)}%"></div></div><span class="bar-value">${money.format(row.total)}</span></div>`).join('') : '<div class="chart-empty">이 달의 카테고리 지출이 없습니다.</div>';
}

function escapeHtml(value) { const el = document.createElement('div'); el.textContent = String(value); return el.innerHTML; }
function openForm(expense) {
  $('#expense-form').reset(); $('#form-error').textContent = '';
  $('#expense-id').value = expense?.id || '';
  $('#dialog-title').textContent = expense ? '지출 수정' : '지출 추가';
  $('#spent-on').value = expense?.spentOn || today();
  $('#item').value = expense?.item || ''; $('#category').value = expense?.category || ''; $('#amount').value = expense?.amount || '';
  expenseDialog.showModal();
}

$('#login-form').addEventListener('submit', async event => {
  event.preventDefault(); $('#login-error').textContent = '';
  try { await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ password: $('#password').value }) }); $('#password').value = ''; await showApp(); }
  catch (error) { $('#login-error').textContent = error.message; }
});
$('#logout-button').addEventListener('click', async () => { await api('/api/auth/logout', { method: 'POST' }); showLogin(); });
$('#open-form').addEventListener('click', () => openForm());
$('#close-dialog').addEventListener('click', () => expenseDialog.close());
$('#cancel-dialog').addEventListener('click', () => expenseDialog.close());
$('#date-filter').addEventListener('change', loadExpenses);
$('#clear-filter').addEventListener('click', () => { $('#date-filter').value = ''; loadExpenses(); });
$('#stats-month').addEventListener('change', loadStats);
expenseList.addEventListener('click', async event => {
  const editId = event.target.dataset.edit; const deleteId = event.target.dataset.delete;
  if (editId) openForm(expenses.find(item => String(item.id) === editId));
  if (deleteId && confirm('이 지출 내역을 삭제할까요?')) { try { await api(`/api/expenses/${deleteId}`, { method: 'DELETE' }); await Promise.all([loadExpenses(), loadStats()]); toast('지출 내역을 삭제했습니다.'); } catch (error) { toast(error.message); } }
});
$('#expense-form').addEventListener('submit', async event => {
  event.preventDefault(); $('#form-error').textContent = '';
  const id = $('#expense-id').value;
  const body = { spentOn: $('#spent-on').value, item: $('#item').value, category: $('#category').value, amount: Number($('#amount').value) };
  try { await api(id ? `/api/expenses/${id}` : '/api/expenses', { method: id ? 'PUT' : 'POST', body: JSON.stringify(body) }); expenseDialog.close(); await Promise.all([loadExpenses(), loadStats()]); toast(id ? '지출 내역을 수정했습니다.' : '새 지출을 기록했습니다.'); }
  catch (error) { $('#form-error').textContent = error.message; }
});

api('/api/auth/status').then(status => status.authenticated ? showApp() : showLogin()).catch(showLogin);
