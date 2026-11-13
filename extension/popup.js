function render() {
  chrome.storage.local.get(
    ['geminiUsage', 'workerUrl', 'authToken', 'lastWorkerSync'],
    ({ geminiUsage, workerUrl, authToken, lastWorkerSync }) => {
      if (workerUrl) document.getElementById('workerUrl').value = workerUrl;
      if (authToken) document.getElementById('authToken').value = authToken;

      if (geminiUsage) {
        document.getElementById('daily').textContent = `${geminiUsage.dailyUsed}% used`;
        document.getElementById('dailyReset').textContent = `Reset: ${geminiUsage.dailyReset}`;
        document.getElementById('weekly').textContent = `${geminiUsage.weeklyUsed}% used`;
        document.getElementById('weeklyReset').textContent = `Reset: ${geminiUsage.weeklyReset}`;
      }
      document.getElementById('syncStatus').textContent = `Worker sync: ${lastWorkerSync || '—'}`;
    },
  );
}

document.getElementById('saveBtn').addEventListener('click', () => {
  const workerUrl = document.getElementById('workerUrl').value.trim();
  const authToken = document.getElementById('authToken').value.trim();
  chrome.storage.local.set({ workerUrl, authToken }, () => {
    document.getElementById('syncStatus').textContent = 'Worker sync: Saved';
  });
});

document.getElementById('syncBtn').addEventListener('click', () => {
  document.getElementById('syncStatus').textContent = 'Worker sync: Syncing...';
  chrome.runtime.sendMessage({ action: 'START_SYNC' });
  setTimeout(render, 3500);
});

chrome.storage.onChanged.addListener(render);
render();
