"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const dotenv_1 = require("dotenv");
const path_1 = require("path");
(0, dotenv_1.config)({ path: (0, path_1.resolve)(__dirname, '../../.env') });
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const pg_1 = require("pg");
const pool = new pg_1.Pool({
    host: process.env.DB_HOST ?? 'localhost',
    port: Number(process.env.DB_PORT ?? 5432),
    database: process.env.DB_NAME ?? 'k_one',
    user: process.env.DB_USER ?? 'kone',
    password: process.env.DB_PASS ?? 'kone',
});
async function main() {
    const dir = path.join(__dirname, 'migrations');
    if (!fs.existsSync(dir)) {
        process.stdout.write('No migrations dir\n');
        return;
    }
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
    await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    filename TEXT PRIMARY KEY,
    applied_at TIMESTAMP NOT NULL DEFAULT NOW()
  )`);
    for (const file of files) {
        const done = await pool.query('SELECT 1 FROM schema_migrations WHERE filename = $1', [file]);
        if (done.rows.length > 0) {
            process.stdout.write(`skip ${file}\n`);
            continue;
        }
        const sql = fs.readFileSync(path.join(dir, file), 'utf8');
        process.stdout.write(`applying ${file}... `);
        await pool.query(sql);
        await pool.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [file]);
        process.stdout.write('ok\n');
    }
    await pool.end();
}
main().catch((e) => {
    console.error(e);
    process.exit(1);
});
//# sourceMappingURL=migrate.js.map