import { UnsupportedLocalCommandError } from './local-command-handler.mjs';

function assertHandler(handler) {
  if (!handler || typeof handler !== 'object') throw new TypeError('command handler must be an object');
  for (const method of ['supports', 'validate', 'execute']) {
    if (typeof handler[method] !== 'function') throw new TypeError(`command handler is missing method "${method}"`);
  }
  return handler;
}

export class CompositeCommandHandler {
  constructor(handlers = []) {
    if (!Array.isArray(handlers) || handlers.length === 0) throw new TypeError('handlers must be a non-empty array');
    this.handlers = Object.freeze(handlers.map(assertHandler));
  }

  resolve(commandType) {
    return this.handlers.find((handler) => handler.supports(commandType)) ?? null;
  }

  supports(commandType) {
    return this.resolve(commandType) != null;
  }

  validate(command) {
    const handler = this.resolve(command?.command_type);
    if (!handler) throw new UnsupportedLocalCommandError(command?.command_type);
    return handler.validate(command);
  }

  execute(command, context) {
    const handler = this.resolve(command?.command_type);
    if (!handler) throw new UnsupportedLocalCommandError(command?.command_type);
    return handler.execute(command, context);
  }
}
