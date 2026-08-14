import "dotenv/config";
import { drizzle } from "drizzle-orm/node-postgres";

// One pool per process. Server, relay and worker run separately: they share the
// schema, not the sockets.
export const db = drizzle(process.env.DATABASE_URL!);

export type DB = typeof db;
