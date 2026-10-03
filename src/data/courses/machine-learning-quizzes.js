/** 机器学习课程随堂测验。 */

export const machineLearningQuizzes = {
  'quiz-ml-intro': {
    id: 'quiz-ml-intro',
    conceptId: 'ml-intro',
    passScore: 0.6,
    questions: [
      { id: 'ml-i1', type: 'single', stem: '下列哪种情况最适合直接用规则编程解决？', options: ['识别照片里是不是猫', '判断订单金额是否超过 1000 元', '预测用户会不会流失', '把新闻自动归类到 20 个主题'], answer: 1, explanation: '规则清晰、无歧义的问题用 if 判断最快也最可靠。', knowledgePoint: '规则 vs 学习' },
      { id: 'ml-i2', type: 'single', stem: '没有标签、只想把用户分成若干群体，属于：', options: ['监督学习中的分类', '监督学习中的回归', '无监督学习中的聚类', '强化学习'], answer: 2, explanation: '无标签 + 找结构 = 聚类，属于无监督学习。', knowledgePoint: '任务类型' },
      { id: 'ml-i3', type: 'fill', stem: '监督学习中，我们用来判断的信息叫做特征，希望预测的答案叫做 ______。', answer: ['标签', 'label', '目标变量'], explanation: '特征是输入，标签是输出。', knowledgePoint: '特征与标签' }
    ]
  },
  'quiz-ml-features': {
    id: 'quiz-ml-features',
    conceptId: 'ml-features',
    passScore: 0.6,
    questions: [
      { id: 'ml-f1', type: 'single', stem: '使用 KNN 时若不做任何特征缩放，最可能发生什么？', options: ['模型自动处理量纲', '取值范围大的特征主导距离计算', '准确率必然提高', 'KNN 无法运行'], answer: 1, explanation: 'KNN 依赖距离，量纲差异会让某个特征事实上主宰结果。', knowledgePoint: '特征缩放' },
      { id: 'ml-f2', type: 'judge', stem: '应该先划分训练集与测试集，再在训练集上计算填充用的均值或缩放参数。', answer: true, explanation: '否则测试集的信息会泄露进训练过程，评估结果会偏乐观。', knowledgePoint: '数据泄露' },
      { id: 'ml-f3', type: 'multiple', stem: '下列哪些属于特征工程的工作？', options: ['缺失值处理', '类别特征独热编码', '特征缩放', '决定用哪个损失函数'], answer: [0, 1, 2], explanation: '损失函数属于模型与训练环节，不是特征工程。', knowledgePoint: '特征工程范围' }
    ]
  },
  'quiz-ml-regression': {
    id: 'quiz-ml-regression',
    conceptId: 'ml-regression',
    passScore: 0.6,
    questions: [
      { id: 'ml-r1', type: 'single', stem: '线性回归中的均方误差（MSE）是：', options: ['预测值与真实值差值的平均', '差值的平方的平均', '真实值的平均', '预测值与真实值的比值'], answer: 1, explanation: '平方让正负误差不抵消，并放大大偏差的惩罚。', knowledgePoint: '均方误差' },
      { id: 'ml-r2', type: 'judge', stem: '在线性回归中，特征单位从「米」换成「厘米」会改变系数数值，但不会改变模型预测能力。', answer: true, explanation: '系数随量纲变化，但预测结果不变；这也是「系数不能直接比较重要性」的原因。', knowledgePoint: '系数与量纲' },
      { id: 'ml-r3', type: 'fill', stem: '当特征数量很大时，通常不再用正规方程，而改用 ______ 法逐步逼近最优解。', answer: ['梯度下降', '梯度下降法', 'gradient descent'], explanation: '梯度下降在特征数很多时计算上更可行。', knowledgePoint: '求解方法' }
    ]
  },
  'quiz-ml-gradient': {
    id: 'quiz-ml-gradient',
    conceptId: 'ml-gradient',
    passScore: 0.6,
    questions: [
      { id: 'ml-g1', type: 'single', stem: '梯度下降的参数更新方向是：', options: ['沿梯度方向', '沿梯度反方向', '随机方向', '沿坐标轴方向'], answer: 1, explanation: '梯度指向上升最快的方向，因此要减去它与学习率的乘积。', knowledgePoint: '更新公式' },
      { id: 'ml-g2', type: 'single', stem: '学习率设得过大最可能出现的现象是：', options: ['收敛很慢', '损失来回震荡甚至发散', '训练集准确率恒为 0', '特征被自动缩放'], answer: 1, explanation: '步长太大会跨过谷底来回跳动，甚至越走越远。', knowledgePoint: '学习率' },
      { id: 'ml-g3', type: 'judge', stem: '小批量（mini-batch）梯度下降在每次更新时只用一部分训练样本。', answer: true, explanation: '它是批量与随机之间的折中，兼顾速度与稳定性。', knowledgePoint: '批量选择' }
    ]
  },
  'quiz-ml-fit': {
    id: 'quiz-ml-fit',
    conceptId: 'ml-fit',
    passScore: 0.6,
    questions: [
      { id: 'ml-fit1', type: 'single', stem: '训练损失很低但验证损失明显偏高，说明模型：', options: ['欠拟合', '过拟合', '数据泄露', '学习率太小'], answer: 1, explanation: '这是过拟合的典型信号：模型记住了训练数据的噪声。', knowledgePoint: '拟合诊断' },
      { id: 'ml-fit2', type: 'single', stem: 'L1 正则化相比 L2 的一个显著特点是：', options: ['一定让所有参数变大', '倾向于把部分参数压到 0，可做特征选择', '不需要超参数', '只适用于分类问题'], answer: 1, explanation: 'L1 的几何性质会产生稀疏解，因此常被当作特征选择手段。', knowledgePoint: 'L1 与 L2' },
      { id: 'ml-fit3', type: 'multiple', stem: '下列哪些做法有助于缓解过拟合？', options: ['增加训练数据', '降低模型复杂度', '加入正则化项', '把验证集并入训练集以提升训练分数'], answer: [0, 1, 2], explanation: '把验证集并入训练集只是让评估失去意义，并不能真正缓解过拟合。', knowledgePoint: '缓解过拟合' }
    ]
  },
  'quiz-ml-evaluation': {
    id: 'quiz-ml-evaluation',
    conceptId: 'ml-evaluation',
    passScore: 0.6,
    questions: [
      { id: 'ml-e1', type: 'fill', stem: 'TP=30、FP=20 时，精确率 = ______（用小数或百分数表示）。', answer: ['0.6', '60%', '0.60'], explanation: '精确率 = TP/(TP+FP) = 30/50 = 0.6。', knowledgePoint: '精确率' },
      { id: 'ml-e2', type: 'single', stem: '疾病筛查场景中漏诊代价很高，应优先关注：', options: ['精确率', '召回率', '训练速度', '特征数量'], answer: 1, explanation: '召回率 = TP/(TP+FN)，衡量「真正的病人都被找出来了吗」。', knowledgePoint: '指标选择' },
      { id: 'ml-e3', type: 'judge', stem: '在 99% 样本为正类的数据上，准确率 99% 可能意味着模型什么都没学到。', answer: true, explanation: '全部预测为正类就能达到该准确率，这时必须看精确率/召回率等指标。', knowledgePoint: '不平衡数据' }
    ]
  },
  'quiz-ml-classification': {
    id: 'quiz-ml-classification',
    conceptId: 'ml-classification',
    passScore: 0.6,
    questions: [
      { id: 'ml-c1', type: 'single', stem: 'sigmoid 函数在逻辑回归中的作用是：', options: ['把概率变成实数', '把任意实数映射到 (0,1)，可解释为概率', '对特征做标准化', '解决类别不平衡'], answer: 1, explanation: '它把线性打分压缩到概率区间，输出就可以按阈值变成类别。', knowledgePoint: 'sigmoid' },
      { id: 'ml-c2', type: 'judge', stem: '把分类阈值从 0.5 提高到 0.8，被判为正类的样本数量通常会减少。', answer: true, explanation: '阈值越高，越难被判定为正类，因此召回率通常下降而精确率上升。', knowledgePoint: '阈值与取舍' },
      { id: 'ml-c3', type: 'multiple', stem: '关于决策树，下列说法正确的是：', options: ['它通过一系列划分把特征空间切开', '单棵树容易过拟合', '随机森林等集成方法可降低方差', '决策树要求特征必须标准化'], answer: [0, 1, 2], explanation: '树模型基于划分点，对单调变换不敏感，通常不需要标准化。', knowledgePoint: '决策树' }
    ]
  },
  'quiz-ml-neighbors': {
    id: 'quiz-ml-neighbors',
    conceptId: 'ml-neighbors',
    passScore: 0.6,
    questions: [
      { id: 'ml-n1', type: 'single', stem: 'KNN 的「训练」阶段主要做什么？', options: ['计算全部参数', '基本只保存训练数据', '训练一个神经网络', '做特征选择'], answer: 1, explanation: 'KNN 是惰性学习：训练几乎不做事，预测时才计算距离。', knowledgePoint: 'KNN 特性' },
      { id: 'ml-n2', type: 'single', stem: 'K-means 每次迭代的两步是：', options: ['更新中心 → 分配样本', '分配样本到最近中心 → 用均值更新中心', '计算梯度 → 更新权重', '随机采样 → 计算准确率'], answer: 1, explanation: '先按当前中心分配，再按分配结果更新中心，交替直到稳定。', knowledgePoint: 'K-means 迭代' },
      { id: 'ml-n3', type: 'judge', stem: 'K-means 需要事先指定簇的数量 k，并且结果可能受初始中心影响。', answer: true, explanation: '常用肘部法选择 k，并通过多次随机初始化缓解初始值敏感问题。', knowledgePoint: 'K-means 参数' }
    ]
  },
  'quiz-ml-practical': {
    id: 'quiz-ml-practical',
    conceptId: 'ml-practical',
    passScore: 0.6,
    questions: [
      { id: 'ml-p1', type: 'single', stem: '下列说法中，哪个是数据泄露？', options: ['先划分训练/测试，再在训练集上 fit 缩放器', '在整份数据上 fit 缩放器后再划分', '固定随机种子', '在验证集上选择超参数'], answer: 1, explanation: '缩放统计量里已经包含了测试集信息，评估结果会过于乐观。', knowledgePoint: '数据泄露' },
      { id: 'ml-p2', type: 'judge', stem: '测试集应当在整个流程中只使用一次，用于最终评估。', answer: true, explanation: '反复使用测试集调参会让它变成训练数据的一部分。', knowledgePoint: '测试集使用' },
      { id: 'ml-p3', type: 'multiple', stem: '一份可复现的建模报告应当包含：', options: ['数据划分方式与随机种子', '所选超参数与选择理由', '评估指标定义与数值', '只写最终准确率一个数字'], answer: [0, 1, 2], explanation: '可复现要求每一步都能被他人重跑验证。', knowledgePoint: '可复现性' }
    ]
  },
  'quiz-ml-lab': {
    id: 'quiz-ml-lab',
    conceptId: 'ml-lab',
    passScore: 0.6,
    questions: [
      { id: 'ml-lab1', type: 'single', stem: '错误分析最核心的价值是：', options: ['让报告更好看', '找出错误集中的模式并据此提出改进方向', '证明模型无用', '替代交叉验证'], answer: 1, explanation: '错误分析把「模型不行」变成「模型在这类样本上不行」。', knowledgePoint: '错误分析' },
      { id: 'ml-lab2', type: 'judge', stem: '「加入交互特征会提升召回率」这句话要成为科学假设，需要写明预期指标变化方向与验证方法。', answer: true, explanation: '可证伪的假设才能指导下一轮实验。', knowledgePoint: '假设可证伪' },
      { id: 'ml-lab3', type: 'fill', stem: '评估函数应当是纯函数：给定相同输入返回相同输出，并且不修改 ______。', answer: ['输入数据', '入参', '输入'], explanation: '避免副作用才能让评估结果可信、可重复。', knowledgePoint: '纯函数' }
    ]
  }
};
