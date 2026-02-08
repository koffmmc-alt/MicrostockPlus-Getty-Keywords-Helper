// Getty Keywords Helper - Popup Script (Cloud Version)

const licenseInput = document.getElementById('licenseId');
const saveBtn = document.getElementById('saveBtn');
const stopBtn = document.getElementById('stopBtn');
const statusDiv = document.getElementById('status');

// Форматирование License ID - просто uppercase
licenseInput.addEventListener('input', (e) => {
  e.target.value = e.target.value.toUpperCase();
});

// Загрузка сохранённой лицензии
async function loadSettings() {
  const result = await chrome.storage.local.get(['licenseId']);
  if (result.licenseId) {
    licenseInput.value = result.licenseId;
  }
}

// Сохранение лицензии
async function saveSettings() {
  const licenseId = licenseInput.value.trim();
  
  if (!licenseId || licenseId.length < 5) {
    showStatus('Введите License ID', 'error');
    return;
  }
  
  await chrome.storage.local.set({ licenseId });
  showStatus('Сохранено!', 'success');
  
  setTimeout(() => {
    statusDiv.className = 'status';
  }, 2000);
}

// Отправка команды Stop
async function sendStop() {
  stopBtn.disabled = true;
  stopBtn.textContent = '...';
  
  try {
    await chrome.runtime.sendMessage({ type: 'INTERRUPT' });
    showStatus('Остановлено', 'success');
    stopBtn.classList.remove('visible');
  } catch (e) {
    showStatus('Ошибка остановки', 'error');
  }
  
  setTimeout(() => {
    stopBtn.disabled = false;
    stopBtn.textContent = 'Stop';
    statusDiv.className = 'status';
  }, 1500);
}

// Проверка статуса обработки
async function checkProcessingStatus() {
  try {
    const tabs = await chrome.tabs.query({ url: '*://*.microstock.plus/*' });
    for (const tab of tabs) {
      try {
        const response = await chrome.tabs.sendMessage(tab.id, { type: 'GET_STATUS' });
        if (response?.isProcessing) {
          stopBtn.classList.add('visible');
          return;
        }
      } catch (e) {
        // Tab может не иметь content script
      }
    }
    stopBtn.classList.remove('visible');
  } catch (e) {
    stopBtn.classList.remove('visible');
  }
}

// Показать статус
function showStatus(message, type) {
  statusDiv.textContent = message;
  statusDiv.className = `status ${type}`;
}

// Обработчики
saveBtn.addEventListener('click', saveSettings);
stopBtn.addEventListener('click', sendStop);

// Сохранение по Enter
licenseInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') saveSettings();
});

// Загружаем настройки при открытии
loadSettings();

// Проверяем статус обработки
checkProcessingStatus();
setInterval(checkProcessingStatus, 2000);