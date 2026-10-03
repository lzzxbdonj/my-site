/** Python 课程随堂测验。 */

export const pythonQuizzes = {
  'quiz-py-setup': {
    id: 'quiz-py-setup',
    conceptId: 'py-setup',
    passScore: 0.6,
    questions: [
      { id: 'py-s1', type: 'single', stem: '在终端执行 `python hello.py` 时，真正读取并执行代码的是：', options: ['编辑器', 'Python 解释器', '操作系统内核', '浏览器'], answer: 1, explanation: '解释器负责逐行读取并执行脚本；编辑器只负责保存文本。', knowledgePoint: '解释器与脚本' },
      { id: 'py-s2', type: 'judge', stem: 'Windows 安装 Python 时如果忘记勾选 Add to PATH，终端里可能找不到 python 命令。', answer: true, explanation: 'PATH 决定系统在哪些目录里查找命令，配置缺失就会出现「命令不存在」。', knowledgePoint: '环境配置' },
      { id: 'py-s3', type: 'fill', stem: '程序出错时，报错信息里最应该先看的是最后一行给出的错误类型和 ______。', answer: ['行号', '文件行号', '位置'], explanation: '报错会指出出错的行号，先定位那行再谈原因。', knowledgePoint: '读报错' }
    ]
  },
  'quiz-py-variables': {
    id: 'quiz-py-variables',
    conceptId: 'py-variables',
    passScore: 0.6,
    questions: [
      { id: 'py-v1', type: 'single', stem: '`x = 3` 这句话在 Python 中的含义最接近：', options: ['创建了一个名为 x 的盒子并把 3 装进去', '把名字 x 绑定到整数对象 3 上', '声明了 x 是整数类型，之后不能再改变', '把 3 赋值给常量 x'], answer: 1, explanation: 'Python 的变量是名字到对象的绑定，类型跟随对象而不是名字。', knowledgePoint: '变量绑定' },
      { id: 'py-v2', type: 'judge', stem: '`input()` 函数返回的值是字符串，需要用 int()/float() 转换才能做数值运算。', answer: true, explanation: '这是初学者最常见的类型错误来源。', knowledgePoint: '类型转换' },
      { id: 'py-v3', type: 'fill', stem: '`3 + "4"` 在 Python 中会引发 ______ 错误。', answer: ['TypeError', '类型错误', 'typeerror'], explanation: '整数与字符串不能直接相加，必须显式转换。', knowledgePoint: '类型匹配' }
    ]
  },
  'quiz-py-strings': {
    id: 'quiz-py-strings',
    conceptId: 'py-strings',
    passScore: 0.6,
    questions: [
      { id: 'py-str1', type: 'single', stem: '要把变量 name 插入到字符串里，下列写法最推荐：', options: ['"你好，" + name', 'f"你好，{name}"', '"你好，%s" % name', '"你好，{}".format(name)'], answer: 1, explanation: 'f-string 可读性最好、出错最少，是当前 Python 的主流写法。', knowledgePoint: 'f-string' },
      { id: 'py-str2', type: 'single', stem: '`s = "abcdef"` 时，`s[1:3]` 的结果是：', options: ['"ab"', '"bc"', '"bcd"', '"abc"'], answer: 1, explanation: '切片左闭右开，包含下标 1、2，即 "bc"。', knowledgePoint: '切片' },
      { id: 'py-str3', type: 'judge', stem: '字符串是不可变对象，`s.upper()` 返回新字符串而不改变 s。', answer: true, explanation: '所有「修改」字符串的方法都会返回新对象。', knowledgePoint: '不可变对象' }
    ]
  },
  'quiz-py-branch': {
    id: 'quiz-py-branch',
    conceptId: 'py-branch',
    passScore: 0.6,
    questions: [
      { id: 'py-b1', type: 'single', stem: '关于 if / elif / else 的执行方式，正确的是：', options: ['所有条件都会被检查并执行所有命中的分支', '按顺序检查，第一个为真的分支执行后整条链路结束', 'else 一定会执行', 'elif 分支总是优先执行'], answer: 1, explanation: '自上而下、命中即停，因此条件顺序会影响结果。', knowledgePoint: '分支顺序' },
      { id: 'py-b2', type: 'judge', stem: '空列表、空字符串和 0 在条件判断中都被当作假值。', answer: true, explanation: '这让你可以写 `if items:` 这样的简洁判断。', knowledgePoint: '真值判断' },
      { id: 'py-b3', type: 'single', stem: '判断闰年时写 `year % 4 == 0 and year % 100 != 0 or year % 400 == 0`，其中的 and/or 之所以能这样组合，依赖的性质是：', options: ['and 优先级高于 or', '短路求值', '整数取模会四舍五入', 'Python 会自动加括号'], answer: 0, explanation: 'and 的优先级高于 or，因此 (A and B) or C 的语义正是闰年规则；短路求值是另一个特性。', knowledgePoint: '布尔优先级' }
    ]
  },
  'quiz-py-loop': {
    id: 'quiz-py-loop',
    conceptId: 'py-loop',
    passScore: 0.6,
    questions: [
      { id: 'py-l1', type: 'single', stem: '需要「对列表里的每个元素都做同一件事」时，最合适的写法是：', options: ['while 循环加手动下标', 'for 循环直接遍历元素', '递归', '内置排序'], answer: 1, explanation: 'for 遍历更安全、更易读，不需要维护下标。', knowledgePoint: '循环选择' },
      { id: 'py-l2', type: 'single', stem: '`range(1, 5)` 产生的整数是：', options: ['1,2,3,4,5', '1,2,3,4', '1,3,5', '0,1,2,3,4'], answer: 1, explanation: 'range 左闭右开，不含终点 5。', knowledgePoint: 'range' },
      { id: 'py-l3', type: 'judge', stem: '在 for 循环中修改正在遍历的列表，可能导致某些元素被跳过。', answer: true, explanation: '遍历依赖内部索引，增删元素会让索引与内容错位。', knowledgePoint: '遍历陷阱' }
    ]
  },
  'quiz-py-functions': {
    id: 'quiz-py-functions',
    conceptId: 'py-functions',
    passScore: 0.6,
    questions: [
      { id: 'py-f1', type: 'single', stem: '一个函数没有写 return，调用它的结果是：', options: ['报错', '返回 None', '返回 0', '返回最后一个表达式的值'], answer: 1, explanation: 'Python 函数默认返回 None，忘记 return 是常见 bug。', knowledgePoint: '返回值' },
      { id: 'py-f2', type: 'judge', stem: '函数内部定义的变量，默认在函数外部不可见。', answer: true, explanation: '这就是作用域隔离，它让函数之间相互独立。', knowledgePoint: '作用域' },
      { id: 'py-f3', type: 'multiple', stem: '把重复代码抽成函数能带来哪些好处？', options: ['复用逻辑，减少复制粘贴', '用函数名表达意图，提升可读性', '与外部变量隔离，减少意外互相影响', '自动提升运行速度'], answer: [0, 1, 2], explanation: '函数解决的是可维护性问题，不是自动的性能优化。', knowledgePoint: '函数的价值' }
    ]
  },
  'quiz-py-containers': {
    id: 'quiz-py-containers',
    conceptId: 'py-containers',
    passScore: 0.6,
    questions: [
      { id: 'py-c1', type: 'single', stem: '需要通过「名字」快速取出一条记录的多个字段，最适合的容器是：', options: ['列表', '元组', '字典', '字符串'], answer: 2, explanation: '字典按键查找，语义清晰且平均查找接近常数时间。', knowledgePoint: '容器选择' },
      { id: 'py-c2', type: 'judge', stem: '`b = a` 会让 b 与 a 指向同一个列表，修改 b 也会改变 a。', answer: true, explanation: '赋值复制的是引用，需要副本时用 a[:] 或 list(a)。', knowledgePoint: '可变对象' },
      { id: 'py-c3', type: 'fill', stem: '要同时遍历字典的键和值，可以使用字典的 ______() 方法。', answer: ['items', 'items()'], explanation: 'items() 返回键值对序列，便于 `for k, v in d.items()`。', knowledgePoint: '字典遍历' }
    ]
  },
  'quiz-py-practical': {
    id: 'quiz-py-practical',
    conceptId: 'py-practical',
    passScore: 0.6,
    questions: [
      { id: 'py-p1', type: 'single', stem: '记账程序里多次累加 0.1 后总额显示为 0.9999999，原因是：', options: ['Python 的加法有 bug', '浮点数用二进制表示，无法精确表示 0.1', '字符串没有转换类型', '变量名不合法'], answer: 1, explanation: '浮点误差是 IEEE 754 的固有性质，金额通常改用「分」为单位的整数。', knowledgePoint: '浮点精度' },
      { id: 'py-p2', type: 'judge', stem: '菜单循环中，用户输入非法选项时应该给出提示并继续循环，而不是崩溃。', answer: true, explanation: '输入校验是命令行工具的基本要求。', knowledgePoint: '输入校验' },
      { id: 'py-p3', type: 'multiple', stem: '为了让记账工具更好用，下列哪些做法值得做？', options: ['每条记录保存金额、备注、日期', '汇总时按金额排序', '把数据保存到文件以便下次继续', '把所有数据放在一个字符串里拼接'], answer: [0, 1, 2], explanation: '结构化存储 + 排序 + 持久化才是可用工具；字符串拼接会难以解析。', knowledgePoint: '数据结构设计' }
    ]
  },
  'quiz-py-lab': {
    id: 'quiz-py-lab',
    conceptId: 'py-lab',
    passScore: 0.6,
    questions: [
      { id: 'py-lab1', type: 'single', stem: '处理脏数据时，下列哪种异常处理方式最糟糕？', options: ['只捕获预期的 ValueError 并记录原因', '用裸 except 吞掉所有错误且不记录', '在循环内逐行 try/except', '遇到无法修复的行时跳过并计数'], answer: 1, explanation: '裸 except 会掩盖真正的程序缺陷，让问题更难发现。', knowledgePoint: '异常处理' },
      { id: 'py-lab2', type: 'judge', stem: '清洗逻辑与统计逻辑拆成不同函数，更利于单独测试与复用。', answer: true, explanation: '职责单一的函数更容易写出断言。', knowledgePoint: '函数拆分' },
      { id: 'py-lab3', type: 'fill', stem: '读取文件时应假设它可能不存在，可以用 ______ 语句捕获 FileNotFoundError。', answer: ['try/except', 'try except', 'try'], explanation: '把可预期的失败显式处理，程序才不会被外部环境左右。', knowledgePoint: '文件边界' }
    ]
  }
};
