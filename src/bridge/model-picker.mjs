// Adapter for the native composer's model picker. Keep these functions
// self-contained: the bridge serializes them into the desktop renderer.
export function readNativeModelPicker(document) {
  const triggers = [...document.querySelectorAll('button[data-codex-intelligence-trigger]')]
    .filter(button => button.offsetParent !== null &&
      !button.closest('[inert], [hidden], [aria-hidden="true"], [role="dialog"], [aria-modal="true"]'));
  if (triggers.length !== 1) throw new Error('No unique model selector is available for this task');
  const trigger = triggers[0];
  const key = Object.getOwnPropertyNames(trigger).find(key => key.startsWith('__reactFiber$'));
  let root = key && trigger[key];
  while (root?.return) root = root.return;
  // DOM fibers can point to the previous render. Only read the committed tree.
  const queue = [root?.stateNode?.current];
  const seen = new Set();
  let mounted = null;
  while (queue.length) {
    const node = queue.pop();
    if (!node || seen.has(node)) continue;
    seen.add(node);
    if (node.stateNode === trigger) { mounted = node; break; }
    queue.push(node.child, node.sibling);
  }
  for (let node = mounted; node; node = node.return) {
    const props = node.memoizedProps;
    if (Array.isArray(props?.models) && Array.isArray(props?.modelOptions) &&
        typeof props.onSelectModel === 'function' && typeof props.onSelectReasoningEffort === 'function') {
      return { trigger, props };
    }
  }
  throw new Error('Native model picker is unavailable in this Codex version');
}

export function cycleNativeModelPicker(picker, action) {
  const { trigger, props } = picker;
  if (trigger.disabled || trigger.getAttribute('aria-disabled') === 'true' ||
      props.disabled || props.daybreak?.disabled || props.daybreak?.isSaving) {
    throw new Error('Model settings are currently disabled');
  }
  const effortIds = new Set(['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra']);
  const effortsFor = model => [...new Set((model?.supportedReasoningEfforts || [])
    .map(option => option.reasoningEffort).filter(effort => effortIds.has(effort)))];
  if (action === 'model') {
    if (props.modelOptionsDisabled || props.modelLabelOnly) throw new Error('Model selection is locked');
    const models = props.modelOptions.filter(option => option.disabledReason == null &&
      option.model?.model !== props.lockedModelSlug && typeof option.model?.model === 'string');
    const index = models.findIndex(option => option.model.model === props.model);
    if (index < 0) throw new Error('The current model is not in the available model list');
    if (models.length < 2) throw new Error('No other model is available');
    const next = models[(index + 1) % models.length].model;
    const efforts = effortsFor(next);
    const effort = efforts.includes(props.reasoningEffort) ? props.reasoningEffort : next.defaultReasoningEffort;
    if (!efforts.includes(effort)) throw new Error('The next model has no supported reasoning effort');
    if (props.onBeforeSelectModel?.(next.model) === false) throw new Error('Codex did not allow this model selection');
    props.onSelectModel(next.model, effort);
    props.onSelectModelOption?.();
    return { model: next.model, reasoningEffort: effort };
  }
  if (action !== 'reasoning') throw new Error('Unsupported model picker action');
  if (props.reasoningEffortDisabled || props.showReasoningEffortControls === false) {
    throw new Error('Reasoning effort selection is disabled');
  }
  const current = props.models.find(model => model.model === props.model);
  const efforts = effortsFor(current);
  const index = efforts.indexOf(props.reasoningEffort);
  if (index < 0) throw new Error('The current reasoning effort is unavailable');
  if (efforts.length < 2) throw new Error('No other reasoning effort is available');
  const effort = efforts[(index + 1) % efforts.length];
  props.onSelectReasoningEffort(effort);
  return { model: props.model, reasoningEffort: effort };
}
