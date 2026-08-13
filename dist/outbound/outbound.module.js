"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.OutboundModule = void 0;
const common_1 = require("@nestjs/common");
const outbound_actions_1 = require("./outbound.actions");
const outbound_service_1 = require("./outbound.service");
const master_module_1 = require("../master/master.module");
let OutboundModule = class OutboundModule {
};
exports.OutboundModule = OutboundModule;
exports.OutboundModule = OutboundModule = __decorate([
    (0, common_1.Module)({
        imports: [master_module_1.MasterModule],
        providers: [outbound_actions_1.OutboundActions, outbound_service_1.OutboundService],
        exports: [outbound_service_1.OutboundService],
    })
], OutboundModule);
//# sourceMappingURL=outbound.module.js.map