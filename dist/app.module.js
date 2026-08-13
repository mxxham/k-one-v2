"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AppModule = void 0;
const common_1 = require("@nestjs/common");
const config_module_1 = require("./config/config.module");
const database_module_1 = require("./database/database.module");
const common_module_1 = require("./common/common.module");
const dispatcher_module_1 = require("./dispatcher/dispatcher.module");
const auth_module_1 = require("./auth/auth.module");
const master_module_1 = require("./master/master.module");
const stock_module_1 = require("./stock/stock.module");
const inbound_module_1 = require("./inbound/inbound.module");
const outbound_module_1 = require("./outbound/outbound.module");
const picklist_module_1 = require("./picklist/picklist.module");
const report_module_1 = require("./report/report.module");
const stocktake_module_1 = require("./stocktake/stocktake.module");
const bintransfer_module_1 = require("./bintransfer/bintransfer.module");
const import_module_1 = require("./import/import.module");
const export_module_1 = require("./export/export.module");
let AppModule = class AppModule {
};
exports.AppModule = AppModule;
exports.AppModule = AppModule = __decorate([
    (0, common_1.Module)({
        imports: [config_module_1.ConfigModule, database_module_1.DatabaseModule, common_module_1.CommonModule, dispatcher_module_1.DispatcherModule, auth_module_1.AuthModule, master_module_1.MasterModule, stock_module_1.StockModule, inbound_module_1.InboundModule, outbound_module_1.OutboundModule, picklist_module_1.PicklistModule, report_module_1.ReportModule, stocktake_module_1.StockTakeModule, bintransfer_module_1.BinTransferModule, import_module_1.ImportModule, export_module_1.ExportModule],
    })
], AppModule);
//# sourceMappingURL=app.module.js.map