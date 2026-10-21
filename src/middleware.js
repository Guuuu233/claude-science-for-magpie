// These hooks run in Magpie's moejs runtime, without Node or file access.
const AGENT = 'claude-science';
const ORIGINAL_MODEL = 'claudeScienceOriginalModel';

function scoped(ctx) {
  return ctx && ctx.agent === AGENT && ctx.protocol === 'anthropic' &&
    (!ctx.options || ctx.options.agent === undefined || ctx.options.agent === AGENT);
}

function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function modelID(value) {
  return typeof value === 'string' && value.length <= 256 &&
    /^[a-zA-Z0-9][a-zA-Z0-9._:/-]*$/.test(value) && !value.includes('..') && !value.includes('://');
}

export function onRequest(body, ctx) {
  if (!scoped(ctx)) return body;
  if (!object(body) || !modelID(body.model)) {
    ctx.reject(400, 'Claude Science requires a valid request model.');
    return body;
  }
  if (body.model.startsWith('claude-')) {
    // The bridge already selects a provider/model from the live Agent config.
    // Plugin options are needed only for requests still using Claude aliases.
    const target = ctx.options && ctx.options.model;
    if (!modelID(target) || !/^[a-zA-Z0-9][a-zA-Z0-9._-]*\/[a-zA-Z0-9]/.test(target)) {
      ctx.reject(400, 'Claude Science requires a valid provider/model option.');
      return body;
    }
    ctx.state[ORIGINAL_MODEL] = body.model;
    body.model = target;
  }
  return body;
}

function originalModel(ctx) {
  if (!scoped(ctx) || !object(ctx.state)) return undefined;
  return ctx.state[ORIGINAL_MODEL];
}

export function onEvent(event, ctx) {
  const original = originalModel(ctx);
  if (original && object(event) && event.type === 'message_start' && object(event.message)) {
    event.message.model = original;
  }
  return event;
}

export function onResponse(body, ctx) {
  const original = originalModel(ctx);
  if (original && object(body) && body.type === 'message') body.model = original;
  return body;
}
