(function () {
  const DEFAULT_LANGUAGE = 'zh';
  const STORAGE_KEY = 'mall-selfheal-demo-lang';
  const SUPPORTED_LANGUAGES = new Set(['zh', 'en']);
  const BOOK_COVER_PALETTE = Object.freeze({
    backgroundStart: '#fff8f3',
    backgroundEnd: '#fff0f6',
    accentStart: '#ff7a00',
    accentMiddle: '#ff3856',
    accentEnd: '#d730ff',
    title: '#24152f',
    label: '#9b3d56',
    muted: '#684f70',
    surface: '#fff',
  });

  function escapeSvgText(value) {
    return String(value)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&apos;');
  }

  function createBookCoverDataUri({ label, titleLines, titleFontSize, subtitle, footer, palette }) {
    const title = titleLines
      .map((line, index) => `
        <text x="28" y="${154 + (index * 54)}" fill="${palette.title}" font-family="Arial, 'Noto Sans SC', sans-serif" font-size="${titleFontSize}" font-weight="800">${escapeSvgText(line)}</text>
      `)
      .join('');
    const svg = `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 400" role="img">
        <defs>
          <linearGradient id="cover-bg" x1="18" y1="382" x2="282" y2="18" gradientUnits="userSpaceOnUse">
            <stop stop-color="${palette.backgroundStart}"/>
            <stop offset="1" stop-color="${palette.backgroundEnd}"/>
          </linearGradient>
          <linearGradient id="cover-accent" x1="28" y1="0" x2="272" y2="0" gradientUnits="userSpaceOnUse">
            <stop stop-color="${palette.accentStart}"/>
            <stop offset="0.5" stop-color="${palette.accentMiddle}"/>
            <stop offset="1" stop-color="${palette.accentEnd}"/>
          </linearGradient>
        </defs>
        <rect width="300" height="400" rx="18" fill="url(#cover-bg)"/>
        <rect x="14" y="14" width="272" height="372" rx="13" fill="none" stroke="url(#cover-accent)" stroke-width="4"/>
        <rect x="28" y="34" width="244" height="8" rx="4" fill="url(#cover-accent)"/>
        <text x="28" y="78" fill="${palette.label}" font-family="Arial, sans-serif" font-size="15" font-weight="700" letter-spacing="2">${escapeSvgText(label)}</text>
        ${title}
        <text x="28" y="276" fill="${palette.muted}" font-family="Arial, 'Noto Sans SC', sans-serif" font-size="16">${escapeSvgText(subtitle)}</text>
        <g transform="translate(28 300)" fill="none" stroke="url(#cover-accent)" stroke-width="4" stroke-linecap="round">
          <circle cx="12" cy="28" r="8" fill="${palette.surface}"/>
          <circle cx="64" cy="8" r="8" fill="${palette.surface}"/>
          <circle cx="118" cy="34" r="8" fill="${palette.surface}"/>
          <circle cx="180" cy="14" r="8" fill="${palette.surface}"/>
          <path d="M20 25 56 11M72 11l38 20M126 31l46-14"/>
        </g>
        <text x="28" y="365" fill="${palette.label}" font-family="Arial, 'Noto Sans SC', sans-serif" font-size="14" font-weight="700">${escapeSvgText(footer)}</text>
      </svg>
    `;
    return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg.replace(/\s+/g, ' ').trim())}`;
  }

  function createBookCovers(palette) {
    return Object.freeze({
      zh: createBookCoverDataUri({
        label: 'MALL DEMO',
        titleLines: ['可观测性', '工程'],
        titleFontSize: 38,
        subtitle: '指标 · 日志 · 链路 · 用户体验',
        footer: '可观测性实践演示版',
        palette,
      }),
      en: createBookCoverDataUri({
        label: 'MALL DEMO',
        titleLines: ['OBSERVABILITY', 'ENGINEERING'],
        titleFontSize: 28,
        subtitle: 'Metrics · Logs · Traces · RUM',
        footer: 'OBSERVABILITY DEMO EDITION',
        palette,
      }),
    });
  }

  const bookCovers = createBookCovers(BOOK_COVER_PALETTE);

  const legacyProducts = [
    {
      sku: 'sku-1001',
      icon: 'BOOK',
      amountCent: 9900,
      zh: {
        name: '可观测性工程',
        cover: bookCovers.zh,
        coverAlt: '《可观测性工程》中文版封面',
        badge: '技术书籍',
        tagline: '从指标、日志、链路、事件到协作流程，系统理解现代可观测性实践。',
        price: '￥99.00',
        note: '纸质书',
        author: 'Charity Majors 等',
        edition: '中文版',
        bullets: ['可观测性工程实践', '故障排查与系统调试', '适合研发、SRE 与平台团队'],
      },
      en: {
        name: 'Observability Engineering',
        cover: bookCovers.en,
        coverAlt: 'Observability Engineering English book cover',
        badge: 'Technical book',
        tagline: 'A practical guide to modern observability across telemetry, debugging, and team workflows.',
        price: 'CNY 99.00',
        note: 'Paperback',
        author: 'Charity Majors et al.',
        edition: 'English edition',
        bullets: ['Observability practices', 'Troubleshooting and debugging', 'For engineers, SRE, and platform teams'],
      },
    },
  ];

  const products = Object.freeze([
    {
      id: 'observability-engineering', sku: 'sku-1001', price: 99, amountCent: 9900, rating: 4.9, rank: 1,
      tags: ['foundation', 'tracing', 'reliability', 'team'],
      image: 'assets/observability-engineering-zh.png', imageEn: 'assets/observability-engineering-en.png',
      zh: {
        title: '可观测性工程', englishTitle: 'Observability Engineering', shortTitle: '可观测性工程',
        author: 'Charity Majors、Liz Fong-Jones、George Miranda', authorShort: 'Charity Majors 等', badge: '综合实践',
        description: '一本面向现代复杂系统的实践指南，系统解释可观测性为何不同于传统监控，以及团队如何借助结构化事件、分布式追踪、OpenTelemetry、SLO 和组织协作，更快地理解与调试未知问题。',
        published: '2022 年 5 月', pages: '318 页', level: '中高级', publisher: "O'Reilly Media", isbn: '9781492076438',
        learn: [['建立正确概念', '理解可观测性、监控与现代调试之间的边界和联系。'], ['组织遥测数据', '用结构化事件、Trace 与 OpenTelemetry 构建可分析的数据。'], ['推动团队实践', '把 SLO、可观测性驱动开发和组织文化融入交付流程。']],
        parts: [['I', '走向可观测性', '定义、调试差异、规模化经验，以及与 DevOps / SRE 的关系。'], ['II', '可观测性基础', '结构化事件、分布式追踪、OpenTelemetry 与事件分析。'], ['III', '面向团队的实践', '可观测性驱动开发、SLO、告警与组织落地。'], ['IV', '规模化可观测性', '数据存储、采样、遥测管道与成熟度模型。']],
        audience: [['研发工程师', '需要在微服务和分布式系统中定位未知问题的开发者。'], ['SRE / 运维工程师', '希望减少告警疲劳、建立 SLO 并改进故障响应的团队。'], ['平台工程团队', '负责统一遥测、工具链和内部开发者体验的平台建设者。']]
      },
      en: {
        title: 'Observability Engineering', englishTitle: 'Achieving Production Excellence', shortTitle: 'Observability\nEngineering',
        author: 'Charity Majors, Liz Fong-Jones, and George Miranda', authorShort: 'Charity Majors et al.', badge: 'End-to-End Practice',
        description: 'A practical guide to modern, complex systems. It explains how observability differs from traditional monitoring and how teams use structured events, distributed tracing, OpenTelemetry, SLOs, and collaborative practices to debug previously unknown problems.',
        published: 'May 2022', pages: '318 pages', level: 'Intermediate–advanced', publisher: "O'Reilly Media", isbn: '9781492076438',
        learn: [['Build the right mental model', 'Understand the boundaries among observability, monitoring, and modern debugging.'], ['Shape useful telemetry', 'Use structured events, traces, and OpenTelemetry to create explorable data.'], ['Make it a team practice', 'Bring SLOs and observability-driven development into delivery.']],
        parts: [['I', 'The path to observability', 'Definitions, debugging differences, scaling lessons, and DevOps / SRE.'], ['II', 'Observability fundamentals', 'Structured events, distributed tracing, OpenTelemetry, and analysis.'], ['III', 'Practices for teams', 'Team adoption, SLOs, alerting, and observability-driven development.'], ['IV', 'Observability at scale', 'Data stores, sampling, telemetry pipelines, and maturity.']],
        audience: [['Software engineers', 'Developers debugging unknown behavior in distributed systems.'], ['SRE and operations', 'Teams reducing alert fatigue and improving incident response.'], ['Platform engineers', 'Builders of shared telemetry and internal developer platforms.']]
      }
    },
    {
      id: 'distributed-observability', sku: 'sku-1001', price: 49, amountCent: 4900, rating: 4.7, rank: 2,
      tags: ['foundation', 'tracing', 'systems'],
      cover: ['#30283d', '#fff8f0', '#ff7a00', 'radial-gradient(circle at 72% 72%, rgba(215,48,255,.48) 0 15%, transparent 16%), linear-gradient(145deg, transparent 42%, rgba(255,255,255,.16) 43% 45%, transparent 46%)'],
      zh: { title: '分布式系统可观测性', englishTitle: 'Distributed Systems Observability', shortTitle: '分布式系统\n可观测性', author: 'Cindy Sridharan', authorShort: 'Cindy Sridharan', badge: '观测入门', description: '聚焦分布式系统中的监控难题与取舍，讨论日志、指标和追踪各自的优势与局限，并给出逐步演进观测体系的清晰蓝图。', published: '2018 年 7 月', pages: '34 页', level: '中高级', publisher: "O'Reilly Media", isbn: '9781492033431', learn: [['理解三类信号', '比较日志、指标与追踪在调试复杂系统时的不同作用。'], ['识别软失败', '理解分布式架构中局部、隐式和难以监控的失败模式。'], ['演进观测体系', '根据系统复杂度和团队需求选择合适策略。']], parts: [['01', '为什么需要可观测性', '从分布式系统复杂度与运营挑战开始。'], ['02', '监控与可观测性', '告警、信号选择与不可监控故障。'], ['03', '为可观测性编码', '面向失败的代码与测试方法。'], ['04', '日志、指标与追踪', '三类遥测信号的优势、限制与组合。']], audience: [['后端工程师', '正在构建或维护分布式服务的开发者。'], ['SRE', '需要重新评估监控体系和告警策略的工程师。'], ['架构师', '关注观测工具取舍与系统可调试性的负责人。']] },
      en: { title: 'Distributed Systems Observability', englishTitle: 'A practical introduction to production signals', shortTitle: 'Distributed Systems\nObservability', author: 'Cindy Sridharan', authorShort: 'Cindy Sridharan', badge: 'Observability Primer', description: 'A concise guide to monitoring tradeoffs in distributed systems. It compares logs, metrics, and traces, explains partial and soft failures, and offers a clear path for evolving an observability practice.', published: 'July 2018', pages: '34 pages', level: 'Intermediate–advanced', publisher: "O'Reilly Media", isbn: '9781492033431', learn: [['Compare the three signals', 'Understand the roles of logs, metrics, and traces in complex systems.'], ['Recognize soft failures', 'Identify partial and difficult-to-monitor failure modes.'], ['Evolve your approach', 'Choose practices that match system complexity and team needs.']], parts: [['01', 'Why observability', 'Distributed-system complexity and operational challenges.'], ['02', 'Monitoring and observability', 'Alerts, signal selection, and failures that evade monitoring.'], ['03', 'Coding for observability', 'Failure-aware code and testing methods.'], ['04', 'Logs, metrics, and traces', 'Strengths, limitations, and combinations of the three signals.']], audience: [['Backend engineers', 'Developers building distributed services.'], ['SREs', 'Engineers reassessing monitoring and alerts.'], ['Architects', 'Leaders evaluating observability tradeoffs.']] }
    },
    {
      id: 'implementing-slo', sku: 'sku-1001', price: 89, amountCent: 8900, rating: 4.8, rank: 3,
      tags: ['reliability', 'team'],
      cover: ['#183d47', '#f6fbf7', '#ff8a55', 'linear-gradient(160deg, transparent 0 55%, rgba(255,138,85,.55) 56% 58%, transparent 59%), radial-gradient(circle at 72% 72%, rgba(75,195,174,.55) 0 16%, transparent 17%)'],
      zh: { title: '实施服务级别目标', englishTitle: 'Implementing Service Level Objectives', shortTitle: '实施 SLO', author: 'Alex Hidalgo', authorShort: 'Alex Hidalgo', badge: 'SLO 实践', description: '从用户视角定义有意义的 SLI 和 SLO，使用错误预算推动数据驱动决策，并从零开始建立支持 SLO 的工具、流程与组织文化。', published: '2020 年 8 月', pages: '402 页', level: '中高级', publisher: "O'Reilly Media", isbn: '9781492076803', learn: [['定义用户可靠性', '选择真正反映用户体验的 SLI 和目标。'], ['使用错误预算', '让稳定性、发布速度和风险讨论建立在共同数据上。'], ['建立 SLO 文化', '从试点、培训到跨团队推广形成可持续流程。']], parts: [['I', 'SLO 开发', '可靠性堆栈、SLI、目标与错误预算。'], ['II', 'SLO 实施', '组织共识、测量、工具与案例。'], ['III', 'SLO 文化', '推广、报告与持续改进。']], audience: [['SRE 团队', '准备建立或改进 SLO 体系的可靠性工程师。'], ['产品与研发', '围绕用户体验讨论可靠性目标的跨职能团队。'], ['工程管理者', '用错误预算协调稳定性与交付速度的负责人。']] },
      en: { title: 'Implementing Service Level Objectives', englishTitle: 'A Practical Guide to SLIs, SLOs, and Error Budgets', shortTitle: 'Implementing\nSLOs', author: 'Alex Hidalgo', authorShort: 'Alex Hidalgo', badge: 'SLO Practice', description: 'Define meaningful SLIs and SLOs from the user perspective, apply error budgets to data-driven decisions, and build the tooling, process, and culture needed to operate an SLO program.', published: 'August 2020', pages: '402 pages', level: 'Intermediate–advanced', publisher: "O'Reilly Media", isbn: '9781492076803', learn: [['Define user reliability', 'Choose SLIs and objectives that reflect customer experience.'], ['Use error budgets', 'Ground reliability and release discussions in shared data.'], ['Build an SLO culture', 'Move from pilots to sustainable cross-team adoption.']], parts: [['I', 'Developing SLOs', 'The reliability stack, SLIs, objectives, and error budgets.'], ['II', 'Implementing SLOs', 'Alignment, measurement, tooling, and case studies.'], ['III', 'SLO culture', 'Adoption, reporting, and continuous improvement.']], audience: [['SRE teams', 'Engineers building or improving an SLO program.'], ['Product and engineering', 'Teams aligning reliability with user experience.'], ['Engineering managers', 'Leaders balancing reliability and delivery speed.']] }
    },
    {
      id: 'site-reliability-engineering', sku: 'sku-1001', price: 79, amountCent: 7900, rating: 4.9, rank: 4,
      tags: ['reliability', 'team', 'systems'],
      cover: ['#f3ede1', '#372e28', '#f04b3f', 'repeating-linear-gradient(155deg, transparent 0 17px, rgba(240,75,63,.14) 18px 20px), radial-gradient(circle at 73% 72%, rgba(255,122,0,.25) 0 16%, transparent 17%)'],
      zh: { title: '网站可靠性工程', englishTitle: 'Site Reliability Engineering', shortTitle: 'SRE', author: 'Betsy Beyer、Chris Jones、Jennifer Petoff、Niall Richard Murphy', authorShort: 'Google SRE 团队', badge: 'SRE 经典', description: 'Google SRE 团队总结如何以软件工程方法运行大型生产系统，覆盖风险、SLO、自动化、告警、故障响应、容量与组织协作。', published: '2016 年', pages: '经典合集', level: '中高级', publisher: 'O’Reilly / Google', isbn: 'SRE Book', learn: [['以工程方法做运维', '把重复的运营工作转化为可扩展的软件系统。'], ['平衡风险与可靠性', '使用 SLO、错误预算和容量规划保护用户体验。'], ['建立故障文化', '通过值班、应急响应和复盘持续改进。']], parts: [['I', '概念与背景', 'Google 生产环境与 SRE 的基本定义。'], ['II', '核心原则', '风险、SLO、消除琐务、监控与自动化。'], ['III', '工程实践', '告警、值班、故障响应、容量与系统设计。'], ['IV', '组织与管理', '团队成长、协作和参与模式。']], audience: [['SRE / 运维', '系统学习可靠性工程原则和实践的工程师。'], ['研发工程师', '理解生产系统运行约束与故障模式的开发者。'], ['平台工程师', '建设自动化、监控和内部平台的团队成员。']] },
      en: { title: 'Site Reliability Engineering', englishTitle: 'How Google Runs Production Systems', shortTitle: 'Site Reliability\nEngineering', author: 'Betsy Beyer, Chris Jones, Jennifer Petoff, and Niall Richard Murphy', authorShort: 'Google SRE team', badge: 'SRE Classic', description: 'Google SRE practitioners explain how software engineering can operate large production systems, covering risk, SLOs, automation, monitoring, incident response, capacity, and organizational collaboration.', published: '2016', pages: 'Classic collection', level: 'Intermediate–advanced', publisher: 'O’Reilly / Google', isbn: 'SRE Book', learn: [['Engineer operations', 'Turn repetitive work into scalable software and systems.'], ['Balance risk and reliability', 'Protect user experience with SLOs and error budgets.'], ['Build a learning culture', 'Improve systems through on-call and postmortems.']], parts: [['I', 'Introduction', 'Google production environments and the definition of SRE.'], ['II', 'Principles', 'Risk, SLOs, toil reduction, monitoring, and automation.'], ['III', 'Practices', 'Alerting, on-call, incident response, capacity, and design.'], ['IV', 'Management', 'Team growth, collaboration, and engagement models.']], audience: [['SRE and operations', 'Engineers seeking a foundation in reliability engineering.'], ['Software engineers', 'Developers learning production constraints.'], ['Platform engineers', 'Teams building automation and internal platforms.']] }
    },
    {
      id: 'sre-workbook', sku: 'sku-1001', price: 85, amountCent: 8500, rating: 4.8, rank: 5,
      tags: ['reliability', 'team'],
      cover: ['#28292c', '#fff7ec', '#d730ff', 'linear-gradient(120deg, transparent 0 48%, rgba(215,48,255,.42) 49% 52%, transparent 53%), radial-gradient(circle at 73% 72%, rgba(255,122,0,.65) 0 9%, transparent 10%)'],
      zh: { title: 'SRE 实战手册', englishTitle: 'The Site Reliability Workbook', shortTitle: 'SRE\n实战手册', author: 'Betsy Beyer 等', authorShort: 'Betsy Beyer 等', badge: '案例进阶', description: '《网站可靠性工程》的实践伙伴，以 Google 与多家团队的真实案例说明如何落地 SLO、告警、值班、故障响应、消除琐务和组织变革。', published: '2018 年', pages: '案例合集', level: '中高级', publisher: 'O’Reilly / Google', isbn: 'SRE Workbook', learn: [['把原则变成操作', '通过案例与模板将 SRE 原则转化为团队流程。'], ['改进值班与告警', '围绕用户影响设计更可行动的响应机制。'], ['推动组织改变', '从单个团队逐步扩展可靠性实践。']], parts: [['I', '基础', 'SRE 与 DevOps、SLO 和错误预算。'], ['II', '实践', '值班、事故响应、复盘与容量。'], ['III', '流程', '发布、配置、管道与恢复。'], ['IV', '组织', 'SRE 参与模式与变革管理。']], audience: [['SRE 团队', '希望获取具体落地案例的团队。'], ['工程经理', '负责流程、值班和组织改进的管理者。'], ['平台工程师', '建设可靠性工具与标准化流程的工程师。']] },
      en: { title: 'The Site Reliability Workbook', englishTitle: 'Practical Ways to Implement SRE', shortTitle: 'The SRE\nWorkbook', author: 'Betsy Beyer et al.', authorShort: 'Betsy Beyer et al.', badge: 'Case-Study Playbook', description: 'The hands-on companion to the SRE book, using cases from Google and other organizations to implement SLOs, alerting, on-call, incident response, toil reduction, and organizational change.', published: '2018', pages: 'Case-study collection', level: 'Intermediate–advanced', publisher: 'O’Reilly / Google', isbn: 'SRE Workbook', learn: [['Turn principles into actions', 'Use cases and templates to create team workflows.'], ['Improve on-call and alerts', 'Design actionable response around user impact.'], ['Lead organizational change', 'Grow reliability practices across teams.']], parts: [['I', 'Foundations', 'SRE and DevOps, SLOs, and error budgets.'], ['II', 'Practices', 'On-call, incidents, postmortems, and capacity.'], ['III', 'Processes', 'Releases, configuration, pipelines, and recovery.'], ['IV', 'Organizations', 'SRE engagement and change management.']], audience: [['SRE teams', 'Teams seeking implementation cases.'], ['Engineering managers', 'Leaders improving process and on-call.'], ['Platform engineers', 'Builders of reliability tooling.']] }
    },
    {
      id: 'secure-reliable-systems', sku: 'sku-1001', price: 88, amountCent: 8800, rating: 4.7, rank: 6,
      tags: ['reliability', 'systems', 'team'],
      cover: ['#752f3f', '#fff7ec', '#ffb05b', 'radial-gradient(circle at 72% 70%, rgba(255,176,91,.35) 0 20%, transparent 21%), repeating-linear-gradient(35deg, transparent 0 12px, rgba(255,255,255,.08) 13px 14px)'],
      zh: { title: '构建安全可靠的系统', englishTitle: 'Building Secure & Reliable Systems', shortTitle: '安全与\n可靠系统', author: 'Heather Adkins、Betsy Beyer 等', authorShort: 'Google 团队', badge: '系统设计', description: '将安全与可靠性作为同一套系统质量来设计，讨论从架构、变更、恢复到组织协作的工程实践，帮助团队构建可扩展的生产系统。', published: '2020 年', pages: '工程参考', level: '中高级', publisher: 'O’Reilly / Google', isbn: 'Secure & Reliable', learn: [['统一安全与可靠性', '从共同风险和运营目标理解两类工程。'], ['设计可恢复系统', '在架构和流程中预先考虑故障、攻击与恢复。'], ['建立协作机制', '让安全、SRE 与研发共享上下文和责任。']], parts: [['I', '设计原则', '安全与可靠性的共同基础。'], ['II', '系统设计', '架构、隔离、最小权限与弹性。'], ['III', '运营实践', '变更、检测、响应和恢复。'], ['IV', '组织协作', '跨团队文化、流程和治理。']], audience: [['系统架构师', '兼顾安全、可靠性与扩展性的设计者。'], ['SRE 团队', '负责生产系统韧性、响应和恢复的工程师。'], ['安全工程师', '希望与可靠性和研发流程协作的团队。']] },
      en: { title: 'Building Secure & Reliable Systems', englishTitle: 'Best Practices for Designing and Maintaining Systems', shortTitle: 'Secure & Reliable\nSystems', author: 'Heather Adkins, Betsy Beyer et al.', authorShort: 'Google engineering team', badge: 'Resilient Design', description: 'Treat security and reliability as one system quality. The book connects architecture, change, recovery, and organizational collaboration to help teams build scalable and resilient production systems.', published: '2020', pages: 'Engineering reference', level: 'Intermediate–advanced', publisher: 'O’Reilly / Google', isbn: 'Secure & Reliable', learn: [['Unify security and reliability', 'Understand shared risks and operational objectives.'], ['Design for recovery', 'Anticipate failure, attack, and recovery.'], ['Create shared ownership', 'Give security, SRE, and development a common context.']], parts: [['I', 'Design principles', 'The shared foundations of security and reliability.'], ['II', 'System design', 'Architecture, isolation, least privilege, and resilience.'], ['III', 'Operations', 'Change, detection, response, and recovery.'], ['IV', 'Collaboration', 'Cross-team culture, process, and governance.']], audience: [['System architects', 'Designers balancing security and reliability.'], ['SRE teams', 'Engineers responsible for resilience and recovery.'], ['Security engineers', 'Teams integrating with reliability and delivery.']] }
    }
  ]);

  const topics = Object.freeze([
    { id: 'all', zh: '全部书单', en: 'All books', zhSubtitle: '精选技术读物', enSubtitle: 'Curated engineering reads' },
    { id: 'foundation', zh: '观测基础', en: 'Foundations', zhSubtitle: '指标 · 日志 · 事件', enSubtitle: 'Metrics · logs · events' },
    { id: 'tracing', zh: '追踪与调试', en: 'Tracing', zhSubtitle: 'Trace · 高基数', enSubtitle: 'Traces · high cardinality' },
    { id: 'reliability', zh: 'SLO 与可靠性', en: 'Reliability', zhSubtitle: 'SLI · 错误预算', enSubtitle: 'SLIs · error budgets' },
    { id: 'team', zh: '团队实践', en: 'Team practice', zhSubtitle: 'SRE · 协作文化', enSubtitle: 'SRE · collaboration' },
    { id: 'systems', zh: '系统设计', en: 'System design', zhSubtitle: '分布式 · 云原生', enSubtitle: 'Distributed · cloud native' },
  ]);

  const readingStages = Object.freeze([
    { books: ['distributed-observability', 'observability-engineering'], zh: ['共同语言', '理解观测、监控与调试的差异，建立对遥测信号和未知问题的整体认知。'], en: ['Shared vocabulary', 'Understand observability, monitoring, telemetry signals, and unknown problems.'] },
    { books: ['implementing-slo', 'site-reliability-engineering'], zh: ['可靠性实践', '围绕用户体验定义 SLO，用工程化方式改善告警、值班、容量与故障响应。'], en: ['Reliability practice', 'Define SLOs around user experience and improve alerting, on-call, and response.'] },
    { books: ['sre-workbook', 'secure-reliable-systems'], zh: ['规模化落地', '借助案例、流程和系统设计，把安全与可靠性扩展到跨团队协作。'], en: ['Scale the practice', 'Use cases and system design to scale security and reliability across teams.'] },
  ]);

  const storeMessages = Object.freeze({
    zh: {
      brandTitle: '可观测性书店', brandSubtitle: '技术阅读空间', navHome: '首页', navPath: '阅读路径', navCart: '购物车', account: '登录',
      authTitle: '选择演示人物', authDescription: '一键登录固定合成账号，体验跨浏览器账号身份合并。', authAccountTitle: '商城账户', authAccountDescription: '当前账号身份会关联 RUM、浏览器日志与订单链路。', authSyntheticNote: '演示人物和邮箱均为合成数据，不对应真实用户。', authLogout: '退出登录', authClose: '关闭', authFailedTitle: '登录操作失败', authSessionExpired: '登录会话已失效，请重新选择演示人物。', authLogPrompt: '打开演示人物登录选择', authLogSuccess: '登录成功：{name}', authLogFailure: '登录失败：{message}', authLogLogout: '退出登录：{name}', tierStandard: '标准版', tierPro: '专业版', tierVip: 'VIP',
      searchPlaceholder: '搜索书名 / 作者 / 技术主题', searchLabel: '搜索书名、作者或技术主题', switchLanguage: '切换到 English',
      heroEyebrow: '本周编辑推荐', heroTitle: '理解系统，始于提出更好的问题', heroTitleLines: '理解系统，始于|提出更好的问题', heroDescription: '《可观测性工程》从真实用户体验一路读到后端系统行为，帮助研发、SRE 与平台团队建立调试现代系统的共同语言。', viewBook: '查看本书', addCart: '加入购物车', inCart: '已在购物车',
      edition: '中文版', format: '纸质书', metricsSignal: '指标与事件', tracesSignal: '分布式追踪', rumSignal: '真实用户体验',
      shelfTitle: '可观测性书单', resultCount: '共 {count} 本', noResults: '没有找到匹配的书籍', noResultsHint: '试试其他书名、作者或技术主题。', sortLabel: '排序方式', sortRecommended: '编辑推荐', sortRating: '评分最高', sortPrice: '价格从低到高',
      rating: '{rating} 分', paper: '纸质书', pathEyebrow: 'GUIDED READING', pathTitle: '三阶段可观测性阅读路径', pathDescription: '先建立共同语言，再掌握 SLO 与生产实践，最后走向安全、可靠且可扩展的系统设计。', stage: '阶段 {index}',
      detail: '图书详情', overview: '内容简介', learn: '这本书将帮助你完成什么', contents: '目录概览', audience: '适读人群', published: '出版时间', pages: '篇幅', level: '阅读难度', publisher: '出版信息', isbn: 'ISBN / 标识', buyNow: '立即购买', related: '同主题推荐', authorPrefix: '作者 / 编者', commerceProduct: '商城商品', purchaseQuantity: '购买数量', editorPick: '编辑推荐', suggestedPath: '建议阅读路径',
      cartEyebrow: 'SHOPPING CART', cartTitle: '我的购物车', cartDescription: '核对书目、版本与数量，选择本次需要购买的图书后统一结算。', selectAll: '全选', selected: '已选 {count} 件商品', removeSelected: '删除选中', remove: '删除', decrease: '减少数量', increase: '增加数量',
      cartEmpty: '购物车还是空的', cartEmptyHint: '从首页或详情页加入一本想读的书吧。', continueShopping: '继续选书', summary: '结算明细', selectedBooks: '已选图书', copies: '共 {count} 册', subtotal: '商品金额', shipping: '配送费', free: '免费', total: '应付合计', checkout: '去结算（{count}）', cartProduct: '商品信息', unitPrice: '单价', quantityHeader: '数量', itemSubtotal: '小计', actions: '操作', inStockShort: '现货', promotionTitle: '购书优惠', promotionDescription: '满 99 元免配送费，专业技术书籍享正版保障。', summaryNote: '最终价格与配送方式将在提交订单前再次确认。',
      demoActions: '观测调试操作', demoHint: '连续生成 5 条订单链路，保留当前选中书目与金额。', batchOrder: '连续下单 5 次',
      authentic: '正版图书保障', returns: '7 天无理由退换', fastShipping: '24 小时内安排发货', inStock: '现货，下单后 24 小时内发出', authenticity: '正版保障，支持 7 天退换', added: '《{title}》已加入购物车', removed: '已从购物车移除《{title}》', removedSelected: '已删除 {count} 件选中商品',
    },
    en: {
      brandTitle: 'Observability Books', brandSubtitle: 'Engineering Reading Room', navHome: 'Home', navPath: 'Reading Path', navCart: 'Cart', account: 'Sign in',
      authTitle: 'Choose a demo persona', authDescription: 'Sign in with a fixed synthetic account to demonstrate account identity across browsers.', authAccountTitle: 'Store account', authAccountDescription: 'This account identity is correlated across RUM, browser logs, and order traces.', authSyntheticNote: 'All personas and email addresses are synthetic and do not represent real users.', authLogout: 'Sign out', authClose: 'Close', authFailedTitle: 'Sign-in failed', authSessionExpired: 'Your demo session expired. Choose a persona to continue.', authLogPrompt: 'Opened the demo persona sign-in prompt', authLogSuccess: 'Signed in as {name}', authLogFailure: 'Sign-in failed: {message}', authLogLogout: 'Signed out {name}', tierStandard: 'Standard', tierPro: 'Pro', tierVip: 'VIP',
      searchPlaceholder: 'Search books or topics', searchLabel: 'Search by title, author, or engineering topic', switchLanguage: '切换到中文',
      heroEyebrow: "EDITOR'S PICK", heroTitle: 'Better questions reveal better systems', heroTitleLines: 'Better questions reveal|better systems', heroDescription: 'Observability Engineering connects real user experience to backend system behavior and gives developers, SREs, and platform teams a shared language for debugging modern systems.', viewBook: 'View this book', addCart: 'Add to cart', inCart: 'In your cart',
      edition: 'English edition', format: 'Paperback', metricsSignal: 'Metrics and events', tracesSignal: 'Distributed tracing', rumSignal: 'Real user experience',
      shelfTitle: 'Observability reading list', resultCount: '{count} books', noResults: 'No matching books', noResultsHint: 'Try another title, author, or engineering topic.', sortLabel: 'Sort books', sortRecommended: "Editor's picks", sortRating: 'Highest rated', sortPrice: 'Price: low to high',
      rating: '{rating} / 5', paper: 'Print book', pathEyebrow: 'GUIDED READING', pathTitle: 'A three-stage observability reading path', pathDescription: 'Build a shared vocabulary, learn SLO and production practices, then design secure, reliable, and scalable systems.', stage: 'Stage {index}',
      detail: 'Book details', overview: 'Overview', learn: 'What this book helps you do', contents: 'Contents', audience: 'Who it is for', published: 'Published', pages: 'Length', level: 'Reading level', publisher: 'Publisher', isbn: 'ISBN / ID', buyNow: 'Buy now', related: 'Related books', authorPrefix: 'Author / editor', commerceProduct: 'Store item', purchaseQuantity: 'Quantity', editorPick: "Editor's pick", suggestedPath: 'Suggested reading path',
      cartEyebrow: 'SHOPPING CART', cartTitle: 'Your shopping cart', cartDescription: 'Review editions and quantities, then select the books you want to purchase in this order.', selectAll: 'Select all', selected: '{count} selected', removeSelected: 'Remove selected', remove: 'Remove', decrease: 'Decrease quantity', increase: 'Increase quantity',
      cartEmpty: 'Your cart is empty', cartEmptyHint: 'Add a book from the home or detail page to begin.', continueShopping: 'Continue shopping', summary: 'Checkout summary', selectedBooks: 'Selected books', copies: '{count} copies', subtotal: 'Merchandise', shipping: 'Shipping', free: 'Free', total: 'Order total', checkout: 'Checkout ({count})', cartProduct: 'Book details', unitPrice: 'Unit price', quantityHeader: 'Quantity', itemSubtotal: 'Subtotal', actions: 'Actions', inStockShort: 'In stock', promotionTitle: 'Bookstore offer', promotionDescription: 'Free shipping over ¥99 with authentic-edition protection.', summaryNote: 'Final pricing and delivery options are confirmed before the order is submitted.',
      demoActions: 'Observability debug actions', demoHint: 'Generate five sequential order traces with the current selected books and amount.', batchOrder: 'Place 5 orders',
      authentic: 'Authentic editions', returns: '7-day returns', fastShipping: 'Ships within 24 hours', inStock: 'In stock · ships within 24 hours', authenticity: 'Authentic edition · 7-day returns', added: '“{title}” was added to your cart', removed: '“{title}” was removed from your cart', removedSelected: 'Removed {count} selected items',
    },
  });

  const messages = {
    zh: {
      commonLanguage: '语言',
      commonChinese: '中文',
      commonEnglish: 'English',
      commonLoading: '加载中',
      commonNormal: '正常',
      commonUnknown: 'UNKNOWN',
      commonNone: 'none',
      usageGuideOpen: '使用说明',
      usageGuideTitle: '故障演练使用说明',
      usageGuideClose: '关闭使用说明',
      usageGuidePrevious: '上一张',
      usageGuideNext: '下一张',
      usageGuideProgress: '第 {current} / {total} 页',
      usageGuideSlideAlt: '故障演练操作指引第 {index} 页',
      usageGuideDotLabel: '查看第 {index} 页',
      appTitle: '商城 Demo',
      appSubtitle: '图书商城',
      frameTitle: '商城 Demo',
      workbenchTitle: '故障演练工作台 Demo',
      workbenchBadge: '业务场景演练',
      businessScenes: '业务场景',
      businessSceneCount: '1 个场景',
      sceneBookstoreTitle: '商城 Demo',
      sceneBookstoreDescription: '图书商城',
      sceneRunning: '运行中',
      simulatorTitle: '业务场景模拟器',
      previewWeb: 'Web 预览',
      previewMobile: '移动端',
      previewWebOnly: '仅支持 Web',
      browserAddress: 'https://demo.dataflux.cn',
      faultConsoleTitle: '故障注入控制台',
      collapseScenes: '收起业务场景',
      expandScenes: '展开业务场景',
      collapseFaults: '收起故障控制台',
      expandFaults: '展开故障控制台',
      parentTitle: '商城 Demo 与故障注入 Demo',
      parentLead: '左侧商城运行在独立 iframe 中，RUM 只在商城页面初始化；右侧故障注入与日志面板不采集前端 RUM。',
      parentIframeLabel: '图书商城',
      parentOpenShop: '打开独立商城',
      parentRumStatus: '商城 RUM',
      parentRumPending: '等待商城上报',
      parentRumReady: 'RUM 已接入',
      parentRumMissing: 'RUM 未加载',
      parentRumFailed: 'RUM 初始化失败',
      parentFaultPanel: '多层级故障配置',
      parentFaultPanelNote: '右侧注入，左侧购买触发',
      parentLayerLabel: '故障层级',
      parentScenarioLabel: '具体故障',
      parentFaultLoadingTitle: '故障目录加载中',
      parentFaultLoadingDesc: '正在读取可注入的故障场景。',
      parentObservationLoading: '观察信息加载中。',
      parentActiveFault: '当前注入异常',
      parentNoFault: '未注入异常',
      parentNoFaultDetail: '右侧选择故障并点击注入；一次只保留一个异常。',
      parentFaultActiveDetail: '{layer} / {kind}，已注入，等待左侧购买操作触发。',
      parentInjectFault: '注入选中故障',
      parentRecoverFault: '关闭全部故障',
      parentRefreshStatus: '刷新状态',
      faultHistoryTitle: '最近故障注入记录',
      faultHistoryCount: '{count} 条记录',
      faultHistoryEmpty: '注入故障后，操作记录会显示在这里。',
      faultHistoryInject: '注入：{title}',
      faultHistoryPending: '注入中',
      faultHistoryActive: '生效中',
      faultHistoryClosed: '已结束',
      faultHistoryFailed: '失败',
      faultHistoryDuration: '耗时 {duration}',
      faultHistoryTriggers: '触发 {count} 次',
      parentTraceLinkPanel: '观测详情',
      parentRumViewLinkPending: '前端异常触发后，可打开对应的 RUM View。',
      parentRumViewLinkReady: '已关联 view_id={viewId}，可查看本次前端异常所在页面。',
      parentRumViewLinkFallback: '暂未取得 view_id，已按应用与最近 1 小时缩小 View 范围。',
      parentRumViewLinkOpen: '打开 RUM View',
      parentTraceLinkPending: '购买成功并匹配到 trace_id 后，可查看对应链路详情。',
      parentTraceLinkReady: '已匹配 trace_id={traceId}，可查看完整链路。',
      parentTraceLinkReadyBatch: '已匹配 {count} 个 trace_id，可查看批量链路。',
      parentTraceLinkFrontendFault: '前端异常在订单请求发出前触发，本次未生成后端 trace_id。',
      parentTraceLinkSlowPending: '慢资源请求已发出，正在匹配对应的后端 trace_id。',
      parentTraceLinkOpen: '打开链路详情',
      parentTraceTags: '链路参数',
      parentTraceTagsNote: '链路检索参数',
      parentLogPanel: '后端链路',
      parentLogPanelNote: '商城事件 / 后端链路',
      parentStatusPanel: '环境状态',
      parentStatusPanelNote: '订单、库存、支付与故障状态',
      parentOrderHealth: 'Order',
      parentInventoryHealth: 'Inventory',
      parentPaymentHealth: 'Payment',
      parentLastRefresh: '未刷新',
      parentLastRefreshAt: '刷新 {time}',
      parentFaultStatus: '故障状态 {mode}',
      parentCatalogFailed: '故障目录加载失败：{message}',
      parentStatusFailed: '状态刷新失败：{message}',
      parentClientFaultInjected: '前端故障已注入：{title}，等待左侧购书操作触发',
      parentClientFaultHintSourceMap: '触发方式：左侧购物车点击“去结算”；预期结果：RUM Error 原始堆栈指向 checkout-sourcemap-fault.min.js，上传 SourceMap 后还原到源码 applyCheckoutDiscount。',
      parentClientFaultHintSlow: '触发方式：左侧购物车点击“去结算”；预期结果：发起 /api/demo/slow-resource 慢请求，RUM Resource 记录耗时。',
      parentClientFaultHintClick: '触发方式：左侧购物车点击“去结算”；预期结果：购买接口不会被调用，商城 UI 记录前端 TypeError。',
      parentBackendFaultInjected: '故障注入 {title} HTTP {status}：{body}',
      parentFaultInjectFailed: '故障注入失败：{title} {message}',
      parentFaultClosed: '故障已关闭',
      parentFaultClosedDetail: '前端和后端故障状态已恢复，可继续购书验证。',
      parentFaultCloseFailed: '关闭全部故障失败：{message}',
      parentShopReady: '图书商城已就绪',
      parentShopOrderResult: '商城购买 HTTP {status}：{body}',
      parentFrontendFaultTriggered: '左侧购书操作触发前端故障：{action}',
      parentShopMessageBlocked: '收到非同源商城消息，已忽略。',
      shopAppLabel: '图书商城',
      shopNavLabel: '书城导航',
      shopHomePageLabel: '商城首页',
      shopHeroLabel: '本周编辑推荐',
      shopTopicListLabel: '可观测性主题分类',
      shopPathPageLabel: '阅读路径',
      shopCartPageLabel: '购物车',
      shopSelectAllProductsLabel: '全选商品',
      shopCheckoutSummaryLabel: '结算明细',
      shopMobileNavLabel: '移动端书城导航',
      shopNavHome: '首页',
      shopNavBook: '本书',
      shopNavBag: '购物车',
      shopBagCountLabel: '购物车内有 {count} 本书',
      shopHomeEyebrow: '本周编辑推荐',
      shopHomeTitle: '理解系统，始于提出更好的问题',
      shopHomeDescription: '一本写给研发、SRE 与平台团队的可观测性实践指南，从真实用户体验一路读到后端系统行为。',
      shopHomeViewBook: '查看本书',
      shopAddToBag: '加入购物车',
      shopAddedToBag: '已在购物车',
      shopEditorialTitle: '为什么值得读',
      shopEditorialDescription: '从概念到日常实践，建立一套能够解释复杂系统的共同语言。',
      shopFeaturePracticeTitle: '面向真实实践',
      shopFeaturePracticeDescription: '连接指标、日志、链路、事件与团队协作，而不止停留在工具清单。',
      shopFeatureDebugTitle: '改进调试方式',
      shopFeatureDebugDescription: '从未知问题出发，学习如何提出问题、缩小范围并验证判断。',
      shopFeatureTeamTitle: '适合技术团队',
      shopFeatureTeamDescription: '为研发、SRE 和平台团队提供可以共同讨论的系统视角。',
      shopDetailPageTitle: '图书详情',
      shopDetailOverview: '内容简介',
      shopDetailHighlights: '本书亮点',
      shopDetailBuy: '立即购买',
      shopBagTitle: '购物车',
      shopBagDescription: '确认选中的图书与金额，然后完成购买。',
      shopBagEmptyTitle: '购物车还是空的',
      shopBagEmptyDescription: '先去看看本周推荐，把想读的书放进购物车。',
      shopBagBrowse: '去看本书',
      shopBagRemove: '移除',
      shopBagQuantity: '数量 1',
      shopOrderSummary: '订单汇总',
      shopSubtotal: '商品小计',
      shopDemoActionsTitle: '演示操作',
      shopDemoActionsDescription: '用于一次生成多条观测链路，不影响正常购买流程。',
      shopCartAddedTitle: '已加入购物车',
      shopCartAddedDetail: '《{product}》已放入购物车。',
      shopCartRemovedTitle: '已移出购物车',
      shopCartRemovedDetail: '可以随时重新加入这本书。',
      shopHeroTitle: '商城 Demo',
      shopHeroText: '选择《可观测性工程》并完成购买，会生成关键业务请求，并把 RUM Action、Resource、Error 与后端 APM/日志串起来。',
      shopProductSection: '精选图书',
      shopProductChip: '书店',
      shopCheckoutTitle: '购买确认',
      shopSelectedLabel: '已选图书',
      shopAmountLabel: '应付金额',
      shopSubscribe: '去结算',
      shopBatchSubscribe: '连续购买 5 次',
      shopStatusReady: '等待选择图书',
      shopStatusReadyDetail: '购买后会生成业务请求 ID，并关联后端中文日志。',
      shopStatusSelected: '已选择《{product}》。',
      shopStatusSubmitting: '购书订单提交中',
      shopStatusSubmittingDetail: '正在等待库存预留和支付确认。',
      shopStatusBatchSubmitting: '连续购买中 {current}/{total}',
      shopStatusBatchSubmittingDetail: '正在连续生成关键业务请求并收集 trace_id。',
      shopStatusBatchSuccess: '连续购买完成 {count}/{total}',
      shopStatusBatchSuccessDetail: '已收集 {traceCount} 个 trace_id，右侧链路将按批量条件查询。',
      shopStatusSuccess: '购买成功',
      shopStatusSuccessDetail: '订单号 {orderId}，业务请求 {bizRequestId}。',
      shopTraceLinkPending: '购买成功后打开链路详情',
      shopTraceLinkReady: '打开链路详情 {traceId}',
      shopStatusFailed: '购买失败',
      shopStatusFrontendFault: '前端故障已注入',
      shopStatusFrontendFaultSourceMap: '请在购物车点击“去结算”触发压缩 JS 空指针，观察 SourceMap 还原。',
      shopStatusFrontendFaultSlow: '请在购物车点击“去结算”触发慢资源请求。',
      shopStatusFrontendFaultClick: '请在购物车点击“去结算”触发无响应场景。',
      shopStatusFrontendFaultFailed: '购买未完成',
      shopStatusFrontendFaultNoTrace: '前端异常在订单请求发出前触发，未生成后端链路。',
      shopStatusBackendFault: '故障已注入，请在购物车点击“去结算”触发并观察 RUM、APM、日志与指标。',
      shopStatusSlowLoading: '前端资源加载中',
      shopStatusSlowLoadingDetail: '正在请求慢资源，RUM Resource 会记录耗时。',
      shopStatusSlowDone: '慢资源请求完成',
      shopStatusSlowDoneDetail: '资源耗时 {elapsedMs}ms，服务端延迟 {delayMs}ms。',
      shopStatusSlowFailed: '慢资源触发失败',
      shopLogTitle: '商城日志',
      shopLogRumInit: 'RUM 已初始化：service={service} env={env} version={version}',
      shopLogRumMissing: 'RUM SDK 未加载，业务接口仍可使用',
      shopLogRumFailed: 'RUM 初始化失败：{message}',
      shopLogSelected: '选择图书：{product}',
      shopLogSubmit: '提交购书订单 HTTP {status}：{body}',
      shopLogSubmitFailed: '提交购书订单失败：{message}',
      shopLogTrafficStart: '开始连续购买 5 次',
      shopLogTrafficDone: '连续购买完成：5 次',
      shopLogTrafficDoneWithTraces: '连续购买完成：成功 {count} 次，匹配 {traceCount} 个 trace_id。',
      shopLogBackendFound: '后端链路日志：biz_request_id={requestId}，匹配到 {count} 条。',
      shopLogBackendMissing: '后端链路日志暂未匹配到 {requestId}',
      shopLogBackendFailed: '后端日志读取失败：{message}',
      shopLogFrontendError: '前端未捕获异常已被浏览器识别：{message}',
      shopLogFrontendRejected: '前端 Promise 未处理异常已被浏览器识别：{message}',
      shopLogFrontendFault: '左侧购书操作触发前端故障：{action}，购买接口不会被调用',
      shopLogSlowResource: '左侧购书操作触发前端慢资源：{action}，耗时 {elapsedMs}ms',
      shopLogSlowResourceFailed: '前端慢资源触发失败：{message}',
      shopOrderModeKey: '关键购买',
      shopOrderModeNormal: '普通购买',
      layerFrontend: '前端',
      layerBackend: '后端',
      layerInfrastructure: '基础设施',
      layerService: '后端',
      layerDependency: '基础设施',
      layerJvm: '基础设施',
      faultService: '后端',
      faultDependency: '基础设施',
      faultFrontend: '前端',
    },
    en: {
      commonLanguage: 'Language',
      commonChinese: '中文',
      commonEnglish: 'English',
      commonLoading: 'Loading',
      commonNormal: 'Normal',
      commonUnknown: 'UNKNOWN',
      commonNone: 'none',
      usageGuideOpen: 'Usage Guide',
      usageGuideTitle: 'Fault Exercise Usage Guide',
      usageGuideClose: 'Close usage guide',
      usageGuidePrevious: 'Previous slide',
      usageGuideNext: 'Next slide',
      usageGuideProgress: 'Page {current} of {total}',
      usageGuideSlideAlt: 'Fault exercise guide page {index}',
      usageGuideDotLabel: 'View page {index}',
      appTitle: 'Store Demo',
      appSubtitle: 'Bookstore',
      frameTitle: 'Store Demo',
      workbenchTitle: 'Fault Exercise Workbench Demo',
      workbenchBadge: 'Business scenario lab',
      businessScenes: 'Business Scenarios',
      businessSceneCount: '1 scenario',
      sceneBookstoreTitle: 'Store Demo',
      sceneBookstoreDescription: 'Bookstore',
      sceneRunning: 'Running',
      simulatorTitle: 'Business Scenario Simulator',
      previewWeb: 'Web Preview',
      previewMobile: 'Mobile',
      previewWebOnly: 'Web only',
      browserAddress: 'https://demo.dataflux.cn',
      faultConsoleTitle: 'Fault Injection Console',
      collapseScenes: 'Collapse business scenarios',
      expandScenes: 'Expand business scenarios',
      collapseFaults: 'Collapse fault console',
      expandFaults: 'Expand fault console',
      parentTitle: 'Store Demo and Fault Injection',
      parentLead: 'The store runs in an isolated iframe. RUM initializes only inside the store page; the fault controls and log panel on the right do not collect frontend RUM.',
      parentIframeLabel: 'Book store',
      parentOpenShop: 'Open store',
      parentRumStatus: 'Store RUM',
      parentRumPending: 'Waiting for store',
      parentRumReady: 'RUM connected',
      parentRumMissing: 'RUM not loaded',
      parentRumFailed: 'RUM init failed',
      parentFaultPanel: 'Multi-layer Fault Control',
      parentFaultPanelNote: 'Inject on the right, trigger from the store',
      parentLayerLabel: 'Fault layer',
      parentScenarioLabel: 'Scenario',
      parentFaultLoadingTitle: 'Loading fault catalog',
      parentFaultLoadingDesc: 'Reading injectable fault scenarios.',
      parentObservationLoading: 'Observation guide loading.',
      parentActiveFault: 'Active injected fault',
      parentNoFault: 'No injected fault',
      parentNoFaultDetail: 'Choose a fault on the right and inject it. Only one fault stays active at a time.',
      parentFaultActiveDetail: '{layer} / {kind}, injected and waiting for a store purchase action.',
      parentInjectFault: 'Inject selected fault',
      parentRecoverFault: 'Clear all faults',
      parentRefreshStatus: 'Refresh status',
      faultHistoryTitle: 'Recent fault injection records',
      faultHistoryCount: '{count} records',
      faultHistoryEmpty: 'Fault operations will appear here after an injection.',
      faultHistoryInject: 'Inject: {title}',
      faultHistoryPending: 'Injecting',
      faultHistoryActive: 'Active',
      faultHistoryClosed: 'Ended',
      faultHistoryFailed: 'Failed',
      faultHistoryDuration: 'Duration {duration}',
      faultHistoryTriggers: 'Triggered {count} times',
      parentTraceLinkPanel: 'Observability Details',
      parentRumViewLinkPending: 'After a frontend fault is triggered, open its related RUM View.',
      parentRumViewLinkReady: 'Linked view_id={viewId}. Open the page containing this frontend fault.',
      parentRumViewLinkFallback: 'No view_id is available yet. Views are narrowed by application and the last hour.',
      parentRumViewLinkOpen: 'Open RUM View',
      parentTraceLinkPending: 'After a purchase matches a trace_id, open the corresponding trace details.',
      parentTraceLinkReady: 'Matched trace_id={traceId}. Open the full trace details.',
      parentTraceLinkReadyBatch: 'Matched {count} trace IDs. Open the batch trace details.',
      parentTraceLinkFrontendFault: 'The frontend error occurred before the order request, so no backend trace_id was created.',
      parentTraceLinkSlowPending: 'The slow resource request was sent. Matching its backend trace_id now.',
      parentTraceLinkOpen: 'Open trace details',
      parentTraceTags: 'Trace Parameters',
      parentTraceTagsNote: 'Trace search parameters',
      parentLogPanel: 'Backend Trace',
      parentLogPanelNote: 'Store events / backend trace',
      parentStatusPanel: 'Environment Status',
      parentStatusPanelNote: 'Order, inventory, payment, and fault status',
      parentOrderHealth: 'Order',
      parentInventoryHealth: 'Inventory',
      parentPaymentHealth: 'Payment',
      parentLastRefresh: 'Not refreshed',
      parentLastRefreshAt: 'Refreshed {time}',
      parentFaultStatus: 'Fault status {mode}',
      parentCatalogFailed: 'Failed to load fault catalog: {message}',
      parentStatusFailed: 'Failed to refresh status: {message}',
      parentClientFaultInjected: 'Frontend fault injected: {title}. Waiting for a book purchase action in the store.',
      parentClientFaultHintSourceMap: 'Trigger: click "Checkout" in the store cart. Expected: RUM Error points to checkout-sourcemap-fault.min.js, then SourceMap restores applyCheckoutDiscount.',
      parentClientFaultHintSlow: 'Trigger: click "Checkout" in the store cart. Expected: /api/demo/slow-resource appears as a slow RUM Resource.',
      parentClientFaultHintClick: 'Trigger: click "Checkout" in the store cart. Expected: no purchase API call and a frontend TypeError is recorded.',
      parentBackendFaultInjected: 'Injected {title} HTTP {status}: {body}',
      parentFaultInjectFailed: 'Fault injection failed: {title} {message}',
      parentFaultClosed: 'Faults cleared',
      parentFaultClosedDetail: 'Frontend and backend faults are recovered. You can purchase again.',
      parentFaultCloseFailed: 'Failed to clear all faults: {message}',
      parentShopReady: 'Book store is ready',
      parentShopOrderResult: 'Store purchase HTTP {status}: {body}',
      parentFrontendFaultTriggered: 'Store purchase action triggered frontend fault: {action}',
      parentShopMessageBlocked: 'Ignored a non-same-origin store message.',
      shopAppLabel: 'Bookstore',
      shopNavLabel: 'Bookstore navigation',
      shopHomePageLabel: 'Bookstore home',
      shopHeroLabel: "Editor's pick",
      shopTopicListLabel: 'Observability book categories',
      shopPathPageLabel: 'Reading path',
      shopCartPageLabel: 'Shopping cart',
      shopSelectAllProductsLabel: 'Select all books',
      shopCheckoutSummaryLabel: 'Checkout summary',
      shopMobileNavLabel: 'Mobile bookstore navigation',
      shopNavHome: 'Home',
      shopNavBook: 'This Book',
      shopNavBag: 'Cart',
      shopBagCountLabel: '{count} books in the cart',
      shopHomeEyebrow: 'Editors’ Pick',
      shopHomeTitle: 'Understand systems by asking better questions',
      shopHomeDescription: 'A practical observability guide for engineers, SREs, and platform teams, connecting real user experience to backend system behavior.',
      shopHomeViewBook: 'View this book',
      shopAddToBag: 'Add to cart',
      shopAddedToBag: 'In your cart',
      shopEditorialTitle: 'Why it is worth reading',
      shopEditorialDescription: 'Build a shared language for understanding complex systems, from core ideas to daily practice.',
      shopFeaturePracticeTitle: 'Grounded in practice',
      shopFeaturePracticeDescription: 'Connect metrics, logs, traces, events, and teamwork instead of stopping at a tool list.',
      shopFeatureDebugTitle: 'Debug differently',
      shopFeatureDebugDescription: 'Start from unknowns, ask useful questions, narrow the search, and validate conclusions.',
      shopFeatureTeamTitle: 'Built for teams',
      shopFeatureTeamDescription: 'Give engineers, SREs, and platform teams a common view of system behavior.',
      shopDetailPageTitle: 'Book Details',
      shopDetailOverview: 'Overview',
      shopDetailHighlights: 'Highlights',
      shopDetailBuy: 'Buy now',
      shopBagTitle: 'Cart',
      shopBagDescription: 'Review your selected book and total, then complete the purchase.',
      shopBagEmptyTitle: 'Your cart is empty',
      shopBagEmptyDescription: 'Explore this week’s pick and add the book you want to read.',
      shopBagBrowse: 'View this book',
      shopBagRemove: 'Remove',
      shopBagQuantity: 'Quantity 1',
      shopOrderSummary: 'Order summary',
      shopSubtotal: 'Subtotal',
      shopDemoActionsTitle: 'Demo actions',
      shopDemoActionsDescription: 'Generate several observability traces at once without changing the normal purchase flow.',
      shopCartAddedTitle: 'Added to your cart',
      shopCartAddedDetail: '"{product}" is now in your cart.',
      shopCartRemovedTitle: 'Removed from your cart',
      shopCartRemovedDetail: 'You can add this book again at any time.',
      shopHeroTitle: 'Store Demo',
      shopHeroText: 'Choose Observability Engineering and purchase it to create a key business request linking RUM Action, Resource, Error with backend APM and logs.',
      shopProductSection: 'Featured Book',
      shopProductChip: 'Bookstore',
      shopCheckoutTitle: 'Purchase Confirmation',
      shopSelectedLabel: 'Selected book',
      shopAmountLabel: 'Amount due',
      shopSubscribe: 'Checkout',
      shopBatchSubscribe: 'Buy 5 times',
      shopStatusReady: 'Waiting for book selection',
      shopStatusReadyDetail: 'Purchasing creates a business request ID and correlates backend logs.',
      shopStatusSelected: '"{product}" is selected.',
      shopStatusSubmitting: 'Submitting purchase',
      shopStatusSubmittingDetail: 'Waiting for inventory reservation and payment confirmation.',
      shopStatusBatchSubmitting: 'Buying {current}/{total}',
      shopStatusBatchSubmittingDetail: 'Creating key business requests and collecting trace IDs.',
      shopStatusBatchSuccess: 'Completed {count}/{total} purchases',
      shopStatusBatchSuccessDetail: 'Collected {traceCount} trace IDs; the link on the right uses a batch query.',
      shopStatusSuccess: 'Purchase confirmed',
      shopStatusSuccessDetail: 'Order {orderId}, business request {bizRequestId}.',
      shopTraceLinkPending: 'Open trace details after purchase',
      shopTraceLinkReady: 'Open trace details {traceId}',
      shopStatusFailed: 'Purchase failed',
      shopStatusFrontendFault: 'Frontend fault injected',
      shopStatusFrontendFaultSourceMap: 'Click "Checkout" in the cart to trigger a minified JS null pointer and verify SourceMap restoration.',
      shopStatusFrontendFaultSlow: 'Click "Checkout" in the cart to trigger a slow resource request.',
      shopStatusFrontendFaultClick: 'Click "Checkout" in the cart to trigger an unresponsive frontend scenario.',
      shopStatusFrontendFaultFailed: 'Purchase not completed',
      shopStatusFrontendFaultNoTrace: 'The frontend error occurred before the order request, so no backend trace was created.',
      shopStatusBackendFault: 'Fault injected. Click "Checkout" in the cart to observe RUM, APM, logs, and metrics.',
      shopStatusSlowLoading: 'Loading frontend resource',
      shopStatusSlowLoadingDetail: 'Requesting a slow resource. RUM Resource will record the latency.',
      shopStatusSlowDone: 'Slow resource completed',
      shopStatusSlowDoneDetail: 'Resource took {elapsedMs}ms; server delay {delayMs}ms.',
      shopStatusSlowFailed: 'Slow resource failed',
      shopLogTitle: 'Store log',
      shopLogRumInit: 'RUM initialized: service={service} env={env} version={version}',
      shopLogRumMissing: 'RUM SDK is not loaded; business APIs still work',
      shopLogRumFailed: 'RUM initialization failed: {message}',
      shopLogSelected: 'Selected book: {product}',
      shopLogSubmit: 'Purchase HTTP {status}: {body}',
      shopLogSubmitFailed: 'Purchase failed: {message}',
      shopLogTrafficStart: 'Starting 5 purchase requests',
      shopLogTrafficDone: 'Completed 5 purchase requests',
      shopLogTrafficDoneWithTraces: 'Completed purchase traffic: {count} succeeded, {traceCount} trace IDs matched.',
      shopLogBackendFound: 'Backend trace logs: biz_request_id={requestId}, matched {count} entries.',
      shopLogBackendMissing: 'No backend trace logs matched {requestId} yet',
      shopLogBackendFailed: 'Failed to read backend logs: {message}',
      shopLogFrontendError: 'Browser captured uncaught frontend error: {message}',
      shopLogFrontendRejected: 'Browser captured unhandled promise rejection: {message}',
      shopLogFrontendFault: 'Store action triggered frontend fault: {action}; purchase API will not be called',
      shopLogSlowResource: 'Store action triggered slow frontend resource: {action}, {elapsedMs}ms',
      shopLogSlowResourceFailed: 'Slow frontend resource failed: {message}',
      shopOrderModeKey: 'Key purchase',
      shopOrderModeNormal: 'Normal purchase',
      layerFrontend: 'Frontend',
      layerBackend: 'Backend',
      layerInfrastructure: 'Infrastructure',
      layerService: 'Backend',
      layerDependency: 'Infrastructure',
      layerJvm: 'Infrastructure',
      faultService: 'Backend',
      faultDependency: 'Infrastructure',
      faultFrontend: 'Frontend',
    },
  };

  const faultTexts = {
    frontend_click_error: {
      zh: {
        title: '前端点击空指针错误',
        description: '购书按钮点击后模拟未捕获 TypeError。',
        observation: '操作：右侧注入后，到左侧购物车点击“去结算”触发。观察：商城 UI 不进入购买流程；RUM SDK 自动识别 Error，按 fault_id=frontend_click_error 过滤。',
      },
      en: {
        title: 'Frontend click null pointer',
        description: 'Simulates an uncaught TypeError after clicking the purchase button.',
        observation: 'Action: inject on the right, then click "Checkout" in the store cart. Expected: no purchase flow starts, and RUM captures an Error filtered by fault_id=frontend_click_error.',
      },
    },
    frontend_slow_resource: {
      zh: {
        title: '前端慢资源',
        description: '浏览器发起慢资源请求，展示 RUM Resource 慢加载。',
        observation: '操作：右侧注入后，到左侧购物车点击“去结算”触发。观察：RUM Resource 会出现 /api/demo/slow-resource 慢请求，按 fault_id=frontend_slow_resource 过滤。',
      },
      en: {
        title: 'Frontend slow resource',
        description: 'The browser requests a slow resource to demonstrate RUM Resource latency.',
        observation: 'Action: inject on the right, then click "Checkout" in the store cart. Expected: /api/demo/slow-resource appears as a slow RUM Resource filtered by fault_id=frontend_slow_resource.',
      },
    },
    frontend_sourcemap_error: {
      zh: {
        title: 'SourceMap 源码定位错误',
        description: '压缩 JS 包触发空指针，演示 SourceMap 还原源码行。',
        observation: '操作：右侧注入后，到左侧购物车点击“去结算”触发。观察：RUM Error 原始堆栈指向 assets/checkout-sourcemap-fault.min.js，上传 SourceMap 后还原到 applyCheckoutDiscount。',
      },
      en: {
        title: 'SourceMap source location error',
        description: 'A minified JS bundle throws a null pointer to demonstrate SourceMap restoration.',
        observation: 'Action: inject on the right, then click "Checkout" in the store cart. Expected: RUM Error first points to assets/checkout-sourcemap-fault.min.js, then SourceMap restores applyCheckoutDiscount.',
      },
    },
    order_slow: {
      zh: {
        title: '订单入口慢响应',
        description: '订单服务入口延迟，展示入口服务慢 Span 和 RUM Resource 慢加载。',
        observation: '观察：提交购书订单后 /api/orders 耗时升高；APM 中 order-service 入口 Span 变慢；RUM Resource 也会变慢。',
      },
      en: {
        title: 'Slow order entry',
        description: 'Delays the order service entrypoint to demonstrate a slow entry span and slow RUM Resource.',
        observation: 'Expected: /api/orders latency increases after purchasing; order-service entry span slows down in APM; RUM Resource slows as well.',
      },
    },
    inventory_redis_timeout: {
      zh: {
        title: '库存 Redis 超时',
        description: '库存服务访问 Redis 阻塞超时，展示依赖层故障。',
        observation: '观察：提交购书订单返回 503；APM 中 inventory-service 到 Redis 的 Span 变慢或失败；日志出现模拟 Redis 超时。',
      },
      en: {
        title: 'Inventory Redis timeout',
        description: 'Blocks inventory access to Redis to demonstrate a dependency-layer fault.',
        observation: 'Expected: purchase returns 503; inventory-service Redis span slows or fails in APM; logs show the simulated Redis timeout.',
      },
    },
    payment_slow: {
      zh: {
        title: '支付慢方法',
        description: '支付服务慢方法，展示下游服务慢 Span 和 Profile。',
        observation: '观察：提交购书订单耗时升高；APM 中 payment-service /api/payments/pay Span 变慢；Profile 可看到 sleep 慢方法。',
      },
      en: {
        title: 'Slow payment method',
        description: 'A slow payment method demonstrates downstream latency and profiling.',
        observation: 'Expected: purchase latency increases; payment-service /api/payments/pay span slows in APM; Profile shows the slow method.',
      },
    },
    payment_error: {
      zh: {
        title: '支付 5xx 错误',
        description: '支付服务返回 5xx，展示下游错误 Span。',
        observation: '观察：提交购书订单返回支付失败；APM 中 payment-service 出现 5xx Error Span；日志出现模拟支付服务 5xx。',
      },
      en: {
        title: 'Payment 5xx error',
        description: 'Payment service returns 5xx to demonstrate a downstream error span.',
        observation: 'Expected: purchase reports payment failure; payment-service has a 5xx Error span in APM; logs show the simulated payment 5xx.',
      },
    },
    payment_cpu_burn: {
      zh: {
        title: '支付 CPU 繁忙',
        description: '支付服务短时 CPU 繁忙，展示 JVM/进程指标与慢 Span。',
        observation: '观察：提交购书订单期间 payment-service CPU 升高；JVM/进程指标可看到短时 CPU 繁忙；APM Span 带 fault_id=payment_cpu_burn。',
      },
      en: {
        title: 'Payment CPU burn',
        description: 'Payment service burns CPU briefly to demonstrate JVM/process metrics and slow spans.',
        observation: 'Expected: payment-service CPU rises during purchase; JVM/process metrics show a short CPU spike; APM span carries fault_id=payment_cpu_burn.',
      },
    },
  };

  function normalizeLanguage(language) {
    const normalized = String(language || '').toLowerCase();
    if (normalized.startsWith('zh')) return 'zh';
    if (normalized.startsWith('en')) return 'en';
    return DEFAULT_LANGUAGE;
  }

  function languageFromUrl() {
    try {
      return new URL(window.location.href).searchParams.get('lang');
    } catch (_) {
      return null;
    }
  }

  function detectLanguage() {
    const fromUrl = languageFromUrl();
    if (fromUrl && SUPPORTED_LANGUAGES.has(normalizeLanguage(fromUrl))) {
      return normalizeLanguage(fromUrl);
    }
    try {
      const fromStorage = window.localStorage.getItem(STORAGE_KEY);
      if (fromStorage && SUPPORTED_LANGUAGES.has(normalizeLanguage(fromStorage))) {
        return normalizeLanguage(fromStorage);
      }
    } catch (_) {
      // localStorage can be blocked in private or embedded contexts.
    }
    return DEFAULT_LANGUAGE;
  }

  function interpolate(template, params) {
    return String(template || '').replace(/\{([a-zA-Z0-9_]+)\}/g, (_, key) => {
      const value = params && Object.prototype.hasOwnProperty.call(params, key) ? params[key] : '';
      return value == null ? '' : String(value);
    });
  }

  function t(key, params, language) {
    const lang = normalizeLanguage(language || currentLanguage);
    const table = messages[lang] || messages[DEFAULT_LANGUAGE];
    return interpolate(table[key] || messages[DEFAULT_LANGUAGE][key] || key, params || {});
  }

  function getProductText(product, language) {
    const lang = normalizeLanguage(language || currentLanguage);
    const text = product?.[lang] || product?.[DEFAULT_LANGUAGE] || products[0][lang];
    const cover = product?.image ? (lang === 'en' && product.imageEn ? product.imageEn : product.image) : null;
    return {
      ...text,
      name: text.title,
      tagline: text.description,
      price: formatPrice(product?.amountCent || products[0].amountCent, lang),
      note: lang === 'en' ? 'Print book' : '纸质书',
      edition: lang === 'en' ? 'English edition' : '中文版',
      bullets: Array.isArray(text.learn) ? text.learn.map((item) => item[0]) : [],
      cover,
      coverAlt: cover ? (lang === 'en' ? `${text.title} book cover` : `《${text.title}》封面`) : '',
    };
  }

  function productBySku(sku) {
    return products.find((product) => product.sku === sku) || products[0];
  }

  function bookById(id) {
    return products.find((product) => product.id === id) || products[0];
  }

  function getBookText(book, language) {
    const lang = normalizeLanguage(language || currentLanguage);
    return book?.[lang] || book?.[DEFAULT_LANGUAGE] || products[0][lang];
  }

  function formatPrice(amountCent, language) {
    const lang = normalizeLanguage(language || currentLanguage);
    const amount = Math.max(0, Number(amountCent || 0)) / 100;
    return lang === 'en' ? `CNY ${amount.toFixed(2)}` : `￥${amount.toFixed(2)}`;
  }

  function storeT(key, params, language) {
    const lang = normalizeLanguage(language || currentLanguage);
    const table = storeMessages[lang] || storeMessages[DEFAULT_LANGUAGE];
    return interpolate(table[key] || storeMessages[DEFAULT_LANGUAGE][key] || key, params || {});
  }

  function faultText(scenario, field, language) {
    const id = typeof scenario === 'string' ? scenario : scenario?.id;
    const lang = normalizeLanguage(language || currentLanguage);
    const localized = faultTexts[id]?.[lang] || faultTexts[id]?.[DEFAULT_LANGUAGE];
    if (localized && localized[field]) return localized[field];
    if (field === 'title') return scenario?.title || id || '-';
    if (field === 'description') return scenario?.description || '-';
    if (field === 'observation') {
      const layer = scenario?.layer || '-';
      return lang === 'en'
        ? `Observe RUM, APM, logs, or metrics with fault_id=${id} and fault_layer=${layer}.`
        : `观察：按 fault_id=${id}、fault_layer=${layer} 过滤 RUM、APM、日志或指标。`;
    }
    return '-';
  }

  function layerLabel(layer, language) {
    const key = {
      frontend: 'layerFrontend',
      service: 'layerService',
      dependency: 'layerDependency',
      jvm: 'layerJvm',
      backend: 'layerBackend',
      infrastructure: 'layerInfrastructure',
    }[layer];
    return key ? t(key, {}, language) : (layer || '-');
  }

  function applyDomTranslations(root) {
    const scope = root || document;
    scope.querySelectorAll('[data-i18n]').forEach((node) => {
      node.textContent = t(node.dataset.i18n);
    });
    scope.querySelectorAll('[data-i18n-placeholder]').forEach((node) => {
      node.setAttribute('placeholder', t(node.dataset.i18nPlaceholder));
    });
    scope.querySelectorAll('[data-i18n-title]').forEach((node) => {
      node.setAttribute('title', t(node.dataset.i18nTitle));
    });
    scope.querySelectorAll('[data-i18n-aria-label]').forEach((node) => {
      node.setAttribute('aria-label', t(node.dataset.i18nAriaLabel));
    });
    scope.querySelectorAll('[data-i18n-value]').forEach((node) => {
      node.setAttribute('value', t(node.dataset.i18nValue));
    });
  }

  function persistLanguage(language) {
    try {
      window.localStorage.setItem(STORAGE_KEY, language);
    } catch (_) {
      // Ignore storage failures.
    }
  }

  function updateUrlLanguage(language) {
    try {
      const url = new URL(window.location.href);
      url.searchParams.set('lang', language);
      window.history.replaceState(window.history.state || {}, '', url);
    } catch (_) {
      // Some embedded contexts may not allow history changes.
    }
  }

  let currentLanguage = detectLanguage();

  function setLanguage(language, options) {
    currentLanguage = normalizeLanguage(language);
    document.documentElement.lang = currentLanguage === 'zh' ? 'zh-CN' : 'en';
    applyDomTranslations(document);
    if (!options || options.persist !== false) persistLanguage(currentLanguage);
    if (options && options.updateUrl) updateUrlLanguage(currentLanguage);
    return currentLanguage;
  }

  window.SelfhealI18n = {
    DEFAULT_LANGUAGE,
    STORAGE_KEY,
    products,
    legacyProducts,
    topics,
    readingStages,
    storeMessages,
    messages,
    normalizeLanguage,
    detectLanguage,
    getLanguage: () => currentLanguage,
    setLanguage,
    t,
    getProductText,
    productBySku,
    bookById,
    getBookText,
    formatPrice,
    storeT,
    faultText,
    layerLabel,
    applyDomTranslations,
  };
})();
