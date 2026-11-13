const RING_CIRCUMFERENCE = 2 * Math.PI * 28;

function getTone(remainingPct) {
  if (remainingPct <= 20) return { cls: 'is-danger', color: '#ef4444' };
  if (remainingPct <= 49) return { cls: 'is-warn', color: '#f59e0b' };
  return { cls: 'is-ok', color: '#10b981' };
}

function clampPct(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0;
  return Math.max(0, Math.min(100, num));
}

function setSyncDot(statusText) {
  const dot = document.getElementById('syncDot');
  dot.classList.remove('is-ok', 'is-warn', 'is-danger');
  const lower = String(statusText || '').toLowerCase();
  if (!statusText || statusText === '—') return;
  if (lower.includes('error') || lower.includes('fail') || lower.includes('gagal')) {
    dot.classList.add('is-danger');
  } else if (lower.includes('syncing') || lower.includes('menunggu')) {
    dot.classList.add('is-warn');
  } else {
    dot.classList.add('is-ok');
  }
}

function switchTab(tabName) {
  const statusPanel = document.getElementById('panel-status');
  const settingsPanel = document.getElementById('panel-settings');
  const buttons = document.querySelectorAll('.tab-btn');

  buttons.forEach((btn) => {
    const active = btn.dataset.tab === tabName;
    btn.classList.toggle('is-active', active);
    btn.setAttribute('aria-selected', String(active));
  });

  statusPanel.hidden = tabName !== 'status';
  settingsPanel.hidden = tabName !== 'settings';
}

function render() {
  chrome.storage.local.get(
    ['geminiUsage', 'workerUrl', 'authToken', 'lastWorkerSync'],
    ({ geminiUsage, workerUrl, authToken, lastWorkerSync }) => {
      const workerInput = document.getElementById('workerUrl');
      const tokenInput = document.getElementById('authToken');
      const openWorkerBtn = document.getElementById('openWorkerBtn');

      if (workerUrl) {
        workerInput.value = workerUrl;
        openWorkerBtn.href = workerUrl;
        openWorkerBtn.hidden = false;
      } else {
        openWorkerBtn.hidden = true;
      }
      if (authToken) tokenInput.value = authToken;

      if (geminiUsage) {
        const dailyUsed = clampPct(geminiUsage.dailyUsed);
        const dailyRemaining = 100 - dailyUsed;
        const dailyTone = getTone(dailyRemaining);

        document.getElementById('daily').textContent = `${dailyRemaining}%`;
        const dailyBadge = document.getElementById('dailyBadge');
        dailyBadge.textContent = `${dailyUsed}% used`;
        dailyBadge.className = `badge num ${dailyTone.cls}`;

        const dailyRing = document.getElementById('dailyRing');
        const offset = RING_CIRCUMFERENCE * (1 - dailyRemaining / 100);
        dailyRing.style.strokeDasharray = `${RING_CIRCUMFERENCE.toFixed(2)}`;
        dailyRing.style.strokeDashoffset = `${offset.toFixed(2)}`;
        dailyRing.style.stroke = dailyTone.color;

        document.getElementById('dailyReset').textContent = `Reset: ${geminiUsage.dailyReset || '—'}`;

        const weeklyUsed = clampPct(geminiUsage.weeklyUsed);
        const weeklyRemaining = 100 - weeklyUsed;
        const weeklyTone = getTone(weeklyRemaining);

        document.getElementById('weekly').textContent = `${weeklyRemaining}% sisa (${weeklyUsed}% used)`;
        const weeklyBar = document.getElementById('weeklyBar');
        weeklyBar.style.width = `${weeklyRemaining}%`;
        weeklyBar.style.backgroundColor = weeklyTone.color;

        document.getElementById('weeklyReset').textContent = `Reset: ${geminiUsage.weeklyReset || '—'}`;

        if (geminiUsage.lastUpdated) {
          const time = new Date(geminiUsage.lastUpdated).toLocaleTimeString('id-ID', {
            hour: '2-digit',
            minute: '2-digit',
          });
          document.getElementById('lastScraped').textContent = `Terakhir dibaca pukul ${time} · Auto-sync 15m`;
        }
      }

      const syncLabel = lastWorkerSync || 'Belum disinkronkan';
      document.getElementById('syncStatus').textContent = `Worker: ${syncLabel}`;
      setSyncDot(lastWorkerSync);
    },
  );
}

document.querySelectorAll('.tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => switchTab(btn.dataset.tab));
});

document.getElementById('toggleTokenBtn').addEventListener('click', () => {
  const input = document.getElementById('authToken');
  const btn = document.getElementById('toggleTokenBtn');
  const show = input.type === 'password';
  input.type = show ? 'text' : 'password';
  btn.innerHTML = `<i data-lucide="${show ? 'eye-off' : 'eye'}"></i>`;
  if (window.lucide) window.lucide.createIcons({ root: btn });
});

document.getElementById('saveBtn').addEventListener('click', () => {
  const workerUrl = document.getElementById('workerUrl').value.trim().replace(/\/+$/, '');
  const authToken = document.getElementById('authToken').value.trim();
  const label = document.getElementById('saveBtnLabel');

  chrome.storage.local.set({ workerUrl, authToken }, () => {
    label.textContent = 'Tersimpan';
    document.getElementById('syncStatus').textContent = 'Worker: Pengaturan disimpan';
    setSyncDot('ok');
    setTimeout(() => {
      label.textContent = 'Simpan Pengaturan';
      switchTab('status');
    }, 800);
  });
});

document.getElementById('syncBtn').addEventListener('click', () => {
  const syncBtn = document.getElementById('syncBtn');
  const label = document.getElementById('syncBtnLabel');
  const icon = syncBtn.querySelector('svg, i');

  syncBtn.disabled = true;
  label.textContent = 'Menyinkronkan...';
  if (icon) icon.classList.add('spin');

  document.getElementById('syncStatus').textContent = 'Worker: Syncing...';
  setSyncDot('syncing');
  chrome.runtime.sendMessage({ action: 'START_SYNC' });

  setTimeout(() => {
    syncBtn.disabled = false;
    label.textContent = 'Sync Sekarang';
    const currentIcon = syncBtn.querySelector('svg, i');
    if (currentIcon) currentIcon.classList.remove('spin');
    render();
  }, 3500);
});

if (window.lucide) {
  window.lucide.createIcons();
}

chrome.storage.onChanged.addListener(render);
render();
