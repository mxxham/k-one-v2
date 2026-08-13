"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PicklistModule = void 0;
const common_1 = require("@nestjs/common");
const picklist_service_1 = require("./picklist.service");
const picklist_actions_1 = require("./picklist.actions");
let PicklistModule = class PicklistModule {
};
exports.PicklistModule = PicklistModule;
exports.PicklistModule = PicklistModule = __decorate([
    (0, common_1.Module)({
        providers: [picklist_service_1.PicklistService, picklist_actions_1.PicklistActions],
        exports: [picklist_service_1.PicklistService],
    })
], PicklistModule);
//# sourceMappingURL=picklist.module.js.map