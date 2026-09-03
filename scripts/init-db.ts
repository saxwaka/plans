import { getDb } from "../src/lib/db";
getDb();
console.log(`DB sẵn sàng tại ${process.env.DATABASE_PATH ?? "./data/gateway.db"}`);
