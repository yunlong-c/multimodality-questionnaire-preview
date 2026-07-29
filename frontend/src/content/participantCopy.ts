export const LANDING_COPY = {
  eyebrow: "学术研究",
  title: "时间序列预测研究",
  lead: "欢迎参与本项学术研究。接下来，您将查看若干组历史数值，并对下一期数值作出预测。",
  detail: "每道题都会呈现前 20 期数据。请根据所呈现的信息，填写您对第 21 期数值的预测。",
  duration: "约 5–10 分钟",
  questionCount: "共 5 道预测题",
  continueButton: "查看参与说明"
} as const;

export const INSTRUCTIONS_COPY = {
  eyebrow: "步骤与说明",
  title: "参与说明",
  intro: "在本次研究中，您将经历以下步骤：",
  viewLabel: "查看数据：",
  viewText: "您将看到一组前 20 期历史数值信息。",
  pointLabel: "预测数值：",
  pointText: "根据这 20 期数据，请填写您对第 21 期数值的预测。",
  distributionLabel: "最后一题：",
  distributionText:
    "除了预测数值，您还需要填写 5 个您认为可能出现的数值，并为每个数值分配概率（总和为 100%）。",
  backgroundLabel: "背景信息：",
  backgroundText: "完成预测后，请填写一份简短的背景问卷。",
  durationAndMethod:
    "整个过程大约需要 5 到 10 分钟。请根据自己的判断独立作答。",
  backButton: "返回",
  consentButton: "继续到参与确认"
} as const;

export const TRIAL_COPY = {
  title: "预测第 21 期",
  helper: "请查看前 20 期历史数据并填写第 21 期预测值。",
  pointLabel: "第 21 期预测值"
} as const;

export const DISTRIBUTION_LABELS = [
  "最低",
  "较低",
  "中等",
  "较高",
  "最高"
] as const;

export const DISTRIBUTION_COPY = {
  title: "可能结果与概率",
  helper:
    "请填写 5 个可能数值及其对应概率。仅“可能数值”一列须从小到大排列（可相等）；“对应概率”不要求按大小排列，只需与同一行的数值对应，5 项合计须为 100%。",
  guideSummary: "查看填写规则与示例",
  guideItems: [
    "“可能数值”一列：从“最低”到“最高”依次填写，可相等，但不能递减。",
    "“对应概率”一列：不要求按大小排列；每项与同一行的可能数值对应，5 项合计须为 100%。"
  ],
  exampleNote: "以下数值和概率仅用于说明填写格式，与本题答案无关，请勿照抄。",
  exampleTableAriaLabel: "可能数值与概率填写示例",
  exampleTotalLabel: "合计",
  tableAriaLabel: "五个可能数值及对应概率",
  levelHeader: "水平",
  valueHeader: "可能数值",
  probabilityHeader: "对应概率",
  initialProbabilityTotal: "概率合计：0%（需为100%）",
  initialOrder: "仅“可能数值”一列需按从小到大填写；“对应概率”不要求排序。"
} as const;

export const DISTRIBUTION_EXAMPLE_ROWS = [
  { level: "最低", value: 1, probability: 10 },
  { level: "较低", value: 2, probability: 20 },
  { level: "中等", value: 3, probability: 40 },
  { level: "较高", value: 4, probability: 20 },
  { level: "最高", value: 5, probability: 10 }
] as const;

export const PRE_TASK_COPY = [
  ...Object.values(LANDING_COPY),
  ...Object.values(INSTRUCTIONS_COPY),
  ...Object.values(TRIAL_COPY),
  DISTRIBUTION_COPY.title,
  DISTRIBUTION_COPY.helper,
  DISTRIBUTION_COPY.guideSummary,
  ...DISTRIBUTION_COPY.guideItems,
  DISTRIBUTION_COPY.exampleNote,
  DISTRIBUTION_COPY.exampleTableAriaLabel,
  DISTRIBUTION_COPY.exampleTotalLabel,
  DISTRIBUTION_COPY.tableAriaLabel,
  DISTRIBUTION_COPY.levelHeader,
  DISTRIBUTION_COPY.valueHeader,
  DISTRIBUTION_COPY.probabilityHeader,
  DISTRIBUTION_COPY.initialProbabilityTotal,
  DISTRIBUTION_COPY.initialOrder,
  ...DISTRIBUTION_EXAMPLE_ROWS.flatMap(({ level, value, probability }) => [
    level,
    String(value),
    `${probability}%`
  ]),
  ...DISTRIBUTION_LABELS
] as const;
