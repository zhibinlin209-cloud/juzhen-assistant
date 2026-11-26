/* 小红书聚光 Marketing API 授权（商业开放平台 ad-market.xiaohongshu.com）
 * 流程：应用中心建应用 → 老板在「经营日报」群发「聚光密钥 应用ID 密钥」（只存在服务器 data/jg-app.json）
 *      → 用聚光品牌主账号打开授权链接点「确认授权」→ 回调 /cockpit/xhs/callback?auth_code=…&state=应用ID
 *      → 换 access_token（1 天）/ refresh_token（30 天），存 data/jg-tokens.json，每小时检查、快过期就自动续
 * 令牌和密钥永远不写进仓库、不打日志。
 */
'use strict';
const fs = require('fs'); const path = require('path');
const API = 'https://adapi.xiaohongshu.com/api/open/oauth2/';

function createJg({ dataDir, log, notify }) {
  const APP_F = path.join(dataDir, 'jg-app.json'), TOK_F = path.join(dataDir, 'jg-tokens.json');
  const rd = f => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return {}; } };
  const wr = (f, o) => { fs.writeFileSync(f, JSON.stringify(o)); try { fs.chmodSync(f, 0o600); } catch (e) { } };
  const apps = () => rd(APP_F).apps || {};
  const toks = () => rd(TOK_F);

  function setSecret(appId, secret) {
    const a = rd(APP_F); a.apps = a.apps || {}; a.apps[String(appId)] = { secret: String(secret), at: Date.now() }; wr(APP_F, a);
    log(`[聚光授权] 应用 ${appId} 的密钥已录入`);
  }

  async function post(kind, body) {
    const r = await fetch(API + kind, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(20000) }).then(x => x.json());
    if (!r || !r.success || !r.data || !r.data.access_token) throw new Error(`${kind} 失败：${(r && (r.msg || r.code)) || '无返回'}`);
    return r.data;
  }

  function save(appId, d) {
    const T = toks(); const now = Date.now();
    T[String(appId)] = {
      app_id: Number(appId), user_id: d.user_id || '', role_type: d.role_type, approval_role_type: d.approval_role_type, platform_type: d.platform_type,
      advertisers: (d.approval_advertisers || []).map(x => ({ id: x.advertiser_id, name: x.advertiser_name })), advertiser_id: d.advertiser_id || null,
      access_token: d.access_token, refresh_token: d.refresh_token,
      expires_at: now + (d.access_token_expires_in || 0) * 1000, refresh_expires_at: now + (d.refresh_token_expires_in || 0) * 1000, at: now,
    };
    wr(TOK_F, T); return T[String(appId)];
  }

  const ROLE = { 1: '品牌开发者', 2: '代理商开发者', 3: '服务商开发者', 4: '技术服务商' };

  // 回调：state 里放的是应用 ID；没有就挨个试已录入的应用
  async function onCallback({ code, state }) {
    const A = apps(); const ids = A[state] ? [state] : Object.keys(A);
    if (!ids.length) { log('[聚光授权] 收到授权码，但还没录入任何应用密钥'); await notify('⚠️ 有聚光账号点了授权，但机器人还没有应用密钥，换不了令牌。请在小红书商业开放平台 → 应用中心 → 编辑 里复制 secret，在「经营日报」群发：聚光密钥 应用ID 密钥。录好后再点一次授权链接（授权码 10 分钟内有效）。'); return { ok: false }; }
    let lastErr = null;
    for (const id of ids) {
      try {
        const t = save(id, await post('access_token', { app_id: Number(id), secret: A[id].secret, auth_code: code }));
        const names = t.advertisers.map(x => x.name).join('、') || '（没返回账户名）';
        log(`[聚光授权] 应用 ${id} 授权成功（${ROLE[t.role_type] || t.role_type}），账户 ${t.advertisers.length} 个`);
        await notify(`✅ 聚光授权成功：应用 ${id}（${ROLE[t.role_type] || '角色' + t.role_type}），可读账户：${names}。令牌会自动续期，30 天内不用再点。`);
        return { ok: true, app: id };
      } catch (e) { lastErr = e; }
    }
    log('[聚光授权] 换令牌失败：' + (lastErr ? lastErr.message : '')); await notify('⚠️ 聚光授权没成功：' + (lastErr ? lastErr.message.slice(0, 80) : '') + '。授权码 10 分钟内有效，请重新打开授权链接再点一次。');
    return { ok: false };
  }

  // 每小时：access_token 两小时内过期就续；refresh_token 剩 5 天提醒一次
  async function refreshAll() {
    const T = toks(), A = apps(), now = Date.now();
    for (const id of Object.keys(T)) {
      const t = T[id]; if (!A[id]) continue;
      if (t.refresh_expires_at && t.refresh_expires_at < now) { if (!t.deadNotified) { t.deadNotified = 1; wr(TOK_F, T); await notify(`⚠️ 聚光应用 ${id} 的授权已过期，需要重新打开授权链接点一次「确认授权」。`); } continue; }
      if (t.expires_at - now > 2 * 3600e3) continue;
      try { save(id, await post('refresh_token', { app_id: Number(id), secret: A[id].secret, refresh_token: t.refresh_token })); log(`[聚光授权] 应用 ${id} 令牌已续期`); }
      catch (e) { log(`[聚光授权] 应用 ${id} 续期失败：${e.message}`); }
    }
  }

  // 给后面拉报表 / 建计划用：拿一个可用的 access_token（优先品牌开发者应用）
  function token(pref) {
    const T = toks(); const list = Object.values(T).filter(t => t.access_token && t.expires_at > Date.now());
    list.sort((a, b) => (a.role_type === 1 ? -1 : 0) - (b.role_type === 1 ? -1 : 0));
    const t = (pref && T[String(pref)]) || list[0]; return t ? { app_id: t.app_id, access_token: t.access_token, advertisers: t.advertisers, role_type: t.role_type } : null;
  }

  // 状态（不含任何令牌/密钥）
  function status() {
    const A = apps(), T = toks();
    return Object.keys(Object.assign({}, A, T)).map(id => { const t = T[id] || {}; return { app_id: id, 有密钥: !!A[id], 已授权: !!t.access_token, 身份: ROLE[t.role_type] || '', 账户: t.advertisers || [], 令牌到期: t.expires_at ? new Date(t.expires_at + 8 * 3600e3).toISOString().slice(0, 16).replace('T', ' ') : '', 续期截止: t.refresh_expires_at ? new Date(t.refresh_expires_at + 8 * 3600e3).toISOString().slice(0, 10) : '' }; });
  }

  // 授权链接（格式照官方文档 scope 权限说明里的示例）：报表、查询、搭建、账户四项都要
  const authUrl = (appId, redirect) => `https://ad-market.xiaohongshu.com/auth?appId=${appId}&scope=[%22report_service%22,%22ad_query%22,%22ad_manage%22,%22account_manage%22]&redirectUri=${redirect}&state=${appId}`;

  setInterval(() => refreshAll().catch(e => log('[聚光授权] 续期出错：' + e.message)), 3600e3);
  setTimeout(() => refreshAll().catch(() => { }), 60e3);
  return { setSecret, onCallback, refreshAll, token, status, authUrl };
}

module.exports = { createJg };
