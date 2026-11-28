/* 巨量引擎开放平台（巨量本地推 API）授权（open.oceanengine.com，开发者主体：广州粤迹引力传媒有限公司）
 * 流程：开发者后台建应用（自研投放系统-客户）→ 审核通过后老板在「经营日报」群发「巨量密钥 应用ID 密钥」（只存服务器 data/oe-app.json）
 *      → 用能访问本地推账户的巨量账号打开应用详情页的授权链接，勾账户点「同意授权」→ 回调 /cockpit/oe/callback?auth_code=…&state=…
 *      → 换 access_token（24 小时）/ refresh_token（30 天），存 data/oe-tokens.json，每小时检查、快过期就自动续。
 * 官方文档（2026-11-28 在开放平台「入门指南」核对过）：
 *   换令牌 POST https://ad.oceanengine.com/open_api/oauth2/access_token/  {app_id, secret, auth_code}
 *   续期   POST https://ad.oceanengine.com/open_api/oauth2/refresh_token/ {app_id, secret, grant_type:'refresh_token', refresh_token}
 *   注意：续期后旧的 refresh_token 立刻作废，新的丢了就得重新授权 → 拿到就先落盘。auth_code 10 分钟有效、只能用一次。
 * 令牌和密钥永远不写进仓库、不打日志。这里只管授权；取数和调投放另写，调投放的动作必须先经林总同意的规则。
 */
'use strict';
const fs = require('fs'); const path = require('path');
const API = 'https://ad.oceanengine.com/open_api/oauth2/';

function createOe({ dataDir, log, notify }) {
  const APP_F = path.join(dataDir, 'oe-app.json'), TOK_F = path.join(dataDir, 'oe-tokens.json');
  const rd = f => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return {}; } };
  const wr = (f, o) => { const tmp = f + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(o)); try { fs.chmodSync(tmp, 0o600); } catch (e) { } fs.renameSync(tmp, f); }; // 先写临时文件再改名，断电也不会把令牌写坏
  const apps = () => rd(APP_F).apps || {};
  const toks = () => rd(TOK_F);

  function setSecret(appId, secret) { const a = rd(APP_F); a.apps = a.apps || {}; a.apps[String(appId)] = { secret: String(secret), at: Date.now() }; wr(APP_F, a); log(`[巨量授权] 应用 ${appId} 的密钥已录入`); }

  async function post(kind, body) {
    const r = await fetch(API + kind + '/', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(20000) }).then(x => x.json());
    if (!r || r.code !== 0 || !r.data || !r.data.access_token) throw new Error(`${kind} 失败：${(r && (r.message || r.code)) || '无返回'}`);
    return r.data;
  }

  function save(appId, d) {
    const T = toks(); const now = Date.now(); const old = T[String(appId)] || {};
    const ids = (Array.isArray(d.advertiser_ids) && d.advertiser_ids.length ? d.advertiser_ids : (d.advertiser_id ? [d.advertiser_id] : old.advertiser_ids || [])).map(String);
    T[String(appId)] = { app_id: Number(appId), advertiser_ids: ids, access_token: d.access_token, refresh_token: d.refresh_token,
      expires_at: now + (d.expires_in || 86400) * 1000, refresh_expires_at: now + (d.refresh_token_expires_in || 30 * 86400) * 1000, at: now, authAt: old.authAt || now };
    wr(TOK_F, T); return T[String(appId)];
  }

  // 回调：state 里放应用 ID；没有就挨个试已录入的应用
  async function onCallback({ code, state }) {
    const A = apps(); const ids = A[state] ? [state] : Object.keys(A);
    if (!ids.length) { log('[巨量授权] 收到授权码，但还没录入应用密钥'); await notify('⚠️ 有巨量账号点了授权，但机器人还没有应用密钥，换不了令牌。请在巨量引擎开放平台 → 开发者后台 → 应用管理 里复制 APP_ID 和 Secret，在经营日报群发「巨量密钥 应用ID 密钥」，再重新点一次授权（授权码只有 10 分钟）。'); return { ok: false }; }
    let lastErr = null;
    for (const id of ids) {
      try { const t = save(id, await post('access_token', { app_id: Number(id), secret: A[id].secret, auth_code: code })); t.authAt = Date.now();
        log(`[巨量授权] 应用 ${id} 授权成功，账户 ${t.advertiser_ids.length} 个`);
        await notify(`✅ 巨量本地推授权成功：应用 ${id}，可操作账户 ${t.advertiser_ids.length} 个（${t.advertiser_ids.join('、') || '没返回账户号'}）。令牌会自动续期。`); return { ok: true, app: id };
      } catch (e) { lastErr = e; }
    }
    log('[巨量授权] 换令牌失败：' + (lastErr ? lastErr.message : '')); await notify('⚠️ 巨量本地推授权没成功：' + (lastErr ? lastErr.message.slice(0, 80) : '') + '。授权码 10 分钟内有效、只能用一次，请重新打开授权链接再点一次。');
    return { ok: false };
  }

  // 每小时：access_token 三小时内过期就续；连续续不上、或 refresh_token 过期就提醒重新授权
  async function refreshAll() {
    const T = toks(), A = apps(), now = Date.now();
    for (const id of Object.keys(T)) {
      const t = T[id]; if (!A[id] || !t.refresh_token) continue;
      if (t.refresh_expires_at && t.refresh_expires_at < now) { if (!t.deadNotified) { t.deadNotified = 1; wr(TOK_F, T); await notify(`⚠️ 巨量应用 ${id} 的授权已过期，需要重新打开授权链接点一次「同意授权」。`); } continue; }
      if (t.expires_at - now > 3 * 3600e3) continue;
      try { save(id, await post('refresh_token', { app_id: Number(id), secret: A[id].secret, grant_type: 'refresh_token', refresh_token: t.refresh_token })); log(`[巨量授权] 应用 ${id} 令牌已续期`); }
      catch (e) { log(`[巨量授权] 应用 ${id} 续期失败：${e.message}`); const T2 = toks(); const t2 = T2[id]; if (t2) { t2.failN = (t2.failN || 0) + 1; wr(TOK_F, T2); if (t2.failN === 3) await notify(`⚠️ 巨量应用 ${id} 的令牌连续 3 次续期失败（${e.message.slice(0, 60)}），本地推数据可能会断，可能要重新授权。`); } }
    }
  }

  // 给取数 / 调投放用：拿一个可用的 access_token
  function token(pref) { const T = toks(); const list = Object.values(T).filter(t => t.access_token && t.expires_at > Date.now()); const t = (pref && T[String(pref)]) || list[0]; return t ? { app_id: t.app_id, access_token: t.access_token, advertiser_ids: t.advertiser_ids } : null; }

  // 状态（不含任何令牌/密钥）
  function status() { const A = apps(), T = toks(); const fmt = ms => ms ? new Date(ms + 8 * 3600e3).toISOString().slice(0, 16).replace('T', ' ') : '';
    return Object.keys(Object.assign({}, A, T)).map(id => { const t = T[id] || {}; return { app_id: id, 有密钥: !!A[id], 已授权: !!t.access_token, 账户: t.advertiser_ids || [], 令牌到期: fmt(t.expires_at), 续期截止: fmt(t.refresh_expires_at) }; }); }

  setInterval(() => refreshAll().catch(e => log('[巨量授权] 续期出错：' + e.message)), 3600e3);
  setTimeout(() => refreshAll().catch(() => { }), 90e3);
  return { setSecret, onCallback, refreshAll, token, status };
}

module.exports = { createOe };
