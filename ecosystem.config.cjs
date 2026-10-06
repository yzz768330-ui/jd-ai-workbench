/**
 * PM2 进程守护配置
 * 使用方式：pm2 start ecosystem.config.cjs
 * 宝塔 PM2 管理器中"添加项目"时也可以填这个文件
 */
module.exports = {
  apps: [
    {
      name: "jd-ai-api",
      script: "server/index.ts",
      interpreter: "node_modules/.bin/tsx",
      cwd: "./",
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "512M",
      env: {
        NODE_ENV: "production",
        PORT: 3001,
      },
    },
  ],
};
