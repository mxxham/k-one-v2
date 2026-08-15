"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerActions = registerActions;
exports.getActionHandler = getActionHandler;
exports.knownModule = knownModule;
exports.setPermission = setPermission;
exports.getPermission = getPermission;
exports.setModuleDepartments = setModuleDepartments;
exports.setActionDepartments = setActionDepartments;
exports.getDepartments = getDepartments;
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
const departmentDefaults = new Map();
const departmentOverrides = new Map();
function setModuleDepartments(module, departments) {
    departmentDefaults.set(module, departments);
}
function setActionDepartments(module, action, departments) {
    departmentOverrides.set(`${module}::${action}`, departments);
}
function getDepartments(module, action) {
    return departmentOverrides.get(`${module}::${action}`) ?? departmentDefaults.get(module);
}
//# sourceMappingURL=registry.js.map