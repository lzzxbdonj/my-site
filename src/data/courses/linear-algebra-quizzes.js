/** 线性代数随堂测验：题目为原创，解析给出「为什么错」而不只是答案。 */

export const linearAlgebraQuizzes = {
  'quiz-la-vectors': {
    id: 'quiz-la-vectors',
    conceptId: 'la-vectors',
    passScore: 0.6,
    questions: [
      {
        id: 'la-v1',
        type: 'single',
        stem: '关于「向量」，下列哪句话最准确？',
        options: [
          '向量就是一列数字，和几何方向无关',
          '向量既可以看成有方向的箭头，也可以在某组基下写成数的列表，两者是同一个对象',
          '向量必须有三个分量',
          '只有物理中的力才算向量'
        ],
        answer: 1,
        explanation: '坐标是向量在某组基下的描述，箭头是它的几何形象；换基坐标会变而向量不变。',
        knowledgePoint: '向量的两种视角'
      },
      {
        id: 'la-v2',
        type: 'judge',
        stem: '在二维平面中，v=(3,2) 表示 3 个 e₁ 加上 2 个 e₂。',
        answer: true,
        explanation: '这正是坐标的定义：它描述「用当前基向量各拼多少个」。',
        knowledgePoint: '坐标与基'
      },
      {
        id: 'la-v3',
        type: 'multiple',
        stem: '下列哪些运算保持「线性」（即既不改变直线性、又对加法与数乘封闭）？',
        options: ['向量加法', '数乘（乘一个标量）', '先取长度再翻倍', '把每个分量平方'],
        answer: [0, 1],
        explanation: '取长度是非线性的（长度不满足可加性）；分量平方也破坏线性。线性变换只允许做加法和数乘的组合。',
        knowledgePoint: '线性运算'
      }
    ]
  },
  'quiz-la-span': {
    id: 'quiz-la-span',
    conceptId: 'la-span',
    passScore: 0.6,
    questions: [
      {
        id: 'la-s1',
        type: 'single',
        stem: 'span((1,2),(2,4)) 是什么？',
        options: ['整个二维平面', '方向为 (1,2) 的一条直线', '只有原点', '一个平行四边形内部'],
        answer: 1,
        explanation: '(2,4)=2·(1,2)，两个向量共线，所有线性组合都落在同一条直线上。',
        knowledgePoint: '张成空间'
      },
      {
        id: 'la-s2',
        type: 'judge',
        stem: '加入一个零向量可以让原来只张成直线的向量组张成整个平面。',
        answer: false,
        explanation: '零向量不提供任何新方向，张成空间不变。',
        knowledgePoint: '线性相关'
      },
      {
        id: 'la-s3',
        type: 'fill',
        stem: '一组向量既能张成整个空间、去掉任何一个都会丢掉某些方向，这样的一组向量称为空间的 ______。',
        answer: ['基', '基底', 'basis'],
        explanation: '基 = 刚好够用的最小生成组，其元素个数就是空间维数。',
        knowledgePoint: '基'
      }
    ]
  },
  'quiz-la-matrices': {
    id: 'quiz-la-matrices',
    conceptId: 'la-matrices',
    passScore: 0.6,
    questions: [
      {
        id: 'la-m1',
        type: 'single',
        stem: '矩阵 [[0,-1],[1,0]] 对空间做了什么？',
        options: ['把平面沿 x 轴压扁', '逆时针旋转 90°', '沿对角线拉伸 2 倍', '什么都不做'],
        answer: 1,
        explanation: '第一列 (0,1) 说明 e₁ 转到上方，第二列 (-1,0) 说明 e₂ 转到左方，合起来是逆时针 90° 旋转。',
        knowledgePoint: '矩阵的列'
      },
      {
        id: 'la-m2',
        type: 'multiple',
        stem: '关于「矩阵的第 j 列」，下列哪些说法正确？',
        options: [
          '它表示第 j 个基向量变换后的位置',
          '它可以用来判断变换是否把某个方向压扁',
          '它等于变换后所有向量的坐标',
          '它决定了矩阵的行列式大小'
        ],
        answer: [0, 1, 3],
        explanation: '列向量是基向量的去向，自然决定像空间与行列式；但它不是「所有向量」的坐标。',
        knowledgePoint: '矩阵的列'
      },
      {
        id: 'la-m3',
        type: 'judge',
        stem: '线性变换会把原来的直线映射成直线，并且保持原点不动。',
        answer: true,
        explanation: '这两条正是线性的几何推论：直线参数化后经线性映射仍是直线；0 必须映射到 0。',
        knowledgePoint: '线性变换的性质'
      }
    ]
  },
  'quiz-la-compose': {
    id: 'quiz-la-compose',
    conceptId: 'la-compose',
    passScore: 0.6,
    questions: [
      {
        id: 'la-c1',
        type: 'single',
        stem: '矩阵乘积 A·B 的几何含义是：',
        options: ['先做 A 再做 B', '先做 B 再做 A', 'A 与 B 同时作用', '两个变换取平均'],
        answer: 1,
        explanation: '从右往左读：先作用 B，再作用 A。顺序反了结果一般就变。',
        knowledgePoint: '复合顺序'
      },
      {
        id: 'la-c2',
        type: 'judge',
        stem: '一般情况下 AB = BA 成立。',
        answer: false,
        explanation: '旋转与剪切交换顺序结果不同，这就是矩阵乘法不可交换的几何原因。',
        knowledgePoint: '不可交换'
      },
      {
        id: 'la-c3',
        type: 'fill',
        stem: '若某个矩阵的行列式为 0，则这个变换把空间 ______（填「保持维数」或「压扁」）。',
        answer: ['压扁', '压缩', '降维'],
        explanation: '行列式为 0 意味着单位面积被压成 0，空间维数下降。',
        knowledgePoint: '复合的后果'
      }
    ]
  },
  'quiz-la-determinant': {
    id: 'quiz-la-determinant',
    conceptId: 'la-determinant',
    passScore: 0.6,
    questions: [
      {
        id: 'la-d1',
        type: 'single',
        stem: 'det([[3,0],[0,2]]) 等于多少，它说明了什么？',
        options: ['5：面积增加 5', '6：单位正方形面积变成 6', '1：面积不变', '0：空间被压扁'],
        answer: 1,
        explanation: '2×2 行列式为 ad−bc = 6；几何上面积被放大 6 倍。',
        knowledgePoint: '行列式与面积'
      },
      {
        id: 'la-d2',
        type: 'judge',
        stem: '行列式的绝对值表示面积缩放倍数，符号表示是否翻转定向。',
        answer: true,
        explanation: '负号只是说明平面被翻面，缩放倍数仍看绝对值。',
        knowledgePoint: '行列式的符号'
      },
      {
        id: 'la-d3',
        type: 'fill',
        stem: '若矩阵两行成比例，则它的行列式为 ______。',
        answer: ['0', '零', '0.0'],
        explanation: '成比例意味着变换把一个方向压成 0，面积必然归零。',
        knowledgePoint: '行列式为零'
      }
    ]
  },
  'quiz-la-inverse': {
    id: 'quiz-la-inverse',
    conceptId: 'la-inverse',
    passScore: 0.6,
    questions: [
      {
        id: 'la-i1',
        type: 'single',
        stem: '方程组 A·x = v 有无穷多解的几何原因是：',
        options: ['v 不在 A 的像空间内', 'A 的零空间里存在非零向量', 'A 的每一列都不为零', 'v 恰好等于零向量'],
        answer: 1,
        explanation: '存在非零零空间意味着多个输入落到同一输出，一旦有解就有无穷多解。',
        knowledgePoint: '零空间与多解'
      },
      {
        id: 'la-i2',
        type: 'judge',
        stem: '秩等于变换后空间的维数，也就是像空间的维数。',
        answer: true,
        explanation: '秩衡量的正是「还剩下几个独立方向」。',
        knowledgePoint: '秩的含义'
      },
      {
        id: 'la-i3',
        type: 'multiple',
        stem: '下列哪些条件可以保证方阵 A 可逆？',
        options: ['det(A) ≠ 0', 'A 的列向量线性无关', 'A 的秩等于阶数', 'A 的某一行全为 0'],
        answer: [0, 1, 2],
        explanation: '某一行全为 0 会把空间压扁，必然不可逆。',
        knowledgePoint: '可逆性判据'
      }
    ]
  },
  'quiz-la-eigen': {
    id: 'quiz-la-eigen',
    conceptId: 'la-eigen',
    passScore: 0.6,
    questions: [
      {
        id: 'la-e1',
        type: 'single',
        stem: '特征向量的定义是：',
        options: ['长度不变的向量', '变换后方向不变的向量', '坐标全为正的向量', '长度最大的向量'],
        answer: 1,
        explanation: '特征向量只被拉伸（或被反向），方向保持在同一条直线上。',
        knowledgePoint: '特征向量定义'
      },
      {
        id: 'la-e2',
        type: 'fill',
        stem: '对 [[4,0],[0,2]]，特征值是 4 和 ______。',
        answer: ['2', '2.0'],
        explanation: '对角矩阵的特征值就在对角线上。',
        knowledgePoint: '对角矩阵特征值'
      },
      {
        id: 'la-e3',
        type: 'judge',
        stem: '剪切矩阵 [[1,1],[0,1]] 只有一个独立特征向量。',
        answer: true,
        explanation: '它的两个特征值都是 1，但只有 x 轴方向的向量方向不变。',
        knowledgePoint: '特征向量可能不足'
      }
    ]
  },
  'quiz-la-practical': {
    id: 'quiz-la-practical',
    conceptId: 'la-practical',
    passScore: 0.6,
    questions: [
      {
        id: 'la-p1',
        type: 'single',
        stem: '为什么二维平移要用 3×3 齐次矩阵表示？',
        options: ['因为 3×3 算得更快', '因为平移不是线性变换，需要升维才能写成矩阵乘法', '因为二维坐标需要三位有效数字', '这是历史惯例，没有数学原因'],
        answer: 1,
        explanation: '平移不把原点映到原点，破坏了线性性；升到三维齐次坐标后它可以被统一表示。',
        knowledgePoint: '齐次坐标'
      },
      {
        id: 'la-p2',
        type: 'judge',
        stem: '「先旋转后缩放」与「先缩放后旋转」的结果在一般情况下相同。',
        answer: false,
        explanation: '变换顺序不同结果不同，除非两者恰好交换（例如同为同一轴上的缩放）。',
        knowledgePoint: '变换顺序'
      },
      {
        id: 'la-p3',
        type: 'multiple',
        stem: '用矩阵批量处理一组点，相比逐点手算有哪些好处？',
        options: ['顺序与复合关系可以被显式记录下来', '同一矩阵可以复用到任意多个点', '可以立刻看出是否发生降维', '保证结果一定符合预期'],
        answer: [0, 1, 2],
        explanation: '矩阵让复合与降维变得可见，但「符合预期」仍需要你验证。',
        knowledgePoint: '批量变换'
      }
    ]
  },
  'quiz-la-lab': {
    id: 'quiz-la-lab',
    conceptId: 'la-lab',
    passScore: 0.6,
    questions: [
      {
        id: 'la-l1',
        type: 'single',
        stem: '验证 applyMatrix 实现是否正确，下列哪种做法最可靠？',
        options: ['看输出的图形「好看」', '用手算过的特征向量做断言比较', '只测试单位矩阵', '让同学看一眼'],
        answer: 1,
        explanation: '特征向量方向不变是可以先算出精确期望值的性质，适合写成断言。',
        knowledgePoint: '数值验证'
      },
      {
        id: 'la-l2',
        type: 'judge',
        stem: '把变换前后的网格画在同一坐标系里，有助于判断变换是否保持平行性。',
        answer: true,
        explanation: '线性变换保持网格的等距平行结构，叠加对比最容易看出被压扁的情况。',
        knowledgePoint: '可视化对比'
      },
      {
        id: 'la-l3',
        type: 'fill',
        stem: '对任意矩阵 M，作用 0 向量后结果应当是 ______ 向量。',
        answer: ['零', '0', 'zero'],
        explanation: '线性变换必然把原点映到原点，这是最容易写的自检断言之一。',
        knowledgePoint: '线性自检'
      }
    ]
  }
};
