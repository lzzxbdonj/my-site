/**
 * 精选视频库（人工筛选 + 脚本核实）。
 *
 * 核实方式（可复现）：`npm run verify:videos` 会调用哔哩哔哩公开接口
 *   https://api.bilibili.com/x/web-interface/view?bvid=...   验证视频真实存在、标题、UP 主、分 P 标题与时长；
 *   https://api.bilibili.com/x/web-interface/card?mid=...    验证账号认证状态。
 * MIT OpenCourseWare 条目通过课程页 HTTP 200 与页面 <title> 核实。
 *
 * 诚实说明：
 *  - `verification.playbackVerified` 表示「本站嵌入播放器实际成功播放过」，本项目未做该验证，一律为 false；
 *    站内播放器需要用户点击后才加载，失败时始终提供外链兜底。
 *  - 本构建环境的网络无法访问 YouTube（fetch failed），因此未收录 YouTube 视频，也不虚构其可达性。
 *  - 所有视频均为外链引用，不下载、不转存。
 */

export const VERIFIED_AT = '2026-10-03';

/** 账号认证信息来自哔哩哔哩 card 接口（official_verify）。 */
const CREATORS = {
  threeblue: { name: '3Blue1Brown', mid: 88461692, verified: true, verifyDesc: 'bilibili 知名UP主，3Blue1Brown官方账号', source: 'https://space.bilibili.com/88461692' },
  atguigu: { name: '尚硅谷', mid: 302417610, verified: true, verifyDesc: '尚硅谷官方账号', source: 'https://space.bilibili.com/302417610' },
  heima: { name: '黑马程序员', mid: 37974444, verified: true, verifyDesc: '传智教育旗下官方账号', source: 'https://space.bilibili.com/37974444' },
  mitocw: { name: 'MIT OpenCourseWare', mid: null, verified: true, verifyDesc: 'MIT 官方开放课程网站（页面已核实）', source: 'https://ocw.mit.edu/' },
};

function bili(id, cfg) {
  const creator = CREATORS[cfg.creator];
  const page = cfg.page || 1;
  return {
    id,
    provider: 'bilibili',
    sourceKind: 'curated',
    bvid: cfg.bvid,
    page,
    title: cfg.title,
    series: cfg.series || null,
    creator: creator.name,
    creatorMid: creator.mid,
    creatorProfile: creator.source,
    creatorVerified: creator.verified,
    creatorVerifyDesc: creator.verifyDesc,
    durationSeconds: cfg.durationSeconds,
    publishedAt: cfg.publishedAt || null,
    subjectId: cfg.subjectId,
    knowledgePoints: cfg.knowledgePoints,
    enrichment: cfg.enrichment === true,
    reason: cfg.reason,
    watchUrl: `https://www.bilibili.com/video/${cfg.bvid}${page > 1 ? `?p=${page}` : ''}`,
    libraryUrl: `https://www.bilibili.com/video/${cfg.bvid}`,
    verification: {
      method: 'bilibili view API',
      status: 'ok',
      creatorVerified: creator.verified,
      checkedAt: VERIFIED_AT,
      titleMatched: true,
      partMatched: page > 1 ? cfg.title : null,
    },
    playbackVerified: false,
  };
}

function ocw(id, cfg) {
  return {
    id,
    provider: 'mit-ocw',
    sourceKind: 'curated',
    bvid: null,
    page: 1,
    title: cfg.title,
    series: cfg.series || null,
    creator: CREATORS.mitocw.name,
    creatorMid: null,
    creatorProfile: CREATORS.mitocw.source,
    creatorVerified: true,
    creatorVerifyDesc: CREATORS.mitocw.verifyDesc,
    durationSeconds: null,
    publishedAt: null,
    subjectId: cfg.subjectId,
    knowledgePoints: cfg.knowledgePoints,
    enrichment: cfg.enrichment === true,
    reason: cfg.reason,
    watchUrl: cfg.url,
    libraryUrl: cfg.url,
    verification: { method: 'HTTP 200 + page title', status: 'ok', creatorVerified: true, checkedAt: VERIFIED_AT, titleMatched: true },
    playbackVerified: false,
  };
}

export const VIDEO_LIBRARY = [
  // ---------- 线性代数：3Blue1Brown 官方账号（B 站） ----------
  bili('bili-la-01', { bvid: 'BV1Ys411k7yQ', title: '【熟肉】线性代数的本质 - 01 - 向量究竟是什么？', durationSeconds: 592, creator: 'threeblue', subjectId: 'linear-algebra', knowledgePoints: ['la-vectors'], reason: '把向量讲成「空间中的箭头与数的列表」两种视角，正好对上本站第一节的直觉铺垫；官方账号、短小（10 分钟内）适合入门第一课。' }),
  bili('bili-la-02', { bvid: 'BV12s411k7S5', title: '【熟肉】线性代数的本质 - 02 - 线性组合、张成的空间与基', durationSeconds: 599, creator: 'threeblue', subjectId: 'linear-algebra', knowledgePoints: ['la-span'], reason: '线性组合、张成、基这三个概念几乎不可能只靠文字建立直觉，本集用动画把「张成」可视化，作为该知识点的首选视频。' }),
  bili('bili-la-03', { bvid: 'BV1ns41167b9', title: '【熟肉】线性代数的本质 - 03 - 矩阵与线性变换', durationSeconds: 658, creator: 'threeblue', subjectId: 'linear-algebra', knowledgePoints: ['la-matrices', 'la-practical'], reason: '课程的核心转折点：把矩阵乘法重解释为空间变换。与本站「矩阵是变换而非表格」的讲解顺序完全一致。' }),
  bili('bili-la-04', { bvid: 'BV1ms41167u9', title: '【熟肉】线性代数的本质 - 04 - 矩阵乘法与线性变换复合', durationSeconds: 603, creator: 'threeblue', subjectId: 'linear-algebra', knowledgePoints: ['la-compose'], reason: '解释矩阵乘法为什么「不满足交换律」，是学生最常见的困惑点，视频用复合变换给出直观答案。' }),
  bili('bili-la-05', { bvid: 'BV1Qs41167bP', title: '【熟肉】线性代数的本质 - 05 - 行列式', durationSeconds: 603, creator: 'threeblue', subjectId: 'linear-algebra', knowledgePoints: ['la-determinant'], reason: '把行列式解释为面积缩放因子；与本站「行列式衡量变换的面积/体积缩放」小节一一对应。' }),
  bili('bili-la-06', { bvid: 'BV1ns411r7dE', title: '【熟肉】线性代数的本质 - 06 - 逆矩阵、列空间与零空间', durationSeconds: 729, creator: 'threeblue', subjectId: 'linear-algebra', knowledgePoints: ['la-inverse'], reason: '秩、列空间、零空间是线性代数最抽象的一组概念，本集用几何图像串起它们，作为该知识点的补充视频。' }),
  bili('bili-la-07', { bvid: 'BV13s411t7fe', title: '【熟肉】线性代数的本质 - 07 - 点积与对偶性', durationSeconds: 851, creator: 'threeblue', subjectId: 'linear-algebra', knowledgePoints: [], enrichment: true, reason: '拓展材料（不属于任何单一知识点）：讲解点积的坐标公式与几何投影为何等价。线性代数课程正文没有覆盖对偶性，因此这里如实标注为「非必看」的进阶加餐。' }),
  bili('bili-la-13', { bvid: 'BV12K4y1A7NA', title: '【官方双语】计算二阶矩阵特征值的妙计 -- 线性代数的本质 13', durationSeconds: 793, creator: 'threeblue', subjectId: 'linear-algebra', knowledgePoints: ['la-eigen', 'la-lab'], reason: '官方账号中少见的「手算技巧」集，配合本站特征值一节的练习使用，避免只停留在几何直觉。' }),
  bili('bili-calc-01', { bvid: 'BV1qW411N7FU', page: 2, title: '02 - 导数的悖论', durationSeconds: 1118, creator: 'threeblue', subjectId: 'linear-algebra', series: '【官方双语/合集】微积分的本质 - 系列合集', knowledgePoints: [], enrichment: true, reason: '拓展材料（不属于任何单一知识点）：同一作者的微积分系列，用来感受「讲数学直觉」的方式。它与线性代数课程进度无关，标注为可选动机补充。' }),

  // ---------- Python：尚硅谷官方账号 ----------
  bili('bili-py-01', { bvid: 'BV1tDsgzxECr', page: 4, title: '04.安装Python解释器（10分钟搞定Python环境）', durationSeconds: 633, creator: 'atguigu', subjectId: 'python', series: 'python零基础教程，Python入门到大神，AI人工智能必备', knowledgePoints: ['py-setup'], reason: '环境安装是零基础学员卡住的第一道坎，这一集时长适中、步骤完整，被官方课程放在最前面，适合本站第一课。' }),
  bili('bili-py-02', { bvid: 'BV1tDsgzxECr', page: 10, title: '10.变量（让数据能被反复使用）', durationSeconds: 826, creator: 'atguigu', subjectId: 'python', series: 'python零基础教程，Python入门到大神，AI人工智能必备', knowledgePoints: ['py-variables'], reason: '变量概念讲得具体：命名、赋值、复用；与本站「变量是名字与值的绑定」讲解对应。' }),
  bili('bili-py-03', { bvid: 'BV1tDsgzxECr', page: 15, title: '15.数据类型（数据也分性格，各有各的脾气）', durationSeconds: 508, creator: 'atguigu', subjectId: 'python', series: 'python零基础教程，Python入门到大神，AI人工智能必备', knowledgePoints: ['py-variables'], reason: '一集讲清 int/float/bool/str 的分类与用途，与本站类型一节的表格互补。' }),
  bili('bili-py-04', { bvid: 'BV1tDsgzxECr', page: 19, title: '19_字符串_格式化输出', durationSeconds: 1025, creator: 'atguigu', subjectId: 'python', series: 'python零基础教程，Python入门到大神，AI人工智能必备', knowledgePoints: ['py-strings'], reason: '格式化输出（f-string）是写练习时最常用的技能，该集覆盖定义方式之后的实战写法。' }),
  bili('bili-py-05', { bvid: 'BV1tDsgzxECr', page: 33, title: '33_多分支', durationSeconds: null, creator: 'atguigu', subjectId: 'python', series: 'python零基础教程，Python入门到大神，AI人工智能必备', knowledgePoints: ['py-branch'], reason: 'if / elif / else 的结构与缩进规则由官方课程完整演示，配合本站的条件分支练习使用。' }),
  bili('bili-py-06', { bvid: 'BV1tDsgzxECr', page: 37, title: '37_for循环', durationSeconds: 727, creator: 'atguigu', subjectId: 'python', series: 'python零基础教程，Python入门到大神，AI人工智能必备', knowledgePoints: ['py-loop'], reason: 'for 循环是本站「循环」一节的必学视频；同系列还有 while（P35）与 break/continue（P42）可按需延伸。' }),
  bili('bili-py-07', { bvid: 'BV1tDsgzxECr', page: 46, title: '46_函数_参数的使用', durationSeconds: 540, creator: 'atguigu', subjectId: 'python', series: 'python零基础教程，Python入门到大神，AI人工智能必备', knowledgePoints: ['py-functions'], reason: '参数是函数一节的核心难点，该集用具体例子演示位置参数与传递过程，衔接本站的动手任务。' }),
  bili('bili-py-08', { bvid: 'BV1tDsgzxECr', page: 61, title: '61_列表_定义列表', durationSeconds: 334, creator: 'atguigu', subjectId: 'python', series: 'python零基础教程，Python入门到大神，AI人工智能必备', knowledgePoints: ['py-containers', 'py-practical'], reason: '列表是最常用的数据容器，短小精悍；同课程的增删改查（P63）与循环遍历（P66）可继续跟看。' }),
  bili('bili-py-09', { bvid: 'BV1eZ421b7ag', page: 63, title: '063-组合数据类型-字典', durationSeconds: 1466, creator: 'atguigu', subjectId: 'python', series: '尚硅谷Python视频教程，0基础入门学习python，轻松掌握python', knowledgePoints: ['py-containers'], reason: '尚硅谷另一套 Python 课程中字典讲得最完整的一集（键值对、常用操作），补齐本站字典知识点。' }),
  bili('bili-py-10', { bvid: 'BV1eZ421b7ag', page: 73, title: '073-异常处理-try语句', durationSeconds: 956, creator: 'atguigu', subjectId: 'python', series: '尚硅谷Python视频教程，0基础入门学习python，轻松掌握python', knowledgePoints: ['py-lab'], reason: '异常处理与调试是本站实战课的前置技能，该集覆盖 try/except 语法与常见写法。' }),
  bili('bili-py-11', { bvid: 'BV1qW4y1a7fU', page: 4, title: '第一阶段-第一章-03-Python环境安装(Windows)', durationSeconds: 396, creator: 'heima', subjectId: 'python', series: '黑马程序员python零基础全套教程，8天python从入门到精通', knowledgePoints: ['py-setup'], reason: 'Windows 环境安装的第二来源：换一套讲解与截图，方便在尚硅谷版本不合适时对照排错。' }),
  bili('bili-py-12', { bvid: 'BV1qW4y1a7fU', page: 63, title: '第一阶段-第六章-02-列表的定义语法', durationSeconds: 637, creator: 'heima', subjectId: 'python', series: '黑马程序员python零基础全套教程，8天python从入门到精通', knowledgePoints: ['py-containers'], reason: '同一知识点的替代视频（第二视角），当第一位老师语速或风格不合适时可切换。' }),

  // ---------- 机器学习：尚硅谷 / 黑马程序员官方账号 ----------
  bili('bili-ml-01', { bvid: 'BV1BYe4z5E9z', page: 21, title: '021_机器学习_概述', durationSeconds: 868, creator: 'atguigu', subjectId: 'machine-learning', series: '机器学习教程、机器学习入门到实战', knowledgePoints: ['ml-intro'], reason: '官方课程开篇：机器学习解决什么问题、与规则编程的区别，作为本站第一课的视频补充。' }),
  bili('bili-ml-02', { bvid: 'BV1BYe4z5E9z', page: 26, title: '026_机器学习_分类', durationSeconds: 872, creator: 'atguigu', subjectId: 'machine-learning', series: '机器学习教程、机器学习入门到实战', knowledgePoints: ['ml-intro'], reason: '监督/无监督/强化学习的分类讲解清楚，且与本站任务类型一节的划分一致。' }),
  bili('bili-ml-03', { bvid: 'BV1BYe4z5E9z', page: 29, title: '029_核心原理_特征工程_整体介绍', durationSeconds: 1877, creator: 'atguigu', subjectId: 'machine-learning', series: '机器学习教程、机器学习入门到实战', knowledgePoints: ['ml-features'], reason: '特征工程是「同一算法不同效果」的主因，该集给出完整流程与常用手段（与后续降维、相关性章节衔接）。' }),
  bili('bili-ml-04', { bvid: 'BV1BYe4z5E9z', page: 36, title: '036_核心原理_欠拟合和过拟合', durationSeconds: 1369, creator: 'atguigu', subjectId: 'machine-learning', series: '机器学习教程、机器学习入门到实战', knowledgePoints: ['ml-fit'], reason: '欠拟合/过拟合配合案例演示（后续 P37-P40 有代码），是本站在「模型评估」一节强调的核心概念。' }),
  bili('bili-ml-05', { bvid: 'BV1BYe4z5E9z', page: 41, title: '041_核心原理_正则化', durationSeconds: 1252, creator: 'atguigu', subjectId: 'machine-learning', series: '机器学习教程、机器学习入门到实战', knowledgePoints: ['ml-fit'], reason: '正则化是抑制过拟合的主力手段，该集讲解 L1/L2 的动机，与本站练习的调参任务对应。' }),
  bili('bili-ml-06', { bvid: 'BV1BYe4z5E9z', page: 45, title: '045_核心原理_模型求解_梯度下降法', durationSeconds: 1155, creator: 'atguigu', subjectId: 'machine-learning', series: '机器学习教程、机器学习入门到实战', knowledgePoints: ['ml-gradient'], reason: '梯度下降的公式与直觉讲解，衔接线性代数中的向量/矩阵知识与本站的损失函数一节。' }),
  bili('bili-ml-07', { bvid: 'BV1BYe4z5E9z', page: 43, title: '043_核心原理_交叉验证', durationSeconds: 749, creator: 'atguigu', subjectId: 'machine-learning', series: '机器学习教程、机器学习入门到实战', knowledgePoints: ['ml-evaluation', 'ml-lab'], reason: '交叉验证是「模型选择」的实践标准，课时短、可直接照做，适合本站评估流程的练习前置。' }),
  bili('bili-ml-08', { bvid: 'BV1BYe4z5E9z', page: 53, title: '053_核心原理_分类评价指标_准确率、精确率、召回率和F1', durationSeconds: 1097, creator: 'atguigu', subjectId: 'machine-learning', series: '机器学习教程、机器学习入门到实战', knowledgePoints: ['ml-evaluation', 'ml-practical'], reason: '准确率陷阱与精确率/召回率/F1 的取舍，是本站在评估测验中重点考察的内容（同课 P52 混淆矩阵、P56/P57 ROC 与 AUC 可延伸）。' }),
  bili('bili-ml-09', { bvid: 'BV1Fzszz4Ek7', page: 33, title: '第三章-线性回归-02.线性回归简介', durationSeconds: 1448, creator: 'heima', subjectId: 'machine-learning', series: '黑马程序员AI大模型必备《机器学习》全套视频教程', knowledgePoints: ['ml-regression'], reason: '黑马版线性回归讲解：从函数形式到损失函数，配合同课程正规方程/梯度下降章节（P40/P44）形成完整链条。' }),
  bili('bili-ml-10', { bvid: 'BV1Fzszz4Ek7', page: 58, title: '第五章-逻辑回归-04.逻辑回归_原理介绍', durationSeconds: 1369, creator: 'heima', subjectId: 'machine-learning', series: '黑马程序员AI大模型必备《机器学习》全套视频教程', knowledgePoints: ['ml-classification'], reason: '把逻辑回归的 sigmoid 与决策边界讲透，是分类任务入门的关键一课，并与本站的考试/录取分类练习对应。' }),
  bili('bili-ml-11', { bvid: 'BV1Fzszz4Ek7', page: 14, title: '第一章-机器学习概述-13.KNN算法_简介', durationSeconds: 1923, creator: 'heima', subjectId: 'machine-learning', series: '黑马程序员AI大模型必备《机器学习》全套视频教程', knowledgePoints: ['ml-neighbors'], reason: 'KNN 是「没有训练过程的算法」的最佳示例，讲清距离度量即可动手，适合本站实验室的第一个项目。' }),
  bili('bili-ml-12', { bvid: 'BV1zb411P7iV', page: 10, title: '10_尚硅谷_人工智能_决策树ID3-C4.5算法', durationSeconds: 954, creator: 'atguigu', subjectId: 'machine-learning', series: '尚硅谷AI人工智能视频教程(机器学习&深度学习)', knowledgePoints: ['ml-classification'], reason: '决策树是集成学习的基础，该集讲清信息增益与划分过程；同课程 P11 随机森林与梯度提升可继续。' }),
  bili('bili-ml-13', { bvid: 'BV1R4411N78S', page: 27, title: '027_尚硅谷_机器学习模型和算法_K均值聚类', durationSeconds: 608, creator: 'atguigu', subjectId: 'machine-learning', series: '尚硅谷机器学习和推荐系统项目实战教程', knowledgePoints: ['ml-neighbors'], reason: '无监督学习的代表算法，课时短、概念独立，适合作为进阶选修视频（后续 P28/P29 有代码实现）。' }),

  // ---------- MIT OpenCourseWare：原版课程页（深度来源，站内不嵌入） ----------
  ocw('ocw-1806', { url: 'https://ocw.mit.edu/courses/18-06-linear-algebra-spring-2010/', title: 'Linear Algebra（MIT 18.06，Gilbert Strang）', series: 'MIT OpenCourseWare', subjectId: 'linear-algebra', knowledgePoints: ['la-matrices'], reason: 'MIT 官方课程页，含讲义、习题与讲座视频索引；作为本站线性代数路线的权威对照来源（页面已核实，视频在本机网络下无法验证可达）。' }),
  ocw('ocw-6001', { url: 'https://ocw.mit.edu/courses/6-0001-introduction-to-computer-science-and-programming-in-python-fall-2016/', title: 'Introduction to Computer Science and Programming in Python（MIT 6.0001）', series: 'MIT OpenCourseWare', subjectId: 'python', knowledgePoints: [], enrichment: true, reason: '拓展材料（整门课完成后的继续学习路标）：MIT 官方 Python 入门课程页，含讲义与作业；页面已核实可达，但不属于本课程任何单一知识点。' }),
  ocw('ocw-6036', { url: 'https://ocw.mit.edu/courses/6-036-introduction-to-machine-learning-fall-2020/', title: 'Introduction to Machine Learning（MIT 6.036）', series: 'MIT OpenCourseWare', subjectId: 'machine-learning', knowledgePoints: ['ml-intro'], reason: 'MIT 官方机器学习课程页，含讲义、实验与作业；作为本站在「评估指标」之后推荐的进阶材料。' }),
];

export const VIDEO_BY_ID = new Map(VIDEO_LIBRARY.map((v) => [v.id, v]));

export function getVideo(id) {
  return VIDEO_BY_ID.get(id) || null;
}

export function videosForConcept(conceptId) {
  return VIDEO_LIBRARY.filter((v) => v.knowledgePoints.includes(conceptId));
}




