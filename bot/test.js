// 离线自测：模拟飞书接口，验证「分享→登记」「截图→更新」
const { createCore, replyForText, replyForImage } = require('./lib/core');
const calls = [];
const rows = [{ record_id: 'r1', fields: { '账号昵称': [{ text: '豪仔' }], '人员': '小诗', '主页链接': [{ text: 'https://www.xiaohongshu.com/user/profile/6703af6c000000000d0265c2' }], '发布日期': new Date(2026, 9, 29).getTime(), '标题(供AI读取)': { type: 1, value: [{ text: '## 标题\n广州旅游bi看！怎么玩怎么吃全搞定！\n## 正文' }] }, '小红书链接': { link: 'https://xhslink.cn/o/AAA' } } }];
const api = {
  call: async (m, p, b, q) => { calls.push([m, p, b && JSON.stringify(b).slice(0, 300)]);
    if (p.includes('get_node')) return { node: { obj_token: 'app1' } };
    if (p.endsWith('/tables')) return { items: [{ table_id: 't1', name: '小红书矩阵号-数据' }] };
    if (p.endsWith('/fields') && m === 'GET') return { items: [{ field_name: '标题(供AI读取)', type: 20 }, { field_name: '人员', type: 3, property: { options: [{ name: '小诗' }, { name: '彭倩' }] } }, { field_name: '笔记城市', type: 3, property: { options: [{ name: '惠州' }, { name: '广州' }] } }, { field_name: '笔记门店', type: 3, property: { options: [{ name: '惠州水东街' }] } }, { field_name: '笔记类型', type: 3, property: { options: [{ name: '逛吃帖' }] } }, { field_name: '投流状态', type: 3, property: { options: [{ name: '未投流' }] } }] };
    if (p.endsWith('/records/search')) return { items: rows };
    return {}; },
  fetchXhs: async () => ({ id: '6a9bd08f0000000012002c39', uid: '6703af6c000000000d0265c2', nick: '豪仔', time: new Date(2026, 9, 31).getTime() }),
  vision: async () => '{"account":"","notes":[{"title":"广州旅游bi看！怎么玩怎么吃全搞定！","date":"10-29","views":"82","likes":"2","comments":"0"},{"title":"不存在的笔记","date":"10-01","views":"5","likes":"0","comments":"0"}]}'
};
(async () => {
  const core = createCore({ cfg: { baseUrl: 'https://x.feishu.cn/wiki/ABC', xhsTable: '小红书矩阵号-数据' }, api, log: () => {} });
  const r = await core.handleText(`被低估的惠城美食！9家全是本地人常吃的 来惠州吃地道... https://xhslink.cn/o/5UDV9DuyUrw 先复制这段口令
0000020340975896988
点评：被低估的惠城美食！9家全是本地人常吃的 http://dpurl.cn/ucpXcGbz
广州旅游bi看！怎么玩怎么吃全搞定！ https://xhslink.cn/o/AAA`, '小诗');
  console.log(replyForText(r));
  console.log('写入：', calls.filter(c => c[1].includes('batch_create')).map(c => c[2])[0]);
  const r2 = await core.handleImage('data:image/png;base64,xx');
  console.log(replyForImage(r2));
  console.log('更新：', calls.filter(c => c[1].includes('batch_update')).map(c => c[2])[0]);
})().catch(e => { console.error('FAIL', e); process.exit(1); });
