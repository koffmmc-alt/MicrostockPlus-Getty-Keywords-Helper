// Getty Keywords Helper - Background Service Worker (Cloud Version)

// URL Cloudflare Worker
const API_URL = 'https://getty-api.koffmm-c.workers.dev/analyze';

// Промпт для анализа
const SYSTEM_PROMPT = `Select meanings for keywords based on image content.

Rules:
- Title/description are PRIMARY context
- Tags are secondary hints
- Skip ONLY clearly wrong meanings (e.g. "Pink - Singer" for color, "Factory" for botanical plant, geographic locations like "Plantation - Florida" unless image is from there)
- Select ALL relevant meanings, including related concepts:
  * If image shows wine bottles → select wine-related terms (winemaking, vineyard, sommelier, etc.)
  * If image shows food → select food-related terms (cooking, cuisine, gastronomy, etc.)
  * If image shows technology → select tech-related terms (innovation, digital, modern, etc.)
- When in doubt, SELECT rather than skip

Output: JSON array of FULL IDs exactly as shown in parentheses.
Example: ["term_fish market_106103", "term_salmon_15401593"]`;

// Получить License ID
async function getLicenseId() {
  const result = await chrome.storage.local.get(['licenseId']);
  return result.licenseId || '';
}

// Анализ через облачный API
async function analyzeWithAI(fileData, refinements, keywords = []) {
  const licenseId = await getLicenseId();
  
  if (!licenseId) {
    throw new Error('License ID не настроен. Нажмите на иконку расширения.');
  }
  
  // Формируем компактный промпт
  const topKeywords = keywords.slice(0, 20);
  const keywordsLine = topKeywords.length > 0 ? `Tags: ${topKeywords.join(', ')}` : '';
  
  const refsByKeyword = {};
  refinements.forEach(r => {
    const kw = r.keyword || '?';
    if (!refsByKeyword[kw]) refsByKeyword[kw] = [];
    refsByKeyword[kw].push(`${r.label} (${r.id})`);
  });
  
  const refinementsText = Object.entries(refsByKeyword)
    .map(([kw, opts]) => `${kw}: ${opts.join(' | ')}`)
    .join('\n');
  
  const prompt = `Title: ${fileData.title}
Desc: ${fileData.description}
${keywordsLine}

${refinementsText}

IDs:`;

  console.log('[Getty AI] Calling cloud API...');
  
  // Запрос к твоему серверу
  const response = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-License-ID': licenseId
    },
    body: JSON.stringify({
      systemPrompt: SYSTEM_PROMPT,
      prompt: prompt
    })
  });
  
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Unknown error' }));
    console.error('[Getty AI] API Error:', error);
    throw new Error(error.error || `HTTP ${response.status}`);
  }
  
  const data = await response.json();
  
  // Парсим ответ
  const text = data.choices?.[0]?.message?.content || '';
  const match = text.match(/\[[\s\S]*?\]/);
  const selectedIds = match ? JSON.parse(match[0]) : [];
  
  console.log('[Getty AI] Selected:', selectedIds);
  
  return { success: true, selectedIds };
}

// Обработка сообщений от content.js
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'ANALYZE') {
    analyzeWithAI(message.fileData, message.refinements, message.keywords || [])
      .then(result => sendResponse(result))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }
  
  if (message.type === 'GET_LICENSE') {
    getLicenseId().then(id => sendResponse({ licenseId: id }));
    return true;
  }
  
  if (message.type === 'INTERRUPT') {
    chrome.tabs.query({ url: '*://*.microstock.plus/*' }, (tabs) => {
      tabs.forEach(tab => {
        chrome.tabs.sendMessage(tab.id, { type: 'INTERRUPT' });
      });
    });
    sendResponse({ ok: true });
    return true;
  }
});

console.log('[Getty AI] Cloud service worker started');
