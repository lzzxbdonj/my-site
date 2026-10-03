/** Python 编程课程：面向零基础，强调「写完就能跑」的练习与真实小项目。 */

export const pythonCourse = {
  id: 'python',
  title: 'Python 编程：从第一行代码到小工具',
  subtitle: '语法一次讲清，练习当场可跑',
  summary:
    '这门课不追求把 Python 讲全，而是让你在最短时间里拥有「能写出有用小程序」的能力：环境、变量、字符串、分支、循环、函数、容器，一路配着练习，最后完成一个命令行记账工具和一个数据清洗脚本。',
  subjects: [{ id: 'code', name: '编程' }],
  tags: ['编程', 'Python', '零基础', '自动化'],
  level: '零基础',
  accent: 'amber',
  estimatedHours: 16,
  outcomes: [
    '独立安装 Python 与编辑器并运行第一个脚本',
    '用变量、字符串、条件与循环表达常见逻辑',
    '把重复代码抽成函数，读懂报错信息并调试',
    '用列表、字典等容器处理结构化数据'
  ],
  concepts: [
    {
      id: 'py-setup',
      type: 'concept',
      title: '环境搭建与第一个程序',
      summary: '安装解释器、跑通 print，理解「解释器 + 编辑器 + 脚本」三件事的关系。',
      difficulty: 1,
      estimatedMinutes: 40,
      examWeight: 3,
      prerequisites: [],
      videoIds: ['bili-py-01', 'bili-py-11'],
      quizId: 'quiz-py-setup',
      objectives: ['在 Windows/macOS 上安装 Python 并验证版本', '解释解释器与脚本文件的关系', '运行并修改第一个程序'],
      keyTerms: [
        { term: '解释器', definition: '逐行读取并执行 Python 代码的程序；`python 文件名.py` 就是在调用它。' },
        { term: '脚本', definition: '保存为 .py 文件、可以被重复运行的代码文本。' },
        { term: 'REPL', definition: '交互式解释器：输入一行立刻得到结果，适合做小实验。' }
      ],
      lesson: {
        sections: [
          {
            heading: '三件东西，一个流程',
            body: [
              '写 Python 需要三样东西：解释器（真正干活的程序）、文本编辑器或 IDE（写代码的地方）、以及你写下的脚本文件。流程是「编辑器保存 .py 文件 → 解释器读取并执行 → 终端显示输出」。',
              '安装时最容易踩的坑是忘记勾选「Add Python to PATH」，导致终端里找不到 python 命令；另一类问题是有多个版本共存，需要确认自己调用的是哪一个。'
            ],
            points: ['安装后先用 `python --version` 验证', 'Windows 安装务必勾选 Add to PATH', '报错先看终端里实际执行的是哪个解释器']
          },
          {
            heading: '第一个程序与调试习惯',
            body: [
              '每个程序员的第一行代码几乎都是打印语句。它看起来简单，却是之后所有调试的主力工具：怀疑某个变量的值时，先打印出来看。',
              '从第一天起就养成好习惯：出错时完整读一遍最后一行报错信息，它会告诉你文件、行号和错误类型。'
            ],
            points: ['print() 是最常用的调试手段', '报错信息最后一行才是重点', '改代码 → 重跑 → 观察差异']
          }
        ],
        takeaways: ['环境问题占了初学者一半的挫败感，稳住这三件事就能过去。'],
        pitfalls: ['把「命令找不到」当成代码写错，实际是 PATH 没配好。']
      },
      exercises: [
        { prompt: '打印三行内容：你的名字、今天日期、你想用 Python 做的一件事。', hint: '三个 print() 即可。' },
        { prompt: '故意写一个语法错误（例如漏掉右括号），观察报错信息，然后把行号读出来。', hint: 'Python 会指出具体行号与错误类型。' }
      ]
    },
    {
      id: 'py-variables',
      type: 'concept',
      title: '变量与数据类型',
      summary: '变量是名字与值的绑定；类型决定了这个值能做什么运算。',
      difficulty: 1,
      estimatedMinutes: 45,
      examWeight: 3,
      prerequisites: ['py-setup'],
      videoIds: ['bili-py-02', 'bili-py-03'],
      quizId: 'quiz-py-variables',
      objectives: ['解释赋值语句的执行顺序', '区分 int / float / str / bool', '用 type() 与类型转换排查问题'],
      keyTerms: [
        { term: '变量', definition: '指向某个对象的名称；`a = 3` 让 a 指向整数对象 3。' },
        { term: '动态类型', definition: '变量的类型由它当前指向的对象决定，同一个名字可以先后指向不同类型。' },
        { term: '类型转换', definition: '用 int()、float()、str() 等函数在类型之间显式转换。' }
      ],
      lesson: {
        sections: [
          {
            heading: '赋值是「贴标签」而不是「装盒子」',
            body: [
              '很多教材把变量比作盒子，但 Python 里更准确的比喻是标签：`a = 3` 表示把名字 a 贴到整数对象 3 上。之后 `b = a` 会让 a、b 指向同一个对象，修改可变对象时要特别小心。',
              '类型不是写死在名字上的：`x = 1` 之后 `x = "一"` 完全合法。这带来灵活性，也意味着你需要自己保证类型与运算匹配。'
            ],
            points: ['赋值把名字绑定到对象', '同名可先后指向不同类型', '`1` 与 `"1"` 是不同类型，运算结果完全不同']
          },
          {
            heading: '四种最常用的类型',
            body: [
              '整数 int（`7`）、浮点数 float（`3.14`）、字符串 str（`"你好"`）、布尔值 bool（`True`/`False`）。它们覆盖了入门阶段绝大多数场景。',
              '混用类型的典型错误是 `"3" + 4`：Python 会直接报 TypeError，而不是默默做奇怪的事。这种「早报错」是 Python 的优点，但要求你明确转换。'
            ],
            points: ['int / float / str / bool 是主力类型', 'input() 返回的永远是字符串', 'str(数字) 与 int(字符串) 是常用转换']
          }
        ],
        takeaways: ['搞清楚「这个名字现在指向什么类型的什么值」，一半的 bug 会消失。'],
        pitfalls: ['忘记 input() 返回字符串，直接和数字比较导致类型错误。']
      },
      exercises: [
        { prompt: '让用户输入两个数字并打印它们的和。', hint: 'input() 之后必须用 int() 或 float() 转换。' },
        { prompt: '用 type() 打印出 3、3.0、"3"、True 的类型，并解释布尔与整数的关系。', hint: 'bool 是 int 的子类，True == 1。' }
      ]
    },
    {
      id: 'py-strings',
      type: 'concept',
      title: '字符串与输入输出',
      summary: '字符串的拼接、格式化与切片，决定了程序能不能好好和人说话。',
      difficulty: 1,
      estimatedMinutes: 45,
      examWeight: 3,
      prerequisites: ['py-variables'],
      videoIds: ['bili-py-04'],
      quizId: 'quiz-py-strings',
      objectives: ['用 f-string 格式化输出', '用索引与切片取子串', '处理用户输入中的空格与类型'],
      keyTerms: [
        { term: 'f-string', definition: '以 f 开头的字符串，其中的 {表达式} 会被求值后插入。' },
        { term: '索引与切片', definition: 's[0] 取第一个字符，s[1:4] 取左闭右开的子串，负索引从右往左数。' },
        { term: '不可变', definition: '字符串一旦创建就不能就地修改，所有「修改」都会产生新字符串。' }
      ],
      lesson: {
        sections: [
          {
            heading: '让输出变得可读',
            body: [
              '最早的拼字符串写法是 `"你好，" + name + "！"`，一旦变量多起来就难以维护。f-string 把表达式直接写进模板：`f"你好，{name}！你今天是第 {count} 次运行。"`。',
              '格式化还能控制精度，例如 `f"{pi:.2f}"` 会保留两位小数——这类细节在输出报表时非常实际。'
            ],
            points: ['优先使用 f-string', '可以指定浮点精度与对齐', '字符串不可变，修改即产生新对象']
          },
          {
            heading: '切片是 Python 的招牌能力',
            body: [
              '`s[0:3]` 取前三个字符，`s[::-1]` 直接反转字符串，`s.split(",")` 按分隔符拆成列表。这些操作在处理文本数据时会被反复用到。',
              '注意「左闭右开」：`s[0:3]` 包含下标 0、1、2，不包含 3。这个约定在列表、切片、range() 中是一致的，记住一次就够。'
            ],
            points: ['切片左闭右开', '负索引从 -1 开始', 'split()/join() 是文本处理的核心']
          }
        ],
        takeaways: ['输出的可读性直接决定工具能不能被别人使用。'],
        pitfalls: ['切片越界不会报错但会静默少取内容，需要自己检查长度。']
      },
      exercises: [
        { prompt: '读入姓名与年龄，输出「张三，你明年 19 岁」。', hint: '输入用 int() 转换后再加一。' },
        { prompt: '把 "2026-10-03" 拆出年月日并分别打印。', hint: 'split("-") 返回列表。' }
      ]
    },
    {
      id: 'py-branch',
      type: 'concept',
      title: '条件分支与布尔逻辑',
      summary: 'if / elif / else 让程序做出选择；布尔运算把条件组合起来。',
      difficulty: 2,
      estimatedMinutes: 50,
      examWeight: 3,
      prerequisites: ['py-strings'],
      videoIds: ['bili-py-05'],
      quizId: 'quiz-py-branch',
      objectives: ['写多分支判断并说明执行顺序', '用 and / or / not 组合条件', '识别缩进错误'],
      keyTerms: [
        { term: '布尔表达式', definition: '结果为 True 或 False 的表达式，例如 score >= 60。' },
        { term: '短路求值', definition: 'and/or 在结果已确定时不再计算后面的表达式。' },
        { term: '缩进块', definition: 'Python 用缩进表示代码块的层次，缩进错误会直接报错或改变逻辑。' }
      ],
      lesson: {
        sections: [
          {
            heading: '自上而下，命中即停',
            body: [
              'Python 按顺序检查每个条件，第一个为真的分支执行后就跳过整条链路。所以条件的顺序会影响结果：把宽泛的条件放在前面会「吃掉」后面更精确的判断。',
              '空列表、空字符串、0、None 在布尔语境下都是假值，可以写 `if items:` 而不是 `if len(items) > 0`。'
            ],
            points: ['第一个为真的分支执行后立即结束', '顺序错了逻辑就错了', '空容器/0/None 都被视为假']
          },
          {
            heading: '组合条件与常见陷阱',
            body: [
              '`and` 要求两侧都为真，`or` 只要一侧为真。它们会短路：`if user and user.name` 在 user 为 None 时不会继续取属性，这是常用的防御写法。',
              '最容易犯的错误是把 `=` 当成 `==`。赋值语句不是表达式，写在条件里会直接报语法错误——这其实是好事，能早发现。'
            ],
            points: ['短路求值可用于安全访问', '比较用 ==，赋值用 =', '缩进不一致会改变逻辑']
          }
        ],
        takeaways: ['分支的本质是把「如何处理不同情况」显式写出来，而不是让程序猜。'],
        pitfalls: ['忘记处理 else 分支，导致某些输入下什么都不发生。']
      },
      exercises: [
        { prompt: '写一个成绩分级程序：90+ 为 A，80-89 为 B，60-79 为 C，其余为 D。', hint: '注意判断顺序要从高到低。' },
        { prompt: '判断某一年是否是闰年（能被 4 整除但不能被 100 整除，或能被 400 整除）。', hint: '用 or 组合两个条件。' }
      ]
    },
    {
      id: 'py-loop',
      type: 'concept',
      title: '循环与遍历',
      summary: 'for 遍历序列，while 持续到条件变化；break 与 continue 控制节奏。',
      difficulty: 2,
      estimatedMinutes: 55,
      examWeight: 3,
      prerequisites: ['py-branch'],
      videoIds: ['bili-py-06'],
      quizId: 'quiz-py-loop',
      objectives: ['选择合适的循环形式', '用 break/continue 控制流程', '避免死循环与差一错误'],
      keyTerms: [
        { term: 'for 循环', definition: '对可迭代对象中的每个元素依次执行代码块。' },
        { term: 'while 循环', definition: '条件为真时反复执行，适合次数未知的场景。' },
        { term: 'range()', definition: '产生整数序列，range(1,5) 得到 1,2,3,4（不含 5）。' }
      ],
      lesson: {
        sections: [
          {
            heading: '两种情况，两种工具',
            body: [
              '当你有一批东西要逐个处理（列表、字符串、文件行），用 for；当你在等某个条件成立（输入正确、猜测命中、数值收敛），用 while。',
              'while 的最大风险是死循环：一定要确认循环体里有让条件最终变假的语句，或者在合适的时机 break。'
            ],
            points: ['for 管「逐个处理」，while 管「直到满足」', 'range 左闭右开', 'while 必须能走向终止']
          },
          {
            heading: '常见循环模式',
            body: [
              '累加（total += x）、计数（count += 1）、查找（找到就 break 并记录）、嵌套（外层行、内层列，例如九九乘法表）。这四种模式覆盖了大量日常需求。',
              '另外，`for i in range(len(items))` 通常不是最好的写法，直接遍历元素，或者用 enumerate 拿到下标和值。'
            ],
            points: ['累加/计数/查找/嵌套是四种常见模式', '优先 for x in items', '需要下标时用 enumerate']
          }
        ],
        takeaways: ['循环让程序处理规模问题；写循环时先想清楚「什么时候停」。'],
        pitfalls: ['在循环里修改正在遍历的列表，会导致跳过元素。']
      },
      exercises: [
        { prompt: '用循环计算 1 到 100 的和，再计算其中的偶数之和。', hint: '用 range 与 if 结合。' },
        { prompt: '打印九九乘法表（至少完整三角形式）。', hint: '两层循环，内层范围随外层变化。' }
      ]
    },
    {
      id: 'py-functions',
      type: 'concept',
      title: '函数、参数与作用域',
      summary: '把重复逻辑打包成函数，是代码从「能跑」到「可维护」的关键一步。',
      difficulty: 2,
      estimatedMinutes: 55,
      examWeight: 3,
      prerequisites: ['py-loop'],
      videoIds: ['bili-py-07'],
      quizId: 'quiz-py-functions',
      objectives: ['定义并调用带参数的函数', '区分位置参数与关键字参数', '理解返回值与作用域'],
      keyTerms: [
        { term: '函数', definition: '一段有名字、可重复调用、能接收输入并返回输出的代码块。' },
        { term: '返回值', definition: '函数用 return 把结果交给调用者；没有 return 时返回 None。' },
        { term: '作用域', definition: '函数内部定义的变量默认只在该函数内可见。' }
      ],
      lesson: {
        sections: [
          {
            heading: '为什么要写函数',
            body: [
              '当同一段逻辑出现第二次，就该考虑抽成函数。函数带来三件事：复用（不再复制粘贴）、命名（用名字表达意图）、隔离（内部变量不污染外部）。',
              '判断一个函数写得好不好，看它的名字和参数能否让调用者不必读实现就知道在做什么。'
            ],
            points: ['重复出现两次就该抽函数', '函数名要说明「做什么」', '参数是函数对外的接口']
          },
          {
            heading: '参数与返回值',
            body: [
              '位置参数按顺序传入，关键字参数按名字传入，默认值让常用参数可以省略。可变参数 *args / **kwargs 用于参数个数不确定的场景。',
              '返回值让函数可以与外界交换数据。一个常见错误是忘记 return，于是函数返回 None，调用处再用它做运算就会报错。'
            ],
            points: ['默认参数会带来灵活性', '忘记 return 会得到 None', '函数内部变量默认不影响外部']
          }
        ],
        takeaways: ['函数是把「怎么做」封装起来、只暴露「做什么」的工具。'],
        pitfalls: ['用可变对象（如列表）作默认参数，会在多次调用间共享状态。']
      },
      exercises: [
        { prompt: '写 is_prime(n) 判断素数，并用它打印 100 以内的所有素数。', hint: '只需试除到平方根。' },
        { prompt: '写一个函数，接收一串数字，返回它们的平均值与最大值。', hint: '返回多个值时用元组或字典。' }
      ]
    },
    {
      id: 'py-containers',
      type: 'concept',
      title: '列表、元组、字典与集合',
      summary: '四种容器各有分工：有序可改、有序不可改、键值查找、去重集合。',
      difficulty: 2,
      estimatedMinutes: 60,
      examWeight: 3,
      prerequisites: ['py-functions'],
      videoIds: ['bili-py-08', 'bili-py-09', 'bili-py-12'],
      quizId: 'quiz-py-containers',
      objectives: ['根据场景选择容器类型', '熟练使用增删改查与遍历', '区分可变与不可变对象的影响'],
      keyTerms: [
        { term: '列表 list', definition: '有序、可变、可重复元素的容器，用下标访问。' },
        { term: '字典 dict', definition: '键值对集合，按键查找的平均时间复杂度接近常数。' },
        { term: '集合 set', definition: '无序、元素唯一的容器，适合去重与集合运算。' }
      ],
      lesson: {
        sections: [
          {
            heading: '按需求选容器',
            body: [
              '要按顺序保存一串数据并随时修改，用列表；数据不该被改动（例如坐标、配置项），用元组；要通过名字取值（例如一条记录的多个字段），用字典；只关心「有哪些」且不能重复，用集合。',
              '选错容器的代价是代码变得别扭：用列表存键值对会不断写循环查找，用字典存顺序数据会失去顺序保证。'
            ],
            points: ['列表：有序 + 可变', '元组：有序 + 不可变', '字典：按键查找', '集合：去重与集合运算']
          },
          {
            heading: '可变性带来的坑',
            body: [
              '把列表赋给另一个名字不会复制内容，两个名字指向同一个列表，改动会同时「生效」。需要副本时使用切片 `items[:]` 或 `list(items)`。',
              '字典的遍历、keys()/values()/items() 是处理结构化数据的常用组合；嵌套结构（字典里放列表）则是 JSON 数据的基本形态，这在机器学习数据预处理里随处可见。'
            ],
            points: ['赋值不复制，指向同一对象', 'items() 同时取键值', '嵌套结构 = JSON 的雏形']
          }
        ],
        takeaways: ['容器选对了，后面的循环和函数都会变简单。'],
        pitfalls: ['在遍历字典时增删键，会触发 RuntimeError。']
      },
      exercises: [
        { prompt: '用字典统计一段文本中每个单词出现的次数。', hint: 'counts[word] = counts.get(word, 0) + 1。' },
        { prompt: '给定两个列表，用集合求它们的交集、并集与差集。', hint: 'set(a) & set(b) 等形式。' }
      ]
    },
    {
      id: 'py-practical',
      type: 'practical',
      title: '实战：命令行记账小工具',
      summary: '把前面所有内容串起来，写一个能持续记录支出并汇总的小程序。',
      difficulty: 2,
      estimatedMinutes: 60,
      examWeight: 2,
      prerequisites: ['py-containers'],
      videoIds: ['bili-py-08'],
      objectives: ['用循环 + 分支实现菜单式交互', '用列表/字典保存记录', '输出可读的汇总结果'],
      keyTerms: [
        { term: '菜单循环', definition: '不断显示选项、读取输入、执行对应操作，直到用户选择退出。' },
        { term: '输入校验', definition: '在把用户输入转成数字或使用前，先判断它是否合法。' }
      ],
      lesson: {
        sections: [
          {
            heading: '任务背景',
            body: [
              '你每天记账很麻烦，于是想写一个命令行程序：可以添加一笔支出（金额 + 备注 + 日期）、查看全部记录、查看总支出与分类汇总、退出。',
              '这些需求恰好覆盖了变量、输入、条件、循环、函数与容器，是检验基础是否扎实的好题目。'
            ],
            points: ['先画流程再写代码', '每一步都做输入校验', '汇总输出面向人而不是机器']
          }
        ],
        takeaways: ['「能跑」不难，「换一个输入也不崩」才体现基本功。'],
        pitfalls: ['不校验输入，用户输入字母时程序直接崩溃退出。']
      },
      tasks: [
        { title: '设计数据结构', detail: '确定每条记录如何保存（提示：字典），以及所有记录放在哪种容器里。', acceptance: '写出一行注释说明字段含义。' },
        { title: '实现菜单循环', detail: '提供添加、查看、汇总、退出四个选项，非法选项有提示。', acceptance: '输入任意字符都不会让程序崩溃。' },
        { title: '实现汇总逻辑', detail: '计算总支出与按备注分类的支出，并按金额从高到低输出。', acceptance: '输出结果可人工核对正确。' },
        { title: '处理钱的精度问题', detail: '避免浮点数累加误差（提示：以「分」为单位存整数，或用 round 统一处理）。', acceptance: '连续累加 0.1 十次后总额显示为 1.00 而不是 0.999999。' }
      ],
      quizId: 'quiz-py-practical'
    },
    {
      id: 'py-lab',
      type: 'lab',
      title: '实验室：写一个数据清洗小工具',
      summary: '读取一份脏数据文本，清洗、统计并输出报表；过程中学会读报错与用异常兜底。',
      difficulty: 3,
      estimatedMinutes: 90,
      examWeight: 1,
      prerequisites: ['py-practical'],
      videoIds: ['bili-py-10'],
      objectives: ['用 try/except 处理脏数据的异常', '把清洗逻辑拆成可测试的函数', '输出统计结果报表'],
      keyTerms: [
        { term: '异常处理', definition: '用 try/except 捕获可预期的错误，让程序继续处理后续数据。' },
        { term: '脏数据', definition: '缺失、格式错误、单位不一致、重复的记录。' },
        { term: '报表', definition: '面向阅读者的汇总输出，通常包含总量、分布与异常计数。' }
      ],
      lesson: {
        sections: [
          {
            heading: '要做什么',
            body: [
              '给定一个文本文件，每行形如「姓名,年龄,城市」，其中可能包含空行、缺少字段、年龄不是数字、城市大小写不一致等情况。你的工具要输出：有效记录数、无效记录数（按原因分类）、各城市人数、平均年龄。',
              '关键要求是不能因为一行坏数据就整个崩掉——这正是异常处理真正有用的地方。'
            ],
            points: ['按行处理，逐行兜底', '统计无效原因而不只是计数', '把清洗与统计拆成两个函数']
          }
        ],
        takeaways: ['真实数据永远比示例数据脏，程序要为此设计。'],
        pitfalls: ['用裸 except 吞掉所有错误，掩盖真正的 bug。']
      },
      project: {
        goal: '交付一个能对脏 CSV/文本做清洗与统计的命令行工具，并附一份自己构造的测试数据与运行结果。',
        steps: [
          { title: '准备测试数据', detail: '手写至少 12 行数据，覆盖空行、缺字段、非数字年龄、大小写不一致、重复记录。', acceptance: '每条异常情况至少出现一次，并在文件中注释说明。' },
          { title: '实现清洗函数', detail: 'clean_line(line) 返回记录字典或 None，并对无效原因给出可读说明。', acceptance: '对准备的测试数据，无效行数与预期完全一致。' },
          { title: '实现统计与报表', detail: '汇总有效/无效数量、各城市人数、平均年龄。', acceptance: '所有数字都能由测试数据手工复核。' },
          { title: '错误处理与边界', detail: '处理文件不存在、编码问题、超大文件的分批读取。', acceptance: '文件不存在时给出友好提示而不是抛栈。' }
        ],
        deliverables: ['cleaning.py（或等价单文件）', '测试数据文件', '一次完整运行的输出记录', '说明文档：如何处理每类脏数据'],
        rubric: [
          { criterion: '健壮性：任何一行坏数据都不会导致整体崩溃', weight: 35 },
          { criterion: '正确性：统计结果与手工核对一致', weight: 30 },
          { criterion: '结构：清洗与统计职责分离，函数可单独测试', weight: 20 },
          { criterion: '文档：脏数据处理策略清晰', weight: 15 }
        ]
      },
      quizId: 'quiz-py-lab'
    }
  ]
};
