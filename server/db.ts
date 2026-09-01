import dns from "node:dns";
import mongoose from "mongoose";

let connectionPromise: Promise<typeof mongoose> | null = null;

/** 复用 MongoDB 连接，避免开发环境热更新时重复创建连接。 */
export async function connectDatabase(): Promise<void> {
  if (mongoose.connection.readyState === 1) return;

  if (!connectionPromise) {
    const uri = process.env.MONGODB_URI ?? "mongodb://127.0.0.1:27017/jd-ai-workbench";
    const dnsServers = (process.env.MONGODB_DNS_SERVERS ?? "")
      .split(",")
      .map((server) => server.trim())
      .filter(Boolean);
    if (dnsServers.length > 0) {
      // 绕过本机代理 DNS，确保 mongodb+srv 可以解析 Atlas 的 SRV 记录。
      dns.setServers(dnsServers);
    }
    connectionPromise = mongoose
      .connect(uri, {
        dbName: process.env.MONGODB_DB_NAME ?? "jd-ai-workbench",
        serverSelectionTimeoutMS: 10000,
      })
      .catch((error) => {
        // 连接失败后允许下一次请求重新建立连接，避免持续复用 rejected Promise。
        connectionPromise = null;
        throw error;
      });
  }

  await connectionPromise;
}
