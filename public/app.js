const $ = (id) => document.getElementById(id);
const state = { questionnaire: null, questionControls: new Map(), applicability: new Map(), session: null, submitted: null, review: null, analysis: null, configured: false, busy: null, selection: '' };
let eventSequence = 0;

function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined && text !== null) node.textContent = String(text);
  if (className) node.className = className;
  return node;
}
function option(value, label) { const node = element('option', label); node.value = value; return node; }
function field(label, control, wide = false) {
  const wrapper = element('div', null, wide ? 'field wide' : 'field');
  const caption = element('label', label); caption.htmlFor = control.id;
  wrapper.append(caption, control); return wrapper;
}
function input(type, id, required = false) {
  const control = element('input'); control.type = type; control.id = id;
  control.dataset.needsValue = String(required); return control;
}
function select(id, options, placeholder = '请选择') {
  const control = element('select'); control.id = id;
  control.append(option('', placeholder), ...options.map((item) => option(item.id, item.label)));
  return control;
}
function announce(message) { $('status-message').textContent = message; $('status-message').hidden = !message; }
function showError(message) { $('error-message').textContent = message; $('error-message').hidden = false; $('error-message').focus(); }
function clearError() { $('error-message').hidden = true; $('error-message').textContent = ''; }
function errorText(error) { return error instanceof Error ? error.message : '请求未完成，请稍后明确重试。'; }

async function api(path, method = 'GET', body) {
  let response;
  try {
    response = await fetch(path, { method, headers: body ? { 'content-type': 'application/json' } : {},
      ...(body ? { body: JSON.stringify(body) } : {}), credentials: 'omit', cache: 'no-store', signal: AbortSignal.timeout(135000) });
  } catch { throw new Error('连接未完成或已超时。请检查本地服务；失败请求可能已产生模型用量，不会自动重试。'); }
  let data;
  try { data = await response.json(); } catch { throw new Error('服务返回了无法读取的响应，请检查本地服务。'); }
  if (!response.ok) {
    const message = data?.error?.message || '请求未完成。';
    const details = Array.isArray(data?.error?.details) ? data.error.details.map((item) => item?.message).filter(Boolean).slice(0, 8) : [];
    throw new Error([message, ...details].join('\n'));
  }
  return data;
}

async function refreshStatus() {
  $('refresh-status').disabled = true;
  try {
    const result = await api('/api/status');
    state.configured = result.deepseek?.configured === true;
    $('provider-status').textContent = state.configured ? `DeepSeek 已配置 · ${result.deepseek.model}` : 'DeepSeek 未配置 · 可先生成本地候选盘';
    $('provider-status').classList.toggle('warning', !state.configured);
  } catch {
    state.configured = false;
    $('provider-status').textContent = '无法读取服务状态'; $('provider-status').classList.add('warning');
  } finally {
    $('refresh-status').disabled = false;
    if (state.session && !state.review && !state.busy) $('review-call-status').textContent = state.configured ? '服务端模型已配置，点击按钮后才会发送资料并调用 AI。' : 'DeepSeek 尚未配置。你可以查看本地候选盘；服务端配置完成后点击页首“刷新”。';
    updateActions();
  }
}
function setBusy(kind) {
  state.busy = kind; $('intake-fields').disabled = Boolean(kind);
  $('clear-session').disabled = Boolean(kind); updateActions();
}
function updateActions() {
  $('submit-intake').disabled = Boolean(state.busy) || !state.questionnaire;
  $('submit-intake').firstChild.textContent = state.busy === 'session' ? '正在生成候选盘… ' : state.session ? '重新提交并生成候选盘 ' : '生成候选盘 ';
  $('review-button').disabled = Boolean(state.busy) || !state.session || !state.configured || Boolean(state.review);
  $('review-button').textContent = state.busy === 'review' ? '正在校盘，请稍候…' : state.review ? 'AI 校盘已完成' : '一次 AI 校盘';
  $('analysis-button').disabled = Boolean(state.busy) || !state.review || !state.selection || !state.configured || Boolean(state.analysis);
  $('analysis-button').textContent = state.busy === 'analysis' ? '正在分析，请稍候…' : state.analysis ? '深入分析已完成' : '生成深入分析';
  $('selected-candidate').disabled = Boolean(state.busy) || Boolean(state.analysis);
  $('download-json').disabled = Boolean(state.busy) || !state.review;
  $('download-markdown').disabled = Boolean(state.busy) || !state.review;
}

function clearResults() {
  state.session = null; state.submitted = null; state.review = null; state.analysis = null; state.selection = '';
  for (const id of ['candidate-section', 'analysis-section', 'report-section']) $(id).hidden = true;
  for (const id of ['candidate-list', 'candidate-warnings', 'review-result', 'analysis-result']) $(id).replaceChildren();
  $('review-call-status').textContent = ''; $('analysis-call-status').textContent = '';
  $('selected-candidate').replaceChildren(option('', '请选择工作盘')); updateActions();
}
async function deleteSession(id) {
  if (!id) return true;
  try { await api('/api/session', 'DELETE', { sessionId: id }); return true; }
  catch { return false; }
}
function invalidateSession() {
  if (!state.session) return;
  const id = state.session.id; clearResults();
  announce('资料已修改，旧候选盘和结果已失效。请完成修改后重新提交。');
  void deleteSession(id).then((deleted) => {
    if (!deleted) showError('旧会话删除未确认，页面已阻止继续使用它；服务将按会话有效期清理。');
  });
}

function updateBirthFields() {
  const lunar = $('calendar').value === 'lunar'; $('leap-field').hidden = !lunar;
  const today = new Date().toISOString().slice(0, 10); $('birth-year').max = today.slice(0, 4);
  const dateParts = [$('birth-year').value, $('birth-month').value, $('birth-day').value];
  const birthDate = `${dateParts[0]}-${dateParts[1].padStart(2, '0')}-${dateParts[2].padStart(2, '0')}`;
  $('birth-day').setCustomValidity(!lunar && dateParts.every(Boolean) && birthDate > today ? '出生日期不能晚于今天。' : '');
  $('leap-month').disabled = !lunar; if (!lunar) $('leap-month').checked = false;
  $('birth-date-label').textContent = lunar ? '农历出生日期（数字年月日）' : '公历出生日期';
  const exact = $('time-mode').value === 'exact', range = $('time-mode').value === 'range';
  $('exact-field').hidden = !exact; $('range-field').hidden = !range;
  for (const [id, active] of [['birth-time', exact], ['start-time', range], ['end-time', range]]) { $(id).disabled = !active; $(id).required = active; }
  $('end-time').setCustomValidity(range && $('start-time').value && $('end-time').value < $('start-time').value ? '结束时间不能早于开始时间；请使用同一天内的范围。' : '');
}
function birthData() {
  const pad = (value) => String(value).padStart(2, '0');
  const mode = $('time-mode').value;
  return { date: `${$('birth-year').value}-${pad($('birth-month').value)}-${pad($('birth-day').value)}`,
    calendar: $('calendar').value, leapMonth: $('calendar').value === 'lunar' && $('leap-month').checked,
    timeMode: mode, ...(mode === 'exact' ? { time: $('birth-time').value } : {}),
    ...(mode === 'range' ? { startTime: $('start-time').value, endTime: $('end-time').value } : {}),
    timezone: $('timezone').value.trim(), longitude: Number($('longitude').value), trueSolarTime: $('true-solar').checked, sex: $('sex').value };
}

function addEvent(control) {
  const q = control.question, fields = state.questionnaire.eventFields;
  const index = ++eventSequence, row = element('div', null, 'event-item');
  const toolbar = element('div', null, 'event-toolbar'), remove = element('button', '移除此条', 'text-button');
  remove.type = 'button'; remove.setAttribute('aria-label', `移除${q.label}的一条记录`);
  toolbar.append(element('span', '一条经历'), remove);
  const grid = element('div', null, 'event-fields');
  const year = input('number', `${q.id}-year-${index}`, true); year.min = state.questionnaire.limits.minimumDate.slice(0, 4); year.max = String(new Date().getFullYear()); year.step = '1'; year.dataset.eventField = 'year';
  const date = input('date', `${q.id}-date-${index}`); date.dataset.eventField = 'date'; date.max = new Date().toISOString().slice(0, 10);
  const description = element('textarea'); description.id = `${q.id}-description-${index}`; description.maxLength = fields.description.maxLength; description.dataset.needsValue = 'true'; description.dataset.eventField = 'description'; description.rows = 2;
  grid.append(field(fields.year.label, year), field(fields.date.label, date));
  if (q.eventTypeOptions) {
    const type = select(`${q.id}-type-${index}`, q.eventTypeOptions); type.dataset.needsValue = 'true'; type.dataset.eventField = 'eventType';
    grid.append(field(fields.eventType.label, type, true));
  }
  grid.append(field(fields.description.label, description, true)); row.append(toolbar, grid); control.eventList.append(row);
  remove.addEventListener('click', () => { row.remove(); invalidateSession(); refreshQuestions(); });
  refreshQuestions();
}

function renderQuestionnaire(bank) {
  state.questionnaire = bank; state.questionControls.clear(); state.applicability.clear();
  const root = $('questionnaire-content'); root.replaceChildren();
  const applicability = element('div', null, 'applicability-grid');
  for (const q of bank.applicabilityQuestions) {
    const control = select(`applicability-${q.id}`, q.options); control.required = true;
    applicability.append(field(q.label, control)); state.applicability.set(q.id, control);
  }
  root.append(applicability);
  let number = 0;
  for (const section of bank.sections) {
    const stages = [...new Set(section.questions.map((q) => q.stage))];
    for (const stage of stages) {
      const questions = section.questions.filter((q) => q.stage === stage), group = element('div', null, 'question-group');
      const heading = element('div', null, 'group-heading'); heading.append(element('h3', questions[0].stageLabel), element('span', `${questions.length} 题`)); group.append(heading);
      for (const q of questions) {
        number++;
        const card = element('div', null, 'question-card'); card.id = `question-${q.id}`;
        const title = element('label', null, 'question-title'); title.htmlFor = `status-${q.id}`;
        title.append(element('span', String(number).padStart(2, '0'), 'question-number'), document.createTextNode(q.label));
        const status = select(`status-${q.id}`, bank.answerStatuses, '请选择回复方式'); status.className = 'answer-status'; status.required = true;
        const content = element('div', null, 'answer-content'); content.hidden = true;
        const control = { question: q, card, status, content };
        if (q.type === 'single_choice') {
          control.valueInput = select(`value-${q.id}`, q.options); control.valueInput.dataset.needsValue = 'true'; control.valueInput.setAttribute('aria-label', q.label); content.append(control.valueInput);
        } else if (q.type === 'multi_choice') {
          const grid = element('div', null, 'choice-grid'); grid.setAttribute('role', 'group'); grid.setAttribute('aria-label', q.label);
          for (const choice of q.options) { const label = element('label', null, 'choice-option'), checkbox = input('checkbox', `${q.id}-${choice.id}`); checkbox.value = choice.id; label.append(checkbox, document.createTextNode(choice.label)); grid.append(label); }
          content.append(grid, element('p', `最多选择 ${q.maxSelections} 项。`, 'question-help'));
        } else if (q.type === 'short_text') {
          control.valueInput = element('textarea'); control.valueInput.id = `value-${q.id}`; control.valueInput.maxLength = q.maxLength; control.valueInput.dataset.needsValue = 'true'; control.valueInput.setAttribute('aria-label', q.label);
          content.append(control.valueInput, element('p', `最多 ${q.maxLength} 字。`, 'question-help'));
        } else if (q.type === 'year_event_list' || q.type === 'year_event') {
          control.eventList = element('div'); const add = element('button', '＋ 添加一条经历', 'add-event'); add.type = 'button';
          control.addButton = add; content.append(control.eventList, add, element('p', `最多 ${q.maxItems || 1} 条；不确定或没有此类经历时，可在上方明确选择。`, 'question-help'));
          add.addEventListener('click', () => { invalidateSession(); addEvent(control); });
        }
        card.append(title, status, content); group.append(card); state.questionControls.set(q.id, control);
        status.addEventListener('change', () => { if (status.value === 'answered' && control.eventList && !control.eventList.children.length) addEvent(control); refreshQuestions(); });
      }
      root.append(group);
    }
  }
  refreshQuestions(); updateActions();
}

function readQuestionValue(control) {
  const q = control.question;
  if (q.type === 'single_choice' || q.type === 'short_text') return control.valueInput.value.trim();
  if (q.type === 'multi_choice') return [...control.content.querySelectorAll('input:checked')].map((item) => item.value);
  const events = [...control.eventList.children].map((row) => {
    const value = {};
    for (const item of row.querySelectorAll('[data-event-field]')) {
      const key = item.dataset.eventField;
      if (key === 'year') value.year = Number(item.value);
      else if (item.value.trim()) value[key] = item.value.trim();
    }
    return value;
  });
  return q.type === 'year_event' ? events[0] : events;
}
function isApplicable(q) { return !q.condition || state.applicability.get(q.condition)?.value !== 'false'; }
function refreshQuestions() {
  if (!state.questionnaire) return;
  let complete = 0, total = 0;
  for (const [id, control] of state.questionControls) {
    const q = control.question, applicable = isApplicable(q), answered = control.status.value === 'answered';
    control.card.hidden = !applicable; control.status.disabled = !applicable; control.status.required = applicable;
    control.status.setCustomValidity(''); control.content.hidden = !applicable || !answered;
    for (const item of control.content.querySelectorAll('input,select,textarea')) { item.disabled = !applicable || !answered; item.required = applicable && answered && item.dataset.needsValue === 'true'; item.setCustomValidity(''); }
    if (control.addButton) control.addButton.disabled = control.eventList.children.length >= (q.maxItems || 1);
    if (!applicable) continue;
    total++;
    let valid = Boolean(control.status.value);
    if (answered) {
      const value = readQuestionValue(control);
      if (q.type === 'multi_choice' && (!value.length || value.length > q.maxSelections)) control.status.setCustomValidity(`请选择 1 至 ${q.maxSelections} 项，或明确选择不知道 / 不适用。`);
      if (q.type === 'multi_choice' && value.length > 1 && value.some((item) => q.unknownOptionIds?.includes(item))) control.status.setCustomValidity('不确定选项不能与其他答案同时选择，请核对。');
      if (q.type === 'short_text' && !value) control.valueInput.setCustomValidity('请填写答案，或明确选择不知道 / 不适用。');
      if (control.eventList) {
        if (!control.eventList.children.length) control.status.setCustomValidity('请添加至少一条经历，或明确选择不知道 / 不适用。');
        for (const row of control.eventList.children) {
          const date = row.querySelector('[data-event-field=date]'), year = row.querySelector('[data-event-field=year]');
          if (date.value && year.value && date.value.slice(0, 4) !== year.value) date.setCustomValidity('确切日期与发生年份需要一致。');
        }
      }
      valid = control.status.validity.valid && [...control.content.querySelectorAll('input,select,textarea')].every((item) => item.validity.valid);
      if (q.type === 'short_text' && !value) valid = false;
    }
    if (valid) complete++;
    control.card.dataset.complete = String(valid);
  }
  for (const q of state.questionnaire.applicabilityQuestions) {
    const control = state.applicability.get(q.id); control.setCustomValidity('');
    if (control.value === 'false' && q.impliedTrueBy) {
      const related = state.questionControls.get(q.impliedTrueBy.questionId);
      if (related?.status.value === 'answered' && q.impliedTrueBy.optionIds.includes(readQuestionValue(related))) control.setCustomValidity('适用情况与当前身份的答案不一致，请核对。');
    }
  }
  $('question-progress').textContent = `${complete} / ${total} 题已完成`;
  $('completion-summary').textContent = complete === total ? '问卷已完成，请核对出生资料' : `问卷还需回复 ${total - complete} 题`;
}
function answersData() {
  const responses = {}, applicability = {};
  for (const [id, control] of state.applicability) applicability[id] = control.value === 'true' ? true : control.value === 'false' ? false : 'unknown';
  for (const [id, control] of state.questionControls) {
    if (!isApplicable(control.question)) continue;
    responses[id] = control.status.value === 'answered' ? { status: 'answered', value: readQuestionValue(control) } : { status: control.status.value };
  }
  return { responses, applicability };
}

function bulletList(items, className = 'evidence-list') {
  const list = element('ul', null, className); for (const item of items || []) list.append(element('li', item)); return list;
}
function candidate(id) { return state.session?.candidateSet.candidates.find((item) => item.id === id); }
function candidateLabel(id) {
  const item = candidate(id); if (!item) return id;
  const index = state.session.candidateSet.candidates.indexOf(item) + 1;
  return `候选 ${index} · ${Object.values(item.pillars).join(' ')}`;
}
function chartBasisLabel(path) {
  const labels = { 'pillars.year': '年柱', 'pillars.month': '月柱', 'pillars.day': '日柱', 'pillars.hour': '时柱', dayMaster: '日主',
    'features.hiddenStems': '地支藏干', 'features.tenGods': '十神关系', 'features.nayin': '纳音', 'features.fiveElements': '五行分布',
    'features.fiveElementsDefinition': '五行统计口径', 'features.luckCycles': '大运', 'features.qiyun': '起运信息',
    'features.luckCyclesRepresentative': '大运采用的代表时间', 'features.ruleProfile': '排盘规则', 'features.solarDate': '换算后的公历日期',
    'features.originalCalendar': '原始历法', 'features.timeBasis': '时间计算口径', 'features.timezone': '出生地点时区',
    'features.longitude': '出生地点经度', 'features.minuteResolution': '候选时间精度', 'features.evaluatedInstants': '已计算的候选时刻',
    'features.representative': '本候选的代表时刻', 'features.ambiguousTimeAlternatives': '重复民用时间的不同解释' };
  return labels[path] || '其他已计算的命盘资料';
}
function evidenceText(id) {
  const item = [...(state.session?.evidence || []), ...(state.session?.context || [])].find((entry) => entry.id === id);
  if (!item) return id;
  let answer;
  if (item.answer.status === 'unknown') answer = '不知道 / 不确定 / 暂不提供';
  else if (item.answer.status === 'not_applicable') answer = '不适用 / 没有此类经历';
  else if (item.answerLabels?.length) answer = item.answerLabels.join('、');
  else if (Array.isArray(item.answer.value)) answer = item.answer.value.map((value) => typeof value === 'string' ? value : `${value.year}：${value.description}`).join('；');
  else answer = String(item.answer.value);
  return `${item.label}：${answer}`;
}
function references(root, title, ids, contradiction = false) {
  root.append(element('p', title, contradiction ? 'evidence-title contradiction' : 'evidence-title'));
  root.append(ids?.length ? bulletList(ids.map(evidenceText)) : element('p', '未列出依据。', 'muted'));
}
function usageText(result) {
  const usage = result.usage || {}, number = (value) => typeof value === 'number' ? value.toLocaleString('zh-CN') : '未返回';
  const prefix = result.cached ? '复用已保存结果，本次未新增模型调用。以下为原调用用量。\n' : '已完成真实模型调用。\n';
  return `${prefix}${result.model || '模型未返回'} · 输入 ${number(usage.inputTokens)} / 输出 ${number(usage.outputTokens)} / 合计 ${number(usage.totalTokens)} token` +
    (typeof usage.cachedInputTokens === 'number' ? ` · 缓存输入 ${number(usage.cachedInputTokens)}` : '') +
    (typeof usage.reasoningTokens === 'number' ? ` · 思考 ${number(usage.reasoningTokens)}` : '') +
    (typeof result.durationMs === 'number' ? ` · ${(result.durationMs / 1000).toFixed(1)} 秒` : '');
}

function renderCandidates() {
  const set = state.session.candidateSet; $('candidate-section').hidden = false;
  $('candidate-summary').textContent = `本地历法生成 ${set.candidates.length} 个不同四柱候选，尚未经过 AI 比较。${state.session.asOfDate ? `资料截点：${state.session.asOfDate}。` : ''}`;
  $('candidate-warnings').replaceChildren(...(set.warnings?.length ? [bulletList(set.warnings, 'warning-list')] : []));
  const list = $('candidate-list'); list.replaceChildren();
  for (const [index, item] of set.candidates.entries()) {
    const card = element('article', null, 'candidate-card'); card.dataset.candidateId = item.id;
    const topline = element('div', null, 'candidate-topline'); topline.append(element('span', `候选 ${index + 1}`), element('span', `日主 ${item.dayMaster}`));
    const pillars = element('div', null, 'pillars');
    for (const [position, label] of [['year', '年柱'], ['month', '月柱'], ['day', '日柱'], ['hour', '时柱']]) { const pillar = element('div'); pillar.append(element('span', label, 'pillar-label'), element('span', item.pillars[position], 'pillar-value')); pillars.append(pillar); }
    const times = item.civilTimes || [], timeLabel = times.length > 1 ? `${times[0]} — ${times[times.length - 1]}（覆盖 ${times.length} 个民用分钟，可能不连续）` : times[0] || '未提供时间';
    const details = element('details'); details.append(element('summary', '查看本地排盘依据'), element('pre', JSON.stringify({ features: item.features, warnings: item.warnings }, null, 2)));
    card.append(topline, pillars, element('p', timeLabel.replaceAll('T', ' '), 'candidate-time'), details); list.append(card);
  }
  if (!state.configured) $('review-call-status').textContent = 'DeepSeek 尚未配置。你可以查看本地候选盘；服务端配置完成后点击页首“刷新”。';
}
function renderReview(result) {
  const review = result.review, root = $('review-result'); root.replaceChildren();
  const statusLabels = { recommended: '暂定推荐', ambiguous: '多个候选仍难区分', insufficient_evidence: '证据不足' };
  const intro = element('div', null, 'result-intro'); intro.append(element('p', statusLabels[review.status] || review.status, 'result-label'), element('div', review.summary)); root.append(intro);
  for (const [index, row] of review.ranking.entries()) {
    const card = element('article', null, 'assessment'), heading = element('div', null, 'assessment-title');
    heading.append(element('h3', `${index + 1}. ${candidateLabel(row.candidate_id)}`));
    if (row.candidate_id === review.recommended_candidate_id) heading.append(element('span', '暂定推荐', 'count-pill'));
    else if (review.alternatives.includes(row.candidate_id)) heading.append(element('span', '保留备选', 'count-pill'));
    card.append(heading, element('p', row.rationale)); references(card, '支持线索 · 用户提供', row.supporting_evidence_ids); references(card, '矛盾线索 · 用户提供', row.contradicting_evidence_ids, true);
    if (row.unresolved_questions.length) card.append(element('p', '仍待澄清', 'evidence-title'), bulletList(row.unresolved_questions)); root.append(card);
  }
  root.append(element('p', '本轮局限', 'evidence-title'), bulletList(review.limits));
  $('review-call-status').textContent = usageText(result);
  const selection = $('selected-candidate'); selection.replaceChildren(option('', '请明确选择一个暂定工作盘'));
  for (const item of state.session.candidateSet.candidates) selection.append(option(item.id, candidateLabel(item.id)));
  state.selection = review.recommended_candidate_id || ''; selection.value = state.selection;
  $('selection-note').textContent = state.selection ? '已采用暂定推荐；深入分析前，你仍可选择其他候选。' : '模型未推荐单一时辰。若继续，请自行选择一个暂定工作盘，并保留这种不确定性。';
  $('analysis-section').hidden = false; $('report-section').hidden = false; highlightSelection(); updateActions();
}
function highlightSelection() { for (const card of $('candidate-list').children) card.classList.toggle('selected', card.dataset.candidateId === state.selection); }
function renderAnalysis(result) {
  const analysis = result.analysis, root = $('analysis-result'); root.replaceChildren();
  root.append(element('div', analysis.overview, 'result-intro'));
  for (const section of analysis.sections) {
    const card = element('article', null, 'analysis-part'); card.append(element('h3', section.domain), element('p', section.text));
    references(card, '引用的已知资料 · 用户提供', section.evidence_ids);
    card.append(element('p', '命盘解释依据', 'evidence-title'), bulletList(section.chart_basis.map(chartBasisLabel)));
    if (section.uncertainties.length) card.append(element('p', '不确定性', 'evidence-title'), bulletList(section.uncertainties)); root.append(card);
  }
  if (analysis.scenarios.length) {
    const section = element('section', null, 'analysis-part'); section.append(element('h3', '条件性情景'));
    for (const scenario of analysis.scenarios) { const card = element('div', null, 'scenario'); card.append(element('strong', scenario.condition), element('p', scenario.implication)); references(card, '相关已知资料', scenario.evidence_ids); section.append(card); }
    root.append(section);
  }
  root.append(element('p', '分析边界', 'evidence-title'), bulletList(analysis.limitations));
  $('analysis-call-status').textContent = usageText(result);
  $('selection-note').textContent = '本次分析的工作盘已固定。如需更换，请修改资料或重新提交，建立新会话。'; updateActions();
}

$('intake-form').addEventListener('input', () => { invalidateSession(); updateBirthFields(); refreshQuestions(); });
$('intake-form').addEventListener('change', () => { invalidateSession(); updateBirthFields(); refreshQuestions(); });
$('intake-form').addEventListener('submit', async (event) => {
  event.preventDefault(); if (state.busy || !state.questionnaire) return;
  clearError(); updateBirthFields(); refreshQuestions();
  if (!$('intake-form').reportValidity()) { announce('请补全标记的资料，或为对应问卷明确选择不知道 / 不适用。'); return; }
  const submitted = { birth: birthData(), answers: answersData() }, previous = state.session?.id;
  clearResults(); setBusy('session'); announce('正在本地计算候选盘，不会调用 AI。');
  try {
    if (previous && !await deleteSession(previous)) throw new Error('旧会话删除未确认，请稍后再提交。');
    const session = await api('/api/session', 'POST', submitted); state.session = session; state.submitted = submitted;
    renderCandidates(); announce(`候选盘已生成。资料临时保存在服务内存中${session.expiresAt ? `，有效至 ${new Date(session.expiresAt).toLocaleString('zh-CN')}` : ''}。AI 尚未调用。`);
    $('candidate-section').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (error) { showError(errorText(error)); announce('候选盘尚未生成，请核对资料后重试。'); }
  finally { setBusy(null); }
});

$('review-button').addEventListener('click', async () => {
  if (state.busy || !state.session || state.review || !state.configured) return;
  clearError(); setBusy('review'); $('review-call-status').textContent = '正在调用 DeepSeek 比较候选盘，通常需要一些时间。请勿重复提交。';
  try { const result = await api('/api/review', 'POST', { sessionId: state.session.id }); state.review = result; renderReview(result); announce('AI 校盘已完成。请阅读矛盾与局限，再确认深入分析的工作盘。'); }
  catch (error) { showError(errorText(error)); $('review-call-status').textContent = '校盘未完成，未使用 mock 替代。你可以明确点击按钮重试；失败请求可能已产生模型用量。'; }
  finally { setBusy(null); }
});
$('selected-candidate').addEventListener('change', () => { if (state.analysis || state.busy) return; state.selection = $('selected-candidate').value; highlightSelection(); updateActions(); });
$('analysis-button').addEventListener('click', async () => {
  if (state.busy || !state.session || !state.review || !state.selection || state.analysis || !state.configured) return;
  clearError(); setBusy('analysis'); $('analysis-call-status').textContent = '正在调用 DeepSeek，将工作盘与现实背景结合。请勿重复提交。';
  try { const result = await api('/api/analysis', 'POST', { sessionId: state.session.id, candidateId: state.selection }); state.analysis = result; renderAnalysis(result); announce('深入分析已完成，可以下载本次记录。'); }
  catch (error) { showError(errorText(error)); $('analysis-call-status').textContent = '分析未完成，未使用 mock 替代。你可以明确点击按钮重试；失败请求可能已产生模型用量。'; }
  finally { setBusy(null); }
});
$('clear-session').addEventListener('click', async () => {
  if (state.busy) return;
  const id = state.session?.id; clearResults(); $('intake-form').reset(); clearError(); if (state.questionnaire) renderQuestionnaire(state.questionnaire); updateBirthFields();
  announce('页面中的本次资料已清除。');
  if (!await deleteSession(id)) showError('页面资料已清除，但服务会话删除未确认；服务将按有效期清理。');
});
$('refresh-status').addEventListener('click', refreshStatus);

function reportData() { return { reportVersion: '1.0', exportedAt: new Date().toISOString(), asOfDate: state.session.asOfDate, birth: state.submitted.birth, answers: state.submitted.answers, candidateSet: state.session.candidateSet, evidence: state.session.evidence, context: state.session.context, selectedCandidateId: state.selection || null, review: state.review, analysis: state.analysis, notice: '用户提供的经历未经独立验证。AI 推荐不代表真实出生时辰得到证明。' }; }
function markdownReport(report) {
  const escape = (value) => String(value).replace(/[\\`*_\[\]<>!]/g, '\\$&');
  const lines = ['# 八字校盘与分析记录', '', `导出时间：${report.exportedAt}`, `资料截点：${report.asOfDate || '未提供'}`, '', report.notice, '', '## 出生资料', '', ...Object.entries(report.birth).map(([key, value]) => `- ${escape(key)}：${escape(value)}`), '', '## 提交的问卷资料', ''];
  for (const item of [...report.evidence, ...report.context]) lines.push(`- ${escape(evidenceText(item.id))}`);
  lines.push('', '## 本地候选盘', '');
  for (const item of report.candidateSet.candidates) lines.push(`- ${escape(candidateLabel(item.id))}；${escape(item.id)}`);
  lines.push('', '## AI 校盘', '', `结论状态：${escape(report.review.review.status)}`, `暂定推荐：${report.review.review.recommended_candidate_id ? escape(candidateLabel(report.review.review.recommended_candidate_id)) : '未推荐单一时辰'}`, `保留备选：${report.review.review.alternatives.map((id) => escape(candidateLabel(id))).join('；') || '未列出'}`, '', escape(report.review.review.summary), '', ...report.review.review.ranking.flatMap((item) => [`### ${escape(candidateLabel(item.candidate_id))}`, '', escape(item.rationale), '', '**支持线索**', ...item.supporting_evidence_ids.map((id) => `- ${escape(evidenceText(id))}`), '', '**矛盾线索**', ...item.contradicting_evidence_ids.map((id) => `- ${escape(evidenceText(id))}`), '', '**仍待澄清**', ...item.unresolved_questions.map((text) => `- ${escape(text)}`), '']), '**局限**', ...report.review.review.limits.map((text) => `- ${escape(text)}`), '', escape(usageText(report.review)));
  if (report.analysis) {
    lines.push('', '## 深入分析', '', `工作盘：${escape(candidateLabel(report.analysis.analysis.selected_candidate_id))}`, '', escape(report.analysis.analysis.overview));
    for (const part of report.analysis.analysis.sections) lines.push('', `### ${escape(part.domain)}`, '', escape(part.text), '', '**命盘解释依据**', ...part.chart_basis.map((text) => `- ${escape(text)}`), '', '**已知资料**', ...part.evidence_ids.map((id) => `- ${escape(evidenceText(id))}`), '', '**不确定性**', ...part.uncertainties.map((text) => `- ${escape(text)}`));
    lines.push('', '### 条件性情景', ...report.analysis.analysis.scenarios.flatMap((item) => ['', `- 条件：${escape(item.condition)}`, `  推演：${escape(item.implication)}`]), '', '**分析边界**', ...report.analysis.analysis.limitations.map((text) => `- ${escape(text)}`), '', escape(usageText(report.analysis)));
  }
  return lines.join('\n');
}
function download(kind) {
  if (!state.review || !state.session || state.busy) return;
  const report = reportData(), content = kind === 'json' ? JSON.stringify(report, null, 2) : markdownReport(report);
  const url = URL.createObjectURL(new Blob([content], { type: kind === 'json' ? 'application/json;charset=utf-8' : 'text/markdown;charset=utf-8' }));
  const link = element('a'); link.href = url; link.download = `bazi-record-${new Date().toISOString().slice(0, 10)}.${kind === 'json' ? 'json' : 'md'}`;
  document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
$('download-json').addEventListener('click', () => download('json'));
$('download-markdown').addEventListener('click', () => download('markdown'));

updateBirthFields();
void refreshStatus();
api('/api/questionnaire').then(renderQuestionnaire).catch((error) => { $('questionnaire-content').replaceChildren(element('p', '问卷未能加载，请确认本地服务正常后刷新页面。', 'muted')); showError(errorText(error)); });
