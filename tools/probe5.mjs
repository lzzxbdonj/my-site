import { readFileSync, writeFileSync } from 'node:fs';
const data = JSON.parse(readFileSync('tools/probe4.out.json', 'utf8'));
const want = {
  BV1eZ421b7ag: ['安装','环境','变量','数据类型','字符串','列表','字典','元组','集合','循环','判断','函数','类','对象','文件','异常','模块','包','推导'],
  BV1tDsgzxECr: ['安装','环境','变量','数据类型','字符串','列表','字典','元组','集合','循环','判断','函数','类','对象','文件','异常','模块','包','推导'],
  BV1qW4y1a7fU: ['安装','环境','变量','数据类型','字符串','列表','字典','元组','集合','循环','判断','函数','类','对象','文件','异常','模块','推导'],
  BV1owrpYKEtP: ['监督','无监督','回归','分类','代价','梯度','神经','模型','评估','过拟合','正则','聚类','决策','特征','线性回归','逻辑回归','机器学习','介绍','导论'],
  BV1qW411N7FU: []
};
const res = {};
for (const bv of Object.keys(want)) {
  const v = data.videos[bv];
  if (!v) continue;
  const hits = [];
  for (const p of v.pages) {
    const t = String(p.part || '');
    if (want[bv].length === 0 || want[bv].some((k) => t.includes(k))) hits.push({ page: p.page, part: t, duration: p.duration });
  }
  res[bv] = { title: v.title, owner: v.owner, mid: v.mid, totalParts: v.videos, hits: hits.slice(0, 70) };
  console.log('### ' + bv + ' | ' + v.owner + ' | ' + v.title + ' | parts=' + v.videos);
  for (const h of res[bv].hits) console.log('   P' + h.page + ' [' + h.duration + 's] ' + h.part);
}
writeFileSync('tools/probe5.out.json', JSON.stringify(res, null, 2));
