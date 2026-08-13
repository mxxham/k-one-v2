import { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';
export declare class DbService {
    readonly pool: Pool;
    private readonly logger;
    private readonly client;
    constructor(pool: Pool);
    query<T extends QueryResultRow = any>(text: string, params?: unknown[]): Promise<QueryResult<T>>;
    transaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T>;
    onModuleDestroy(): Promise<void>;
}
