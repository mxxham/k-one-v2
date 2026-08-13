"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.BinTransferModule = void 0;
const common_1 = require("@nestjs/common");
const bintransfer_service_1 = require("./bintransfer.service");
const bintransfer_actions_1 = require("./bintransfer.actions");
let BinTransferModule = class BinTransferModule {
};
exports.BinTransferModule = BinTransferModule;
exports.BinTransferModule = BinTransferModule = __decorate([
    (0, common_1.Module)({
        providers: [bintransfer_service_1.BinTransferService, bintransfer_actions_1.BinTransferActions],
        exports: [bintransfer_service_1.BinTransferService],
    })
], BinTransferModule);
//# sourceMappingURL=bintransfer.module.js.map