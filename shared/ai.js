/* 大模型接口（用户自己的 API 密钥，只存在本机浏览器） */
(function (root) {
  'use strict';
  const PROVIDERS = {
    deepseek: { name: 'DeepSeek（推荐，便宜）', url: 'https://api.deepseek.com/chat/completions', model: 'deepseek-chat', site: 'https://platform.deepseek.com/api_keys' },
    qwen: { name: '通义千问', url: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', model: 'qwen-plus', site: 'https://bailian.console.aliyun.com/' },
    kimi: { name: 'Kimi', url: 'https://api.moonshot.cn/v1/chat/completions', model: 'moonshot-v1-32k', site: 'https://platform.moonshot.cn/console/api-keys' },
    doubao: { name: '豆包（火山方舟）', url: 'https://ark.cn-beijing.volces.com/api/v3/chat/completions', model: '', site: 'https://console.volcengine.com/ark' },
    claude: { name: 'Claude', url: 'https://api.anthropic.com/v1/messages', model: 'claude-sonnet-5-5', site: 'https://console.anthropic.com/' }
  };
  async function chat(cfg, prompt, signal, opts) {
    opts = opts || {};
    const p = PROVIDERS[cfg.provider] || PROVIDERS.deepseek;
    const model = (cfg.model || p.model || '').trim();
    if (!cfg.key) throw new Error('还没填 AI 的 API 密钥（在「设置」里填一次就行）');
    if (!model) throw new Error('请在「设置」里填写模型名称');
    const sys = opts.system || '你是严谨的中文新媒体营销与消费者洞察助手，只输出要求的格式。';
    let res;
    if (cfg.provider === 'claude') {
      res = await fetch(p.url, { method: 'POST', signal, headers: { 'content-type': 'application/json', 'x-api-key': cfg.key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
        body: JSON.stringify({ model, max_tokens: opts.maxTokens || 8000, system: sys, messages: [{ role: 'user', content: prompt }] }) });
    } else {
      res = await fetch(p.url, { method: 'POST', signal, headers: { 'content-type': 'application/json', authorization: 'Bearer ' + cfg.key },
        body: JSON.stringify({ model, temperature: opts.temperature ?? 0.4, max_tokens: opts.maxTokens || 8000, messages: [{ role: 'system', content: sys }, { role: 'user', content: prompt }] }) });
    }
    const txt = await res.text();
    if (!res.ok) {
      let msg = txt.slice(0, 200); try { const j = JSON.parse(txt); msg = (j.error && (j.error.message || j.error.code)) || j.message || msg; } catch (e) { /* 非 JSON */ }
      if (res.status === 401 || res.status === 403) throw new Error('API 密钥不对或没有权限：' + msg);
      if (res.status === 402) throw new Error('AI 账户余额不足：' + msg);
      if (res.status === 429) throw new Error('调用太频繁或额度用完，稍后再试：' + msg);
      throw new Error(`AI 接口出错（${res.status}）：${msg}`);
    }
    const j = JSON.parse(txt);
    return cfg.provider === 'claude' ? (j.content || []).map(c => c.text || '').join('') : (((j.choices || [])[0] || {}).message || {}).content || '';
  }
  function parseJSON(text) {
    const t = String(text || '').trim();
    try { return JSON.parse(t); } catch (e) { /* 继续 */ }
    const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/); if (fence) { try { return JSON.parse(fence[1]); } catch (e) { /* 继续 */ } }
    const starts = ['{', '['].map(c => t.indexOf(c)).filter(i => i >= 0);
    if (starts.length) { const a = Math.min(...starts); const b = Math.max(t.lastIndexOf('}'), t.lastIndexOf(']')); if (b > a) { try { return JSON.parse(t.slice(a, b + 1)); } catch (e) { /* 失败 */ } } }
    throw new Error('AI 返回的格式不对，请再试一次');
  }
  async function json(cfg, prompt, signal, opts) { return parseJSON(await chat(cfg, prompt, signal, opts)); }
  const api = { PROVIDERS, chat, parseJSON, json };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.AI = api;
})(typeof window !== 'undefined' ? window : globalThis);
