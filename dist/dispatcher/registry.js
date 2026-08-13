"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerActions = registerActions;
exports.getActionHandler = getActionHandler;
exports.knownModule = knownModule;
exports.setPermission = setPermission;
exports.getPermission = getPermission;
const registry = new Map();
function registerActions(module, actions) {
    let m = registry.get(module);
    if (!m) {
        m = new Map();
        registry.set(module, m);
    }
    for (const [action, fn] of Object.entries(actions)) {
        m.set(action, fn);
    }
}
function getActionHandler(module, action) {
    return registry.get(module)?.get(action);
}
function knownModule(module) {
    return registry.has(module);
}
const permissions = new Map();
function setPermission(module, action, level) {
    permissions.set(`${module}::${action}`, level);
}
function getPermission(module, action) {
    return permissions.get(`${module}::${action}`) ?? 'any';
}
//# sourceMappingURL=registry.js.map