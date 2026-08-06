import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "红序｜小红书双业务运营与素材系统",
  description: "百度网盘素材管理、本机缓存、内容审查、发布、监控和竞品分析工作台。",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
