// Getty Keywords Helper - Content Script v1.0

(function(){
  let aiButton = null;
  let batchButton = null;
  let interruptButton = null;
  let isProcessing = false;
  let shouldInterrupt = false;

  // === Утилиты ===
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  // Проверка License ID
  async function checkLicense() {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: 'GET_LICENSE' }, response => {
        resolve(response?.licenseId || '');
      });
    });
  }

  async function interruptibleSleep(ms) {
    const step = 100;
    for (let i = 0; i < ms; i += step) {
      if (shouldInterrupt) throw new Error('INTERRUPTED');
      await sleep(Math.min(step, ms - i));
    }
  }

  function waitFor(checkFn, timeout = 10000, interval = 300) {
    return new Promise((resolve, reject) => {
      const start = Date.now();
      const check = () => {
        if (shouldInterrupt) { reject(new Error('INTERRUPTED')); return true; }
        const result = checkFn();
        if (result) { resolve(result); return true; }
        if (Date.now() - start > timeout) { reject(new Error('Timeout')); return true; }
        return false;
      };
      if (check()) return;
      const id = setInterval(() => { if (check()) clearInterval(id); }, interval);
    });
  }

  // === Модальные окна ===
  function showModal(type, title, message, onConfirm = null) {
    const existing = document.querySelector('.getty-ai-modal');
    if (existing) existing.remove();
    
    const icons = {
      error: '⚠️',
      success: '✅',
      confirm: '❓',
      info: 'ℹ️'
    };
    
    const overlay = document.createElement('div');
    overlay.className = 'getty-ai-modal';
    overlay.innerHTML = `
      <div class="getty-ai-modal-box">
        <div class="getty-ai-modal-header">
          <span class="getty-ai-modal-icon">${icons[type] || ''}</span>
          <span class="getty-ai-modal-title">${title}</span>
        </div>
        <div class="getty-ai-modal-message">${message}</div>
        <div class="getty-ai-modal-buttons">
          ${onConfirm ? '<button class="getty-ai-modal-btn cancel">Отмена</button>' : ''}
          <button class="getty-ai-modal-btn ok">${onConfirm ? 'Да' : 'OK'}</button>
        </div>
      </div>
    `;
    
    document.body.appendChild(overlay);
    
    return new Promise((resolve) => {
      const close = (result) => {
        overlay.remove();
        resolve(result);
      };
      
      overlay.querySelector('.getty-ai-modal-btn.ok').onclick = () => close(true);
      const cancelBtn = overlay.querySelector('.getty-ai-modal-btn.cancel');
      if (cancelBtn) cancelBtn.onclick = () => close(false);
      overlay.onclick = (e) => { if (e.target === overlay) close(false); };
    });
  }

  function showError(title, message) {
    return showModal('error', title, message);
  }

  function showSuccess(title, message) {
    return showModal('success', title, message);
  }

  function showConfirm(title, message) {
    return showModal('confirm', title, message, true);
  }

  // === API через background.js ===
  async function callAI(fileData, refinements, keywords) {
    if (shouldInterrupt) throw new Error('INTERRUPTED');
    
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(
        { type: 'ANALYZE', fileData, refinements, keywords },
        response => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else if (response.success) {
            resolve(response);
          } else {
            reject(new Error(response.error || 'Unknown error'));
          }
        }
      );
    });
  }

  // === Данные ===
  function getData() {
    const t = document.querySelector('#txttitle');
    const d = document.querySelector('#txtdescription');
    return { title: t?.value || '', description: d?.value || '' };
  }

  function getKeywords() {
    // Селектор для microstock.plus
    const keywordTexts = document.querySelectorAll('.keyword .keyword_text');
    if (keywordTexts.length > 0) {
      const kws = Array.from(keywordTexts).map(el => el.textContent.trim()).filter(k => k);
      console.log('[Getty AI] Keywords found:', kws.length);
      return kws;
    }
    console.log('[Getty AI] No keywords found');
    return [];
  }

  function getRefs() {
    return Array.from(document.querySelectorAll('input[id^="term_"]')).map(cb => {
      const row = cb.closest('tr');
      const kwCell = row?.querySelector('td:first-child');
      const labelEl = cb.nextElementSibling;
      
      // Извлекаем keyword из ID: term_greenhouse_71193 -> greenhouse
      let keyword = '';
      const idMatch = cb.id.match(/^term_([a-zA-Z\s]+)_\d+$/);
      if (idMatch) {
        keyword = idMatch[1];
      } else if (kwCell) {
        keyword = kwCell.textContent.trim();
      }
      
      return {
        id: cb.id,
        keyword: keyword,
        label: labelEl?.textContent.trim() || '',
        checked: cb.checked
      };
    });
  }

  // === Выделение файлов ===
  function getSelectedFiles() {
    return Array.from(document.querySelectorAll('figure.my_files_list_item.active'));
  }

  async function clickEmptySpace() {
    const files = document.querySelectorAll('figure.my_files_list_item');
    if (!files.length) return false;
    
    const rect = files[0].getBoundingClientRect();
    let x = rect.right + 10, y = rect.top + rect.height / 2;
    if (x > window.innerWidth - 50) { x = rect.left + rect.width / 2; y = rect.bottom + 10; }
    
    const target = document.elementFromPoint(x, y);
    target?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: x, clientY: y, view: window }));
    await sleep(200);
    return true;
  }

  async function resetSelection() {
    const before = document.querySelectorAll('figure.my_files_list_item.active').length;
    if (!before) return;
    
    await clickEmptySpace();
    await sleep(300);
    
    if (document.querySelectorAll('figure.my_files_list_item.active').length > 0) {
      document.querySelectorAll('figure.my_files_list_item.active').forEach(f => f.classList.remove('active'));
      await sleep(100);
    }
  }

  async function selectSingleFile(fileEl) {
    await resetSelection();
    await interruptibleSleep(300);
    
    (fileEl.querySelector('img') || fileEl).click();
    await interruptibleSleep(300);
    
    const count = document.querySelectorAll('figure.my_files_list_item.active').length;
    if (count === 1) return true;
    
    if (count === 0) {
      fileEl.click();
      await interruptibleSleep(300);
      return document.querySelectorAll('figure.my_files_list_item.active').length === 1;
    }
    return false;
  }

  // === Обработка ===
  async function processSingle() {
    if (!aiButton) return;
    
    // Проверяем лицензию сразу
    const licenseId = await checkLicense();
    if (!licenseId) {
      showError('Ошибка', 'License ID отсутствует или неверный');
      return;
    }
    
    const fileData = getData();
    if (!fileData.title) { showError('Ошибка', 'Нет данных файла'); return; }
    const refinements = getRefs();
    if (!refinements.length) { showError('Ошибка', 'Откройте окно уточнений'); return; }
    const keywords = getKeywords();
    
    aiButton.disabled = true;
    aiButton.textContent = '...';
    
    try {
      const data = await callAI(fileData, refinements, keywords);
      if (data.success && data.selectedIds) {
        let n = 0;
        for (const id of data.selectedIds) {
          const cb = document.getElementById(id);
          if (cb && !cb.checked) { cb.click(); n++; }
        }
        aiButton.textContent = '✓ ' + n;
        aiButton.classList.add('success');
      } else {
        throw new Error(data.error || 'Ошибка');
      }
    } catch (e) {
      aiButton.textContent = 'ERR';
      aiButton.classList.add('error');
      showError('AI Error', e.message);
    }
    
    setTimeout(() => {
      aiButton.textContent = 'AI';
      aiButton.className = 'getty-ai-btn';
      aiButton.disabled = false;
    }, 2000);
  }

  async function processOneFile() {
    if (shouldInterrupt) throw new Error('INTERRUPTED');
    
    // Собираем keywords ДО открытия диалога уточнений
    const keywords = getKeywords();
    console.log('[Getty AI] Keywords:', keywords.length);
    
    const openBtn = document.querySelector('input.edit_keyword_terms');
    if (!openBtn) return false;
    openBtn.click();
    
    try {
      await waitFor(() => document.querySelectorAll('input[id^="term_"]').length > 0, 60000, 500);
    } catch (e) {
      if (e.message === 'INTERRUPTED') throw e;
      document.querySelector('#keywordTerms_dialog .btn_cancel')?.click();
      await sleep(500);
      return false;
    }
    
    await interruptibleSleep(800);
    
    const fileData = getData();
    const refinements = getRefs();
    if (!fileData.title || !refinements.length) {
      document.querySelector('#keywordTerms_dialog .btn_cancel')?.click();
      await sleep(500);
      return false;
    }
    
    try {
      const data = await callAI(fileData, refinements, keywords);
      if (data.success && data.selectedIds) {
        let n = 0;
        for (const id of data.selectedIds) {
          const cb = document.getElementById(id);
          if (cb && !cb.checked) { cb.click(); n++; }
        }
        console.log('[Getty AI] Отмечено:', n);
      }
    } catch (e) {
      if (e.message === 'INTERRUPTED') throw e;
      console.error('[Getty AI] Error:', e);
      document.querySelector('#keywordTerms_dialog .btn_cancel')?.click();
      await sleep(500);
      // Показываем ошибку и прерываем batch
      throw new Error('API_ERROR:' + e.message);
    }
    
    await interruptibleSleep(500);
    document.querySelector('#keywordTerms_dialog .btn_save')?.click();
    await interruptibleSleep(1000);
    return true;
  }

  async function cleanupOnInterrupt() {
    console.log('[Getty AI] Cleanup...');
    document.querySelector('#keywordTerms_dialog .btn_cancel')?.click();
    await sleep(300);
    document.querySelector('input.close_metadata_panel')?.click();
    await sleep(300);
    await resetSelection();
  }

  // === Пакетная обработка ===
  async function startBatchProcess() {
    if (isProcessing) return;
    
    // Проверяем License ID сразу
    const licenseId = await checkLicense();
    if (!licenseId) {
      showError('Ошибка', 'License ID отсутствует или неверный');
      return;
    }
    
    const selectedFiles = getSelectedFiles();
    if (!selectedFiles.length) { showError('No Selection', 'Выберите файлы для обработки'); return; }
    
    const fileIds = selectedFiles.map(f => f.id);
    const total = fileIds.length;
    
    const confirmed = await showConfirm('Подтверждение', 'Обработать ' + total + ' файл(ов)?');
    if (!confirmed) return;
    
    isProcessing = true;
    shouldInterrupt = false;
    showInterruptButton(true);
    let processed = 0;
    let currentFile = 0;
    
    console.log('[Getty AI] === BATCH START ===');
    console.log('[Getty AI] Files:', fileIds);
    
    await resetSelection();
    await sleep(500);
    
    try {
      for (let i = 0; i < total; i++) {
        if (shouldInterrupt) throw new Error('INTERRUPTED');
        
        currentFile = i + 1;
        updateBatchButton(currentFile + '/' + total);
        console.log('[Getty AI] --- File ' + currentFile + '/' + total + ' ---');
        
        const fileEl = document.getElementById(fileIds[i]);
        if (!fileEl) { console.log('[Getty AI] Not found'); continue; }
        
        const selected = await selectSingleFile(fileEl);
        
        if (!selected) {
          await resetSelection();
          await interruptibleSleep(300);
          (fileEl.querySelector('img') || fileEl).dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
          await interruptibleSleep(1500);
        } else {
          const editBtn = fileEl.querySelector('button.edit_button');
          if (!editBtn) { await resetSelection(); continue; }
          editBtn.click();
          await interruptibleSleep(1500);
        }
        
        let dataLoaded = false;
        try {
          await waitFor(() => {
            const t = document.querySelector('#txttitle');
            return t && t.value && t.value.trim().length > 0;
          }, 10000);
          dataLoaded = true;
        } catch (e) {
          if (e.message === 'INTERRUPTED') throw e;
        }
        
        if (!dataLoaded) {
          document.querySelector('input.close_metadata_panel')?.click();
          await sleep(500);
          await resetSelection();
          continue;
        }
        
        console.log('[Getty AI] Loaded:', getData().title?.substring(0, 40));
        
        if (await processOneFile()) processed++;
        
        if (shouldInterrupt) throw new Error('INTERRUPTED');
        
        document.querySelector('#save-metadata')?.click();
        try { await waitFor(() => document.body.innerText.includes('Успех'), 10000); } catch (e) {
          if (e.message === 'INTERRUPTED') throw e;
        }
        await interruptibleSleep(500);
        
        document.querySelector('input.close_metadata_panel')?.click();
        await interruptibleSleep(1000);
        await resetSelection();
        await interruptibleSleep(300);
      }
    } catch (e) {
      if (e.message === 'INTERRUPTED') {
        console.log('[Getty AI] ⛔ INTERRUPTED at file', currentFile);
        await cleanupOnInterrupt();
      } else if (e.message.startsWith('API_ERROR:')) {
        console.error('[Getty AI] API Error:', e);
        await cleanupOnInterrupt();
        isProcessing = false;
        showInterruptButton(false);
        updateBatchButton('AI Уточнения');
        showError('Ошибка API', e.message.replace('API_ERROR:', ''));
        return;
      } else {
        console.error('[Getty AI] Error:', e);
      }
    }
    
    isProcessing = false;
    showInterruptButton(false);
    
    console.log('[Getty AI] === DONE:', processed, '/', total, '===');
    updateBatchButton('✓ ' + processed + '/' + total);
    if (shouldInterrupt) {
      showError('Прервано', 'Обработано: ' + processed + ' из ' + total);
    } else {
      showSuccess('Готово', 'Обработано: ' + processed + ' из ' + total);
    }
    setTimeout(() => updateBatchButton('AI Уточнения'), 3000);
  }

  function interruptProcess() {
    if (isProcessing) {
      shouldInterrupt = true;
      if (interruptButton) interruptButton.textContent = '...';
      console.log('[Getty AI] ⛔ Interrupt requested');
    }
  }

  function updateBatchButton(text) {
    if (batchButton) batchButton.textContent = text;
  }

  function showInterruptButton(show) {
    if (interruptButton) {
      interruptButton.style.display = show ? 'inline-block' : 'none';
      interruptButton.textContent = 'Stop';
    }
  }

  // === UI ===
  function addModalButton() {
    if (document.querySelector('.getty-ai-btn:not(.getty-ai-batch-btn)')) return;
    const dialog = document.querySelector('#keywordTerms_dialog');
    if (!dialog || dialog.offsetParent === null) return;
    const footer = dialog.querySelector('.dialog-footer');
    if (!footer) return;
    
    aiButton = document.createElement('button');
    aiButton.type = 'button';
    aiButton.className = 'getty-ai-btn';
    aiButton.textContent = 'AI';
    aiButton.onclick = processSingle;
    footer.insertBefore(aiButton, footer.firstChild);
  }

  function addBatchButtons() {
    if (document.querySelector('.getty-ai-batch-btn')) return;
    
    const panel = document.querySelector('.my_files_actions, .content_title_many_items');
    if (!panel) return;
    
    const container = document.createElement('span');
    container.className = 'getty-ai-container';
    container.style.cssText = 'margin-left:10px;display:inline-flex;gap:5px;align-items:center;';
    
    batchButton = document.createElement('button');
    batchButton.type = 'button';
    batchButton.className = 'getty-ai-btn getty-ai-batch-btn';
    batchButton.textContent = 'AI Уточнения';
    batchButton.onclick = startBatchProcess;
    
    interruptButton = document.createElement('button');
    interruptButton.type = 'button';
    interruptButton.className = 'getty-ai-btn getty-ai-interrupt-btn';
    interruptButton.textContent = 'Stop';
    interruptButton.onclick = interruptProcess;
    interruptButton.style.display = 'none';
    
    container.appendChild(batchButton);
    container.appendChild(interruptButton);
    panel.appendChild(container);
    
    console.log('[Getty AI] UI ready');
  }

  // Слушаем команды от popup
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'INTERRUPT') {
      interruptProcess();
      sendResponse({ ok: true });
    }
    if (message.type === 'GET_STATUS') {
      sendResponse({ isProcessing: isProcessing });
    }
  });

  // === Init ===
  new MutationObserver(() => {
    const dialog = document.querySelector('#keywordTerms_dialog');
    if (dialog && dialog.offsetParent !== null) setTimeout(addModalButton, 100);
    if (!document.querySelector('.getty-ai-batch-btn')) setTimeout(addBatchButtons, 100);
  }).observe(document.body, { childList: true, subtree: true, attributes: true });

  setTimeout(addBatchButtons, 1000);
  console.log('[Getty AI] Getty Keywords Helper v1.0');
})();