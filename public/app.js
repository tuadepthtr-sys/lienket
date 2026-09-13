// AutoSell Web Dashboard & Remote Control Client Application

let soundEnabled = true;
let eventSource = null;
const accountsData = {};
let alertsData = [];
let audioCtx = null;

// DOM Elements
const connectionStatus = document.getElementById('connection-status');
const connectionText = document.getElementById('connection-text');
const soundToggleBtn = document.getElementById('sound-toggle-btn');
const soundIcon = document.getElementById('sound-icon');
const clearBtn = document.getElementById('clear-btn');
const globalEarnedEl = document.getElementById('global-earned');
const globalRateEl = document.getElementById('global-rate');
const globalSalesEl = document.getElementById('global-sales');
const activeAccountsCountEl = document.getElementById('active-accounts-count');
const threatsCountEl = document.getElementById('threats-count');
const accountsContainer = document.getElementById('accounts-container');
const accountBadge = document.getElementById('account-badge');
const alertsContainer = document.getElementById('alerts-container');
const threatIndicator = document.getElementById('threat-indicator');

// Remote Command DOM Elements
const targetSelect = document.getElementById('target-select');
const commandForm = document.getElementById('command-form');
const commandInput = document.getElementById('command-input');
const terminalLogs = document.getElementById('terminal-logs');
const commandStatusBadge = document.getElementById('command-status-badge');

// Audio Synthesizer Alarm (No external audio file needed)
function playThreatSound() {
  if (!soundEnabled) return;
  try {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioCtx.state === 'suspended') {
      audioCtx.resume();
    }
    const now = audioCtx.currentTime;

    // Siren beep 1
    const osc1 = audioCtx.createOscillator();
    const gain1 = audioCtx.createGain();
    osc1.type = 'sawtooth';
    osc1.frequency.setValueAtTime(880, now);
    osc1.frequency.exponentialRampToValueAtTime(440, now + 0.25);
    gain1.gain.setValueAtTime(0.3, now);
    gain1.gain.exponentialRampToValueAtTime(0.01, now + 0.25);
    osc1.connect(gain1);
    gain1.connect(audioCtx.destination);
    osc1.start(now);
    osc1.stop(now + 0.25);

    // Siren beep 2
    const osc2 = audioCtx.createOscillator();
    const gain2 = audioCtx.createGain();
    osc2.type = 'sawtooth';
    osc2.frequency.setValueAtTime(980, now + 0.28);
    osc2.frequency.exponentialRampToValueAtTime(520, now + 0.55);
    gain2.gain.setValueAtTime(0.35, now + 0.28);
    gain2.gain.exponentialRampToValueAtTime(0.01, now + 0.55);
    osc2.connect(gain2);
    gain2.connect(audioCtx.destination);
    osc2.start(now + 0.28);
    osc2.stop(now + 0.55);
  } catch (err) {
    console.warn('Audio play failed:', err);
  }
}

// Sound toggle button
soundToggleBtn.addEventListener('click', () => {
  soundEnabled = !soundEnabled;
  soundIcon.textContent = soundEnabled ? '🔊' : '🔇';
  soundToggleBtn.style.opacity = soundEnabled ? '1' : '0.6';
  if (soundEnabled && !audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
});

// Clear button
clearBtn.addEventListener('click', async () => {
  if (confirm('Bạn có chắc muốn xóa toàn bộ log hiện tại trên Dashboard?')) {
    try {
      await fetch('/api/clear', { method: 'POST' });
      for (const k in accountsData) delete accountsData[k];
      alertsData = [];
      renderAccounts();
      renderAlerts();
      updateGlobalStats();
      terminalLogs.innerHTML = `<div class="terminal-line system-line">[HỆ THỐNG] Đã xóa toàn bộ nhật ký.</div>`;
    } catch (e) {
      console.error(e);
    }
  }
});

function formatCurrency(amount) {
  if (isNaN(amount) || amount == null) return '$0';
  if (amount >= 1e9) return '$' + (amount / 1e9).toFixed(2) + 'B';
  if (amount >= 1e6) return '$' + (amount / 1e6).toFixed(2) + 'M';
  if (amount >= 1e3) return '$' + (amount / 1e3).toFixed(1) + 'K';
  return '$' + Math.round(amount).toLocaleString();
}

function timeAgo(timestamp) {
  const diff = Math.floor((Date.now() - timestamp) / 1000);
  if (diff < 5) return 'Vừa xong';
  if (diff < 60) return `${diff}s trước`;
  const min = Math.floor(diff / 60);
  if (min < 60) return `${min}m trước`;
  const hr = Math.floor(min / 60);
  return `${hr}h trước`;
}

function updateConnectionStatus(status, text) {
  connectionStatus.className = `status-pill status-${status}`;
  connectionText.textContent = text;
}

// Append Line to Terminal
function appendTerminalLine(text, type = 'system-line') {
  const time = new Date().toTimeString().split(' ')[0];
  const div = document.createElement('div');
  div.className = `terminal-line ${type}`;
  div.textContent = `[${time}] ${text}`;
  terminalLogs.appendChild(div);
  terminalLogs.scrollTop = terminalLogs.scrollHeight;
}

// Send Command via API
async function sendRemoteCommand(commandText, target = null) {
  const selectedTarget = target || targetSelect.value;
  let cmd = commandText.trim();
  if (!cmd) return;

  if (cmd.startsWith('/')) {
    cmd = cmd.substring(1).trim();
  }

  commandStatusBadge.textContent = 'Đang gửi...';
  commandStatusBadge.style.color = '#fbbf24';

  try {
    const res = await fetch('/api/command', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        target: selectedTarget,
        command: cmd
      })
    });
    const json = await res.json();
    if (json.status === 'ok') {
      appendTerminalLine(`➔ Đã xếp hàng lệnh /${cmd} gửi tới: [${selectedTarget === 'all' ? 'Tất cả tài khoản' : selectedTarget}]`, 'cmd-sent');
      commandStatusBadge.textContent = 'Đã gửi vào hàng đợi';
      commandStatusBadge.style.color = '#34d399';
    } else {
      appendTerminalLine(`✗ Lỗi: ${json.error}`, 'cmd-result-err');
    }
  } catch (err) {
    appendTerminalLine(`✗ Lỗi kết nối máy chủ: ${err.message}`, 'cmd-result-err');
  }

  setTimeout(() => {
    commandStatusBadge.textContent = 'Sẵn sàng';
    commandStatusBadge.style.color = 'var(--accent-green)';
  }, 2500);
}

// Handle Form Submit
commandForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const cmd = commandInput.value.trim();
  if (cmd) {
    sendRemoteCommand(cmd);
    commandInput.value = '';
  }
});

// Handle Clear Queue Button
const clearCmdBtn = document.getElementById('clear-cmd-btn');
if (clearCmdBtn) {
  clearCmdBtn.addEventListener('click', async () => {
    try {
      const res = await fetch('/api/command/clear', { method: 'POST' });
      const json = await res.json();
      appendTerminalLine('🗑 Đã xóa toàn bộ hàng đợi lệnh thành công!', 'system-line');
      commandStatusBadge.textContent = 'Hàng đợi trống';
      commandStatusBadge.style.color = 'var(--text-muted)';
      setTimeout(() => {
        commandStatusBadge.textContent = 'Sẵn sàng';
        commandStatusBadge.style.color = 'var(--accent-green)';
      }, 2000);
    } catch (err) {
      appendTerminalLine(`✗ Lỗi xóa hàng đợi: ${err.message}`, 'cmd-result-err');
    }
  });
}

// Handle Quick Action Buttons
document.querySelectorAll('.btn-quick').forEach(btn => {
  btn.addEventListener('click', () => {
    const cmd = btn.getAttribute('data-cmd');
    if (cmd) {
      if (cmd === 'QUIT' && !confirm('Bạn có chắc muốn gửi lệnh THOÁT SERVER đến tài khoản được chọn?')) {
        return;
      }
      sendRemoteCommand(cmd);
    }
  });
});

// Update Target Selector options based on active accounts
function updateTargetOptions() {
  const currentVal = targetSelect.value;
  const onlineNames = Object.keys(accountsData);

  // Keep first option
  targetSelect.innerHTML = '<option value="all">⚡ Tất cả tài khoản (All Accounts)</option>';
  for (const name of onlineNames) {
    const opt = document.createElement('option');
    opt.value = name;
    opt.textContent = `👤 ${name}`;
    if (name === currentVal) opt.selected = true;
    targetSelect.appendChild(opt);
  }
}

// Initialize SSE Connection
function connectSSE() {
  if (eventSource) {
    eventSource.close();
  }

  updateConnectionStatus('connecting', 'Đang kết nối Live...');
  eventSource = new EventSource('/api/events');

  eventSource.addEventListener('open', () => {
    updateConnectionStatus('connected', 'Live Online');
  });

  eventSource.addEventListener('init', (e) => {
    const data = JSON.parse(e.data);
    if (data.accounts) {
      for (const name in data.accounts) {
        accountsData[name] = data.accounts[name];
      }
    }
    if (data.alerts) {
      alertsData = data.alerts;
    }
    renderAccounts();
    renderAlerts();
    updateGlobalStats();
    updateTargetOptions();
  });

  eventSource.addEventListener('heartbeat', (e) => {
    const acc = JSON.parse(e.data);
    accountsData[acc.account] = acc;
    renderAccounts();
    updateGlobalStats();
    updateTargetOptions();
  });

  eventSource.addEventListener('detection', (e) => {
    const alert = JSON.parse(e.data);
    alertsData.unshift(alert);
    if (alertsData.length > 50) alertsData.pop();
    renderAlerts();
    playThreatSound();
    appendTerminalLine(`🚨 [CẢNH BÁO] Phát hiện ${alert.detectedPlayer} gần nick ${alert.account} (${alert.distance}m)!`, 'cmd-result-err');
  });

  eventSource.addEventListener('commandQueued', (e) => {
    const item = JSON.parse(e.data);
    // Already appended locally or show from other tabs
  });

  eventSource.addEventListener('commandResult', (e) => {
    const res = JSON.parse(e.data);
    const cls = res.success ? 'cmd-result-ok' : 'cmd-result-err';
    appendTerminalLine(`✓ [${res.account}] Đã thực hiện: /${res.command} (${res.message || 'Thành công'})`, cls);
  });

  eventSource.addEventListener('clear', () => {
    for (const k in accountsData) delete accountsData[k];
    alertsData = [];
    renderAccounts();
    renderAlerts();
    updateGlobalStats();
    updateTargetOptions();
  });

  eventSource.onerror = () => {
    updateConnectionStatus('disconnected', 'Mất kết nối (Đang thử lại...)');
  };
}

// Render Accounts Cards
function renderAccounts() {
  const names = Object.keys(accountsData);
  if (names.length === 0) {
    accountsContainer.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">⏳</div>
        <p class="empty-title">Chưa nhận được tín hiệu từ Minecraft</p>
        <p class="empty-desc">
          Hệ thống đã tự động kết nối với Mod. Hãy mở game Minecraft và đăng nhập vào server để bắt đầu đồng bộ dữ liệu.
        </p>
      </div>`;
    accountBadge.textContent = '0 Nick Online';
    activeAccountsCountEl.textContent = '0';
    return;
  }

  let onlineCount = 0;
  let html = '';

  for (const name of names) {
    const acc = accountsData[name];
    const isStale = (Date.now() - (acc.lastSeen || 0)) > 15000; // >15s without heartbeat

    let stateClass = 'state-farming';
    let stateLabel = acc.state || 'ONLINE';

    if (isStale) {
      stateClass = 'state-offline';
      stateLabel = 'OFFLINE / DISCONNECTED';
    } else {
      onlineCount++;
      const s = (acc.state || '').toUpperCase();
      if (s.includes('SELL')) {
        stateClass = 'state-selling';
        stateLabel = 'BÁN ĐỒ';
      } else if (s.includes('WAITING') || s.includes('10M') || s.includes('REJOIN')) {
        stateClass = 'state-waiting-10m';
        const rem = acc.reconnectCountdown > 0 ? ` (${acc.reconnectCountdown}s)` : '';
        stateLabel = 'CHỜ 10 PHÚT' + rem;
      } else if (s.includes('DEAD') || s.includes('RESPAWN')) {
        stateClass = 'state-dead';
        stateLabel = 'HỒI SINH (RESPAWN)';
      } else if (s.includes('FARM')) {
        stateClass = 'state-farming';
        stateLabel = 'FARM GHAST';
      }
    }

    const health = acc.health !== undefined ? acc.health : 20;
    const maxHealth = acc.maxHealth || 20;
    const food = acc.food !== undefined ? acc.food : 20;
    const healthPercent = Math.min(100, Math.max(0, (health / maxHealth) * 100));
    const foodPercent = Math.min(100, Math.max(0, (food / 20) * 100));

    const avatarUrl = `https://mc-heads.net/avatar/${encodeURIComponent(name)}/64`;

    html += `
      <div class="account-card" id="card-${encodeURIComponent(name)}">
        <div class="acc-top">
          <div class="acc-info">
            <img src="${avatarUrl}" alt="${name}" class="acc-avatar" onerror="this.src='data:image/svg+xml;utf8,<svg xmlns=\'http://www.w3.org/2000/svg\' width=\'40\' height=\'40\' fill=\'%2364748b\'><rect width=\'40\' height=\'40\' rx=\'8\'/></svg>'">
            <div>
              <div class="acc-name">${escapeHtml(name)}</div>
              <div class="acc-server">Server: ${escapeHtml(acc.server || 'Unknown')}</div>
            </div>
          </div>
          <span class="acc-state-tag ${stateClass}">${stateLabel}</span>
        </div>

        <div class="acc-vitals">
          <div class="vital-item">
            <div class="vital-label">
              <span>❤️ MÁU</span>
              <span>${health.toFixed(1)} / ${maxHealth}</span>
            </div>
            <div class="vital-bar-track">
              <div class="vital-bar-fill health-fill" style="width: ${healthPercent}%"></div>
            </div>
          </div>
          <div class="vital-item">
            <div class="vital-label">
              <span>🍖 THỨC ĂN</span>
              <span>${food} / 20</span>
            </div>
            <div class="vital-bar-track">
              <div class="vital-bar-fill food-fill" style="width: ${foodPercent}%"></div>
            </div>
          </div>
        </div>

        <div class="acc-details-row">
          <div class="acc-details-left">
            Kiếm được: <strong>${formatCurrency(acc.totalEarned)}</strong> (${acc.salesCount || 0} đơn)
          </div>
          <div class="acc-details-right">
            Treo: ${acc.uptime || '00:00:00'}
          </div>
        </div>
      </div>
    `;
  }

  accountsContainer.innerHTML = html;
  accountBadge.textContent = `${onlineCount} Nick Online`;
  activeAccountsCountEl.textContent = onlineCount.toString();
}

// Render Alerts Feed
function renderAlerts() {
  threatsCountEl.textContent = alertsData.length.toString();

  if (alertsData.length === 0) {
    alertsContainer.innerHTML = `
      <div class="empty-alerts">
        <span>🛡️ Không có mối đe dọa nào gần đây. Khu vực an toàn!</span>
      </div>`;
    threatIndicator.textContent = 'AN TOÀN';
    threatIndicator.className = 'threat-indicator-badge';
    return;
  }

  // Check if latest alert was within 90 seconds
  const recentAlert = (Date.now() - alertsData[0].timestamp) < 90000;
  if (recentAlert) {
    threatIndicator.textContent = '⚠️ PHÁT HIỆN NGƯỜI LẠ!';
    threatIndicator.className = 'threat-indicator-badge danger';
  } else {
    threatIndicator.textContent = 'CẢNH GIÁC';
    threatIndicator.className = 'threat-indicator-badge';
  }

  let html = '';
  for (const a of alertsData) {
    html += `
      <div class="alert-item">
        <div class="alert-top">
          <span class="alert-stranger">⚠️ Người chơi lạ: ${escapeHtml(a.detectedPlayer)}</span>
          <span class="alert-time">${timeAgo(a.timestamp)}</span>
        </div>
        <div class="alert-desc">
          Báo động bởi nick <strong>${escapeHtml(a.account)}</strong> trong bán kính <strong>${Number(a.distance).toFixed(1)} blocks</strong>. Cả 2 tài khoản đã tự thoát server.
        </div>
        <div class="alert-meta">
          <span>Server: ${escapeHtml(a.server || 'Unknown')}</span>
          ${a.myPos ? `<span>Vị trí: ${escapeHtml(a.myPos)}</span>` : ''}
        </div>
      </div>
    `;
  }

  alertsContainer.innerHTML = html;
}

// Update Global Stats
function updateGlobalStats() {
  let totalEarned = 0;
  let totalSales = 0;
  for (const name in accountsData) {
    totalEarned += (accountsData[name].totalEarned || 0);
    totalSales += (accountsData[name].salesCount || 0);
  }
  globalEarnedEl.textContent = formatCurrency(totalEarned);
  globalSalesEl.textContent = totalSales.toLocaleString();
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Initial start
connectSSE();

// Periodic tick every 2 seconds to refresh "time ago" and offline state check
setInterval(() => {
  renderAccounts();
  renderAlerts();
}, 3000);
